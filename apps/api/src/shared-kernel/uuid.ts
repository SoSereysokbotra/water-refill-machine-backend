import { v7 as uuidv7 } from 'uuid';

/**
 * Generates an RFC 9562 UUIDv7 (timestamp-ordered 128-bit identifier).
 */
export function generateUuidV7(): string {
  return uuidv7();
}
