import { describe, expect, it } from 'vitest';
import { metadata } from './layout';
import { metadata as storefrontMeta } from './gian-hang/layout';

describe('/ctv layout', () => {
  it('landing /ctv cho phép lập chỉ mục, còn /ctv/gian-hang cá nhân vẫn noindex', () => {
    expect(metadata.title).toEqual({ default: 'Cộng tác viên', template: '%s — Tubu Tree' });
    expect(metadata.robots).toBeUndefined();
    expect(storefrontMeta.robots).toEqual({ index: false, follow: false });
  });
});
