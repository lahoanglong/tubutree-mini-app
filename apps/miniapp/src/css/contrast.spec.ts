import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC, firstDecl, lerp, over, parseColor, ratio, readText, resolveColor, tokenRgb } from '../test-support/contrast';

const BRIDGE = readText(path.join(SRC, 'css/zaui-bridge.css'));
const BRAND = readText(path.join(SRC, 'css/brand-theme.css'));

describe('viền ô nhập, checkbox, radio và nền công tắc tắt đạt 3:1 (D8-2, WCAG 1.4.11)', () => {
  const surface = tokenRgb('--color-bg-surface');
  const canvas = tokenRgb('--color-bg-canvas');

  it.each([
    '--zaui-light-input-border-color',
    '--zaui-light-checkbox-border-color',
    '--zaui-light-radio-border-color',
    '--zaui-light-switch-off-bg-color',
  ])('%s ≥ 3:1 so với nền thẻ trắng và nền canvas', (name) => {
    const raw = firstDecl(BRIDGE, name);
    expect(raw, `thiếu ${name}`).not.toBeNull();
    const rgb = parseColor(resolveColor(raw!)).rgb;
    expect(ratio(rgb, surface)).toBeGreaterThanOrEqual(3);
    expect(ratio(rgb, canvas)).toBeGreaterThanOrEqual(3);
  });
});

describe('chữ trắng trên ô gradient nhãn ở Hành trình nguyên liệu đạt 4,5:1 (D8-1)', () => {
  const ids = [...BRAND.matchAll(/--color-brand-([a-z0-9]+)-from:/g)].map((m) => m[1]!);
  const scrimRaw = firstDecl(BRAND, '--color-brand-tile-scrim');
  const scrim = scrimRaw ? parseColor(scrimRaw) : { rgb: [0, 0, 0] as [number, number, number], alpha: 0 };
  const white: [number, number, number] = [255, 255, 255];

  it('có đủ 8 nhãn', () => {
    expect(ids).toHaveLength(8);
  });

  it.each([0.4, 0.5, 0.6, 0.75, 0.85])('mọi nhãn ở %s đường gradient (vị trí chữ) sau lớp phủ tối', (t) => {
    const low: string[] = [];
    for (const id of ids) {
      const from = parseColor(firstDecl(BRAND, `--color-brand-${id}-from`)!).rgb;
      const to = parseColor(firstDecl(BRAND, `--color-brand-${id}-to`)!).rgb;
      const bg = over(scrim, lerp(from, to, t));
      const r = ratio(white, bg);
      if (r < 4.5) low.push(`${id} ${r.toFixed(2)}`);
    }
    expect(low).toEqual([]);
  });
});

describe('cặp màu commerce của gói tokens-a11y đạt 4,5:1 (chữ) — WCAG 1.4.3', () => {
  const pairs: [string, string][] = [
    ['--color-text-price-deal', '--color-bg-surface'],
    ['--color-text-price-deal', '--color-promo-bg'],
    ['--color-promo-fg', '--color-promo-bg'],
    ['--color-text-price-deal', '--color-bg-canvas'],
    // Khối combo ở giỏ (K5): số Tiết kiệm và câu nhắc nằm trên nền dịu của khối.
    ['--color-text-price-deal', '--color-bg-subtle'],
    ['--color-text-secondary', '--color-bg-subtle'],
    ['--color-text-primary', '--color-bg-subtle'],
    ['--color-flash-fg', '--color-flash-bg'],
    ['--color-flash-solid-fg', '--color-flash-solid-bg'],
    ['--color-countdown-fg', '--color-countdown-bg'],
    ['--color-voucher-fg', '--color-voucher-bg'],
    ['--color-voucher-stub-fg', '--color-voucher-stub-bg'],
    ['--color-voucher-ship-fg', '--color-voucher-ship-bg'],
    ['--color-voucher-shop-fg', '--color-voucher-shop-bg'],
    ['--color-voucher-shop-stub-fg', '--color-voucher-shop-stub-bg'],
    ['--color-rank-fg', '--color-rank-1-bg'],
    ['--color-rank-fg', '--color-rank-2-bg'],
    ['--color-rank-fg', '--color-rank-3-bg'],
    ['--color-rank-n-fg', '--color-rank-n-bg'],
    ['--color-verified-fg', '--color-verified-bg'],
    ['--color-action-secondary-fg-disabled', '--color-action-secondary-bg-disabled'],
    // Chữ phụ của VoucherTicket trên nền trắng của hàng chọn mã: lý do, điều kiện/hạn, mức giảm, "Đang dùng" (không còn làm mờ cả thẻ, K3).
    ['--color-status-warning-fg', '--color-bg-surface'],
    ['--color-text-tertiary', '--color-bg-surface'],
    ['--color-status-success-fg', '--color-bg-surface'],
    ['--color-text-brand', '--color-bg-surface'],
    ['--color-text-secondary', '--color-action-primary-bg-disabled'],
    // Câu chuyện sản phẩm (ProductStoryShowcase): chip bước, nhãn vòng cung trên quầng nền, thẻ chú thích HUD.
    ['--color-action-primary-fg', '--color-action-primary-bg'],
    ['--color-text-primary', '--color-bg-chip'],
    ['--color-text-primary', '--color-story-ambient-leaf'],
    ['--color-text-primary', '--color-story-ambient-amber'],
    ['--color-text-primary', '--color-story-ambient-rose'],
    ['--color-text-primary', '--color-story-ambient-sky'],
    ['--color-text-primary', '--color-story-ambient-sand'],
    ['--color-text-secondary', '--color-bg-surface'],
    // Thanh tiến trình đơn (OrderTimelineTracker): dấu ✓ trên chấm bước đã qua và dấu ✕ trên chấm bước huỷ.
    ['--color-text-inverse', '--color-action-primary-bg'],
    ['--color-text-inverse', '--color-status-danger-fg'],
    // Thanh Miễn phí giao hàng khi đã đạt (W42A): chữ xanh ngọc trên nền thành công; nhãn "Story" trên viền vòng.
    ['--color-text-success', '--color-status-success-bg'],
    // Gợi ý mã giảm giá ở Giỏ (W44B): lời báo áp mã không được nằm trên nền canvas của trang.
    ['--color-text-danger', '--color-bg-canvas'],
    // Dải cam kết ở trang chi tiết (W45A): tiêu đề trụ cột trên nền trắng, icon nhãn thương hiệu trên vòng nền dịu.
    ['--color-text-primary', '--color-bg-surface'],
    ['--color-text-brand', '--color-bg-subtle'],
  ];

  it.each(pairs)('%s trên %s', (fg, bg) => {
    expect(ratio(tokenRgb(fg), tokenRgb(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([['--color-story-ring-from'], ['--color-story-ring-to'], ['--color-story-ring-seen']])('viền vòng Story %s đạt 3:1 so với nền trắng (WCAG 1.4.11) trừ viền đã xem', (name) => {
    const r = ratio(tokenRgb(name), tokenRgb('--color-bg-surface'));
    if (name === '--color-story-ring-seen') expect(r).toBeGreaterThanOrEqual(1.4);
    else expect(r).toBeGreaterThanOrEqual(3);
  });

  it('giá deal là cam đậm #9A5200, không phải đỏ (thiết kế §4 Q2)', () => {
    expect(tokenRgb('--color-text-price-deal')).toEqual([0x9a, 0x52, 0x00]);
  });
});
