import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ZmpUi from 'zmp-ui';

const mocks = vi.hoisted(() => ({
  fetchReviews: vi.fn(),
  createReview: vi.fn(),
  canReview: vi.fn(),
  login: vi.fn(),
  auth: { status: 'authenticated' } as { status: string },
  openSnackbar: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof ZmpUi>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({
  fetchReviews: mocks.fetchReviews,
  createReview: mocks.createReview,
  canReviewProduct: mocks.canReview,
}));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ status: mocks.auth.status, login: mocks.login }) }));
vi.mock('./image-upload', () => ({ MultiImageUpload: () => null, VideoUpload: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { ReviewsSection, Stars } from './reviews-section';

const review = (id: string, rating: number, extra: Record<string, unknown> = {}) => ({
  id,
  rating,
  author: `Khách ${id}`,
  avatar: null,
  comment: `Nhận xét ${id}`,
  images: [],
  videoUrl: null,
  verifiedPurchase: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  ...extra,
});

const DATA = {
  count: 3,
  average: 4.3,
  videoCount: 1,
  distribution: { '5': 2, '3': 1 },
  items: [review('a', 5, { verifiedPurchase: true }), review('b', 5, { videoUrl: 'https://v/x.mp4' }), review('c', 3, { images: ['https://i/1.jpg'] })],
};

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReviewsSection slug="nuoc-rua-chen" />
    </QueryClientProvider>,
  );
}

describe('ReviewsSection (C-076 di cư DS v2: giữ nguyên hành vi)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { status: 'authenticated' };
    mocks.fetchReviews.mockResolvedValue(DATA);
    mocks.canReview.mockResolvedValue({ canReview: true });
    mocks.createReview.mockResolvedValue({});
  });

  it('có đúng một tiêu đề h2 kèm số đánh giá, số sao trung bình và nhãn "Đã mua"', async () => {
    renderSection();
    expect(await screen.findByRole('heading', { level: 2, name: 'Đánh giá (3)' })).toBeInTheDocument();
    expect(screen.getByText('4.3')).toBeInTheDocument();
    expect(screen.getByText('Đã mua')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: '5 trên 5 sao' })).toHaveLength(2);
  });

  it('chip lọc: "5 sao", "Có ảnh", "Có video" lọc đúng danh sách, "Tất cả" trả lại đủ', async () => {
    renderSection();
    await screen.findByText('Nhận xét a');
    fireEvent.click(screen.getByRole('button', { name: '5 sao' }));
    expect(screen.getByText('Nhận xét a')).toBeInTheDocument();
    expect(screen.queryByText('Nhận xét c')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Có ảnh' }));
    expect(screen.getByText('Nhận xét c')).toBeInTheDocument();
    expect(screen.queryByText('Nhận xét a')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Có video/ }));
    expect(screen.getByText('Nhận xét b')).toBeInTheDocument();
    expect(screen.queryByText('Nhận xét c')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '4 sao' }));
    expect(screen.getByText('Không có đánh giá khớp bộ lọc.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả' }));
    expect(screen.getAllByText(/^Nhận xét /)).toHaveLength(3);
  });

  it('không có video nào → không có chip "Có video"', async () => {
    mocks.fetchReviews.mockResolvedValue({ ...DATA, videoCount: 0 });
    renderSection();
    await screen.findByText('Nhận xét a');
    expect(screen.queryByRole('button', { name: /Có video/ })).toBeNull();
  });

  it('chưa đăng nhập: "Viết đánh giá" mời đăng nhập, không mở form', async () => {
    mocks.auth = { status: 'guest' };
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull();
  });

  it('BE báo chưa đủ điều kiện → ẩn nút, hiện lý do', async () => {
    mocks.canReview.mockResolvedValue({ canReview: false, reason: 'ALREADY_REVIEWED' });
    renderSection();
    expect(await screen.findByText('Bạn đã đánh giá')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Viết đánh giá' })).toBeNull();
  });

  it('đủ điều kiện: chọn sao, gõ nhận xét, gửi → createReview đúng payload, báo thành công và đóng form', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    const group = await screen.findByRole('radiogroup', { name: 'Số sao' });
    fireEvent.click(within(group).getByRole('radio', { name: '4 sao' }));
    expect(within(group).getByRole('radio', { name: '4 sao' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByPlaceholderText(/Chia sẻ cảm nhận/), { target: { value: '  Dùng êm  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledWith('nuoc-rua-chen', { rating: 4, comment: 'Dùng êm', images: undefined, videoUrl: undefined }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Cảm ơn đánh giá của bạn! Đã cộng Điểm Xanh', type: 'success' }));
  });

  it('các nút chọn sao trong form có vùng chạm tối thiểu 44x44', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    const radio = await screen.findByRole('radio', { name: '5 sao' });
    expect(Number.parseFloat(radio.style.minWidth)).toBeGreaterThanOrEqual(44);
    expect(Number.parseFloat(radio.style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('chưa có đánh giá → trạng thái trống có lời mời', async () => {
    mocks.fetchReviews.mockResolvedValue({ count: 0, average: 0, distribution: {}, items: [] });
    renderSection();
    expect(await screen.findByText('Chưa có đánh giá')).toBeInTheDocument();
    expect(screen.getByText('Hãy là người đầu tiên chia sẻ trải nghiệm.')).toBeInTheDocument();
  });

  it('tải lỗi → thông báo và "Thử lại"', async () => {
    mocks.fetchReviews.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(DATA);
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Nhận xét a')).toBeInTheDocument();
  });
});

describe('Stars', () => {
  it('có tên truy cập "n trên 5 sao" và vẽ 5 ngôi sao', () => {
    const { container } = render(<Stars value={3.6} size={12} />);
    expect(screen.getByRole('img', { name: '3.6 trên 5 sao' })).toBeInTheDocument();
    expect(container.querySelectorAll('svg')).toHaveLength(5);
  });
});
