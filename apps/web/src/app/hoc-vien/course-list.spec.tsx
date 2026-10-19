// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcademyCourseSummary } from '@tubutree/app-core/api/academy';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Chép ý academy.spec.tsx (Mini App), phần danh sách: khách/đang khôi phục phiên/mất kết nối, tên + mô tả + tiến độ từng khoá,
// ảnh bìa, thẻ mở /hoc-vien/<id>, trống, lỗi + Thử lại, phần trăm thanh tiến độ, vùng chạm.

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'u1', role: 'AFFILIATE' } as Record<string, unknown> | null, status: 'authenticated' as string, initialized: true, sessionUnavailable: false, retrySession: vi.fn() },
  get: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));

import { CourseList } from './course-list';

const COURSE = (id: string, over: Partial<AcademyCourseSummary> = {}): AcademyCourseSummary => ({
  id, title: `Khoá ${id}`, description: `Mô tả khoá ${id}`, coverUrl: null, sortOrder: 1, isPublished: true, lessonCount: 3, completedCount: 1, isCompleted: false, ...over,
});

let courses: AcademyCourseSummary[];
let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CourseList />);
  mounted.push(r);
  await flush(6);
  return r;
};

beforeEach(() => {
  Object.assign(mocks.auth, { user: { id: 'u1', role: 'AFFILIATE' }, status: 'authenticated', initialized: true, sessionUnavailable: false });
  courses = [COURSE('a'), COURSE('b', { completedCount: 3, isCompleted: true })];
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/academy/courses') return courses;
    throw new Error(`no mock ${path}`);
  });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/hoc-vien — danh sách khoá học', () => {
  it('khách: cổng đăng nhập mang returnTo, không tải khoá học', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.user = null;
    const { container } = await mount();
    expect(container.textContent).toContain('Đăng nhập để vào CTV Academy');
    expect(container.querySelector('a[href="/dang-nhap?returnTo=%2Fhoc-vien"]')).not.toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('đang khôi phục phiên: chờ, chưa gọi API', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.initialized = false;
    const { container } = await mount();
    expect(container.textContent).toContain('Đang tải…');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('mất kết nối lúc khôi phục phiên: báo mất kết nối, không mời đăng nhập lại', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.sessionUnavailable = true;
    const { container } = await mount();
    expect(container.querySelector('a[href^="/dang-nhap"]')).toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('hiện tên, mô tả và tiến độ từng khoá, khoá xong hiện Đã hoàn thành', async () => {
    const { container } = await mount();
    expect(container.textContent).toContain('Khoá a');
    expect(container.textContent).toContain('Mô tả khoá a');
    expect(container.textContent).toContain('1/3 bài đã học');
    expect(container.textContent).toContain('Đã hoàn thành');
  });

  it('khoá không mô tả thì không hiện dòng mô tả; có ảnh bìa thì hiện ảnh', async () => {
    courses = [COURSE('a', { description: null }), COURSE('b', { coverUrl: 'https://img.test/b.jpg' })];
    const { container } = await mount();
    expect(container.textContent).not.toContain('Mô tả khoá a');
    expect(container.querySelector('img[src="https://img.test/b.jpg"]')).not.toBeNull();
  });

  it('ảnh bìa không phải http(s) không được vẽ', async () => {
    courses = [COURSE('a', { coverUrl: 'javascript:alert(1)' })];
    const { container } = await mount();
    expect(container.querySelector('img')).toBeNull();
  });

  it('mỗi khoá là liên kết tới /hoc-vien/<id>', async () => {
    const { container } = await mount();
    expect(container.querySelector('a[href="/hoc-vien/b"]')?.textContent).toContain('Khoá b');
  });

  it('chưa có khoá nào: trạng thái trống', async () => {
    courses = [];
    const { container } = await mount();
    expect(container.textContent).toContain('Chưa có khoá học nào');
    expect(container.textContent).toContain('Tubu sẽ sớm thêm khoá học đào tạo cho CTV.');
  });

  it('lỗi tải: báo lỗi, Thử lại tải lại', async () => {
    mocks.get.mockReset().mockRejectedValueOnce(new Error('mất mạng')).mockResolvedValue([COURSE('a')]);
    const { container } = await mount();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('mất mạng');
    click(byText(container, 'button', 'Thử lại'));
    await flush(6);
    expect(container.textContent).toContain('Khoá a');
  });

  it('thanh tiến độ giữ đúng phần trăm: 1/3 = 33%, đủ bài = 100%, không có bài = 0%', async () => {
    courses = [COURSE('a'), COURSE('b', { completedCount: 3, isCompleted: true }), COURSE('z', { lessonCount: 0, completedCount: 0 })];
    const { container } = await mount();
    const fills = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="progress-fill"]'));
    expect(fills.map((f) => f.style.width)).toEqual(['33%', '100%', '0%']);
  });

  it('thẻ khoá cao >= 44px và mọi điều khiển có tên', async () => {
    const { container } = await mount();
    expect(smallTouchTargets(container)).toEqual([]);
    expect(unnamedControls(container)).toEqual([]);
  });
});
