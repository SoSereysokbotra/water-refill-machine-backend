import { Logger } from '@nestjs/common';

export abstract class BaseSweep<T = unknown> {
  protected readonly logger: Logger;

  protected constructor(
    public readonly name: string,
    public readonly cronOrInterval: string | number,
  ) {
    this.logger = new Logger(`Sweep:${name}`);
  }

  abstract findDueItems(): Promise<T[]>;
  abstract processItem(item: T): Promise<void>;

  async execute(): Promise<{ processed: number; failed: number }> {
    this.logger.debug(`Starting sweep [${this.name}]...`);
    let items: T[] = [];
    try {
      items = await this.findDueItems();
    } catch (err) {
      this.logger.error(`Error querying due items in sweep [${this.name}]: ${(err as Error).message}`, (err as Error).stack);
      return { processed: 0, failed: 0 };
    }

    if (items.length === 0) {
      this.logger.debug(`Sweep [${this.name}] found 0 due items.`);
      return { processed: 0, failed: 0 };
    }

    let processed = 0;
    let failed = 0;

    for (const item of items) {
      try {
        await this.processItem(item);
        processed++;
      } catch (err) {
        failed++;
        this.logger.error(`Failed to process item in sweep [${this.name}]: ${(err as Error).message}`, (err as Error).stack);
      }
    }

    this.logger.debug(`Sweep [${this.name}] finished. Processed: ${processed}, Failed: ${failed}`);
    return { processed, failed };
  }
}
