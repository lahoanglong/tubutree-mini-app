// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExternalO2oSettingsCard } from './external-o2o-settings-card';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import { FEATURE_FLAGS } from '@/lib/admin-feature-flags';
import { O2O_SWITCH_KEYS, buildO2oWrites, o2oConfirmMessage, readO2oSettings } from '@/lib/external-o2o-settings';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const ROWS = [
  { key: 'loyalty.marketplace_claim_enabled', value: true, description: null, category: 'loyalty' },
  { key: 'loyalty.marketplace_earn_pct', value: 5, description: null, category: 'loyalty' },
];

function stub(opts: { failKey?: string } = {}) {
  const puts: { key: string; value: unknown }[] = [];
  const m = mockFetch({
    '/admin/config': (init) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { key: string; value: unknown };
        if (body.key === opts.failKey) return { status: 400, body: { message: `"${body.key}" phải nằm trong khoảng 1–60` } };
        puts.push(body);
        return { body: { ok: true } };
      }
      return { body: ROWS };
    },
  });
  vi.stubGlobal('fetch', vi.fn(m.fn));
  return { m, puts };
}

const mount = async () => {
  const r = render(<ExternalO2oSettingsCard />);
  mounted.push(r);
  await flush();
  return r;
};
const switchOf = (root: ParentNode, key: string) => root.querySelector<HTMLInputElement>(`[data-o2o-switch="${key}"] input`)!;
const inputs = (root: ParentNode) => [...root.querySelectorAll<HTMLInputElement>('input:not([type=checkbox])')];

describe('ExternalO2oSettingsCard', () => {
  it('đọc giá trị đang áp: khoá chưa có dòng lấy mặc định; ba công tắc dùng nhãn của thẻ Bật/tắt tính năng', async () => {
    stub();
    const r = await mount();
    expect(switchOf(r.container, 'loyalty.marketplace_claim_enabled').checked).toBe(true);
    expect(switchOf(r.container, 'pancake.external_lookup_enabled').checked).toBe(false);
    expect(switchOf(r.container, 'app.mobile_miniapp_redirect_enabled').checked).toBe(false);
    expect(inputs(r.container).map((i) => i.value)).toEqual(['5', '14']);
    for (const key of O2O_SWITCH_KEYS) {
      expect(r.container.querySelector(`[data-o2o-switch="${key}"]`)!.textContent).toContain(FEATURE_FLAGS.find((f) => f.key === key)!.label);
    }
    expect(r.container.textContent).not.toMatch(/funnel|o2o/i);
  });

  it('đổi 2 khoá: hộp xác nhận ghi "cũ → mới" kèm hậu quả, đồng ý thì ghi tuần tự đúng 2 khoá', async () => {
    const { puts } = stub();
    const r = await mount();
    click(switchOf(r.container, 'pancake.external_lookup_enabled'));
    typeInto(inputs(r.container)[0]!, '6,5');
    click(byText(r.container, 'button', 'Lưu cài đặt'));
    await flush();
    const message = confirmDialog()!.textContent!;
    expect(message).toContain('Tra đơn trên Pancake khi khách nhập mã');
    expect(message).toContain('Tắt → Bật');
    expect(message).toContain('Tỉ lệ tích điểm đơn sàn (%)');
    expect(message).toContain('5% → 6,5%');
    expect(message).toContain('Yêu cầu đã tạo giữ số điểm đã tính.');
    answerConfirm(true);
    await flush();
    expect(puts).toEqual([
      { key: 'pancake.external_lookup_enabled', value: true },
      { key: 'loyalty.marketplace_earn_pct', value: 6.5 },
    ]);
    expect(r.container.textContent).toContain('Đã lưu 2 mục.');
  });

  it('bấm Huỷ: không ghi khoá nào', async () => {
    const { puts } = stub();
    const r = await mount();
    typeInto(inputs(r.container)[1]!, '10');
    click(byText(r.container, 'button', 'Lưu cài đặt'));
    await flush();
    answerConfirm(false);
    await flush();
    expect(puts).toEqual([]);
  });

  it('số ngoài biên hoặc không nguyên: báo lỗi, không hỏi, không ghi; không đổi gì thì báo không có thay đổi', async () => {
    const { puts } = stub();
    const r = await mount();
    typeInto(inputs(r.container)[1]!, '2,5');
    click(byText(r.container, 'button', 'Lưu cài đặt'));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(r.container.textContent).toContain('Số ngày chờ sau khi giao xong: nhập số nguyên từ 1 đến 60.');
    typeInto(inputs(r.container)[1]!, '14');
    typeInto(inputs(r.container)[0]!, '25');
    click(byText(r.container, 'button', 'Lưu cài đặt'));
    await flush();
    expect(r.container.textContent).toContain('Tỉ lệ tích điểm đơn sàn (%): nhập số từ 0,1 đến 20.');
    typeInto(inputs(r.container)[0]!, '5');
    click(byText(r.container, 'button', 'Lưu cài đặt'));
    await flush();
    expect(r.container.textContent).toContain('Không có thay đổi.');
    expect(puts).toEqual([]);
  });

  it('khoá thứ hai lỗi: dừng và nói rõ khoá nào đã lưu, khoá nào chưa', async () => {
    const { puts } = stub({ failKey: 'loyalty.external_pending_days' });
    const r = await mount();
    click(switchOf(r.container, 'app.mobile_miniapp_redirect_enabled'));
    typeInto(inputs(r.container)[1]!, '20');
    click(byText(r.container, 'button', 'Lưu cài đặt'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(puts).toEqual([{ key: 'app.mobile_miniapp_redirect_enabled', value: true }]);
    expect(r.container.textContent).toContain('Đã lưu: Tự mở Mini App trên web điện thoại. Chưa lưu: Số ngày chờ sau khi giao xong.');
  });

  it('tải cài đặt lỗi: có nút Thử lại, các ô khoá lại', async () => {
    const m = mockFetch({});
    vi.stubGlobal('fetch', vi.fn(m.fn));
    const r = await mount();
    expect(byText(r.container, 'button', 'Thử lại')).not.toBeNull();
    expect(inputs(r.container).every((i) => i.disabled)).toBe(true);
  });
});

describe('external-o2o-settings (hàm thuần)', () => {
  it('tắt cờ dùng câu offWarning của thẻ Bật/tắt tính năng', () => {
    const form = readO2oSettings(ROWS);
    form.switches['loyalty.marketplace_claim_enabled'] = false;
    const built = buildO2oWrites(form, ROWS);
    expect(built.writes).toEqual([{ key: 'loyalty.marketplace_claim_enabled', label: 'Khách nhập mã đơn sàn để nhận điểm', from: true, to: false }]);
    const flag = FEATURE_FLAGS.find((f) => f.key === 'loyalty.marketplace_claim_enabled')!;
    expect(o2oConfirmMessage(built.writes!)).toBe(`Khách nhập mã đơn sàn để nhận điểm\nBật → Tắt\n${flag.offWarning}`);
  });

  it('số ngày: "14 ngày → 7 ngày" và câu áp cho cả yêu cầu đang chờ', () => {
    const form = readO2oSettings(ROWS);
    form.numbers['loyalty.external_pending_days'] = ' 7 ';
    const built = buildO2oWrites(form, ROWS);
    expect(o2oConfirmMessage(built.writes!)).toContain('14 ngày → 7 ngày\nÁp ngay cho mọi yêu cầu đang chờ cộng');
  });
});
