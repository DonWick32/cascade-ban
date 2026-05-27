import './styles.css';
import type {
  CascadeDashboardData,
  CascadeLink,
  CascadeRequest,
} from '../shared/dashboard';

type DevvitGlobal = {
  context?: {
    subredditName?: string;
  };
};

const devvitGlobal = (
  globalThis as typeof globalThis & { devvit?: DevvitGlobal }
).devvit;
const subredditName = devvitGlobal?.context?.subredditName ?? '';
const state: {
  dashboard?: CascadeDashboardData;
  filter: 'pending' | 'all';
} = {
  filter: 'pending',
};

const getElement = <T extends HTMLElement>(id: string) => {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
};

const elements = {
  subredditName: getElement('subredditName'),
  refreshButton: getElement<HTMLButtonElement>('refreshButton'),
  linkedCount: getElement('linkedCount'),
  pendingLinksCount: getElement('pendingLinksCount'),
  pendingRequestsCount: getElement('pendingRequestsCount'),
  failedRequestsCount: getElement('failedRequestsCount'),
  linkForm: getElement<HTMLFormElement>('linkForm'),
  linkInput: getElement<HTMLInputElement>('linkInput'),
  openLinksButton: getElement<HTMLButtonElement>('openLinksButton'),
  linkDialog: getElement<HTMLDialogElement>('linkDialog'),
  closeLinksButton: getElement<HTMLButtonElement>('closeLinksButton'),
  linkList: getElement('linkList'),
  requestList: getElement('requestList'),
  auditList: getElement('auditList'),
  pendingFilter: getElement<HTMLButtonElement>('pendingFilter'),
  allFilter: getElement<HTMLButtonElement>('allFilter'),
  statusLine: getElement('statusLine'),
};

const setText = (element: HTMLElement, text: string | number) => {
  element.textContent = String(text);
};

