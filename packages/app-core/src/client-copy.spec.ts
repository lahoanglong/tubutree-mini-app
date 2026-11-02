import { describe, expect, it } from 'vitest';
import * as copy from './client-copy';
import { FORBIDDEN_TERMS } from './shop-copy';

const strings = (): [string, string][] =>
  Object.entries(copy).flatMap(([name, v]) => (typeof v === 'string' ? [[name, v] as [string, string]] : []));

describe('client-copy: chữ dùng chung hai app', () => {
  it('không hằng chữ nào dính thuật ngữ cấm', () => {
    const bad = strings().filter(([, text]) => FORBIDDEN_TERMS.some((t) => t.pattern.test(text))).map(([name]) => name);
    expect(bad).toEqual([]);
  });

  it('chủ thương hiệu: tiêu đề và huy hiệu dùng "Thương hiệu"', () => {
    expect(copy.BRAND_OWNER_TITLE).toBe('Quản lý thương hiệu');
    expect(copy.BRAND_BADGE).toBe('Thương hiệu trên Tubu Tree');
  });
});
