import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PUBLIC_CONFIG_FALLBACK, resolvePublicConfig } from './use-public-config';

describe('PUBLIC_CONFIG_FALLBACK', () => {
  it('không hứa ngày giao và tắt mọi cờ đổi rác khi server chưa trả', () => {
    expect(PUBLIC_CONFIG_FALLBACK.shippingEta).toBeNull();
    expect(PUBLIC_CONFIG_FALLBACK.waste).toEqual({ enabled: false, dropoff: false, mailin: false, pickup: false });
  });
});

describe('resolvePublicConfig', () => {
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
});

describe('usePublicConfig', () => {
  it('dùng chung khoá public-config với khối Quà khách mới và giữ cấu hình 5 phút', () => {
    const src = readFileSync(new URL('./use-public-config.ts', import.meta.url), 'utf8');
    expect(src).toContain('publicConfigQuery(coreHttp)');
    expect(src).toMatch(/staleTime: 5 \* 60_000/);
  });
});
