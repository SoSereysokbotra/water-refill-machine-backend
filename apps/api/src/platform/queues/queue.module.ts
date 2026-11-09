import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { RetentionService } from './retention.service';

@Global()
@Module({
  providers: [QueueService, RetentionService],
  exports: [QueueService, RetentionService],
})
export class QueueModule {}
