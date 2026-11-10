import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ZmpUi from 'zmp-ui';
import type { ReviewsSection as ReviewsSectionComponent } from './reviews-section';

// Ô video THẬT (không giả): kiểm hợp đồng giữa VideoUpload và form đánh giá, gồm cả lúc Cloudinary im và form phải tự gỡ khoá.
const mocks = vi.hoisted(() => ({
  fetchReviews: vi.fn(),
  createReview: vi.fn(),
  canReview: vi.fn(),
  fetchMyReview: vi.fn(),
  login: vi.fn(),
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
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ status: 'authenticated', login: mocks.login }) }));
vi.mock('./ui/auth-gate', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useLoginWithNotice: () => mocks.login }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

const DATA = { count: 0, average: 0, videoCount: 0, distribution: {}, items: [] };
const ELIG = {
  canReview: true,
  reason: null,
  rewardAvailable: true,
  purchaseCount: 1,
  reviewableOrders: [{ orderId: 'o1', code: 'TB0001', deliveredAt: '2026-08-01T00:00:00.000Z' }],
  myReviews: [],
};
const VIDEO_URL = 'https://res.cloudinary.com/demo/v.mp4';

// Cấu hình Cloudinary chốt lúc nạp module nên nạp một lần cho cả file (nạp lại mỗi ca vừa chậm vừa dễ quá hạn).
let ReviewsSection: typeof ReviewsSectionComponent;
beforeAll(async () => {
  vi.stubEnv('VITE_CLOUDINARY_CLOUD_NAME', 'demo');
  vi.stubEnv('VITE_CLOUDINARY_UPLOAD_PRESET', 'unsigned');
  vi.resetModules();
  ({ ReviewsSection } = await import('./reviews-section'));
}, 60_000);
afterAll(() => vi.unstubAllEnvs());

async function openForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <ReviewsSection slug="nuoc-rua-chen" />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Viết đánh giá' }));
  await screen.findByRole('radiogroup', { name: 'Số sao' });
  const videoInput = () => utils.container.ownerDocument.querySelector('input[type="file"][accept="video/*"]') as HTMLInputElement;
  const pickVideo = () => fireEvent.change(videoInput(), { target: { files: [new File(['x'], 'v.mp4', { type: 'video/mp4' })] } });
  return { ...utils, pickVideo };
}
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe('ReviewsSection với ô video thật: tải video và gửi đánh giá không chồng nhau (W90A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchReviews.mockResolvedValue(DATA);
    mocks.canReview.mockResolvedValue(ELIG);
    mocks.createReview.mockReset().mockResolvedValue({ updated: false, pointsEarned: 0 });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('video đang lên: form không đóng được và Gửi chờ; tải xong thì đóng được, gửi kèm đúng URL video', async () => {
    let finish!: (res: unknown) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(new Promise((resolve) => (finish = resolve))));
    const m = await openForm();
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();

    m.pickVideo();
    // Ô chọn video cũng mang tên "Đang tải video…", nên nút Gửi tìm theo lớp của nút ZaUI.
    const sendButton = () =>
      screen.getAllByRole('button', { name: 'Đang tải video…' }).find((b) => b.classList.contains('zaui-btn')) as HTMLButtonElement;
    await waitFor(() => expect(sendButton()).toBeDisabled());
    const send = sendButton();
    expect(screen.queryByRole('button', { name: 'Đóng' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('radiogroup', { name: 'Số sao' })).toBeInTheDocument();
    fireEvent.click(send);
    expect(mocks.createReview).not.toHaveBeenCalled();

    await act(async () => finish({ ok: true, json: async () => ({ secure_url: VIDEO_URL, duration: 12 }) }));
    const ready = await screen.findByRole('button', { name: 'Gửi đánh giá' });
    expect(ready).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();
    fireEvent.click(ready);
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(1));
    expect(mocks.createReview.mock.calls[0]![1]).toMatchObject({ videoUrl: VIDEO_URL, orderId: 'o1' });
  });

  it('Cloudinary im quá 180 giây: video bị huỷ, form tự mở lại (nút Đóng và Gửi trở lại, lỗi hiện tại chỗ) và gửi được không kèm video', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    vi.stubGlobal('fetch', fetchMock);
    const m = await openForm();
    vi.useFakeTimers();
    await act(async () => {
      m.pickVideo();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Đóng' })).toBeNull();

    await advance(179_999);
    expect(screen.queryByRole('button', { name: 'Đóng' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gửi đánh giá' })).toBeNull();

    await advance(1);
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi đánh giá' })).toBeEnabled();
    expect(screen.getByRole('alert').textContent).toBe('Tải video thất bại, thử lại.');

    vi.useRealTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledTimes(1));
    expect(mocks.createReview.mock.calls[0]![1].videoUrl).toBeUndefined();
  });
});
