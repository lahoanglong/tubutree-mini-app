import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AcademyCourseDetail, AcademyCourseSummary } from '../services/academy-api';
import { vi as viText } from '../i18n/vi';
import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  fetchCourses: vi.fn(),
  fetchCourse: vi.fn(),
  completeLesson: vi.fn(),
  haptic: vi.fn(),
  params: {} as { courseId?: string },
  role: 'AFFILIATE',
  status: 'authenticated',
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useParams: () => mocks.params,
  useLocation: () => ({ pathname: '/academy', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string; user: { role: string }; restore: () => void }) => unknown) => sel({ status: mocks.status, user: { role: mocks.role }, restore: vi.fn() }),
}));
vi.mock('../services/academy-api', () => ({
  fetchCourses: mocks.fetchCourses,
  fetchCourse: mocks.fetchCourse,
  completeLesson: mocks.completeLesson,
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi'),
  getLoadErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi'),
}));
vi.mock('../utils/haptic', () => ({ haptic: mocks.haptic }));

import AcademyPage from './academy';

const COURSE = (id: string, over: Partial<AcademyCourseSummary> = {}): AcademyCourseSummary => ({
  id,
  title: `Khoá ${id}`,
  description: `Mô tả khoá ${id}`,
  coverUrl: null,
  sortOrder: 1,
  isPublished: true,
  lessonCount: 3,
  completedCount: 1,
  isCompleted: false,
  ...over,
});

const DETAIL = (over: Partial<AcademyCourseDetail> = {}): AcademyCourseDetail => ({
  id: 'c1',
  title: 'Khoá bán hàng',
  description: 'Học cách chốt đơn',
  coverUrl: null,
  isPublished: true,
  lessons: [
    { id: 'l1', courseId: 'c1', title: 'Giới thiệu', contentType: 'VIDEO', videoUrl: 'https://video.test/1.mp4', body: null, sortOrder: 1 },
    { id: 'l2', courseId: 'c1', title: 'Kịch bản chốt đơn', contentType: 'ARTICLE', videoUrl: null, body: 'Bước 1\nBước 2', sortOrder: 2 },
    { id: 'l3', courseId: 'c1', title: 'Tổng kết', contentType: 'ARTICLE', videoUrl: null, body: null, sortOrder: 3 },
  ],
  completedLessonIds: ['l3'],
  ...over,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={qc}>
      <AcademyPage />
    </QueryClientProvider>,
  );
  return { ...utils, invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'AFFILIATE';
  mocks.status = 'authenticated';
  mocks.params = {};
  mocks.fetchCourses.mockResolvedValue([COURSE('a'), COURSE('b', { completedCount: 3, isCompleted: true })]);
  mocks.fetchCourse.mockResolvedValue(DETAIL());
  mocks.completeLesson.mockResolvedValue({ ok: true });
});

describe('AcademyPage — khách thường', () => {
  it('không gọi API, hiện cổng dành cho CTV với nút sang đăng ký', async () => {
    mocks.role = 'CUSTOMER';
    renderPage();
    expect(await screen.findByText(viText.academy.ctvOnlyTitle)).toBeInTheDocument();
    expect(mocks.fetchCourses).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: viText.academy.ctvOnlyCta }));
    expect(mocks.navigate).toHaveBeenCalledWith('/affiliate');
  });

  it('mất mạng lúc khôi phục phiên: báo mất kết nối kèm Thử lại, không treo khung chờ', async () => {
    mocks.role = 'CUSTOMER';
    mocks.status = 'error';
    renderPage();
    expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    expect(mocks.fetchCourses).not.toHaveBeenCalled();
  });
});

