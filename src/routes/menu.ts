import { Hono } from 'hono';
import { context } from '@devvit/web/server';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import type { FormField } from '@devvit/shared-types/shared/form.js';
import { getManualDefaults } from '../core/cascade';
import { getOrCreateDashboardPost } from '../core/store';

export const menu = new Hono();

const toRedditUrl = (permalink: string) =>
  permalink.startsWith('http')
    ? permalink
    : `https://www.reddit.com${permalink}`;

const modNoteOptions = [
  { label: 'Abuse Warning', value: 'ABUSE_WARNING' },
  { label: 'Spam Warning', value: 'SPAM_WARNING' },
  { label: 'Spam Watch', value: 'SPAM_WATCH' },
  { label: 'Solid Contributor', value: 'SOLID_CONTRIBUTOR' },
  { label: 'Helpful User', value: 'HELPFUL_USER' },
  { label: 'Ban', value: 'BAN' },
  { label: 'Bot Ban', value: 'BOT_BAN' },
  { label: 'Perma Ban', value: 'PERMA_BAN' },
];

const buildCascadeForm = async (targetId: string) => {
  const defaults = await getManualDefaults();
  const fields: FormField[] = [
    {
      name: 'targetId',
      label: 'Target ID',
      type: 'string',
      required: true,
      defaultValue: targetId,
    },
    {
      name: 'banUser',
      label: 'Ban user',
      type: 'boolean',
      defaultValue: true,
    },
    {
      name: 'duration',
      label: 'Duration in days',
      type: 'number',
      helpText: 'Use 0 for a permanent ban.',
      defaultValue: 0,
      required: true,
    },
    {
      name: 'reason',
      label: 'Additional info / ban mod note',
      type: 'string',
      defaultValue: '',
    },
    {
      name: 'userMessage',
      label: 'User message',
      type: 'paragraph',
      defaultValue: defaults.userMessage,
    },
    {
      name: 'banSubreddits',
      label: 'Additional ban subreddits',
      type: 'paragraph',
      helpText:
        'One subreddit per line. Approved linked subreddits are included automatically.',
      defaultValue: defaults.banSubreddits,
    },
    {
      name: 'addNote',
      label: 'Add mod note',
      type: 'boolean',
      defaultValue: false,
    },
    {
      name: 'modNoteLabel',
      label: 'Mod note label',
      type: 'select',
      options: modNoteOptions,
      defaultValue: [defaults.modNoteLabel],
    },
    {
      name: 'note',
      label: 'Mod note',
      type: 'paragraph',
      defaultValue: '',
    },
    {
      name: 'noteSubreddits',
      label: 'Additional mod note subreddits',
      type: 'paragraph',
      defaultValue: defaults.noteSubreddits,
    },
  ];

  return {
    title: 'Cascade Ban User',
    fields,
    acceptLabel: 'Run CascadeBan',
    cancelLabel: 'Cancel',
  };
};

menu.post('/open-dashboard', async () => {
  const post = await getOrCreateDashboardPost(context.subredditName);

  return new Response(
    JSON.stringify({
      navigateTo: toRedditUrl(post.permalink),
      showToast: {
        text: 'Opening CascadeBan dashboard.',
        appearance: 'success',
      },
    } satisfies UiResponse),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
});

menu.post('/cascade-user', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'cascadeUser',
        form: await buildCascadeForm(request.targetId),
      },
    },
    200
  );
});
