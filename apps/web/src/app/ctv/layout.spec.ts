import { describe, expect, it } from 'vitest';
import { metadata } from './layout';

describe('/ctv layout', () => {
  it('có tiêu đề riêng và không lập chỉ mục', () => {
    expect(metadata.title).toBe('Cộng tác viên — Tubu Tree');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