describe('AcademyPage — danh sách khoá học, hành vi giữ nguyên khi chuyển DS v2', () => {
  it('hiện tiêu đề, phụ đề, tên + mô tả + tiến độ từng khoá', async () => {
    renderPage();
    expect(await screen.findByText('Khoá a')).toBeInTheDocument();
    expect(screen.getByText(viText.academy.title)).toBeInTheDocument();
    expect(screen.getByText(viText.academy.subtitle)).toBeInTheDocument();
    expect(screen.getByText('Mô tả khoá a')).toBeInTheDocument();
    expect(screen.getByText('1/3 bài đã học')).toBeInTheDocument();
    const completed = screen.getByText(viText.academy.completed);
    expect(completed.textContent).toBe('Đã hoàn thành');
    expect(completed.querySelector('svg')).not.toBeNull();
  });

  it('khoá không có mô tả thì không hiện dòng mô tả; có ảnh bìa thì hiện ảnh', async () => {
    mocks.fetchCourses.mockResolvedValue([
      COURSE('a', { description: null }),
      COURSE('b', { coverUrl: 'https://img.test/b.jpg' }),
    ]);
    const { container } = renderPage();
    await screen.findByText('Khoá a');
    expect(screen.queryByText('Mô tả khoá a')).not.toBeInTheDocument();
    expect(container.querySelector('img[src="https://img.test/b.jpg"]')).not.toBeNull();
  });

  it('ảnh bìa tải lỗi (URL chết) thì về biểu tượng sách, không để ảnh vỡ', async () => {
    mocks.fetchCourses.mockResolvedValue([COURSE('b', { coverUrl: 'https://img.test/chet.jpg' })]);
    const { container } = renderPage();
    await screen.findByText('Khoá b');
    const img = container.querySelector('img[src="https://img.test/chet.jpg"]')!;
    expect(img).not.toBeNull();
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
  });

  it('bấm một khoá mở /academy/<id>', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Khoá b'));
    expect(mocks.navigate).toHaveBeenCalledWith('/academy/b');
  });

  it('chưa có khoá nào: hiện trạng thái trống', async () => {
    mocks.fetchCourses.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(viText.academy.empty)).toBeInTheDocument();
    expect(screen.getByText(viText.academy.emptyBody)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: viText.academy.backToCtv }));
    expect(mocks.navigate).toHaveBeenCalledWith('/affiliate');
  });

  it('lỗi tải: báo lỗi và Thử lại tải lại', async () => {
    mocks.fetchCourses.mockRejectedValueOnce(new Error('mất mạng')).mockResolvedValue([COURSE('a')]);
    renderPage();
    expect(await screen.findByText('mất mạng')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Khoá a')).toBeInTheDocument();
  });
});

