import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RefillSummary } from '../services/refill-api';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getRefillSummary: vi.fn(),
  returnBottles: vi.fn(),
  callPhone: vi.fn(),
  haptic: vi.fn(),
  keySeq: 0,
  auth: { status: 'authenticated' as 'loading' | 'authenticated' | 'anonymous' },
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/refill', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/refill-api', () => ({
  getRefillSummary: mocks.getRefillSummary,
  returnBottles: mocks.returnBottles,
}));
vi.mock('../services/api', () => ({ getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi') }));
vi.mock('../services/zmp-bridge', () => ({ callPhone: mocks.callPhone }));
vi.mock('../components/support-contact', () => ({ SupportContact: () => <div data-testid="support-contact" /> }));
vi.mock('../utils/haptic', () => ({ haptic: mocks.haptic }));
vi.mock('../utils/idempotency', () => ({ newIdempotencyKey: () => `key-${++mocks.keySeq}` }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { status: mocks.auth.status };
    return sel ? sel(state) : state;
  },
}));

import RefillPage from './refill';

const CREATED_AT = '2026-03-15T09:00:00.000Z';
// Ngày theo dd/MM/yyyy cố định (formatDate), không phụ thuộc ICU của máy chạy test.
const CREATED_DATE = '15/03/2026';

const SUMMARY = (over: Partial<RefillSummary> = {}): RefillSummary => ({
  perBottle: 10,
  monthlyCap: 5,
  monthlyUsed: 2,
  monthlyRemaining: 3,
  totalRecycled: 12,
  history: [],
  ...over,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={qc}>
      <RefillPage />
    </QueryClientProvider>,
  );
  return { ...utils, invalidate };
}

/** Nút của bộ đổi vỏ theo thứ tự trên trang: [giảm, tăng, gửi]; bỏ nút Quay lại nổi của PageHeader. */
const controls = () => {
  const [minus, plus, submit] = screen
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-label') !== 'Quay lại' && !/Vườn Cây Tubu|Thử lại/.test(b.textContent ?? ''));
  return { minus: minus!, plus: plus!, submit: submit! };
};

const pageText = (container: HTMLElement) => container.textContent ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.keySeq = 0;
  mocks.auth.status = 'authenticated';
  mocks.getRefillSummary.mockResolvedValue(SUMMARY());
  mocks.returnBottles.mockResolvedValue({
    id: 'r1',
    quantity: 1,
    seedsAwarded: 10,
    status: 'PENDING',
    monthlyRemaining: 2,
    totalRecycled: 12,
  });
});

