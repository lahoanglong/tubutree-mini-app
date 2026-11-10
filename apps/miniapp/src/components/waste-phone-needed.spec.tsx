import { act, render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wasteGuestCopy } from '@tubutree/app-core/waste-copy';

const mocks = vi.hoisted(() => ({ openSnackbar: vi.fn(), ensurePhoneOrThrow: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../store/auth', () => {
  const state = { ensurePhoneOrThrow: mocks.ensurePhoneOrThrow };
  return { useAuthStore: (sel: (s: typeof state) => unknown) => sel(state) };
});
vi.mock('../services/api', () => ({ getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi') }));

import { WastePhoneNeeded } from './waste-phone-needed';

const BUTTON = 'Cho Tubu số điện thoại';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <WastePhoneNeeded text="Cho Tubu số điện thoại để xem yêu cầu." />
    </QueryClientProvider>,
  );
  return { invalidate };
}

/** Mỗi lần gọi trả một Promise riêng (không gộp lần như store thật), để chỉ khoá của chính nút mới giữ được cú chạm thứ hai. */
function pendingPhone() {
  const calls: { resolve: (v: string | null) => void; reject: (e: unknown) => void }[] = [];
  mocks.ensurePhoneOrThrow.mockImplementation(
    () => new Promise<string | null>((resolve, reject) => calls.push({ resolve, reject })),
  );
  return calls;
}

beforeEach(() => vi.clearAllMocks());

describe('WastePhoneNeeded: khoá nút Cho Tubu số điện thoại', () => {
  it('hiện câu của trang và lý do cần số điện thoại', () => {
    setup();
    expect(screen.getByText('Cho Tubu số điện thoại để xem yêu cầu.')).toBeInTheDocument();
    expect(screen.getByText(wasteGuestCopy.whyPhone)).toBeInTheDocument();
  });

  it('hai cú chạm trong cùng một nhịp: chỉ xin số điện thoại một lần, có số thì làm mới dữ liệu đổi rác một lần', async () => {
    const calls = pendingPhone();
    const { invalidate } = setup();
    const button = screen.getByRole('button', { name: BUTTON });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(mocks.ensurePhoneOrThrow).toHaveBeenCalledTimes(1);
    await act(async () => calls[0]!.resolve('0901234567'));
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['waste'] });
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
  });

  it('khách từ chối (trả null): không làm mới dữ liệu, không báo lỗi, rồi chạm lại được', async () => {
    const calls = pendingPhone();
    const { invalidate } = setup();
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    await act(async () => calls[0]!.resolve(null));
    expect(invalidate).not.toHaveBeenCalled();
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    expect(mocks.ensurePhoneOrThrow).toHaveBeenCalledTimes(2);
    await act(async () => calls[1]!.resolve(null));
  });

  it('lỗi liên kết: báo đúng một lần dù chạm đúp, không làm mới dữ liệu, rồi chạm lại được', async () => {
    const calls = pendingPhone();
    const { invalidate } = setup();
    const button = screen.getByRole('button', { name: BUTTON });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await act(async () => calls[0]!.reject(new Error('Số này đã gắn với tài khoản khác')));
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Số này đã gắn với tài khoản khác', type: 'error' });
    expect(invalidate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    expect(mocks.ensurePhoneOrThrow).toHaveBeenCalledTimes(2);
    await act(async () => calls[1]!.resolve(null));
  });
});
