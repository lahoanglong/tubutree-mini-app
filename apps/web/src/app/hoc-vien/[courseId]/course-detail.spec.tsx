// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcademyCourseDetail } from '@tubutree/app-core/api/academy';
import { ApiError } from '@/lib/client-api';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Chép ý academy.spec.tsx (Mini App), phần chi tiết: khoá theo id trên URL, bài đánh số, video mở tab mới, bài viết giữ xuống dòng,
// nút đã học/chưa học, đánh dấu gửi đúng bài rồi tải lại khoá + danh sách, lỗi, khoá nút khi đang gửi, quay về danh sách, lỗi tải, vùng chạm.

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'u1', role: 'AFFILIATE' } as Record<string, unknown> | null, status: 'authenticated' as string, initialized: true, sessionUnavailable: false, retrySession: vi.fn() },
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));

import { CourseDetailView } from './course-detail';

const DETAIL = (over: Partial<AcademyCourseDetail> = {}): AcademyCourseDetail => ({
  id: 'c1', title: 'Khoá bán hàng', description: 'Học cách chốt đơn', coverUrl: null, isPublished: true,
  lessons: [
    { id: 'l1', courseId: 'c1', title: 'Giới thiệu', contentType: 'VIDEO', videoUrl: 'https://video.test/1', body: null, sortOrder: 1 },
    { id: 'l2', courseId: 'c1', title: 'Kịch bản chốt đơn', contentType: 'ARTICLE', videoUrl: null, body: 'Bước 1\nBước 2', sortOrder: 2 },
    { id: 'l3', courseId: 'c1', title: 'Tổng kết', contentType: 'ARTICLE', videoUrl: null, body: null, sortOrder: 3 },
  ],
  completedLessonIds: ['l3'],
  ...over,
});

