// @vitest-environment jsdom
import { crc32 } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FORBIDDEN_TERMS } from '@tubutree/app-core/shop-copy';
import { createLuminanceDecoder } from './code-scan-zxing';
import { insertQrUrl, qrPath } from './insert-qr';
import {
  A6_CARD_DPI,
  A6_CARD_MM,
  A6_CARD_PX,
  formatEarnPct,
  insertCardShortLink,
  insertCardSteps,
  insertQrCardFileName,
  insertQrCardPngBlob,
  insertQrCardPrintHtml,
  insertQrCardSvg,
  pngWithDpi,
  printInsertQrCard,
} from './insert-qr-card';

const URL_SHOPEE = insertQrUrl('shopee', 'box-2026-11', 'https://tubutree.com')!;
const svgOf = (channel: 'shopee' | 'tiktok' | 'lazada' = 'shopee', opts: Parameters<typeof insertQrCardSvg>[2] = { earnPct: 5 }) => insertQrCardSvg(URL_SHOPEE, channel, opts);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const parse = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml');
const texts = (svg: string) => Array.from(parse(svg).querySelectorAll('text')).map((t) => t.textContent!);

describe('insertQrCardSvg', () => {
  it('SVG hợp lệ, hệ toạ độ là điểm ảnh A6 300 DPI; cỡ px hoặc mm theo unit', () => {
    expect(A6_CARD_PX).toEqual({ widthPx: Math.round((A6_CARD_MM.widthMm / 25.4) * A6_CARD_DPI), heightPx: Math.round((A6_CARD_MM.heightMm / 25.4) * A6_CARD_DPI) });
    const px = insertQrCardSvg(URL_SHOPEE, 'shopee');
    const doc = parse(px);
    expect(doc.querySelector('parsererror')).toBeNull();
    const root = doc.documentElement;
    expect(root.getAttribute('viewBox')).toBe('0 0 1240 1748');
    expect(root.getAttribute('width')).toBe('1240');
    expect(root.getAttribute('height')).toBe('1748');
    const mm = parse(insertQrCardSvg(URL_SHOPEE, 'shopee', { unit: 'mm' })).documentElement;
    expect(mm.getAttribute('viewBox')).toBe('0 0 1240 1748');
    expect(mm.getAttribute('width')).toBe('105mm');
    expect(mm.getAttribute('height')).toBe('148mm');
  });

  it('có nhãn sàn đúng kênh và ba bước Quét mã, Quét đơn sàn, Nhận 5% Điểm Xanh', () => {
    const shopee = texts(svgOf('shopee'));
    expect(shopee).toContain('Mua trên Shopee');
    expect(texts(svgOf('tiktok'))).toContain('Mua trên TikTok Shop');
    expect(texts(svgOf('lazada'))).toContain('Mua trên Lazada');
    const sentences = insertCardSteps(5).map((s) => s.lines.join(' '));
    expect(sentences).toEqual(['Quét mã', 'Quét đơn sàn', 'Nhận 5% Điểm Xanh']);
    const doc = parse(svgOf('shopee'));
    const stepsInSvg = Array.from(doc.querySelectorAll('[data-step]')).map((g) => Array.from(g.querySelectorAll('text')).slice(1).map((t) => t.textContent).join(' '));
    expect(stepsInSvg).toEqual(sentences);
    expect(shopee).toContain('Tubu Tree');
    expect(shopee).toContain('tubutree.com/quet-ma');
  });

  it('con số ở bước 3 là tỉ lệ cấu hình (lẻ dùng dấu phẩy); chưa biết tỉ lệ thì không in con số nào', () => {
    const step3 = (opts: Parameters<typeof insertQrCardSvg>[2]) =>
      Array.from(parse(svgOf('shopee', opts)).querySelectorAll('[data-step="3"] text')).slice(1).map((t) => t.textContent).join(' ');
    expect(step3({ earnPct: 3 })).toBe('Nhận 3% Điểm Xanh');
    expect(step3({ earnPct: 2.5 })).toBe('Nhận 2,5% Điểm Xanh');
    expect(step3({ earnPct: null })).toBe('Nhận Điểm Xanh');
    expect(step3({})).toBe('Nhận Điểm Xanh');
    expect(step3({ earnPct: 0 })).toBe('Nhận Điểm Xanh');
    expect(step3({ earnPct: Number.NaN })).toBe('Nhận Điểm Xanh');
    expect(formatEarnPct(20)).toBe('20');
    expect(formatEarnPct(0.1)).toBe('0,1');
  });

  it('chữ in lên thẻ không chứa link nguồn (utm_source, card) và không phạm FORBIDDEN_TERMS', () => {
    const all = texts(insertQrCardSvg(URL_SHOPEE, 'shopee'));
    expect(all.join('\n')).not.toMatch(/utm_source|card=|box-2026-11/);
    for (const t of all) for (const f of FORBIDDEN_TERMS) expect(t, `"${t}" dính ${f.pattern}`).not.toMatch(f.pattern);
  });

  it('mã QR trên thẻ là đúng ma trận của link, cỡ ô nguyên điểm ảnh, nằm trong thẻ với lề an toàn', () => {
    const svg = insertQrCardSvg(URL_SHOPEE, 'shopee');
    const g = parse(svg).querySelector('[data-qr]')!;
    const m = g.getAttribute('transform')!.match(/translate\((\d+) (\d+)\) scale\((\d+)\)/)!;
    const [x, y, scale] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const { full, d } = qrPath(URL_SHOPEE);
    expect(g.querySelector('path')!.getAttribute('d')).toBe(d);
    expect(Number.isInteger(scale) && scale >= 10).toBe(true);
    expect(scale * full).toBeLessThanOrEqual(700);
    expect(x).toBeGreaterThanOrEqual(150);
    expect(x + scale * full).toBeLessThanOrEqual(A6_CARD_PX.widthPx - 150);
    expect(y + scale * full).toBeLessThan(1400);
  });

  it('mã trên thẻ đọc được bằng ZXing và ra đúng link (có nguồn và đợt thẻ)', () => {
    const svg = insertQrCardSvg(URL_SHOPEE, 'shopee');
    const g = parse(svg).querySelector('[data-qr]')!;
    const scale = Number(g.getAttribute('transform')!.match(/scale\((\d+)\)/)![1]);
    const { full } = qrPath(URL_SHOPEE);
    const dark = new Set<string>();
    for (const mm of g.querySelector('path')!.getAttribute('d')!.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
      for (let i = 0; i < Number(mm[3]); i++) dark.add(`${Number(mm[1]) + i},${mm[2]}`);
    }
    const margin = 40;
    const side = full * scale + margin * 2;
    const lum = new Uint8ClampedArray(side * side).fill(255);
    for (let py = 0; py < full * scale; py++) {
      for (let px = 0; px < full * scale; px++) {
        if (dark.has(`${Math.floor(px / scale)},${Math.floor(py / scale)}`)) lum[(py + margin) * side + px + margin] = 0;
      }
    }
    expect(createLuminanceDecoder(['qr_code']).decode(lum, side, side, true)).toBe(URL_SHOPEE);
  });
});

