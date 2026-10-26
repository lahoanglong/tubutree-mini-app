import { describe, expect, it } from 'vitest';
import { shellPath } from './shell-pathname';

describe('shellPath: đường dẫn cho vỏ trang', () => {
  it('bản Trang chủ dựng sẵn tính là "/" để HTML server có thanh đáy như lần hydrate', () => {
    for (const p of ['/khoi-phuc/returning-1', '/khoi-phuc/new', '/khoi-phuc/unknown']) expect(shellPath(p)).toBe('/');
  });

  it('đường dẫn khác giữ nguyên, null giữ null', () => {
    for (const p of ['/', '/san-pham', '/khoi-phuc', '/khoi-phuc/a/b', '/tai-khoan/khoi-phuc/x']) expect(shellPath(p)).toBe(p);
    expect(shellPath(null)).toBeNull();
  });
});
