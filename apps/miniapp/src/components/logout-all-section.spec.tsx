import { act, render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfirmSheetProps } from './ui/confirm-sheet';

const mocks = vi.hoisted(() => ({
  openSnackbar: vi.fn(),
  logout: vi.fn(),
  apiPost: vi.fn(),
}));
// Bọc ConfirmSheet để đọc props mới nhất: `dismissible=false` và nút Huỷ `disabled` đã chặn mọi đường bấm,
// nên chỉ gọi thẳng onConfirm/onCancel mới chứng minh được guard trong LogoutAllSection.
const sheetSpy = vi.hoisted(() => ({ calls: [] as ConfirmSheetProps[] }));
vi.mock('./ui/confirm-sheet', async (importOriginal) => {
  const orig = await importOriginal<{ ConfirmSheet: ComponentType<ConfirmSheetProps> }>();
  return {
    ...orig,
    ConfirmSheet: (p: ConfirmSheetProps) => {
      sheetSpy.calls.push(p);
      return <orig.ConfirmSheet {...p} />;
    },
  };
});
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: (opt: unknown) => mocks.openSnackbar(opt), closeSnackbar: vi.fn() }),
}));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ logout: mocks.logout }) }));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getErrorMessage: () => 'lỗi máy chủ',
  api: { post: mocks.apiPost },
}));

import { LogoutAllSection } from './logout-all-section';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return rtlRender(
    <QueryClientProvider client={qc}>
      <LogoutAllSection />
    </QueryClientProvider>,
  );
};
const lastSheet = () => sheetSpy.calls.at(-1)!;
const trigger = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === 'Đăng xuất mọi thiết bị')!;
const confirmBtn = () => screen.getByRole('button', { name: 'Đăng xuất mọi máy' });
const cancelBtn = () => screen.getByRole('button', { name: 'Huỷ' });
const sheetOpen = () => screen.queryByText('Đăng xuất khỏi mọi thiết bị?') !== null;

beforeEach(() => {
  vi.clearAllMocks();
  sheetSpy.calls.length = 0;
  mocks.apiPost.mockReset().mockResolvedValue({});
  mocks.logout.mockReset();
});

describe('LogoutAllSection', () => {
  it('bấm nút → hỏi xác nhận (chưa gọi gì); xác nhận gọi logout-all đúng một lần rồi đăng xuất máy này', async () => {
    mount();
    expect(trigger()).toBeEnabled();
    fireEvent.click(trigger());
    expect(sheetOpen()).toBe(true);
    expect(mocks.apiPost).not.toHaveBeenCalled();
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1));
    expect(mocks.apiPost).toHaveBeenCalledTimes(1);
    expect(mocks.apiPost).toHaveBeenCalledWith('/auth/logout-all');
  });

  it('Huỷ khi chưa gửi: đóng hộp xác nhận, không gọi máy chủ', async () => {
    mount();
    fireEvent.click(trigger());
    fireEvent.click(cancelBtn());
    await waitFor(() => expect(lastSheet().open).toBe(false));
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it('máy chủ lỗi: báo lỗi, đóng hộp xác nhận, giữ phiên, nút mở khoá lại', async () => {
    mocks.apiPost.mockRejectedValueOnce(new Error('boom'));
    mount();
    fireEvent.click(trigger());
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'lỗi máy chủ', type: 'error' }));
    await waitFor(() => expect(lastSheet().open).toBe(false));
    expect(mocks.logout).not.toHaveBeenCalled();
    expect(trigger()).toBeEnabled();
  });
});

describe('LogoutAllSection: khoá khi đang đăng xuất mọi thiết bị', () => {
  async function startPending() {
    const pending = deferred<unknown>();
    mocks.apiPost.mockReturnValue(pending.promise);
    mount();
    fireEvent.click(trigger());
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(lastSheet().loading).toBe(true));
    return pending;
  }

  it('đang gửi: nút mở hộp bị khoá, nút xác nhận báo bận, Huỷ bị khoá, hộp không đóng bằng bấm', async () => {
    const pending = await startPending();
    expect(trigger()).toBeDisabled();
    expect(confirmBtn()).toHaveAttribute('aria-busy', 'true');
    expect(cancelBtn()).toBeDisabled();
    fireEvent.click(cancelBtn());
    fireEvent.click(confirmBtn());
    expect(sheetOpen()).toBe(true);
    expect(mocks.apiPost).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({}));
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1));
  });

  it('đang gửi: onCancel bị guard (hộp vẫn mở), onConfirm bị guard (không gửi lần hai)', async () => {
    const pending = await startPending();
    act(() => lastSheet().onCancel());
    expect(lastSheet().open).toBe(true);
    expect(sheetOpen()).toBe(true);
    act(() => lastSheet().onConfirm());
    expect(mocks.apiPost).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({}));
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1));
  });

  it('gửi xong lỗi: onCancel/onConfirm hết bị guard, nút mở hộp mở khoá, gửi lại được', async () => {
    const pending = await startPending();
    await act(async () => pending.reject(new Error('boom')));
    await waitFor(() => expect(lastSheet().open).toBe(false));
    expect(trigger()).toBeEnabled();
    mocks.apiPost.mockResolvedValue({});
    fireEvent.click(trigger());
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1));
    expect(mocks.apiPost).toHaveBeenCalledTimes(2);
  });
});
