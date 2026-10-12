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
vi.mock('./image-upload', () => ({
  MultiImageUpload: ({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) => (
    <button type="button" onClick={() => onChange([...value, 'https://i/moi.jpg'])}>
      Thêm ảnh ({value.length})
    </button>
  ),
  VideoUpload: () => null,
}));
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
    mocks.canReview.mockResolvedValue({ canReview: false, reason: 'NOT_PURCHASED' });
    renderSection();
    expect(await screen.findByText('Mua & nhận hàng để đánh giá')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Viết đánh giá' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sửa đánh giá của bạn' })).toBeNull();
  });

  it('đủ điều kiện: chọn sao, gõ nhận xét, gửi → createReview đúng payload, báo thành công và đóng form', async () => {
    mocks.createReview.mockResolvedValue({ updated: false, pointsEarned: 5 });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    const group = await screen.findByRole('radiogroup', { name: 'Số sao' });
    fireEvent.click(within(group).getByRole('radio', { name: '4 sao' }));
    expect(within(group).getByRole('radio', { name: '4 sao' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByPlaceholderText(/Chia sẻ cảm nhận/), { target: { value: '  Dùng êm  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledWith('nuoc-rua-chen', { rating: 4, comment: 'Dùng êm', images: undefined, videoUrl: undefined }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Cảm ơn đánh giá của bạn! Đã cộng 5 Điểm Xanh', type: 'success' }));
  });

  it('đóng form giữa chừng (chạm nút Đóng) rồi mở lại: sao, nhận xét và ảnh đã up vẫn còn', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    let group = await screen.findByRole('radiogroup', { name: 'Số sao' });
    fireEvent.click(within(group).getByRole('radio', { name: '3 sao' }));
    fireEvent.change(screen.getByPlaceholderText(/Chia sẻ cảm nhận/), { target: { value: 'Giao hơi chậm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ảnh (0)' }));

    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Viết đánh giá' }));
    group = await screen.findByRole('radiogroup', { name: 'Số sao' });
    expect(within(group).getByRole('radio', { name: '3 sao' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByPlaceholderText(/Chia sẻ cảm nhận/)).toHaveValue('Giao hơi chậm');
    expect(screen.getByRole('button', { name: 'Thêm ảnh (1)' })).toBeInTheDocument();
  });

  it('gửi thành công xong thì xoá nháp: mở lại là form trống, 5 sao mặc định', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    const group = await screen.findByRole('radiogroup', { name: 'Số sao' });
    fireEvent.click(within(group).getByRole('radio', { name: '2 sao' }));
    fireEvent.change(screen.getByPlaceholderText(/Chia sẻ cảm nhận/), { target: { value: 'Tạm được' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Viết đánh giá' }));
    const again = await screen.findByRole('radiogroup', { name: 'Số sao' });
    expect(within(again).getByRole('radio', { name: '5 sao' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByPlaceholderText(/Chia sẻ cảm nhận/)).toHaveValue('');
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

// C-110 / Q-30: đã có đánh giá thì nút thành "Sửa đánh giá của bạn", form điền sẵn; thưởng điểm chỉ lần đầu.
describe('ReviewsSection: sửa đánh giá của bạn (Q-30)', () => {
  const MINE = { id: 'mine', rating: 4, comment: 'Dùng ổn', images: ['https://i/cu.jpg'], videoUrl: null };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { status: 'authenticated' };
    mocks.fetchReviews.mockResolvedValue(DATA);
    mocks.canReview.mockResolvedValue({ canReview: true, reason: null, myReview: MINE });
    mocks.createReview.mockResolvedValue({ updated: true });
  });

  it('đã có đánh giá: nút là "Sửa đánh giá của bạn", không còn "Viết đánh giá"', async () => {
    renderSection();
    expect(await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Viết đánh giá' })).toBeNull();
  });

  it('mở form: điền sẵn sao, nhận xét, ảnh của đánh giá cũ; nút lưu và lời nhắn nói rõ không cộng thêm điểm', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' }));
    const group = await screen.findByRole('radiogroup', { name: 'Số sao' });
    expect(within(group).getByRole('radio', { name: '4 sao' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByPlaceholderText(/Chia sẻ cảm nhận/)).toHaveValue('Dùng ổn');
    expect(screen.getByRole('button', { name: 'Thêm ảnh (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu đánh giá' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gửi đánh giá' })).toBeNull();
    expect(screen.getByText(/Điểm Xanh chỉ được cộng ở lần đánh giá đầu/)).toBeInTheDocument();
    expect(screen.queryByText(/Thêm video \+15/)).toBeNull();
  });

  it('sửa rồi lưu → gọi createReview với nội dung mới, báo "đã cập nhật" (không nói cộng Điểm Xanh), đóng form', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' }));
    const group = await screen.findByRole('radiogroup', { name: 'Số sao' });
    fireEvent.click(within(group).getByRole('radio', { name: '2 sao' }));
    fireEvent.change(screen.getByPlaceholderText(/Chia sẻ cảm nhận/), { target: { value: 'Dùng lâu thấy khác' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu đánh giá' }));
    await waitFor(() =>
      expect(mocks.createReview).toHaveBeenCalledWith('nuoc-rua-chen', {
        rating: 2,
        comment: 'Dùng lâu thấy khác',
        images: ['https://i/cu.jpg'],
        videoUrl: undefined,
      }),
    );
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã cập nhật đánh giá của bạn', type: 'success' }));
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Điểm Xanh') }));
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());
  });

  it('đóng form giữa chừng rồi mở lại: giữ phần đang sửa, không bị điền đè lại bằng đánh giá cũ', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' }));
    fireEvent.change(await screen.findByPlaceholderText(/Chia sẻ cảm nhận/), { target: { value: 'Đang gõ dở' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Sửa đánh giá của bạn' }));
    expect(await screen.findByPlaceholderText(/Chia sẻ cảm nhận/)).toHaveValue('Đang gõ dở');
  });

  it('lần mở sau khi lưu xong lại điền theo đánh giá mới nhất từ BE (không dùng nháp cũ)', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' }));
    fireEvent.change(await screen.findByPlaceholderText(/Chia sẻ cảm nhận/), { target: { value: 'Bản sửa' } });
    mocks.canReview.mockResolvedValue({ canReview: true, reason: null, myReview: { ...MINE, comment: 'Bản sửa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu đánh giá' }));
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());
    await waitFor(() => expect(mocks.canReview.mock.calls.length).toBeGreaterThanOrEqual(2));
    fireEvent.click(screen.getByRole('button', { name: 'Sửa đánh giá của bạn' }));
    expect(await screen.findByPlaceholderText(/Chia sẻ cảm nhận/)).toHaveValue('Bản sửa');
  });

  it('chưa có đánh giá, tạo xong thì nút đổi thành "Sửa đánh giá của bạn" (làm mới can-review)', async () => {
    mocks.canReview.mockResolvedValue({ canReview: true, reason: null, myReview: null });
    mocks.createReview.mockResolvedValue({ updated: false, pointsEarned: 10 });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    await screen.findByRole('radiogroup', { name: 'Số sao' });
    mocks.canReview.mockResolvedValue({ canReview: true, reason: null, myReview: MINE });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Cảm ơn đánh giá của bạn! Đã cộng 10 Điểm Xanh', type: 'success' }));
    expect(await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' })).toBeInTheDocument();
  });

  // PF-3: thưởng đánh giá chỉ một lần cho mỗi (khách, sản phẩm); xoá rồi tạo lại khi khách còn giữ phần thưởng cũ
  // thì BE tạo bản ghi mới với pointsEarned = 0 và updated = false.
  it.each([
    ['pointsEarned = 0 (đã nhận thưởng trước đó)', { updated: false, pointsEarned: 0 }],
    ['không có pointsEarned', { updated: false }],
  ])('tạo mới mà không được cộng điểm (%s) → báo trung tính, không nhắc Điểm Xanh', async (_n, response) => {
    mocks.canReview.mockResolvedValue({ canReview: true, reason: null, myReview: null });
    mocks.createReview.mockResolvedValue(response);
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    await screen.findByRole('radiogroup', { name: 'Số sao' });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã gửi đánh giá của bạn', type: 'success' }));
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Điểm Xanh') }));
  });

  it('BE trả updated=true kèm pointsEarned của lần thưởng cũ → vẫn báo "đã cập nhật", không nhắc điểm', async () => {
    mocks.canReview.mockResolvedValue({ canReview: true, reason: null, myReview: null });
    mocks.createReview.mockResolvedValue({ updated: true, pointsEarned: 10 });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    await screen.findByRole('radiogroup', { name: 'Số sao' });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã cập nhật đánh giá của bạn', type: 'success' }));
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Điểm Xanh') }));
  });

  it('BE trả updated=true dù form đang ở chế độ viết mới (đánh giá được tạo từ thiết bị khác) → báo "đã cập nhật"', async () => {
    mocks.canReview.mockResolvedValue({ canReview: true, reason: null, myReview: null });
    mocks.createReview.mockResolvedValue({ updated: true });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    await screen.findByRole('radiogroup', { name: 'Số sao' });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã cập nhật đánh giá của bạn', type: 'success' }));
  });
});

describe('Stars', () => {
  it('có tên truy cập "n trên 5 sao" và vẽ 5 ngôi sao', () => {
    const { container } = render(<Stars value={3.6} size={12} />);
    expect(screen.getByRole('img', { name: '3.6 trên 5 sao' })).toBeInTheDocument();
    expect(container.querySelectorAll('svg')).toHaveLength(5);
  });
});
