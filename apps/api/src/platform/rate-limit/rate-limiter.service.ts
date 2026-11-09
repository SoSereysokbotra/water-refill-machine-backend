import { Injectable, Logger } from '@nestjs/common';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { QueueService } from '../queues/queue.service';
import { RateLimitError } from '../../shared-kernel';

export interface RateLimitOptions {
  points: number;
  duration: number; // in seconds
  keyPrefix?: string;
}

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly limiters = new Map<string, RateLimiterRedis>();

  constructor(private readonly queueService: QueueService) {}

  getLimiter(options: RateLimitOptions): RateLimiterRedis {
    const keyPrefix = options.keyPrefix ?? 'rl_default';
    const cacheKey = `${keyPrefix}:${options.points}:${options.duration}`;

    let limiter = this.limiters.get(cacheKey);
    if (!limiter) {
      const redisClient = this.queueService.getRedisClient();
      limiter = new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix,
        points: options.points,
        duration: options.duration,
      });
      this.limiters.set(cacheKey, limiter);
    }

    return limiter;
  }

  async consume(
    key: string,
    points = 1,
    options: RateLimitOptions = { points: 60, duration: 60, keyPrefix: 'rl_general' },
  ): Promise<void> {
    const limiter = this.getLimiter(options);
    try {
      await limiter.consume(key, points);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'msBeforeNext' in err) {
        const msBeforeNext = (err as { msBeforeNext: number }).msBeforeNext;
        throw new RateLimitError('Too many requests, please try again later', {
          retryAfterMs: msBeforeNext,
          key,
        });
      }
      this.logger.error(`Rate limiter storage error: ${(err as Error).message}`, (err as Error).stack);
      // Fail-open or throw infrastructure error if Redis is down, but let's rethrow as RateLimitError or InfrastructureError
      throw err;
    }
  }

  async penalty(
    key: string,
    points = 1,
    options: RateLimitOptions = { points: 60, duration: 60, keyPrefix: 'rl_general' },
  ): Promise<void> {
    const limiter = this.getLimiter(options);
    await limiter.penalty(key, points);
  }

  async reward(
    key: string,
    points = 1,
    options: RateLimitOptions = { points: 60, duration: 60, keyPrefix: 'rl_general' },
  ): Promise<void> {
    const limiter = this.getLimiter(options);
    await limiter.reward(key, points);
  }
}
