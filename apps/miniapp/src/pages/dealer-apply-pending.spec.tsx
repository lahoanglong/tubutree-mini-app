import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDealerMe: vi.fn(),
  applyDealer: vi.fn(),
  openSnackbar: vi.fn(),
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/dealer', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/dealer-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDealerMe: mocks.getDealerMe,
  applyDealer: mocks.applyDealer,
}));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, dealer: { maxDiscountPct: 0.45, reviewHours: 24 } }) }));
vi.mock('../components/image-upload', () => ({
  ImageUpload: ({ label, onChange }: { label: string; onChange: (u: string) => void }) => (
    <button type="button" onClick={() => onChange('data:image/jpeg;base64,AA')}>{label}</button>
  ),
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { HttpError } from '../services/http';
import DealerPage from './dealer';

const NONE = { isDealer: false, status: null, tier: null, currentDebt: 0 };

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DealerPage /></QueryClientProvider>);
}

async function fillForm() {
  await screen.findByText('Gửi hồ sơ đăng ký');
  const boxes = screen.getAllByRole('textbox');
  boxes.forEach((b, i) => fireEvent.change(b, { target: { value: i === 1 ? '' : `giá trị ${i}` } }));
  fireEvent.click(screen.getByText('Ảnh CCCD mặt trước *'));
  fireEvent.click(screen.getByText('Ảnh CCCD mặt sau *'));
  return screen.getByRole('button', { name: 'Gửi hồ sơ đăng ký' });
}

async function fillAndSubmit() {
  fireEvent.click(await fillForm());
}

describe('DealerPage gửi lại hồ sơ sau khi mất phản hồi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('API trả DEALER_APPLICATION_PENDING: làm mới dealer-me và sang màn chờ duyệt', async () => {
    mocks.getDealerMe.mockResolvedValueOnce(NONE).mockResolvedValue({ ...NONE, status: 'PENDING' });
    mocks.applyDealer.mockRejectedValue(
      new HttpError('x', 'ERR_BAD_REQUEST', {
        status: 400,
        data: { code: 'DEALER_APPLICATION_PENDING', message: 'Bạn đã có đơn đăng ký đang chờ duyệt.' },
        headers: {},
      }),
    );
    renderPage();
    await fillAndSubmit();
    await waitFor(() => expect(mocks.applyDealer).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Hồ sơ đang được duyệt')).toBeInTheDocument();
    expect(mocks.getDealerMe).toHaveBeenCalledTimes(2);
    // Hồ sơ đã được nhận: báo bằng thông tin, không phải lỗi.
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Bạn đã có đơn đăng ký đang chờ duyệt.', type: 'info' });
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });
});

// W76A: hai cú chạm trong CÙNG một khung hình (trước khi React vẽ lại `isPending`) từng gửi hai hồ sơ.
describe('DealerPage gửi hồ sơ đăng ký khoá chạm đúp trong cùng một khung hình (W76A)', () => {
  const deferred = () => {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const SENT = 'Đã gửi hồ sơ đăng ký đại lý!';
  const count = (text: string) => mocks.openSnackbar.mock.calls.filter((c) => c[0].text === text).length;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyDealer.mockReset();
    mocks.getDealerMe.mockReset();
    mocks.getDealerMe.mockResolvedValue(NONE);
  });

  it('chạm đúp "Gửi hồ sơ đăng ký" chỉ gửi một hồ sơ; đang gửi nút aria-busy, không disabled', async () => {
    const d = deferred();
    mocks.applyDealer.mockReturnValueOnce(d.promise);
    renderPage();
    const submit = await fillForm();
    await act(async () => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });
    expect(mocks.applyDealer).toHaveBeenCalledTimes(1);
    expect(mocks.applyDealer.mock.calls[0]![0]).toMatchObject({ businessName: 'giá trị 0', cccdFrontUrl: 'data:image/jpeg;base64,AA' });
    await waitFor(() => expect(submit).toHaveAttribute('aria-busy', 'true'));
    expect(submit).not.toBeDisabled();
    await act(async () => d.resolve({ ok: true }));
    await waitFor(() => expect(count(SENT)).toBe(1));
    expect(mocks.applyDealer).toHaveBeenCalledTimes(1);
  });

  it('lỗi thì nhả khoá, bấm lại gửi lần hai', async () => {
    mocks.applyDealer.mockRejectedValueOnce(new Error('Máy chủ bận')).mockResolvedValue({ ok: true });
    renderPage();
    const submit = await fillForm();
    await act(async () => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });
    expect(mocks.applyDealer).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(submit).not.toHaveAttribute('aria-busy'));
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.applyDealer).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(count(SENT)).toBe(1));
  });
});
