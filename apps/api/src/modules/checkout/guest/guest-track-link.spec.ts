import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { Request } from 'express';
import { GUEST_TRACKING_KEY_RE, GuestLookupDto } from './dto/guest-checkout.dto';
import { GUEST_LOOKUP_LINK_TTL_MS, signGuestLookupKey, verifyGuestLookupKey } from './guest-track-link';
import { createHash } from 'node:crypto';
import {
  GUEST_LOOKUP_CODE_LIMIT,
  GUEST_LOOKUP_IP_LIMIT,
  GUEST_LOOKUP_PHONE_LIMIT,
  GUEST_LOOKUP_PHONE_TTL_MS,
  GuestCheckoutController,
  guestLookupLimitMessage,
  lookupPhoneThrottleId,
  lookupThrottleId,
} from './guest-checkout.controller';
import { throttleRefusalOf } from '../../../common/throttle/throttle.config';

const SECRET = 'unit-secret-guest-track-link';
const CODE = 'TUBU2026112212345';
const HASH = 'a'.repeat(64);
const NOW = Date.UTC(2026, 10, 22, 6, 0, 0);

describe('khoá theo dõi tạm của tra cứu đơn (guest-track-link)', () => {
  it('cùng khuôn 43 ký tự base64url với khoá trình duyệt, hạn đúng 24 giờ', () => {
    const { key, expiresAt } = signGuestLookupKey(CODE, HASH, SECRET, NOW);
    expect(key).toMatch(GUEST_TRACKING_KEY_RE);
    expect(expiresAt.getTime()).toBe(NOW + GUEST_LOOKUP_LINK_TTL_MS);
    expect(verifyGuestLookupKey(key, CODE, HASH, SECRET, NOW)).toBe(true);
    expect(verifyGuestLookupKey(key, CODE, HASH, SECRET, NOW + GUEST_LOOKUP_LINK_TTL_MS - 1000)).toBe(true);
  });

  it('hết hạn, mã khác, băm khoá gốc khác, bí mật khác: không mở', () => {
    const { key } = signGuestLookupKey(CODE, HASH, SECRET, NOW);
    expect(verifyGuestLookupKey(key, CODE, HASH, SECRET, NOW + GUEST_LOOKUP_LINK_TTL_MS)).toBe(false);
    expect(verifyGuestLookupKey(key, 'TUBU2026112212346', HASH, SECRET, NOW)).toBe(false);
    expect(verifyGuestLookupKey(key, CODE, 'b'.repeat(64), SECRET, NOW)).toBe(false);
    expect(verifyGuestLookupKey(key, CODE, HASH, 'other-secret', NOW)).toBe(false);
  });

  it('sửa hạn trong khoá (kéo dài) thì chữ ký không còn khớp', () => {
    const { key } = signGuestLookupKey(CODE, HASH, SECRET, NOW);
    const buf = Buffer.from(key, 'base64url');
    buf.writeUInt32BE(buf.readUInt32BE(1) + 86_400, 1);
    expect(verifyGuestLookupKey(buf.toString('base64url'), CODE, HASH, SECRET, NOW)).toBe(false);
  });

  it('khoá ngẫu nhiên của trình duyệt, chuỗi sai khuôn, rỗng: không phải khoá tạm', () => {
    for (let i = 0; i < 50; i++) expect(verifyGuestLookupKey(randomBytes(32).toString('base64url'), CODE, HASH, SECRET, NOW)).toBe(false);
    expect(verifyGuestLookupKey('', CODE, HASH, SECRET, NOW)).toBe(false);
    expect(verifyGuestLookupKey('short', CODE, HASH, SECRET, NOW)).toBe(false);
    expect(verifyGuestLookupKey(`${signGuestLookupKey(CODE, HASH, SECRET, NOW).key}x`, CODE, HASH, SECRET, NOW)).toBe(false);
  });
});

describe('GuestLookupDto: chuẩn hoá mã đơn và SĐT trước khi kiểm', () => {
  const parse = (body: Record<string, unknown>) => {
    const dto = plainToInstance(GuestLookupDto, body);
    return { dto, errors: validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }) };
  };

  it('mã gõ thường, có dấu cách, có # ở đầu; SĐT +84, dấu chấm, dấu cách: về đúng dạng lưu trên đơn', () => {
    const { dto, errors } = parse({ orderCode: ' #tubu 2026 1122 12345 ', phone: '+84 912.345.678' });
    expect(errors).toEqual([]);
    expect(dto.orderCode).toBe(CODE);
    expect(dto.phone).toBe('0912345678');
    expect(parse({ orderCode: CODE, phone: '+84 0912 345 678' }).dto.phone).toBe('0912345678');
  });

  it('SĐT không phải di động Việt Nam, mã có ký tự lạ, thiếu trường: 400 (không chạm DB)', () => {
    expect(parse({ orderCode: CODE, phone: '0212345678' }).errors.length).toBeGreaterThan(0);
    expect(parse({ orderCode: 'TUBU<script>', phone: '0912345678' }).errors.length).toBeGreaterThan(0);
    expect(parse({ phone: '0912345678' }).errors.length).toBeGreaterThan(0);
    expect(parse({ orderCode: CODE, phone: '0912345678', extra: 1 }).errors.length).toBeGreaterThan(0);
  });
});

