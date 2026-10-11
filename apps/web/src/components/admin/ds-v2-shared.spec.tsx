// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigItem } from './config-item';
import { GomdonConfigCard } from './gomdon-config-card';
import { LoyaltyConfigCard } from './loyalty-config-card';
import { INPUT_CLASS, Notice, ToneBadge } from './ui';
import { flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
import type { Tone } from '@/lib/recycling';

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

// C-097 (Q-25): thành phần dùng chung của admin theo token DS v2. Các lớp màu cụ thể do bánh cóc
// ds-palette-pc11.spec.ts giữ; ở đây khoá những quyết định về hành vi/truy cập đi kèm việc đổi màu.
describe('admin/ui — màu trạng thái theo token', () => {
  const TONES: [Tone, string, string][] = [
    ['neutral', 'bg-stone-100', 'text-stone-700'],
    ['info', 'bg-info-bg', 'text-info-fg'],
    ['success', 'bg-success-bg', 'text-success-fg'],
    ['warning', 'bg-warning-bg', 'text-warning-fg'],
    ['danger', 'bg-danger-bg', 'text-danger-fg'],
  ];

  it.each(TONES)('ToneBadge tông %s dùng cặp nền/chữ cùng họ token', (tone, bg, fg) => {
    const { container } = mount(<ToneBadge tone={tone}>Nhãn</ToneBadge>);
    const badge = container.querySelector('span')!;
    expect(badge.className).toContain(bg);
    expect(badge.className).toContain(fg);
  });

  it.each(['info', 'warning', 'danger', 'success'] as const)('Notice tông %s có nền, viền và chữ cùng token và cho phép xuống dòng', (tone) => {
    const { container } = mount(<Notice tone={tone}>Nội dung</Notice>);
    const box = container.firstElementChild!;
    expect(box.className).toContain(`bg-${tone}-bg`);
    expect(box.className).toContain(`border-${tone}-fg`);
    expect(box.className).toContain(`text-${tone}-fg`);
    expect(box.className).toContain('break-words');
  });

  it('INPUT_CLASS giữ vòng lấy nét chung (không focus:outline-none) và viền đủ tương phản 3:1', () => {
    expect(INPUT_CLASS).not.toContain('outline-none');
    expect(INPUT_CLASS).toContain('border-stone-450');
    expect(INPUT_CLASS).toContain('bg-stone-0');
  });
});

describe('admin — vùng chạm và tràn ngang ở 390px', () => {
  it('ConfigItem: khoá dài được phép ngắt dòng, không đẩy trang tràn ngang', () => {
    const key = 'shipping.gomdon.default_weight_fallback_grams_per_variant';
    const { container } = mount(<ConfigItem row={{ key, value: 1, description: null, category: 'x' }} onSaved={() => {}} />);
    const label = [...container.querySelectorAll('span')].find((s) => s.textContent === key)!;
    expect(label.className).toContain('break-all');
    expect(label.className).toContain('min-w-0');
  });

  it('LoyaltyConfigCard: công tắc POS và nút Lưu cao tối thiểu 44px ở điện thoại', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetch({ '/admin/config': { body: { ok: true } } }).fn));
    const { container } = mount(<LoyaltyConfigCard rows={[]} />);
    await flush();
    const sw = container.querySelector('input[role="switch"]')!;
    expect(sw.closest('label')!.className).toContain('min-h-[44px]');
    expect(sw.className).toContain('accent-forest-600');
    expect(container.querySelector('button[type="submit"]')!.className).toContain('min-h-[44px]');
    expect(container.querySelector('a[href="/admin/pos"]')!.className).toContain('min-h-[44px]');
  });

  it('GomdonConfigCard: công tắc checkout và nút Lưu cao tối thiểu 44px ở điện thoại', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        mockFetch({
          '/admin/gomdon/status': {
            body: { baseUrlSet: true, credentialsSet: true, configured: true, webhookSecretSet: true, recyclingToggle: true, recyclingEnabled: true },
          },
        }).fn,
      ),
    );
    const { container } = mount(<GomdonConfigCard rows={[]} />);
    await flush();
    const sw = container.querySelector('input[role="switch"]')!;
    expect(sw.closest('label')!.className).toContain('min-h-[44px]');
    expect(container.querySelector('button[type="submit"]')!.className).toContain('min-h-[44px]');
  });
});
