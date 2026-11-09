import { Injectable, Logger } from '@nestjs/common';
import { PrismaTransaction } from '../database/unit-of-work';
import { Prisma } from '@prisma/client';

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  /**
   * Records a message ID atomically in the provided transaction.
   * Returns true if newly recorded, false if duplicate (already recorded).
   */
  async record(messageId: string, source: string, tx: PrismaTransaction): Promise<boolean> {
    try {
      await tx.inbox.create({
        data: {
          messageId,
          source,
        },
      });
      return true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.debug(`Duplicate message detected in inbox: [${messageId}] from source [${source}]`);
        return false;
      }
      throw err;
    }
  }
}
