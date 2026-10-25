// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConfigItem } from './config-item';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { ConfigRow } from '@/lib/admin-client';
import { ADMIN_CONFIG_ROWS } from '@/test-utils/fixtures/admin-config-rows';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const row = (over: Partial<ConfigRow> = {}): ConfigRow => ({
  key: 'shipping.free_threshold',
  value: 200000,
  description: 'Đơn ≥ 200k được freeship',
  category: 'shipping',
  ...over,
});

function setup(r: ConfigRow) {
  const puts: { key: string; value: unknown }[] = [];
  const api = mockFetch({
    '/admin/config': (init) => {
      if (init?.method === 'PUT') puts.push(JSON.parse(String(init.body)));
      return { body: { ok: true } };
    },
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const onSaved = vi.fn();
  return { puts, onSaved, ...mount(<ConfigItem row={r} onSaved={onSaved} />) };
}

describe('ConfigItem (tab Cấu hình)', () => {
  it('khoá đang dùng: sửa JSON rồi Lưu → gửi PUT đúng giá trị đã parse', async () => {
    const { container, puts, onSaved } = setup(row({ key: 'community.facebook_url', value: 'a', category: 'community' }));
    typeInto(container.querySelector('input'), '"b"');
    click(byText(container, 'button', 'Lưu'));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(puts).toEqual([{ key: 'community.facebook_url', value: 'b' }]);
    expect(onSaved).toHaveBeenCalled();
  });

  it('JSON sai → báo lỗi, không gửi PUT', async () => {
    const { container, puts } = setup(row());
    typeInto(container.querySelector('input'), '{oops');
    click(byText(container, 'button', 'Lưu'));
    await flush();
    expect(puts).toHaveLength(0);
    expect(container.textContent).toContain('JSON không hợp lệ');
  });

  // C-054 (A1-032): admin tưởng đã tắt COD / đặt trần COD mà không code nào đọc khoá.
  it('khoá chết (deprecated): nhãn "Không dùng", ô nhập khoá, không có nút Lưu', async () => {
    const { container, puts } = setup(row({ key: 'payment.cod_max_amount', value: 5000000, description: 'Max đơn cho COD', deprecated: true }));
    expect(container.textContent).toContain('Không dùng');
    expect(container.textContent).toMatch(/sửa sẽ không có tác dụng/i);
    expect(container.querySelector('input')?.disabled).toBe(true);
    expect(byText(container, 'button', 'Lưu')).toBeNull();
    await flush();
    expect(puts).toHaveLength(0);
  });

  it('khoá null (chưa đặt, vd ETA giao hàng) hiện "null" và đặt được số đầu tiên', async () => {
    const { container, puts } = setup(row({ key: 'shipping.eta_min_days', value: null, description: 'Giao dự kiến: số ngày tối thiểu' }));
    expect(container.querySelector('input')?.value).toBe('null');
    typeInto(container.querySelector('input'), '2');
    click(byText(container, 'button', 'Lưu'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(puts).toEqual([{ key: 'shipping.eta_min_days', value: 2 }]);
  });

  describe('ADMINOPS-3: khoá tiền/điểm/thanh toán hỏi xác nhận "trước → sau" trước khi ghi', () => {
    it('shipping.free_threshold: hộp xác nhận nêu giá trị cũ và mới; Huỷ thì không gửi', async () => {
      const { container, puts } = setup(row());
      typeInto(container.querySelector('input'), '150000');
      click(byText(container, 'button', 'Lưu'));
      await flush();
      const d = confirmDialog();
      expect(d?.textContent).toContain('shipping.free_threshold');
      expect(d?.textContent).toContain('200000 → 150000');
      answerConfirm(false);
      await flush();
      expect(puts).toHaveLength(0);
    });

    it('payment.bank_account_no: xác nhận rồi mới gửi PUT', async () => {
      const { container, puts } = setup(row({ key: 'payment.bank_account_no', value: '9984606774', category: 'payment' }));
      typeInto(container.querySelector('input'), '"1234567890"');
      click(byText(container, 'button', 'Lưu'));
      await flush();
      expect(puts).toHaveLength(0);
      answerConfirm(true);
      await flush();
      expect(puts).toEqual([{ key: 'payment.bank_account_no', value: '1234567890' }]);
    });

    it('waste.customer_monthly_cap_points: khoá đổi rác cũng hỏi xác nhận (15.4)', async () => {
      const { container, puts } = setup(row({ key: 'waste.customer_monthly_cap_points', value: 60_000, category: 'waste' }));
      typeInto(container.querySelector('input'), '80000');
      click(byText(container, 'button', 'Lưu'));
      await flush();
      expect(confirmDialog()?.textContent).toContain('60000 → 80000');
      expect(puts).toHaveLength(0);
      answerConfirm(true);
      await flush();
      expect(puts).toEqual([{ key: 'waste.customer_monthly_cap_points', value: 80_000 }]);
    });

    // U5-B04: nhóm khoá hoa hồng/mã giảm/hoàn tiền/đại lý/điểm thưởng từng lưu thẳng, không hộp xác nhận.
    it.each([
      ['affiliate.pit_withhold_pct', 10, '1'],
      ['coupon.staff_max_percent', 30, '90'],
      ['cashback.merchant_user_share', 0.5, '0.9'],
      ['dealer.max_discount_pct', 20, '40'],
      ['flashsale.max_discount_pct', 50, '90'],
      ['merchant.commission_pct', 10, '1'],
      ['voucher.welcome_amount', 30_000, '300000'],
      ['referral.referrer_reward_points', 20_000, '2000000'],
      ['groupbuy.discount_pct', 15, '50'],
      ['subscribe.discount_pct', 5, '50'],
      ['community.post_reward_points', 1_000, '100000'],
      ['game.daily_checkin_points', 1_000, '100000'],
      ['coins.referrer_reward', 500, '50000'],
      // Có trong seed (apps/api/prisma/seed.ts) nhưng chưa có trong fixture chụp: 6 → 1 làm voucher vòng quay dùng được cho mọi đơn.
      ['game.spin_voucher_min_order_multiplier', 6, '1'],
    ])('%s: hộp xác nhận nêu giá trị cũ → mới trước khi ghi', async (key, oldValue, next) => {
      const { container, puts } = setup(row({ key, value: oldValue, category: key.split('.')[0] }));
      typeInto(container.querySelector('input'), next);
      click(byText(container, 'button', 'Lưu'));
      await flush();
      const d = confirmDialog();
      expect(d?.textContent).toContain('Xác nhận đổi cấu hình tiền/điểm');
      expect(d?.textContent).toContain(key);
      expect(d?.textContent).toContain(`${oldValue} → ${next}`);
      expect(puts).toHaveLength(0);
      answerConfirm(true);
      await flush();
      expect(puts).toEqual([{ key, value: JSON.parse(next) }]);
    });

    // U3-B03: bậc thưởng doanh số quý đại lý là bảng tiền thật; giá trị là mảng nên hộp xác nhận phải nêu cả bảng cũ và bảng mới.
    it('dealer.quarterly_bonus_tiers: hộp xác nhận nêu bảng bậc cũ → mới, Huỷ thì không gửi, Lưu gửi mảng đã parse', async () => {
      const oldTiers = [{ min: 50_000_000, pct: 2 }, { min: 100_000_000, pct: 3 }];
      const next = '[{"min":50000000,"pct":3},{"min":100000000,"pct":5}]';
      const { container, puts } = setup(row({ key: 'dealer.quarterly_bonus_tiers', value: oldTiers, category: 'dealer' }));
      typeInto(container.querySelector('input'), next);
      click(byText(container, 'button', 'Lưu'));
      await flush();
      const d = confirmDialog();
      expect(d?.textContent).toContain('Xác nhận đổi cấu hình tiền/điểm');
      expect(d?.textContent).toContain('dealer.quarterly_bonus_tiers');
      expect(d?.textContent).toContain(`${JSON.stringify(oldTiers)} → ${next}`);
      answerConfirm(false);
      await flush();
      expect(puts).toHaveLength(0);
      click(byText(container, 'button', 'Lưu'));
      await flush();
      answerConfirm(true);
      await flush();
      expect(puts).toEqual([{ key: 'dealer.quarterly_bonus_tiers', value: JSON.parse(next) }]);
    });

    // Khoá lấy từ dòng GET /admin/config thật (fixture), không bịa tên: giải POINTS tới 100.000 điểm, thưởng premium 5.000-30.000 điểm,
    // đơn tối thiểu của coupon thu hoạch/voucher vòng quay, số lượt mua quay bằng điểm, tiền phạt đi trễ.
    it.each([
      'game.spin_prizes',
      'seasonpass.tiers',
      'game.harvest_coupon_min_order',
      'game.spin_buy_daily_limit',
      'game.spin_buy_cost_points',
      'game.tree_points_price',
      'attendance.late_fine',
    ])('%s (dòng thật trong cấu hình): hỏi xác nhận trước khi ghi', async (key) => {
      const real = ADMIN_CONFIG_ROWS.find((r) => r.key === key);
      expect(real, `fixture thiếu ${key}`).toBeDefined();
      const { container, puts } = setup(real!);
      const next = JSON.stringify(real!.value) + ' ';
      typeInto(container.querySelector('input'), next);
      click(byText(container, 'button', 'Lưu'));
      await flush();
      const d = confirmDialog();
      expect(d?.textContent).toContain('Xác nhận đổi cấu hình tiền/điểm');
      expect(d?.textContent).toContain(key);
      expect(puts).toHaveLength(0);
      answerConfirm(true);
      await flush();
      expect(puts).toEqual([{ key, value: real!.value }]);
    });

    // Mỗi giọt nước/hạt giống/XP là "giá" của coupon 30.000đ hoặc bậc premium 5.000-30.000 điểm (game.service.ts): gõ 600 → 6 làm cây nào cũng ra coupon.
    it.each([
      'game.tree_default_target',
      'game.plot_target',
      'game.dew_seeds',
      'game.daily_login_seeds',
      'game.tank_capacity',
      'seasonpass.checkin_xp',
    ])('%s (dòng thật): đổi là đổi giá trị coupon/điểm nên hỏi xác nhận', async (key) => {
      const real = ADMIN_CONFIG_ROWS.find((r) => r.key === key);
      expect(real, `fixture thiếu ${key}`).toBeDefined();
      const { container, puts } = setup(real!);
      typeInto(container.querySelector('input'), JSON.stringify(real!.value) + ' ');
      click(byText(container, 'button', 'Lưu'));
      await flush();
      expect(confirmDialog()?.textContent).toContain(key);
      expect(puts).toHaveLength(0);
      answerConfirm(true);
      await flush();
      expect(puts).toEqual([{ key, value: real!.value }]);
    });

    it('game.tree_default_target 600 → 6: hộp xác nhận nêu cũ → mới', async () => {
      const real = ADMIN_CONFIG_ROWS.find((r) => r.key === 'game.tree_default_target')!;
      const { container } = setup(real);
      typeInto(container.querySelector('input'), '6');
      click(byText(container, 'button', 'Lưu'));
      await flush();
      expect(confirmDialog()?.textContent).toContain('600 → 6');
    });

    it('dealer.quarterly_bonus_tiers: hộp xác nhận nói bậc mới chỉ áp cho quý chưa trả, không nói "mọi đơn"', async () => {
      const value = [{ min: 50_000_000, pct: 2 }];
      const { container } = setup(row({ key: 'dealer.quarterly_bonus_tiers', value, category: 'dealer' }));
      typeInto(container.querySelector('input'), JSON.stringify([{ min: 70_000_000, pct: 2.5 }]));
      click(byText(container, 'button', 'Lưu'));
      await flush();
      const text = confirmDialog()?.textContent ?? '';
      expect(text).toContain('quý chưa trả thưởng');
      expect(text).toContain('quý đã trả giữ bảng bậc đã chụp');
      expect(text).not.toContain('Áp dụng ngay cho mọi đơn');
    });

    it.each([
      ['community.facebook_url', 'https://a.example', '"https://b.example"'],
    ])('%s: khoá không phải tiền/điểm vẫn lưu thẳng, không hỏi', async (key, oldValue, next) => {
      const { container, puts } = setup(row({ key, value: oldValue, category: key.split('.')[0] }));
      typeInto(container.querySelector('input'), next);
      click(byText(container, 'button', 'Lưu'));
      await flush();
      expect(confirmDialog()).toBeNull();
      expect(puts).toHaveLength(1);
    });
  });
});

// D5-01: nội dung điều khoản/chính sách là văn bản dài nhiều dòng; bắt admin gõ JSON một dòng (\n, \") thì không ai dán nổi.
describe('ConfigItem — khoá văn bản legal.* (D5-01)', () => {
  const LEGAL = { key: 'legal.doi-tra', value: '', category: 'legal', description: 'Nội dung trang Chính sách đổi trả' };

  it('hiện ô nhiều dòng với chữ thô (không ngoặc kép), nhãn là tên khoá', () => {
    const { container } = setup(row({ ...LEGAL, value: '## 1. Đổi trả\n\nTrong 7 ngày.' }));
    const area = container.querySelector('textarea')!;
    expect(container.querySelector('input')).toBeNull();
    expect(area.value).toBe('## 1. Đổi trả\n\nTrong 7 ngày.');
    expect(area.getAttribute('aria-label')).toBe('legal.doi-tra');
    expect(area.className).toContain('min-h-');
  });

  it('Lưu gửi nguyên chuỗi nhiều dòng, có dấu ngoặc kép và xuống dòng, không qua JSON.parse', async () => {
    const { container, puts, onSaved } = setup(row(LEGAL));
    const text = '# Đổi trả\n\nKhách nói "ổn" thì {đổi} được.\n- Mục 1';
    typeInto(container.querySelector('textarea'), text);
    click(byText(container, 'button', 'Lưu'));
    await flush();
    expect(puts).toEqual([{ key: 'legal.doi-tra', value: text }]);
    expect(onSaved).toHaveBeenCalled();
    expect(container.textContent).not.toContain('JSON không hợp lệ');
  });

  it('xoá hết chữ rồi Lưu gửi chuỗi rỗng (quay về bản nháp mặc định), không hỏi xác nhận tiền/điểm', async () => {
    const { container, puts } = setup(row({ ...LEGAL, value: 'Nội dung cũ' }));
    typeInto(container.querySelector('textarea'), '');
    click(byText(container, 'button', 'Lưu'));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(puts).toEqual([{ key: 'legal.doi-tra', value: '' }]);
  });

  it('khoá không phải legal.* vẫn là ô JSON một dòng như cũ', () => {
    const { container } = setup(row({ key: 'payment.bank_name', value: 'Techcombank', category: 'payment' }));
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('input')!.value).toBe('"Techcombank"');
  });

  it('máy chủ từ chối (quá 50.000 ký tự): hiện lỗi, giữ chữ đã gõ', async () => {
    const api = mockFetch({ '/admin/config': () => ({ status: 400, body: { message: '"legal.doi-tra" không hợp lệ: tối đa 50.000 ký tự.' } }) });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = mount(<ConfigItem row={row(LEGAL)} onSaved={vi.fn()} />);
    typeInto(r.container.querySelector('textarea'), 'abc');
    click(byText(r.container, 'button', 'Lưu'));
    await flush();
    expect(r.container.textContent).toContain('tối đa 50.000 ký tự');
    expect(r.container.querySelector('textarea')!.value).toBe('abc');
  });

  // D7-18: opacity-70 trên cả thẻ kéo chữ của huy hiệu và mô tả xuống 2,8:1 (cần 4,5:1). Màu chữ giữ nguyên token đạt AA
  // (stone-600 trên stone-200 = 5,38; stone-500 trên stone-50 = 5,09), chỉ làm dịu nền và viền.
  it('D7-18: khoá "Không dùng" không làm mờ cả thẻ (opacity) nên chữ huy hiệu và mô tả giữ độ tương phản', () => {
    const { container } = setup(row({ key: 'game.old_key', value: 1, deprecated: true }));
    const badge = byText(container, 'span', 'Không dùng')!;
    expect(badge).not.toBeNull();
    for (let el: HTMLElement | null = badge; el && el !== container; el = el.parentElement) {
      expect(el.className).not.toMatch(/(^|\s)opacity-/);
    }
    expect(badge.className).toContain('text-stone-600');
    expect(badge.className).toContain('bg-stone-200');
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('bg-stone-50');
  });
});
