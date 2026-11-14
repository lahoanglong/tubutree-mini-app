// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LABEL_OCR_ATTEMPTS, LABEL_OCR_MAX_DATA_URL_LENGTH, readImageForLabelOcr } from './image-compress';

/** Ảnh giả 4000x3000 và canvas giả trả chuỗi có độ dài định sẵn theo (cạnh dài, chất lượng) để kiểm thứ tự thử nén. */
function stubBrowser(lengthFor: (maxSide: number, quality: number) => number) {
  const created: { width: number; height: number }[] = [];
  const toDataURL = vi.fn((_type: string, quality: number) => {
    const canvas = created[created.length - 1]!;
    return 'x'.repeat(lengthFor(Math.max(canvas.width, canvas.height), quality));
  });
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return realCreate(tag);
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' }), toDataURL };
    created.push(canvas);
    return canvas as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
  class FakeImage {
    naturalWidth = 4000;
    naturalHeight = 3000;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', FakeImage);
  URL.createObjectURL = () => 'blob:x';
  URL.revokeObjectURL = () => undefined;
  return { toDataURL, created };
}

const file = () => new File(['x'], 'nhan.jpg', { type: 'image/jpeg' });

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('readImageForLabelOcr — nén ảnh nhãn bao bì để AI đọc', () => {
  it('hằng số: thử độ phân giải cao trước, rồi mức thấp hơn; trần ký tự nằm dưới trần 5 MB của API sau base64', () => {
    expect(LABEL_OCR_ATTEMPTS[0]!.maxDim).toBeGreaterThan(1200);
    expect(LABEL_OCR_ATTEMPTS[1]!.maxDim).toBeLessThan(LABEL_OCR_ATTEMPTS[0]!.maxDim);
    expect(LABEL_OCR_ATTEMPTS[1]!.quality).toBeLessThan(LABEL_OCR_ATTEMPTS[0]!.quality);
    const apiMaxBase64 = Math.ceil((5 * 1024 * 1024) / 3) * 4;
    expect(LABEL_OCR_MAX_DATA_URL_LENGTH).toBeLessThan(apiMaxBase64);
  });

  it('ảnh nhẹ ở mức đầu: dùng ngay, chỉ nén một lần, cạnh dài đúng mức đầu', async () => {
    const { toDataURL, created } = stubBrowser(() => 500_000);
    const out = await readImageForLabelOcr(file());
    expect(out).toHaveLength(500_000);
    expect(toDataURL).toHaveBeenCalledTimes(1);
    expect(Math.max(created[0]!.width, created[0]!.height)).toBe(LABEL_OCR_ATTEMPTS[0]!.maxDim);
    expect(toDataURL.mock.calls[0]).toEqual(['image/jpeg', LABEL_OCR_ATTEMPTS[0]!.quality]);
  });

  it('mức đầu vượt trần thì nén lại ở mức thấp hơn và dùng kết quả đó', async () => {
    const { toDataURL, created } = stubBrowser((side) => (side === LABEL_OCR_ATTEMPTS[0]!.maxDim ? LABEL_OCR_MAX_DATA_URL_LENGTH + 1 : 900_000));
    const out = await readImageForLabelOcr(file());
    expect(out).toHaveLength(900_000);
    expect(toDataURL).toHaveBeenCalledTimes(2);
    expect(Math.max(created[1]!.width, created[1]!.height)).toBe(LABEL_OCR_ATTEMPTS[1]!.maxDim);
    expect(toDataURL.mock.calls[1]).toEqual(['image/jpeg', LABEL_OCR_ATTEMPTS[1]!.quality]);
  });

  it('cả hai mức đều vượt trần thì báo lỗi, không trả ảnh mà API sẽ từ chối', async () => {
    stubBrowser(() => LABEL_OCR_MAX_DATA_URL_LENGTH + 1);
    await expect(readImageForLabelOcr(file())).rejects.toThrow('Ảnh quá nặng sau khi nén');
  });
});
