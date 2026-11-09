import { Injectable, Logger } from '@nestjs/common';
import { AppConfig, configSchema } from './config.schema';

@Injectable()
export class ConfigService {
  private readonly config: AppConfig;
  private readonly logger = new Logger(ConfigService.name);

  constructor() {
    const result = configSchema.safeParse(process.env);
    if (!result.success) {
      this.logger.error('Invalid environment configuration:');
      for (const issue of result.error.issues) {
        this.logger.error(` - [${issue.path.join('.')}] ${issue.message}`);
      }
      throw new Error('Fatal: Configuration validation failed. Aborting startup.');
    }
    this.config = result.data;
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config[key];
  }

  get all(): AppConfig {
    return { ...this.config };
  }

  getAll(): AppConfig {
    return { ...this.config };
  }
}