const formatRelativeTime = (time: number) => {
  const seconds = Math.max(1, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const apiPost = async (path: string, body: unknown) => {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(payload.error ?? `Request failed: ${response.status}`);
  }
};

const createButton = (
  label: string,
  onClick: () => Promise<void>,
  variant = ''
) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `action-button ${variant}`.trim();
  button.textContent = label;
  button.addEventListener('click', () => {
    button.disabled = true;
    void onClick()
      .then(loadDashboard)
      .catch((error: unknown) => {
        setText(
          elements.statusLine,
          error instanceof Error ? error.message : 'Action failed.'
        );
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  return button;
};

const createLinkNode = (link: CascadeLink) => {
  const row = document.createElement('article');
  row.className = `row row--${link.state}`;

  const main = document.createElement('div');
  main.className = 'row__main';

  const title = document.createElement('strong');
  title.textContent = `r/${link.subredditName}`;
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = `${link.state} · updated ${formatRelativeTime(link.updatedAt)}`;
  main.append(title, meta);

  const actions = document.createElement('div');
  actions.className = 'row__actions';

  if (link.state === 'pending') {
    actions.append(
      createButton('Approve', () =>
        apiPost('/api/link-approve', { subredditName: link.subredditName }),
        'action-button--blue'
      )
    );
  }

  if (link.state !== 'approved') {
    actions.append(
      createButton(link.state === 'paused' ? 'Resume' : 'Set active', () =>
        apiPost('/api/link-state', {
          subredditName: link.subredditName,
          state: 'approved',
        }),
        'action-button--pink'
      )
    );
  }

  if (link.state !== 'paused') {
    actions.append(
      createButton('Pause', () =>
        apiPost('/api/link-state', {
          subredditName: link.subredditName,
          state: 'paused',
        }),
        'action-button--pink'
      )
    );
  }

  row.append(main, actions);
  return row;
};

const createRequestNode = (request: CascadeRequest) => {
  const row = document.createElement('article');
  row.className = `row row--${request.state}`;

  const main = document.createElement('div');
  main.className = 'row__main';

  const title = document.createElement('strong');
  title.textContent = `${request.action.toUpperCase()} u/${request.username}`;
  
  const isIncoming = request.targetSubreddit.toLowerCase() === subredditName.toLowerCase();
  
  const meta = document.createElement('span');
  meta.className = 'meta';
  if (isIncoming) {
    meta.textContent = `${request.state} · from r/${request.originSubreddit} · ${request.source} · ${formatRelativeTime(request.updatedAt)}`;
  } else {
    meta.textContent = `${request.state} · sent to r/${request.targetSubreddit} · ${request.source} · ${formatRelativeTime(request.updatedAt)}`;
  }
  main.append(title, meta);

  if (request.lastError) {
    const error = document.createElement('span');
    error.className = 'error-text';
    error.textContent = request.lastError;
    main.append(error);
  }

  const actions = document.createElement('div');
  actions.className = 'row__actions';

  if (isIncoming && (request.state === 'pending' || request.state === 'failed')) {
    actions.append(
      createButton('Approve', () =>
        apiPost('/api/request-approve', { requestId: request.id }),
        'action-button--blue'
      ),
      createButton(
        'Reject',
        () => apiPost('/api/request-reject', { requestId: request.id }),
        'action-button--muted'
      )
    );
  }

  row.append(main, actions);
  return row;
};

const renderLinks = (dashboard: CascadeDashboardData) => {
  if (dashboard.links.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No linked subreddits yet.';
    elements.linkList.replaceChildren(empty);
    return;
  }

  elements.linkList.replaceChildren(...dashboard.links.map(createLinkNode));
};

const renderRequests = (dashboard: CascadeDashboardData) => {
  const requests =
    state.filter === 'pending'
      ? dashboard.requests.filter(
          (request) => request.state === 'pending' || request.state === 'failed'
        )
      : dashboard.requests;

  if (requests.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent =
      state.filter === 'pending'
        ? 'No pending cascade requests.'
        : 'No cascade requests stored yet.';
    elements.requestList.replaceChildren(empty);
    return;
  }

  elements.requestList.replaceChildren(...requests.map(createRequestNode));
};

const renderAudit = (dashboard: CascadeDashboardData) => {
  if (dashboard.audit.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No activity yet.';
    elements.auditList.replaceChildren(empty);
    return;
  }

  elements.auditList.replaceChildren(
    ...dashboard.audit.map((event) => {
      const item = document.createElement('div');
      item.className = 'audit-item';
      const message = document.createElement('span');
      message.textContent = event.message;
      const time = document.createElement('span');
      time.className = 'meta';
      time.textContent = formatRelativeTime(event.createdAt);
      item.append(message, time);
      return item;
    })
  );
};

const renderDashboard = (dashboard: CascadeDashboardData) => {
  setText(elements.subredditName, dashboard.subredditName);
  setText(elements.linkedCount, dashboard.totals.linked);
  setText(elements.pendingLinksCount, dashboard.totals.pendingLinks);
  setText(elements.pendingRequestsCount, dashboard.totals.pendingRequests);
  setText(elements.failedRequestsCount, dashboard.totals.failedRequests);
  renderLinks(dashboard);
  renderRequests(dashboard);
  renderAudit(dashboard);
  setText(
    elements.statusLine,
    `Updated ${new Date(dashboard.generatedAt).toLocaleTimeString()}`
  );
};

const loadDashboard = async () => {
  if (!subredditName) {
    setText(elements.statusLine, 'Subreddit context was not available.');
    return;
  }

  elements.refreshButton.disabled = true;
  try {
    const response = await fetch(
      `/api/dashboard?subredditName=${encodeURIComponent(subredditName)}`
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(body.error ?? `Dashboard failed: ${response.status}`);
    }
    state.dashboard = (await response.json()) as CascadeDashboardData;
    renderDashboard(state.dashboard);
  } catch (error: unknown) {
    setText(
      elements.statusLine,
      error instanceof Error ? error.message : 'Could not load dashboard.'
    );
  } finally {
    elements.refreshButton.disabled = false;
  }
};

const setFilter = (filter: 'pending' | 'all') => {
  state.filter = filter;
  elements.pendingFilter.classList.toggle(
    'segment--active',
    filter === 'pending'
  );
  elements.allFilter.classList.toggle('segment--active', filter === 'all');
  if (state.dashboard) {
    renderRequests(state.dashboard);
  }
};

const openLinksDialog = () => {
  if (!elements.linkDialog.open) {
    elements.linkDialog.showModal();
  }
};

const closeLinksDialog = () => {
  elements.linkDialog.close();
};

elements.refreshButton.addEventListener('click', () => {
  void loadDashboard();
});

elements.openLinksButton.addEventListener('click', openLinksDialog);
elements.closeLinksButton.addEventListener('click', closeLinksDialog);
elements.linkDialog.addEventListener('click', (event) => {
  if (event.target === elements.linkDialog) {
    closeLinksDialog();
  }
});

elements.pendingFilter.addEventListener('click', () => setFilter('pending'));
elements.allFilter.addEventListener('click', () => setFilter('all'));

elements.linkForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const targetSubreddit = elements.linkInput.value.trim();
  if (!targetSubreddit) {
    return;
  }
  elements.linkInput.disabled = true;
  void apiPost('/api/link-request', { targetSubreddit })
    .then(() => {
      elements.linkInput.value = '';
      return loadDashboard();
    })
    .catch((error: unknown) => {
      setText(
        elements.statusLine,
        error instanceof Error ? error.message : 'Could not request link.'
      );
    })
    .finally(() => {
      elements.linkInput.disabled = false;
    });
});

setText(elements.subredditName, subredditName || 'unknown');
void loadDashboard();
window.setInterval(() => {
  void loadDashboard();
}, 30_000);

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'devvit-message') {
    const msg = data.data?.message;
    if (msg?.type === 'initialData' || msg?.type === 'themeChange') {
      const theme = msg?.data?.theme || msg?.theme;
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else if (theme === 'light') {
        document.documentElement.classList.remove('dark');
      }
    }
  }
});
