// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems } from '@/test-utils/a11y';

const api = vi.hoisted(() => ({
  doc: { content: null, vars: { returnWindowDays: 7, freeshipThreshold: 199000 } } as { content: string | null; vars: { returnWindowDays: number; freeshipThreshold: number } },
  fail: false,
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getLegalDoc: async () => {
    if (api.fail) throw new Error('API 503');
    return api.doc;
  },
  getPublicSupport: async () => ({ hotline: '0984 606 774', email: 'tubutree@gmail.com' }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import LegalPage, { generateMetadata } from './page';

let mounted: Rendered[] = [];
async function mount(loai: string) {
  const ui = await LegalPage({ params: Promise.resolve({ loai }) });
  const r = render(ui);
  mounted.push(r);
  await flush();
  return r.container;
}

beforeEach(() => {
  api.doc = { content: null, vars: { returnWindowDays: 7, freeshipThreshold: 199000 } };
  api.fail = false;
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
});

describe('/chinh-sach/[loai] (D5-01)', () => {
  it('loại không có trong danh sách → 404, không gọi API', async () => {
    for (const bad of ['constructor', 'admin', '', 'DIEU-KHOAN']) {
      await expect(LegalPage({ params: Promise.resolve({ loai: bad }) })).rejects.toThrow('NEXT_NOT_FOUND');
    }
    await expect(generateMetadata({ params: Promise.resolve({ loai: 'abc' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('admin chưa nhập: hiện bản nháp mặc định kèm biển "BẢN NHÁP — chờ Tubu Tree duyệt" ở đầu trang', async () => {
    const c = await mount('doi-tra');
    const banner = c.querySelector('[data-testid="legal-draft-banner"]');
    expect(banner?.textContent).toContain('BẢN NHÁP — chờ Tubu Tree duyệt');
    expect(c.querySelector('main')?.firstElementChild?.contains(banner)).toBe(true);
    expect(c.querySelector('h1')?.textContent).toBe('Chính sách đổi trả');
    expect(c.textContent).toContain('[Tên công ty]');
    expect(c.textContent).toContain('trong vòng 7 ngày');
    expect(c.textContent).toContain('0984 606 774');
  });

  it('admin đã nhập: hiện đúng nội dung đó, không còn biển bản nháp, không còn chỗ trống mẫu', async () => {
    api.doc = { content: '## 1. Hạn đổi\n\nĐổi trong **15 ngày**.', vars: api.doc.vars };
    const c = await mount('doi-tra');
    expect(c.querySelector('[data-testid="legal-draft-banner"]')).toBeNull();
    expect(c.textContent).toContain('Đổi trong 15 ngày.');
    expect(c.querySelector('strong')?.textContent).toBe('15 ngày');
    expect(c.textContent).not.toContain('[Tên công ty]');
  });

  it('có điều hướng sang ba trang chính sách còn lại (không có liên kết tới chính trang đang xem)', async () => {
    const c = await mount('bao-mat');
    const nav = c.querySelector('nav[aria-label="Các chính sách khác"]')!;
    const hrefs = Array.from(nav.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/chinh-sach/dieu-khoan', '/chinh-sach/doi-tra', '/chinh-sach/van-chuyen']);
    for (const a of Array.from(nav.querySelectorAll('a'))) expect(a.className).toContain('min-h-11');
  });

  it('đúng một h1, heading không nhảy cấp, với cả bốn bản nháp', async () => {
    for (const loai of ['dieu-khoan', 'bao-mat', 'doi-tra', 'van-chuyen']) {
      const c = await mount(loai);
      expect(headingProblems(c)).toEqual([]);
    }
  });

  it('API lỗi tạm thời → trang ném lỗi (error boundary), không hiện bản nháp thay nội dung đã duyệt', async () => {
    api.fail = true;
    await expect(LegalPage({ params: Promise.resolve({ loai: 'dieu-khoan' }) })).rejects.toThrow('API 503');
  });

  it('metadata: tiêu đề theo trang; bản nháp không lập chỉ mục, bản admin đã nhập thì có', async () => {
    const draft = await generateMetadata({ params: Promise.resolve({ loai: 'van-chuyen' }) });
    expect(draft.title).toBe('Chính sách vận chuyển — Tubu Tree');
    expect(draft.robots).toEqual({ index: false, follow: true });
    expect(draft.alternates?.canonical).toBe('/chinh-sach/van-chuyen');

    api.doc = { content: 'Nội dung đã duyệt', vars: api.doc.vars };
    const live = await generateMetadata({ params: Promise.resolve({ loai: 'van-chuyen' }) });
    expect(live.robots).toBeUndefined();
  });
});
