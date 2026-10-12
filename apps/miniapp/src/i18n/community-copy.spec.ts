import { describe, it, expect } from 'vitest';
import { vi } from './vi';

/**
 * C-073: Tubu bán mỹ phẩm, tẩy rửa, đồ cho mẹ & bé, cà phê, thực phẩm — không bán cây cảnh. Lời trong khối cộng đồng
 * (ví dụ, nhãn nút) phải nói về hàng đang bán để bài hỏi đáp dẫn được tới đơn mua.
 * Tên bậc uy tín (Mầm / Cây non / Cổ thụ) là ẩn dụ thương hiệu Tubu Tree nên không nằm trong danh sách cấm.
 */
const PLANT_COPY = /lưỡi hổ|sen đá|chăm cây|khoe vườn|mua cây|sâu bệnh|cây cảnh|tưới nước|chậu/i;

function collectStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => collectStrings(n, out));
  else if (node && typeof node === 'object') Object.values(node).forEach((n) => collectStrings(n, out));
  return out;
}

describe('lời cộng đồng nói về hàng đang bán, không phải cây cảnh (C-073)', () => {
  it('khối vi.community không còn ví dụ/nhãn về chăm cây', () => {
    const offenders = collectStrings(vi.community).filter((s) => PLANT_COPY.test(s));
    expect(offenders).toEqual([]);
  });

  it('nút gắn sản phẩm trong bài không gọi sản phẩm là "cây"', () => {
    expect(vi.community.buyThis).toBe('Mua sản phẩm này');
  });
});
