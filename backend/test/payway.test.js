import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { reqTime, sign } from '../src/payway.js';

test('reqTime is UTC YYYYMMDDHHmmss', () => {
  assert.equal(reqTime(new Date('2026-11-03T04:05:06.789Z')), '20261103040506');
});

test('sign is base64 HMAC-SHA512', () => {
  const expected = crypto.createHmac('sha512', 'key').update('msg').digest('base64');
  assert.equal(sign('msg', 'key'), expected);
  assert.equal(Buffer.from(sign('msg', 'key'), 'base64').length, 64);
});
