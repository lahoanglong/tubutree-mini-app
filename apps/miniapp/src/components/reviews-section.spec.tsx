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
  cloudinary: true,
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
vi.mock('./ui/auth-gate', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useLoginWithNotice: () => mocks.login }));
vi.mock('./image-upload', () => ({
  MultiImageUpload: ({
    value,
    onChange,
    onBusyChange,
    disabled,
  }: {
    value: string[];
    onChange: (v: string[]) => void;
    onBusyChange?: (busy: boolean) => void;
    disabled?: boolean;
  }) => (
    <>
      <button type="button" disabled={disabled} onClick={() => onChange([...value, 'https://i/moi.jpg'])}>
        Thêm ảnh ({value.length})
      </button>
      <button type="button" disabled={disabled} onClick={() => onChange(value.slice(0, -1))}>
        Xoá ảnh thử
      </button>
      <button type="button" onClick={() => onBusyChange?.(true)}>
        Bắt đầu tải ảnh thử
      </button>
      <button
        type="button"
        onClick={() => {
          onChange([...value, 'https://i/xong.jpg']);
          onBusyChange?.(false);
        }}
      >
        Tải xong ảnh thử
      </button>
    </>
  ),
  isCloudinaryConfigured: () => mocks.cloudinary,
  VideoUpload: ({
    value,
    onChange,
    onBusyChange,
    disabled,
  }: {
    value: string;
    onChange: (v: string) => void;
    onBusyChange?: (busy: boolean) => void;
    disabled?: boolean;
  }) => (
    <>
      <button type="button" disabled={disabled} onClick={() => onChange('https://v/moi.mp4')}>
        Chọn video thử ({value ? 1 : 0})
      </button>
      <button type="button" onClick={() => onBusyChange?.(true)}>
        Bắt đầu tải video thử
      </button>
      <button
        type="button"
        onClick={() => {
          onChange('https://v/xong.mp4');
          onBusyChange?.(false);
        }}
      >
        Tải xong video thử
      </button>
    </>
  ),
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { ReviewsSection, Stars } from './reviews-section';
import { getErrorMessage } from '../services/api';
import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';

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
    mocks.cloudinary = true;
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
    expect(screen.getByText('4,3')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '4,3 trên 5 sao' })).toBeInTheDocument();
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
    const thumbs = screen.getAllByRole('button', { name: /^Xem ảnh đánh giá \d$/ });
    const srcs = thumbs.map((b) => b.querySelector('img')!.getAttribute('src'));
    expect(srcs).toEqual(['http://localhost:3001/api/reviews/p/images/0?v=abc1234567', 'https://res.cloudinary.com/x/a.jpg']);
  });

  describe('lightbox ảnh/video đánh giá (W42B)', () => {
    const MEDIA = {
      average: 5,
      count: 1,
      items: [review('p', 4, { author: 'Lan', verifiedPurchase: true, images: ['/reviews/p/images/0?v=1', 'https://i/2.jpg'], videoUrl: 'https://v/x.mp4' })],
    };
    const box = () => document.querySelector<HTMLElement>('[data-testid="review-lightbox"]');

    it('thumbnail là nút ≥44px có tên; bấm mở lightbox đúng tệp, bộ đếm "2 / 3", tệp video là <video controls>', async () => {
      mocks.fetchReviews.mockResolvedValue(MEDIA);
      renderSection();
      await screen.findByText('Nhận xét p');
      expect(box()).toBeNull();
      const second = screen.getByRole('button', { name: 'Xem ảnh đánh giá 2' });
      expect(parseInt(second.style.minWidth, 10)).toBeGreaterThanOrEqual(44);
      expect(parseInt(second.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
      fireEvent.click(second);
      expect(box()).not.toBeNull();
      expect(within(box()!).getByText('2 / 3').style.fontVariantNumeric).toBe('tabular-nums');
      expect(box()!.querySelector('img')!.getAttribute('src')).toBe('https://i/2.jpg');
      fireEvent.click(within(box()!).getByRole('button', { name: 'Tệp sau' }));
      expect(within(box()!).getByText('3 / 3')).toBeInTheDocument();
      expect(box()!.querySelector('video')!.hasAttribute('controls')).toBe(true);
      expect(within(box()!).getByText('Đã mua hàng')).toBeInTheDocument();
      expect(within(box()!).getByText('Lan')).toBeInTheDocument();
    });

    it('ảnh API tương đối trong lightbox cũng ghép gốc API; nút Video mở thẳng tệp video', async () => {
      mocks.fetchReviews.mockResolvedValue(MEDIA);
      renderSection();
      await screen.findByText('Nhận xét p');
      fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh đánh giá 1' }));
      expect(box()!.querySelector('img')!.getAttribute('src')).toBe('http://localhost:3001/api/reviews/p/images/0?v=1');
      fireEvent.click(within(box()!).getByRole('button', { name: 'Đóng' }));
      expect(box()).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Xem video đánh giá' }));
      expect(within(box()!).getByText('3 / 3')).toBeInTheDocument();
    });

    it('Esc đóng lightbox; có onQuickAdd thì chân có "Thêm vào giỏ", bấm đóng lightbox rồi gọi onQuickAdd', async () => {
      mocks.fetchReviews.mockResolvedValue(MEDIA);
      const onQuickAdd = vi.fn();
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <ReviewsSection slug="nuoc-rua-chen" onQuickAdd={onQuickAdd} />
        </QueryClientProvider>,
      );
      await screen.findByText('Nhận xét p');
      fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh đánh giá 1' }));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(box()).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh đánh giá 1' }));
      fireEvent.click(within(box()!).getByRole('button', { name: /Thêm vào giỏ/ }));
      expect(box()).toBeNull();
      expect(onQuickAdd).toHaveBeenCalledTimes(1);
    });

    it('không có onQuickAdd thì lightbox không có nút "Thêm vào giỏ"', async () => {
      mocks.fetchReviews.mockResolvedValue(MEDIA);
      renderSection();
      await screen.findByText('Nhận xét p');
      fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh đánh giá 1' }));
      expect(within(box()!).queryByRole('button', { name: /Thêm vào giỏ/ })).toBeNull();
    });
  });

  /** API thật lọc theo chip trên mọi đánh giá đang hiện; mock trả đúng các dòng khớp tham số, thống kê giữ nguyên. */
  const serve = (summary: Omit<typeof DATA, 'distribution'> & { distribution: Record<string, number> }) =>
    mocks.fetchReviews.mockImplementation(async (_slug: string, f: number | string = 'all') => {
      if (f === 'all') return summary;
      const items = summary.items.filter((r) =>
        f === 'photo' ? (r.images as string[]).length > 0 : f === 'video' ? Boolean(r.videoUrl) : r.rating === f,
      );
      return { ...summary, items };
    });

  it('chip lọc hỏi máy chủ đúng tham số: "5 sao", "Có ảnh", "Có video", mức không có đánh giá ra trạng thái rỗng, "Tất cả" trả lại đủ', async () => {
    serve(DATA);
    renderSection();
    await screen.findByText('Nhận xét a');
    fireEvent.click(screen.getByRole('button', { name: /^5 sao\(/ }));
    expect(await screen.findByText('Nhận xét a')).toBeInTheDocument();
    expect(screen.queryByText('Nhận xét c')).toBeNull();
    expect(mocks.fetchReviews).toHaveBeenLastCalledWith('nuoc-rua-chen', 5);
    fireEvent.click(screen.getByRole('button', { name: 'Có ảnh' }));
    expect(await screen.findByText('Nhận xét c')).toBeInTheDocument();
    expect(screen.queryByText('Nhận xét a')).toBeNull();
    expect(mocks.fetchReviews).toHaveBeenLastCalledWith('nuoc-rua-chen', 'photo');
    fireEvent.click(screen.getByRole('button', { name: /Có video/ }));
    expect(await screen.findByText('Nhận xét b')).toBeInTheDocument();
    expect(screen.queryByText('Nhận xét c')).toBeNull();
    expect(mocks.fetchReviews).toHaveBeenLastCalledWith('nuoc-rua-chen', 'video');
    fireEvent.click(screen.getByRole('button', { name: /^4 sao\(/ }));
    expect(await screen.findByText('Không có đánh giá khớp bộ lọc.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Tất cả\(/ }));
    expect(screen.getAllByText(/^Nhận xét /)).toHaveLength(3);
    expect(screen.getByRole('heading', { level: 2, name: 'Đánh giá (3)' })).toBeInTheDocument();
  });

  // Sản phẩm 123 đánh giá: trang đầu chỉ có 100 dòng 5 sao mới nhất. Số trên chip phải là số máy chủ đếm trên mọi đánh giá.
  it('chip ghi số máy chủ đếm (count, distribution, videoCount), không đếm 100 dòng đã tải; "Có ảnh" không ghi số', async () => {
    const newest = Array.from({ length: 100 }, (_, i) => review(`n${i}`, 5));
    serve({ ...DATA, count: 123, distribution: { '5': 120, '1': 3 }, videoCount: 2, items: newest });
    renderSection();
    await screen.findByText('Nhận xét n0');
    expect(screen.getByRole('button', { name: /^Tất cả\(123\)$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^5 sao\(120\)$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^4 sao\(0\)$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^1 sao\(3\)$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Có video\(2\)$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Có ảnh' })).toBeInTheDocument();
  });

  it('API cũ chưa trả videoCount: chip "Có video" đếm trên các đánh giá đã tải thay vì biến mất', async () => {
    const { videoCount: _omit, ...old } = DATA;
    mocks.fetchReviews.mockResolvedValue(old);
    renderSection();
    await screen.findByText('Nhận xét a');
    expect(screen.getByRole('button', { name: /^Có video\(1\)$/ })).toBeInTheDocument();
  });

  it('chip "2 sao" và "1 sao" hiện đúng đánh giá thấp máy chủ trả', async () => {
    serve({ ...DATA, count: 4, distribution: { '5': 1, '2': 2, '1': 1 }, items: [review('s5', 5), review('s2', 2), review('s2b', 2), review('s1', 1)] });
    renderSection();
    await screen.findByText('Nhận xét s5');
    fireEvent.click(screen.getByRole('button', { name: /^2 sao\(/ }));
    expect(await screen.findByText('Nhận xét s2')).toBeInTheDocument();
    expect(screen.getByText('Nhận xét s2b')).toBeInTheDocument();
    expect(screen.queryByText('Nhận xét s1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^1 sao\(/ }));
    expect(await screen.findByText('Nhận xét s1')).toBeInTheDocument();
    expect(screen.queryByText('Nhận xét s2')).toBeNull();
  });

  // Lỗi gốc: danh sách đầy đủ chỉ có 100 đánh giá mới nhất. Sản phẩm 120 đánh giá 5 sao mới + 3 đánh giá 1 sao cũ thì lọc 1 sao
  // trên 100 dòng đó ra rỗng dù phân bố sao ghi 3.
  it('100 dòng mới nhất toàn 5 sao: chip "1 sao" chờ máy chủ (không báo rỗng tạm), rồi hiện đủ 3 đánh giá 1 sao cũ', async () => {
    const newest = Array.from({ length: 100 }, (_, i) => review(`n${i}`, 5));
    const old1 = [review('cu1', 1), review('cu2', 1), review('cu3', 1)];
    let answer: (v: unknown) => void = () => undefined;
    mocks.fetchReviews.mockImplementation((_slug: string, f: number | string = 'all') =>
      f === 'all'
        ? Promise.resolve({ ...DATA, count: 123, distribution: { '5': 120, '1': 3 }, items: newest, nextCursor: 'c-n99' })
        : new Promise((r) => (answer = r)),
    );
    renderSection();
    await screen.findByText('Nhận xét n0');
    expect(screen.getByRole('button', { name: 'Xem thêm đánh giá' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^1 sao\(/ }));
    await waitFor(() => expect(mocks.fetchReviews).toHaveBeenLastCalledWith('nuoc-rua-chen', 1));
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText('Không có đánh giá khớp bộ lọc.')).toBeNull();
    expect(screen.queryByText('Nhận xét n0')).toBeNull();
    answer({ ...DATA, count: 123, distribution: { '5': 120, '1': 3 }, items: old1, nextCursor: null });
    expect(await screen.findByText('Nhận xét cu1')).toBeInTheDocument();
    expect(screen.getByText('Nhận xét cu3')).toBeInTheDocument();
    expect(screen.queryByText('Không có đánh giá khớp bộ lọc.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xem thêm đánh giá' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Đánh giá (123)' })).toBeInTheDocument();
  });

  // Phân trang con trỏ: mỗi trang máy chủ 100 dòng kèm nextCursor; mock dùng trang nhỏ để thấy chỗ nối.
  describe('"Xem thêm đánh giá": tải trang kế bằng nextCursor', () => {
    const first = Array.from({ length: 6 }, (_, i) => review(`p${i}`, 5));
    const second = [review('q0', 4), review('q1', 4), review('q2', 4)];
    const PAGED = { ...DATA, count: 9, distribution: { '5': 6, '4': 3 } };
    const shown = () => screen.getAllByText(/^Nhận xét /).map((el) => el.textContent);

    it('hiện 5 dòng; bấm thì hiện dòng đã tải, hết dòng thì gọi trang kế đúng con trỏ, nối vào cuối, dòng cũ giữ nguyên; hết trang thì ẩn nút', async () => {
      mocks.fetchReviews.mockImplementation(async (_slug: string, _f: number | string = 'all', cursor?: string) =>
        cursor === 'c1' ? { ...PAGED, items: second, nextCursor: null } : { ...PAGED, items: first, nextCursor: 'c1' },
      );
      renderSection();
      await screen.findByText('Nhận xét p0');
      expect(shown()).toEqual(['Nhận xét p0', 'Nhận xét p1', 'Nhận xét p2', 'Nhận xét p3', 'Nhận xét p4']);
      fireEvent.click(screen.getByRole('button', { name: 'Xem thêm đánh giá' }));
      expect(await screen.findByText('Nhận xét q2')).toBeInTheDocument();
      expect(mocks.fetchReviews).toHaveBeenCalledWith('nuoc-rua-chen', 'all', 'c1');
      expect(shown()).toEqual([...first, ...second].map((r) => `Nhận xét ${r.id}`));
      expect(screen.queryByRole('button', { name: 'Xem thêm đánh giá' })).toBeNull();
      expect(screen.getByRole('heading', { level: 2, name: 'Đánh giá (9)' })).toBeInTheDocument();
    });

    it('không có nextCursor (hết trang, hoặc API cũ) và đã hiện hết: không có nút, không gọi trang kế', async () => {
      mocks.fetchReviews.mockResolvedValue({ ...PAGED, items: first.slice(0, 5) });
      renderSection();
      await screen.findByText('Nhận xét p4');
      expect(screen.queryByRole('button', { name: 'Xem thêm đánh giá' })).toBeNull();
      expect(mocks.fetchReviews).toHaveBeenCalledTimes(1);
    });

    it('chip lọc: trang kế gửi kèm chip và con trỏ của chip; đổi chip về trang đầu, bỏ trang đã tải thêm', async () => {
      mocks.fetchReviews.mockImplementation(async (_slug: string, f: number | string = 'all', cursor?: string) => {
        if (f === 4) return cursor === 'k1' ? { ...PAGED, items: [review('q9', 4)], nextCursor: null } : { ...PAGED, items: second, nextCursor: 'k1' };
        return cursor === 'c1' ? { ...PAGED, items: second, nextCursor: null } : { ...PAGED, items: first, nextCursor: 'c1' };
      });
      renderSection();
      await screen.findByText('Nhận xét p0');
      fireEvent.click(screen.getByRole('button', { name: 'Xem thêm đánh giá' }));
      await screen.findByText('Nhận xét q2');
      fireEvent.click(screen.getByRole('button', { name: /^4 sao\(/ }));
      await screen.findByText('Nhận xét q0');
      expect(shown()).toEqual(['Nhận xét q0', 'Nhận xét q1', 'Nhận xét q2']);
      fireEvent.click(screen.getByRole('button', { name: 'Xem thêm đánh giá' }));
      expect(await screen.findByText('Nhận xét q9')).toBeInTheDocument();
      expect(mocks.fetchReviews).toHaveBeenCalledWith('nuoc-rua-chen', 4, 'k1');
      fireEvent.click(screen.getByRole('button', { name: /^Tất cả\(/ }));
      await waitFor(() => expect(shown()).toEqual(['Nhận xét p0', 'Nhận xét p1', 'Nhận xét p2', 'Nhận xét p3', 'Nhận xét p4']));
      expect(screen.getByRole('button', { name: 'Xem thêm đánh giá' })).toBeInTheDocument();
    });

    /** Máy chủ giả có thứ tự: trang `size` dòng, con trỏ là id dòng cuối, như keyset của API. */
    const server = (rows: () => ReturnType<typeof review>[], size = 6) =>
      async (_slug: string, _f: number | string = 'all', cursor?: string) => {
        const all = rows();
        const start = cursor ? all.findIndex((r) => r.id === cursor) + 1 : 0;
        const items = all.slice(start, start + size);
        return { ...PAGED, count: all.length, items, nextCursor: start + size < all.length ? items.at(-1)!.id : null };
      };
    const ROWS = Array.from({ length: 15 }, (_, i) => review(`r${i}`, 5));

    it('nhiều trang: mỗi lần bấm tải thêm khi dòng đã tải không đủ, tới trang cuối thì ẩn nút', async () => {
      mocks.fetchReviews.mockImplementation(server(() => ROWS));
      renderSection();
      await screen.findByText('Nhận xét r0');
      fireEvent.click(screen.getByRole('button', { name: 'Xem thêm đánh giá' }));
      await waitFor(() => expect(shown()).toHaveLength(10));
      expect(mocks.fetchReviews.mock.calls.map((c) => c[2])).toEqual([undefined, 'r5']);
      fireEvent.click(screen.getByRole('button', { name: 'Xem thêm đánh giá' }));
      await waitFor(() => expect(shown()).toHaveLength(15));
      expect(mocks.fetchReviews.mock.calls.map((c) => c[2])).toEqual([undefined, 'r5', 'r11']);
      expect(shown()).toEqual(ROWS.map((r) => `Nhận xét ${r.id}`));
      expect(screen.queryByRole('button', { name: 'Xem thêm đánh giá' })).toBeNull();
    });

    describe('trang đầu tải lại có đánh giá mới', () => {
      afterEach(() => focusManager.setFocused(undefined));

      it('dòng cuối trang đầu đổi: các trang sau tải lại từ con trỏ mới, đủ số dòng đang hiện, không sót, không trùng', async () => {
        let rows = ROWS;
        mocks.fetchReviews.mockImplementation(server(() => rows));
        renderSection();
        await screen.findByText('Nhận xét r0');
        fireEvent.click(screen.getByRole('button', { name: 'Xem thêm đánh giá' }));
        await waitFor(() => expect(shown()).toHaveLength(10));
        fireEvent.click(screen.getByRole('button', { name: 'Xem thêm đánh giá' }));
        await waitFor(() => expect(shown()).toHaveLength(15));
        rows = [review('moi', 5), ...ROWS];
        act(() => {
          focusManager.setFocused(false);
          focusManager.setFocused(true);
        });
        await screen.findByText('Nhận xét moi');
        // Trang đầu mới dừng ở r4: bộ trang sau tải lại từ r4 và tự tải tiếp cho đủ 15 dòng đang hiện (trước đây chỉ còn 12).
        await waitFor(() => expect(shown()).toEqual(['moi', ...ROWS.slice(0, 14).map((r) => r.id)].map((id) => `Nhận xét ${id}`)));
        expect(mocks.fetchReviews.mock.calls.map((c) => c[2])).toEqual(expect.arrayContaining(['r4', 'r10']));
        expect(screen.getByRole('button', { name: 'Xem thêm đánh giá' })).toBeInTheDocument();
      });
    });

    it('lỗi tải lại nền khi còn dòng đã tải chưa hiện: vẫn có nút "Xem thêm đánh giá", không thay bằng báo lỗi', async () => {
      let fail = false;
      const ok = server(() => ROWS, 6);
      mocks.fetchReviews.mockImplementation(async (slug: string, f: number | string = 'all', cursor?: string) => {
        if (cursor && fail) throw new Error('mất mạng');
        return ok(slug, f, cursor);
      });
      renderSection();
      await screen.findByText('Nhận xét r0');
      fireEvent.click(screen.getByRole('button', { name: 'Xem thêm đánh giá' }));
      await waitFor(() => expect(shown()).toHaveLength(10));
      fail = true;
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await waitFor(() => expect(mocks.fetchReviews.mock.calls.filter((c) => c[2] === 'r5')).toHaveLength(2));
      await new Promise((r) => setTimeout(r, 20));
      expect(shown()).toHaveLength(10);
      expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Xem thêm đánh giá' })).toBeInTheDocument();
      focusManager.setFocused(undefined);
    });

    it('trang kế tải lỗi: dòng đang hiện giữ nguyên, báo lỗi có "Thử lại"; thử lại thì nối trang kế', async () => {
      let fail = true;
      mocks.fetchReviews.mockImplementation(async (_slug: string, _f: number | string = 'all', cursor?: string) => {
        if (cursor !== 'c1') return { ...PAGED, items: first, nextCursor: 'c1' };
        if (fail) throw new Error('mất mạng');
        return { ...PAGED, items: second, nextCursor: null };
      });
      renderSection();
      await screen.findByText('Nhận xét p0');
      fireEvent.click(screen.getByRole('button', { name: 'Xem thêm đánh giá' }));
      const retry = await screen.findByRole('button', { name: 'Thử lại' });
      expect(shown()).toEqual(first.map((r) => `Nhận xét ${r.id}`));
      fail = false;
      fireEvent.click(retry);
      expect(await screen.findByText('Nhận xét q2')).toBeInTheDocument();
      expect(shown()).toHaveLength(9);
    });
  });

  it('đổi chip liên tiếp: kết quả của chip cũ về SAU chip mới không đè lên danh sách đang xem (khoá theo chip)', async () => {
    const gates: Record<string, (v: unknown) => void> = {};
    mocks.fetchReviews.mockImplementation((_slug: string, f: number | string = 'all') => {
      if (f === 'all') return Promise.resolve(DATA);
      return new Promise((r) => (gates[String(f)] = r));
    });
    renderSection();
    await screen.findByText('Nhận xét a');
    fireEvent.click(screen.getByRole('button', { name: /^5 sao\(/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Có ảnh' }));
    await waitFor(() => expect(Object.keys(gates).sort()).toEqual(['5', 'photo']));
    await act(async () => gates['photo']!({ ...DATA, items: [DATA.items[2]] }));
    expect(await screen.findByText('Nhận xét c')).toBeInTheDocument();
    await act(async () => gates['5']!({ ...DATA, items: [DATA.items[0], DATA.items[1]] }));
    expect(screen.getByText('Nhận xét c')).toBeInTheDocument();
    expect(screen.queryByText('Nhận xét a')).toBeNull();
    expect(screen.queryByText('Nhận xét b')).toBeNull();
  });

  it('chip lọc tải lỗi: báo lỗi có "Thử lại", phần thống kê vẫn còn; thử lại thì hiện kết quả', async () => {
    let fail = true;
    mocks.fetchReviews.mockImplementation(async (_slug: string, f: number | string = 'all') => {
      if (f === 'all') return DATA;
      if (fail) throw new Error('mất mạng');
      return { ...DATA, items: [review('c', 3, { images: ['https://i/1.jpg'] })] };
    });
    renderSection();
    await screen.findByText('Nhận xét a');
    fireEvent.click(screen.getByRole('button', { name: /^3 sao\(/ }));
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    expect(screen.getByRole('heading', { level: 2, name: 'Đánh giá (3)' })).toBeInTheDocument();
    expect(screen.queryByText('Không có đánh giá khớp bộ lọc.')).toBeNull();
    fail = false;
    fireEvent.click(retry);
    expect(await screen.findByText('Nhận xét c')).toBeInTheDocument();
  });

  it('không có video nào → không có chip "Có video"', async () => {
    mocks.fetchReviews.mockResolvedValue({ ...DATA, videoCount: 0 });
    renderSection();
    await screen.findByText('Nhận xét a');
    expect(screen.queryByRole('button', { name: /Có video/ })).toBeNull();
  });

  // Đánh giá video cuối cùng bị admin ẩn trong lúc khách đang xem "Có video", rồi danh sách tải lại nền (ở app thật: sau khi khách sửa đánh giá của mình
  // làm mới `['reviews', slug]`, hoặc vào lại màn khi dữ liệu quá 10 giây). Test dùng đổi focus làm cách gọi tải lại nền; hành vi kiểm là chip, không phải cách gọi.
  describe('đang chọn "Có video" mà đánh giá video cuối cùng bị ẩn', () => {
    afterEach(() => focusManager.setFocused(undefined));

    it('chip vẫn còn, vẫn đang chọn, ghi (0); danh sách trống báo không khớp; chọn chip khác thì chip biến mất', async () => {
      let videoGone = false;
      mocks.fetchReviews.mockImplementation(async (_slug: string, f: number | string = 'all') => {
        const base = videoGone ? { ...DATA, videoCount: 0, items: DATA.items.map((r) => ({ ...r, videoUrl: null })) } : DATA;
        if (f === 'all') return base;
        return { ...base, items: base.items.filter((r) => (f === 'video' ? Boolean(r.videoUrl) : f === 'photo' ? (r.images as string[]).length > 0 : r.rating === f)) };
      });
      renderSection();
      await screen.findByText('Nhận xét a');
      fireEvent.click(screen.getByRole('button', { name: /Có video/ }));
      expect(await screen.findByText('Nhận xét b')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Có video/ })).toHaveAttribute('aria-pressed', 'true');

      videoGone = true;
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      const chip = await screen.findByRole('button', { name: /^Có video\(0\)$/ });
      expect(chip).toHaveAttribute('aria-pressed', 'true');
      await waitFor(() => expect(screen.getByText('Không có đánh giá khớp bộ lọc.')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /^Tất cả\(/ }));
      await waitFor(() => expect(screen.queryByRole('button', { name: /Có video/ })).toBeNull());
    });
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
    expect(await screen.findByText('Mua và nhận hàng để đánh giá')).toBeInTheDocument();
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
    mocks.cloudinary = true;
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

  it('bản build chưa cấu hình Cloudinary: câu gợi ý không mời video', async () => {
    mocks.cloudinary = false;
    await openNewForm();
    expect(hintOf(`${FIRST_ONLY}: thêm ảnh +10.000 Điểm Xanh (chỉ chữ +5.000). Chỉ đánh giá được khi đã mua và nhận hàng.`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ảnh (0)' }));
    expect(hintOf(`${FIRST_ONLY}, bạn nhận +10.000 Điểm Xanh cho đánh giá có ảnh!`)).toBeInTheDocument();
  });

  it('đang tải video: nút gửi khoá và đổi nhãn, bấm không gọi createReview; tải xong gửi kèm videoUrl', async () => {
    await openNewForm();
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu tải video thử' }));
    const waiting = screen.getByRole('button', { name: 'Đang tải video…' });
    expect(waiting).toBeDisabled();
    fireEvent.click(waiting);
    expect(mocks.createReview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tải xong video thử' }));
    const send = await screen.findByRole('button', { name: 'Gửi đánh giá' });
    expect(send).not.toBeDisabled();
    fireEvent.click(send);
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(1));
    expect(mocks.createReview.mock.calls[0]![1]).toMatchObject({ videoUrl: 'https://v/xong.mp4', orderId: 'o1' });
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

describe('ReviewsSection: gửi đánh giá khoá chạm đúp, báo bận, lỗi gửi, số đều, vùng chạm (W68A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cloudinary = true;
    mocks.auth = { status: 'authenticated' };
    mocks.fetchReviews.mockResolvedValue(DATA);
    mocks.canReview.mockResolvedValue(ELIG_NEW);
    mocks.createReview.mockReset().mockResolvedValue({});
  });

  const openForm = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    await screen.findByRole('radiogroup', { name: 'Số sao' });
    return screen.getByRole('button', { name: 'Gửi đánh giá' });
  };

  it('chạm đúp "Gửi đánh giá" trong cùng một nhịp vẽ: một lời gọi createReview; đang gửi nút báo bận; xong thì đóng form', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.createReview.mockReturnValue(new Promise((r) => (release = r)));
    renderSection();
    const send = await openForm();
    act(() => {
      send.click();
      send.click();
    });
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gửi đánh giá' })).toHaveAttribute('aria-busy', 'true'));
    await act(async () => {
      send.click();
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.createReview).toHaveBeenCalledTimes(1);
    await act(async () => release({ updated: false, pointsEarned: 0 }));
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());
  });

  it('Ctrl+Enter ở ô nhận xét cũng qua khoá: gõ tắt hai lần liền chỉ gửi một lần', async () => {
    mocks.createReview.mockReturnValue(new Promise(() => undefined));
    renderSection();
    await openForm();
    const box = screen.getByPlaceholderText(/Chia sẻ cảm nhận/);
    act(() => {
      fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
      fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    });
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.createReview).toHaveBeenCalledTimes(1);
  });

  it('gửi lỗi: báo bằng role=alert tại chỗ, form và nhận xét còn nguyên, khoá đã nhả nên gửi lại được đúng một lần', async () => {
    mocks.createReview.mockRejectedValueOnce(new Error('mạng')).mockResolvedValueOnce({ updated: false, pointsEarned: 0 });
    renderSection();
    const send = await openForm();
    fireEvent.change(screen.getByPlaceholderText(/Chia sẻ cảm nhận/), { target: { value: 'Dùng êm' } });
    fireEvent.click(send);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Có chút trục trặc, thử lại nhé');
    expect(screen.getByPlaceholderText(/Chia sẻ cảm nhận/)).toHaveValue('Dùng êm');
    expect(screen.getByRole('button', { name: 'Gửi đánh giá' })).not.toHaveAttribute('aria-busy');
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());
  });

  it('nút "Gửi đánh giá" và nút đầu mục "Viết đánh giá" là nút 44px', async () => {
    renderSection();
    expect((await screen.findByRole('button', { name: 'Viết đánh giá' })).style.minHeight).toBe('44px');
    expect((await openForm()).style.minHeight).toBe('44px');
  });

  it('tải lỗi có "Thử lại" ngay tại chỗ (nút 44px) và thử lại thì hiện danh sách', async () => {
    mocks.fetchReviews.mockRejectedValueOnce(new Error('500')).mockResolvedValue(DATA);
    renderSection();
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    expect(retry.style.minHeight).toBe('44px');
    fireEvent.click(retry);
    expect(await screen.findByText('Nhận xét a')).toBeInTheDocument();
    expect(mocks.fetchReviews).toHaveBeenCalledTimes(2);
  });

  it('khung chờ danh sách báo aria-busy; có danh sách rồi thì không còn', async () => {
    mocks.fetchReviews.mockReturnValueOnce(new Promise(() => undefined));
    const first = renderSection();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull());
    first.unmount();
    mocks.fetchReviews.mockResolvedValue(DATA);
    renderSection();
    await screen.findByText('Nhận xét a');
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('số đều (tabular-nums): cả khối Đánh giá nằm trong .tubu-nums', async () => {
    renderSection();
    await screen.findByText('Nhận xét a');
    expect(screen.getByRole('region', { name: 'Đánh giá sản phẩm' }).classList.contains('tubu-nums')).toBe(true);
  });
});

describe('Stars', () => {
  it('có tên truy cập "n trên 5 sao" và vẽ 5 ngôi sao', () => {
    const { container } = render(<Stars value={3.6} size={12} />);
    expect(screen.getByRole('img', { name: '3,6 trên 5 sao' })).toBeInTheDocument();
    expect(container.querySelectorAll('svg')).toHaveLength(5);
  });

  it('điểm trung bình 4.4 đọc "4,4 trên 5 sao" như số đang hiện (vi-VN), không "4.4"', () => {
    render(<Stars value={4.4} />);
    expect(screen.getByRole('img', { name: '4,4 trên 5 sao' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /4\.4/ })).toBeNull();
  });

  it('điểm trung bình tròn đọc "5,0 trên 5 sao" như số đang hiện, không "5"', () => {
    render(<Stars value={5} />);
    expect(screen.getByRole('img', { name: '5,0 trên 5 sao' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: '5 trên 5 sao' })).toBeNull();
  });

  it('điểm một khách chấm (spoken="score") là số nguyên: "5 trên 5 sao", không "5,0"', () => {
    render(<Stars value={5} spoken="score" />);
    expect(screen.getByRole('img', { name: '5 trên 5 sao' })).toBeInTheDocument();
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


describe('ReviewsSection: form đánh giá dùng được bằng bàn phím, lỗi nói rõ và được focus (W27)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { status: 'authenticated' };
    mocks.cloudinary = true;
    mocks.fetchReviews.mockResolvedValue(DATA);
    mocks.canReview.mockResolvedValue(ELIG_NEW);
    mocks.fetchMyReview.mockImplementation(async (id: string) => MYREVIEWS[id]);
    mocks.createReview.mockResolvedValue({ updated: false, pointsEarned: 0 });
  });

  const openForm = async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    return screen.findByRole('radiogroup', { name: 'Số sao' });
  };
  const star = (group: HTMLElement, n: number) => within(group).getByRole('radio', { name: `${n} sao` });
  const tabStops = (group: HTMLElement) => within(group).getAllByRole('radio').map((r) => r.tabIndex);

  it('hàng sao một điểm dừng Tab (sao đang chọn); mũi tên đổi sao và chuyển focus, đi vòng ở hai đầu; Home, End', async () => {
    const group = await openForm();
    expect(tabStops(group)).toEqual([-1, -1, -1, -1, 0]);
    star(group, 5).focus();
    fireEvent.keyDown(star(group, 5), { key: 'ArrowLeft' });
    expect(star(group, 4)).toHaveAttribute('aria-checked', 'true');
    expect(star(group, 4)).toHaveFocus();
    fireEvent.keyDown(star(group, 4), { key: 'ArrowUp' });
    expect(star(group, 3)).toHaveFocus();
    fireEvent.keyDown(star(group, 3), { key: 'End' });
    expect(star(group, 5)).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(star(group, 5), { key: 'ArrowRight' });
    expect(star(group, 1)).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(star(group, 1), { key: 'ArrowDown' });
    expect(star(group, 2)).toHaveFocus();
    fireEvent.keyDown(star(group, 2), { key: 'Home' });
    expect(star(group, 1)).toHaveAttribute('aria-checked', 'true');
    expect(tabStops(group)).toEqual([0, -1, -1, -1, -1]);
    // Phím có Ctrl/Alt/⌘ là phím tắt của máy, không đổi sao.
    fireEvent.keyDown(star(group, 1), { key: 'ArrowRight', altKey: true });
    expect(star(group, 1)).toHaveAttribute('aria-checked', 'true');
  });

  it('Enter của bộ gõ tiếng Việt (isComposing, keyCode 229) không bấm nút sao hay nút Gửi; ô nhận xét để bộ gõ tự xử lý', async () => {
    const group = await openForm();
    expect(fireEvent.keyDown(star(group, 3), { key: 'Enter', keyCode: 229 })).toBe(false);
    expect(fireEvent.keyDown(screen.getByRole('button', { name: 'Gửi đánh giá' }), { key: 'Enter', isComposing: true })).toBe(false);
    expect(fireEvent.keyDown(star(group, 3), { key: 'Enter', keyCode: 13 })).toBe(true);
    expect(fireEvent.keyDown(screen.getByLabelText('Nội dung đánh giá'), { key: 'Enter', keyCode: 229 })).toBe(true);
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('Ctrl+Enter hoặc ⌘+Enter trong ô nhận xét gửi đánh giá; lúc bộ gõ đang chốt chữ thì không', async () => {
    await openForm();
    const box = screen.getByLabelText('Nội dung đánh giá');
    expect(box).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
    fireEvent.change(box, { target: { value: 'Dùng êm' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true, keyCode: 229 });
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 13 });
    expect(mocks.createReview).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true, keyCode: 13 });
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(1));
    expect(mocks.createReview.mock.calls[0]![1]).toMatchObject({ rating: 5, comment: 'Dùng êm', orderId: 'o1' });
  });

  it('bấm Gửi hai lần cùng nhịp, thêm Ctrl+Enter: chỉ một lời gọi', async () => {
    mocks.createReview.mockImplementation(() => new Promise(() => {}));
    await openForm();
    const send = screen.getByRole('button', { name: 'Gửi đánh giá' });
    fireEvent.click(send);
    fireEvent.click(send);
    fireEvent.keyDown(screen.getByLabelText('Nội dung đánh giá'), { key: 'Enter', ctrlKey: true, keyCode: 13 });
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.createReview).toHaveBeenCalledTimes(1);
  });

  it('máy chủ báo lỗi: câu lỗi trong form (role=alert) được focus, không qua snackbar; gửi lại được', async () => {
    const err = Object.assign(new Error('Request failed with status code 400'), {
      isAxiosError: true,
      response: { status: 400, data: { message: 'Đơn này chưa giao tới bạn nên chưa đánh giá được.' } },
    });
    mocks.createReview.mockRejectedValueOnce(err);
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(getErrorMessage(err));
    await waitFor(() => expect(alert).toHaveFocus());
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('nhận xét quá 2.000 ký tự (chữ dán, nháp cũ): chặn gửi, lỗi dưới ô (role=alert), ô được focus và aria-invalid; sửa ngắn lại thì hết lỗi', async () => {
    await openForm();
    const box = screen.getByLabelText('Nội dung đánh giá');
    fireEvent.change(box, { target: { value: 'a'.repeat(2001) } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nhận xét tối đa 2.000 ký tự, bạn đang có 2.001 ký tự.');
    expect(box).toHaveFocus();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box.getAttribute('aria-describedby')).toBe(alert.id);
    expect(mocks.createReview).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: 'Dùng êm' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(box).not.toHaveAttribute('aria-invalid');
  });

  it('đánh giá cũ lưu số sao ngoài 1–5: điểm dừng Tab ở sao đầu; gửi thì chặn, lỗi dưới hàng sao, focus sao đầu; chọn sao thì hết lỗi', async () => {
    mocks.canReview.mockResolvedValue(ELIG_ALL);
    mocks.fetchMyReview.mockResolvedValue({ ...MINE_B, rating: 0 });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' }));
    const group = await screen.findByRole('radiogroup', { name: 'Số sao' });
    expect(tabStops(group)).toEqual([0, -1, -1, -1, -1]);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu đánh giá' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Chọn từ 1 đến 5 sao để gửi đánh giá.');
    expect(star(group, 1)).toHaveFocus();
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group.getAttribute('aria-describedby')).toBe(alert.id);
    expect(mocks.createReview).not.toHaveBeenCalled();
    fireEvent.click(star(group, 4));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu đánh giá' }));
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(1));
    expect(mocks.createReview.mock.calls[0]![1]).toMatchObject({ rating: 4 });
  });
});

describe('ReviewsSection: tải ảnh và gửi đánh giá không chồng nhau (W85A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cloudinary = true;
    mocks.auth = { status: 'authenticated' };
    mocks.fetchReviews.mockResolvedValue(DATA);
    mocks.canReview.mockResolvedValue(ELIG_NEW);
    mocks.createReview.mockReset().mockResolvedValue({ updated: false, pointsEarned: 0 });
  });

  const openForm = async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    await screen.findByRole('radiogroup', { name: 'Số sao' });
  };

  it('đang tải ảnh: nút gửi khoá và đổi nhãn, bấm hay Ctrl+Enter đều không gọi createReview; tải xong gửi kèm ảnh vừa tải', async () => {
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu tải ảnh thử' }));
    const waiting = screen.getByRole('button', { name: 'Đang tải ảnh…' });
    expect(waiting).toBeDisabled();
    fireEvent.click(waiting);
    fireEvent.keyDown(screen.getByPlaceholderText(/Chia sẻ cảm nhận/), { key: 'Enter', ctrlKey: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.createReview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Tải xong ảnh thử' }));
    const send = await screen.findByRole('button', { name: 'Gửi đánh giá' });
    expect(send).not.toBeDisabled();
    fireEvent.click(send);
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(1));
    expect(mocks.createReview.mock.calls[0]![1]).toMatchObject({ images: ['https://i/xong.jpg'], orderId: 'o1' });
  });

  it('đang tải cả ảnh lẫn video: nhãn nói video, xong video mà ảnh còn tải thì vẫn khoá, xong cả hai mới gửi được', async () => {
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu tải ảnh thử' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu tải video thử' }));
    expect(screen.getByRole('button', { name: 'Đang tải video…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Tải xong video thử' }));
    expect(screen.getByRole('button', { name: 'Đang tải ảnh…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Tải xong ảnh thử' }));
    expect(await screen.findByRole('button', { name: 'Gửi đánh giá' })).not.toBeDisabled();
  });

  it('đang gửi thì form không đóng được (không có nút Đóng): lần gửi chưa xong thì không mở lại được để gửi lần hai', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.createReview.mockReturnValue(new Promise((r) => (release = r)));
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Đóng' })).toBeNull());
    expect(screen.getByRole('radiogroup', { name: 'Số sao' })).toBeInTheDocument();
    await act(async () => release({ updated: false, pointsEarned: 0 }));
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());
    expect(mocks.createReview).toHaveBeenCalledTimes(1);
  });

  it('đang tải ảnh: form không đóng được (không có nút Đóng, Esc không đóng), nên không mở lại được form mới để gửi thiếu ảnh; tải xong thì đóng được và nháp còn ảnh', async () => {
    await openForm();
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu tải ảnh thử' }));
    expect(screen.queryByRole('button', { name: 'Đóng' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('radiogroup', { name: 'Số sao' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tải xong ảnh thử' }));
    expect(await screen.findByRole('button', { name: 'Đóng' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    expect(await screen.findByRole('button', { name: 'Thêm ảnh (1)' })).toBeInTheDocument();
  });

  it('đang gửi: ô thêm ảnh và nút xoá ảnh khoá, không đổi danh sách ảnh của lần đang gửi', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.createReview.mockReturnValue(new Promise((r) => (release = r)));
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ảnh (0)' }));
    expect(screen.getByRole('button', { name: 'Xoá ảnh thử' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Thêm ảnh (1)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Xoá ảnh thử' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Đang tải ảnh…' })).toBeNull();
    await act(async () => release({ updated: false, pointsEarned: 0 }));
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());
  });

  it('đang tải video: form không đóng được (không có nút Đóng, Esc không đóng), nên không mở lại được form mới để gửi thiếu video; tải xong thì đóng được và nháp còn video (W90A)', async () => {
    await openForm();
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu tải video thử' }));
    expect(screen.queryByRole('button', { name: 'Đóng' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('radiogroup', { name: 'Số sao' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đang tải video…' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Tải xong video thử' }));
    expect(await screen.findByRole('button', { name: 'Đóng' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    expect(await screen.findByRole('button', { name: 'Chọn video thử (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi đánh giá' })).not.toBeDisabled();
  });

  it('video và ảnh cùng đang tải: form chỉ đóng được khi cả hai xong (W90A)', async () => {
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu tải video thử' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu tải ảnh thử' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tải xong video thử' }));
    expect(screen.queryByRole('button', { name: 'Đóng' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tải xong ảnh thử' }));
    expect(await screen.findByRole('button', { name: 'Đóng' })).toBeInTheDocument();
  });

  it('đang gửi: ô chọn video khoá, không đổi video của lần đang gửi (W90A)', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.createReview.mockReturnValue(new Promise((r) => (release = r)));
    await openForm();
    expect(screen.getByRole('button', { name: 'Chọn video thử (0)' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Chọn video thử (0)' })).toBeDisabled();
    await act(async () => release({ updated: false, pointsEarned: 0 }));
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());
  });

  it('gửi lỗi: form vẫn mở để thấy lỗi tại chỗ, nút Đóng trở lại và gửi lại được', async () => {
    mocks.createReview.mockRejectedValueOnce(new Error('mạng')).mockResolvedValueOnce({ updated: false, pointsEarned: 0 });
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Có chút trục trặc, thử lại nhé');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());
  });
});

describe('ReviewsSection: máy chủ từ chối thì tải lại can-review và giữ khoá tới khi dữ liệu mới về (W110A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cloudinary = true;
    mocks.auth = { status: 'authenticated' };
    mocks.fetchReviews.mockResolvedValue(DATA);
    mocks.canReview.mockReset().mockResolvedValue(ELIG_NEW);
    mocks.fetchMyReview.mockReset().mockImplementation(async (id: string) => MYREVIEWS[id]);
    mocks.createReview.mockReset().mockResolvedValue({ updated: false, pointsEarned: 0 });
  });

  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message } } as never);
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
  const sendButton = (name = 'Gửi đánh giá') => screen.getByRole('button', { name });
  const openNewForm = async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
    await screen.findByRole('radiogroup', { name: 'Số sao' });
  };
  /** Khách đã gõ xong: 3 sao, một dòng nhận xét, một ảnh. */
  const fillDraft = () => {
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Số sao' })).getByRole('radio', { name: '3 sao' }));
    fireEvent.change(screen.getByPlaceholderText(/Chia sẻ cảm nhận/), { target: { value: 'Dùng khá ổn' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ảnh (0)' }));
  };
  const expectDraftKept = () => {
    expect(within(screen.getByRole('radiogroup', { name: 'Số sao' })).getByRole('radio', { name: '3 sao' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByPlaceholderText(/Chia sẻ cảm nhận/)).toHaveValue('Dùng khá ổn');
    expect(screen.getByRole('button', { name: 'Thêm ảnh (1)' })).toBeInTheDocument();
  };

  it.each([
    [400, 'Đơn này đã trả hàng nên không đánh giá mới được.'],
    [400, 'Đơn này chưa giao tới bạn hoặc không có sản phẩm này nên chưa đánh giá được.'],
    [409, 'Không lưu được đánh giá do thao tác đồng thời, bạn thử lại nhé.'],
    [404, 'Không tìm thấy đánh giá.'],
  ])('bị từ chối %i "%s": một lời lỗi, can-review và danh sách tải lại, nút Gửi bận và không gửi lần hai tới khi dữ liệu về; nháp còn nguyên', async (status, message) => {
    const refresh = deferred();
    mocks.canReview.mockResolvedValueOnce(ELIG_NEW).mockReturnValueOnce(refresh.promise);
    mocks.createReview.mockRejectedValueOnce(serverError(message, status)).mockResolvedValueOnce({ updated: false, pointsEarned: 5 });
    await openNewForm();
    fillDraft();
    fireEvent.click(sendButton());

    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(message);
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    await waitFor(() => expect(mocks.canReview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.fetchReviews.mock.calls.length).toBeGreaterThanOrEqual(2));

    expect(sendButton()).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('button', { name: 'Đóng' })).toBeNull();
    await act(async () => {
      fireEvent.click(sendButton());
      fireEvent.keyDown(screen.getByPlaceholderText(/Chia sẻ cảm nhận/), { key: 'Enter', ctrlKey: true });
    });
    await settle();
    expect(mocks.createReview).toHaveBeenCalledTimes(1);
    expectDraftKept();

    await act(async () => refresh.resolve(ELIG_NEW));
    await waitFor(() => expect(sendButton()).not.toHaveAttribute('aria-busy'));
    expectDraftKept();
    expect(screen.getAllByRole('alert')).toHaveLength(1);

    fireEvent.click(sendButton());
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(2));
    expect(mocks.createReview.mock.calls[1]![1]).toMatchObject({ rating: 3, comment: 'Dùng khá ổn', images: ['https://i/moi.jpg'], orderId: 'o1' });
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Cảm ơn đánh giá của bạn! Đã cộng 5 Điểm Xanh', type: 'success' }));
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());
  });

  it('đơn đã trả hàng nên can-review về hết đơn: nút đầu mục và lý do đổi theo dữ liệu mới, form vẫn mở với lời máy chủ và nháp của khách', async () => {
    mocks.canReview.mockResolvedValueOnce(ELIG_NEW).mockResolvedValueOnce({ canReview: false, reason: 'NOT_PURCHASED' });
    mocks.createReview.mockRejectedValueOnce(serverError('Đơn này đã trả hàng nên không đánh giá mới được.', 400));
    await openNewForm();
    fillDraft();
    fireEvent.click(sendButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Đơn này đã trả hàng nên không đánh giá mới được.');
    await waitFor(() => expect(sendButton()).not.toHaveAttribute('aria-busy'));
    expect(screen.getByText('Mua và nhận hàng để đánh giá')).toBeInTheDocument();
    expect(screen.queryByText('Viết đánh giá', { selector: 'button *' })).toBeNull();
    expectDraftKept();
    expect(screen.getByRole('alert')).toHaveTextContent('Đơn này đã trả hàng nên không đánh giá mới được.');
  });

  it('sửa đánh giá bị từ chối 409: tải lại can-review, danh sách và đánh giá đang sửa; sao khách vừa đổi không bị dữ liệu mới ghi đè', async () => {
    mocks.canReview.mockResolvedValue(ELIG_ALL);
    mocks.createReview.mockRejectedValueOnce(serverError('Không lưu được đánh giá do thao tác đồng thời, bạn thử lại nhé.', 409));
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa đánh giá của bạn' }));
    const group = await screen.findByRole('radiogroup', { name: 'Số sao' });
    await screen.findByPlaceholderText(/Chia sẻ cảm nhận/);
    fireEvent.click(within(group).getByRole('radio', { name: '2 sao' }));
    fireEvent.click(sendButton('Lưu đánh giá'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không lưu được đánh giá do thao tác đồng thời, bạn thử lại nhé.');
    await waitFor(() => expect(mocks.canReview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.fetchMyReview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(sendButton('Lưu đánh giá')).not.toHaveAttribute('aria-busy'));
    expect(within(screen.getByRole('radiogroup', { name: 'Số sao' })).getByRole('radio', { name: '2 sao' })).toHaveAttribute('aria-checked', 'true');
  });

  it.each([
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
  ])('%s: không nói gì về trạng thái thật nên không tải lại, khoá nhả ngay và gửi lại được', async (_label, error) => {
    mocks.createReview.mockRejectedValueOnce(error).mockResolvedValueOnce({ updated: false, pointsEarned: 0 });
    await openNewForm();
    fillDraft();
    fireEvent.click(sendButton());
    expect(await screen.findAllByRole('alert')).toHaveLength(1);
    await waitFor(() => expect(sendButton()).not.toHaveAttribute('aria-busy'));
    await settle();
    expect(mocks.canReview).toHaveBeenCalledTimes(1);
    expectDraftKept();
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();

    fireEvent.click(sendButton());
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Số sao' })).toBeNull());
  });

  it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS (đồng hồ giả), rồi gửi lại được', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mocks.canReview.mockResolvedValueOnce(ELIG_NEW).mockReturnValueOnce(new Promise(() => undefined));
      mocks.createReview.mockRejectedValueOnce(serverError('Đơn này chưa giao tới bạn hoặc không có sản phẩm này nên chưa đánh giá được.', 400)).mockResolvedValueOnce({ updated: false, pointsEarned: 0 });
      await openNewForm();
      fillDraft();
      fireEvent.click(sendButton());
      expect(await screen.findByRole('alert')).toHaveTextContent('Đơn này chưa giao tới bạn');
      await waitFor(() => expect(mocks.canReview).toHaveBeenCalledTimes(2));
      expect(sendButton()).toHaveAttribute('aria-busy', 'true');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 1_000);
      });
      expect(sendButton()).toHaveAttribute('aria-busy', 'true');
      await act(async () => {
        fireEvent.click(sendButton());
      });
      expect(mocks.createReview).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_100);
      });
      await waitFor(() => expect(sendButton()).not.toHaveAttribute('aria-busy'));
      expectDraftKept();
      fireEvent.click(sendButton());
      await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it('chạm đúp "Gửi đánh giá" trong cùng một khung hình chỉ gọi createReview một lần, kể cả khi lần đó bị từ chối', async () => {
    const refresh = deferred();
    const first = deferred();
    mocks.canReview.mockResolvedValueOnce(ELIG_NEW).mockReturnValueOnce(refresh.promise);
    mocks.createReview.mockReturnValueOnce(first.promise);
    await openNewForm();
    const send = sendButton();
    act(() => {
      send.click();
      send.click();
    });
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(1));
    await settle();
    expect(mocks.createReview).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve(Promise.reject(serverError('Không lưu được đánh giá do thao tác đồng thời, bạn thử lại nhé.', 409))));
    await waitFor(() => expect(mocks.canReview).toHaveBeenCalledTimes(2));
    await act(async () => {
      sendButton().click();
    });
    await settle();
    expect(mocks.createReview).toHaveBeenCalledTimes(1);
    await act(async () => refresh.resolve(ELIG_NEW));
    await waitFor(() => expect(sendButton()).not.toHaveAttribute('aria-busy'));
  });
});
