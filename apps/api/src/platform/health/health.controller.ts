import { Controller, Get, Res, HttpStatus } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { PrismaService } from '../database/prisma.service';
import { QueueService } from '../queues/queue.service';
import { MqttService } from '../mqtt/mqtt.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly mqttService: MqttService,
  ) {}

  @Get('live')
  live() {
    return {
      status: 'ok',
      uptime: process.uptime(),
    };
  }

  @Get('ready')
  async ready(@Res() reply: FastifyReply) {
    let dbStatus = 'down';
    let redisStatus = 'down';
    let mqttStatus = 'down';

    // 1. DB check
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbStatus = 'up';
    } catch {
      dbStatus = 'down';
    }

    // 2. Redis check
    try {
      const pong = await this.queueService.getRedisClient().ping();
      if (pong === 'PONG') {
        redisStatus = 'up';
      }
    } catch {
      redisStatus = 'down';
    }

    // 3. MQTT check
    if (this.mqttService.isHealthy()) {
      mqttStatus = 'up';
    }

    const allHealthy = dbStatus === 'up' && redisStatus === 'up' && mqttStatus === 'up';

    const statusCode = allHealthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    return reply.status(statusCode).send({
      status: allHealthy ? 'ok' : 'degraded',
      checks: {
        database: dbStatus,
        redis: redisStatus,
        mqtt: mqttStatus,
      },
    });
  }
}
