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
  VideoUpload: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange('https://v/moi.mp4')}>
      Chọn video thử ({value ? 1 : 0})
    </button>
  ),
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

// PF-6b: sau PF-3 điểm đánh giá chỉ cấp ở lần đánh giá ĐẦU TIÊN của mỗi (khách, sản phẩm); form không biết khách đã nhận
// thưởng trước đó hay chưa (xoá rồi tạo lại) nên mọi câu nhắc điểm phải nêu điều kiện "lần đầu" ngay trong câu.
const FIRST_ONLY = 'Lần đầu đánh giá sản phẩm này';
const HINT_TEXT_ONLY = `${FIRST_ONLY}: thêm video +15 / ảnh +10 Điểm Xanh (chỉ chữ +5). Chỉ đánh giá SP đã mua & nhận.`;
const HINT_IMAGES = `${FIRST_ONLY}, bạn nhận +10 Điểm Xanh cho đánh giá có ảnh! Thêm video để được +15.`;
const HINT_VIDEO = `Tuyệt! ${FIRST_ONLY}, đánh giá có video nhận +15 Điểm Xanh!`;
const EDIT_HINT = 'Chỉ lần đánh giá đầu tiên của mỗi sản phẩm được cộng Điểm Xanh, sửa đánh giá không cộng thêm.';

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

  it('ảnh API phục vụ (đường dẫn tương đối) được ghép gốc API, ảnh Cloudinary giữ nguyên', async () => {
    mocks.fetchReviews.mockResolvedValue({
      average: 5,
      count: 1,
      items: [review('p', 5, { images: ['/reviews/p/images/0?v=abc1234567', 'https://res.cloudinary.com/x/a.jpg'] })],
    });
    renderSection();
    await screen.findByText('Nhận xét p');
    const srcs = screen.getAllByAltText('ảnh đánh giá').map((i) => i.getAttribute('src'));
    expect(srcs).toEqual(['http://localhost:3001/api/reviews/p/images/0?v=abc1234567', 'https://res.cloudinary.com/x/a.jpg']);
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
    expect(screen.getByText(EDIT_HINT)).toBeInTheDocument();
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

// PF-6b: câu gợi ý điểm hiện TRƯỚC khi gửi. Không bao giờ hứa điểm vô điều kiện vì khách đã nhận thưởng sản phẩm này
// trước đó (rồi xoá đánh giá) sẽ được tạo lại với pointsEarned = 0.
describe('ReviewsSection: câu gợi ý điểm trước khi gửi (chỉ lần đầu)', () => {
  const MINE = { id: 'mine', rating: 4, comment: 'Dùng ổn', images: [], videoUrl: null };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { status: 'authenticated' };
    mocks.fetchReviews.mockResolvedValue(DATA);
    mocks.canReview.mockResolvedValue({ canReview: true, reason: null, myReview: null });
    mocks.createReview.mockResolvedValue({ updated: false, pointsEarned: 5 });
  });

  async function openNewForm() {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    await screen.findByRole('radiogroup', { name: 'Số sao' });
  }

  const hintOf = (text: string) => screen.getByText(text);

  it('chỉ chữ: nêu điều kiện lần đầu rồi mới nêu +15 / +10 / +5', async () => {
    await openNewForm();
    expect(hintOf(HINT_TEXT_ONLY)).toBeInTheDocument();
  });

  it('có ảnh: nêu điều kiện lần đầu rồi mới nêu +10 (và +15 nếu thêm video)', async () => {
    await openNewForm();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ảnh (0)' }));
    expect(hintOf(HINT_IMAGES)).toBeInTheDocument();
  });

  it('có video: nêu điều kiện lần đầu rồi mới nêu +15, kể cả khi có cả ảnh', async () => {
    await openNewForm();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ảnh (0)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chọn video thử (0)' }));
    expect(hintOf(HINT_VIDEO)).toBeInTheDocument();
  });

  it('không nhánh nào của form viết mới nhắc điểm trước khi nêu điều kiện lần đầu', async () => {
    await openNewForm();
    const seen: string[] = [];
    const read = () => {
      const el = screen.getByText(/Điểm Xanh/);
      seen.push(el.textContent ?? '');
    };
    read();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ảnh (0)' }));
    read();
    fireEvent.click(screen.getByRole('button', { name: 'Chọn video thử (0)' }));
    read();
    expect(seen).toHaveLength(3);
    for (const text of seen) {
      const firstPromise = text.search(/\+\d+/);
      expect(firstPromise).toBeGreaterThan(-1);
      expect(text.indexOf(FIRST_ONLY)).toBeGreaterThan(-1);
      expect(text.indexOf(FIRST_ONLY)).toBeLessThan(firstPromise);
    }
  });

  it('sửa đánh giá: nêu điều kiện lần đầu, không hứa +5 / +10 / +15 và không lặp câu của form viết mới', async () => {
    mocks.canReview.mockResolvedValue({ canReview: true, reason: null, myReview: MINE });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' }));
    await screen.findByRole('radiogroup', { name: 'Số sao' });
    const hint = screen.getByText(/Điểm Xanh/);
    expect(hint).toHaveTextContent(EDIT_HINT);
    expect(hint.textContent).not.toMatch(/\+\d+/);
    expect(hint.textContent).not.toContain(FIRST_ONLY);
    expect(screen.getAllByText(/Điểm Xanh/)).toHaveLength(1);
  });

  // PG-4: API báo hết thưởng (đã nhận, hoặc đang sửa) thì không hứa điểm nữa. Thiếu cờ (API cũ) giữ câu cũ.
  describe('cờ rewardAvailable từ can-review', () => {
    it('rewardAvailable === false: form viết mới không hứa +5/+10/+15 mà nói rõ đã nhận thưởng trước đó, ở cả ba trạng thái chữ/ảnh/video', async () => {
      mocks.canReview.mockResolvedValue({ canReview: true, reason: null, myReview: null, rewardAvailable: false });
      await openNewForm();
      const noPromise = () => expect(screen.queryByText(/\+\d+ Điểm Xanh|Lần đầu đánh giá/)).not.toBeInTheDocument();
      noPromise();
      expect(screen.getByText('Bạn đã nhận Điểm Xanh cho đánh giá sản phẩm này trước đó.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Thêm ảnh (0)' }));
      noPromise();
      fireEvent.click(screen.getByRole('button', { name: 'Chọn video thử (0)' }));
      noPromise();
      expect(screen.getAllByText(/Điểm Xanh/)).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Gửi đánh giá' })).toBeInTheDocument();
    });

    it('rewardAvailable === true: giữ câu gợi ý như cũ', async () => {
      mocks.canReview.mockResolvedValue({ canReview: true, reason: null, myReview: null, rewardAvailable: true });
      await openNewForm();
      expect(hintOf(HINT_TEXT_ONLY)).toBeInTheDocument();
    });

    it('thiếu trường (API cũ) → giữ câu gợi ý như cũ', async () => {
      mocks.canReview.mockResolvedValue({ canReview: true, reason: null, myReview: null });
      await openNewForm();
      expect(hintOf(HINT_TEXT_ONLY)).toBeInTheDocument();
    });

    it('chế độ sửa vẫn giữ câu giải thích "sửa không cộng thêm" dù cờ là false', async () => {
      mocks.canReview.mockResolvedValue({ canReview: true, reason: null, myReview: MINE, rewardAvailable: false });
      renderSection();
      fireEvent.click(await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' }));
      await screen.findByRole('radiogroup', { name: 'Số sao' });
      expect(screen.getByText(/Điểm Xanh/)).toHaveTextContent(EDIT_HINT);
    });
  });

  describe('mua lại nhiều lần (ENGAGE-23)', () => {
    const REPEAT_EDIT = 'Bạn đã mua sản phẩm này 3 lần. Mỗi sản phẩm chỉ có một đánh giá, nên lưu lại sẽ cập nhật đánh giá cũ của bạn.';
    const REPEAT_NEW = 'Bạn đã mua sản phẩm này 2 lần. Mỗi sản phẩm chỉ có một đánh giá, nên đánh giá này tính cho mọi lần mua.';

    it('đã có đánh giá và mua từ 2 lần: form sửa nói rõ vì sao chỉ sửa được đánh giá cũ', async () => {
      mocks.canReview.mockResolvedValue({ canReview: true, reason: null, myReview: MINE, rewardAvailable: false, purchaseCount: 3 });
      renderSection();
      fireEvent.click(await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' }));
      await screen.findByRole('radiogroup', { name: 'Số sao' });
      expect(screen.getByText(REPEAT_EDIT)).toBeInTheDocument();
      expect(screen.getByText(/Điểm Xanh/)).toHaveTextContent(EDIT_HINT);
    });

    it('chưa đánh giá nhưng đã mua 2 lần: form viết mới báo đánh giá tính cho mọi lần mua', async () => {
      mocks.canReview.mockResolvedValue({ canReview: true, reason: null, myReview: null, rewardAvailable: true, purchaseCount: 2 });
      await openNewForm();
      expect(screen.getByText(REPEAT_NEW)).toBeInTheDocument();
    });

    it('mua 1 lần hoặc API cũ chưa trả purchaseCount: không hiện câu nào về số lần mua', async () => {
      mocks.canReview.mockResolvedValue({ canReview: true, reason: null, myReview: MINE, purchaseCount: 1 });
      const { unmount } = renderSection();
      fireEvent.click(await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' }));
      await screen.findByRole('radiogroup', { name: 'Số sao' });
      expect(screen.queryByText(/đã mua sản phẩm này/)).not.toBeInTheDocument();
      unmount();
      mocks.canReview.mockResolvedValue({ canReview: true, reason: null, myReview: MINE });
      renderSection();
      fireEvent.click(await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' }));
      await screen.findByRole('radiogroup', { name: 'Số sao' });
      expect(screen.queryByText(/đã mua sản phẩm này/)).not.toBeInTheDocument();
    });
  });
});

describe('Stars', () => {
  it('có tên truy cập "n trên 5 sao" và vẽ 5 ngôi sao', () => {
    const { container } = render(<Stars value={3.6} size={12} />);
    expect(screen.getByRole('img', { name: '3.6 trên 5 sao' })).toBeInTheDocument();
    expect(container.querySelectorAll('svg')).toHaveLength(5);
  });
});
