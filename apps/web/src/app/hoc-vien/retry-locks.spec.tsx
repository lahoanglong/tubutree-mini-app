// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { byText, flush, render, type Rendered } from '@/test-utils/dom';

// "Thử lại" của Học viện (Mini: academy.tsx trả `q.refetch()`): bấm đúp trong một khung hình chỉ tải lại một lần, nút báo aria-busy tới khi dữ liệu mới về.
// Truy vấn PHẢI đã có dữ liệu rồi mới bị làm cho lỗi: chưa có dữ liệu thì refetch thứ hai dùng chung lượt đang bay và ca này đậu suông.

const state = vi.hoisted(() => ({
  error: null as Error | null,
  gate: null as Promise<void> | null,
  calls: [] as string[],
}));

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1', role: 'AFFILIATE' }, status: 'authenticated', initialized: true, sessionUnavailable: false, retrySession: vi.fn() }) }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push(path);
      if (state.gate) await state.gate;
      if (state.error) throw state.error;
      if (path === '/academy/courses') {
        return [{ id: 'a', title: 'Khoá a', description: null, coverUrl: null, sortOrder: 1, isPublished: true, lessonCount: 3, completedCount: 1, isCompleted: false }];
      }
      if (path === '/academy/courses/c1') {
        return { id: 'c1', title: 'Khoá bán hàng', description: null, coverUrl: null, isPublished: true, lessons: [], completedLessonIds: [] };
      }
      throw new Error(`no mock ${path}`);
    },
    post: vi.fn(),
  },
}));

import { CourseList } from './course-list';
import { CourseDetailView } from './[courseId]/course-detail';

let mounted: Rendered[] = [];
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const count = (path: string) => state.calls.filter((p) => p === path).length;

beforeEach(() => {
  state.error = null;
  state.gate = null;
  state.calls = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

async function retryTwice(ui: ReactElement, queryKey: readonly string[], path: string, loaded: string) {
  const client = newClient();
  const r = render(ui, client);
  mounted.push(r);
  await flush(6);
  expect(r.container.textContent).toContain(loaded);

  state.error = new Error('Mạng lỗi');
  await act(async () => {
    await client.refetchQueries({ queryKey });
  });
  await flush(4);
  const retry = byText(r.container, 'button', 'Thử lại') as HTMLButtonElement;
  expect(retry).not.toBeNull();
  const before = count(path);

  let release!: () => void;
  state.gate = new Promise<void>((res) => (release = res));
  state.error = null;
  retry.focus();
  act(() => {
    retry.click();
    retry.click();
  });
  await flush(2);
  expect(count(path)).toBe(before + 1);
  const busy = byText(r.container, 'button', 'Thử lại') as HTMLButtonElement;
  expect(busy.getAttribute('aria-busy')).toBe('true');
  expect(busy.getAttribute('aria-disabled')).toBe('true');
  expect(busy.hasAttribute('disabled')).toBe(false);
  expect(document.activeElement).toBe(busy);

  state.gate = null;
  release();
  await flush(6);
  expect(count(path)).toBe(before + 1);
  expect(byText(r.container, 'button', 'Thử lại')).toBeNull();
  expect(r.container.textContent).toContain(loaded);
}

describe('Học viện: "Thử lại" chạm đúp', () => {
  it('danh sách khoá: tải lại lỗi khi đã có danh sách, chạm đúp chỉ gọi API thêm một lần, nút aria-busy tới khi dữ liệu mới về', async () => {
    await retryTwice(<CourseList />, ['academy-courses'], '/academy/courses', 'Khoá a');
  });

  it('chi tiết khoá: tải lại lỗi khi đã có khoá, chạm đúp chỉ gọi API thêm một lần, nút aria-busy tới khi dữ liệu mới về', async () => {
    await retryTwice(<CourseDetailView courseId="c1" />, ['academy-course', 'c1'], '/academy/courses/c1', 'Khoá bán hàng');
  });
});
