// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FeatureFlagsCard } from './feature-flags-card';
import { answerConfirm, click, confirmDialog, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
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
    expect(container.querySelectorAll('button[role="switch"]')).toHaveLength(FEATURE_FLAGS.length);
    expect(sw(container, 'Cho khách chat với cửa hàng').getAttribute('aria-checked')).toBe('true');
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
    const { container } = setup([], { status: 400, body: { message: 'Cầu nối Zalo chưa kết nối.' } });
    click(sw(container, 'Cho khách chat với cửa hàng'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(container.querySelector('[data-flag="chat.enabled"] [role="alert"]')!.textContent).toContain('Cầu nối Zalo chưa kết nối.');
  });
});
