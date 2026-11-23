// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderPoster } from './share-poster-png';
import { qrMatrix } from './qr-matrix';

function fakeCtx() {
  const rects: number[][] = [];
  const ctx = {
    fillStyle: '' as unknown,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    measureText: (t: string) => ({ width: t.length * 10 }),
    fillRect: (...a: number[]) => {
      if (ctx.fillStyle === '#000000') rects.push(a);
    },
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
  };
  return { ctx, rects };
}

afterEach(() => vi.restoreAllMocks());

describe('renderPoster (Mini)', () => {
  it('canvas 1080×1350, QR mã hoá link web công khai bằng qr-matrix (đủ module tối), trả PNG data URL', async () => {
    const { ctx, rects } = fakeCtx();
    const sizes: number[][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      sizes.push([this.width, this.height]);
      return ctx as unknown as CanvasRenderingContext2D;
    } as unknown as HTMLCanvasElement['getContext']);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAA');

    const out = await renderPoster({ kind: 'store', title: 'Góc xanh', path: '/s/goc-xanh', referralCode: 'CTV1' });

    expect(out).toEqual({ url: 'https://tubutree.com/s/goc-xanh?ref=CTV1', png: 'data:image/png;base64,AAA' });
    expect(sizes).toEqual([[1080, 1350]]);
    const m = qrMatrix(out.url);
    expect(rects).toHaveLength(Array.from(m.modules).filter(Boolean).length);
  });

  it('không có canvas 2D: png rỗng, vẫn trả link để hiện QR thường', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const out = await renderPoster({ kind: 'product', name: 'Trà', slug: 'tra', referralCode: 'A1' });
    expect(out).toEqual({ url: 'https://tubutree.com/san-pham/tra?ref=A1', png: '' });
  });
});
