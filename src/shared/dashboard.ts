export type LinkState = 'pending' | 'approved' | 'paused' | 'rejected';

export type CascadeAction = 'ban' | 'unban';

export type CascadeRequestState =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'failed';

export type CascadeLink = {
  subredditName: string;
  state: LinkState;
  createdAt: number;
  updatedAt: number;
  requestedBy?: string | undefined;
};

export type CascadeRequest = {
  id: string;
  action: CascadeAction;
  username: string;
  originSubreddit: string;
  targetSubreddit: string;
  state: CascadeRequestState;
  source: 'native' | 'dashboard' | 'modmail' | 'manual';
  createdAt: number;
  updatedAt: number;
  requestedBy?: string | undefined;
  approvedBy?: string | undefined;
  note?: string | undefined;
  modmailConversationId?: string | undefined;
  lastError?: string | undefined;
};

export type CascadeAuditEvent = {
  id: string;
  createdAt: number;
  kind:
    | 'link-requested'
    | 'link-approved'
    | 'link-updated'
    | 'request-created'
    | 'request-approved'
    | 'request-rejected'
    | 'request-applied'
    | 'request-failed';
  actor?: string | undefined;
  message: string;
};

export type CascadeDashboardData = {
  subredditName: string;
  generatedAt: number;
  links: CascadeLink[];
  requests: CascadeRequest[];
  audit: CascadeAuditEvent[];
  totals: {
    linked: number;
    pendingLinks: number;
    pendingRequests: number;
    failedRequests: number;
  };
};
