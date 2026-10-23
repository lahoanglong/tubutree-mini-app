import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ZmpUi from 'zmp-ui';

const mocks = vi.hoisted(() => ({
  fetchReviews: vi.fn(),
  createReview: vi.fn(),
  canReview: vi.fn(),
  fetchMyReview: vi.fn(),
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
  fetchMyReview: mocks.fetchMyReview,
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
const HINT_TEXT_ONLY = `${FIRST_ONLY}: thêm video +15.000 / ảnh +10.000 Điểm Xanh (chỉ chữ +5.000). Chỉ đánh giá được khi đã mua và nhận hàng.`;
const HINT_IMAGES = `${FIRST_ONLY}, bạn nhận +10.000 Điểm Xanh cho đánh giá có ảnh! Thêm video để được +15.000.`;
const HINT_VIDEO = `Tuyệt! ${FIRST_ONLY}, đánh giá có video nhận +15.000 Điểm Xanh!`;
const EDIT_HINT = 'Chỉ lần đánh giá đầu tiên của mỗi sản phẩm được cộng Điểm Xanh, sửa đánh giá không cộng thêm.';
const REWARD_ALREADY_GIVEN =
  'Bạn đã nhận Điểm Xanh cho đánh giá đầu tiên của sản phẩm này, đánh giá lần mua này không cộng thêm điểm.';

// R8: mỗi lần mua (đơn) một đánh giá. O1 đã được đánh giá (dòng "a" trong danh sách), O2 là lần mua sau chưa đánh giá.
const O1 = { orderId: 'o1', code: 'TB0001', deliveredAt: '2026-08-01T00:00:00.000Z' };
const O2 = { orderId: 'o2', code: 'TB0002', deliveredAt: '2026-09-10T00:00:00.000Z' };
const REF_A = { id: 'a', orderId: 'o1', orderCode: 'TB0001', rating: 5, createdAt: '2026-08-05T00:00:00.000Z', isVisible: true };
const REF_B = { id: 'b', orderId: 'o2', orderCode: 'TB0002', rating: 5, createdAt: '2026-09-12T00:00:00.000Z', isVisible: true };
const MINE_A = { id: 'a', orderId: 'o1', rating: 4, comment: 'Dùng ổn', images: ['https://i/cu.jpg'], videoUrl: null, isVisible: true };
const MINE_B = { id: 'b', orderId: 'o2', rating: 3, comment: 'Lần này hơi khô', images: [], videoUrl: null, isVisible: true };
/** Mua một lần, chưa đánh giá. */
const ELIG_NEW = { canReview: true, reason: null, rewardAvailable: true, purchaseCount: 1, reviewableOrders: [O1], myReviews: [] };
/** Mua hai lần, đã đánh giá đơn đầu (đã nhận thưởng), đơn sau còn viết được. */
const ELIG_REPEAT = { canReview: true, reason: null, rewardAvailable: false, purchaseCount: 2, reviewableOrders: [O2], myReviews: [REF_A] };
/** Mọi lần mua đều đã có đánh giá; mới nhất trước. */
const ELIG_ALL = { canReview: false, reason: 'ALL_REVIEWED', rewardAvailable: false, purchaseCount: 2, reviewableOrders: [], myReviews: [REF_B, REF_A] };

const DATA = {
  count: 3,
  average: 4.3,
  videoCount: 1,
  distribution: { '5': 2, '3': 1 },
  items: [review('a', 5, { verifiedPurchase: true }), review('b', 5, { videoUrl: 'https://v/x.mp4' }), review('c', 3, { images: ['https://i/1.jpg'] })],
};

function renderSection(props: { openForOrderId?: string; onOrderLinkUsed?: () => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReviewsSection slug="nuoc-rua-chen" {...props} />
    </QueryClientProvider>,
  );
}

const MYREVIEWS: Record<string, unknown> = { a: MINE_A, b: MINE_B };

describe('ReviewsSection (C-076 di cư DS v2: giữ nguyên hành vi)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { status: 'authenticated' };
    mocks.fetchReviews.mockResolvedValue(DATA);
    mocks.canReview.mockResolvedValue(ELIG_NEW);
    mocks.createReview.mockResolvedValue({});
  });

  it('có đúng một tiêu đề h2 kèm số đánh giá, số sao trung bình và nhãn "Đã mua"', async () => {
    renderSection();
    const title = await screen.findByRole('heading', { level: 2, name: 'Đánh giá (3)' });
    expect(title).toBeInTheDocument();
    // Cùng kiểu với các tiêu đề mục khác của trang sản phẩm: Inter title-sm, không serif.
    expect(title.style.fontFamily).toBe('var(--font-ui)');
    expect(title.style.fontSize).toBe('var(--type-title-sm-size)');
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
    await waitFor(() =>
      expect(mocks.createReview).toHaveBeenCalledWith('nuoc-rua-chen', { rating: 4, comment: 'Dùng êm', images: undefined, videoUrl: undefined, orderId: 'o1' }),
    );
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Cảm ơn đánh giá của bạn! Đã cộng 5 Điểm Xanh', type: 'success' }));
  });

  it('form viết đánh giá: sao chưa chọn không dùng stone-200 và ô nhận xét có tên truy cập (D8-7, D8-9)', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    const group = await screen.findByRole('radiogroup', { name: 'Số sao' });
    fireEvent.click(within(group).getByRole('radio', { name: '2 sao' }));
    const colors = within(group).getAllByRole('radio').map((r) => r.style.color);
    expect(colors.filter((c) => c.includes('--stone-200'))).toEqual([]);
    expect(colors.filter((c) => c.includes('--stone-450'))).toHaveLength(3);
    expect(screen.getByLabelText('Nội dung đánh giá')).toBe(screen.getByPlaceholderText(/Chia sẻ cảm nhận/));
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

// R8: mỗi lần mua một đánh giá. Nút đầu mục viết cho đơn còn viết được; đánh giá đã có sửa ở đúng dòng của nó.
describe('ReviewsSection: mỗi lần mua một đánh giá (R8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { status: 'authenticated' };
    mocks.fetchReviews.mockResolvedValue(DATA);
    mocks.canReview.mockResolvedValue(ELIG_REPEAT);
    mocks.fetchMyReview.mockImplementation(async (id: string) => MYREVIEWS[id]);
    mocks.createReview.mockResolvedValue({ updated: false, pointsEarned: 0 });
  });

  it('đã đánh giá đơn cũ, còn đơn mới: nút đầu mục vẫn là "Viết đánh giá"; dòng của mình có nhãn "Của bạn", mã đơn và nút sửa riêng', async () => {
    renderSection();
    expect(await screen.findByRole('button', { name: 'Sửa đánh giá đơn TB0001' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Viết đánh giá' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sửa đánh giá của bạn' })).toBeNull();
    expect(screen.getAllByText('Của bạn')).toHaveLength(1);
    expect(screen.getByText('Đơn TB0001')).toBeInTheDocument();
    expect(screen.getAllByText(/^Nhận xét /)).toHaveLength(3);
  });

  it('viết cho lần mua mới: gửi kèm đơn còn viết được, nói rõ đánh giá cho đơn nào và không hứa điểm khi đã nhận thưởng', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    await screen.findByRole('radiogroup', { name: 'Số sao' });
    expect(
      screen.getByText('Bạn đã mua sản phẩm này 2 lần, mỗi lần mua được viết một đánh giá. Đánh giá này cho đơn TB0002.'),
    ).toBeInTheDocument();
    expect(screen.getByText(REWARD_ALREADY_GIVEN)).toBeInTheDocument();
    expect(screen.queryByText(/\+\d+ Điểm Xanh|Lần đầu đánh giá/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() =>
      expect(mocks.createReview).toHaveBeenCalledWith('nuoc-rua-chen', { rating: 5, comment: undefined, images: undefined, videoUrl: undefined, orderId: 'o2' }),
    );
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã gửi đánh giá của bạn', type: 'success' }));
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Điểm Xanh') }));
  });

  it('nút "Sửa" của dòng mình: chờ nội dung từ GET /reviews/:id rồi điền sẵn; lưu gửi đúng đơn của đánh giá đó', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.fetchMyReview.mockImplementationOnce(() => new Promise((r) => (release = r)));
    mocks.createReview.mockResolvedValue({ updated: true, pointsEarned: 10 });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa đánh giá đơn TB0001' }));
    await waitFor(() => expect(mocks.fetchMyReview).toHaveBeenCalledWith('a'));
    expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull();
    release(MINE_A);
    const group = await screen.findByRole('radiogroup', { name: 'Số sao' });
    expect(within(group).getByRole('radio', { name: '4 sao' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByPlaceholderText(/Chia sẻ cảm nhận/)).toHaveValue('Dùng ổn');
    expect(screen.getByRole('button', { name: 'Thêm ảnh (1)' })).toBeInTheDocument();
    expect(screen.getByText('Bạn đang sửa đánh giá cho đơn TB0001.')).toBeInTheDocument();
    expect(screen.getByText(EDIT_HINT)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gửi đánh giá' })).toBeNull();

    fireEvent.click(within(group).getByRole('radio', { name: '2 sao' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu đánh giá' }));
    await waitFor(() =>
      expect(mocks.createReview).toHaveBeenCalledWith('nuoc-rua-chen', {
        rating: 2,
        comment: 'Dùng ổn',
        images: ['https://i/cu.jpg'],
        videoUrl: undefined,
        orderId: 'o1',
      }),
    );
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã cập nhật đánh giá của bạn', type: 'success' }));
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Điểm Xanh') }));
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());
  });

  // Form viết mới mở trước khi can-review về mà gửi không kèm đơn thì máy chủ (giữ đường cho bản app cũ) SỬA đè đánh giá
  // mới nhất khi mọi lần mua đã có đánh giá, trong khi form vẫn ghi "Đánh giá sản phẩm".
  describe('form chỉ mở khi đã biết đơn, không bao giờ gửi đánh giá thiếu đơn', () => {
    afterEach(() => focusManager.setFocused(undefined));

    it('can-review chưa về: không có nút viết hay sửa; về ALL_REVIEWED thì chỉ có "Sửa đánh giá của bạn", lưu gửi kèm đơn của đánh giá đó', async () => {
      let answer: (v: unknown) => void = () => undefined;
      mocks.canReview.mockImplementation(() => new Promise((r) => (answer = r)));
      mocks.createReview.mockResolvedValue({ id: 'b', updated: true });
      renderSection();
      await screen.findByText('Nhận xét a');
      await waitFor(() => expect(mocks.canReview).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('button', { name: 'Viết đánh giá' })).toBeNull();
      expect(screen.queryByRole('button', { name: /Sửa/ })).toBeNull();
      expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull();

      answer(ELIG_ALL);
      fireEvent.click(await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' }));
      expect(screen.queryByRole('button', { name: 'Viết đánh giá' })).toBeNull();
      expect(await screen.findByPlaceholderText(/Chia sẻ cảm nhận/)).toHaveValue('Lần này hơi khô');
      expect(screen.getByRole('heading', { name: 'Sửa đánh giá' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Lưu đánh giá' }));
      await waitFor(() =>
        expect(mocks.createReview).toHaveBeenCalledWith('nuoc-rua-chen', expect.objectContaining({ comment: 'Lần này hơi khô', orderId: 'o2' })),
      );
      expect(mocks.createReview).toHaveBeenCalledTimes(1);
    });

    it('can-review chưa về hoặc lỗi: không có nút để mở form', async () => {
      mocks.canReview.mockRejectedValue(new Error('mất mạng'));
      renderSection();
      await screen.findByText('Nhận xét a');
      await waitFor(() => expect(mocks.canReview).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('button', { name: 'Viết đánh giá' })).toBeNull();
      expect(screen.queryByRole('button', { name: /Sửa/ })).toBeNull();
    });

    it('form viết mới đang mở mà can-review làm mới thành ALL_REVIEWED (vừa đánh giá ở thiết bị khác) → vẫn gửi kèm đúng đơn chốt lúc mở', async () => {
      renderSection();
      fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
      await screen.findByRole('radiogroup', { name: 'Số sao' });
      mocks.canReview.mockResolvedValue(ELIG_ALL);
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await waitFor(() => expect(mocks.canReview).toHaveBeenCalledTimes(2));
      expect(await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Đánh giá sản phẩm' })).toBeInTheDocument();
      expect(screen.getByText(/Đánh giá này cho đơn TB0002\./)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
      await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(1));
      expect(mocks.createReview.mock.calls[0]![1]).toMatchObject({ orderId: 'o2' });
    });
  });

  it('mọi lần mua đã có đánh giá: nút đầu mục là "Sửa đánh giá của bạn" mở đánh giá mới nhất, không còn "Viết đánh giá"', async () => {
    mocks.canReview.mockResolvedValue(ELIG_ALL);
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' }));
    expect(screen.queryByRole('button', { name: 'Viết đánh giá' })).toBeNull();
    expect(await screen.findByPlaceholderText(/Chia sẻ cảm nhận/)).toHaveValue('Lần này hơi khô');
    expect(mocks.fetchMyReview).toHaveBeenCalledWith('b');
    expect(screen.getByText('Bạn đang sửa đánh giá cho đơn TB0002.')).toBeInTheDocument();
    expect(screen.getAllByText('Của bạn')).toHaveLength(2);
  });

  it('không tải được nội dung để sửa → báo lỗi kèm "Thử lại", không mở form trống', async () => {
    mocks.fetchMyReview.mockRejectedValueOnce(new Error('mạng chập chờn'));
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa đánh giá đơn TB0001' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByPlaceholderText(/Chia sẻ cảm nhận/)).toHaveValue('Dùng ổn');
  });

  it('nháp gắn với đúng đánh giá: đang sửa dở đơn cũ mà mở viết mới thì form trống; quay lại sửa vẫn còn phần đang gõ', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa đánh giá đơn TB0001' }));
    fireEvent.change(await screen.findByPlaceholderText(/Chia sẻ cảm nhận/), { target: { value: 'Đang gõ dở' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Viết đánh giá' }));
    expect(await screen.findByPlaceholderText(/Chia sẻ cảm nhận/)).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Sửa đánh giá đơn TB0001' }));
    expect(await screen.findByPlaceholderText(/Chia sẻ cảm nhận/)).toHaveValue('Đang gõ dở');
  });

  it('lưu xong, lần mở sau điền theo nội dung mới từ máy chủ (không dùng nháp cũ)', async () => {
    mocks.createReview.mockResolvedValue({ updated: true });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa đánh giá đơn TB0001' }));
    fireEvent.change(await screen.findByPlaceholderText(/Chia sẻ cảm nhận/), { target: { value: 'Bản sửa' } });
    mocks.fetchMyReview.mockResolvedValue({ ...MINE_A, comment: 'Bản sửa từ máy chủ' });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu đánh giá' }));
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Sửa đánh giá đơn TB0001' }));
    await waitFor(() => expect(screen.getByPlaceholderText(/Chia sẻ cảm nhận/)).toHaveValue('Bản sửa từ máy chủ'));
  });

  it('tạo xong thì làm mới can-review: hết đơn để viết thì nút đầu mục đổi thành "Sửa đánh giá của bạn"', async () => {
    mocks.canReview.mockResolvedValue(ELIG_NEW);
    mocks.createReview.mockResolvedValue({ id: 'a', updated: false, pointsEarned: 10 });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    await screen.findByRole('radiogroup', { name: 'Số sao' });
    mocks.canReview.mockResolvedValue({ ...ELIG_ALL, purchaseCount: 1, myReviews: [REF_A] });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Cảm ơn đánh giá của bạn! Đã cộng 10 Điểm Xanh', type: 'success' }));
    expect(await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' })).toBeInTheDocument();
  });

  // PF-3: thưởng đánh giá chỉ một lần cho mỗi (khách, sản phẩm): đánh giá lần mua sau, hoặc tạo lại sau khi xoá mà khách
  // còn giữ phần thưởng cũ, ra pointsEarned = 0 và updated = false.
  it.each([
    ['pointsEarned = 0 (đã nhận thưởng trước đó)', { updated: false, pointsEarned: 0 }],
    ['không có pointsEarned', { updated: false }],
  ])('tạo mới mà không được cộng điểm (%s) → báo trung tính, không nhắc Điểm Xanh', async (_n, response) => {
    mocks.canReview.mockResolvedValue(ELIG_NEW);
    mocks.createReview.mockResolvedValue(response);
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    await screen.findByRole('radiogroup', { name: 'Số sao' });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã gửi đánh giá của bạn', type: 'success' }));
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Điểm Xanh') }));
  });

  it('BE trả updated=true dù form đang viết mới (đơn này vừa được đánh giá từ thiết bị khác) → báo "đã cập nhật", không nhắc điểm', async () => {
    mocks.canReview.mockResolvedValue(ELIG_NEW);
    mocks.createReview.mockResolvedValue({ updated: true, pointsEarned: 10 });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    await screen.findByRole('radiogroup', { name: 'Số sao' });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã cập nhật đánh giá của bạn', type: 'success' }));
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Điểm Xanh') }));
  });

  describe('mở từ chi tiết đơn (openForOrderId)', () => {
    it('đơn chưa đánh giá → mở sẵn form viết mới cho đúng đơn đó', async () => {
      renderSection({ openForOrderId: 'o2' });
      await screen.findByRole('radiogroup', { name: 'Số sao' });
      expect(screen.getByText(/Đánh giá này cho đơn TB0002\./)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
      await waitFor(() => expect(mocks.createReview).toHaveBeenCalledWith('nuoc-rua-chen', expect.objectContaining({ orderId: 'o2' })));
    });

    it('đơn đã đánh giá → mở sửa đúng đánh giá của đơn đó', async () => {
      renderSection({ openForOrderId: 'o1' });
      expect(await screen.findByPlaceholderText(/Chia sẻ cảm nhận/)).toHaveValue('Dùng ổn');
      expect(mocks.fetchMyReview).toHaveBeenCalledWith('a');
      expect(screen.getByRole('button', { name: 'Lưu đánh giá' })).toBeInTheDocument();
    });

    it('đơn không có trong can-review (không phải của khách, chưa giao) → không mở gì', async () => {
      renderSection({ openForOrderId: 'o9' });
      await screen.findByRole('button', { name: 'Sửa đánh giá đơn TB0001' });
      expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull();
    });

    // Trang giữ đơn trong trạng thái điều hướng; còn giữ thì quay lại/tải lại trang mở lại form (lúc đó thành form sửa).
    it('đã mở form từ đơn → báo trang gỡ đơn khỏi trạng thái điều hướng đúng một lần, kể cả khi can-review làm mới sau khi gửi', async () => {
      const onOrderLinkUsed = vi.fn();
      renderSection({ openForOrderId: 'o2', onOrderLinkUsed });
      await screen.findByRole('radiogroup', { name: 'Số sao' });
      expect(onOrderLinkUsed).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
      await waitFor(() => expect(mocks.canReview.mock.calls.length).toBeGreaterThanOrEqual(2));
      await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());
      expect(onOrderLinkUsed).toHaveBeenCalledTimes(1);
    });

    it('đơn không có trong can-review → không mở gì nhưng vẫn báo đã dùng đơn; chưa đăng nhập (chưa có can-review) thì chưa báo', async () => {
      const used = vi.fn();
      renderSection({ openForOrderId: 'o9', onOrderLinkUsed: used });
      await waitFor(() => expect(used).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull();

      mocks.auth = { status: 'guest' };
      const guest = vi.fn();
      renderSection({ openForOrderId: 'o2', onOrderLinkUsed: guest });
      await screen.findAllByText('Nhận xét a');
      expect(guest).not.toHaveBeenCalled();
    });

    it('chỉ tự mở một lần: đóng form rồi can-review làm mới không tự mở lại', async () => {
      mocks.createReview.mockResolvedValue({ updated: false, pointsEarned: 0 });
      renderSection({ openForOrderId: 'o2' });
      await screen.findByRole('radiogroup', { name: 'Số sao' });
      fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
      await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());
      await waitFor(() => expect(mocks.canReview.mock.calls.length).toBeGreaterThanOrEqual(2));
      expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull();
    });
  });
});

// PF-6b: câu gợi ý điểm hiện TRƯỚC khi gửi. Không bao giờ hứa điểm vô điều kiện: chỉ đánh giá đầu tiên của mỗi sản phẩm
// được thưởng, đánh giá các lần mua sau (hoặc tạo lại sau khi xoá) ra pointsEarned = 0.
describe('ReviewsSection: câu gợi ý điểm trước khi gửi (chỉ lần đầu)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { status: 'authenticated' };
    mocks.fetchReviews.mockResolvedValue(DATA);
    mocks.canReview.mockResolvedValue(ELIG_NEW);
    mocks.fetchMyReview.mockImplementation(async (id: string) => MYREVIEWS[id]);
    mocks.createReview.mockResolvedValue({ updated: false, pointsEarned: 5 });
  });

  async function openNewForm() {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    await screen.findByRole('radiogroup', { name: 'Số sao' });
  }

  async function openEditForm() {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' }));
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
    mocks.canReview.mockResolvedValue(ELIG_ALL);
    await openEditForm();
    const hint = screen.getByText(/Điểm Xanh/);
    expect(hint).toHaveTextContent(EDIT_HINT);
    expect(hint.textContent).not.toMatch(/\+\d+/);
    expect(hint.textContent).not.toContain(FIRST_ONLY);
    expect(screen.getAllByText(/Điểm Xanh/)).toHaveLength(1);
  });

  // PG-4: API báo hết thưởng (đánh giá đầu tiên của sản phẩm đã được thưởng) thì không hứa điểm nữa. Thiếu cờ (API cũ)
  // giữ câu cũ.
  describe('cờ rewardAvailable từ can-review', () => {
    it('rewardAvailable === false: form viết mới không hứa +5/+10/+15 mà nói rõ đánh giá lần mua này không cộng điểm, ở cả ba trạng thái chữ/ảnh/video', async () => {
      mocks.canReview.mockResolvedValue({ ...ELIG_NEW, rewardAvailable: false });
      await openNewForm();
      const noPromise = () => expect(screen.queryByText(/\+\d+ Điểm Xanh|Lần đầu đánh giá/)).not.toBeInTheDocument();
      noPromise();
      expect(screen.getByText(REWARD_ALREADY_GIVEN)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Thêm ảnh (0)' }));
      noPromise();
      fireEvent.click(screen.getByRole('button', { name: 'Chọn video thử (0)' }));
      noPromise();
      expect(screen.getAllByText(/Điểm Xanh/)).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Gửi đánh giá' })).toBeInTheDocument();
    });

    it('rewardAvailable === true: giữ câu gợi ý như cũ', async () => {
      await openNewForm();
      expect(hintOf(HINT_TEXT_ONLY)).toBeInTheDocument();
    });

    it('chưa có cờ (API chỉ trả đơn còn viết được) → giữ câu gợi ý', async () => {
      mocks.canReview.mockResolvedValue({ canReview: true, reason: null, reviewableOrders: [O1] });
      await openNewForm();
      expect(hintOf(HINT_TEXT_ONLY)).toBeInTheDocument();
      expect(screen.queryByText(/đã mua sản phẩm này/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
      await waitFor(() => expect(mocks.createReview).toHaveBeenCalledWith('nuoc-rua-chen', expect.objectContaining({ orderId: 'o1' })));
    });

    it('API chưa trả đơn còn viết được → không có nút viết, không bao giờ gửi đánh giá thiếu đơn', async () => {
      mocks.canReview.mockResolvedValue({ canReview: true, reason: null });
      renderSection();
      await waitFor(() => expect(mocks.canReview).toHaveBeenCalledTimes(1));
      await screen.findByText('Nhận xét a');
      expect(screen.queryByRole('button', { name: 'Viết đánh giá' })).toBeNull();
      expect(mocks.createReview).not.toHaveBeenCalled();
    });

    it('chế độ sửa vẫn giữ câu giải thích "sửa không cộng thêm" dù cờ là false', async () => {
      mocks.canReview.mockResolvedValue(ELIG_ALL);
      await openEditForm();
      expect(screen.getByText(/Điểm Xanh/)).toHaveTextContent(EDIT_HINT);
    });
  });

  describe('mua lại nhiều lần (ENGAGE-23, R8)', () => {
    it('mua 3 lần, còn đơn chưa đánh giá: form viết mới nói rõ mỗi lần mua một đánh giá và đánh giá này cho đơn nào', async () => {
      mocks.canReview.mockResolvedValue({ ...ELIG_REPEAT, purchaseCount: 3 });
      await openNewForm();
      expect(
        screen.getByText('Bạn đã mua sản phẩm này 3 lần, mỗi lần mua được viết một đánh giá. Đánh giá này cho đơn TB0002.'),
      ).toBeInTheDocument();
    });

    it('sửa: nói rõ đang sửa đánh giá của đơn nào, kèm câu "sửa không cộng thêm"', async () => {
      mocks.canReview.mockResolvedValue(ELIG_ALL);
      await openEditForm();
      expect(screen.getByText('Bạn đang sửa đánh giá cho đơn TB0002.')).toBeInTheDocument();
      expect(screen.getByText(/Điểm Xanh/)).toHaveTextContent(EDIT_HINT);
    });

    it('mua 1 lần: form viết mới không hiện câu nào về số lần mua', async () => {
      await openNewForm();
      expect(screen.queryByText(/đã mua sản phẩm này/)).not.toBeInTheDocument();
    });
  });
});

// R5-BUYER-2: admin ẩn đánh giá của khách (isVisible=false). Đánh giá ẩn không nằm trong danh sách công khai nên khách phải
// được nói thẳng là nó đang chờ Tubu xem xét, và lưu lại không được báo "Đã cập nhật" như thể đã đổi được gì.
describe('ReviewsSection: đánh giá bị Tubu ẩn (R5-BUYER-2)', () => {
  const HIDDEN_REF = { ...REF_A, isVisible: false };
  const ELIG_HIDDEN = { canReview: false, reason: 'ALL_REVIEWED', rewardAvailable: false, purchaseCount: 1, reviewableOrders: [], myReviews: [HIDDEN_REF] };
  const HIDDEN_NOTICE = 'Đánh giá cho đơn TB0001 của bạn đang được Tubu xem xét nên chưa hiện công khai. Sửa nội dung không làm nó hiện lại.';
  const SAVED_HIDDEN = 'Đã lưu. Đánh giá của bạn đang được Tubu xem xét nên chưa hiện công khai.';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { status: 'authenticated' };
    mocks.fetchReviews.mockResolvedValue({ ...DATA, items: DATA.items.filter((i) => i.id !== 'a') });
    mocks.canReview.mockResolvedValue(ELIG_HIDDEN);
    mocks.fetchMyReview.mockImplementation(async (id: string) => ({ ...MYREVIEWS[id] as object, isVisible: false }));
    mocks.createReview.mockResolvedValue({ updated: true, pointsEarned: 0 });
  });

  it('có đánh giá đang ẩn: nói rõ đang chờ Tubu xem xét, kèm đơn; nút sửa vẫn còn', async () => {
    renderSection();
    expect(await screen.findByText(HIDDEN_NOTICE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sửa đánh giá của bạn' })).toBeInTheDocument();
  });

  it('đánh giá đang hiện: không có câu nào về việc bị ẩn', async () => {
    mocks.canReview.mockResolvedValue(ELIG_ALL);
    renderSection();
    await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' });
    expect(screen.queryByText(/chưa hiện công khai/)).toBeNull();
  });

  it('form sửa đánh giá ẩn nhắc lại rằng lưu không làm nó hiện; lưu xong báo "đang chờ Tubu xem xét", không báo "Đã cập nhật"', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' }));
    await screen.findByRole('radiogroup', { name: 'Số sao' });
    expect(screen.getByText('Đánh giá này đang chờ Tubu xem xét nên chưa hiện công khai. Lưu lại không làm nó hiện.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Lưu đánh giá' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: SAVED_HIDDEN, type: 'info' }));
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã cập nhật đánh giá của bạn' }));
  });

  it('máy chủ báo isVisible=false trong phản hồi lưu (can-review cũ chưa có cờ) cũng báo đang chờ xem xét', async () => {
    mocks.canReview.mockResolvedValue({ ...ELIG_ALL, myReviews: [REF_A] });
    mocks.createReview.mockResolvedValue({ updated: true, pointsEarned: 0, isVisible: false });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' }));
    await screen.findByRole('radiogroup', { name: 'Số sao' });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu đánh giá' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: SAVED_HIDDEN, type: 'info' }));
  });
});

// R5-BUYER-3: can-review lỗi thì khách không biết vì sao không có nút viết/sửa — phải nói và cho thử lại.
describe('ReviewsSection: can-review lỗi (R5-BUYER-3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { status: 'authenticated' };
    mocks.fetchReviews.mockResolvedValue(DATA);
    mocks.fetchMyReview.mockImplementation(async (id: string) => MYREVIEWS[id]);
  });

  it('báo "Chưa kiểm tra được quyền đánh giá" kèm Thử lại; thử lại được thì có nút viết đánh giá', async () => {
    mocks.canReview.mockRejectedValueOnce(new Error('500')).mockResolvedValue(ELIG_NEW);
    renderSection();
    expect(await screen.findByText('Chưa kiểm tra được quyền đánh giá.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Viết đánh giá' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('button', { name: 'Viết đánh giá' })).toBeInTheDocument();
    expect(screen.queryByText('Chưa kiểm tra được quyền đánh giá.')).toBeNull();
    expect(mocks.canReview).toHaveBeenCalledTimes(2);
  });

  it('chưa đăng nhập không hỏi can-review nên không có dòng lỗi; can-review đang tải cũng không', async () => {
    mocks.auth = { status: 'idle' };
    renderSection();
    await screen.findByText('Nhận xét a');
    expect(screen.queryByText('Chưa kiểm tra được quyền đánh giá.')).toBeNull();
    expect(mocks.canReview).not.toHaveBeenCalled();
  });
});

describe('Stars', () => {
  it('có tên truy cập "n trên 5 sao" và vẽ 5 ngôi sao', () => {
    const { container } = render(<Stars value={3.6} size={12} />);
    expect(screen.getByRole('img', { name: '3.6 trên 5 sao' })).toBeInTheDocument();
    expect(container.querySelectorAll('svg')).toHaveLength(5);
  });
});

describe('Sao rỗng đủ tương phản (D8-7)', () => {
  it('Stars: sao rỗng không dùng stone-200 (1,39:1 trên nền trắng)', () => {
    const { container } = render(<Stars value={2} />);
    const colors = Array.from(container.querySelectorAll('svg')).map((s) => (s as unknown as HTMLElement).style.color);
    expect(colors.filter((c) => c.includes('--stone-200'))).toEqual([]);
    expect(colors.filter((c) => c.includes('--stone-450'))).toHaveLength(3);
  });
});

