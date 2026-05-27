import { reddit, redis } from '@devvit/web/server';
import { T3 as toPostThingId } from '@devvit/shared-types/tid.js';
import type {
  CascadeAuditEvent,
  CascadeDashboardData,
  CascadeLink,
  CascadeRequest,
  CascadeRequestState,
  LinkState,
} from '../shared/dashboard';

const DASHBOARD_POST_TITLE = 'CascadeBan Mod Dashboard';
const DASHBOARD_LIMIT = 80;
const AUDIT_LIMIT = 40;
const DATA_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const keyPrefix = (subredditName: string) =>
  `cascade:${subredditName.toLowerCase()}`;

const dashboardPostKey = (subredditName: string) =>
  `${keyPrefix(subredditName)}:dashboard-post`;

const linksKey = (subredditName: string) => `${keyPrefix(subredditName)}:links`;

const requestIndexKey = (subredditName: string) =>
  `${keyPrefix(subredditName)}:requests`;

const requestKey = (subredditName: string, requestId: string) =>
  `${keyPrefix(subredditName)}:request:${requestId}`;

const auditIndexKey = (subredditName: string) =>
  `${keyPrefix(subredditName)}:audit`;

const normalizeSubredditName = (value: string) =>
  value.trim().replace(/^r\//i, '').toLowerCase();

const now = () => Date.now();

const parseJson = <T>(value: string | null | undefined): T | undefined => {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
};

const readLinksMap = async (
  subredditName: string
): Promise<Record<string, CascadeLink>> =>
  parseJson<Record<string, CascadeLink>>(await redis.get(linksKey(subredditName))) ??
  {};

const writeLinksMap = async (
  subredditName: string,
  links: Record<string, CascadeLink>
) => {
  await redis.set(linksKey(subredditName), JSON.stringify(links));
};

export const getLinks = async (subredditName: string): Promise<CascadeLink[]> =>
  Object.values(await readLinksMap(subredditName)).sort((a, b) =>
    a.subredditName.localeCompare(b.subredditName)
  );

export const getApprovedLinkedSubreddits = async (subredditName: string) =>
  (await getLinks(subredditName))
    .filter((link) => link.state === 'approved')
    .map((link) => link.subredditName);

export const upsertLink = async ({
  subredditName,
  targetSubreddit,
  state,
  actor,
}: {
  subredditName: string;
  targetSubreddit: string;
  state: LinkState;
  actor?: string | undefined;
}) => {
  const target = normalizeSubredditName(targetSubreddit);
  const current = await readLinksMap(subredditName);
  const timestamp = now();
  const previous = current[target];
  current[target] = {
    subredditName: target,
    state,
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
    requestedBy: previous?.requestedBy ?? actor,
  };
  await writeLinksMap(subredditName, current);
  await addAuditEvent(subredditName, {
    kind:
      state === 'pending'
        ? 'link-requested'
        : state === 'approved'
          ? 'link-approved'
          : 'link-updated',
    actor,
    message: `r/${target} is now ${state}.`,
  });
  return current[target];
};

export const saveCascadeRequest = async (request: CascadeRequest) => {
  await redis.set(
    requestKey(request.targetSubreddit, request.id),
    JSON.stringify(request),
    {
      expiration: new Date(Date.now() + DATA_TTL_MS),
    }
  );
  await redis.zAdd(requestIndexKey(request.targetSubreddit), {
    member: request.id,
    score: request.updatedAt,
  });
  await redis.zRemRangeByScore(
    requestIndexKey(request.targetSubreddit),
    0,
    Date.now() - DATA_TTL_MS
  );

  const origin = request.originSubreddit?.trim().toLowerCase();
  const target = request.targetSubreddit?.trim().toLowerCase();
  if (origin && origin !== 'unknown' && origin !== target) {
    await redis.set(
      requestKey(request.originSubreddit, request.id),
      JSON.stringify(request),
      {
        expiration: new Date(Date.now() + DATA_TTL_MS),
      }
    );
    await redis.zAdd(requestIndexKey(request.originSubreddit), {
      member: request.id,
      score: request.updatedAt,
    });
    await redis.zRemRangeByScore(
      requestIndexKey(request.originSubreddit),
      0,
      Date.now() - DATA_TTL_MS
    );
  }
};

export const createCascadeRequest = async (
  input: Omit<CascadeRequest, 'id' | 'createdAt' | 'updatedAt' | 'state'>
) => {
  const timestamp = now();
  const request: CascadeRequest = {
    ...input,
    id: crypto.randomUUID(),
    state: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await saveCascadeRequest(request);
  await addAuditEvent(request.targetSubreddit, {
    kind: 'request-created',
    actor: request.requestedBy,
    message: `${request.action} request for u/${request.username} from r/${request.originSubreddit}.`,
  });
  return request;
};

export const getCascadeRequest = async (
  subredditName: string,
  requestId: string
) => parseJson<CascadeRequest>(await redis.get(requestKey(subredditName, requestId)));

export const updateCascadeRequestState = async (
  subredditName: string,
  requestId: string,
  state: CascadeRequestState,
  patch: Partial<CascadeRequest> = {}
) => {
  const existing = await getCascadeRequest(subredditName, requestId);
  if (!existing) {
    return undefined;
  }

  const updated: CascadeRequest = {
    ...existing,
    ...patch,
    state,
    updatedAt: now(),
  };
  await saveCascadeRequest(updated);
  return updated;
};

export const findPendingRequest = async (
  subredditName: string,
  action: 'ban' | 'unban',
  username: string
) => {
  const normalizedUser = username.toLowerCase();
  return (await getCascadeRequests(subredditName)).find(
    (request) =>
      request.state === 'pending' &&
      request.action === action &&
      request.username.toLowerCase() === normalizedUser
  );
};

export const getCascadeRequests = async (subredditName: string) => {
  const indexed = await redis.zRange(
    requestIndexKey(subredditName),
    0,
    DASHBOARD_LIMIT - 1,
    {
      by: 'rank',
      reverse: true,
    }
  );
  const keys = indexed.map((entry) => requestKey(subredditName, entry.member));
  const values = keys.length > 0 ? await redis.mGet(keys) : [];
  return values
    .map((value) => parseJson<CascadeRequest>(value))
    .filter((request): request is CascadeRequest => Boolean(request));
};

export const addAuditEvent = async (
  subredditName: string,
  input: Omit<CascadeAuditEvent, 'id' | 'createdAt'>
) => {
  const event: CascadeAuditEvent = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: now(),
  };
  await redis.zAdd(auditIndexKey(subredditName), {
    member: JSON.stringify(event),
    score: event.createdAt,
  });
  await redis.zRemRangeByScore(
    auditIndexKey(subredditName),
    0,
    Date.now() - DATA_TTL_MS
  );
  return event;
};

export const getAuditEvents = async (subredditName: string) => {
  const events = await redis.zRange(
    auditIndexKey(subredditName),
    0,
    AUDIT_LIMIT - 1,
    {
      by: 'rank',
      reverse: true,
    }
  );
  return events
    .map((entry) => parseJson<CascadeAuditEvent>(entry.member))
    .filter((event): event is CascadeAuditEvent => Boolean(event));
};

export const getCascadeDashboard = async (
  subredditName: string
): Promise<CascadeDashboardData> => {
  const [links, requests, audit] = await Promise.all([
    getLinks(subredditName),
    getCascadeRequests(subredditName),
    getAuditEvents(subredditName),
  ]);

  return {
    subredditName,
    generatedAt: now(),
    links,
    requests,
    audit,
    totals: {
      linked: links.filter((link) => link.state === 'approved').length,
      pendingLinks: links.filter((link) => link.state === 'pending').length,
      pendingRequests: requests.filter((request) => request.state === 'pending')
        .length,
      failedRequests: requests.filter((request) => request.state === 'failed')
        .length,
    },
  };
};

const hideDashboardPostFromPublicFeed = async (
  post: Awaited<ReturnType<typeof reddit.getPostById>>
) => {
  try {
    if (!post.locked) {
      await post.lock();
    }
  } catch (error: unknown) {
    console.warn('Could not lock CascadeBan dashboard post.', error);
  }

  try {
    if (!post.removed) {
      await post.remove(false);
    }
  } catch (error: unknown) {
    console.warn('Could not remove CascadeBan dashboard post.', error);
  }
};

export const getOrCreateDashboardPost = async (subredditName: string) => {
  const key = dashboardPostKey(subredditName);
  const existingPostId = await redis.get(key);

  if (existingPostId) {
    try {
      const post = await reddit.getPostById(toPostThingId(existingPostId));
      await hideDashboardPostFromPublicFeed(post);
      return post;
    } catch {
      await redis.del(key);
    }
  }

  const post = await reddit.submitCustomPost({
    subredditName,
    title: DASHBOARD_POST_TITLE,
    entry: 'default',
    sendreplies: false,
    spoiler: true,
    postData: {
      kind: 'cascadeban-dashboard',
    },
    textFallback: {
      text: 'CascadeBan moderator dashboard.',
    },
  });

  await hideDashboardPostFromPublicFeed(post);
  await redis.set(key, post.id);
  return post;
};
