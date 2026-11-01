import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'src', 'components', 'app.tsx'), 'utf8');
const at = (needle: string) => {
  const i = src.indexOf(needle);
  expect(i, `${needle} không có trong app.tsx`).toBeGreaterThan(-1);
  return i;
};

/**
 * Thứ tự Tab và trình đọc màn hình đi theo thứ tự DOM, không theo vị trí nút trên màn hình. Nút Quay lại toàn cục là `position: fixed` ở góc trên trái, nên
 * đặt ở đâu trong cây cũng nằm đúng chỗ: nó phải đứng TRƯỚC nội dung chính và thanh dưới, để người dùng bàn phím gặp nút lùi trước cả trang.
 */
describe('app.tsx: thứ tự DOM của nút Quay lại', () => {
  it('<BackButton /> đứng trước <MainLandmark> và <BottomNav />', () => {
    expect(at('<BackButton />')).toBeLessThan(at('<MainLandmark>'));
    expect(at('<BackButton />')).toBeLessThan(at('<BottomNav />'));
  });
  it('chỉ vẽ một nút Quay lại', () => {
    expect(src.split('<BackButton />').length - 1).toBe(1);
  });
});
