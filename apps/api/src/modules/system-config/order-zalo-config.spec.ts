import { rolloutBucket } from '../integrations/mss/mss-order-event-types';
import { buildPublicConfig } from './public-config';
import { OrderZaloConfigController } from './order-zalo-config.controller';
import { TUBU_ZALO_PHONE_DEFAULT, orderZaloGateOpen, orderZaloStatus, tubuZaloPhoneOf, verifiedPhoneMasked, type OrderZaloGate } from './order-zalo-config';

const ON: OrderZaloGate = { enabled: true, open: true, rolloutPct: 100 };
const verified = { phone: '0901234567', phoneVerifiedAt: new Date('2026-11-01T00:00:00Z') };

/** Hai khách nằm hai bên ngưỡng 50%: kết quả rollout phải đúng như máy chủ dùng khi ghi sự kiện. */
function idWithBucket(pred: (b: number) => boolean): string {
  for (let i = 0; i < 10_000; i++) if (pred(rolloutBucket(`u${i}`))) return `u${i}`;
  throw new Error('không tìm được id');
}
const inside = idWithBucket((b) => b < 50);
const outside = idWithBucket((b) => b >= 50);

const user = (over: Partial<Parameters<typeof orderZaloStatus>[1]> = {}) => ({
  id: inside,
  ...verified,
  notifyOrderZalo: false,
  notifyOrderZaloAt: null,
  ...over,
});

describe('orderZaloStatus: ma trận cờ × rollout × SĐT', () => {
  const gates: Array<[string, OrderZaloGate | undefined, boolean]> = [
    ['cờ tắt', { enabled: false, open: false, rolloutPct: 0 }, false],
    ['cờ bật nhưng MSS chưa công bố order_events', { enabled: true, open: false, rolloutPct: 100 }, false],
    ['cờ bật, tỉ lệ 0', { enabled: true, open: true, rolloutPct: 0 }, false],
    ['không có MssModule', undefined, false],
    ['cờ bật, tỉ lệ 100', ON, true],
  ];
  it.each(gates)('%s', (_name, gate, enabled) => {
    const s = orderZaloStatus(gate, user(), false, undefined);
    expect(s.enabled).toBe(enabled);
    expect(s.phoneMasked).toBe(enabled ? '090•••4567' : null);
  });

  it('tỉ lệ 50%: khách trong nhóm thấy, khách ngoài nhóm không', () => {
    const half = { ...ON, rolloutPct: 50 };
    expect(orderZaloStatus(half, user({ id: inside }), false, undefined).enabled).toBe(true);
    expect(orderZaloStatus(half, user({ id: outside }), false, undefined).enabled).toBe(false);
  });

  it('chưa xác minh số hoặc số không đọc được: không có số nhận (client không hiện ô)', () => {
    expect(orderZaloStatus(ON, user({ phoneVerifiedAt: null }), false, undefined).phoneMasked).toBeNull();
    expect(orderZaloStatus(ON, user({ phone: null }), false, undefined).phoneMasked).toBeNull();
    expect(orderZaloStatus(ON, user({ phone: '12345' }), false, undefined).phoneMasked).toBeNull();
    expect(verifiedPhoneMasked({ phone: '+84901234567', phoneVerifiedAt: new Date() })).toBe('090•••4567');
  });

  it('lựa chọn đã nhớ: null khi chưa từng chọn, đúng giá trị khi đã chọn (kể cả đã tắt)', () => {
    expect(orderZaloStatus(ON, user(), false, undefined).choice).toBeNull();
    expect(orderZaloStatus(ON, user({ notifyOrderZalo: true, notifyOrderZaloAt: new Date() }), false, undefined).choice).toBe(true);
    expect(orderZaloStatus(ON, user({ notifyOrderZalo: false, notifyOrderZaloAt: new Date() }), false, undefined).choice).toBe(false);
  });

  it('tick sẵn chỉ khi cấu hình là boolean true (chuỗi "true" gõ nhầm vẫn là không)', () => {
    expect(orderZaloStatus(ON, user(), true, undefined).prechecked).toBe(true);
    expect(orderZaloStatus(ON, user(), 'true', undefined).prechecked).toBe(false);
  });
});

describe('số Zalo Tubu Tree', () => {
  it('mặc định 0899149229, giá trị hỏng rơi về mặc định', () => {
    expect(TUBU_ZALO_PHONE_DEFAULT).toBe('0899149229');
    expect(tubuZaloPhoneOf(undefined)).toBe('0899149229');
    expect(tubuZaloPhoneOf('089 914 9229')).toBe('0899149229');
    expect(tubuZaloPhoneOf('https://zalo.me/x')).toBe('0899149229');
    expect(tubuZaloPhoneOf(' 0912345678 ')).toBe('0912345678');
  });
});

describe('/config/public: cờ chung của ô đồng ý', () => {
  const cfg = (stored: Record<string, unknown> = {}) =>
    ({ get: jest.fn(async (key: string, fallback?: unknown) => (key in stored ? stored[key] : fallback)) }) as never;

  it('không truyền cổng (API cũ, khối không có MSS): tắt, có số Zalo mặc định', async () => {
    const r = await buildPublicConfig(cfg());
    expect(r).toMatchObject({ orderZaloEnabled: false, orderZaloPrechecked: false, tubuZaloPhone: '0899149229' });
  });

  it('chỉ bật khi cờ bật, MSS nhận sự kiện và tỉ lệ > 0', async () => {
    expect((await buildPublicConfig(cfg(), undefined, () => ON)).orderZaloEnabled).toBe(true);
    expect((await buildPublicConfig(cfg(), undefined, () => ({ ...ON, rolloutPct: 0 }))).orderZaloEnabled).toBe(false);
    expect((await buildPublicConfig(cfg(), undefined, () => ({ ...ON, open: false }))).orderZaloEnabled).toBe(false);
    expect(orderZaloGateOpen(null)).toBe(false);
  });

  it('đọc tick sẵn và số Zalo từ cấu hình', async () => {
    const r = await buildPublicConfig(cfg({ 'mss.order_consent_prechecked': true, 'support.tubu_zalo_phone': '0912345678' }));
    expect(r).toMatchObject({ orderZaloPrechecked: true, tubuZaloPhone: '0912345678' });
  });
});

describe('GET /config/order-zalo', () => {
  it('đọc khách theo token, trả trạng thái máy chủ tính sẵn, không lộ số đầy đủ', async () => {
    const findUniqueOrThrow = jest.fn(async () => ({ ...user({ id: inside }) }));
    const prisma = { user: { findUniqueOrThrow } } as never;
    const config = { get: jest.fn(async (_k: string, fallback?: unknown) => fallback) } as never;
    const ctrl = new OrderZaloConfigController(prisma, config, { gate: () => ON } as never);
    const res = await ctrl.orderZalo(inside);
    expect(findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: inside } }));
    expect(res).toEqual({ enabled: true, prechecked: false, choice: null, phoneMasked: '090•••4567', tubuZaloPhone: '0899149229' });
    expect(JSON.stringify(res)).not.toContain('0901234567');
  });

  it('không có MssModule (cờ chưa từng nạp): tắt', async () => {
    const prisma = { user: { findUniqueOrThrow: jest.fn(async () => user()) } } as never;
    const config = { get: jest.fn(async (_k: string, fallback?: unknown) => fallback) } as never;
    expect((await new OrderZaloConfigController(prisma, config).orderZalo(inside)).enabled).toBe(false);
  });
});
