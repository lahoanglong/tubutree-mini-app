import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorefrontEdit } from '../../services/storefront-api';

const mocks = vi.hoisted(() => ({ openSnackbar: vi.fn(), updateStorefront: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../services/storefront-api', () => ({ updateStorefront: mocks.updateStorefront }));
vi.mock('../../services/api', () => ({ getErrorMessage: (e: unknown) => (e as Error).message }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MerchantConfigSheet } from './config-sheet';

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
