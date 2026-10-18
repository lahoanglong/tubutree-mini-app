import { BadRequestException } from '@nestjs/common';
import { parseTreeBuyKey } from '../modules/game/tree-purchase-key';
import { requireIdempotencyKey } from './idempotency-key';

const invalidMessage = (() => { try { parseTreeBuyKey('bad'); } catch (e) { return (e as Error).message; } return ''; })();

describe('requireIdempotencyKey (spec 15.1)', () => {
  it.each(['abcd1234', 'A-b_c-9x', 'a'.repeat(128)])('accepts %p unchanged', (k) => expect(requireIdempotencyKey(k)).toBe(k));
  it.each(['short', 'a'.repeat(129), 'has space1', ' abcdefgh', 'abcdefg!', '', ['abcdefgh', 'x'], 12345678])('rejects %p with the parseTreeBuyKey message', (k) => {
    expect(() => requireIdempotencyKey(k)).toThrow(new BadRequestException(invalidMessage));
  });
  it('a missing header is a 400 too', () => {
    expect(() => requireIdempotencyKey(undefined)).toThrow(new BadRequestException('Thiếu Idempotency-Key: cần 8 đến 128 ký tự gồm chữ cái, chữ số, dấu gạch dưới (_) hoặc gạch nối (-).'));
  });
});
