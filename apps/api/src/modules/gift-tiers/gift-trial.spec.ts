import { ConflictException } from '@nestjs/common';
import { GIFT_TRIAL_CHANGED, GIFT_TRIAL_MAX_OPTIONS } from '@tubutree/shared-types';
import {
  GIFT_CHOICE_NONE,
  GIFT_TRIAL_ENABLED_KEY,
  GIFT_TRIAL_MIN_ORDER_KEY,
  GIFT_TRIAL_OFF,
  GIFT_TRIAL_OPTIONS_KEY,
  giftTrialBase,
  giftTrialCartDemand,
  giftTrialOptionsProblem,
  giftTrialSummary,
  loadGiftTrialSettings,
  parseGiftTrialMinOrder,
  parseGiftTrialOptions,
  resolveGiftTrial,
  type GiftTrialSettings,
  type GiftTrialStock,
} from './gift-trial';

const stockOf = (...ids: string[]): Map<string, GiftTrialStock> =>
  new Map(ids.map((id) => [id, { variationId: id, productName: `SP ${id}`, variationName: 'Gói thử', slug: `sp-${id}`, thumbnail: null }]));

const settings = (options: { variationId: string; minOrder: number }[], minOrder = 299_000): GiftTrialSettings => ({ enabled: true, minOrder, options });

const configOf = (values: Record<string, unknown>) => ({
  get: async <T>(key: string, fallback?: T) => (key in values ? (values[key] as T) : (fallback as T)),
});

describe('parseGiftTrialMinOrder', () => {
  it('nhận số nguyên đồng trong khoảng, sai dạng thì về 299.000đ', () => {
    expect(parseGiftTrialMinOrder(350_000)).toBe(350_000);
    expect(parseGiftTrialMinOrder(0)).toBe(0);
    for (const bad of ['299000', -1, 1.5, 60_000_000, null, undefined, NaN]) expect(parseGiftTrialMinOrder(bad)).toBe(299_000);
  });
});

describe('parseGiftTrialOptions', () => {
  it('bỏ mục sai dạng và mục trùng, nâng minOrder thấp lên mốc chung, giữ thứ tự cấu hình', () => {
    const out = parseGiftTrialOptions(
      [
        { variationId: 'v1' },
        { variationId: 'v2', minOrder: 100_000 },
        { variationId: 'v3', minOrder: 499_000 },
        { variationId: 'v1', minOrder: 999_000 },
        { variationId: '' },
        { minOrder: 1 },
        { variationId: 'v4', minOrder: '499000' },
        'v5',
        null,
      ],
      299_000,
    );
    expect(out).toEqual([
      { variationId: 'v1', minOrder: 299_000 },
      { variationId: 'v2', minOrder: 299_000 },
      { variationId: 'v3', minOrder: 499_000 },
    ]);
  });

  it(`không phải mảng thì rỗng; tối đa ${GIFT_TRIAL_MAX_OPTIONS} quà`, () => {
    expect(parseGiftTrialOptions({ variationId: 'v1' }, 0)).toEqual([]);
    const many = Array.from({ length: 10 }, (_, i) => ({ variationId: `v${i}` }));
    expect(parseGiftTrialOptions(many, 0)).toHaveLength(GIFT_TRIAL_MAX_OPTIONS);
  });
});

describe('loadGiftTrialSettings', () => {
  it('cờ không đúng true thì tắt, không đọc gì thêm', async () => {
    expect(await loadGiftTrialSettings(undefined)).toBe(GIFT_TRIAL_OFF);
    expect(await loadGiftTrialSettings(configOf({ [GIFT_TRIAL_ENABLED_KEY]: 'true' }))).toBe(GIFT_TRIAL_OFF);
  });

  it('cờ bật: mốc chung mặc định 299.000đ và danh sách quà', async () => {
    const s = await loadGiftTrialSettings(configOf({ [GIFT_TRIAL_ENABLED_KEY]: true, [GIFT_TRIAL_OPTIONS_KEY]: [{ variationId: 'v1' }] }));
    expect(s).toEqual({ enabled: true, minOrder: 299_000, options: [{ variationId: 'v1', minOrder: 299_000 }] });
    const t = await loadGiftTrialSettings(
      configOf({ [GIFT_TRIAL_ENABLED_KEY]: true, [GIFT_TRIAL_MIN_ORDER_KEY]: 350_000, [GIFT_TRIAL_OPTIONS_KEY]: [{ variationId: 'v1', minOrder: 300_000 }] }),
    );
    expect(t.options).toEqual([{ variationId: 'v1', minOrder: 350_000 }]);
  });
});

describe('giftTrialBase', () => {
  it('chỉ cộng hàng Tubu Tree giao còn hàng', () => {
    expect(
      giftTrialBase([
        { total: 200_000, fulfiller: { kind: 'TUBU' }, stock: 5 },
        { total: 150_000, fulfiller: { kind: 'MERCHANT' }, stock: 5 },
        { total: 90_000, fulfiller: { kind: 'TUBU' }, stock: 0 },
        { total: 10_000 },
      ]),
    ).toBe(210_000);
  });
});

