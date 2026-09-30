import { describe, it, expect } from 'vitest';
import { PUBLIC_CONFIG_FALLBACK } from './use-public-config';

/**
 * Giá trị mặc định khi /config/public chưa về hoặc lỗi mạng. Tính năng "Gửi lại vật liệu tái chế"
 * chỉ được bật khi BE xác nhận (Gomdon đã cấu hình + admin bật) — fallback phải TẮT tường minh,
 * không để `undefined` cho mỗi màn tự đoán.
 */
describe('PUBLIC_CONFIG_FALLBACK', () => {
  it('recyclingEnabled mặc định false (tắt cho tới khi server xác nhận)', () => {
    expect(PUBLIC_CONFIG_FALLBACK).toHaveProperty('recyclingEnabled', false);
  });
  it('shippingEta mặc định null — không hứa ngày giao khi server chưa trả', () => {
    expect(PUBLIC_CONFIG_FALLBACK).toHaveProperty('shippingEta', null);
  });
});
