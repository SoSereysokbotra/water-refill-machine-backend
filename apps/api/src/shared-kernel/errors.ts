import { ErrorCode, ERROR_CODES } from '@wrm/contracts';

export abstract class BaseError extends Error {
  abstract readonly code: ErrorCode;
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DomainError extends BaseError {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    details?: unknown,
  ) {
    super(message ?? code, details);
  }
}

export class NotFoundError extends BaseError {
  readonly code: ErrorCode;
  constructor(code: ErrorCode = ERROR_CODES.PAY_NOT_FOUND, message?: string, details?: unknown) {
    super(message ?? code, details);
    this.code = code;
  }
}

export class ConflictError extends BaseError {
  readonly code: ErrorCode;
  constructor(code: ErrorCode = ERROR_CODES.CONCURRENCY_CONFLICT, message?: string, details?: unknown) {
    super(message ?? code, details);
    this.code = code;
  }
}

export class ValidationError extends BaseError {
  readonly code = ERROR_CODES.VALIDATION_FAILED;
  constructor(message = 'Validation failed', details?: unknown) {
    super(message, details);
  }
}

export class RateLimitError extends BaseError {
  readonly code = ERROR_CODES.RATE_LIMITED;
  constructor(message = 'Rate limit exceeded', details?: unknown) {
    super(message, details);
  }
}

export class InfrastructureError extends BaseError {
  constructor(
    public readonly code: ErrorCode = ERROR_CODES.INTERNAL_ERROR,
    message = 'Infrastructure dependency error',
    details?: unknown,
  ) {
    super(message, details);
  }
}

export function toErrorCode(error: unknown): ErrorCode {
  if (error instanceof BaseError) {
    return error.code;
  }
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
    const candidate = (error as { code: string }).code;
    if (Object.values(ERROR_CODES).includes(candidate as ErrorCode)) {
      return candidate as ErrorCode;
    }
  }
  return ERROR_CODES.INTERNAL_ERROR;
}
