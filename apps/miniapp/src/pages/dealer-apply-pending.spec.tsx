import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDealerMe: vi.fn(),
  applyDealer: vi.fn(),
  openSnackbar: vi.fn(),
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/dealer', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/dealer-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/dealer-api')>()),
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

async function fillAndSubmit() {
  await screen.findByText('Gửi hồ sơ đăng ký');
  const boxes = screen.getAllByRole('textbox');
  boxes.forEach((b, i) => fireEvent.change(b, { target: { value: i === 1 ? '' : `giá trị ${i}` } }));
  fireEvent.click(screen.getByText('Ảnh CCCD mặt trước *'));
  fireEvent.click(screen.getByText('Ảnh CCCD mặt sau *'));
  fireEvent.click(screen.getByText('Gửi hồ sơ đăng ký'));
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
  });
});
