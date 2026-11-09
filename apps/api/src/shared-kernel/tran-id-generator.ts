import { randomBytes } from 'crypto';

export class TranIdGenerator {
  /**
   * Generates a unique, collision-resistant transaction ID.
   * Format: base36 timestamp + random hexadecimal string (length: 16-18 chars, max 20).
   */
  next(): string {
    const timestampPart = Date.now().toString(36);
    const randomPart = randomBytes(5).toString('hex'); // 10 chars
    const id = `${timestampPart}${randomPart}`.toLowerCase();
    return id.slice(0, 20);
  }
}
