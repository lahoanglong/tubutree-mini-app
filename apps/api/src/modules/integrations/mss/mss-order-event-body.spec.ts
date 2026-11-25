import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMssEventBody, greetingName, MssEventBodyError, newEventId, vnIso, type MssEventBodyInput } from './mss-order-event-body';
import {
  fallbackDecision,
  inRollout,
  mssEventTypeForZns,
  MSS_ORDER_EVENT_TYPES,
  MSS_RETRY_DELAYS_MS,
  nextRetryAt,
  normalizeVnPhone,
  rolloutBucket,
} from './mss-order-event-types';

const FIXTURES = join(__dirname, '..', '..', '..', '..', 'test', 'fixtures', 'mss');
type Schema = {
  type?: string;
  enum?: unknown[];
  const?: unknown;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, Schema>;
};
const SCHEMA = JSON.parse(readFileSync(join(FIXTURES, 'order-event.schema.json'), 'utf8')) as Schema;

/** Bộ kiểm JSON Schema tối giản cho đúng các từ khoá file schema dùng (repo không có ajv). */
function validate(schema: Schema, value: unknown, path = '$'): string[] {
  const errors: string[] = [];
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path}: phải là ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ngoài enum`);
  if (schema.type === 'string') {
    if (typeof value !== 'string') return [...errors, `${path}: không phải chuỗi`];
    const len = [...value].length;
    if (schema.minLength !== undefined && len < schema.minLength) errors.push(`${path}: ngắn hơn ${schema.minLength}`);
    if (schema.maxLength !== undefined && len > schema.maxLength) errors.push(`${path}: dài hơn ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: sai mẫu`);
  }
  if (schema.type === 'integer') {
    if (!Number.isInteger(value)) return [...errors, `${path}: không phải số nguyên`];
    if (schema.minimum !== undefined && (value as number) < schema.minimum) errors.push(`${path}: nhỏ hơn ${schema.minimum}`);
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') errors.push(`${path}: không phải boolean`);
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [...errors, `${path}: không phải object`];
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in obj)) errors.push(`${path}.${key}: thiếu`);
    for (const [key, v] of Object.entries(obj)) {
      const sub = schema.properties?.[key];
      if (!sub) {
        if (schema.additionalProperties === false) errors.push(`${path}.${key}: khoá lạ`);
        continue;
      }
      errors.push(...validate(sub, v, `${path}.${key}`));
    }
  }
  return errors;
}

function input(over: Partial<MssEventBodyInput> = {}, order: Partial<MssEventBodyInput['order']> = {}): MssEventBodyInput {
  return {
    eventId: '01JCX9Z7Q4M8T2K5V6W3Y0ABCD',
    eventType: 'order.shipping',
    occurredAt: new Date('2026-11-16T07:05:09.123Z'),
    sequence: 3,
    order: {
      code: 'TB-261116-0412',
      total: 385000,
      paymentMethod: 'COD',
      platform: 'miniapp',
      itemNames: ['Nước giặt sinh học Fuwa3e 2L', 'Nước rửa chén', 'Túi vải'],
      shippingPartner: 'GHN',
      shippingCode: 'GHN8X2K9',
      checkoutGroup: null,
      groupSize: null,
      ...order,
    },
    recipient: { phone: '0901234567', phoneSource: 'account_verified', name: 'Lan' },
    consent: { capturedAt: new Date('2026-11-16T06:58:40Z'), source: 'checkout' },
    linkOrigin: 'https://tubutree.com',
    ...over,
  };
}

describe('buildMssEventBody: danh sách trắng theo hợp đồng v1.2 mục 3.3', () => {
  it('fixture mẫu của hợp đồng khớp schema (schema tự kiểm)', () => {
    const sample = JSON.parse(readFileSync(join(FIXTURES, 'order-event.json'), 'utf8'));
    expect(validate(SCHEMA, sample)).toEqual([]);
    expect(validate(SCHEMA, { ...sample, address: 'x' })).toEqual(['$.address: khoá lạ']);
  });

  it.each(MSS_ORDER_EVENT_TYPES)('%s: chỉ khoá trong schema, đủ khoá bắt buộc', (eventType) => {
    const body = buildMssEventBody(input({ eventType, cancelReason: 'CUSTOMER', refundExpected: true }, { checkoutGroup: 'G-1', groupSize: 2 }));
    expect(validate(SCHEMA, JSON.parse(body.json))).toEqual([]);
  });

  it('khớp đúng ví dụ của hợp đồng cho order.shipping (giờ +07:00, link theo mã đơn)', () => {
    const body = JSON.parse(buildMssEventBody(input()).json);
    expect(body).toEqual({
      event_id: '01JCX9Z7Q4M8T2K5V6W3Y0ABCD',
      event_type: 'order.shipping',
      occurred_at: '2026-11-16T14:05:09+07:00',
      sequence: 3,
      sender: 'tubutree',
      order: {
        code: 'TB-261116-0412',
        total_vnd: 385000,
        payment_method: 'COD',
        channel: 'miniapp',
        item_count: 3,
        first_item_name: 'Nước giặt sinh học Fuwa3e 2L',
        carrier: 'GHN',
        tracking_code: 'GHN8X2K9',
        tracking_url: 'https://tubutree.com/tai-khoan/don-hang/TB-261116-0412',
      },
      recipient: { phone: '0901234567', phone_source: 'account_verified', name: 'Lan' },
      consent: { order_updates_zalo: true, captured_at: '2026-11-16T13:58:40+07:00', source: 'checkout' },
    });
  });

  it('trường theo loại: link/vận đơn chỉ khi shipping, lý do huỷ chỉ khi cancelled, nhóm chỉ created/payment_confirmed', () => {
    const created = JSON.parse(buildMssEventBody(input({ eventType: 'order.created' }, { checkoutGroup: 'G-1', groupSize: 2 })).json).order;
    expect(created).not.toHaveProperty('tracking_url');
    expect(created).not.toHaveProperty('carrier');
    expect(created).toMatchObject({ group_code: 'G-1', group_size: 2 });
    const cancelled = JSON.parse(buildMssEventBody(input({ eventType: 'order.cancelled', cancelReason: 'PAYMENT_TIMEOUT' })).json).order;
    expect(cancelled).toMatchObject({ cancel_reason: 'PAYMENT_TIMEOUT', refund_expected: false });
    expect(cancelled).not.toHaveProperty('group_code');
    const delivered = JSON.parse(buildMssEventBody(input({ eventType: 'order.delivered' }, { checkoutGroup: 'G-1', groupSize: 2 })).json).order;
    expect(Object.keys(delivered).sort()).toEqual(['channel', 'code', 'first_item_name', 'item_count', 'payment_method', 'total_vnd']);
  });

  it('PREPAID cho mọi phương thức không phải COD; tên dài bị cắt theo trần hợp đồng', () => {
    const body = JSON.parse(
      buildMssEventBody(input({ recipient: { phone: '0901234567', phoneSource: 'account_verified', name: 'A'.repeat(50) } }, { paymentMethod: 'ZALOPAY', itemNames: ['B'.repeat(80)] })).json,
    );
    expect(body.order.payment_method).toBe('PREPAID');
    expect([...body.order.first_item_name].length).toBe(60);
    expect(body.recipient.name.length).toBe(30);
  });

  it('cùng đầu vào cho cùng byte và cùng sha256 (thử lại gửi đúng thân đã lưu)', () => {
    const a = buildMssEventBody(input());
    const b = buildMssEventBody(input());
    expect(a.json).toBe(b.json);
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('từ chối đầu vào sai hợp đồng bằng MssEventBodyError (recorder bỏ sự kiện, không làm hỏng đơn)', () => {
    expect(() => buildMssEventBody(input({}, { code: 'X'.repeat(33) }))).toThrow(MssEventBodyError);
    expect(() => buildMssEventBody(input({ sequence: 0 }))).toThrow(MssEventBodyError);
    expect(() => buildMssEventBody(input({}, { itemNames: [] }))).toThrow(MssEventBodyError);
    expect(() => buildMssEventBody(input({ eventId: 'short' }))).toThrow(MssEventBodyError);
  });

  // sha256 tính từ mss-order-event-body.ts của origin/main trước w35-01 (cùng đầu vào): thân người mua không đổi một byte.
  it.each([
    ['order.created', '7b61865e794351a4a9e37bb42f7b9a6183bb162e89c4fc4097033ce92e2ec719'],
    ['order.payment_confirmed', '214d61ec5603e28199a1fcd20e596a082e4d5996fa040d3fea176a78b03c83cd'],
    ['order.shipping', '6c1bc1865eb11edd4088acddbc6a3abf0b3660016b4d69d1c01c2bc6634ebb32'],
    ['order.delivered', '093fd624cc1377b0244b40496438a5e2fda93faaa47dc7280b25b17379aa078e'],
    ['order.cancelled', '63212d93d3fb05fe14adc2e9c22dcbd0a483f19ac9ae046f98470a660364be29'],
  ] as const)('người mua %s: thân giống hệt v1.2 (sha256 cố định, không có khoá role)', (eventType, sha256) => {
    const extra = { eventType, cancelReason: 'CUSTOMER' as const, refundExpected: true };
    expect(buildMssEventBody(input(extra)).sha256).toBe(sha256);
    const explicitBuyer = buildMssEventBody(input({ ...extra, recipient: { phone: '0901234567', phoneSource: 'account_verified', name: 'Lan', role: 'buyer' } }));
    expect(explicitBuyer.sha256).toBe(sha256);
    expect(explicitBuyer.json).not.toContain('"role"');
  });

  it('người nhận (PO A1): total_vnd 0, không tên món, không link, không tên gọi, có role và vận đơn; khớp schema', () => {
    const recipient = { phone: '0987654321', phoneSource: 'checkout_contact' as const, name: 'Lan', role: 'recipient' as const };
    for (const eventType of ['order.shipping', 'order.delivered'] as const) {
      const json = buildMssEventBody(input({ eventType, recipient }, { total: 777555, itemNames: ['Nước giặt sinh học Fuwa3e 2L'] })).json;
      const body = JSON.parse(json);
      expect(validate(SCHEMA, body)).toEqual([]);
      expect(body.order.total_vnd).toBe(0);
      expect(body.order).not.toHaveProperty('first_item_name');
      expect(body.order).not.toHaveProperty('tracking_url');
      expect(body.recipient).toEqual({ phone: '0987654321', phone_source: 'checkout_contact', role: 'recipient' });
      expect(json).not.toMatch(/777555|Fuwa|https?:|tubutree\.com|Lan/);
      if (eventType === 'order.shipping') expect(body.order).toMatchObject({ carrier: 'GHN', tracking_code: 'GHN8X2K9' });
    }
    const sample = JSON.parse(readFileSync(join(FIXTURES, 'order-event.recipient.json'), 'utf8'));
    expect(validate(SCHEMA, sample)).toEqual([]);
    expect(validate(SCHEMA, { ...sample, recipient: { ...sample.recipient, role: 'gift' } })).toEqual(['$.recipient.role: ngoài enum']);
  });

  it('người nhận chỉ có tin giao hàng và chỉ nguồn checkout_contact: sai thì MssEventBodyError (bỏ dòng, không hỏng đơn)', () => {
    const recipient = { phone: '0987654321', phoneSource: 'checkout_contact' as const, role: 'recipient' as const };
    for (const eventType of ['order.created', 'order.payment_confirmed', 'order.cancelled'] as const) {
      expect(() => buildMssEventBody(input({ eventType, recipient }))).toThrow(MssEventBodyError);
    }
    expect(() => buildMssEventBody(input({ recipient: { ...recipient, phoneSource: 'account_verified' } }))).toThrow(MssEventBodyError);
  });

  it('newEventId là ULID 26 ký tự, tăng theo thời gian; vnIso qua nửa đêm', () => {
    const a = newEventId(1_700_000_000_000);
    const b = newEventId(1_700_000_000_001);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a.slice(0, 10) < b.slice(0, 10)).toBe(true);
    expect(vnIso(new Date('2026-12-31T20:00:00Z'))).toBe('2027-01-01T03:00:00+07:00');
  });

  it('greetingName lấy chữ cuối, bỏ tên mặc định', () => {
    expect(greetingName('Nguyễn Thị Lan')).toBe('Lan');
    expect(greetingName('Khách')).toBeNull();
    expect(greetingName('  ')).toBeNull();
    expect(greetingName(null)).toBeNull();
  });
});

describe('hàm thuần của outbox', () => {
  it('nextRetryAt: lịch 30s, 2m, 10m, 30m, 2h ±20%, tôn trọng Retry-After, hết sau 6 lần gọi', () => {
    const now = 1_000_000;
    MSS_RETRY_DELAYS_MS.forEach((base, i) => {
      expect(nextRetryAt(i + 1, now, undefined, () => 0)!.getTime() - now).toBe(Math.round(base * 0.8));
      expect(nextRetryAt(i + 1, now, undefined, () => 1)!.getTime() - now).toBe(Math.round(base * 1.2));
    });
    expect(nextRetryAt(1, now, 600, () => 0.5)!.getTime() - now).toBe(600_000);
    expect(nextRetryAt(6, now)).toBeNull();
  });

  it('fallbackDecision: sent không cần, unknown và 409 chỉ trong app, bị thay chỉ trong app, còn lại ZNS khi có tin hoãn', () => {
    expect(fallbackDecision('RESULT_SENT', null, true)).toBe('NONE');
    expect(fallbackDecision('RESULT_UNKNOWN', null, true)).toBe('IN_APP_ONLY');
    expect(fallbackDecision('DEAD', 'event_id_reused', true)).toBe('IN_APP_ONLY');
    expect(fallbackDecision('RESULT_SKIPPED', 'superseded', true)).toBe('IN_APP_ONLY');
    expect(fallbackDecision('RESULT_SKIPPED', 'no_zalo', true)).toBe('ZNS');
    expect(fallbackDecision('RESULT_FAILED', 'bridge_error', false)).toBe('IN_APP_ONLY');
    expect(fallbackDecision('EXPIRED', 'ttl', true)).toBe('ZNS');
    expect(fallbackDecision('DEAD', 'unauthorized', true)).toBe('ZNS');
    expect(fallbackDecision('CANCELLED', 'admin_cancelled', true)).toBe('ZNS');
    expect(fallbackDecision('PENDING', null, true)).toBe('NONE');
  });

  it('normalizeVnPhone', () => {
    expect(normalizeVnPhone('+84901234567')).toBe('0901234567');
    expect(normalizeVnPhone('84 901 234 567')).toBe('0901234567');
    expect(normalizeVnPhone('090.123.4567')).toBe('0901234567');
    expect(normalizeVnPhone('0201234567')).toBeNull();
    expect(normalizeVnPhone('12345')).toBeNull();
  });

  it('mssEventTypeForZns: "đơn đã xác nhận" chọn loại theo chính tin (có dòng đã nhận tiền là thanh toán), không lấy dòng loại khác', () => {
    expect(mssEventTypeForZns('ORDER_CONFIRMED', { order_code: 'TB1' })).toBe('order.created');
    expect(mssEventTypeForZns('ORDER_CONFIRMED', { order_code: 'TB1', payment_note: 'Đã nhận thanh toán' })).toBe('order.payment_confirmed');
    expect(mssEventTypeForZns('ORDER_SHIPPING', { order_code: 'TB1' })).toBe('order.shipping');
    expect(mssEventTypeForZns('ORDER_DELIVERED', {})).toBe('order.delivered');
    expect(mssEventTypeForZns('ORDER_CANCELLED', {})).toBe('order.cancelled');
    expect(mssEventTypeForZns('ORDER_AWAITING_PAYMENT', { order_code: 'TB1' })).toBeNull();
  });

  it('rollout ổn định theo khách và chỉ thêm khách khi tăng tỉ lệ', () => {
    const ids = Array.from({ length: 400 }, (_, i) => `user-${i}`);
    expect(ids.every((id) => rolloutBucket(id) === rolloutBucket(id))).toBe(true);
    const at20 = ids.filter((id) => inRollout(id, 20));
    const at50 = ids.filter((id) => inRollout(id, 50));
    expect(at20.every((id) => at50.includes(id))).toBe(true);
    expect(ids.filter((id) => inRollout(id, 0))).toEqual([]);
    expect(ids.filter((id) => inRollout(id, 100))).toHaveLength(400);
    expect(at50.length).toBeGreaterThan(140);
    expect(at50.length).toBeLessThan(260);
  });
});
