import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC, firstDecl, lerp, over, parseColor, ratio, readText, tokenRgb } from '../test-support/contrast';

const TOKENS = readText(path.join(SRC, 'css/tokens.css'));
const BRAND = readText(path.join(SRC, 'css/brand-theme.css'));

describe('viền ô nhập, checkbox, radio và nền công tắc tắt đạt 3:1 (D8-2, WCAG 1.4.11)', () => {
  const surface = tokenRgb('--color-bg-surface');
  const canvas = tokenRgb('--color-bg-canvas');
  // Ô nhập, ô chọn và công tắc tự vẽ trong tokens.css (w19-02, thay zmp-ui): lấy đúng token mà luật CSS dùng.
  const block = (sel: string) => new RegExp(`(^|\\n)${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`).exec(TOKENS)?.[2] ?? '';

  it.each([
    ['.tubu-input', /border: 1px solid var\((--color-[a-z-]+)\)/],
    ['.tubu-check__mark', /border: 2px solid var\((--color-[a-z-]+)\)/],
    ['.tubu-switch', /background: var\((--color-[a-z-]+)\)/],
  ] as const)('%s ≥ 3:1 so với nền thẻ trắng và nền canvas', (sel, re) => {
    const token = re.exec(block(sel))?.[1];
    expect(token, `thiếu màu viền/nền của ${sel}`).toBeTruthy();
    const rgb = tokenRgb(token!);
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
    // Thanh đã bán dạng Giờ Xanh Ưu Đãi: chữ xanh đậm đè lên phần đã bán (xanh non) và rãnh (xanh nhạt).
    ['--color-action-secondary-fg', '--color-progress-fill-from'],
    ['--color-action-secondary-fg', '--color-action-secondary-bg'],
    // Đồng hồ dạng Giờ Xanh: chữ "Kết thúc sau …" và dấu ":" màu chữ thương hiệu trên nền trang.
    ['--color-text-brand', '--color-bg-canvas'],
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
    // Hộp thông báo (build-snackbar-shim.ts, w19-02): chữ và nút hành động trên nền tối.
    ['--color-text-inverse', '--color-bg-inverse'],
    // Icon đặc của hộp thông báo theo loại: nét trắng trên hình tô màu trạng thái.
    ['--color-text-inverse', '--color-status-success-fg'],
    ['--color-text-inverse', '--color-status-warning-fg'],
    ['--color-text-inverse', '--color-status-info-fg'],
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

describe('game thao tác và lưới thẻ "Chơi hôm nay" (w48-01b) đạt 4,5:1 (chữ) — WCAG 1.4.3', () => {
  /** `color-mix(in srgb, A p%, B)` của mini-arcade.css / mini-game.css. */
  const mix = (a: string, p: number, b: string) => lerp(tokenRgb(b), tokenRgb(a), p);
  const surface = '--color-bg-surface';

  it.each([
    // Ba thùng của Băng Chuyền Xanh: nhãn thùng trên nền trạng thái cùng tông.
    ['--color-status-info-fg', '--color-status-info-bg'],
    ['--color-status-success-fg', '--color-status-success-bg'],
    ['--color-status-warning-fg', '--color-status-warning-bg'],
    // Nhãn hệ số chuỗi x2..x5 trên nền thẻ của khung ván.
    ['--color-text-success', surface],
    ['--color-text-warning', surface],
    ['--color-text-danger', surface],
  ])('%s trên %s', (fg, bg) => {
    expect(ratio(tokenRgb(fg), tokenRgb(bg))).toBeGreaterThanOrEqual(4.5);
  });

  const cardTones: [string, [number, number, number]][] = [
    ['leaf', tokenRgb('--color-story-ambient-leaf')],
    ['sky', tokenRgb('--color-story-ambient-sky')],
    ['amber', tokenRgb('--color-story-ambient-amber')],
    ['rose', tokenRgb('--color-story-ambient-rose')],
    ['sand', tokenRgb('--color-story-ambient-sand')],
    ['mint', mix('--color-story-ambient-leaf', 0.55, '--color-story-ambient-sky')],
    ['peach', mix('--color-story-ambient-rose', 0.5, '--color-story-ambient-amber')],
    ['fern', mix('--color-story-ambient-leaf', 0.6, '--color-story-ambient-sand')],
    ['lilac', mix('--color-story-ambient-sky', 0.5, '--color-story-ambient-rose')],
  ];
  it.each(cardTones)('thẻ tông %s: tên game và mô tả (chữ phụ) đọc được', (_tone, bg) => {
    expect(ratio(tokenRgb('--color-text-primary'), bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(tokenRgb('--color-text-secondary'), bg)).toBeGreaterThanOrEqual(4.5);
  });

  const tierBg: [string, [number, number, number]][] = [
    ['1', tokenRgb('--color-story-ambient-sand')],
    ['2', tokenRgb('--color-story-ambient-leaf')],
    ['3', mix('--color-story-tone-leaf', 0.28, surface)],
    ['4', mix('--color-story-tone-leaf', 0.34, surface)],
    ['5', tokenRgb('--color-story-ambient-rose')],
    ['6', tokenRgb('--color-story-ambient-amber')],
    ['7', mix('--color-story-tone-amber', 0.35, surface)],
  ];
  it.each(tierBg)('ô Ghép Mầm Xanh bậc %s: tên bậc và số điểm đọc được', (_tier, bg) => {
    expect(ratio(tokenRgb('--color-text-primary'), bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(tokenRgb('--color-text-secondary'), bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('bảng màu Noel Xanh (tubu-w57-01) đạt 4,5:1 cho chữ — WCAG 1.4.3', () => {
  const XMAS = readText(path.join(SRC, '../../../packages/design-tokens/src/seasonal-christmas.css'));
  const rgb = (name: string) => {
    const v = firstDecl(XMAS, name);
    expect(v, `thiếu ${name} trong seasonal-christmas.css`).toBeTruthy();
    return parseColor(v!).rgb;
  };
  // Chữ trên thẻ: tiêu đề và dòng phụ trên nền băng/tuyết; nút vàng chữ thông đậm; ô đã mở chữ tuyết trên nền thông; ô hôm nay chữ thông đậm trên vàng.
  it.each([
    ['--xmas-pine-deep', '--xmas-frost'],
    ['--xmas-pine', '--xmas-frost'],
    ['--xmas-pine-deep', '--xmas-snow'],
    ['--xmas-pine', '--xmas-snow'],
    ['--xmas-pine-deep', '--xmas-gold'],
    ['--xmas-snow', '--xmas-pine'],
    // Cây Thông Noel Tự Trang Trí (w57-02): nút "Trang trí" và thiệp chữ tuyết/vàng trên nền đêm; ô khay đã treo chữ tuyết trên thông đậm.
    ['--xmas-snow', '--xmas-night-deep'],
    ['--xmas-snow', '--xmas-night'],
    ['--xmas-gold', '--xmas-night-deep'],
    ['--xmas-gold', '--xmas-night'],
    ['--xmas-snow', '--xmas-pine-deep'],
  ])('%s trên %s', (fg, bg) => {
    expect(ratio(rgb(fg), rgb(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('ô ngày đã qua không làm mờ chữ bằng opacity (chữ mờ rơi dưới 4,5:1)', () => {
    const rule = /\.tubu-xmas-tile\[data-state='missed'\] \{([^}]*)\}/.exec(XMAS)?.[1] ?? '';
    expect(rule).toContain('color: var(--xmas-pine)');
    expect(rule).not.toMatch(/opacity/);
  });
});

describe('hai nút màu và viên chuỗi của Chăm vườn (tubu-w62-01) đạt 4,5:1 cho chữ — WCAG 1.4.3', () => {
  const HUB = readText(path.join(SRC, 'css/game-hub.css'));
  const gradient = (sel: string) => {
    const body = new RegExp(`\\${sel} \\{([^}]*)\\}`).exec(HUB)?.[1] ?? '';
    const stops = /linear-gradient\(135deg, var\((--[a-z0-9-]+)\), var\((--[a-z0-9-]+)\)\)/.exec(body);
    expect(stops, `thiếu gradient của ${sel} trong game-hub.css`).toBeTruthy();
    return [tokenRgb(stops![1]!), tokenRgb(stops![2]!)] as const;
  };
  const white = tokenRgb('--stone-0');

  it.each(['.tubu-day-btn--water', '.tubu-day-btn--checkin'])('chữ trắng trên %s ở mọi điểm của gradient', (sel) => {
    const [from, to] = gradient(sel);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) expect(ratio(white, lerp(from, to, t))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['--amber-600', '--amber-50'],
    ['--color-status-success-fg', '--color-status-success-bg'],
    ['--color-text-secondary', '--color-bg-subtle'],
  ])('%s trên %s (viên chuỗi, ô "Đã điểm danh", nút đang chờ)', (fg, bg) => {
    expect(ratio(tokenRgb(fg), tokenRgb(bg))).toBeGreaterThanOrEqual(4.5);
  });
});
