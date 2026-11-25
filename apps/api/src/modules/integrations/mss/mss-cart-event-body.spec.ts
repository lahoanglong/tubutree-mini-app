import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCartAbandonedBody, buildCartRecoveredBody, MSS_CART_BODY_MAX_BYTES, MssCartBodyError, type CartAbandonedBodyInput } from './mss-cart-event-body';
import { cartConsentOf, cartConsentSource, cartExpiresAt, cartRefOf, MSS_CART_ABANDONED_TTL_MS, MSS_CART_RECOVERED_TTL_MS, type MssCartConsentUser } from './mss-cart-event-types';
import { newEventId } from './mss-order-event-body';

const FIXTURES = join(__dirname, '../../../../test/fixtures/mss');
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Record<string, unknown>;

/** Bộ khoá lồng nhau (khoá: kiểu) để so hình dạng thân với hợp đồng mà không so giá trị. */
function shape(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, shape(x)]));
  }
  return typeof v;
}

const base = (): CartAbandonedBodyInput => ({
  eventId: '01JZX3K9Q2ABCDEFGHJKMNPQRS',
  occurredAt: new Date('2026-11-25T03:00:00Z'),
  cart: { ref: 'c_cm0000000000000000000000a_1795572000', updatedAt: new Date('2026-11-25T02:00:00Z'), itemCount: 2, firstItemName: 'Nước rửa chén hữu cơ' },
  customer: { phone: '0907345678', phoneSource: 'account_verified' },
  consent: { at: new Date('2026-11-01T03:00:00Z'), source: 'web_checkout' },
});

const user = (over: Partial<MssCartConsentUser> = {}): MssCartConsentUser => ({
  phone: '0907345678',
  phoneVerifiedAt: new Date('2026-10-01T00:00:00Z'),
  isBlocked: false,
  notifyPromo: true,
  notifyPromoAt: new Date('2026-11-01T03:00:00Z'),
  notifyOrderZalo: true,
  notifyOrderZaloAt: new Date('2026-11-02T03:00:00Z'),
  notifyOrderZaloSource: 'checkout',
  ...over,
});

