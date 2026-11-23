import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  POSTER_COLORS,
  POSTER_H,
  POSTER_W,
  drawPoster,
  fillTabular,
  kitReferralCode,
  posterContent,
  posterLinkLabel,
  posterTarget,
  posterUrl,
  wrapLines,
  type PosterCtx,
} from './share-poster';

/** Bản giả canvas: mỗi ký tự rộng `px * 0.5` (chữ số "1" hẹp hơn để thử chữ số đều), ghi lại mọi lệnh vẽ. */
function fakeCtx() {
  const calls: { op: string; args: unknown[]; fill: unknown; font: string; align: string }[] = [];
  const ctx: PosterCtx = {
    fillStyle: '',
    font: '10px x',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    measureText(t: string) {
      const px = Number(/(\d+)px/.exec(this.font)?.[1] ?? 10);
      return { width: [...t].reduce((w, ch) => w + (ch === '1' ? px * 0.25 : px * 0.5), 0) };
    },
    fillRect: (...args) => calls.push({ op: 'rect', args, fill: ctx.fillStyle, font: ctx.font, align: ctx.textAlign }),
    fillText: (...args) => calls.push({ op: 'text', args, fill: ctx.fillStyle, font: ctx.font, align: ctx.textAlign }),
    beginPath: () => undefined,
    moveTo: () => undefined,
    arcTo: () => undefined,
    closePath: () => undefined,
    fill: () => calls.push({ op: 'fill', args: [], fill: ctx.fillStyle, font: ctx.font, align: ctx.textAlign }),
  };
  return { ctx, calls };
}

const byLen = (s: string) => s.length;

describe('posterUrl / posterLinkLabel: QR trỏ trang web công khai, mã giới thiệu đúng khuôn', () => {
  it('gian hàng, trang sản phẩm, trang chủ kèm ?ref=; mặc định tubutree.com', () => {
    expect(posterUrl('/s/lan-xanh', 'CTV1')).toBe('https://tubutree.com/s/lan-xanh?ref=CTV1');
    expect(posterUrl('/san-pham/tra-xanh', 'CTV1')).toBe('https://tubutree.com/san-pham/tra-xanh?ref=CTV1');
    expect(posterUrl('/', 'CTV1')).toBe('https://tubutree.com/?ref=CTV1');
    expect(posterUrl('brand/x', null, 'https://app.tubutree.com/')).toBe('https://app.tubutree.com/brand/x');
    expect(posterUrl('/s/a?tab=1', 'R')).toBe('https://tubutree.com/s/a?tab=1&ref=R');
  });

  it('mã sai khuôn (ký tự lạ, rỗng) bị bỏ, không đưa chuỗi lạ vào URL', () => {
    expect(posterUrl('/s/a', 'x&y=1')).toBe('https://tubutree.com/s/a');
    expect(posterUrl('/s/a', '')).toBe('https://tubutree.com/s/a');
  });

  it('nhãn link bỏ giao thức, www., tham số và "/" cuối', () => {
    expect(posterLinkLabel('https://tubutree.com/s/lan?ref=CTV1')).toBe('tubutree.com/s/lan');
    expect(posterLinkLabel('https://www.tubutree.com/?ref=A')).toBe('tubutree.com');
  });

  it('kitReferralCode: trường mới trước, API cũ thì đọc ref= trong shareLink', () => {
    expect(kitReferralCode({ referralCode: 'NEW1', shareLink: '/product/x?ref=OLD' })).toBe('NEW1');
    expect(kitReferralCode({ shareLink: 'https://zalo.me/s/1/product/x?ref=OLD9' })).toBe('OLD9');
    expect(kitReferralCode({ shareLink: '/product/x' })).toBeNull();
    expect(kitReferralCode({ shareLink: '/product/x?ref=a%20b' })).toBeNull();
  });
});

