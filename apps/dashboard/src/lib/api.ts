export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'operator' | 'viewer';
  totpEnabled: boolean;
}

export interface SalesSummaryItem {
  currency: 'USD' | 'KHR';
  totalPayments: number;
  dispensedCount: number;
  refundedCount: number;
  grossAmountMinor: number;
  refundedAmountMinor: number;
  netAmountMinor: number;
  totalVolumeMl: number;
}

export interface SalesReportRow {
  date?: string;
  machineId?: string;
  currency: 'USD' | 'KHR';
  totalPayments: number;
  dispensedCount: number;
  refundedCount: number;
  grossAmountMinor: number;
  refundedAmountMinor: number;
  netAmountMinor: number;
  totalVolumeMl: number;
}

export interface SalesReportResponse {
  summary: {
    usd: SalesSummaryItem;
    khr: SalesSummaryItem;
  };
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
  rows: SalesReportRow[];
}

export interface MachineStatusRow {
  id: string;
  name: string;
  location: string | null;
  enabled: boolean;
  currency: string;
  online: boolean;
  lastSeenAt: string | null;
  pendingOutcomes: number;
  pendingOutcomesSince: string | null;
  lastStm32State: string | null;
  decommissionedAt: string | null;
  activeAlertsCount: number;
}

export interface RefundCaseItem {
  tranId: string;
  machineId: string;
  amountMinor: number;
  currency: string;
  refundStatus: 'open' | 'claimed' | 'refunded' | 'rejected' | 'auto_failed';
  refundReason: string;
  suggestedAmountMinor: number;
  refundedAmountMinor: number | null;
  claimantId: string | null;
  /** claim expiry (refund_cases.claimed_until) */
  expiresAt: string | null;
  decisionReason: string | null;
  machineOnline: boolean;
  machinePendingOutcomes: number;
  lastStm32State: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RefundsReportResponse {
  summary: {
    statusCounts: {
      open: number;
      claimed: number;
      refunded: number;
      rejected: number;
      autoFailed: number;
      total: number;
    };
    amounts: {
      usd: {
        pendingMinor: number;
        refundedMinor: number;
      };
      khr: {
        pendingMinor: number;
        refundedMinor: number;
      };
    };
  };
  items: RefundCaseItem[];
}

export interface AlertItem {
  id: string;
  type: string;
  severity: 'critical' | 'warning' | 'info';
  status: 'active' | 'ack' | 'resolved';
  machineId: string;
  data: Record<string, unknown>;
  createdAt: string;
  ackAt: string | null;
  resolvedAt: string | null;
}

export interface MachineItem {
  id: string;
  name: string;
  location: string | null;
  enabled: boolean;
  currency: string;
  pricesMinor: Record<number, number> | null;
  mqttUsername: string;
  online: boolean;
  lastSeenAt: string | null;
  pendingOutcomes: number;
  lastStm32State: string | null;
  decommissionedAt: string | null;
  createdAt: string;
}

export interface PaymentDetail {
  tranId: string;
  machineId: string;
  amountMinor: number;
  currency: string;
  volumeMl: number;
  status: string;
  paidAt: string | null;
  refundedAmountMinor: number | null;
  events?: Array<{
    id: string;
    fromStatus: string;
    toStatus: string;
    reason: string | null;
    at: string;
  }>;
}

const API_BASE = '/v1';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    let errMessage = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body.error?.message) {
        errMessage = body.error.message;
      }
    } catch {
      // fallback
    }
    throw new Error(errMessage);
  }

  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  async login(body: { email: string; password: string; totpCode?: string }) {
    return request<{ data: { user: User; expiresAt: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async logout() {
    return request<{ data: { success: boolean } }>('/auth/logout', { method: 'POST' });
  },
  async getMe() {
    return request<{ data: User }>('/auth/me');
  },

  // Reports
  async getSalesReport(params: {
    from?: string;
    to?: string;
    machineId?: string;
    groupBy?: 'day' | 'machine';
    limit?: number;
    offset?: number;
  } = {}) {
    const q = new URLSearchParams();
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    if (params.machineId) q.set('machineId', params.machineId);
    if (params.groupBy) q.set('groupBy', params.groupBy);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.offset) q.set('offset', String(params.offset));
    return request<{ data: SalesReportResponse }>(`/reports/sales?${q.toString()}`);
  },

  async downloadSalesCsv(params: {
    from?: string;
    to?: string;
    machineId?: string;
    groupBy?: 'day' | 'machine';
  } = {}) {
    const q = new URLSearchParams();
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    if (params.machineId) q.set('machineId', params.machineId);
    if (params.groupBy) q.set('groupBy', params.groupBy);
    q.set('format', 'csv');

    const res = await fetch(`${API_BASE}/reports/sales?${q.toString()}`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Failed to download CSV');
    return res.text();
  },

  async getFleetStatus() {
    return request<{ data: MachineStatusRow[] }>('/reports/machines/status');
  },

  async getRefundsReport(status?: string) {
    const q = status ? `?status=${status}` : '';
    return request<{ data: RefundsReportResponse }>(`/reports/refunds${q}`);
  },

  async refreshViews() {
    return request<{ data: { refreshed: boolean } }>('/reports/refresh', { method: 'POST' });
  },

  // Machines
  async listMachines() {
    return request<{ data: MachineItem[] }>('/machines');
  },
  async provisionMachine(body: {
    id: string;
    name: string;
    location?: string;
    currency: 'USD' | 'KHR';
    prices: { 500: number; 750: number; 1000: number };
  }) {
    return request<{ data: { machine: MachineItem; mqttCredentials: { username: string; password: string } } }>(
      '/machines',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
  },
  async updatePrices(
    id: string,
    prices: { 500: number; 750: number; 1000: number },
  ) {
    return request<{ data: MachineItem }>(`/machines/${id}/prices`, {
      method: 'PUT',
      body: JSON.stringify({ prices }),
    });
  },
  async toggleMachine(id: string, enabled: boolean) {
    return request<{ data: MachineItem }>(`/machines/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  },
  async rotateCredentials(id: string) {
    return request<{ data: { mqttCredentials: { username: string; password: string } } }>(
      `/machines/${id}/rotate-credentials`,
      { method: 'POST' },
    );
  },
  async decommissionMachine(id: string) {
    return request<{ data: MachineItem }>(`/machines/${id}/decommission`, { method: 'POST' });
  },

  // Refund Cases
  async listRefundCases(status?: string) {
    const q = status ? `?status=${status}` : '';
    return request<{ data: RefundCaseItem[] }>(`/refund-cases${q}`);
  },
  async getRefundCase(tranId: string) {
    return request<{ data: RefundCaseItem }>(`/refund-cases/${tranId}`);
  },
  // The claim lasts REFUND_CLAIM_MINUTES (server config); the operator comes from the session.
  async claimRefund(tranId: string) {
    return request<{ data: { status: 'claimed'; claimedUntil: string } }>(
      `/refund-cases/${tranId}/claim`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
    );
  },
  async markRefunded(
    tranId: string,
    body: { method: string; reference: string; amountMinor: number; adminOverrideReason?: string },
  ) {
    return request<{ data: unknown }>(`/refund-cases/${tranId}/mark-refunded`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async rejectRefund(tranId: string, reason: string) {
    return request<{ data: unknown }>(`/refund-cases/${tranId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },
  async reopenRefund(tranId: string, reason: string) {
    return request<{ data: unknown }>(`/refund-cases/${tranId}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  // Payments
  async getPayment(tranId: string) {
    return request<{ data: PaymentDetail }>(`/payments/${tranId}`);
  },
  async resolveUnknownDispense(
    tranId: string,
    body: { resolution: 'dispensed' | 'refund'; reason: string; adminOverrideReason?: string },
  ) {
    return request<{ data: unknown }>(`/payments/${tranId}/resolve-unknown`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  // Alerts
  async listAlerts(status?: string) {
    const q = status ? `?status=${status}` : '';
    return request<{ data: AlertItem[] }>(`/alerts${q}`);
  },
  async ackAlert(id: string) {
    return request<{ data: AlertItem }>(`/alerts/${id}/ack`, { method: 'POST' });
  },
  async resolveAlert(id: string) {
    return request<{ data: AlertItem }>(`/alerts/${id}/resolve`, { method: 'POST' });
  },

  // Users & Audit Logs
  async listUsers() {
    return request<{ data: User[] }>('/users');
  },
  async createUser(body: { email: string; name: string; password: string; role: 'admin' | 'operator' | 'viewer' }) {
    return request<{ data: User }>('/users', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async updateUser(id: string, body: { role?: 'admin' | 'operator' | 'viewer'; active?: boolean }) {
    return request<{ data: User }>(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
  async listAuditLogs(params: { entityType?: string; limit?: number } = {}) {
    const q = new URLSearchParams();
    if (params.entityType) q.set('entityType', params.entityType);
    if (params.limit) q.set('limit', String(params.limit));
    return request<{ data: unknown[] }>(`/audit-logs?${q.toString()}`);
  },
};
