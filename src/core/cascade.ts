import { context, reddit, redis, settings } from '@devvit/web/server';
import { isT1, isT3 } from '@devvit/shared-types/tid.js';
import {
  addAuditEvent,
  createCascadeRequest,
  findPendingRequest,
  getApprovedLinkedSubreddits,
  getCascadeRequest,
  updateCascadeRequestState,
  upsertLink,
} from './store';
import type { CascadeAction, CascadeRequest } from '../shared/dashboard';

type ManualCascadeInput = {
  targetId: string;
  banUser: boolean;
  addNote: boolean;
  duration: number;
  reason: string;
  userMessage: string;
  banSubreddits: string;
  note: string;
  noteSubreddits: string;
  modNoteLabel: string;
};

type ModActionEvent = {
  action?: string;
  targetUser?: { name?: string };
  moderator?: { name?: string };
  subreddit?: { name?: string };
};

const markAppAction = async (subredditName: string, action: string, username: string) => {
  const key = `cascade:ignore:${subredditName.toLowerCase()}:${action}:${username.toLowerCase()}`;
  await redis.set(key, '1', { expiration: new Date(Date.now() + 60000) });
};

const consumeAppAction = async (subredditName: string, action: string, username: string) => {
  const key = `cascade:ignore:${subredditName.toLowerCase()}:${action}:${username.toLowerCase()}`;
  const val = await redis.get(key);
  if (val) {
    await redis.del(key);
    return true;
  }
  return false;
};