describe('posterTarget: link QR dùng cả khi không nạp được bộ vẽ', () => {
  it('trùng url của posterContent; mã sai dạng bị bỏ; sản phẩm lấy mã từ shareLink khi API cũ chưa trả referralCode', () => {
    const store = { kind: 'store', title: 'G', path: '/s/lan', referralCode: 'CTV1' } as const;
    expect(posterTarget(store)).toEqual({ url: posterContent(store).url, ref: 'CTV1' });
    expect(posterTarget({ ...store, referralCode: 'x y' })).toEqual({ url: 'https://tubutree.com/s/lan', ref: null });
    const product = { kind: 'product', name: 'Ly', slug: 'ly tre', shareLink: 'https://zalo.me/s/1/product/ly?ref=AB9' } as const;
    expect(posterTarget(product)).toEqual({ url: 'https://tubutree.com/san-pham/ly%20tre?ref=AB9', ref: 'AB9' });
    expect(posterTarget(product).url).toBe(posterContent(product).url);
  });
});

describe('posterContent: cùng nội dung ảnh ở Mini App và web', () => {
  it('gian hàng: dòng Tubu Tree, tên, mã giới thiệu, lời quét, link không có tham số', () => {
    const { url, content, fileName } = posterContent({ kind: 'store', title: 'Góc xanh của Lan', path: '/s/lan', referralCode: 'CTV1' });
    expect(url).toBe('https://tubutree.com/s/lan?ref=CTV1');
    expect(content).toEqual({
      kicker: 'Tubu Tree',
      title: 'Góc xanh của Lan',
      badge: 'Mã giới thiệu CTV1',
      scan: 'Quét mã bằng camera điện thoại để xem',
      link: 'tubutree.com/s/lan',
    });
    expect(fileName).toBe('tubutree-lan.png');
  });

  it('sản phẩm: thương hiệu làm dòng nhỏ, giá dạng 129.000đ, nhãn CTV; mã lấy từ shareLink khi API cũ', () => {
    const { url, content, fileName } = posterContent({
      kind: 'product',
      name: 'Nước rửa chén',
      slug: 'nuoc-rua-chen',
      brandName: 'Ecocare',
      priceVnd: 129000,
      shareLink: 'https://zalo.me/s/1/product/nuoc-rua-chen?ref=LAN1',
    });
    expect(url).toBe('https://tubutree.com/san-pham/nuoc-rua-chen?ref=LAN1');
    expect(content).toEqual({
      kicker: 'Ecocare',
      title: 'Nước rửa chén',
      price: '129.000đ',
      badge: 'CTV giới thiệu · Mã LAN1',
      scan: 'Quét mã bằng camera để xem và đặt hàng',
      link: 'tubutree.com/san-pham/nuoc-rua-chen',
    });
    expect(fileName).toBe('tubutree-nuoc-rua-chen.png');
  });

  it('không giá, không thương hiệu, không mã: bỏ giá và nhãn, dòng nhỏ là Tubu Tree, trang chủ đặt tên tệp chung', () => {
    const p = posterContent({ kind: 'product', name: 'X', slug: 'x y', priceVnd: 0, brandName: ' ' });
    expect(p.url).toBe('https://tubutree.com/san-pham/x%20y');
    expect(p.content.price).toBeNull();
    expect(p.content.badge).toBeNull();
    expect(p.content.kicker).toBe('Tubu Tree');
    expect(posterContent({ kind: 'store', title: 'T', path: '/' }).fileName).toBe('tubutree-qr.png');
  });
});

describe('wrapLines', () => {
  it('ngắt theo từ, giữ số dòng tối đa, dòng cuối thêm "…" khi thừa chữ', () => {
    expect(wrapLines(byLen, 'aa bb cc', 5, 3)).toEqual(['aa bb', 'cc']);
    expect(wrapLines(byLen, 'aa bb cc dd ee', 5, 2)).toEqual(['aa bb', 'cc d…']);
  });

  it('từ dài hơn một dòng cắt theo ký tự; chuỗi rỗng ra mảng rỗng', () => {
    expect(wrapLines(byLen, 'abcdefgh', 3, 5)).toEqual(['abc', 'def', 'gh']);
    expect(wrapLines(byLen, '   ', 3, 2)).toEqual([]);
  });
});

describe('fillTabular: chữ số đều bề rộng như tabular-nums', () => {
  it('"1" hẹp vẫn chiếm đúng một ô chữ số (căn giữa trong ô)', () => {
    const { ctx, calls } = fakeCtx();
    ctx.font = '700 20px x';
    fillTabular(ctx, '111.0', 0, 50);
    const xs = calls.map((c) => c.args[1] as number);
    // Ô chữ số = 10 (bề rộng "0"), "1" rộng 5 nên lệch 2,5 vào giữa ô.
    expect(xs).toEqual([2.5, 12.5, 22.5, 30, 40]);
  });
});

