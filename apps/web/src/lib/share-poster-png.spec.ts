// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import QRCode from 'qrcode';
import { renderPoster } from './share-poster-png';

afterEach(() => vi.restoreAllMocks());

function fakeCtx() {
  const dark: number[][] = [];
  const ctx = {
    fillStyle: '' as unknown,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    measureText: (t: string) => ({ width: t.length * 10 }),
    fillRect: (...a: number[]) => {
      if (ctx.fillStyle === '#000000') dark.push(a);
    },
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
  };
  return { ctx, dark };
}

describe('renderPoster (web)', () => {
  it('canvas 1080×1350, QR của link web công khai mã hoá bằng qrcode mức M (đủ module tối), kèm tệp PNG để chia sẻ', async () => {
    const { ctx, dark } = fakeCtx();
    const sizes: number[][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      sizes.push([this.width, this.height]);
      return ctx as unknown as CanvasRenderingContext2D;
    } as unknown as HTMLCanvasElement['getContext']);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,iVBORw0KGgo=');

    const out = await renderPoster({ kind: 'product', name: 'Trà xanh', slug: 'tra-xanh', priceVnd: 99000, referralCode: 'CTV1' });

    expect(out.url).toBe('https://tubutree.com/san-pham/tra-xanh?ref=CTV1');
    expect(out.png).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(out.fileName).toBe('tubutree-tra-xanh.png');
    expect(out.file?.name).toBe('tubutree-tra-xanh.png');
    expect(out.file?.type).toBe('image/png');
    expect(out.file?.size).toBe(8);
    expect(sizes).toEqual([[1080, 1350]]);
    const m = QRCode.create(out.url, { errorCorrectionLevel: 'M' }).modules;
    expect(dark).toHaveLength(Array.from(m.data).filter(Boolean).length);
  });

  it('không có canvas 2D: png rỗng, không có tệp, vẫn trả link để hiện QR thường', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const out = await renderPoster({ kind: 'store', title: 'G', path: '/', referralCode: 'R1' });
    expect(out).toEqual({ url: 'https://tubutree.com/?ref=R1', png: '', fileName: 'tubutree-qr.png', file: null });
  });
});
