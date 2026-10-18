import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_CONFIG_FALLBACK, resolvePublicConfig } from './use-public-config';

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

describe('PublicConfig.waste (§11.5, §16.1)', () => {
  it('fallback tắt mọi cờ đổi rác cho tới khi server trả', () => {
    expect(PUBLIC_CONFIG_FALLBACK.waste).toEqual({ enabled: false, dropoff: false, mailin: false, pickup: false });
  });
  it('chưa có dữ liệu → fallback', () => {
    expect(resolvePublicConfig(undefined)).toBe(PUBLIC_CONFIG_FALLBACK);
  });
  it('API cũ không trả waste → waste lấy từ fallback, trường khác giữ nguyên', () => {
    const { waste: _w, ...old } = { ...PUBLIC_CONFIG_FALLBACK, freeshipThreshold: 300_000 };
    const r = resolvePublicConfig(old as never);
    expect(r.waste).toEqual(PUBLIC_CONFIG_FALLBACK.waste);
    expect(r.freeshipThreshold).toBe(300_000);
  });
  it('server trả waste → dùng đúng giá trị server', () => {
    const flags = { enabled: true, dropoff: true, mailin: false, pickup: true };
    expect(resolvePublicConfig({ ...PUBLIC_CONFIG_FALLBACK, waste: flags }).waste).toEqual(flags);
  });
  it('mini app giữ cấu hình công khai 5 phút (staleTime, §11.5)', () => {
    expect(readFileSync(join(process.cwd(), 'src/hooks/use-public-config.ts'), 'utf8')).toMatch(/staleTime: 5 \* 60_000/);
  });
});
