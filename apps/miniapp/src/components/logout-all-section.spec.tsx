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

describe('LogoutAllSection (Mini)', () => {
  it('chưa bấm: nút mở dùng được, chưa có tấm xác nhận, chưa có lời lỗi', () => {
    mount();
    expect(trigger()).toBeEnabled();
    expect(sheetOpen()).toBe(false);
    expect(lastSheet().open).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it('bấm nút → hỏi xác nhận (chưa gọi máy chủ); trong lúc hỏi nút mở bị khoá; Huỷ đóng tấm và mở khoá nút', async () => {
    mount();
    fireEvent.click(trigger());
    await waitFor(() => expect(sheetOpen()).toBe(true));
    expect(trigger()).toBeDisabled();
    expect(mocks.apiPost).not.toHaveBeenCalled();
    fireEvent.click(cancelBtn());
    await waitFor(() => expect(sheetOpen()).toBe(false));
    expect(trigger()).toBeEnabled();
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it('xác nhận: gọi logout-all đúng một lần rồi đăng xuất máy này, không có lời lỗi', async () => {
    mount();
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng xuất mọi máy' }));
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1));
    expect(mocks.apiPost).toHaveBeenCalledTimes(1);
    expect(mocks.apiPost).toHaveBeenCalledWith('/auth/logout-all');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
  });

  it('đang gọi: nút mở bị khoá, tấm báo loading, Huỷ khoá; onCancel/onConfirm gọi thẳng bị bỏ qua', async () => {
    const pending = deferred<unknown>();
    mocks.apiPost.mockReturnValue(pending.promise);
    mount();
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng xuất mọi máy' }));
    await waitFor(() => expect(lastSheet().loading).toBe(true));
    expect(trigger()).toBeDisabled();
    expect(cancelBtn()).toBeDisabled();

    act(() => lastSheet().onCancel());
    act(() => lastSheet().onConfirm());
    act(() => lastSheet().onConfirm());
    expect(sheetOpen()).toBe(true);
    expect(lastSheet().open).toBe(true);
    expect(mocks.apiPost).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve({}));
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1));
  });

  it('rảnh thì onCancel/onConfirm gọi thẳng vẫn làm việc của chúng', async () => {
    mount();
    fireEvent.click(trigger());
    await waitFor(() => expect(lastSheet().open).toBe(true));
    act(() => lastSheet().onCancel());
    await waitFor(() => expect(lastSheet().open).toBe(false));
    fireEvent.click(trigger());
    await waitFor(() => expect(lastSheet().open).toBe(true));
    act(() => lastSheet().onConfirm());
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(1));
  });

  it('gọi lỗi: snackbar + lời lỗi role="alert" tông danger ngay dưới nút; tấm đóng, nút mở dùng lại được, chưa đăng xuất', async () => {
    mocks.apiPost.mockRejectedValue(new Error('x'));
    mount();
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng xuất mọi máy' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('lỗi máy chủ');
    expect(screen.getByText('lỗi máy chủ').style.color).toBe('var(--color-text-danger)');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'lỗi máy chủ', type: 'error' });
    await waitFor(() => expect(sheetOpen()).toBe(false));
    expect(trigger()).toBeEnabled();
    expect(trigger().compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mocks.logout).not.toHaveBeenCalled();
  });

  it('mở lại sau lỗi: lời lỗi cũ mất ngay lúc mở tấm; thất bại lần hai hiện lại', async () => {
    mocks.apiPost.mockRejectedValue(new Error('x'));
    mount();
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng xuất mọi máy' }));
    await screen.findByRole('alert');
    await waitFor(() => expect(sheetOpen()).toBe(false));

    fireEvent.click(trigger());
    await waitFor(() => expect(sheetOpen()).toBe(true));
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(confirmBtn());
    expect(await screen.findByRole('alert')).toHaveTextContent('lỗi máy chủ');
    expect(mocks.apiPost).toHaveBeenCalledTimes(2);
  });
});
