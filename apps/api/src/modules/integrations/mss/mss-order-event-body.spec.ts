import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BILL_MAX_ITEMS,
  buildMssEventBody,
  greetingName,
  MSS_BILL_BODY_BUDGET_BYTES,
  MssEventBodyError,
  newEventId,
  vnIso,
  type MssBillInput,
  type MssEventBodyInput,
} from './mss-order-event-body';
import {
  fallbackDecision,
  inRollout,
  mssDefinitelyRejected,
  mssEmailEligible,
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
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  items?: Schema;
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
    if (schema.maximum !== undefined && (value as number) > schema.maximum) errors.push(`${path}: lớn hơn ${schema.maximum}`);
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [...errors, `${path}: không phải mảng`];
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: ít hơn ${schema.minItems} phần tử`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: nhiều hơn ${schema.maxItems} phần tử`);
    value.forEach((v, i) => errors.push(...validate(schema.items ?? {}, v, `${path}[${i}]`)));
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

describe('buildMssEventBody: bill (năng lực order_events.bill_v1, w37-01)', () => {
  const ITEMS: MssBillInput['items'] = [
    { name: 'Nước giặt sinh học Fuwa3e 2L', variant: 'Can 2L', qty: 2, unitPrice: 120_000, lineTotal: 240_000, gift: false },
    { name: 'Nước rửa chén', variant: '', qty: 1, unitPrice: 30_000, lineTotal: 30_000, gift: false },
    { name: 'Túi vải', variant: null, qty: 1, unitPrice: 0, lineTotal: 0, gift: true },
  ];
  const BILL: MssBillInput = { subtotal: 270_000, discount: 45_000, shippingFee: 20_000, items: ITEMS };
  const LINK = 'https://tubutree.com/tai-khoan/don-hang/TB-261116-0412';
  const NAMES = ITEMS.map((i) => i.name);
  const billed = (eventType: MssEventBodyInput['eventType'], bill: MssBillInput | null = BILL, order: Partial<MssEventBodyInput['order']> = {}) =>
    buildMssEventBody(input({ eventType, bill }, { total: 245_000, itemNames: NAMES, linkUrl: LINK, ...order }));
  const orderOf = (json: string) => JSON.parse(json).order as Record<string, unknown>;
  const many = (n: number, name: (i: number) => string) =>
    Array.from({ length: n }, (_, i) => ({ name: name(i), variant: null, qty: 1, unitPrice: 10_000, lineTotal: 10_000, gift: false }));

  it('(a) không bill, linkUrl trùng đường dẫn tài khoản: sha256 cả 5 loại giống hệt bản trước w37', () => {
    const before: Record<string, string> = {
      'order.created': '7b61865e794351a4a9e37bb42f7b9a6183bb162e89c4fc4097033ce92e2ec719',
      'order.payment_confirmed': '214d61ec5603e28199a1fcd20e596a082e4d5996fa040d3fea176a78b03c83cd',
      'order.shipping': '6c1bc1865eb11edd4088acddbc6a3abf0b3660016b4d69d1c01c2bc6634ebb32',
      'order.delivered': '093fd624cc1377b0244b40496438a5e2fda93faaa47dc7280b25b17379aa078e',
      'order.cancelled': '63212d93d3fb05fe14adc2e9c22dcbd0a483f19ac9ae046f98470a660364be29',
    };
    for (const eventType of MSS_ORDER_EVENT_TYPES) {
      const extra = { eventType, cancelReason: 'CUSTOMER' as const, refundExpected: true };
      expect(buildMssEventBody(input({ ...extra, bill: null }, { linkUrl: LINK })).sha256).toBe(before[eventType]);
      expect(buildMssEventBody(input({ ...extra, bill: undefined }, { linkUrl: null })).sha256).toBe(before[eventType]);
    }
  });

  it('(b) created/payment_confirmed: khoá v1.2 giữ nguyên thứ tự, sáu khoá bill nối sau; món theo thứ tự đầu vào, variant rỗng bỏ, gift chỉ true', () => {
    for (const eventType of ['order.created', 'order.payment_confirmed'] as const) {
      const order = orderOf(billed(eventType, BILL, { checkoutGroup: 'G-1', groupSize: 2 }).json);
      expect(Object.keys(order)).toEqual([
        'code',
        'total_vnd',
        'payment_method',
        'channel',
        'item_count',
        'first_item_name',
        'group_code',
        'group_size',
        'detail_url',
        'subtotal_vnd',
        'discount_vnd',
        'shipping_fee_vnd',
        'items',
      ]);
      expect(order).toMatchObject({ detail_url: LINK, subtotal_vnd: 270_000, discount_vnd: 45_000, shipping_fee_vnd: 20_000 });
      expect(order.items).toEqual([
        { name: 'Nước giặt sinh học Fuwa3e 2L', variant: 'Can 2L', qty: 2, unit_vnd: 120_000, line_vnd: 240_000 },
        { name: 'Nước rửa chén', qty: 1, unit_vnd: 30_000, line_vnd: 30_000 },
        { name: 'Túi vải', qty: 1, unit_vnd: 0, line_vnd: 0, gift: true },
      ]);
      expect(order).not.toHaveProperty('items_more');
      expect(order).not.toHaveProperty('tracking_url');
    }
  });

  it('(c) dòng người nhận có bill: MssEventBodyError; shipping/delivered/cancelled của người mua: bỏ qua bill, thân như không có bill', () => {
    const recipient = { phone: '0987654321', phoneSource: 'checkout_contact' as const, role: 'recipient' as const };
    for (const eventType of ['order.shipping', 'order.delivered'] as const) {
      expect(() => buildMssEventBody(input({ eventType, recipient, bill: BILL }))).toThrow(MssEventBodyError);
      expect(() => buildMssEventBody(input({ eventType, recipient, bill: null }))).not.toThrow();
    }
    for (const eventType of ['order.shipping', 'order.delivered', 'order.cancelled'] as const) {
      const withBill = billed(eventType);
      expect(withBill.json).toBe(billed(eventType, null).json);
      const order = orderOf(withBill.json);
      for (const k of ['detail_url', 'items', 'items_more', 'subtotal_vnd', 'discount_vnd', 'shipping_fee_vnd']) expect(order).not.toHaveProperty(k);
    }
  });

  it('(d) tiền lệch tổng đơn (hay âm, lẻ): không có ba khoá tiền, món và link vẫn đi', () => {
    for (const bill of [
      { ...BILL, discount: 44_000 },
      { ...BILL, shippingFee: -1, subtotal: 270_001 },
      { ...BILL, subtotal: 270_000.5, discount: 45_000.5 },
    ]) {
      const order = orderOf(billed('order.created', bill).json);
      for (const k of ['subtotal_vnd', 'discount_vnd', 'shipping_fee_vnd']) expect(order).not.toHaveProperty(k);
      expect(order).toMatchObject({ detail_url: LINK });
      expect(order.items).toHaveLength(3);
    }
  });

  it('(e) 16 món: 15 món đầu + items_more 1; món sai (qty 0, giá âm, tên rỗng) thì bỏ cả danh sách món, không bỏ sự kiện', () => {
    const items = many(16, (i) => `Món ${i + 1}`);
    const order = orderOf(billed('order.created', { ...BILL, subtotal: 160_000, discount: 0, shippingFee: 0, items }, { total: 160_000, itemNames: items.map((i) => i.name) }).json);
    expect((order.items as { name: string }[]).map((i) => i.name)).toEqual(items.slice(0, BILL_MAX_ITEMS).map((i) => i.name));
    expect(order.items_more).toBe(1);
    for (const bad of [{ qty: 0 }, { unitPrice: -1 }, { name: '   ' }, { qty: 10_000 }, { lineTotal: 1.5 }]) {
      const broken = billed('order.created', { ...BILL, items: [{ ...ITEMS[0]!, ...bad }, ITEMS[1]!, ITEMS[2]!] });
      const o = orderOf(broken.json);
      expect(o).not.toHaveProperty('items');
      expect(o).not.toHaveProperty('items_more');
      expect(o).toMatchObject({ detail_url: LINK, subtotal_vnd: 270_000 });
    }
  });

  it('(f) 15 món × 60 ký tự 4 byte: thân ≤ 6.144 B, bỏ món từ cuối và items_more = item_count − số món giữ; tên cắt 60 ký tự, variant 30', () => {
    const emoji = String.fromCodePoint(0x1f33f);
    const items = many(15, () => emoji.repeat(80)).map((i) => ({ ...i, variant: emoji.repeat(40) }));
    const body = billed('order.created', { ...BILL, subtotal: 150_000, discount: 0, shippingFee: 0, items }, { total: 150_000, itemNames: items.map((i) => i.name) });
    expect(Buffer.byteLength(body.json, 'utf8')).toBeLessThanOrEqual(MSS_BILL_BODY_BUDGET_BYTES);
    const order = orderOf(body.json);
    const kept = order.items as { name: string; variant: string }[];
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(15);
    expect(order.items_more).toBe(15 - kept.length);
    expect([...kept[0]!.name]).toHaveLength(60);
    expect([...kept[0]!.variant]).toHaveLength(30);
    // Thêm đúng một món nữa thì vượt ngân sách: bộ cắt giữ nhiều món nhất có thể.
    const plusOne = JSON.parse(body.json);
    plusOne.order.items.push(plusOne.order.items[0]);
    plusOne.order.items_more = 15 - kept.length - 1 || undefined;
    expect(Buffer.byteLength(JSON.stringify(plusOne), 'utf8')).toBeGreaterThan(MSS_BILL_BODY_BUDGET_BYTES);
  });

  it('(f2) hết món mà vẫn vượt ngân sách: bỏ hết khoá bill, sự kiện vẫn đi đúng bản không bill', () => {
    // Với trần tên/variant hiện tại một món không thể vượt 6.144 B; giả byteLength để chạy nhánh phòng hờ này.
    const real = Buffer.byteLength.bind(Buffer);
    const spy = jest.spyOn(Buffer, 'byteLength').mockImplementation(((v: string, enc?: BufferEncoding) =>
      typeof v === 'string' && v.includes('"detail_url"') ? MSS_BILL_BODY_BUDGET_BYTES + 1 : real(v, enc)) as typeof Buffer.byteLength);
    try {
      const withBill = billed('order.created');
      expect(withBill.json).toBe(billed('order.created', null).json);
      const order = orderOf(withBill.json);
      for (const k of ['detail_url', 'items', 'items_more', 'subtotal_vnd', 'discount_vnd', 'shipping_fee_vnd']) expect(order).not.toHaveProperty(k);
    } finally {
      spy.mockRestore();
    }
  });

  it('(g) thân có bill khớp schema fixture; mẫu order-event.bill.json khớp schema; khoá lạ trong món bị bắt', () => {
    for (const eventType of MSS_ORDER_EVENT_TYPES) expect(validate(SCHEMA, JSON.parse(billed(eventType).json))).toEqual([]);
    const items = many(16, (i) => `Món ${i + 1}`);
    expect(validate(SCHEMA, JSON.parse(billed('order.created', { ...BILL, items }, { itemNames: items.map((i) => i.name) }).json))).toEqual([]);
    const sample = JSON.parse(readFileSync(join(FIXTURES, 'order-event.bill.json'), 'utf8'));
    expect(validate(SCHEMA, sample)).toEqual([]);
    expect(sample.order.subtotal_vnd - sample.order.discount_vnd + sample.order.shipping_fee_vnd).toBe(sample.order.total_vnd);
    sample.order.items[0].address = 'x';
    expect(validate(SCHEMA, sample)).toEqual(['$.order.items[0].address: khoá lạ']);
  });

  it('(h) linkUrl khác gốc, dài quá 120 hay có khoảng trắng: bỏ khoá link (cả detail_url lẫn tracking_url), không dựng đường dẫn tài khoản thay', () => {
    for (const linkUrl of ['https://evil.example/tai-khoan/don-hang/X', 'https://tubutree.com.evil.example/don/X', `https://tubutree.com/don/${'A'.repeat(100)}`, 'https://tubutree.com/don/A B']) {
      const created = orderOf(billed('order.created', BILL, { linkUrl }).json);
      expect(created).not.toHaveProperty('detail_url');
      expect(created.items).toHaveLength(3);
      const shipping = orderOf(buildMssEventBody(input({}, { linkUrl })).json);
      expect(shipping).not.toHaveProperty('tracking_url');
    }
    const guestLink = `https://tubutree.com/don/TB7K4M#k=${'k'.repeat(43)}`;
    expect(orderOf(buildMssEventBody(input({}, { linkUrl: guestLink })).json).tracking_url).toBe(guestLink);
    expect(orderOf(billed('order.created', BILL, { linkUrl: guestLink }).json).detail_url).toBe(guestLink);
    // Gốc chưa đăng ký (linkOrigin null): không link nào, kể cả khi có linkUrl.
    expect(orderOf(buildMssEventBody(input({ linkOrigin: null }, { linkUrl: guestLink })).json)).not.toHaveProperty('tracking_url');
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

  it('MSS W37/W38 tin người lạ: sent/stranger không đường lui, unknown/stranger chỉ trong app, skipped/stranger_cap như privacy_blocked', () => {
    expect(fallbackDecision('RESULT_SENT', 'stranger', true)).toBe('NONE');
    expect(fallbackDecision('RESULT_UNKNOWN', 'stranger', true)).toBe('IN_APP_ONLY');
    expect(fallbackDecision('RESULT_SKIPPED', 'stranger_cap', true)).toBe('ZNS');
    expect(fallbackDecision('RESULT_SKIPPED', 'stranger_cap', false)).toBe('IN_APP_ONLY');
    expect(mssEmailEligible('RESULT_SKIPPED', 'stranger_cap', null)).toBe(true);
    expect(mssEmailEligible('RESULT_UNKNOWN', 'stranger', null)).toBe(false);
    expect(mssEmailEligible('RESULT_SENT', 'stranger', null)).toBe(false);
  });

  it('mssDefinitelyRejected: chỉ 4xx khác 408/409/429 là MSS chắc chắn không nhận', () => {
    for (const http of [400, 401, 413, 422, 499]) expect(mssDefinitelyRejected(http)).toBe(true);
    for (const http of [null, 200, 202, 302, 408, 409, 429, 500, 502, 503]) expect(mssDefinitelyRejected(http)).toBe(false);
  });

  it('mssEmailEligible: DEAD/EXPIRED chỉ email khi MSS từ chối hẳn (hoặc báo mất); 5xx/429/408 thì có thể đã gửi, không email', () => {
    expect(mssEmailEligible('DEAD', 'http_413', 413)).toBe(true);
    expect(mssEmailEligible('DEAD', 'unauthorized', 401)).toBe(true);
    expect(mssEmailEligible('DEAD', 'claim_broken', null)).toBe(true);
    expect(mssEmailEligible('DEAD', 'http_408', 408)).toBe(false);
    expect(mssEmailEligible('DEAD', 'event_id_reused', 409)).toBe(false);
    expect(mssEmailEligible('DEAD', 'event_id_reused', null)).toBe(false);
    expect(mssEmailEligible('EXPIRED', 'retries_exhausted', 503)).toBe(false);
    expect(mssEmailEligible('EXPIRED', 'ttl', 502)).toBe(false);
    expect(mssEmailEligible('EXPIRED', 'ttl', 429)).toBe(false);
    expect(mssEmailEligible('EXPIRED', 'ttl', null)).toBe(false);
    expect(mssEmailEligible('EXPIRED', 'mss_unavailable', 503)).toBe(false);
    expect(mssEmailEligible('EXPIRED', 'mss_lost', 202)).toBe(true);
    expect(mssEmailEligible('EXPIRED', 'mss_lost', null)).toBe(true);
    expect(mssEmailEligible('RESULT_FAILED', 'zalo_error', null)).toBe(true);
    expect(mssEmailEligible('RESULT_SKIPPED', 'superseded', null)).toBe(false);
    expect(mssEmailEligible('CANCELLED', 'consent_withdrawn', null)).toBe(false);
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
