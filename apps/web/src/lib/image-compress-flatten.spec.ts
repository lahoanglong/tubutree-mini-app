// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readAndCompressImage, readImageForLabelOcr } from './image-compress';

/** Canvas giả ghi lại thứ tự thao tác vẽ: JPEG không có kênh trong suốt, nên điểm ảnh trong suốt của PNG ra màu đen nếu không tô nền trước. */
function stubCanvas() {
  const ops: string[] = [];
  const ctx = {
    set fillStyle(v: string) {
      ops.push(`fillStyle:${v}`);
    },
    fillRect: (...a: number[]) => ops.push(`fillRect:${a.join(',')}`),
    drawImage: () => ops.push('drawImage'),
  };
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return realCreate(tag);
    return { width: 0, height: 0, getContext: () => ctx, toDataURL: () => 'data:image/jpeg;base64,QUJD' } as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
  class FakeImage {
    naturalWidth = 800;
    naturalHeight = 600;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', FakeImage);
  URL.createObjectURL = () => 'blob:x';
  URL.revokeObjectURL = () => undefined;
  return ops;
}

const file = () => new File(['x'], 'cat-nen.png', { type: 'image/png' });

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('nén ảnh sang JPEG: tô nền trắng trước khi vẽ để ảnh PNG trong suốt không thành nền đen', () => {
  it('readAndCompressImage (ảnh sản phẩm, ảnh minh chứng): tô trắng cả khung rồi mới vẽ ảnh', async () => {
    const ops = stubCanvas();
    await readAndCompressImage(file());
    expect(ops).toEqual(['fillStyle:#ffffff', 'fillRect:0,0,800,600', 'drawImage']);
  });

  it('readImageForLabelOcr (ảnh nhãn bao bì): cùng một thứ tự', async () => {
    const ops = stubCanvas();
    await readImageForLabelOcr(file());
    expect(ops).toEqual(['fillStyle:#ffffff', 'fillRect:0,0,800,600', 'drawImage']);
  });
});
