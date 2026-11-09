import { describe, it, expect } from 'vitest';
import {
  DomainError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitError,
  InfrastructureError,
  toErrorCode,
} from '../src/shared-kernel/errors';
import { ERROR_CODES } from '@wrm/contracts';

describe('Error Taxonomy & toErrorCode', () => {
  it('correctly maps DomainError codes', () => {
    const err = new DomainError(ERROR_CODES.PAY_MACHINE_BUSY, 'Machine is busy');
    expect(err.code).toBe(ERROR_CODES.PAY_MACHINE_BUSY);
    expect(toErrorCode(err)).toBe(ERROR_CODES.PAY_MACHINE_BUSY);
  });

  it('correctly maps NotFoundError and ConflictError default codes', () => {
    const notFound = new NotFoundError();
    expect(notFound.code).toBe(ERROR_CODES.PAY_NOT_FOUND);
    expect(toErrorCode(notFound)).toBe(ERROR_CODES.PAY_NOT_FOUND);

    const conflict = new ConflictError();
    expect(conflict.code).toBe(ERROR_CODES.CONCURRENCY_CONFLICT);
    expect(toErrorCode(conflict)).toBe(ERROR_CODES.CONCURRENCY_CONFLICT);
  });

  it('correctly maps ValidationError and RateLimitError', () => {
    const validation = new ValidationError('Invalid request payload');
    expect(validation.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(toErrorCode(validation)).toBe(ERROR_CODES.VALIDATION_FAILED);

    const rateLimit = new RateLimitError('Too many requests');
    expect(rateLimit.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(toErrorCode(rateLimit)).toBe(ERROR_CODES.RATE_LIMITED);

    const infra = new InfrastructureError();
    expect(infra.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(toErrorCode(infra)).toBe(ERROR_CODES.INTERNAL_ERROR);
  });

  it('falls back to INTERNAL_ERROR for unknown generic errors', () => {
    const generic = new Error('Something broke');
    expect(toErrorCode(generic)).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(toErrorCode(null)).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(toErrorCode(undefined)).toBe(ERROR_CODES.INTERNAL_ERROR);
  });
});
