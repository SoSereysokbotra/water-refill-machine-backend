import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { UnitOfWork } from './unit-of-work';

@Global()
@Module({
  providers: [PrismaService, UnitOfWork],
  exports: [PrismaService, UnitOfWork],
})
export class DatabaseModule {}