const normalizeSubredditName = (value: string) =>
  value.trim().replace(/^r\//i, '').toLowerCase();

const normalizeUsername = (value: string) =>
  value.trim().replace(/^u\//i, '');

const linesToSubreddits = (value: string) =>
  Array.from(
    new Set(
      value
        .split(/\r?\n|,/)
        .map(normalizeSubredditName)
        .filter(Boolean)
    )
  );

const getCurrentModerator = async () =>
  (await reddit.getCurrentUsername().catch(() => undefined)) ?? undefined;

const isCurrentUserModerator = async (subredditName: string) => {
  const username = await getCurrentModerator();
  if (!username) {
    return false;
  }

  const moderators = await reddit
    .getModerators({
      subredditName,
      username,
      limit: 1,
    })
    .all();

  return moderators.some(
    (moderator) => moderator.username.toLowerCase() === username.toLowerCase()
  );
};

const getTargetFromThing = async (targetId: string) => {
  if (isT1(targetId)) {
    const comment = await reddit.getCommentById(targetId);
    const post = await reddit.getPostById(comment.postId);
    return {
      targetId,
      authorName: comment.authorName,
      contextId: comment.id,
      sourceSubreddit: comment.subredditName,
      body: comment.body ?? '',
      title: post.title,
      url: `https://www.reddit.com/r/${comment.subredditName}/comments/${comment.postId.split('_')[1]}/_/${comment.id.split('_')[1]}`,
    };
  }

  if (isT3(targetId)) {
    const post = await reddit.getPostById(targetId);
    return {
      targetId,
      authorName: post.authorName,
      contextId: post.id,
      sourceSubreddit: post.subredditName,
      body: post.body ?? '',
      title: post.title,
      url: `https://redd.it/${post.id.split('_')[1]}`,
    };
  }

  throw new Error('Unsupported target. Use this action from a post or comment.');
};

const replaceTokens = (
  template: string,
  target: Awaited<ReturnType<typeof getTargetFromThing>>,
  remoteSubreddit: string,
  moderator?: string
) =>
  (template ?? '')
    .replace(/(u\/)?\{\{actioningMod}}/g, moderator ? `u/${moderator}` : 'a moderator')
    .replace(/(u\/)?\{\{author}}/g, `u/${target.authorName}`)
    .replace(/\{\{body}}/g, target.body)
    .replace(/\{\{kind}}/g, isT1(target.targetId) ? 'comment' : 'post')
    .replace(/(r\/)?\{\{originSubreddit}}/g, `r/${target.sourceSubreddit}`)
    .replace(/(r\/)?\{\{subreddit}}/g, `r/${remoteSubreddit}`)
    .replace(/\{\{title}}/g, target.title)
    .replace(/\{\{url}}/g, target.url);

export const requestLink = async (targetSubreddit: string) => {
  const origin = context.subredditName;
  const target = normalizeSubredditName(targetSubreddit);
  const actor = await getCurrentModerator();
  await upsertLink({
    subredditName: origin,
    targetSubreddit: target,
    state: 'pending',
    actor,
  });

  await reddit.modMail.createConversation({
    subredditName: target,
    subject: `Cluster Link Request from r/${origin}`,
    body: `[SYSTEM: LINK_REQUESTED] r/${origin}\n\nThe subreddit r/${origin} wants to link with you for CascadeBan.\n\nYou can approve this in the CascadeBan dashboard, or reply with:\n\n!approve-link r/${origin}`,
    to: '',
  });
};

export const approveLink = async (requestingSubreddit: string) => {
  const current = context.subredditName;
  const requester = normalizeSubredditName(requestingSubreddit);
  const actor = await getCurrentModerator();
  await upsertLink({
    subredditName: current,
    targetSubreddit: requester,
    state: 'approved',
    actor,
  });

  await reddit.modMail.createConversation({
    subredditName: requester,
    subject: `Cluster Link Approved by r/${current}`,
    body: `[SYSTEM: LINK_ACCEPTED] r/${current}`,
    to: '',
  });
};

export const setLinkState = async (
  targetSubreddit: string,
  state: 'approved' | 'paused' | 'rejected'
) =>
  upsertLink({
    subredditName: context.subredditName,
    targetSubreddit,
    state,
    actor: await getCurrentModerator(),
  });

export const createRemoteRequests = async ({
  action,
  username,
  originSubreddit,
  source,
  requestedBy,
  note,
}: {
  action: CascadeAction;
  username: string;
  originSubreddit: string;
  source: CascadeRequest['source'];
  requestedBy?: string | undefined;
  note?: string | undefined;
}) => {
  const linkedSubs = await getApprovedLinkedSubreddits(originSubreddit);
  const requests: CascadeRequest[] = [];

  for (const targetSubreddit of linkedSubs) {
    try {
      const request = await createCascadeRequest({
        action,
        username: normalizeUsername(username),
        originSubreddit,
        targetSubreddit,
        source,
        requestedBy,
        note,
      });
      requests.push(request);

      const payload = JSON.stringify(request);
      await reddit.modMail.createConversation({
        subredditName: targetSubreddit,
        subject: `Cascade ${action === 'ban' ? 'Ban' : 'Unban'} Request: u/${request.username}`,
        body: `[SYSTEM: CASCADE_REQUEST] ${payload}\n\nu/${request.username} was ${action === 'ban' ? 'banned' : 'unbanned'} in r/${originSubreddit}.\n\nApprove it in the CascadeBan dashboard, or reply with:\n\n!approve-${action} u/${request.username}`,
        to: '',
      });
    } catch (error: unknown) {
      await addAuditEvent(originSubreddit, {
        kind: 'request-failed',
        actor: requestedBy,
        message: `Could not send ${action} request for u/${username} to r/${targetSubreddit}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  return requests;
};

import type { CascadeRequestState } from '../shared/dashboard';

const notifyRequestUpdate = async (request: CascadeRequest, state: CascadeRequestState, error?: string) => {
  if (request.originSubreddit && request.originSubreddit !== 'unknown') {
    const payload = JSON.stringify({ id: request.id, state, error });
    try {
      await reddit.modMail.createConversation({
        subredditName: request.originSubreddit,
        subject: `Cascade Request ${state.toUpperCase()}: u/${request.username}`,
        body: `[SYSTEM: REQUEST_UPDATED] ${payload}\n\nThe cascade request for u/${request.username} was updated to ${state}.`,
        to: '',
      });
    } catch (e) {
      console.warn('Failed to notify origin subreddit of request update', e);
    }
  }
};

const applyRequest = async (request: CascadeRequest, actor?: string) => {
  try {
    await markAppAction(request.targetSubreddit, request.action, request.username);

    if (request.action === 'ban') {
      const banOptions = {
        subredditName: request.targetSubreddit,
        username: request.username,
        reason: `CascadeBan request from r/${request.originSubreddit}`,
        message: 'You have been banned via the CascadeBan network.',
        note: request.note ?? `Approved cascade ban from r/${request.originSubreddit}.`,
      };
      await reddit.banUser(banOptions);
    } else {
      await reddit.unbanUser(request.username, request.targetSubreddit);
    }

    const updated = await updateCascadeRequestState(
      request.targetSubreddit,
      request.id,
      'applied',
      { approvedBy: actor }
    );
    if (updated) {
      await notifyRequestUpdate(updated, 'applied');
    }
    await addAuditEvent(request.targetSubreddit, {
      kind: 'request-applied',
      actor,
      message: `${request.action} applied to u/${request.username} from r/${request.originSubreddit}.`,
    });
    return updated;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await updateCascadeRequestState(
      request.targetSubreddit,
      request.id,
      'failed',
      { approvedBy: actor, lastError: message }
    );
    if (failed) {
      await notifyRequestUpdate(failed, 'failed', message);
    }
    await addAuditEvent(request.targetSubreddit, {
      kind: 'request-failed',
      actor,
      message: `${request.action} failed for u/${request.username}: ${message}`,
    });
    return failed;
  }
};

export const approveCascadeRequest = async (requestId: string) => {
  const subredditName = context.subredditName;
  const actor = await getCurrentModerator();
  const request = await getCascadeRequest(subredditName, requestId);
  if (!request) {
    throw new Error('Request not found.');
  }

  await updateCascadeRequestState(subredditName, requestId, 'approved', {
    approvedBy: actor,
  });
  await addAuditEvent(subredditName, {
    kind: 'request-approved',
    actor,
    message: `${request.action} approved for u/${request.username}.`,
  });
  return applyRequest({ ...request, state: 'approved' }, actor);
};

export const rejectCascadeRequest = async (requestId: string) => {
  const subredditName = context.subredditName;
  const actor = await getCurrentModerator();
  const updated = await updateCascadeRequestState(subredditName, requestId, 'rejected', {
    approvedBy: actor,
  });
  if (!updated) {
    throw new Error('Request not found.');
  }
  await notifyRequestUpdate(updated, 'rejected');
  await addAuditEvent(subredditName, {
    kind: 'request-rejected',
    actor,
    message: `${updated.action} rejected for u/${updated.username}.`,
  });
  return updated;
};

export const approvePendingRequestFromModmail = async (
  action: CascadeAction,
  username: string
) => {
  const subredditName = context.subredditName;
  const pending = await findPendingRequest(
    subredditName,
    action,
    normalizeUsername(username)
  );
  const request =
    pending ??
    (await createCascadeRequest({
      action,
      username: normalizeUsername(username),
      originSubreddit: 'unknown',
      targetSubreddit: subredditName,
      source: 'modmail',
      requestedBy: 'modmail',
    }));

  return approveCascadeRequest(request.id);
};

export const handleNativeModAction = async (event: ModActionEvent) => {
  const action =
    event.action === 'banuser'
      ? 'ban'
      : event.action === 'unbanuser'
        ? 'unban'
        : undefined;
  const username = event.targetUser?.name;

  if (!action || !username) {
    return;
  }

  const originSubreddit =
    event.subreddit?.name ?? context.subredditName ?? (await reddit.getCurrentSubreddit()).name;

  if (await consumeAppAction(originSubreddit, action, username)) {
    console.log(`Ignoring cascaded mod action ${action} for ${username} in ${originSubreddit}`);
    return;
  }

  await createRemoteRequests({
    action,
    username,
    originSubreddit,
    source: 'native',
    requestedBy: event.moderator?.name,
  });
};

export const runManualCascade = async (input: ManualCascadeInput) => {
  const target = await getTargetFromThing(input.targetId);
  const actor = await getCurrentModerator();
  const currentSubreddit = context.subredditName;
  const linkedSubreddits = await getApprovedLinkedSubreddits(currentSubreddit);
  const banSubreddits = Array.from(
    new Set([
      currentSubreddit.toLowerCase(),
      ...linkedSubreddits,
      ...linesToSubreddits(input.banSubreddits),
    ])
  );
  const noteSubreddits = Array.from(
    new Set([
      currentSubreddit.toLowerCase(),
      ...linesToSubreddits(input.noteSubreddits),
    ])
  );
  let bans = 0;
  let notes = 0;

  if (input.banUser) {
    for (const subredditName of banSubreddits) {
      await markAppAction(subredditName, 'ban', target.authorName);

      const banOptions = {
        context: target.contextId,
        subredditName,
        username: target.authorName,
        reason: `CascadeBan manual action by u/${actor ?? 'unknown'} from r/${currentSubreddit}`,
        message: replaceTokens(input.userMessage, target, subredditName, actor),
        note: replaceTokens(input.reason, target, subredditName, actor),
        ...(input.duration > 0 ? { duration: input.duration } : {}),
      };
      await reddit.banUser(banOptions);
      bans += 1;
    }

  }

  if (input.addNote && input.note.trim()) {
    for (const subredditName of noteSubreddits) {
      const noteOptions = {
        label: input.modNoteLabel as never,
        note: replaceTokens(input.note, target, subredditName, actor),
        subreddit: subredditName,
        user: target.authorName,
        ...(subredditName === currentSubreddit.toLowerCase()
          ? { redditId: target.targetId }
          : {}),
      };
      await reddit.addModNote(noteOptions);
      notes += 1;
    }
  }

  return { bans, notes };
};

export const getManualDefaults = async () => ({
  banSubreddits:
    ((await settings.get<string>('otherSubreddits')) ?? '').trim() ||
    (await getApprovedLinkedSubreddits(context.subredditName)).join('\n'),
  noteSubreddits: (await settings.get<string>('otherNoteSubreddits')) ?? '',
  userMessage: (await settings.get<string>('defaultUserMessage')) ?? '',
  modNoteLabel:
    ((await settings.get<string[]>('defaultModNoteLabel')) ?? ['ABUSE_WARNING'])[0] ??
    'ABUSE_WARNING',
});

export { isCurrentUserModerator };