describe('drawPoster', () => {
  const qr = { size: 21, modules: Uint8Array.from({ length: 21 * 21 }, (_, i) => (i % 3 === 0 ? 1 : 0)) };

  it('khổ 1080×1350, nền dải xanh, QR đen đủ số module tối, chữ nằm trong ảnh', () => {
    const { ctx, calls } = fakeCtx();
    drawPoster(ctx, posterContent({ kind: 'product', name: 'Trà xanh', slug: 't', priceVnd: 99000, referralCode: 'A1' }).content, qr);
    expect(POSTER_W).toBe(1080);
    expect(POSTER_H).toBe(1350);
    expect(calls[0]).toMatchObject({ op: 'rect', args: [0, 0, 1080, 1350], fill: POSTER_COLORS.page });
    expect(calls[1]).toMatchObject({ op: 'rect', fill: POSTER_COLORS.band });
    const dark = calls.filter((c) => c.op === 'rect' && c.fill === POSTER_COLORS.qr);
    expect(dark).toHaveLength(Array.from(qr.modules).filter(Boolean).length);
    const texts = calls.filter((c) => c.op === 'text');
    for (const t of texts) {
      const [, x, y] = t.args as [string, number, number];
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(POSTER_W);
      expect(y).toBeLessThan(POSTER_H - 20);
    }
    const drawn = texts.map((t) => t.args[0]).join('');
    for (const s of ['Tubu Tree', 'Trà xanh', '99.000đ', 'CTV giới thiệu · Mã A1', 'tubutree.com/san-pham/t']) expect(drawn).toContain(s);
  });

  it('QR có lề trắng ít nhất 4 module trong thẻ trắng, module không lọt khỏi thẻ', () => {
    const { ctx, calls } = fakeCtx();
    drawPoster(ctx, posterContent({ kind: 'store', title: 'G', path: '/s/g' }).content, { size: 37, modules: new Uint8Array(37 * 37).fill(1) });
    const card = calls.find((c) => c.op === 'fill' && c.fill === POSTER_COLORS.card);
    expect(card).toBeDefined();
    const dark = calls.filter((c) => c.op === 'rect' && c.fill === POSTER_COLORS.qr).map((c) => c.args as number[]);
    const scale = dark[0]![2]!;
    const minX = Math.min(...dark.map((a) => a[0]!));
    const maxX = Math.max(...dark.map((a) => a[0]! + a[2]!));
    expect(minX - (POSTER_W - 600) / 2).toBeGreaterThanOrEqual(4 * scale);
    expect((POSTER_W + 600) / 2 - maxX).toBeGreaterThanOrEqual(4 * scale);
  });

  it('tên quá dài bị cắt "…" ở dòng tối đa, không đè thẻ QR', () => {
    const { ctx, calls } = fakeCtx();
    const long = 'Bộ quà tặng sống xanh gồm nước rửa chén bồ hòn túi refill và bàn chải tre cho cả nhà dùng hằng ngày rất lâu dài';
    drawPoster(ctx, posterContent({ kind: 'product', name: long, slug: 'b', priceVnd: 1, referralCode: 'A' }).content, qr);
    const title = calls.filter((c) => c.op === 'text' && c.font.includes('64px'));
    expect(title).toHaveLength(3);
    expect(String(title[2]!.args[0]).endsWith('…')).toBe(true);
    const lastTextAboveCard = Math.max(...calls.filter((c) => c.op === 'text' && c.align === 'left').map((c) => c.args[2] as number));
    expect(lastTextAboveCard).toBeLessThan(590);
  });
});

describe('POSTER_COLORS khớp tokens.css', () => {
  const css = readFileSync(new URL('../../../design-tokens/src/tokens.css', import.meta.url), 'utf8');
  const token = (name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim().toUpperCase();
  it.each([
    ['band', 'forest-700'],
    ['onBand', 'stone-50'],
    ['soft', 'forest-100'],
    ['chip', 'forest-50'],
    ['page', 'stone-50'],
    ['ink', 'stone-900'],
    ['muted', 'stone-600'],
  ] as const)('%s = --%s', (key, name) => {
    expect(POSTER_COLORS[key]).toBe(token(name));
  });
});