describe('insertCardShortLink / insertQrCardFileName', () => {
  it('chỉ host + đường dẫn, bỏ tham số; link hỏng giữ nguyên', () => {
    expect(insertCardShortLink('https://tubutree.com/quet-ma?utm_source=shopee&card=x')).toBe('tubutree.com/quet-ma');
    expect(insertCardShortLink('không phải link')).toBe('không phải link');
  });

  it('tên tệp theo sàn và đợt thẻ', () => {
    expect(insertQrCardFileName('shopee', 'Box-2026-11')).toBe('tubu-the-a6-shopee-box-2026-11.png');
    expect(insertQrCardFileName('tiktok', '')).toBe('tubu-the-a6-tiktok.png');
  });
});

/** PNG tối thiểu hợp lệ (1×1 xám): chữ ký + IHDR + IDAT + IEND, CRC tính bằng node:zlib để độc lập với mã đang test. */
function tinyPng(extra: Uint8Array[] = []): Uint8Array {
  const chunk = (type: string, data: number[]) => {
    const body = new Uint8Array(4 + data.length);
    body.set([...type].map((c) => c.charCodeAt(0)), 0);
    body.set(data, 4);
    const out = new Uint8Array(8 + data.length + 4);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(body, 4);
    v.setUint32(8 + data.length, crc32(body));
    return out;
  };
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]),
    ...extra,
    chunk('IDAT', [0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]),
    chunk('IEND', []),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}

