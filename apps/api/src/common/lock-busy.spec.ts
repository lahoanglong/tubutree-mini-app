import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isDeadlock, isLockBusy, isLockContention, isSerializationFailure } from './lock-busy';

const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'x', meta });

describe('isSerializationFailure', () => {
  it('nhận P2034 và P2010 mang meta.code 40001', () => {
    expect(isSerializationFailure(known('P2034'))).toBe(true);
    expect(isSerializationFailure(known('P2010', { code: '40001', message: 'could not serialize access' }))).toBe(true);
  });

  it('fallback theo message chứa 40001 / could not serialize access', () => {
    expect(isSerializationFailure(new Error('Raw query failed. Code: `40001`'))).toBe(true);
    expect(isSerializationFailure(new Error('could not serialize access due to concurrent update'))).toBe(true);
  });

  it('không nhận lỗi khác', () => {
    expect(isSerializationFailure(known('P2010', { code: '42703' }))).toBe(false);
    expect(isSerializationFailure(known('P2002'))).toBe(false);
    expect(isSerializationFailure(null)).toBe(false);
    expect(isSerializationFailure('40001')).toBe(false);
  });

  it('isLockBusy cũng coi 40001 qua câu raw là bận', () => {
    expect(isLockBusy(known('P2010', { code: '40001' }))).toBe(true);
    expect(isLockBusy(known('P2028'))).toBe(true);
  });
});

describe('lỗi nghiệp vụ (HttpException) không bao giờ bị coi là lỗi khoá', () => {
  it.each(['Combo 40001 đã ngừng bán', 'mã 40P01', 'mã 55P03', 'could not serialize access', 'deadlock detected'])(
    'message "%s" → false ở cả ba hàm dò',
    (message) => {
      const err = new BadRequestException(message);
      expect(isSerializationFailure(err)).toBe(false);
      expect(isLockBusy(err)).toBe(false);
      expect(isDeadlock(err)).toBe(false);
    },
  );

  it('Error thường và lỗi Prisma vẫn nhận như cũ', () => {
    expect(isSerializationFailure(new Error('Code: `40001`'))).toBe(true);
    expect(isLockBusy(new Error('Code: 55P03'))).toBe(true);
    expect(isDeadlock(new Error('Code: 40P01'))).toBe(true);
    expect(isLockBusy(known('P2028'))).toBe(true);
  });
});

describe('isLockContention: chỉ tranh khoá thật, hẹp hơn isLockBusy', () => {
  const known = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test', ...(meta ? { meta } : {}) });
  it.each([
    ['55P03 của câu raw (P2010)', known('P2010', { code: '55P03' })],
    ['40P01 của câu raw (P2010)', known('P2010', { code: '40P01' })],
    ['xung đột ghi P2034', known('P2034')],
    ['55P03 trong message', new Error('canceling statement due to lock timeout')],
    ['deadlock trong message', new Error('deadlock detected')],
  ])('%s: có', (_n, err) => expect(isLockContention(err)).toBe(true));
  it.each([
    ['giao dịch hết hạn P2028', known('P2028')],
    ['statement timeout 57014', new Error('canceling statement due to statement timeout (57014)')],
    ['lỗi lạ', new Error('boom')],
    ['không phải Error', 'chuỗi'],
    ['null', null],
    ['HttpException chứa chữ lock timeout', new BadRequestException('Sản phẩm "lock timeout" không có')],
  ])('%s: không (isLockBusy vẫn có thể có)', (_n, err) => expect(isLockContention(err)).toBe(false));
  it('isLockBusy giữ nguyên hành vi: vẫn coi P2028 và 57014 là bận', () => {
    expect(isLockBusy(known('P2028'))).toBe(true);
    expect(isLockBusy(new Error('statement timeout (57014)'))).toBe(true);
  });
});
