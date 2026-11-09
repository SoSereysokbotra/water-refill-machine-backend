import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Prisma } from '@prisma/client';
import { mapPrismaError } from './prisma-error.mapper';
import { ConflictError } from '../../shared-kernel/errors';

export type PrismaTransaction = Prisma.TransactionClient;

export interface UnitOfWorkOptions {
  attempts?: number;
  retryOn?: unknown[];
}

@Injectable()
export class UnitOfWork {
  private readonly logger = new Logger(UnitOfWork.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async run<T>(
    fn: (tx: PrismaTransaction) => Promise<T>,
    options: UnitOfWorkOptions = {},
  ): Promise<T> {
    const maxAttempts = options.attempts ?? 3;
    const retryClasses = options.retryOn ?? [ConflictError];
    const delays = [20, 50, 100];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          return await fn(tx);
        });
      } catch (rawError) {
        const error = mapPrismaError(rawError);

        const shouldRetry =
          attempt < maxAttempts &&
          retryClasses.some((cls) => typeof cls === 'function' && error instanceof cls);

        if (shouldRetry) {
          const delay = delays[attempt - 1] ?? 100;
          this.logger.warn(
            `UnitOfWork transaction failed on attempt ${attempt}/${maxAttempts} (${(error as Error).message}). Retrying in ${delay}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        throw error;
      }
    }

    throw new Error('UnitOfWork: Transaction exceeded maximum retry attempts');
  }

  async execute<T>(
    fn: (tx: PrismaTransaction) => Promise<T>,
    options: UnitOfWorkOptions = {},
  ): Promise<T> {
    return this.run(fn, options);
  }
}
