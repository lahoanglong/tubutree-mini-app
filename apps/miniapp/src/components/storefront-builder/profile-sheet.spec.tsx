import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { StorefrontEdit } from '../../services/storefront-api';

const mocks = vi.hoisted(() => ({ openSnackbar: vi.fn(), updateStorefront: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../services/storefront-api', () => ({ updateStorefront: mocks.updateStorefront }));
vi.mock('../../services/api', () => ({ getErrorMessage: (e: unknown) => (e as Error).message }));

import { ProfileSheet } from './profile-sheet';

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
