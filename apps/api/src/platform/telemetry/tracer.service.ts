import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import {
  trace,
  Tracer,
  Span,
  SpanStatusCode,
  ROOT_CONTEXT,
  TraceFlags,
  SpanContext,
} from '@opentelemetry/api';
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { randomBytes } from 'crypto';
import {
  getCorrelationContext,
  runWithCorrelation,
  updateCorrelationContext,
} from '../logging/correlation-context';

export interface StartSpanOptions {
  traceId?: string;
  parentSpanId?: string;
  attributes?: Record<string, string | number | boolean>;
}

@Injectable()
export class TracerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TracerService.name);
  private provider!: BasicTracerProvider;
  private exporter = new InMemorySpanExporter();
  private tracer!: Tracer;

  onModuleInit() {
    this.provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(this.exporter)],
    });
    try {
      trace.setGlobalTracerProvider(this.provider);
    } catch {
      // Global provider already set
    }
    this.tracer = this.provider.getTracer('wrm-backend');
    this.logger.log('OpenTelemetry TracerService initialized');
  }

  onModuleDestroy() {
    this.exporter.reset();
  }

  getTracer(): Tracer {
    return this.tracer;
  }

  getCurrentTraceId(): string | undefined {
    const correlation = getCorrelationContext();
    if (correlation?.traceId) return correlation.traceId;
    const activeSpan = trace.getActiveSpan();
    return activeSpan?.spanContext().traceId;
  }

  getCurrentSpanId(): string | undefined {
    const correlation = getCorrelationContext();
    if (correlation?.spanId) return correlation.spanId;
    const activeSpan = trace.getActiveSpan();
    return activeSpan?.spanContext().spanId;
  }

  generateTraceId(): string {
    return randomBytes(16).toString('hex');
  }

  generateSpanId(): string {
    return randomBytes(8).toString('hex');
  }

  async startActiveSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T> | T,
    options?: StartSpanOptions,
  ): Promise<T> {
    const correlation = getCorrelationContext();
    const effectiveTraceId = options?.traceId ?? correlation?.traceId ?? this.generateTraceId();
    const parentSpanId = options?.parentSpanId ?? correlation?.spanId;

    const spanContext: SpanContext = {
      traceId: effectiveTraceId,
      spanId: parentSpanId || this.generateSpanId(),
      traceFlags: TraceFlags.SAMPLED,
      isRemote: Boolean(options?.traceId),
    };

    const parentCtx = trace.setSpanContext(ROOT_CONTEXT, spanContext);
    const span = this.tracer.startSpan(name, {}, parentCtx);

    if (options?.attributes) {
      span.setAttributes(options.attributes);
    }

    const currentSpanId = span.spanContext().spanId;

    return runWithCorrelation(
      {
        traceId: effectiveTraceId,
        spanId: currentSpanId,
        tranId: correlation?.tranId,
        machineId: correlation?.machineId,
        requestId: correlation?.requestId,
      },
      async () => {
        try {
          const result = await fn(span);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (err) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err instanceof Error ? err.message : String(err),
          });
          span.recordException(err as Error);
          throw err;
        } finally {
          span.end();
        }
      },
    );
  }

  async withTraceContext<T>(
    context: { traceId: string; spanId?: string; tranId?: string; machineId?: string; requestId?: string },
    fn: () => Promise<T> | T,
  ): Promise<T> {
    return runWithCorrelation(context, async () => {
      return fn();
    });
  }

  setAttributes(attributes: Record<string, string | number | boolean>): void {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.setAttributes(attributes);
    }
  }

  recordContext(context: { tranId?: string; machineId?: string; requestId?: string }): void {
    updateCorrelationContext(context);
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      if (context.tranId) activeSpan.setAttribute('wrm.tran_id', context.tranId);
      if (context.machineId) activeSpan.setAttribute('wrm.machine_id', context.machineId);
      if (context.requestId) activeSpan.setAttribute('wrm.request_id', context.requestId);
    }
  }

  getExportedSpans(): ReadableSpan[] {
    return this.exporter.getFinishedSpans();
  }

  clearExportedSpans(): void {
    this.exporter.reset();
  }
}
