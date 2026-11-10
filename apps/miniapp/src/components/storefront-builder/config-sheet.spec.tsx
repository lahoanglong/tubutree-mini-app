import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MerchantConfigSheet } from './config-sheet';
import { HttpError } from '../../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../../utils/settle-within';

const sf = {
  id: 's1', type: 'CTV', title: 'Gian hàng của An', subdomain: null, themeColor: null,
  bankName: 'ACB', bankAccountNo: '123456789', isPublished: false,
} as unknown as StorefrontEdit;
const saveBtn = () => screen.getByRole('button', { name: 'Lưu cấu hình gian hàng' });
const clearBtn = () => screen.getByRole('button', { name: 'Gỡ tài khoản đã lưu' });
const deferredPatch = () => {
  let finish!: (v: unknown) => void;
  let fail!: (e: unknown) => void;
  mocks.updateStorefront.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  return { finish: (v: unknown) => finish(v), fail: (e: unknown) => fail(e) };
};

function renderSheet(handlers: { onClose?: () => void; onSaved?: () => void } = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MerchantConfigSheet
        sf={sf}
        onClose={handlers.onClose ?? (() => {})}
        onSaved={handlers.onSaved ?? (() => {})}
        unpublishLabel={null}
        onUnpublish={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe('MerchantConfigSheet — khoá đồng bộ lưu cấu hình và gỡ ngân hàng (W82A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateStorefront.mockReset();
  });

  it('hai cú chạm "Lưu cấu hình" sát nhau trước khi vẽ lại: chỉ gửi một lần, lưu xong đóng và báo một lần', async () => {
    const patch = deferredPatch();
    const onClose = vi.fn();
    const onSaved = vi.fn();
    renderSheet({ onClose, onSaved });
    const btn = saveBtn();
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mocks.updateStorefront).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));

    await act(async () => patch.finish({}));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
  });

  it('cú chạm thứ hai cách cú đầu một microtask vẫn chưa vẽ lại: vẫn một lần', async () => {
    deferredPatch();
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
    const patch = deferredPatch();
    const onClose = vi.fn();
    renderSheet({ onClose });
    await act(async () => {
      fireEvent.click(saveBtn());
      fireEvent.click(saveBtn());
    });
    await act(async () => patch.fail(new Error('Mạng chập chờn')));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Mạng chập chờn', type: 'error' }));
    expect(onClose).not.toHaveBeenCalled();

    mocks.updateStorefront.mockResolvedValueOnce({});
    fireEvent.click(saveBtn());
    await waitFor(() => expect(mocks.updateStorefront).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('hai cú chạm "Gỡ tài khoản đã lưu" sát nhau: chỉ gỡ một lần (gửi bốn trường ngân hàng rỗng), gỡ lỗi thì bấm lại được', async () => {
    const patch = deferredPatch();
    const onSaved = vi.fn();
    renderSheet({ onSaved });
    const btn = clearBtn();
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mocks.updateStorefront).toHaveBeenCalledTimes(1);
    expect(mocks.updateStorefront).toHaveBeenCalledWith({ bankName: '', bankBin: '', bankAccountNo: '', bankAccountName: '' });

    await act(async () => patch.fail(new Error('Mạng chập chờn')));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Mạng chập chờn', type: 'error' }));
    expect(onSaved).not.toHaveBeenCalled();

    mocks.updateStorefront.mockResolvedValueOnce({});
    fireEvent.click(clearBtn());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mocks.updateStorefront).toHaveBeenCalledTimes(2);
  });
});

