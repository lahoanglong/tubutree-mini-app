// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FeatureFlagsCard } from './feature-flags-card';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
import type { ConfigRow } from '@/lib/admin-client';
import { FEATURE_FLAGS } from '@/lib/admin-feature-flags';

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
});

const sw = (root: ParentNode, label: string) => root.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${label}"]`)!;
const rows = (over: Record<string, unknown> = {}): ConfigRow[] =>
  Object.entries(over).map(([key, value]) => ({ key, value, description: null, category: key.split('.')[0]! }));

function setup(configRows: ConfigRow[], put?: { status?: number; body: unknown }) {
  const puts: { key: string; value: unknown }[] = [];
  const api = mockFetch({
    '/admin/config': (init) => {
      if (init?.method === 'PUT') puts.push(JSON.parse(String(init.body)));
      return put ?? { body: { ok: true } };
    },
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  return { puts, ...mount(<FeatureFlagsCard rows={configRows} />) };
}

describe('FeatureFlagsCard', () => {
  it('liệt kê đủ các cờ với trạng thái; khoá chưa có dòng dùng giá trị mặc định', () => {
    const { container } = setup(rows({ 'chat.enabled': true }));
    expect(container.querySelectorAll('button[role="switch"]')).toHaveLength(FEATURE_FLAGS.length - 1);
    expect(container.querySelector('[data-flag="chat.enabled"]')!.textContent).toContain('Đang bật');
    expect(sw(container, 'Đổi rác lấy quà').getAttribute('aria-checked')).toBe('false');
    expect(sw(container, 'Bắt duyệt gian hàng CTV trước khi hiện').getAttribute('aria-checked')).toBe('true');
    for (const k of ['loyalty.marketplace_claim_enabled', 'pancake.external_lookup_enabled', 'pancake.external_poll_enabled', 'loyalty.chat_order_points_enabled', 'loyalty.pos_credit_enabled', 'waste.enabled', 'chat.enabled', 'storefront.require_approval', 'community.public_preview']) {
      expect(FEATURE_FLAGS.some((f) => f.key === k)).toBe(true);
    }
  });

  it('bấm công tắc hỏi xác nhận rồi PUT boolean đúng khoá, kể cả khoá chưa có dòng', async () => {
    const { container, puts } = setup([]);
    click(sw(container, 'Đổi rác lấy quà'));
    await flush();
    expect(confirmDialog()!.textContent).toContain('Bật "Đổi rác lấy quà"?');
    expect(puts).toEqual([]);
    answerConfirm(true);
    await flush();
    expect(puts).toEqual([{ key: 'waste.enabled', value: true }]);
    expect(container.textContent).toContain('Đã lưu.');
  });

  it('huỷ ở hộp xác nhận thì không lưu', async () => {
    const { container, puts } = setup(rows({ 'waste.enabled': true }));
    click(sw(container, 'Đổi rác lấy quà'));
    await flush();
    expect(confirmDialog()!.textContent).toContain('Tắt "Đổi rác lấy quà"?');
    answerConfirm(false);
    await flush();
    expect(puts).toEqual([]);
  });

  it('API từ chối: hiện lỗi của API ngay dưới cờ đó', async () => {
    const { container } = setup([], { status: 400, body: { message: 'Không lưu được cờ này.' } });
    click(sw(container, 'Đổi rác lấy quà'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(container.querySelector('[data-flag="waste.enabled"] [role="alert"]')!.textContent).toContain('Không lưu được cờ này.');
  });

  it('cờ chat không có công tắc: hiện trạng thái và nút mở tab Chat CSKH', () => {
    const onOpen = vi.fn();
    const api = mockFetch({});
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<FeatureFlagsCard rows={rows({ 'chat.enabled': false })} onOpenSupportChat={onOpen} />);
    const li = container.querySelector('[data-flag="chat.enabled"]')!;
    expect(li.querySelector('[role="switch"]')).toBeNull();
    expect(li.textContent).toContain('Đang tắt');
    click(byText(li, 'button', 'Bật/tắt ở Chat CSKH'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('hộp xác nhận cờ đảo nói đúng hệ quả từng chiều', async () => {
    const on = setup(rows({ 'storefront.require_approval': true }));
    click(sw(on.container, 'Bắt duyệt gian hàng CTV trước khi hiện'));
    await flush();
    const off = confirmDialog()!.textContent!;
    expect(off).toContain('chưa duyệt sẽ hiện công khai ngay');
    expect(off).not.toContain('ngừng với khách');
    answerConfirm(false);
    await flush();
    on.unmount();

    const back = setup(rows({ 'storefront.require_approval': false }));
    click(sw(back.container, 'Bắt duyệt gian hàng CTV trước khi hiện'));
    await flush();
    expect(confirmDialog()!.textContent).toContain('chưa được duyệt sẽ bị ẩn khỏi khách ngay');
    answerConfirm(false);
  });

  it('bật cờ Pancake/đơn sàn có cảnh báo điều kiện và không hứa nhận điểm ngay; tắt cờ đơn sàn nói rõ yêu cầu đang chờ', async () => {
    const a = setup(rows({ 'pancake.external_poll_enabled': false }));
    click(sw(a.container, 'Tự kéo đơn sàn từ Pancake định kỳ'));
    await flush();
    const t = confirmDialog()!.textContent!;
    expect(t).toContain('Pancake đã gửi đơn về Tubu thành công');
    expect(t).not.toContain('nhận điểm ngay');
    answerConfirm(false);
    await flush();
    a.unmount();

    const b = setup(rows({ 'loyalty.marketplace_claim_enabled': true }));
    click(sw(b.container, 'Khách nhập mã đơn sàn để nhận điểm'));
    await flush();
    expect(confirmDialog()!.textContent).toContain('đang chờ cộng điểm sẽ đứng yên');
    answerConfirm(false);
  });
});
