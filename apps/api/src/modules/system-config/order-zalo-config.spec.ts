import { rolloutBucket } from '../integrations/mss/mss-order-event-types';
import { buildPublicConfig } from './public-config';
import { OrderZaloConfigController } from './order-zalo-config.controller';
import { TUBU_ZALO_PHONE_DEFAULT, maskOrderZaloPhone, orderZaloGateOpen, orderZaloStatus, tubuZaloPhoneOf, type OrderZaloGate } from './order-zalo-config';

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

  it('PO A2: số chưa xác minh vẫn là số nhận (checkout_contact); không có số hoặc số hỏng thì null (client dùng số nhận hàng)', () => {
    expect(orderZaloStatus(ON, user(), false, undefined)).toMatchObject({ phoneMasked: '090•••4567', buyerPhone: '0901234567', phoneSource: 'account_verified' });
    expect(orderZaloStatus(ON, user({ phoneVerifiedAt: null }), false, undefined)).toMatchObject({ phoneMasked: '090•••4567', buyerPhone: '0901234567', phoneSource: 'checkout_contact' });
    expect(orderZaloStatus(ON, user({ phone: '12345' }), false, undefined)).toMatchObject({ phoneMasked: null, buyerPhone: null, phoneSource: null });
    expect(orderZaloStatus(ON, user({ phone: null }), false, undefined)).toMatchObject({ phoneMasked: null, buyerPhone: null, phoneSource: null });
    expect(orderZaloStatus({ ...ON, rolloutPct: 0 }, user(), false, undefined)).toMatchObject({ phoneMasked: null, buyerPhone: null });
    expect(maskOrderZaloPhone('0901234567')).toBe('090•••4567');
    expect(maskOrderZaloPhone(null)).toBeNull();
  });

  it('recipientEnabled chỉ khi ô đồng ý hiện và cổng người nhận mở (cờ + năng lực MSS)', () => {
    expect(orderZaloStatus({ ...ON, recipient: true }, user(), false, undefined).recipientEnabled).toBe(true);
    expect(orderZaloStatus(ON, user(), false, undefined).recipientEnabled).toBe(false);
    expect(orderZaloStatus({ ...ON, recipient: true, rolloutPct: 0 }, user(), false, undefined).recipientEnabled).toBe(false);
    expect(orderZaloStatus({ ...ON, recipient: true, open: false }, user(), false, undefined).recipientEnabled).toBe(false);
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

  it('orderZaloGuest (PO A2, khách vãng lai): chỉ khi cổng mở cho 100% khách', async () => {
    expect((await buildPublicConfig(cfg(), undefined, () => ON)).orderZaloGuest).toBe(true);
    expect((await buildPublicConfig(cfg(), undefined, () => ({ ...ON, rolloutPct: 99 }))).orderZaloGuest).toBe(false);
    expect((await buildPublicConfig(cfg(), undefined, () => ({ ...ON, open: false }))).orderZaloGuest).toBe(false);
    expect((await buildPublicConfig(cfg())).orderZaloGuest).toBe(false);
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
    const prisma = { user: { findUniqueOrThrow }, mssOrderEventOutbox: { findFirst: jest.fn(async () => null) } } as never;
    const config = { get: jest.fn(async (_k: string, fallback?: unknown) => fallback) } as never;
    const ctrl = new OrderZaloConfigController(prisma, config, { gate: () => ON } as never);
    const res = await ctrl.orderZalo(inside);
    expect(findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: inside } }));
    expect(res).toEqual({
      enabled: true,
      prechecked: false,
      choice: null,
      phoneMasked: '090•••4567',
      buyerPhone: '0901234567',
      phoneSource: 'account_verified',
      recipientEnabled: false,
      tubuZaloPhone: '0899149229',
      friendKnown: false,
    });
    // Số đầy đủ chỉ là số của chính người gọi (để so với số nhận hàng ở thanh toán); che ở mọi chỗ hiển thị.
    expect(JSON.stringify({ ...res, buyerPhone: null })).not.toContain('0901234567');
  });

  it('không có MssModule (cờ chưa từng nạp): tắt', async () => {
    const prisma = { user: { findUniqueOrThrow: jest.fn(async () => user()) } } as never;
    const config = { get: jest.fn(async (_k: string, fallback?: unknown) => fallback) } as never;
    expect((await new OrderZaloConfigController(prisma, config).orderZalo(inside)).enabled).toBe(false);
  });

  describe('U1 friendKnown: MSS đã gửi xong tin đơn của chính khách, không phải tin người lạ, trong 90 ngày', () => {
    type Where = { order: { userId: string }; recipientRole: string; status: string; resultReason: null; resultAt: { gte: Date } };
    type Row = { userId: string; recipientRole: string; status: string; resultReason: string | null; resultAt: Date };
    const DAY = 86_400_000;
    /** Bộ giả áp đúng where mà controller gửi xuống. */
    const setup = (rows: Row[], gate: OrderZaloGate | undefined = ON) => {
      const findFirst = jest.fn(async ({ where }: { where: Where }) => {
        const hit = rows.find(
          (r) =>
            r.userId === where.order.userId &&
            r.recipientRole === where.recipientRole &&
            r.status === where.status &&
            r.resultReason === where.resultReason &&
            r.resultAt >= where.resultAt.gte,
        );
        return hit ? { id: 'x' } : null;
      });
      const prisma = { user: { findUniqueOrThrow: jest.fn(async () => user({ id: inside })) }, mssOrderEventOutbox: { findFirst } } as never;
      const config = { get: jest.fn(async (_k: string, fallback?: unknown) => fallback) } as never;
      return { ctrl: new OrderZaloConfigController(prisma, config, (gate ? { gate: () => gate } : undefined) as never), findFirst };
    };
    const sent = (over: Partial<Row> = {}): Row => ({ userId: inside, recipientRole: 'buyer', status: 'RESULT_SENT', resultReason: null, resultAt: new Date(Date.now() - DAY), ...over });

    it('RESULT_SENT lý do null trong 90 ngày: true', async () => {
      expect((await setup([sent()]).ctrl.orderZalo(inside)).friendKnown).toBe(true);
    });

    it.each<[string, Partial<Row>]>([
      ['tin người lạ (reason stranger)', { resultReason: 'stranger' }],
      ['quá 90 ngày', { resultAt: new Date(Date.now() - 91 * DAY) }],
      ['dòng người nhận (số khác)', { recipientRole: 'recipient' }],
      ['bị bỏ qua (not_friend)', { status: 'RESULT_SKIPPED', resultReason: 'not_friend' }],
      ['không rõ kết quả', { status: 'RESULT_UNKNOWN' }],
      ['đơn của khách khác', { userId: outside }],
    ])('%s: false', async (_n, over) => {
      expect((await setup([sent(over)]).ctrl.orderZalo(inside)).friendKnown).toBe(false);
    });

    it('cờ tắt: false và không truy vấn outbox', async () => {
      const { ctrl, findFirst } = setup([sent()], { enabled: false, open: false, rolloutPct: 0 });
      expect((await ctrl.orderZalo(inside)).friendKnown).toBe(false);
      expect(findFirst).not.toHaveBeenCalled();
    });

    it('hàm thuần: friendKnown chỉ đúng khi khách thấy được tính năng', () => {
      expect(orderZaloStatus(ON, user(), false, undefined, true).friendKnown).toBe(true);
      expect(orderZaloStatus({ ...ON, rolloutPct: 0 }, user(), false, undefined, true).friendKnown).toBe(false);
      expect(orderZaloStatus(ON, user(), false, undefined).friendKnown).toBe(false);
    });
  });
});
