// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./vouchers-view', () => ({ default: () => <div data-testid="vouchers-view" /> }));

import { metadata } from './layout';
import VouchersPage from './page';

describe('/ma-giam-gia (server)', () => {
  it('metadata: tiêu đề, noindex + nofollow như /uu-dai, không canonical (noindex kèm canonical là hai tín hiệu mâu thuẫn)', () => {
    expect(metadata.title).toBe('Mã giảm giá — Tubu Tree');
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates).toBeUndefined();
  });

  it('trang dùng khung rộng PAGE_WIDE (không khung Tài khoản) và dựng VouchersView', () => {
    const html = renderToStaticMarkup(<VouchersPage />);
    expect(html).toContain('max-w-frame');
    expect(html).toContain('data-testid="vouchers-view"');
    expect(html).not.toContain('max-w-3xl');
  });
});
