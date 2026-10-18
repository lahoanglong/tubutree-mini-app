// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems } from '@/test-utils/a11y';

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: null, status: 'idle', initialized: true, sessionUnavailable: false }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: vi.fn(), post: vi.fn() } }));

import { metadata } from './layout';
import HocVienPage from './page';
import CourseDetailPage from './[courseId]/page';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/hoc-vien — trang công khai', () => {
  it('có metadata công khai: tiêu đề, mô tả, cho lập chỉ mục', () => {
    expect(metadata.title).toBe('Học viện — Tubu Tree');
    expect(typeof metadata.description).toBe('string');
    expect(metadata.robots).toBeUndefined();
  });

  it('danh sách: server render sẵn tiêu đề và phụ đề, đúng một h1', async () => {
    const r = render(await HocVienPage());
    mounted.push(r);
    await flush();
    expect(r.container.querySelectorAll('h1')).toHaveLength(1);
    expect(r.container.querySelector('h1')?.textContent).toBe('CTV Academy');
    expect(r.container.textContent).toContain('Học kỹ năng bán hàng, làm CTV giỏi hơn mỗi ngày');
    expect(headingProblems(r.container)).toEqual([]);
  });

  it('chi tiết: đúng một h1, có đường về danh sách', async () => {
    const r = render(await CourseDetailPage({ params: Promise.resolve({ courseId: 'c1' }) }));
    mounted.push(r);
    await flush();
    expect(r.container.querySelectorAll('h1')).toHaveLength(1);
    expect(r.container.querySelector('h1')?.textContent).toBe('CTV Academy');
  });
});