const chunkTypes = (png: Uint8Array) => {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: string[] = [];
  for (let o = 8; o < png.length; o += 12 + v.getUint32(o)) out.push(String.fromCharCode(...png.subarray(o + 4, o + 8)));
  return out;
};

describe('pngWithDpi', () => {
  it('chèn pHYs ngay sau IHDR: 11811 điểm ảnh/mét (300 DPI), đơn vị mét, CRC đúng, các khối khác nguyên vẹn', () => {
    const src = tinyPng();
    const out = pngWithDpi(src, 300);
    expect(chunkTypes(out)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
    const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(v.getUint32(33)).toBe(9);
    expect(v.getUint32(41)).toBe(11811);
    expect(v.getUint32(45)).toBe(11811);
    expect(out[49]).toBe(1);
    expect(v.getUint32(50)).toBe(crc32(out.subarray(37, 50)));
    expect(out.length).toBe(src.length + 21);
    expect(Array.from(out.subarray(0, 33))).toEqual(Array.from(src.subarray(0, 33)));
    expect(Array.from(out.subarray(54))).toEqual(Array.from(src.subarray(33)));
  });

  it('chạy lại không chèn lần hai (cùng kết quả); ảnh không phải PNG trả nguyên', () => {
    const once = pngWithDpi(tinyPng(), 300);
    const twice = pngWithDpi(once, 300);
    expect(chunkTypes(twice)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
    expect(Array.from(twice)).toEqual(Array.from(once));
    const junk = Uint8Array.from([1, 2, 3, 4]);
    expect(pngWithDpi(junk, 300)).toBe(junk);
  });

  it('bộ mã hoá đã ghi sẵn pHYs 72 DPI (2835): ghi đè thành 300 DPI với CRC mới, không giữ giá trị cũ', () => {
    const phys = (ppm: number) => {
      const body = new Uint8Array(13);
      body.set([0x70, 0x48, 0x59, 0x73], 0);
      new DataView(body.buffer).setUint32(4, ppm);
      new DataView(body.buffer).setUint32(8, ppm);
      body[12] = 1;
      const out = new Uint8Array(21);
      const v = new DataView(out.buffer);
      v.setUint32(0, 9);
      out.set(body, 4);
      v.setUint32(17, crc32(body));
      return out;
    };
    const src = tinyPng([phys(2835)]);
    const out = pngWithDpi(src, 300);
    expect(out.length).toBe(src.length);
    expect(chunkTypes(out)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
    const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect([v.getUint32(41), v.getUint32(45), out[49]]).toEqual([11811, 11811, 1]);
    expect(v.getUint32(50)).toBe(crc32(out.subarray(37, 50)));
    // Bản gốc không bị sửa.
    expect(new DataView(src.buffer).getUint32(41)).toBe(2835);
  });
});

describe('insertQrCardPngBlob', () => {
  const stubBrowser = (opts: { ctx?: object | null; imageFails?: boolean; blob?: Blob | null }) => {
    const calls = { drawImage: [] as unknown[][], size: { w: 0, h: 0 } };
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_: string) {
          queueMicrotask(() => (opts.imageFails ? this.onerror?.() : this.onload?.()));
        }
      },
    );
    const real = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'canvas') return real(tag);
      const canvas = {
        width: 0,
        height: 0,
        getContext: () =>
          opts.ctx === undefined
            ? { fillStyle: '', fillRect: () => undefined, drawImage: (...a: unknown[]) => calls.drawImage.push(a) }
            : opts.ctx,
        toBlob: (cb: (b: Blob | null) => void) => {
          calls.size = { w: canvas.width, h: canvas.height };
          cb(opts.blob === undefined ? new Blob([tinyPng() as BlobPart], { type: 'image/png' }) : opts.blob);
        },
      };
      return canvas as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);
    return calls;
  };

  it('vẽ ảnh SVG kín 1240×1748 rồi gắn 300 DPI vào PNG trả về', async () => {
    const calls = stubBrowser({});
    const blob = await insertQrCardPngBlob(insertQrCardSvg(URL_SHOPEE, 'shopee'));
    expect(calls.size).toEqual({ w: 1240, h: 1748 });
    expect(calls.drawImage).toHaveLength(1);
    expect(calls.drawImage[0]!.slice(1)).toEqual([0, 0, 1240, 1748]);
    expect(blob.type).toBe('image/png');
    expect(chunkTypes(new Uint8Array(await blob.arrayBuffer()))).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
  });

  it('báo lỗi tiếng Việt khi ảnh không dựng được, canvas không có ngữ cảnh hay không xuất được PNG', async () => {
    stubBrowser({ imageFails: true });
    await expect(insertQrCardPngBlob('<svg/>')).rejects.toThrow('Trình duyệt không dựng được ảnh thẻ.');
    vi.restoreAllMocks();
    stubBrowser({ ctx: null });
    await expect(insertQrCardPngBlob('<svg/>')).rejects.toThrow('Trình duyệt không vẽ được ảnh.');
    vi.restoreAllMocks();
    stubBrowser({ blob: null });
    await expect(insertQrCardPngBlob('<svg/>')).rejects.toThrow('Trình duyệt không xuất được ảnh PNG.');
  });
});