describe('buildCartAbandonedBody (hợp đồng cart-events v1)', () => {
  it('đúng bộ khoá của fixture hợp đồng, đúng giá trị (giờ VN có múi giờ)', () => {
    const body = buildCartAbandonedBody(base());
    const parsed = JSON.parse(body.json) as Record<string, unknown>;
    expect(shape(parsed)).toEqual(shape(fixture('cart-event-abandoned.json')));
    expect(parsed).toEqual(fixture('cart-event-abandoned.json'));
    expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('không có giá, link hay tên khách ở bất kỳ tầng nào', () => {
    const json = buildCartAbandonedBody(base()).json;
    for (const banned of ['price', 'total', 'url', 'link', 'name"', 'resume']) expect(json).not.toContain(`"${banned}`);
  });

  it('first_item_name: cắt ở 120 ký tự (không chẻ ký tự ngoài BMP), rỗng thì bỏ khoá', () => {
    const long = '🧴' + 'a'.repeat(200);
    const cart = JSON.parse(buildCartAbandonedBody({ ...base(), cart: { ...base().cart, firstItemName: long } }).json).cart as Record<string, string>;
    expect([...cart.first_item_name!].length).toBe(120);
    expect(cart.first_item_name!.startsWith('🧴')).toBe(true);
    const none = JSON.parse(buildCartAbandonedBody({ ...base(), cart: { ...base().cart, firstItemName: '   ' } }).json).cart as Record<string, unknown>;
    expect(none).not.toHaveProperty('first_item_name');
  });

  it('item_count kẹp ở 9999; consent.source cắt 40 ký tự; checkout_contact được nhận', () => {
    const parsed = JSON.parse(
      buildCartAbandonedBody({ ...base(), cart: { ...base().cart, itemCount: 12000 }, customer: { phone: '0907345678', phoneSource: 'checkout_contact' }, consent: { at: base().consent.at, source: 'x'.repeat(60) } }).json,
    ) as { cart: { item_count: number }; consent: { source: string }; customer: { phone_source: string } };
    expect(parsed.cart.item_count).toBe(9999);
    expect(parsed.consent.source).toHaveLength(40);
    expect(parsed.customer.phone_source).toBe('checkout_contact');
  });

  it.each([
    ['event_id quá ngắn', { eventId: 'abc' }],
    ['event_id có ký tự lạ', { eventId: 'abc def ghi' }],
    ['cart.ref có ký tự ngoài ASCII', { cart: { ...base().cart, ref: 'giỏ-1' } }],
    ['cart.ref quá 64 ký tự', { cart: { ...base().cart, ref: 'c'.repeat(65) } }],
    ['cart.updated_at sau occurred_at', { cart: { ...base().cart, updatedAt: new Date('2026-11-25T04:00:00Z') } }],
    ['item_count 0', { cart: { ...base().cart, itemCount: 0 } }],
    ['SĐT không phải di động VN', { customer: { phone: '0287345678', phoneSource: 'account_verified' as const } }],
    ['consent.source rỗng', { consent: { at: new Date(), source: '  ' } }],
  ])('%s: ném MssCartBodyError', (_label, over) => {
    expect(() => buildCartAbandonedBody({ ...base(), ...over })).toThrow(MssCartBodyError);
  });

  it('newEventId (ULID 26 ký tự) khớp luật event_id của hợp đồng', () => {
    expect(() => buildCartAbandonedBody({ ...base(), eventId: newEventId() })).not.toThrow();
  });

  it('thân lớn nhất có thể vẫn dưới 4096 byte', () => {
    const json = buildCartAbandonedBody({ ...base(), cart: { ...base().cart, ref: 'c'.repeat(64), firstItemName: 'ữ'.repeat(120) }, consent: { at: new Date(), source: 'ữ'.repeat(40) } }).json;
    expect(Buffer.byteLength(json)).toBeLessThan(MSS_CART_BODY_MAX_BYTES);
  });
});

describe('buildCartRecoveredBody', () => {
  it('đúng 5 khoá, cart chỉ có ref', () => {
    const parsed = JSON.parse(buildCartRecoveredBody({ eventId: '01JZX3KA77ABCDEFGHJKMNPQRS', occurredAt: new Date('2026-11-25T03:20:00Z'), cartRef: 'c_cm0000000000000000000000a_1795572000' }).json);
    expect(parsed).toEqual(fixture('cart-event-recovered.json'));
  });
});

describe('cartConsentOf (PO A2: tin đơn qua Zalo VÀ khuyến mãi)', () => {
  const now = new Date('2026-11-25T03:00:00Z');

  it('đủ đồng ý, số đã xác minh: account_verified, consent.at = lúc bật khuyến mãi', () => {
    expect(cartConsentOf(user(), now)).toEqual({ phone: '0907345678', phoneSource: 'account_verified', at: new Date('2026-11-01T03:00:00Z') });
  });

  it('số chưa xác minh mà đọc được: checkout_contact; không có mốc khuyến mãi thì lấy mốc tin Zalo, không có nữa thì lúc ghi', () => {
    expect(cartConsentOf(user({ phoneVerifiedAt: null, phone: '+84 907 345 678', notifyPromoAt: null }), now)).toEqual({
      phone: '0907345678',
      phoneSource: 'checkout_contact',
      at: new Date('2026-11-02T03:00:00Z'),
    });
    expect(cartConsentOf(user({ notifyPromoAt: null, notifyOrderZaloAt: null }), now)).toMatchObject({ at: now });
  });

  it.each([
    ['chưa đồng ý tin Zalo', { notifyOrderZalo: false }, 'no_consent'],
    ['tắt khuyến mãi', { notifyPromo: false }, 'no_consent'],
    ['MSS báo khách từ chối', { notifyOrderZaloSource: 'mss_opt_out' }, 'opted_out'],
    ['tài khoản bị khoá', { isBlocked: true }, 'blocked'],
    ['không có SĐT', { phone: null }, 'no_phone'],
    ['SĐT bàn', { phone: '0287345678' }, 'no_phone'],
  ] as const)('%s → %s', (_l, over, out) => {
    expect(cartConsentOf(user(over as Partial<MssCartConsentUser>), now)).toBe(out);
  });
});

describe('cartConsentSource, cartRefOf, cartExpiresAt', () => {
  it('nguồn đồng ý theo nơi khách bật', () => {
    expect(cartConsentSource('checkout', 'web')).toBe('web_checkout');
    expect(cartConsentSource('checkout', 'miniapp')).toBe('miniapp');
    expect(cartConsentSource('checkout', null)).toBe('web_checkout');
    expect(cartConsentSource('account_settings', 'miniapp')).toBe('account');
    expect(cartConsentSource('order_detail', null)).toBe('account');
    expect(cartConsentSource(null, null)).toBe('tubutree');
  });

  it('mỗi lần bỏ giỏ một mã ASCII ≤ 64 ký tự', () => {
    const ref = cartRefOf('cm0000000000000000000000a', new Date('2026-11-25T02:00:00.999Z'));
    expect(ref).toBe('c_cm0000000000000000000000a_1795572000');
    expect(ref).not.toBe(cartRefOf('cm0000000000000000000000a', new Date('2026-11-26T02:00:00Z')));
  });

  it('hạn gửi: abandoned 40 giờ sau lúc bỏ giỏ, recovered 48 giờ sau lúc ghi', () => {
    const at = new Date('2026-11-25T02:00:00Z');
    const now = new Date('2026-11-25T10:00:00Z');
    expect(cartExpiresAt('cart.abandoned', at, now).getTime()).toBe(at.getTime() + MSS_CART_ABANDONED_TTL_MS);
    expect(cartExpiresAt('cart.recovered', at, now).getTime()).toBe(now.getTime() + MSS_CART_RECOVERED_TTL_MS);
  });
});