// W112A: máy chủ từ chối vì gian hàng đã đổi (400/404/409) thì nút giữ khoá tới khi gian hàng và Hành trình tải lại xong (tối đa LOCK_REFRESH_WAIT_MS). Mất mạng, quá hạn, 401, 5xx không nói gì về gian hàng thật: không tải lại, nhả ngay.
describe('MerchantConfigSheet: máy chủ từ chối thì tải lại rồi mới nhả khoá (W112A)', () => {
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
  const CASES = [
    { name: 'Lưu cấu hình', button: saveBtn },
    { name: 'Gỡ tài khoản đã lưu', button: clearBtn },
  ];

  /** `reload(key)` trả lời hứa tải lại của từng khoá; không truyền thì tải lại xong ngay. */
  function renderLive(reload?: (key: string) => Promise<void> | undefined) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidated: string[] = [];
    vi.spyOn(qc, 'invalidateQueries').mockImplementation(((filters: { queryKey: readonly string[] }) => {
      invalidated.push(filters.queryKey[0]!);
      return reload?.(filters.queryKey[0]!) ?? Promise.resolve();
    }) as never);
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <MerchantConfigSheet sf={sf} onClose={onClose} onSaved={onSaved} unpublishLabel={null} onUnpublish={() => {}} />
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

  describe.each(CASES)('$name', ({ name, button }) => {
    it.each([400, 404, 409])('bị từ chối %i: báo lỗi một lần, tải lại gian hàng và Hành trình, nút bận tới khi cả hai về rồi mới nhận cú chạm mới', async (status) => {
      mocks.updateStorefront.mockRejectedValueOnce(serverError('Gian hàng không còn.', status)).mockResolvedValue({});
      const reload: Record<string, ReturnType<typeof pending>> = { 'storefront-quests': pending(), 'my-storefront': pending() };
      const { invalidated, onClose, onSaved } = renderLive((key) => reload[key]?.promise);
      const btn = button();
      await act(async () => {
        fireEvent.click(btn);
        fireEvent.click(btn);
      });
      await waitFor(() => expect(invalidated).toEqual(['storefront-quests', 'my-storefront']));
      expect(mocks.updateStorefront).toHaveBeenCalledTimes(1);
      expect(errorToasts()).toEqual([[{ text: 'Gian hàng không còn.', type: 'error' }]]);
      expect(btn).toHaveAttribute('aria-busy', 'true');
      await act(async () => {
        reload['storefront-quests']!.resolve();
      });
      await act(async () => {
        fireEvent.click(btn);
      });
      expect(mocks.updateStorefront).toHaveBeenCalledTimes(1);
      expect(btn).toHaveAttribute('aria-busy', 'true');
      await act(async () => reload['my-storefront']!.resolve());
      await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
      expect(onSaved).not.toHaveBeenCalled();
      // Tấm Cài đặt đóng sau khi dữ liệu về khi 404/409 (W114A); 400 và nút gỡ ngân hàng giữ nguyên.
      expect(onClose).toHaveBeenCalledTimes(name === 'Lưu cấu hình' && status !== 400 ? 1 : 0);
      expect(errorToasts()).toHaveLength(1);
      fireEvent.click(btn);
      await waitFor(() => expect(mocks.updateStorefront).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    });

    it.each(TEMPORARY)('%s: không nói gì về gian hàng thật nên không tải lại, khoá nhả ngay', async (_label, error) => {
      mocks.updateStorefront.mockRejectedValueOnce(error).mockResolvedValue({});
      const { invalidated, onSaved } = renderLive();
      const btn = button();
      await act(async () => {
        fireEvent.click(btn);
      });
      await waitFor(() => expect(errorToasts()).toHaveLength(1));
      await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
      expect(invalidated).toEqual([]);
      fireEvent.click(btn);
      await waitFor(() => expect(mocks.updateStorefront).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    });

    it('bị từ chối mà dữ liệu tải lại treo mãi: nút còn bận ở 3,5 giây, nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
      mocks.updateStorefront.mockRejectedValueOnce(serverError('Gian hàng không còn.', 404)).mockResolvedValue({});
      renderLive(() => new Promise<void>(() => undefined));
      const btn = button();
      vi.useFakeTimers();
      await act(async () => {
        fireEvent.click(btn);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(btn).toHaveAttribute('aria-busy', 'true');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_500);
        fireEvent.click(btn);
      });
      expect(mocks.updateStorefront).toHaveBeenCalledTimes(1);
      expect(btn).toHaveAttribute('aria-busy', 'true');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 3_500 + 100);
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

  it.each([404, 409])('Lưu cấu hình bị từ chối %i rồi tấm bị gỡ và mở lại lúc dữ liệu còn tải: lệnh đóng của tấm cũ không đóng tấm mới (W114A)', async (status) => {
    mocks.updateStorefront.mockRejectedValueOnce(serverError('Gian hàng không còn.', status));
    const refresh = pending();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh.promise) as never);
    // Cha truyền cùng một onClose cho mọi lần mở tấm: lệnh đóng trễ của tấm cũ gọi trúng tấm mới nếu không được chặn.
    const onClose = vi.fn();
    const tree = () => (
      <QueryClientProvider client={qc}>
        <MerchantConfigSheet sf={sf} onClose={onClose} onSaved={() => {}} unpublishLabel={null} onUnpublish={() => {}} />
      </QueryClientProvider>
    );
    const first = render(tree());
    await act(async () => {
      fireEvent.click(saveBtn());
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    first.unmount();
    render(tree());
    await act(async () => refresh.resolve());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(saveBtn()).not.toHaveAttribute('aria-busy');
  });
});
