import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { BaseError, NotFoundError, ConflictError, ValidationError, RateLimitError, InfrastructureError, toErrorCode } from '../../shared-kernel/errors';
import { ERROR_CODES, ErrorCode } from '@wrm/contracts';

export interface StandardErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    traceId?: string;
  };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const traceId = (request.headers['x-trace-id'] as string) ?? (request as unknown as { id?: string }).id;

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = ERROR_CODES.INTERNAL_ERROR;
    let message = 'Internal server error';
    let details: unknown = undefined;

    const isBaseError =
      exception instanceof BaseError ||
      (exception instanceof Error && typeof (exception as unknown as Record<string, unknown>).code === 'string');

    if (isBaseError) {
      const err = exception as BaseError;
      code = err.code;
      message = err.message;
      details = err.details;

      if (code === ERROR_CODES.PAY_NOT_FOUND || exception instanceof NotFoundError) {
        statusCode = HttpStatus.NOT_FOUND;
      } else if (
        code === ERROR_CODES.CONCURRENCY_CONFLICT ||
        code === ERROR_CODES.REFUND_ALREADY_CLAIMED ||
        code === ERROR_CODES.REFUND_ALREADY_DECIDED ||
        exception instanceof ConflictError
      ) {
        statusCode = HttpStatus.CONFLICT;
      } else if (
        code === ERROR_CODES.VALIDATION_FAILED ||
        code === ERROR_CODES.REFUND_BLOCKED_PENDING_OUTCOMES ||
        code === ERROR_CODES.PAY_MACHINE_BUSY ||
        exception instanceof ValidationError
      ) {
        statusCode = HttpStatus.BAD_REQUEST;
      } else if (code === ERROR_CODES.RATE_LIMITED || exception instanceof RateLimitError) {
        statusCode = HttpStatus.TOO_MANY_REQUESTS;
      } else if (exception instanceof InfrastructureError) {
        statusCode = HttpStatus.BAD_GATEWAY;
      } else {
        statusCode = HttpStatus.BAD_REQUEST; // Domain errors default to 400
      }
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') {
        message = response;
      } else if (typeof response === 'object' && response !== null) {
        const respObj = response as Record<string, unknown>;
        message = (respObj.message as string) ?? exception.message;
        details = respObj.error ?? respObj.message;
      }
      code = toErrorCode(exception);
      if (code === ERROR_CODES.INTERNAL_ERROR) {
        if (statusCode === 400) code = ERROR_CODES.VALIDATION_FAILED;
        else if (statusCode === 404) code = ERROR_CODES.PAY_NOT_FOUND;
        else if (statusCode === 409) code = ERROR_CODES.CONCURRENCY_CONFLICT;
        else if (statusCode === 429) code = ERROR_CODES.RATE_LIMITED;
        else if (statusCode === 401) code = ERROR_CODES.AUTH_UNAUTHENTICATED;
        else if (statusCode === 403) code = ERROR_CODES.AUTH_FORBIDDEN;
      }
    } else {
      this.logger.error(`Unhandled exception caught in GlobalExceptionFilter: ${String(exception)}`, exception instanceof Error ? exception.stack : undefined);
    }

    const payload: StandardErrorResponse = {
      error: {
        code,
        message,
        details: details ?? undefined,
        traceId,
      },
    };

    reply.status(statusCode).send(payload);
  }
}