describe('AcademyPage — chi tiết khoá học, hành vi giữ nguyên khi chuyển DS v2', () => {
  beforeEach(() => {
    mocks.params = { courseId: 'c1' };
  });

  it('tải đúng khoá theo id trên URL, hiện tên, mô tả và các bài đánh số', async () => {
    renderPage();
    expect(await screen.findByText('Khoá bán hàng')).toBeInTheDocument();
    expect(mocks.fetchCourse).toHaveBeenCalledWith('c1');
    expect(mocks.fetchCourses).not.toHaveBeenCalled();
    expect(screen.getByText('Học cách chốt đơn')).toBeInTheDocument();
    expect(screen.getByText('1. Giới thiệu')).toBeInTheDocument();
    expect(screen.getByText('2. Kịch bản chốt đơn')).toBeInTheDocument();
    expect(screen.getByText('3. Tổng kết')).toBeInTheDocument();
  });

  it('video là file trực tiếp: phát bằng thẻ video trong app, không có liên kết ra ngoài; bài viết giữ xuống dòng', async () => {
    renderPage();
    const video = await screen.findByLabelText('Giới thiệu');
    expect(video.tagName).toBe('VIDEO');
    expect(video).toHaveAttribute('src', 'https://video.test/1.mp4');
    expect(screen.getByText(/Bước 1/).textContent).toBe('Bước 1\nBước 2');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryByText(viText.academy.videoOnWeb)).toBeNull();
  });

  it('video không phải file trực tiếp: chỉ ghi chữ xem trên web, không link', async () => {
    const d = DETAIL();
    mocks.fetchCourse.mockResolvedValue({ ...d, lessons: [{ ...d.lessons[0]!, videoUrl: 'https://youtube.com/watch?v=x' }] });
    renderPage();
    expect(await screen.findByText(viText.academy.videoOnWeb)).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(document.querySelector('video')).toBeNull();
  });

  it('bài đã học: nút "✓ Đã học xong" bị khoá; bài chưa học: "Đánh dấu đã học" bấm được', async () => {
    renderPage();
    await screen.findByText('Khoá bán hàng');
    const doneBtn = screen.getByRole('button', { name: viText.academy.alreadyDone });
    expect(doneBtn).toBeDisabled();
    expect(doneBtn.querySelector('svg')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: viText.academy.markDone })).toHaveLength(2);
    for (const b of screen.getAllByRole('button', { name: viText.academy.markDone })) expect(b).not.toBeDisabled();
  });

  it('đánh dấu đã học: gửi đúng bài, rung, báo thành công, tải lại khoá và danh sách', async () => {
    const { invalidate } = renderPage();
    await screen.findByText('Khoá bán hàng');
    fireEvent.click(screen.getAllByRole('button', { name: viText.academy.markDone })[0]!);
    await waitFor(() => expect(mocks.completeLesson).toHaveBeenCalledWith('l1'));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: viText.academy.markDoneOk, type: 'success' }),
    );
    expect(mocks.haptic).toHaveBeenCalledWith('medium');
    const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey);
    expect(keys).toContainEqual(['academy-course', 'c1']);
    expect(keys).toContainEqual(['academy-courses']);
    await waitFor(() => expect(mocks.fetchCourse).toHaveBeenCalledTimes(2));
  });

  it('đánh dấu lỗi: báo tại chỗ (role=alert), không rung, không tải lại', async () => {
    mocks.completeLesson.mockRejectedValue(new Error('Không có quyền'));
    renderPage();
    await screen.findByText('Khoá bán hàng');
    fireEvent.click(screen.getAllByRole('button', { name: viText.academy.markDone })[0]!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không có quyền');
    expect(mocks.haptic).not.toHaveBeenCalled();
    expect(mocks.fetchCourse).toHaveBeenCalledTimes(1);
  });

  it('đánh dấu lỗi: cảnh báo nằm ngay dưới nút của đúng bài vừa bấm (không ở đầu trang)', async () => {
    mocks.completeLesson.mockRejectedValue(new Error('Không có quyền'));
    renderPage();
    await screen.findByText('Khoá bán hàng');
    const [first, second] = screen.getAllByRole('button', { name: viText.academy.markDone });
    fireEvent.click(second!);
    const alert = await screen.findByRole('alert');
    expect(alert.parentElement).toContainElement(second!);
    expect(alert.parentElement).not.toContainElement(first!);
  });

  it('chạm hai bài khác nhau trong cùng một khung hình chỉ gửi bài đầu', async () => {
    mocks.completeLesson.mockReturnValue(new Promise(() => {}));
    renderPage();
    await screen.findByText('Khoá bán hàng');
    const [first, second] = screen.getAllByRole('button', { name: viText.academy.markDone });
    await act(async () => {
      fireEvent.click(first!);
      fireEvent.click(second!);
    });
    expect(mocks.completeLesson).toHaveBeenCalledTimes(1);
    expect(mocks.completeLesson).toHaveBeenCalledWith('l1');
  });

  it('đang đánh dấu một bài: không bấm thêm được bài nào khác', async () => {
    mocks.completeLesson.mockReturnValue(new Promise(() => {}));
    renderPage();
    await screen.findByText('Khoá bán hàng');
    const [first, second] = screen.getAllByRole('button', { name: viText.academy.markDone });
    fireEvent.click(first!);
    await waitFor(() => expect(mocks.completeLesson).toHaveBeenCalledTimes(1));
    fireEvent.click(first!);
    fireEvent.click(second!);
    expect(mocks.completeLesson).toHaveBeenCalledTimes(1);
  });

  it('chi tiết khoá chỉ có một nút quay lại (của tiêu đề trang), không thêm nút "Danh sách khoá học"', async () => {
    renderPage();
    await screen.findByText('Khoá bán hàng');
    expect(screen.queryByText('Danh sách khoá học')).not.toBeInTheDocument();
  });

  it('lỗi tải khoá: báo lỗi và Thử lại tải lại', async () => {
    mocks.fetchCourse.mockRejectedValueOnce(new Error('mất mạng')).mockResolvedValue(DETAIL());
    renderPage();
    expect(await screen.findByText('mất mạng')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Khoá bán hàng')).toBeInTheDocument();
  });
});

