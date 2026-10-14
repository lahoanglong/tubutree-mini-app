import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, MAX_UPLOAD_DATA_URL_LENGTH, fitWithin, isUsableImageFile } from './image-compress';

describe('fitWithin — thu ảnh về cạnh dài tối đa, giữ tỉ lệ', () => {
  it('ảnh nhỏ hơn mức tối đa giữ nguyên kích thước', () => {
    expect(fitWithin(800, 600, 1200)).toEqual({ width: 800, height: 600 });
  });
  it('ảnh ngang thu theo chiều rộng, ảnh dọc thu theo chiều cao', () => {
    expect(fitWithin(4000, 3000, 1200)).toEqual({ width: 1200, height: 900 });
    expect(fitWithin(3000, 4000, 1200)).toEqual({ width: 900, height: 1200 });
  });
  it('ảnh vuông và kích thước lẻ làm tròn, không ra 0', () => {
    expect(fitWithin(2400, 2400, 1200)).toEqual({ width: 1200, height: 1200 });
    expect(fitWithin(10000, 1, 1200)).toEqual({ width: 1200, height: 1 });
  });
});

describe('giới hạn ảnh minh chứng', () => {
  it('ảnh gốc tối đa 20MB (chặn trước khi đưa vào canvas) và ảnh nén dưới trần của API (1.500.000 ký tự)', () => {
    expect(MAX_IMAGE_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_UPLOAD_DATA_URL_LENGTH).toBeLessThanOrEqual(1_500_000);
  });
  it('chỉ nhận tệp ảnh', () => {
    expect(isUsableImageFile({ type: 'image/png' } as File)).toBe(true);
    expect(isUsableImageFile({ type: 'application/pdf' } as File)).toBe(false);
    expect(isUsableImageFile({ type: '' } as File)).toBe(false);
  });
});