let detail: AcademyCourseDetail;
let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CourseDetailView courseId="c1" />);
  mounted.push(r);
  await flush(6);
  return r;
};
const buttons = (root: ParentNode, name: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter((b) => (b.textContent ?? '').trim() === name);
const calls = (m: ReturnType<typeof vi.fn>, path: string) => m.mock.calls.filter((c) => c[0] === path).length;

beforeEach(() => {
  Object.assign(mocks.auth, { user: { id: 'u1', role: 'AFFILIATE' }, status: 'authenticated', initialized: true, sessionUnavailable: false });
  detail = DETAIL();
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/academy/courses/c1') return detail;
    if (path === '/academy/courses') return [];
    throw new Error(`no mock ${path}`);
  });
  mocks.post.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/hoc-vien/[courseId] — chi tiết khoá học', () => {
  it('khách: cổng đăng nhập mang returnTo của khoá, không tải khoá', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.user = null;
    const { container } = await mount();
    expect(container.textContent).toContain('Đăng nhập để vào CTV Academy');
    expect(container.querySelector('a[href="/dang-nhap?returnTo=%2Fhoc-vien%2Fc1"]')).not.toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('tải đúng khoá theo id, hiện tên (h2), mô tả và các bài đánh số', async () => {
    const { container } = await mount();
    expect(calls(mocks.get, '/academy/courses/c1')).toBe(1);
    expect(container.querySelector('h2')?.textContent).toBe('Khoá bán hàng');
    expect(container.textContent).toContain('Học cách chốt đơn');
    expect(container.textContent).toContain('1. Giới thiệu');
    expect(container.textContent).toContain('2. Kịch bản chốt đơn');
    expect(container.textContent).toContain('3. Tổng kết');
  });

  it('bài video có liên kết mở tab mới; bài viết giữ xuống dòng; liên kết video không phải http(s) bị bỏ', async () => {
    detail = DETAIL({
      lessons: [
        ...DETAIL().lessons,
        { id: 'l4', courseId: 'c1', title: 'Bài lạ', contentType: 'VIDEO', videoUrl: 'javascript:alert(1)', body: null, sortOrder: 4 },
      ],
    });
    const { container } = await mount();
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]'));
    expect(links).toHaveLength(1);
    expect(links[0]!.textContent).toBe('Mở video bài học');
    expect(links[0]!.getAttribute('href')).toBe('https://video.test/1');
    expect(links[0]!.getAttribute('rel')).toContain('noreferrer');
    const body = Array.from(container.querySelectorAll('div,p')).find((e) => e.textContent === 'Bước 1\nBước 2') as HTMLElement;
    expect(body).toBeTruthy();
    expect(body.className).toContain('whitespace-pre-line');
  });

  it('bài đã học: nút "Đã học xong" bị khoá; bài chưa học: "Đánh dấu đã học" bấm được', async () => {
    const { container } = await mount();
    expect(buttons(container, 'Đã học xong')[0]!.disabled).toBe(true);
    const todo = buttons(container, 'Đánh dấu đã học');
    expect(todo).toHaveLength(2);
    todo.forEach((b) => expect(b.disabled).toBe(false));
  });

  it('đánh dấu đã học: POST đúng bài, báo thành công, tải lại khoá và danh sách', async () => {
    const { container } = await mount();
    click(buttons(container, 'Đánh dấu đã học')[0]!);
    await flush(6);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]![0]).toBe('/academy/lessons/l1/complete');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Đã đánh dấu hoàn thành bài học!');
    expect(calls(mocks.get, '/academy/courses/c1')).toBe(2);
  });

  it('đánh dấu lỗi: hiện lỗi, không báo thành công, không tải lại khoá', async () => {
    mocks.post.mockRejectedValue(new Error('Không có quyền'));
    const { container } = await mount();
    click(buttons(container, 'Đánh dấu đã học')[0]!);
    await flush(6);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Không có quyền');
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(calls(mocks.get, '/academy/courses/c1')).toBe(1);
  });

  it('đang đánh dấu một bài: không bấm thêm được bài nào khác, không gửi đôi', async () => {
    mocks.post.mockReturnValue(new Promise(() => {}));
    const { container } = await mount();
    const [first, second] = buttons(container, 'Đánh dấu đã học');
    click(first!);
    await flush(2);
    click(first!);
    click(second!);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(second!.disabled).toBe(true);
  });

  it('"Danh sách khoá học" là liên kết về /hoc-vien', async () => {
    const { container } = await mount();
    expect(byText(container, 'a', 'Danh sách khoá học')?.getAttribute('href')).toBe('/hoc-vien');
  });

  it('lỗi tải khoá: báo lỗi, Thử lại tải lại', async () => {
    mocks.get.mockReset().mockRejectedValueOnce(new Error('mất mạng')).mockResolvedValue(DETAIL());
    const { container } = await mount();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('mất mạng');
    click(byText(container, 'button', 'Thử lại'));
    await flush(6);
    expect(container.textContent).toContain('Khoá bán hàng');
  });

  it('khoá không xem được (403): giải thích CTV Academy dành cho CTV, lối tới /ctv, không Thử lại', async () => {
    mocks.get.mockReset().mockRejectedValue(new ApiError('Forbidden', 403));
    const { container } = await mount();
    expect(container.textContent).toContain('CTV Academy dành cho cộng tác viên');
    expect(container.querySelector('a[href="/ctv"]')).not.toBeNull();
    expect(byText(container, 'button', 'Thử lại')).toBeNull();
  });

  it('vùng chạm >= 44px và mọi điều khiển có tên', async () => {
    const { container } = await mount();
    expect(smallTouchTargets(container)).toEqual([]);
    expect(unnamedControls(container)).toEqual([]);
  });
});

describe('/hoc-vien/[courseId] — như Mini App', () => {
  it('bài đã học: nút "Đã học xong" có dấu tích trước chữ và là nút phụ ZaUI', async () => {
    const { container } = await mount();
    const done = buttons(container, 'Đã học xong')[0]!;
    expect(done.querySelector('svg.lucide-circle-check-big, svg.lucide-check-circle-2, svg.lucide-circle-check')).not.toBeNull();
    expect(done.className).toContain('max-md:bg-forest-50');
  });

  it('link "Mở video bài học" không gạch chân ở điện thoại', async () => {
    const { container } = await mount();
    expect(byText(container, 'a', 'Mở video bài học')!.className).toContain('max-md:no-underline');
  });

  it('"Danh sách khoá học" vẫn hiện ở điện thoại như nút ghost của Mini App; bài học là thẻ không viền', async () => {
    const { container } = await mount();
    const back = byText(container, 'a', 'Danh sách khoá học')!;
    expect(back.className).not.toContain('max-md:hidden');
    expect(container.querySelector('section')!.classList.contains('border')).toBe(false);
  });

  it('tên khoá cỡ title-md ở điện thoại', async () => {
    const { container } = await mount();
    const h = Array.from(container.querySelectorAll('h2')).find((x) => x.textContent === 'Khoá bán hàng')!;
    expect(h.className).toContain('max-md:text-[length:var(--type-title-md-size)]');
  });
});
