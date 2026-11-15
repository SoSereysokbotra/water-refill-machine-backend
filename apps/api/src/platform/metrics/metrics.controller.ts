import { Controller, Get, Res } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { MetricsService } from './metrics.service';
import { MetricsCollectorService } from './metrics-collector.service';
import { Public } from '../security/public.decorator';

@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly collector: MetricsCollectorService,
  ) {}

  @Get()
  @Public()
  async getMetrics(@Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    await this.collector.collectGauges();
    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return this.metricsService.getMetricsText();
  }
}
