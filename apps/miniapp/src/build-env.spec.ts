import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertMiniappBuildEnv } from './build-env';

const OK = 'https://api.tubutree.com/api';

describe('assertMiniappBuildEnv — bản build production phải biết địa chỉ API (D10-01)', () => {
  it('production thiếu hoặc rỗng VITE_API_BASE_URL → lỗi nêu đúng tên biến', () => {
    expect(() => assertMiniappBuildEnv('production', {})).toThrow(/VITE_API_BASE_URL/);
    expect(() => assertMiniappBuildEnv('production', { VITE_API_BASE_URL: '' })).toThrow(/VITE_API_BASE_URL/);
    expect(() => assertMiniappBuildEnv('production', { VITE_API_BASE_URL: '   ' })).toThrow(/VITE_API_BASE_URL/);
  });

  it('production trỏ localhost / 127.0.0.1 / http thường → lỗi (điện thoại khách không với tới máy chủ)', () => {
    for (const bad of ['http://localhost:3001/api', 'https://localhost/api', 'https://127.0.0.1:3221/api', 'http://api.tubutree.com/api']) {
      expect(() => assertMiniappBuildEnv('production', { VITE_API_BASE_URL: bad }), bad).toThrow(/VITE_API_BASE_URL/);
    }
  });

  it('thông báo lỗi nói cách sửa bằng tiếng Việt và nêu ví dụ https', () => {
    try {
      assertMiniappBuildEnv('production', {});
      throw new Error('phải ném lỗi');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/\.env\.production|biến môi trường/);
      expect(msg).toContain('https://');
    }
  });

  it('production có https hợp lệ → qua', () => {
    expect(() => assertMiniappBuildEnv('production', { VITE_API_BASE_URL: OK })).not.toThrow();
  });

  it('development và các mode khác bỏ qua kiểm tra (dev giữ mặc định localhost)', () => {
    expect(() => assertMiniappBuildEnv('development', {})).not.toThrow();
    expect(() => assertMiniappBuildEnv('development', { VITE_API_BASE_URL: 'http://localhost:3001/api' })).not.toThrow();
    expect(() => assertMiniappBuildEnv('test', {})).not.toThrow();
  });

  it('vite.config.mts gọi hàm kiểm khi build (xoá lời gọi thì spec này đỏ)', () => {
    const cfg = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../vite.config.mts'), 'utf8');
    expect(cfg).toContain('assertMiniappBuildEnv');
    expect(cfg).toMatch(/command === 'build'/);
  });
});
