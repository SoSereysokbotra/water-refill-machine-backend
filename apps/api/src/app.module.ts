import { Module } from '@nestjs/common';
import { PlatformModule } from './platform';

@Module({
  imports: [PlatformModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
