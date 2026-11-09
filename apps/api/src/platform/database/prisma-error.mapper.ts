import { Prisma } from '@prisma/client';
import { ConflictError, NotFoundError, InfrastructureError } from '../../shared-kernel/errors';
import { ERROR_CODES } from '@wrm/contracts';

export function mapPrismaError(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const target = (error.meta?.target as string[])?.join(', ') ?? 'unique constraint';
      return new ConflictError(
        ERROR_CODES.CONCURRENCY_CONFLICT,
        `Unique constraint violation on field(s): ${target}`,
        error.meta,
      );
    }
    if (error.code === 'P2034') {
      return new ConflictError(
        ERROR_CODES.CONCURRENCY_CONFLICT,
        'Transaction write conflict',
        error.meta,
      );
    }
    if (error.code === 'P2025') {
      return new NotFoundError(
        ERROR_CODES.PAY_NOT_FOUND,
        (error.meta?.cause as string) ?? 'Record not found',
        error.meta,
      );
    }
  }

  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return new InfrastructureError(
      ERROR_CODES.INTERNAL_ERROR,
      'Database connection or infrastructure error',
      error,
    );
  }

  return error;
}