describe('giftTrialCartDemand', () => {
  it('cộng số lượng theo biến thể, bỏ dòng thiếu id hoặc số lượng', () => {
    const d = giftTrialCartDemand([
      { total: 1, variationId: 'gift', quantity: 2 },
      { total: 1, variationId: 'gift', quantity: 1 },
      { total: 1, variationId: 'other', quantity: 4 },
      { total: 1 },
    ]);
    expect([...d]).toEqual([
      ['gift', 3],
      ['other', 4],
    ]);
  });
});

describe('giftTrialSummary', () => {
  const two = settings([
    { variationId: 'big', minOrder: 499_000 },
    { variationId: 'small', minOrder: 299_000 },
  ]);

  it('cờ tắt hoặc không còn quà nào còn hàng thì null', () => {
    expect(giftTrialSummary(GIFT_TRIAL_OFF, 999_999, stockOf('small'), null)).toBeNull();
    expect(giftTrialSummary(two, 999_999, stockOf('other'), null)).toBeNull();
  });

  it('dưới mốc: chưa chọn quà, báo số còn thiếu tới mốc đầu', () => {
    const s = giftTrialSummary(two, 254_000, stockOf('small', 'big'), null)!;
    expect(s.options.map((o) => [o.variationId, o.unlocked])).toEqual([
      ['small', false],
      ['big', false],
    ]);
    expect(s).toMatchObject({ base: 254_000, minOrder: 299_000, nextMinOrder: 299_000, shortfall: 45_000, selectedVariationId: null, declined: false });
  });

  it('đúng mốc thì mở; chưa chọn thì lấy quà đầu tiên đã mở và báo mốc kế', () => {
    const s = giftTrialSummary(two, 299_000, stockOf('small', 'big'), null)!;
    expect(s).toMatchObject({ selectedVariationId: 'small', nextMinOrder: 499_000, shortfall: 200_000 });
  });

  it('quà khách chọn còn mở thì giữ; chưa mở hoặc đã hết thì rơi về quà đầu tiên đã mở', () => {
    expect(giftTrialSummary(two, 600_000, stockOf('small', 'big'), 'big')!.selectedVariationId).toBe('big');
    expect(giftTrialSummary(two, 300_000, stockOf('small', 'big'), 'big')!.selectedVariationId).toBe('small');
    expect(giftTrialSummary(two, 600_000, stockOf('small'), 'big')!.selectedVariationId).toBe('small');
    const all = giftTrialSummary(two, 600_000, stockOf('small', 'big'), null)!;
    expect(all).toMatchObject({ nextMinOrder: null, shortfall: 0 });
  });

  it('"Không nhận quà" không chọn gì kể cả đã đủ mốc', () => {
    const s = giftTrialSummary(two, 600_000, stockOf('small', 'big'), GIFT_CHOICE_NONE)!;
    expect(s).toMatchObject({ selectedVariationId: null, declined: true });
  });
});

describe('resolveGiftTrial', () => {
  const summary = giftTrialSummary(
    settings([
      { variationId: 'small', minOrder: 299_000 },
      { variationId: 'big', minOrder: 499_000 },
    ]),
    320_000,
    stockOf('small', 'big'),
    null,
  );

  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictException);
      return ((e as ConflictException).getResponse() as { code?: string }).code;
    }
    return 'NO_THROW';
  };

  it('app cũ (không gửi) theo lựa chọn ở giỏ, không bắt buộc còn kho', () => {
    expect(resolveGiftTrial(summary, undefined)).toEqual({ variationId: 'small', strict: false });
    expect(resolveGiftTrial(null, undefined)).toBeNull();
  });

  it('null = khách không nhận quà', () => {
    expect(resolveGiftTrial(summary, null)).toBeNull();
  });

  it('quà khách thấy phải đang mở với phần hàng này, sai thì 409 GIFT_TRIAL_CHANGED', () => {
    expect(resolveGiftTrial(summary, 'small')).toEqual({ variationId: 'small', strict: true });
    expect(code(() => resolveGiftTrial(summary, 'big'))).toBe(GIFT_TRIAL_CHANGED);
    expect(code(() => resolveGiftTrial(summary, 'unknown'))).toBe(GIFT_TRIAL_CHANGED);
    expect(code(() => resolveGiftTrial(null, 'small'))).toBe(GIFT_TRIAL_CHANGED);
  });
});

describe('giftTrialOptionsProblem (luật ghi ở tab Cấu hình)', () => {
  it('nhận danh sách rỗng và quà đúng dạng', () => {
    expect(giftTrialOptionsProblem([])).toBeNull();
    expect(giftTrialOptionsProblem([{ variationId: 'v1' }, { variationId: 'v2', minOrder: 499_000 }, { variationId: 'v3', minOrder: null }])).toBeNull();
  });

  it('từ chối cả danh sách khi có mục sai thay vì âm thầm bỏ', () => {
    const bad: unknown[] = [
      { variationId: 'v1' },
      [{ variationId: 'v1' }, { variationId: 'v1' }],
      [{ variationId: '' }],
      [{ variationId: 'v1', minOrder: '299000' }],
      [{ variationId: 'v1', minOrder: -1 }],
      [{ variationId: 'v1', price: 0 }],
      ['v1'],
      Array.from({ length: GIFT_TRIAL_MAX_OPTIONS + 1 }, (_, i) => ({ variationId: `v${i}` })),
    ];
    for (const value of bad) expect(giftTrialOptionsProblem(value)).not.toBeNull();
  });
});
