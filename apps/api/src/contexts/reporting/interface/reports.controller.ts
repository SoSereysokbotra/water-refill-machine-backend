import { Controller, Get, Inject, Post, Query, Res, UseGuards } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { z } from 'zod';
import { SessionAuthGuard, RolesGuard, Roles } from '../../../platform/security';
import { ValidationError } from '../../../shared-kernel';
import { ReportingService, SalesReportQuery } from '../application/reporting.service';

const SalesQuerySchema = z.object({
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  machineId: z.string().trim().optional(),
  groupBy: z.enum(['day', 'machine']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  format: z.enum(['json', 'csv']).optional(),
});

const RefundsQuerySchema = z.object({
  status: z.enum(['open', 'claimed', 'refunded', 'rejected', 'auto_failed']).optional(),
});

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw new ValidationError(
      'Invalid report query parameters',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

@Controller('v1/reports')
@UseGuards(SessionAuthGuard, RolesGuard)
export class ReportsController {
  constructor(@Inject(ReportingService) private readonly reportingService: ReportingService) {}

  @Get('sales')
  @Roles('viewer')
  async getSalesReport(
    @Query() rawQuery: unknown,
    @Res({ passthrough: true }) reply?: FastifyReply,
  ) {
    const query = parse(SalesQuerySchema, rawQuery) as SalesReportQuery;
    const report = await this.reportingService.getSalesReport(query);

    if (query.format === 'csv') {
      const csv = this.reportingService.generateSalesCsv(report);
      if (reply) {
        reply.header('Content-Type', 'text/csv; charset=utf-8');
        reply.header('Content-Disposition', 'attachment; filename="sales-report.csv"');
      }
      return csv;
    }

    return { data: report };
  }

  @Get('machines/status')
  @Roles('viewer')
  async getFleetStatus() {
    const data = await this.reportingService.getFleetStatus();
    return { data };
  }

  @Get('refunds')
  @Roles('operator')
  async getRefundsReport(@Query() rawQuery: unknown) {
    const query = parse(RefundsQuerySchema, rawQuery);
    const data = await this.reportingService.getRefundsReport(query);
    return { data };
  }

  @Post('refresh')
  @Roles('admin')
  async refreshViews() {
    await this.reportingService.refreshViews();
    return { data: { refreshed: true } };
  }
}
