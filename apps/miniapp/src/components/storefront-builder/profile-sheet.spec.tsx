import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { StorefrontEdit } from '../../services/storefront-api';

const mocks = vi.hoisted(() => ({ openSnackbar: vi.fn(), updateStorefront: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../services/storefront-api', () => ({ updateStorefront: mocks.updateStorefront }));
vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getErrorMessage: (e: unknown) => (e as Error).message,
}));

import { ProfileSheet } from './profile-sheet';
import { HttpError } from '../../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../../utils/settle-within';

const sf = { id: 's1', avatarUrl: 'https://i/a.jpg', coverUrl: 'https://i/c.jpg', headerNote: 'Xin chào' } as unknown as StorefrontEdit;
const saveBtn = () => screen.getByRole('button', { name: 'Lưu hồ sơ' });
const deferredSave = () => {
  let finish!: (v: unknown) => void;
  let fail!: (e: unknown) => void;
  mocks.updateStorefront.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  return { finish: (v: unknown) => finish(v), fail: (e: unknown) => fail(e) };
};

function renderSheet(handlers: { onClose?: () => void; onSaved?: () => void } = {}) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <ProfileSheet sf={sf} onClose={handlers.onClose ?? (() => {})} onSaved={handlers.onSaved ?? (() => {})} />
    </QueryClientProvider>,
  );
}

describe('ProfileSheet — khoá đồng bộ lưu hồ sơ gian hàng (W82A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateStorefront.mockReset();
  });

  it('hai cú chạm "Lưu hồ sơ" sát nhau trước khi vẽ lại: chỉ gửi một lần, lưu xong đóng và báo thành công một lần', async () => {
    const save = deferredSave();
    const onClose = vi.fn();
    const onSaved = vi.fn();
    renderSheet({ onClose, onSaved });
    const btn = saveBtn();
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mocks.updateStorefront).toHaveBeenCalledTimes(1);
    expect(mocks.updateStorefront).toHaveBeenCalledWith({ avatarUrl: 'https://i/a.jpg', coverUrl: 'https://i/c.jpg', headerNote: 'Xin chào' });
    await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));

    await act(async () => save.finish({}));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
  });

  it('cú chạm thứ hai cách cú đầu một microtask vẫn chưa vẽ lại: vẫn một lần', async () => {
    deferredSave();
    renderSheet();
    const btn = saveBtn();
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
      fireEvent.click(btn);
    });
    expect(mocks.updateStorefront).toHaveBeenCalledTimes(1);
  });

  it('lưu lỗi thì nhả khoá, báo lỗi, không đóng sheet: bấm lại lưu được', async () => {
    const save = deferredSave();
    const onClose = vi.fn();
    renderSheet({ onClose });
    await act(async () => {
      fireEvent.click(saveBtn());
      fireEvent.click(saveBtn());
    });
    await act(async () => save.fail(new Error('Mạng chập chờn')));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Mạng chập chờn', type: 'error' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.updateStorefront).toHaveBeenCalledTimes(1);

    mocks.updateStorefront.mockResolvedValueOnce({});
    fireEvent.click(saveBtn());
    await waitFor(() => expect(mocks.updateStorefront).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('ProfileSheet: máy chủ từ chối vì gian hàng không còn khớp thì tải lại rồi mới nhả khoá (W108A)', () => {
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message } } as never);
  const errorToasts = () => mocks.openSnackbar.mock.calls.filter(([a]) => (a as { type: string }).type === 'error');
  const pending = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const TEMPORARY: [string, unknown][] = [
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['quá thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
    ['lỗi không phải HTTP', new Error('boom')],
  ];

  function renderLive(invalidate?: (key: readonly unknown[]) => Promise<void> | undefined) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidated: unknown[][] = [];
    vi.spyOn(qc, 'invalidateQueries').mockImplementation(((filters: { queryKey: readonly unknown[] }) => {
      invalidated.push([...filters.queryKey]);
      return invalidate?.(filters.queryKey) ?? Promise.resolve();
    }) as never);
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <ProfileSheet sf={sf} onClose={onClose} onSaved={onSaved} />
      </QueryClientProvider>,
    );
    return { invalidated, onClose, onSaved };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateStorefront.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([400, 404, 409])('bị từ chối %i: báo lỗi một lần, tải lại gian hàng, nút bận tới khi dữ liệu về rồi mới nhận cú chạm mới; sheet đóng sau khi dữ liệu về khi 404/409, 400 giữ mở (W114A)', async (status) => {
    mocks.updateStorefront.mockRejectedValueOnce(serverError('Gian hàng không còn.', status)).mockResolvedValue({});
    const refresh = pending();
    const { invalidated, onClose, onSaved } = renderLive((key) => (key[0] === 'my-storefront' ? refresh.promise : undefined));
    const btn = saveBtn();
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    await waitFor(() => expect(invalidated).toEqual([['my-storefront']]));
    expect(mocks.updateStorefront).toHaveBeenCalledTimes(1);
    expect(errorToasts()).toEqual([[{ text: 'Gian hàng không còn.', type: 'error' }]]);
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(mocks.updateStorefront).toHaveBeenCalledTimes(1);
    await act(async () => refresh.resolve());
    await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
    expect(onClose).toHaveBeenCalledTimes(status === 400 ? 0 : 1);
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.updateStorefront).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(status === 400 ? 1 : 2));
  });

  it.each(TEMPORARY)('%s: không nói gì về gian hàng thật nên không tải lại, khoá nhả ngay', async (_label, error) => {
    mocks.updateStorefront.mockRejectedValueOnce(error).mockResolvedValue({});
    const { invalidated } = renderLive();
    const btn = saveBtn();
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(errorToasts()).toHaveLength(1));
    await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
    expect(invalidated).toEqual([]);
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.updateStorefront).toHaveBeenCalledTimes(2));
  });

  it('bị từ chối mà dữ liệu tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS, không sớm hơn', async () => {
    mocks.updateStorefront.mockRejectedValueOnce(serverError('Gian hàng không còn.', 404)).mockResolvedValue({});
    renderLive(() => new Promise<void>(() => undefined));
    const btn = saveBtn();
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(btn);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 1);
      fireEvent.click(btn);
    });
    expect(mocks.updateStorefront).toHaveBeenCalledTimes(1);
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
      for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
    });
    expect(btn).not.toHaveAttribute('aria-busy');
    await act(async () => {
      fireEvent.click(btn);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.updateStorefront).toHaveBeenCalledTimes(2);
  });
});