describe('POST /checkout/guest/lookup: trần theo mã đơn, theo SĐT và theo IP', () => {
  const handler = GuestCheckoutController.prototype.lookup;

  it('mỗi mã đơn 10 lượt/phút (chung bộ đếm dù gõ thường hay có dấu cách), mỗi IP 30 lượt/phút như đăng nhập (CGNAT nhà mạng)', () => {
    expect(GUEST_LOOKUP_CODE_LIMIT).toBe(10);
    expect(GUEST_LOOKUP_IP_LIMIT).toBe(30);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(GUEST_LOOKUP_CODE_LIMIT);
    expect(Reflect.getMetadata('THROTTLER:LIMITauthIp', handler)).toBe(GUEST_LOOKUP_IP_LIMIT);
    const tracker = Reflect.getMetadata('THROTTLER:TRACKERdefault', handler) as (r: unknown) => string;
    const a = tracker({ body: { orderCode: CODE }, ip: '1.1.1.1' });
    expect(tracker({ body: { orderCode: ' tubu2026112212345' }, ip: '2.2.2.2' })).toBe(a);
    expect(a.startsWith('lookup:')).toBe(true);
    expect(a).not.toContain(CODE);
    expect(tracker({ body: {}, ip: '3.3.3.3' })).toBe('ip:3.3.3.3');
  });

  it('mỗi SĐT 10 lượt/15 phút dù đổi mã đơn và IP: mã đơn chỉ có 10^5 giá trị mỗi ngày, biết SĐT thì không được dò cạn mã trong ngày', () => {
    expect(GUEST_LOOKUP_PHONE_LIMIT).toBe(10);
    expect(GUEST_LOOKUP_PHONE_TTL_MS).toBe(15 * 60_000);
    expect(Reflect.getMetadata('THROTTLER:LIMITlookupPhone', handler)).toBe(GUEST_LOOKUP_PHONE_LIMIT);
    expect(Reflect.getMetadata('THROTTLER:TTLlookupPhone', handler)).toBe(GUEST_LOOKUP_PHONE_TTL_MS);
    const tracker = Reflect.getMetadata('THROTTLER:TRACKERlookupPhone', handler) as (r: unknown) => string;
    const a = tracker({ body: { orderCode: CODE, phone: '0912345678' }, ip: '1.1.1.1' });
    expect(a).toBe(`lookup-phone:${createHash('sha256').update('0912345678').digest('hex')}`);
    expect(tracker({ body: { orderCode: 'TUBU2026112299999', phone: '+84 912.345.678' }, ip: '2.2.2.2' })).toBe(a);
    expect(tracker({ body: { phone: 'abc' }, ip: '3.3.3.3' })).toBe('ip:3.3.3.3');
  });

  it('tubu-w18-01: mọi cách gõ cùng một SĐT (84…, +84 0…, dấu cách, gạch, ngoặc) đếm chung một bộ đếm trần SĐT', () => {
    const tracker = Reflect.getMetadata('THROTTLER:TRACKERlookupPhone', handler) as (r: unknown) => string;
    const a = tracker({ body: { phone: '0912345678' }, ip: '1.1.1.1' });
    for (const phone of ['84912345678', '+84 0912 345 678', '0912-345-678', '(+84) 912 345 678', ' 091 234 5678 ']) {
      expect(tracker({ body: { phone }, ip: `9.9.9.${phone.length}` })).toBe(a);
    }
  });

  it('tubu-w18-01: 429 của route tra cứu mang mã GUEST_LOOKUP_LIMIT và câu tiếng Việt kèm số phút còn phải chờ', () => {
    const refusal = throttleRefusalOf(handler);
    expect(refusal?.code).toBe('GUEST_LOOKUP_LIMIT');
    expect(refusal?.message(15)).toBe('Bạn tra hơi nhiều lần. Thử lại sau 15 phút nhé.');
    expect(guestLookupLimitMessage(1)).toBe('Bạn tra hơi nhiều lần. Thử lại sau 1 phút nhé.');
    expect(throttleRefusalOf(GuestCheckoutController.prototype.track)).toBeUndefined();
  });

  it('định danh đếm trần bỏ qua giá trị không phải chuỗi', () => {
    expect(lookupThrottleId({ body: { orderCode: 123 } } as unknown as Request)).toBeUndefined();
    expect(lookupThrottleId({ body: undefined } as unknown as Request)).toBeUndefined();
    expect(lookupPhoneThrottleId({ body: { phone: 912345678 } } as unknown as Request)).toBeUndefined();
    expect(lookupPhoneThrottleId({ body: { phone: '0212345678' } } as unknown as Request)).toBeUndefined();
  });
});