describe('RefillPage — hành vi giữ nguyên khi chuyển DS v2', () => {
  it('hiện số vỏ đã tái chế, lượt còn lại trong tháng và nước nhận cho 1 vỏ', async () => {
    const { container } = renderPage();
    expect(await screen.findByText('vỏ đã tái chế')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('còn đổi được tháng này')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(pageText(container)).toContain('Nhận 10💧 (10💧 / vỏ)');
  });

  it('chỉ lấy dữ liệu khi đã đăng nhập', async () => {
    mocks.auth.status = 'anonymous';
    const { container } = renderPage();
    expect(await screen.findByText('Đăng nhập để đổi vỏ lấy nước.')).toBeInTheDocument();
    expect(mocks.getRefillSummary).not.toHaveBeenCalled();
    expect(pageText(container)).toContain('Nhận 0💧 (0💧 / vỏ)');
    expect(screen.getByRole('button', { name: 'Đã hết lượt đổi tháng này' })).toBeDisabled();
  });

  it('tăng/giảm số vỏ trong khoảng 1..còn lại và nước nhận đổi theo', async () => {
    const { container } = renderPage();
    await screen.findByText('vỏ đã tái chế');
    for (let i = 0; i < 5; i++) fireEvent.click(controls().plus);
    expect(pageText(container)).toContain('Nhận 30💧 (10💧 / vỏ)');
    fireEvent.click(controls().minus);
    expect(pageText(container)).toContain('Nhận 20💧 (10💧 / vỏ)');
    for (let i = 0; i < 5; i++) fireEvent.click(controls().minus);
    expect(pageText(container)).toContain('Nhận 10💧 (10💧 / vỏ)');
  });

  it('còn 0 lượt: nút đổi vẫn khoá, nhãn "Đã hết lượt đổi tháng này", không gửi được', async () => {
    mocks.getRefillSummary.mockResolvedValue(SUMMARY({ monthlyRemaining: 0, monthlyUsed: 5 }));
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Đã hết lượt đổi tháng này' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(mocks.returnBottles).not.toHaveBeenCalled();
  });

  it('gửi yêu cầu: đúng số vỏ + Idempotency-Key, báo thành công, về 1 vỏ và tải lại refill/garden/game', async () => {
    const { invalidate } = renderPage();
    await screen.findByText('vỏ đã tái chế');
    fireEvent.click(controls().plus);
    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu đổi vỏ' }));
    await waitFor(() => expect(mocks.returnBottles).toHaveBeenCalledTimes(1));
    expect(mocks.returnBottles).toHaveBeenCalledWith(2, expect.stringMatching(/^key-\d+$/));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({
        text: 'Đã gửi yêu cầu! Mang vỏ chai đến điểm nhận để nhân viên đối chiếu và duyệt.',
        type: 'success',
      }),
    );
    expect(mocks.haptic).toHaveBeenCalledWith('heavy');
    const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
    expect(keys).toEqual(expect.arrayContaining(['refill', 'garden', 'game']));
    await waitFor(() => expect(mocks.getRefillSummary).toHaveBeenCalledTimes(2));
  });

  it('thành công thì lệnh sau dùng key mới; lỗi mạng thì thử lại giữ nguyên key', async () => {
    mocks.returnBottles.mockRejectedValueOnce(new Error('mất mạng'));
    renderPage();
    await screen.findByText('vỏ đã tái chế');
    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu đổi vỏ' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'mất mạng', type: 'error' }));

    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu đổi vỏ' }));
    await waitFor(() => expect(mocks.returnBottles).toHaveBeenCalledTimes(2));
    const keyOf = (n: number) => mocks.returnBottles.mock.calls[n]![1] as string;
    expect(keyOf(1)).toBe(keyOf(0));

    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu đổi vỏ' }));
    await waitFor(() => expect(mocks.returnBottles).toHaveBeenCalledTimes(3));
    expect(keyOf(2)).not.toBe(keyOf(0));
  });

  it('lỗi khi gửi: giữ số vỏ đang chọn', async () => {
    mocks.returnBottles.mockRejectedValueOnce(new Error('Hết lượt'));
    const { container } = renderPage();
    await screen.findByText('vỏ đã tái chế');
    fireEvent.click(controls().plus);
    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu đổi vỏ' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Hết lượt', type: 'error' }));
    expect(pageText(container)).toContain('Nhận 20💧 (10💧 / vỏ)');
  });

  it('đang gửi: bấm lại không gửi thêm', async () => {
    mocks.returnBottles.mockReturnValue(new Promise(() => {}));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Gửi yêu cầu đổi vỏ' }));
    await waitFor(() => expect(mocks.returnBottles).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu đổi vỏ' }));
    expect(mocks.returnBottles).toHaveBeenCalledTimes(1);
  });

  it('lịch sử: số vỏ + ngày và nhãn trạng thái cho từng lượt; không có lịch sử thì không hiện khối', async () => {
    mocks.getRefillSummary.mockResolvedValue(
      SUMMARY({
        history: [
          { id: 'h1', quantity: 2, seedsAwarded: 0, status: 'PENDING', createdAt: CREATED_AT },
          { id: 'h2', quantity: 3, seedsAwarded: 30, status: 'APPROVED', createdAt: CREATED_AT },
          { id: 'h3', quantity: 1, seedsAwarded: 0, status: 'REJECTED', createdAt: CREATED_AT },
        ],
      }),
    );
    const first = renderPage();
    expect(await screen.findByText('Lịch sử đổi vỏ')).toBeInTheDocument();
    expect(screen.getByText(`2 vỏ · ${CREATED_DATE}`)).toBeInTheDocument();
    expect(screen.getByText(`3 vỏ · ${CREATED_DATE}`)).toBeInTheDocument();
    expect(screen.getByText(`1 vỏ · ${CREATED_DATE}`)).toBeInTheDocument();
    expect(screen.getByText('Chờ duyệt')).toBeInTheDocument();
    expect(screen.getByText('+30💧')).toBeInTheDocument();
    expect(screen.getByText('Từ chối')).toBeInTheDocument();
    first.unmount();

    mocks.getRefillSummary.mockResolvedValue(SUMMARY());
    renderPage();
    await screen.findByText('vỏ đã tái chế');
    expect(screen.queryByText('Lịch sử đổi vỏ')).not.toBeInTheDocument();
  });

  it('thẻ Vườn Cây Tubu sang /game', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Vườn Cây Tubu'));
    expect(mocks.navigate).toHaveBeenCalledWith('/game');
    expect(screen.getByText('Dùng giọt nước tích luỹ để chăm cây và đổi quà thật')).toBeInTheDocument();
  });

  it('lỗi tải: báo lỗi và Thử lại tải lại', async () => {
    mocks.getRefillSummary.mockRejectedValueOnce(new Error('mất mạng')).mockResolvedValue(SUMMARY());
    renderPage();
    expect(await screen.findByText('mất mạng')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('vỏ đã tái chế')).toBeInTheDocument();
  });
});

