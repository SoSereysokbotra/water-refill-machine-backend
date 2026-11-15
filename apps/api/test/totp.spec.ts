import { describe, expect, it } from 'vitest';
import {
  base32ToBuffer,
  generateBase32Secret,
  generateTotp,
  getTotpUri,
  verifyTotp,
} from '../src/contexts/identity/application/totp.util';

describe('TOTP Utility (RFC 6238)', () => {
  it('generates a valid base32 secret', () => {
    const secret = generateBase32Secret(20);
    expect(secret).toHaveLength(32);
    expect(/^[A-Z2-7]+$/.test(secret)).toBe(true);
  });

  it('converts base32 to buffer and back', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const buf = base32ToBuffer(secret);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(10);
  });

  it('throws on invalid base32 characters', () => {
    expect(() => base32ToBuffer('INVALID!@#')).toThrow('Invalid base32 character');
  });

  it('generates a 6-digit TOTP code', () => {
    const secret = generateBase32Secret(20);
    const code = generateTotp(secret);
    expect(code).toHaveLength(6);
    expect(/^\d{6}$/.test(code)).toBe(true);
  });

  it('verifies valid TOTP code within standard time step', () => {
    const secret = generateBase32Secret(20);
    const now = Date.now();
    const code = generateTotp(secret, now);

    expect(verifyTotp(secret, code, now)).toBe(true);
  });

  it('allows 1-step drift window (+/- 30s)', () => {
    const secret = generateBase32Secret(20);
    const now = Date.now();
    const pastCode = generateTotp(secret, now - 30_000);
    const futureCode = generateTotp(secret, now + 30_000);

    expect(verifyTotp(secret, pastCode, now, 30, 1)).toBe(true);
    expect(verifyTotp(secret, futureCode, now, 30, 1)).toBe(true);
  });

  it('rejects codes outside the drift window', () => {
    const secret = generateBase32Secret(20);
    const now = Date.now();
    const oldCode = generateTotp(secret, now - 90_000); // 3 steps ago

    expect(verifyTotp(secret, oldCode, now, 30, 1)).toBe(false);
    expect(verifyTotp(secret, '000000', now)).toBe(false);
    expect(verifyTotp(secret, 'invalid', now)).toBe(false);
  });

  it('generates standard otpauth URI', () => {
    const uri = getTotpUri('WRM Refill Machine', 'operator@wrm.kh', 'JBSWY3DPEHPK3PXP');
    expect(uri).toContain('otpauth://totp/WRM%20Refill%20Machine:operator%40wrm.kh');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=WRM%20Refill%20Machine');
    expect(uri).toContain('period=30');
  });
});
