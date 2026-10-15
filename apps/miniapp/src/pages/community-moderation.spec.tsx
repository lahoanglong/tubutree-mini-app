import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdminPendingPost, AdminReport, AdminCommunityEvent, EventParticipant } from '../services/feed-api';

const mocks = vi.hoisted(() => ({
  openSnackbar: vi.fn(),
  adminPendingPosts: vi.fn(),
  adminApprovePost: vi.fn(),
  adminRejectPost: vi.fn(),
  adminReports: vi.fn(),
  adminResolveReport: vi.fn(),
  adminHidePost: vi.fn(),
  removeComment: vi.fn(),
  adminEvents: vi.fn(),
  adminEventParticipants: vi.fn(),
  createEvent: vi.fn(),
  closeEvent: vi.fn(),
  pickEventWinner: vi.fn(),
  auth: { role: 'ADMIN' as string | undefined },
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/feed/moderation', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/feed-api', () => ({
  adminPendingPosts: mocks.adminPendingPosts,
  adminApprovePost: mocks.adminApprovePost,
  adminRejectPost: mocks.adminRejectPost,
  adminReports: mocks.adminReports,
  adminResolveReport: mocks.adminResolveReport,
  adminHidePost: mocks.adminHidePost,
  removeComment: mocks.removeComment,
  adminEvents: mocks.adminEvents,
  adminEventParticipants: mocks.adminEventParticipants,
  createEvent: mocks.createEvent,
  closeEvent: mocks.closeEvent,
  pickEventWinner: mocks.pickEventWinner,
}));
vi.mock('../services/api', () => ({ getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi') }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { user: mocks.auth.role ? { role: mocks.auth.role } : null };
    return sel ? sel(state) : state;
  },
}));
vi.mock('../components/image-upload', () => ({
  ImageUpload: ({ label, onChange }: { label?: string; onChange: (url: string) => void }) => (
    <button type="button" onClick={() => onChange('https://img.test/cover.jpg')}>
      {label}
    </button>
  ),
}));

import CommunityModerationPage from './community-moderation';

const HOUR = 3600 * 1000;
const PENDING = (id: string, over: Partial<AdminPendingPost> = {}): AdminPendingPost => ({
  id,
  kind: 'TIP',
  title: `Tiêu đề ${id}`,
  body: `Nội dung ${id}`,
  images: [],
  author: 'Lan Anh',
  category: 'Vườn',
  createdAt: new Date(Date.now() - 2 * HOUR).toISOString(),
  ...over,
});
const REPORT = (id: string, over: Partial<AdminReport> = {}): AdminReport => ({
  id,
  reporterId: 'u9',
  targetType: 'POST',
  targetId: `t-${id}`,
  reason: `Spam ${id}`,
  status: 'OPEN',
  createdAt: new Date(Date.now() - 3 * HOUR).toISOString(),
  target: { kind: 'POST', author: 'Minh Tâm', title: `Bài bị báo ${id}`, excerpt: `Trích ${id}`, alreadyHandled: false, postId: 'p1' },
  ...over,
});
const EVENT = (id: string, over: Partial<AdminCommunityEvent> = {}): AdminCommunityEvent => ({
  id,
  title: `Sự kiện ${id}`,
  description: `Mô tả ${id}`,
  coverUrl: null,
  startAt: new Date(Date.now() - 24 * HOUR).toISOString(),
  endAt: new Date(Date.now() + 48 * HOUR).toISOString(),
  rewardPoints: 5,
  status: 'ACTIVE',
  winnerUserId: null,
  winner: null,
  createdAt: new Date(Date.now() - 48 * HOUR).toISOString(),
  ...over,
});
const PARTICIPANT = (id: string, over: Partial<EventParticipant> = {}): EventParticipant => ({
  userId: `u-${id}`,
  name: `Người ${id}`,
  avatar: null,
  postId: `p-${id}`,
  postTitle: `Vườn của ${id}`,
  postedAt: new Date(Date.now() - 3 * HOUR).toISOString(),
  postCount: 1,
  ...over,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CommunityModerationPage />
    </QueryClientProvider>,
  );
}

const goTab = (label: string) => fireEvent.click(screen.getByText(label));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.role = 'ADMIN';
  mocks.adminPendingPosts.mockResolvedValue([PENDING('a'), PENDING('b')]);
  mocks.adminApprovePost.mockResolvedValue({ ok: true });
  mocks.adminRejectPost.mockResolvedValue({ ok: true });
  mocks.adminReports.mockResolvedValue([REPORT('r1')]);
  mocks.adminResolveReport.mockResolvedValue({ ok: true });
  mocks.adminHidePost.mockResolvedValue({ ok: true });
  mocks.removeComment.mockResolvedValue({ ok: true });
  mocks.adminEvents.mockImplementation(async (status: string) => (status === 'OPEN' ? [EVENT('e1')] : []));
  mocks.adminEventParticipants.mockResolvedValue([PARTICIPANT('an'), PARTICIPANT('binh', { postCount: 2 })]);
  mocks.createEvent.mockResolvedValue(EVENT('new'));
  mocks.closeEvent.mockResolvedValue({ ok: true });
  mocks.pickEventWinner.mockResolvedValue({ ok: true });
});

