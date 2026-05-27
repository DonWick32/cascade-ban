import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { runManualCascade } from '../core/cascade';

type CascadeUserFormValues = {
  targetId?: string;
  banUser?: boolean;
  addNote?: boolean;
  duration?: number;
  reason?: string;
  userMessage?: string;
  banSubreddits?: string;
  note?: string;
  noteSubreddits?: string;
  modNoteLabel?: string[] | string;
};

export const forms = new Hono();

const firstSelectValue = (value: string[] | string | undefined) =>
  Array.isArray(value) ? value[0] : value;

forms.post('/cascade-user-submit', async (c) => {
  try {
    const values = await c.req.json<CascadeUserFormValues>();
    const targetId = values.targetId?.trim();
    if (!targetId) {
      return c.json<UiResponse>({ showToast: 'CascadeBan failed: missing target.' }, 200);
    }

    if (!values.banUser && !values.addNote) {
      return c.json<UiResponse>({ showToast: 'Nothing to do.' }, 200);
    }

    if (values.addNote && !values.note?.trim()) {
      return c.json<UiResponse>(
        { showToast: 'Mod note text is required when Add mod note is enabled.' },
        200
      );
    }

    const result = await runManualCascade({
      targetId,
      banUser: Boolean(values.banUser),
      addNote: Boolean(values.addNote),
      duration: Number(values.duration ?? 0),
      reason: values.reason ?? '',
      userMessage: values.userMessage ?? '',
      banSubreddits: values.banSubreddits ?? '',
      note: values.note ?? '',
      noteSubreddits: values.noteSubreddits ?? '',
      modNoteLabel: firstSelectValue(values.modNoteLabel) ?? 'ABUSE_WARNING',
    });

    return c.json<UiResponse>(
      {
        showToast: `CascadeBan finished: ${result.bans} bans, ${result.notes} notes.`,
      },
      200
    );
  } catch (error: unknown) {
    return c.json<UiResponse>(
      {
        showToast: `CascadeBan failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      200
    );
  }
});
