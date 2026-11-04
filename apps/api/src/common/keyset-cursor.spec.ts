import { BadRequestException } from '@nestjs/common';
import { decodeKeysetCursor, encodeKeysetCursor, keysetAfter } from './keyset-cursor';

describe('keyset cursor', () => {
  it('mã hoá rồi giải mã giữ nguyên (createdAt, id)', () => {
    const row = { createdAt: new Date('2026-11-05T01:02:03.456Z'), id: 'cabc123' };
    const back = decodeKeysetCursor(encodeKeysetCursor(row));
    expect(back.createdAt.toISOString()).toBe('2026-11-05T01:02:03.456Z');
    expect(back.id).toBe('cabc123');
  });

  it.each(['', '###', Buffer.from('abc').toString('base64url'), Buffer.from('12|').toString('base64url'), Buffer.from('x|id').toString('base64url'), Buffer.from(`1|${'a'.repeat(65)}`).toString('base64url')])(
    'con trỏ hỏng %j → 400',
    (raw) => {
      expect(() => decodeKeysetCursor(raw)).toThrow(BadRequestException);
    },
  );

  it('điều kiện lấy dòng cũ hơn, cùng thời điểm thì id nhỏ hơn', () => {
    const c = { createdAt: new Date(1000), id: 'b' };
    expect(keysetAfter(c)).toEqual({ OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: 'b' } }] });
  });
});
