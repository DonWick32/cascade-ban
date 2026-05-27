import { Hono } from 'hono';
import type { TriggerResponse } from '@devvit/web/shared';
import { context, reddit } from '@devvit/web/server';
import {
  approveLink,
  approvePendingRequestFromModmail,
  handleNativeModAction,
} from '../core/cascade';
import { upsertLink, saveCascadeRequest, updateCascadeRequestState } from '../core/store';

export const triggers = new Hono();

type ModMailEvent = {
  conversationId?: string;
  messageId?: string;
};

const getConversationMessageBody = async (event: ModMailEvent) => {
  if (!event.conversationId) {
    return '';
  }

  const conversation = await reddit.modMail.getConversation({
    conversationId: event.conversationId,
  });
  const messages = conversation.conversation?.messages
    ? Object.values(conversation.conversation.messages)
    : [];
  const message =
    messages.find((item) => item.id === event.messageId) ??
    messages[messages.length - 1];

  return message?.bodyMarkdown || message?.body || '';
};

const commandValue = (body: string, command: string) => {
  const normalized = body.trim();
  if (!normalized.toLowerCase().startsWith(command.toLowerCase())) {
    return undefined;
  }

  return normalized.slice(command.length).trim().split(/\s+/)[0];
};

const getSystemCommandPayload = (body: string, command: string) => {
  for (const line of body.split(/\r?\n/)) {
    const normalized = line.trim();
    if (normalized.toLowerCase().startsWith(command.toLowerCase())) {
      return normalized.slice(command.length).trim();
    }
  }
  return undefined;
};

triggers.post('/on-app-install', async () =>
  new Response(JSON.stringify({} satisfies TriggerResponse), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
);

triggers.post('/on-mod-action', async (c) => {
  const event = await c.req.json();
  await handleNativeModAction(event);
  return c.json<TriggerResponse>({}, 200);
});

triggers.post('/on-modmail', async (c) => {
  const event = await c.req.json<ModMailEvent>();
  const body = await getConversationMessageBody(event);

  const linkTarget = commandValue(body, '!link r/');
  if (linkTarget) {
    const currentSubreddit = context.subredditName;
    await upsertLink({
      subredditName: currentSubreddit,
      targetSubreddit: linkTarget,
      state: 'pending',
      actor: 'modmail',
    });
    await reddit.modMail.createConversation({
      subredditName: linkTarget,
      subject: `Cluster Link Request from r/${currentSubreddit}`,
      body: `[SYSTEM: LINK_REQUESTED] r/${currentSubreddit}\n\nThe subreddit r/${currentSubreddit} wants to link with you for CascadeBan.\n\nApprove it in the CascadeBan dashboard, or reply with:\n\n!approve-link r/${currentSubreddit}`,
      to: '',
    });
    return c.json<TriggerResponse>({}, 200);
  }

  const requestedLink = commandValue(body, '[SYSTEM: LINK_REQUESTED] r/');
  if (requestedLink) {
    await upsertLink({
      subredditName: context.subredditName,
      targetSubreddit: requestedLink,
      state: 'pending',
      actor: 'system',
    });
    return c.json<TriggerResponse>({}, 200);
  }

  const approveLinkTarget = commandValue(body, '!approve-link r/');
  if (approveLinkTarget) {
    await approveLink(approveLinkTarget);
    return c.json<TriggerResponse>({}, 200);
  }

  const acceptedLink = commandValue(body, '[SYSTEM: LINK_ACCEPTED] r/');
  if (acceptedLink) {
    await upsertLink({
      subredditName: context.subredditName,
      targetSubreddit: acceptedLink,
      state: 'approved',
      actor: 'modmail',
    });
    return c.json<TriggerResponse>({}, 200);
  }

  const approveBanUser = commandValue(body, '!approve-ban u/');
  if (approveBanUser) {
    await approvePendingRequestFromModmail('ban', approveBanUser);
    return c.json<TriggerResponse>({}, 200);
  }

  const approveUnbanUser = commandValue(body, '!approve-unban u/');
  if (approveUnbanUser) {
    await approvePendingRequestFromModmail('unban', approveUnbanUser);
    return c.json<TriggerResponse>({}, 200);
  }

  const cascadeRequestPayload = getSystemCommandPayload(body, '[SYSTEM: CASCADE_REQUEST]');
  if (cascadeRequestPayload) {
    try {
      const request = JSON.parse(cascadeRequestPayload);
      await saveCascadeRequest(request);
    } catch (e) {
      console.error('Failed to parse CASCADE_REQUEST payload', e);
    }
    return c.json<TriggerResponse>({}, 200);
  }

  const updatePayload = getSystemCommandPayload(body, '[SYSTEM: REQUEST_UPDATED]');
  if (updatePayload) {
    try {
      const data = JSON.parse(updatePayload);
      await updateCascadeRequestState(context.subredditName, data.id, data.state, { lastError: data.error });
    } catch (e) {
      console.error('Failed to parse REQUEST_UPDATED payload', e);
    }
    return c.json<TriggerResponse>({}, 200);
  }

  return c.json<TriggerResponse>({}, 200);
});
