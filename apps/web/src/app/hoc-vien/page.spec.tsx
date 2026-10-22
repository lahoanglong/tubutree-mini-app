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
  it('có metadata: tiêu đề, mô tả, không lập chỉ mục (API chỉ cho CTV/đại lý/nhân viên)', () => {
    expect(metadata.title).toBe('Học viện — Tubu Tree');
    expect(typeof metadata.description).toBe('string');
    expect(metadata.robots).toEqual({ index: false });
  });

  it('danh sách: server render sẵn tiêu đề và phụ đề, đúng một h1', async () => {
    const r = render(await HocVienPage());
    mounted.push(r);
    await flush();
    expect(r.container.querySelectorAll('h1')).toHaveLength(1);
    expect(r.container.querySelector('h1')?.textContent).toBe('Học viện CTV');
    expect(r.container.textContent).toContain('Học kỹ năng bán hàng, làm CTV giỏi hơn mỗi ngày');
    expect(headingProblems(r.container)).toEqual([]);
  });

  it('chi tiết: đúng một h1, có đường về danh sách', async () => {
    const r = render(await CourseDetailPage({ params: Promise.resolve({ courseId: 'c1' }) }));
    mounted.push(r);
    await flush();
    expect(r.container.querySelectorAll('h1')).toHaveLength(1);
    expect(r.container.querySelector('h1')?.textContent).toBe('Học viện CTV');
  });
});

describe('/hoc-vien — giao diện điện thoại như Mini App', () => {
  it('tiêu đề trên thanh trắng, trang bỏ đệm 48px của body', async () => {
    const r = render(await HocVienPage());
    mounted.push(r);
    await flush();
    expect(r.container.querySelector('h1')!.closest('header')!.hasAttribute('data-page-bleed')).toBe(true);
    expect(r.container.querySelector('h1')!.closest('header')!.className).toContain('max-md:bg-[var(--color-bg-surface)]');
  });
});

describe('/hoc-vien — tiêu đề chừa chỗ nút lùi', () => {
  it('thanh tiêu đề chừa 64px bên trái cho nút lùi nổi', async () => {
    const r = render(await HocVienPage());
    mounted.push(r);
    await flush();
    expect(r.container.querySelector('h1')!.parentElement!.className).toContain('max-md:pl-12');
  });
});
