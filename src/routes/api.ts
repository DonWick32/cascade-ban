import { Hono } from 'hono';
import { context } from '@devvit/web/server';
import {
  approveCascadeRequest,
  approveLink,
  isCurrentUserModerator,
  rejectCascadeRequest,
  requestLink,
  setLinkState,
} from '../core/cascade';
import { getCascadeDashboard } from '../core/store';

export const api = new Hono();

const requireModerator = async (subredditName: string) => {
  if (!(await isCurrentUserModerator(subredditName))) {
    throw new Error('Moderator access required.');
  }
};

api.get('/dashboard', async (c) => {
  const subredditName = c.req.query('subredditName')?.trim() || context.subredditName;
  try {
    await requireModerator(subredditName);
    return c.json(await getCascadeDashboard(subredditName), 200);
  } catch (error: unknown) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error) },
      403
    );
  }
});

api.post('/link-request', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    targetSubreddit?: string;
  };
  if (!body.targetSubreddit?.trim()) {
    return c.json({ error: 'Missing targetSubreddit.' }, 400);
  }

  await requireModerator(context.subredditName);
  await requestLink(body.targetSubreddit);
  return c.json({ ok: true }, 200);
});

api.post('/link-approve', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    subredditName?: string;
  };
  if (!body.subredditName?.trim()) {
    return c.json({ error: 'Missing subredditName.' }, 400);
  }

  await requireModerator(context.subredditName);
  await approveLink(body.subredditName);
  return c.json({ ok: true }, 200);
});

api.post('/link-state', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    subredditName?: string;
    state?: 'approved' | 'paused' | 'rejected';
  };
  if (!body.subredditName?.trim() || !body.state) {
    return c.json({ error: 'Missing subredditName or state.' }, 400);
  }

  await requireModerator(context.subredditName);
  const link = await setLinkState(body.subredditName, body.state);
  return c.json({ link }, 200);
});

api.post('/request-approve', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { requestId?: string };
  if (!body.requestId?.trim()) {
    return c.json({ error: 'Missing requestId.' }, 400);
  }

  await requireModerator(context.subredditName);
  const request = await approveCascadeRequest(body.requestId);
  return c.json({ request }, 200);
});

api.post('/request-reject', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { requestId?: string };
  if (!body.requestId?.trim()) {
    return c.json({ error: 'Missing requestId.' }, 400);
  }

  await requireModerator(context.subredditName);
  const request = await rejectCascadeRequest(body.requestId);
  return c.json({ request }, 200);
});