describe('in / lưu PDF', () => {
  it('trang in là giấy A6 không lề, chỉ chứa thẻ cỡ 105×148 mm', () => {
    const html = insertQrCardPrintHtml(insertQrCardSvg(URL_SHOPEE, 'shopee', { unit: 'mm' }));
    expect(html).toContain('@page{size:105mm 148mm;margin:0}');
    expect(html).toContain('width="105mm" height="148mm"');
    expect(html).toContain('print-color-adjust:exact');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.body.children).toHaveLength(1);
    expect(doc.body.firstElementChild!.tagName.toLowerCase()).toBe('svg');
  });

  it('mở khung ẩn cỡ thật của thẻ (nằm ngoài màn hình, không 0×0) rồi gọi in sau một nhịp; afterprint gỡ khung', async () => {
    vi.useFakeTimers();
    const print = vi.fn();
    const done = printInsertQrCard(insertQrCardSvg(URL_SHOPEE, 'shopee', { unit: 'mm' }), print);
    const frame = document.querySelector('iframe')!;
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(frame.style.width).toBe('105mm');
    expect(frame.style.height).toBe('148mm');
    expect(frame.style.left).toBe('-300mm');
    expect(frame.contentDocument!.documentElement.innerHTML).toContain('@page{size:105mm 148mm;margin:0}');
    expect(frame.contentDocument!.querySelector('svg')).not.toBeNull();
    expect(print).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(print).toHaveBeenCalledWith(frame.contentWindow);
    expect(document.querySelector('iframe')).toBe(frame);
    frame.contentWindow!.dispatchEvent(new Event('afterprint'));
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('không gỡ khung theo đồng hồ (hộp xem trước có thể còn mở); lần in kế tiếp thay khung cũ, không để dồn', async () => {
    vi.useFakeTimers();
    const first = printInsertQrCard('<svg id="one"/>', vi.fn());
    await vi.advanceTimersByTimeAsync(100);
    await first;
    const frameOne = document.querySelector('iframe')!;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(document.querySelector('iframe')).toBe(frameOne);
    const second = printInsertQrCard('<svg id="two"/>', vi.fn());
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    expect(document.querySelector('iframe')).not.toBe(frameOne);
    await vi.advanceTimersByTimeAsync(100);
    await second;
  });

  it('in ném lỗi: gỡ khung và báo lỗi cho người gọi', async () => {
    vi.useFakeTimers();
    const done = printInsertQrCard('<svg/>', () => {
      throw new Error('Trình duyệt không mở được hộp thoại in.');
    });
    const failed = expect(done).rejects.toThrow('Trình duyệt không mở được hộp thoại in.');
    await vi.advanceTimersByTimeAsync(100);
    await failed;
    expect(document.querySelector('iframe')).toBeNull();
  });
});