describe('ProfileSheet: tấm có ô nhập chỉ đóng khi gian hàng không còn (404/409), sau khi dữ liệu mới về (W114A)', () => {
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message } } as never);
  const pending = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  function renderLive(refresh: () => Promise<void>) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <ProfileSheet sf={sf} onClose={onClose} onSaved={() => {}} />
      </QueryClientProvider>,
    );
    return { invalidate, onClose };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateStorefront.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([404, 409])('bị từ chối %i: chưa đóng khi dữ liệu còn đang tải, đóng đúng một lần sau khi dữ liệu về', async (status) => {
    mocks.updateStorefront.mockRejectedValueOnce(serverError('Gian hàng không còn.', status));
    const refresh = pending();
    const { invalidate, onClose } = renderLive(() => refresh.promise);
    await act(async () => {
      fireEvent.click(saveBtn());
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => refresh.resolve());
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([404, 409])('bị từ chối %i rồi tấm bị gỡ và mở lại lúc dữ liệu còn tải: lệnh đóng của tấm cũ không đóng tấm mới', async (status) => {
    mocks.updateStorefront.mockRejectedValueOnce(serverError('Gian hàng không còn.', status));
    const refresh = pending();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh.promise) as never);
    // Cha truyền cùng một onClose cho mọi lần mở tấm: lệnh đóng trễ của tấm cũ gọi trúng tấm mới nếu không được chặn.
    const onClose = vi.fn();
    const tree = () => (
      <QueryClientProvider client={qc}>
        <ProfileSheet sf={sf} onClose={onClose} onSaved={() => {}} />
      </QueryClientProvider>
    );
    const first = render(tree());
    await act(async () => {
      fireEvent.click(saveBtn());
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    first.unmount();
    render(tree());
    await act(async () => refresh.resolve());
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(saveBtn()).not.toHaveAttribute('aria-busy');
  });

  it.each([400, 422])('bị từ chối %i: giữ tấm để sửa ô nhập, không đóng', async (status) => {
    mocks.updateStorefront.mockRejectedValueOnce(serverError('Ảnh bìa không hợp lệ.', status));
    const { onClose } = renderLive(() => Promise.resolve());
    await act(async () => {
      fireEvent.click(saveBtn());
    });
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Ảnh bìa không hợp lệ.', type: 'error' }));
    await settle();
    await waitFor(() => expect(saveBtn()).not.toHaveAttribute('aria-busy'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['quá thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
  ])('%s: tấm giữ mở, khoá nhả ngay', async (_label, error) => {
    mocks.updateStorefront.mockRejectedValueOnce(error);
    const { invalidate, onClose } = renderLive(() => new Promise<void>(() => undefined));
    await act(async () => {
      fireEvent.click(saveBtn());
    });
    await waitFor(() => expect(saveBtn()).not.toHaveAttribute('aria-busy'));
    expect(invalidate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('404 mà dữ liệu tải lại treo mãi: đóng đúng sau LOCK_REFRESH_WAIT_MS, không sớm hơn', async () => {
    mocks.updateStorefront.mockRejectedValueOnce(serverError('Gian hàng không còn.', 404));
    const { onClose } = renderLive(() => new Promise<void>(() => undefined));
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(saveBtn());
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 1);
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
      for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
