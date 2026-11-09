import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { OutboxHandlerRegistry } from './outbox-handler.registry';
import { OutboxRelay } from './outbox.relay';

@Global()
@Module({
  providers: [OutboxService, OutboxHandlerRegistry, OutboxRelay],
  exports: [OutboxService, OutboxHandlerRegistry, OutboxRelay],
})
export class OutboxModule {}
