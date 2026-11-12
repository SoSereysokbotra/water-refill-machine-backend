import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../../../platform/config/config.service';

export const TELEGRAM_CLIENT = 'TelegramClient';

export interface ITelegramClient {
  sendMessage(text: string): Promise<void>;
}

@Injectable()
export class TelegramClient implements ITelegramClient {
  private readonly logger = new Logger(TelegramClient.name);

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async sendMessage(text: string): Promise<void> {
    const token = this.config.get('TELEGRAM_BOT_TOKEN');
    const chatId = this.config.get('TELEGRAM_CHAT_ID');

    if (!token || !chatId) {
      this.logger.log(`[Telegram unconfigured] ${text}`);
      return;
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      this.logger.error(`Telegram API error: ${res.status} ${errText}`);
      throw new Error(`Telegram API error ${res.status}: ${errText}`);
    }
  }
}