describe('RefillPage — tiêu đề, vùng chạm, bàn phím (C-076, C-114)', () => {
  it('có đúng một h1 "Đổi vỏ chai — Nhận nước" ở đang tải, lỗi và đã tải', async () => {
    mocks.getRefillSummary.mockReturnValue(new Promise(() => {}));
    const loading = renderPage();
    expect(loading.container.querySelectorAll('h1')).toHaveLength(1);
    loading.unmount();

    mocks.getRefillSummary.mockRejectedValue(new Error('mất mạng'));
    const failed = renderPage();
    await screen.findByText('mất mạng');
    expect(failed.container.querySelectorAll('h1')).toHaveLength(1);
    failed.unmount();

    mocks.getRefillSummary.mockResolvedValue(SUMMARY());
    const loaded = renderPage();
    await screen.findByText('vỏ đã tái chế');
    expect(loaded.container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Đổi vỏ chai — Nhận nước');
  });

  it('mọi nút (giảm, tăng, gửi, thẻ Vườn Cây) có vùng chạm >= 44px', async () => {
    renderPage();
    await screen.findByText('vỏ đã tái chế');
    const buttons = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-label') !== 'Quay lại');
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const b of buttons) {
      const h = Number.parseFloat(b.style.minHeight || b.style.height);
      expect(h, b.outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(44);
    }
  });

  it('nút tăng/giảm có tên truy cập', async () => {
    renderPage();
    await screen.findByText('vỏ đã tái chế');
    expect(screen.getByRole('button', { name: 'Giảm số lượng' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tăng số lượng' })).toBeInTheDocument();
  });

  it('thẻ Vườn Cây Tubu dùng được bằng bàn phím', async () => {
    renderPage();
    const link = (await screen.findByText('Vườn Cây Tubu')).closest('[role="button"]') as HTMLElement | null;
    expect(link).not.toBeNull();
    expect(link!.tabIndex).toBe(0);
    fireEvent.keyDown(link!, { key: 'Enter' });
    expect(mocks.navigate).toHaveBeenCalledWith('/game');
  });
});

// ENGAGE-13: trang chỉ nói "mang vỏ đến cửa hàng" không có địa chỉ/giờ, và yêu cầu "Chờ duyệt" không có bước tiếp theo.
describe('RefillPage — điểm nhận vỏ và bước tiếp theo (ENGAGE-13)', () => {
  const PICKUP = { address: '12 Nguyễn Huệ, Q.1, TP.HCM', hours: '8h–20h hằng ngày', phone: '0899 149 229' };

  it('hiện địa chỉ, giờ mở cửa và nút gọi SĐT điểm nhận khi admin đã cấu hình', async () => {
    mocks.getRefillSummary.mockResolvedValue(SUMMARY({ pickup: PICKUP }));
    renderPage();
    expect(await screen.findByText('Điểm nhận vỏ')).toBeInTheDocument();
    expect(screen.getByText('12 Nguyễn Huệ, Q.1, TP.HCM')).toBeInTheDocument();
    expect(screen.getByText('8h–20h hằng ngày')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Gọi 0899 149 229/ }));
    expect(mocks.callPhone).toHaveBeenCalledWith('0899 149 229');
    expect(screen.queryByTestId('support-contact')).toBeNull();
  });

  it('chỉ có một phần thông tin → chỉ hiện phần đó', async () => {
    mocks.getRefillSummary.mockResolvedValue(SUMMARY({ pickup: { address: null, hours: '8h–20h', phone: null } }));
    renderPage();
    expect(await screen.findByText('8h–20h')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gọi/ })).toBeNull();
  });

  it('chưa cấu hình điểm nhận → nói thật là app chưa có địa chỉ và đưa kênh liên hệ để hỏi', async () => {
    mocks.getRefillSummary.mockResolvedValue(SUMMARY({ pickup: { address: null, hours: null, phone: null } }));
    renderPage();
    expect(await screen.findByText(/Chưa có địa chỉ điểm nhận trên app/)).toBeInTheDocument();
    expect(screen.getByTestId('support-contact')).toBeInTheDocument();
  });

  it('API cũ không trả pickup → cũng rơi về hướng dẫn liên hệ', async () => {
    renderPage();
    expect(await screen.findByText(/Chưa có địa chỉ điểm nhận trên app/)).toBeInTheDocument();
  });

  it('có yêu cầu Chờ duyệt → nói rõ bước tiếp theo: mang đúng số vỏ đến điểm nhận để nhân viên đối chiếu', async () => {
    mocks.getRefillSummary.mockResolvedValue(
      SUMMARY({
        history: [
          { id: 'h1', quantity: 2, seedsAwarded: 20, status: 'PENDING', createdAt: CREATED_AT },
          { id: 'h2', quantity: 1, seedsAwarded: 10, status: 'PENDING', createdAt: CREATED_AT },
        ],
      }),
    );
    renderPage();
    expect(await screen.findByText(/Bạn có 3 vỏ chai đang chờ duyệt/)).toBeInTheDocument();
    expect(screen.getByText(/nhân viên đối chiếu số vỏ rồi duyệt/)).toBeInTheDocument();
  });

  it('không có yêu cầu nào chờ duyệt → không hiện hộp bước tiếp theo', async () => {
    mocks.getRefillSummary.mockResolvedValue(
      SUMMARY({ history: [{ id: 'h2', quantity: 3, seedsAwarded: 30, status: 'APPROVED', createdAt: CREATED_AT }] }),
    );
    renderPage();
    await screen.findByText('Lịch sử đổi vỏ');
    expect(screen.queryByText(/đang chờ duyệt/)).toBeNull();
  });

  it('nhân viên ghi nhận ít vỏ hơn khai → lịch sử nói "nhận 2/3 vỏ"', async () => {
    mocks.getRefillSummary.mockResolvedValue(
      SUMMARY({
        history: [{ id: 'h1', quantity: 2, seedsAwarded: 20, status: 'APPROVED', createdAt: CREATED_AT, declaredQuantity: 3 }],
      }),
    );
    renderPage();
    expect(await screen.findByText('Nhận 2/3 vỏ')).toBeInTheDocument();
  });

  it('bị từ chối có lý do → hiện lý do dưới dòng lịch sử', async () => {
    mocks.getRefillSummary.mockResolvedValue(
      SUMMARY({
        history: [{ id: 'h1', quantity: 1, seedsAwarded: 0, status: 'REJECTED', createdAt: CREATED_AT, rejectionReason: 'Vỏ chưa rửa sạch' }],
      }),
    );
    renderPage();
    expect(await screen.findByText('Lý do: Vỏ chưa rửa sạch')).toBeInTheDocument();
  });
});
