import { describe, expect, it } from 'vitest';
import { skeletonKindFor } from './route-skeleton';

describe('skeletonKindFor (R-76)', () => {
  it('chọn khung chờ theo trang đang mở, tiền tố dài nhất thắng', () => {
    expect(skeletonKindFor('/tai-khoan')).toBe('hub');
    expect(skeletonKindFor('/tai-khoan/diem-xanh')).toBe('balance');
    expect(skeletonKindFor('/tai-khoan/don-hang/TUBU123')).toBe('list');
    expect(skeletonKindFor('/tai-khoan/ho-so')).toBe('form');
    expect(skeletonKindFor('/thanh-toan/chuyen-khoan/TUBU1')).toBe('form');
    expect(skeletonKindFor('/gio-hang')).toBe('list');
  });
  it('đường dẫn lạ hoặc chưa biết dùng khung danh sách', () => {
    expect(skeletonKindFor('/cong-dong')).toBe('list');
    expect(skeletonKindFor(null)).toBe('list');
    expect(skeletonKindFor('/tai-khoan-gia')).toBe('list');
  });
});