describe('CommunityModerationPage — quyền truy cập', () => {
  it('không phải ADMIN: báo không có quyền và không tải gì', () => {
    mocks.auth.role = 'USER';
    renderPage();
    expect(screen.getByText('Chỉ quản trị viên mới truy cập được trang này.')).toBeInTheDocument();
    expect(mocks.adminPendingPosts).not.toHaveBeenCalled();
  });

  it('chưa đăng nhập: cũng báo không có quyền', () => {
    mocks.auth.role = undefined;
    renderPage();
    expect(screen.getByText('Chỉ quản trị viên mới truy cập được trang này.')).toBeInTheDocument();
  });
});

describe('CommunityModerationPage — bài chờ duyệt', () => {
  it('mặc định mở tab chờ duyệt: hiện loại bài, danh mục, tác giả, thời gian, tiêu đề, nội dung', async () => {
    renderPage();
    expect(await screen.findAllByText('Tiêu đề a')).toHaveLength(1);
    expect(screen.getAllByText('Mẹo hay · Vườn · Lan Anh · 2 giờ trước')).toHaveLength(2);
    expect(screen.getByText('Nội dung a')).toBeInTheDocument();
    expect(mocks.adminReports).not.toHaveBeenCalled();
  });

  it('bài có ảnh thì hiện ảnh đầu tiên', async () => {
    mocks.adminPendingPosts.mockResolvedValue([PENDING('a', { images: ['https://img.test/1.jpg', 'https://img.test/2.jpg'] })]);
    const { container } = renderPage();
    await screen.findByText('Tiêu đề a');
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('img')!.getAttribute('src')).toBe('https://img.test/1.jpg');
  });

  it('Duyệt: gửi đúng id, báo đã duyệt, tải lại danh sách', async () => {
    renderPage();
    await screen.findByText('Tiêu đề a');
    fireEvent.click(screen.getAllByRole('button', { name: 'Duyệt' })[0]!);
    await waitFor(() => expect(mocks.adminApprovePost).toHaveBeenCalledWith('a'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã duyệt bài', type: 'success' }));
    await waitFor(() => expect(mocks.adminPendingPosts).toHaveBeenCalledTimes(2));
  });

  it('Từ chối: gửi đúng id và báo đã từ chối', async () => {
    renderPage();
    await screen.findByText('Tiêu đề b');
    fireEvent.click(screen.getAllByRole('button', { name: 'Từ chối' })[1]!);
    await waitFor(() => expect(mocks.adminRejectPost).toHaveBeenCalledWith('b'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã từ chối bài', type: 'success' }));
  });

  it('duyệt lỗi: hiện thông báo lỗi, không tải lại danh sách', async () => {
    mocks.adminApprovePost.mockRejectedValue(new Error('Bài đã được duyệt'));
    renderPage();
    await screen.findByText('Tiêu đề a');
    fireEvent.click(screen.getAllByRole('button', { name: 'Duyệt' })[0]!);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Bài đã được duyệt', type: 'error' }));
    expect(mocks.adminPendingPosts).toHaveBeenCalledTimes(1);
  });

  it('đang duyệt bài a: bấm Từ chối bài a không gửi thêm; bài b vẫn bấm được', async () => {
    mocks.adminApprovePost.mockReturnValue(new Promise(() => {}));
    renderPage();
    await screen.findByText('Tiêu đề a');
    fireEvent.click(screen.getAllByRole('button', { name: 'Duyệt' })[0]!);
    await waitFor(() => expect(mocks.adminApprovePost).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByRole('button', { name: 'Từ chối' })[0]!);
    fireEvent.click(screen.getAllByRole('button', { name: 'Duyệt' })[0]!);
    expect(mocks.adminRejectPost).not.toHaveBeenCalled();
    expect(mocks.adminApprovePost).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Từ chối' })[1]!);
    await waitFor(() => expect(mocks.adminRejectPost).toHaveBeenCalledWith('b'));
  });

  it('không có bài chờ: hiện trạng thái trống', async () => {
    mocks.adminPendingPosts.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Không có bài nào chờ duyệt')).toBeInTheDocument();
  });

  it('lỗi tải: báo lỗi và Thử lại tải lại', async () => {
    mocks.adminPendingPosts.mockRejectedValueOnce(new Error('mất mạng')).mockResolvedValue([PENDING('a')]);
    renderPage();
    expect(await screen.findByText('mất mạng')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Tiêu đề a')).toBeInTheDocument();
  });
});

describe('CommunityModerationPage — báo cáo', () => {
  it('hiện loại nội dung, tác giả, thời gian, trích dẫn nội dung bị báo cáo và lý do', async () => {
    renderPage();
    await screen.findByText('Tiêu đề a');
    goTab('Báo cáo');
    expect(await screen.findByText('Bài viết · Minh Tâm · 3 giờ trước')).toBeInTheDocument();
    expect(screen.getByText('Bài bị báo r1')).toBeInTheDocument();
    expect(screen.getByText('Trích r1')).toBeInTheDocument();
    expect(screen.getByText('Lý do báo cáo: Spam r1')).toBeInTheDocument();
  });

  it('nội dung đã gỡ hoặc không còn tồn tại có ghi chú riêng', async () => {
    mocks.adminReports.mockResolvedValue([
      REPORT('r1', { target: { kind: 'POST', author: 'A', title: null, excerpt: 'x', alreadyHandled: true, postId: 'p1' } }),
      REPORT('r2', { target: null }),
    ]);
    renderPage();
    await screen.findByText('Tiêu đề a');
    goTab('Báo cáo');
    expect(await screen.findByText('Nội dung này đã được gỡ.')).toBeInTheDocument();
    expect(screen.getByText('Nội dung không còn tồn tại.')).toBeInTheDocument();
  });

  it('Ẩn nội dung với báo cáo bài viết: gọi adminHidePost(targetId)', async () => {
    renderPage();
    await screen.findByText('Tiêu đề a');
    goTab('Báo cáo');
    fireEvent.click(await screen.findByRole('button', { name: 'Ẩn nội dung' }));
    await waitFor(() => expect(mocks.adminHidePost).toHaveBeenCalledWith('t-r1'));
    expect(mocks.removeComment).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Ẩn nội dung', type: 'success' }));
  });

  it('Ẩn nội dung với báo cáo bình luận: gọi removeComment(targetId)', async () => {
    mocks.adminReports.mockResolvedValue([REPORT('r1', { targetType: 'COMMENT' })]);
    renderPage();
    await screen.findByText('Tiêu đề a');
    goTab('Báo cáo');
    fireEvent.click(await screen.findByRole('button', { name: 'Ẩn nội dung' }));
    await waitFor(() => expect(mocks.removeComment).toHaveBeenCalledWith('t-r1'));
    expect(mocks.adminHidePost).not.toHaveBeenCalled();
    expect(await screen.findByText(/^Bình luận · /)).toBeInTheDocument();
  });

  it('Đã xử lý: gọi adminResolveReport(id báo cáo), báo đã đánh dấu và tải lại', async () => {
    renderPage();
    await screen.findByText('Tiêu đề a');
    goTab('Báo cáo');
    fireEvent.click(await screen.findByRole('button', { name: 'Đã xử lý' }));
    await waitFor(() => expect(mocks.adminResolveReport).toHaveBeenCalledWith('r1'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã đánh dấu xử lý', type: 'success' }));
    await waitFor(() => expect(mocks.adminReports).toHaveBeenCalledTimes(2));
  });

  it('không có báo cáo: hiện trạng thái trống', async () => {
    mocks.adminReports.mockResolvedValue([]);
    renderPage();
    await screen.findByText('Tiêu đề a');
    goTab('Báo cáo');
    expect(await screen.findByText('Không có báo cáo nào')).toBeInTheDocument();
  });
});

describe('CommunityModerationPage — sự kiện', () => {
  const openEventsTab = async () => {
    renderPage();
    await screen.findByText('Tiêu đề a');
    goTab('Sự kiện');
    await screen.findByText('Sự kiện e1');
  };
  const dateInputs = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]'));

  it('liệt kê sự kiện kèm hạn và thưởng', async () => {
    await openEventsTab();
    expect(screen.getByText('Mô tả e1')).toBeInTheDocument();
    expect(screen.getByText(/Kết thúc: .* ·.*5 điểm/)).toBeInTheDocument();
  });

  it('nút Tạo sự kiện chỉ mở khi có tên, ngày bắt đầu, ngày kết thúc', async () => {
    await openEventsTab();
    const create = screen.getByRole('button', { name: 'Tạo sự kiện' });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Tên sự kiện'), { target: { value: '  Thử thách xanh  ' } });
    expect(create).toBeDisabled();
    fireEvent.change(dateInputs()[0]!, { target: { value: '2026-10-12T09:00' } });
    expect(create).toBeDisabled();
    fireEvent.change(dateInputs()[1]!, { target: { value: '2026-10-20T21:00' } });
    expect(create).not.toBeDisabled();
  });

  it('tạo sự kiện: gửi dữ liệu đã chuẩn hoá, xoá form, báo thành công và tải lại danh sách', async () => {
    await openEventsTab();
    fireEvent.change(screen.getByPlaceholderText('Tên sự kiện'), { target: { value: '  Thử thách xanh  ' } });
    fireEvent.change(screen.getByPlaceholderText('Mô tả sự kiện (không bắt buộc)'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ảnh bìa sự kiện' }));
    fireEvent.change(dateInputs()[0]!, { target: { value: '2026-10-12T09:00' } });
    fireEvent.change(dateInputs()[1]!, { target: { value: '2026-10-20T21:00' } });
    fireEvent.change(screen.getByPlaceholderText('Thưởng Điểm Xanh'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo sự kiện' }));
    await waitFor(() =>
      expect(mocks.createEvent).toHaveBeenCalledWith({
        title: 'Thử thách xanh',
        description: undefined,
        coverUrl: 'https://img.test/cover.jpg',
        startAt: new Date('2026-10-12T09:00').toISOString(),
        endAt: new Date('2026-10-20T21:00').toISOString(),
        rewardPoints: 120,
      }),
    );
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã tạo sự kiện 🎉', type: 'success' }));
    await waitFor(() => expect((screen.getByPlaceholderText('Tên sự kiện') as HTMLInputElement).value).toBe(''));
    expect((screen.getByPlaceholderText('Thưởng Điểm Xanh') as HTMLInputElement).value).toBe('0');
    expect(dateInputs()[0]!.value).toBe('');
    await waitFor(() => expect(mocks.adminEvents).toHaveBeenCalledTimes(2));
  });

  it('thưởng không phải số thì gửi 0', async () => {
    await openEventsTab();
    fireEvent.change(screen.getByPlaceholderText('Tên sự kiện'), { target: { value: 'A' } });
    fireEvent.change(dateInputs()[0]!, { target: { value: '2026-10-12T09:00' } });
    fireEvent.change(dateInputs()[1]!, { target: { value: '2026-10-20T21:00' } });
    fireEvent.change(screen.getByPlaceholderText('Thưởng Điểm Xanh'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo sự kiện' }));
    await waitFor(() => expect(mocks.createEvent).toHaveBeenCalledWith(expect.objectContaining({ rewardPoints: 0 })));
  });

  it('tạo lỗi: báo lỗi và giữ nguyên nội dung đã nhập', async () => {
    mocks.createEvent.mockRejectedValue(new Error('Ngày không hợp lệ'));
    await openEventsTab();
    fireEvent.change(screen.getByPlaceholderText('Tên sự kiện'), { target: { value: 'A' } });
    fireEvent.change(dateInputs()[0]!, { target: { value: '2026-10-12T09:00' } });
    fireEvent.change(dateInputs()[1]!, { target: { value: '2026-10-20T21:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo sự kiện' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Ngày không hợp lệ', type: 'error' }));
    expect((screen.getByPlaceholderText('Tên sự kiện') as HTMLInputElement).value).toBe('A');
  });

  // R2-ENGAGE-14: không còn dán userId thô; chọn từ người dự thi (tên + ảnh), chốt có bước xác nhận.
  it('Chọn người thắng: mở danh sách người dự thi (tên, bài mới nhất, số bài), không có ô nhập userId', async () => {
    await openEventsTab();
    expect(screen.queryByPlaceholderText(/userId/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Chọn người thắng' }));
    expect(await screen.findByText('Người an')).toBeInTheDocument();
    expect(mocks.adminEventParticipants).toHaveBeenCalledWith('e1');
    expect(screen.getByText('Vườn của an')).toBeInTheDocument();
    expect(screen.getByText(/2 bài dự thi/)).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('chốt người thắng: phải chọn một người rồi mới bấm được, gửi đúng userId của người đó', async () => {
    await openEventsTab();
    fireEvent.click(screen.getByRole('button', { name: 'Chọn người thắng' }));
    await screen.findByText('Người binh');
    const confirm = screen.getByRole('button', { name: 'Chọn người thắng' });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Người binh/ }));
    expect(screen.getByRole('radio', { name: /Người binh/ })).toHaveAttribute('aria-checked', 'true');
    const go = screen.getByRole('button', { name: 'Chốt Người binh là người thắng' });
    expect(go).not.toBeDisabled();
    fireEvent.click(go);
    await waitFor(() => expect(mocks.pickEventWinner).toHaveBeenCalledWith('e1', 'u-binh'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã chọn người thắng', type: 'success' }));
    await waitFor(() => expect(mocks.adminEvents).toHaveBeenCalledTimes(2));
  });

  it('chưa có bài dự thi: nói rõ thay vì để trống', async () => {
    mocks.adminEventParticipants.mockResolvedValue([]);
    await openEventsTab();
    fireEvent.click(screen.getByRole('button', { name: 'Chọn người thắng' }));
    expect(await screen.findByText(/Chưa có bài dự thi nào được đăng/)).toBeInTheDocument();
  });

  it('chốt lỗi (sự kiện đã đóng): báo lỗi, giữ lựa chọn', async () => {
    mocks.pickEventWinner.mockRejectedValue(new Error('Sự kiện đã đóng'));
    await openEventsTab();
    fireEvent.click(screen.getByRole('button', { name: 'Chọn người thắng' }));
    fireEvent.click(await screen.findByRole('radio', { name: /Người an/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Chốt Người an là người thắng' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Sự kiện đã đóng', type: 'error' }));
    expect(screen.getByRole('radio', { name: /Người an/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('tab "Đã đóng": sự kiện đóng không biến mất; hiện người thắng, hoặc "đóng không chọn người thắng"', async () => {
    mocks.adminEvents.mockImplementation(async (status: string) =>
      status === 'OPEN'
        ? [EVENT('e1')]
        : [
            EVENT('c1', { status: 'CLOSED', winnerUserId: 'u1', winner: { id: 'u1', name: 'Lan Anh', avatar: null } }),
            EVENT('c2', { status: 'CLOSED' }),
          ],
    );
    await openEventsTab();
    fireEvent.click(screen.getByRole('tab', { name: 'Đã đóng' }));
    expect(await screen.findByText('Sự kiện c1')).toBeInTheDocument();
    expect(mocks.adminEvents).toHaveBeenCalledWith('CLOSED');
    expect(screen.getByText('Lan Anh')).toBeInTheDocument();
    expect(screen.getByText('Người thắng')).toBeInTheDocument();
    expect(screen.getByText('Đóng không chọn người thắng')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đóng' })).toBeNull();
  });

  it('tab "Đã đóng" trống: nói chưa có sự kiện đã đóng', async () => {
    await openEventsTab();
    fireEvent.click(screen.getByRole('tab', { name: 'Đã đóng' }));
    expect(await screen.findByText('Chưa có sự kiện nào đã đóng')).toBeInTheDocument();
  });

  it('Đóng sự kiện: gọi closeEvent(id), báo đã đóng và tải lại', async () => {
    await openEventsTab();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(mocks.closeEvent).toHaveBeenCalledWith('e1'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã đóng sự kiện', type: 'success' }));
    await waitFor(() => expect(mocks.adminEvents).toHaveBeenCalledTimes(2));
  });

  it('không có sự kiện: hiện trạng thái trống bên dưới biểu mẫu', async () => {
    mocks.adminEvents.mockResolvedValue([]);
    renderPage();
    await screen.findByText('Tiêu đề a');
    goTab('Sự kiện');
    expect(await screen.findByText('Chưa có sự kiện nào')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tạo sự kiện' })).toBeInTheDocument();
  });
});

describe('CommunityModerationPage — tiêu đề, tab, vùng chạm, nhãn (C-076, C-113, C-114)', () => {
  it('có đúng một h1 "Kiểm duyệt cộng đồng" ở mọi trạng thái', async () => {
    mocks.auth.role = 'USER';
    const denied = renderPage();
    expect(denied.container.querySelectorAll('h1')).toHaveLength(1);
    denied.unmount();

    mocks.auth.role = 'ADMIN';
    const { container } = renderPage();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    await screen.findByText('Tiêu đề a');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Kiểm duyệt cộng đồng');
    goTab('Báo cáo');
    await screen.findByText('Bài bị báo r1');
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    goTab('Sự kiện');
    await screen.findByText('Sự kiện e1');
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('ba mục là tablist có aria-selected, đổi theo tab đang mở', async () => {
    renderPage();
    await screen.findByText('Tiêu đề a');
    const tabs = within(screen.getAllByRole('tablist')[0]!).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Chờ duyệt', 'Báo cáo', 'Sự kiện']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(tabs[1]!);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('nút Duyệt / Từ chối / Ẩn nội dung / Đã xử lý cao >= 44px', async () => {
    renderPage();
    await screen.findByText('Tiêu đề a');
    for (const name of ['Duyệt', 'Từ chối']) {
      expect(Number.parseFloat(screen.getAllByRole('button', { name })[0]!.style.minHeight)).toBeGreaterThanOrEqual(44);
    }
    goTab('Báo cáo');
    for (const name of ['Ẩn nội dung', 'Đã xử lý']) {
      expect(Number.parseFloat((await screen.findByRole('button', { name })).style.minHeight)).toBeGreaterThanOrEqual(44);
    }
  });

  it('biểu mẫu sự kiện: ô nhập có tên truy cập, ngày giờ có nhãn gắn với ô, ô ngày cao >= 44px, nút Chọn người thắng/Đóng cao >= 44px', async () => {
    renderPage();
    await screen.findByText('Tiêu đề a');
    goTab('Sự kiện');
    await screen.findByText('Sự kiện e1');
    expect(screen.getByRole('textbox', { name: 'Tên sự kiện' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Mô tả sự kiện (không bắt buộc)' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Thưởng Điểm Xanh' })).toBeInTheDocument();
    expect(screen.getByText('1 điểm = 1.000đ, tối đa 1.000 điểm')).toBeInTheDocument();
    const start = screen.getByLabelText('Bắt đầu') as HTMLInputElement;
    const end = screen.getByLabelText('Kết thúc') as HTMLInputElement;
    expect(start.type).toBe('datetime-local');
    expect(end.type).toBe('datetime-local');
    expect(Number.parseFloat(start.style.minHeight)).toBeGreaterThanOrEqual(44);
    for (const name of ['Chọn người thắng', 'Đóng', 'Tạo sự kiện']) {
      expect(Number.parseFloat(screen.getByRole('button', { name }).style.minHeight)).toBeGreaterThanOrEqual(44);
    }
  });

  it('thưởng sự kiện không dùng emoji 🎁 làm biểu tượng', async () => {
    const { container } = renderPage();
    await screen.findByText('Tiêu đề a');
    goTab('Sự kiện');
    await screen.findByText('Sự kiện e1');
    expect(container.textContent).not.toContain('🎁');
  });
});
