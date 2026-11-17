import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { MetricsService } from './metrics.service';
import { MetricsCollectorService } from './metrics-collector.service';
import { Public } from '../security/public.decorator';
import { MetricsTokenGuard } from '../security/access.guards';

@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly collector: MetricsCollectorService,
  ) {}

  @Get()
  @Public() // no user session: Prometheus authenticates with METRICS_TOKEN instead
  @UseGuards(MetricsTokenGuard)
  async getMetrics(@Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    await this.collector.collectGauges();
    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return this.metricsService.getMetricsText();
  }
}