describe('AcademyPage — tiêu đề, tiến độ, vùng chạm, bàn phím (C-076, C-114)', () => {
  it('danh sách có đúng một h1 ở đang tải, lỗi, trống và đã tải', async () => {
    mocks.fetchCourses.mockReturnValue(new Promise(() => {}));
    const loading = renderPage();
    expect(loading.container.querySelectorAll('h1')).toHaveLength(1);
    loading.unmount();

    mocks.fetchCourses.mockRejectedValue(new Error('mất mạng'));
    const failed = renderPage();
    await screen.findByText('mất mạng');
    expect(failed.container.querySelectorAll('h1')).toHaveLength(1);
    failed.unmount();

    mocks.fetchCourses.mockResolvedValue([]);
    const empty = renderPage();
    await screen.findByText(viText.academy.empty);
    expect(empty.container.querySelectorAll('h1')).toHaveLength(1);
    empty.unmount();

    mocks.fetchCourses.mockResolvedValue([COURSE('a')]);
    const loaded = renderPage();
    await screen.findByText('Khoá a');
    expect(loaded.container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(viText.academy.title);
  });

  it('chi tiết có đúng một h1 ở đang tải, lỗi và đã tải; tên khoá là h2', async () => {
    mocks.params = { courseId: 'c1' };
    mocks.fetchCourse.mockReturnValue(new Promise(() => {}));
    const loading = renderPage();
    expect(loading.container.querySelectorAll('h1')).toHaveLength(1);
    loading.unmount();

    mocks.fetchCourse.mockRejectedValue(new Error('mất mạng'));
    const failed = renderPage();
    await screen.findByText('mất mạng');
    expect(failed.container.querySelectorAll('h1')).toHaveLength(1);
    failed.unmount();

    mocks.fetchCourse.mockResolvedValue(DETAIL());
    const loaded = renderPage();
    await screen.findByText('Khoá bán hàng');
    expect(loaded.container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Khoá bán hàng');
  });

  it('thanh tiến độ khoá giữ đúng phần trăm (1/3 = 33%, đủ bài = 100%, không có bài = 0%)', async () => {
    mocks.fetchCourses.mockResolvedValue([
      COURSE('a'),
      COURSE('b', { completedCount: 3, isCompleted: true }),
      COURSE('z', { lessonCount: 0, completedCount: 0 }),
    ]);
    renderPage();
    await screen.findByText('Khoá a');
    const fills = screen.getAllByTestId('progress-fill');
    expect(fills.map((f) => f.style.width)).toEqual(['33%', '100%', '0%']);
  });

  it('thẻ khoá học dùng được bằng bàn phím và cao >= 44px', async () => {
    renderPage();
    const card = (await screen.findByText('Khoá a')).closest('[role="button"]') as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(card!.tabIndex).toBe(0);
    expect(Number.parseFloat(card!.style.minHeight)).toBeGreaterThanOrEqual(44);
    fireEvent.keyDown(card!, { key: 'Enter' });
    expect(mocks.navigate).toHaveBeenCalledWith('/academy/a');
  });

  it('nút đánh dấu có vùng chạm >= 44px', async () => {
    mocks.params = { courseId: 'c1' };
    renderPage();
    await screen.findByText('Khoá bán hàng');
    const targets = [
      ...screen.getAllByRole('button', { name: viText.academy.markDone }),
      screen.getByRole('button', { name: viText.academy.alreadyDone }),
    ];
    for (const t of targets) {
      expect(Number.parseFloat(t.style.minHeight), t.outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(44);
    }
  });
});

describe('AcademyPage — khách thường (API trả 403)', () => {
  const forbidden = () => new HttpError('Request failed with status code 403', 'ERR_BAD_REQUEST', { status: 403, data: {} });
  const NOTICE_TITLE = 'Học viện CTV dành cho cộng tác viên';
  const NOTICE_BODY = 'Tài khoản của bạn chưa có quyền học khoá đào tạo. Tìm hiểu cách trở thành cộng tác viên Tubu Tree.';

  it('danh sách: hiện khối thông báo, nút dẫn tới /affiliate, không có Thử lại', async () => {
    mocks.fetchCourses.mockRejectedValue(forbidden());
    renderPage();
    expect(await screen.findByText(NOTICE_TITLE)).toBeInTheDocument();
    expect(screen.getByText(NOTICE_BODY)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tìm hiểu về CTV' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/affiliate');
  });

  it('chi tiết: cùng khối thông báo, không có Thử lại', async () => {
    mocks.params = { courseId: 'c1' };
    mocks.fetchCourse.mockRejectedValue(forbidden());
    renderPage();
    expect(await screen.findByText(NOTICE_TITLE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
  });

  it('lỗi khác 403 vẫn là lỗi tải có Thử lại', async () => {
    mocks.fetchCourses.mockRejectedValue(new HttpError('x', 'ERR', { status: 500, data: {} }));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    expect(screen.queryByText(NOTICE_TITLE)).toBeNull();
  });
});

describe('AcademyPage: đánh dấu hoàn thành khoá chạm đúp (W74A)', () => {
  beforeEach(() => {
    mocks.params = { courseId: 'c1' };
  });

  const deferred = () => {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  it('chạm đúp "Đánh dấu hoàn thành" trong cùng một khung hình chỉ gọi completeLesson một lần', async () => {
    const d = deferred();
    mocks.completeLesson.mockReturnValueOnce(d.promise);
    renderPage();
    await screen.findByText('Khoá bán hàng');
    const btn = screen.getAllByRole('button', { name: viText.academy.markDone })[0]!;
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mocks.completeLesson).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ ok: true }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
    expect(mocks.completeLesson).toHaveBeenCalledTimes(1);
  });

  it('lỗi thì nhả khoá: bấm lại gọi lần hai và xoá cảnh báo cũ', async () => {
    mocks.completeLesson.mockRejectedValueOnce(new Error('Không có quyền')).mockResolvedValue({ ok: true });
    renderPage();
    await screen.findByText('Khoá bán hàng');
    fireEvent.click(screen.getAllByRole('button', { name: viText.academy.markDone })[0]!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không có quyền');
    fireEvent.click(screen.getAllByRole('button', { name: viText.academy.markDone })[0]!);
    await waitFor(() => expect(mocks.completeLesson).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

describe('AcademyPage: "Thử lại" chạm đúp (W74A)', () => {
  const deferred = () => {
    let resolve!: (v: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  it('danh sách khoá lỗi: chạm đúp "Thử lại" chỉ tải lại một lần', async () => {
    const d = deferred();
    mocks.params = {};
    mocks.fetchCourses.mockRejectedValueOnce(new Error('mất mạng')).mockReturnValueOnce(d.promise);
    renderPage();
    await screen.findByText('mất mạng');
    const retry = screen.getByRole('button', { name: 'Thử lại' });
    await act(async () => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });
    expect(mocks.fetchCourses).toHaveBeenCalledTimes(2);
    await act(async () => d.resolve([COURSE('a')]));
    expect(await screen.findByText('Khoá a')).toBeInTheDocument();
  });

  it('chi tiết khoá lỗi: chạm đúp "Thử lại" chỉ tải lại một lần', async () => {
    const d = deferred();
    mocks.params = { courseId: 'c1' };
    mocks.fetchCourse.mockRejectedValueOnce(new Error('mất mạng')).mockReturnValueOnce(d.promise);
    renderPage();
    await screen.findByText('mất mạng');
    const retry = screen.getByRole('button', { name: 'Thử lại' });
    await act(async () => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });
    expect(mocks.fetchCourse).toHaveBeenCalledTimes(2);
    await act(async () => d.resolve(DETAIL()));
    expect(await screen.findByText('Khoá bán hàng')).toBeInTheDocument();
  });
});

// W113A: bài học bị máy chủ từ chối vì bài/khoá đã đổi (400/404/409) thì tải lại khoá + danh sách và giữ khoá tới khi dữ liệu về (tối đa LOCK_REFRESH_WAIT_MS); mất mạng, quá hạn, 401, 5xx nhả ngay, không tải lại.
describe('AcademyPage: bài học bị từ chối thì giữ khoá tới khi dữ liệu về (W113A)', () => {
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const renderLive = (refresh: () => Promise<unknown>) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
    render(<QueryClientProvider client={qc}><AcademyPage /></QueryClientProvider>);
    return invalidate;
  };
  const markDone = () => screen.getAllByRole('button', { name: viText.academy.markDone })[0]!;

  beforeEach(() => {
    mocks.params = { courseId: 'c1' };
  });

  it.each([
    [400, 'Bài đã học rồi'],
    [404, 'Không tìm thấy bài'],
    [409, 'Khoá vừa đổi'],
  ])('bị từ chối %i: tải lại khoá + danh sách, lỗi chỉ hiện khi dữ liệu đã về, khoá nhả sau đó', async (status, message) => {
    mocks.completeLesson.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue({ ok: true });
    const refresh = deferred();
    const invalidate = renderLive(() => refresh.promise);
    await screen.findByText('Khoá bán hàng');
    fireEvent.click(markDone());
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual([
      { queryKey: ['academy-course', 'c1'] },
      { queryKey: ['academy-courses'] },
    ]);
    // Dữ liệu chưa về: còn giữ khoá, chưa hiện lỗi, chạm thêm không gửi lần hai.
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: viText.academy.markDone })[0]!);
    });
    expect(mocks.completeLesson).toHaveBeenCalledTimes(1);
    await act(async () => refresh.resolve());
    await settle();
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    fireEvent.click(markDone());
    await waitFor(() => expect(mocks.completeLesson).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
  ])('%s: nhả khoá ngay, không tải lại khoá hay danh sách', async (_label, error) => {
    mocks.completeLesson.mockRejectedValueOnce(error).mockResolvedValue({ ok: true });
    const invalidate = renderLive(() => new Promise(() => undefined));
    await screen.findByText('Khoá bán hàng');
    fireEvent.click(markDone());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(invalidate).not.toHaveBeenCalled();
    fireEvent.click(markDone());
    await waitFor(() => expect(mocks.completeLesson).toHaveBeenCalledTimes(2));
  });

  it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
    mocks.completeLesson.mockRejectedValueOnce(serverError('Khoá vừa đổi', 409)).mockResolvedValue({ ok: true });
    renderLive(() => new Promise(() => undefined));
    await screen.findByText('Khoá bán hàng');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(markDone());
      await waitFor(() => expect(mocks.completeLesson).toHaveBeenCalledTimes(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
      });
      expect(screen.queryByRole('alert')).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(await screen.findByRole('alert')).toHaveTextContent('Khoá vừa đổi');
    } finally {
      vi.useRealTimers();
    }
    fireEvent.click(markDone());
    await waitFor(() => expect(mocks.completeLesson).toHaveBeenCalledTimes(2));
  });
});
