// @vitest-environment jsdom
import QRCode from 'qrcode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEntryParams } from './entry-source';
import { miniAppDeepLink } from './mini-app-auto-open';
import { INSERT_QR_TAG_MAX, insertQrFileName, insertQrUrl, normalizeInsertTag, qrPngBlob, qrSvg, svgDataUrl } from './insert-qr';

const BASE = 'https://tubutree.com';

/** Dựng lại ma trận ô đen từ `d` của SVG (mỗi đoạn `M x y h n v1 h-n z` là n ô liền nhau trên hàng y). */
function matrixFromSvg(svg: string): { full: number; dark: Set<string> } {
  const full = Number(svg.match(/viewBox="0 0 (\d+) \1"/)![1]);
  const d = svg.match(/<path[^>]* d="([^"]*)"/)![1]!;
  const dark = new Set<string>();
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    const [x, y, n] = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let i = 0; i < n; i++) dark.add(`${x + i},${y}`);
  }
  return { full, dark };
}

const attributionOf = (url: string) => {
  const u = new URL(url);
  return parseEntryParams(u.searchParams, u.pathname, u.host);
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('insertQrUrl', () => {
  it('dẫn tới /quet-ma với utm_source và card, đúng link in thẻ bỏ hộp', () => {
    expect(insertQrUrl('shopee', 'box-2026-11', BASE)).toBe('https://tubutree.com/quet-ma?utm_source=shopee&card=box-2026-11');
    expect(insertQrUrl('tiktok', '  Box_A ', `${BASE}/`)).toBe('https://tubutree.com/quet-ma?utm_source=tiktok&card=box_a');
    expect(insertQrUrl('lazada', '', BASE)).toBe('https://tubutree.com/quet-ma?utm_source=lazada');
  });

  it('kênh lạ hoặc tag bộ đọc nguồn không nhận: null', () => {
    expect(insertQrUrl('facebook', 'x', BASE)).toBeNull();
    expect(insertQrUrl('shopee', 'có dấu', BASE)).toBeNull();
    expect(insertQrUrl('shopee', '-abc', BASE)).toBeNull();
    expect(insertQrUrl('shopee', 'a'.repeat(INSERT_QR_TAG_MAX + 1), BASE)).toBeNull();
    expect(insertQrUrl('shopee', 'a'.repeat(INSERT_QR_TAG_MAX), BASE)).not.toBeNull();
  });

  it('tag dài nhất vẫn được web ghi đúng nguồn và đợt thẻ (card-<tag> không vượt 40 ký tự)', () => {
    const tag = 'b'.repeat(INSERT_QR_TAG_MAX);
    expect(attributionOf(insertQrUrl('shopee', tag, BASE)!)).toMatchObject({ source: 'shopee', campaign: `card-${tag}` });
    expect(attributionOf(insertQrUrl('shopee', 'card-2611', BASE)!)).toMatchObject({ source: 'shopee', campaign: 'card-2611' });
    expect(attributionOf(insertQrUrl('lazada', '', BASE)!)).toMatchObject({ source: 'lazada' });
  });

  it('web điện thoại mở /quet-ma thì sang đúng màn quét của Mini App, giữ nguồn và đợt thẻ', () => {
    const url = new URL(insertQrUrl('shopee', 'box-2026-11', BASE)!);
    const deep = new URL(miniAppDeepLink(url.pathname, url.search));
    expect(deep.pathname.endsWith('/points/scan')).toBe(true);
    expect(Object.fromEntries(deep.searchParams)).toEqual({ utm_source: 'shopee', card: 'box-2026-11' });
  });

  it('normalizeInsertTag: rỗng là không gắn, chữ hoa về chữ thường', () => {
    expect(normalizeInsertTag('   ')).toBe('');
    expect(normalizeInsertTag('Box-11')).toBe('box-11');
    expect(normalizeInsertTag('a b')).toBeNull();
  });

  it('tên tệp tải về theo kênh và tag', () => {
    expect(insertQrFileName('shopee', 'box-2026-11', 'svg')).toBe('tubu-qr-shopee-box-2026-11.svg');
    expect(insertQrFileName('lazada', '', 'png')).toBe('tubu-qr-lazada.png');
  });
});

describe('qrSvg', () => {
  const url = 'https://tubutree.com/quet-ma?utm_source=shopee&card=box-2026-11';

  it('một <path>, crispEdges, lề trắng 4 ô, ô đen trùng đúng ma trận của thư viện qrcode', () => {
    const svg = qrSvg(url);
    expect(svg.match(/<path/g)).toHaveLength(1);
    expect(svg).toContain('shape-rendering="crispEdges"');
    const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const { full, dark } = matrixFromSvg(svg);
    expect(full).toBe(modules.size + 8);
    const want = new Set<string>();
    for (let y = 0; y < modules.size; y++) for (let x = 0; x < modules.size; x++) if (modules.data[y * modules.size + x]) want.add(`${x + 4},${y + 4}`);
    expect(dark).toEqual(want);
  });

  it('data URL dùng được cho <img> (CSP cho img-src data:)', () => {
    const svg = qrSvg(url);
    const src = svgDataUrl(svg);
    expect(src.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(src.slice(src.indexOf(',') + 1))).toBe(svg);
  });
});

describe('qrPngBlob', () => {
  it('canvas 1024px, tắt làm mịn, mỗi ô cùng một số nguyên điểm ảnh, giữ lề trắng 4 ô, xuất image/png', async () => {
    const rects: [number, number, number, number][] = [];
    const ctx = { imageSmoothingEnabled: true, fillStyle: '', fillRect: (...r: [number, number, number, number]) => rects.push(r) };
    const canvas = { width: 0, height: 0, getContext: () => ctx, toBlob: (cb: (b: Blob | null) => void, type: string) => cb(new Blob(['x'], { type })) };
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => (tag === 'canvas' ? canvas : realCreate(tag))) as typeof document.createElement);

    const url = 'https://tubutree.com/quet-ma?utm_source=shopee&card=box-2026-11';
    const blob = await qrPngBlob(url, 1024);
    expect(blob.type).toBe('image/png');
    expect([canvas.width, canvas.height]).toEqual([1024, 1024]);
    expect(ctx.imageSmoothingEnabled).toBe(false);
    const [bg, ...cells] = rects;
    expect(bg).toEqual([0, 0, 1024, 1024]);
    const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const scale = Math.floor(1024 / (modules.size + 8));
    expect(cells).toHaveLength(Array.from(modules.data).filter((v) => v === 1).length);
    for (const [x, y, w, h] of cells) {
      expect([w, h]).toEqual([scale, scale]);
      expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
      expect(x >= 4 * scale && y >= 4 * scale && x + w <= 1024 - 4 * scale && y + h <= 1024 - 4 * scale).toBe(true);
    }
  });
});
