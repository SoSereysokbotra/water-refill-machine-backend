export interface AuditLogEntry {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

export interface AuditLoggerPort {
  record(entry: AuditLogEntry): Promise<void>;
}

export const AUDIT_LOGGER_PORT = Symbol('AUDIT_LOGGER_PORT');
