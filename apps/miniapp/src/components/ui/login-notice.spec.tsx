import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ openSnackbar: vi.fn(), login: vi.fn(), state: { status: 'idle', error: undefined as string | undefined } }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useSnackbar: () => ({ openSnackbar: mocks.openSnackbar }) }));
vi.mock('../../store/auth', () => {
  const get = () => ({ ...mocks.state, login: mocks.login });
  return { useAuthStore: Object.assign((sel: (s: unknown) => unknown) => sel(get()), { getState: get }) };
});

import { useLoginWithNotice } from './auth-gate';

describe('useLoginWithNotice', () => {
  beforeEach(() => {
    mocks.openSnackbar.mockClear();
    mocks.login.mockReset().mockResolvedValue(undefined);
    mocks.state = { status: 'idle', error: undefined };
  });

  it('đăng nhập mà tài khoản bị khoá: nói lời máy chủ bằng thanh thông báo', async () => {
    mocks.state = { status: 'idle', error: 'Tài khoản đã bị khoá.' };
    const { result } = renderHook(() => useLoginWithNotice());
    await result.current();
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Tài khoản đã bị khoá.', type: 'error' });
  });

  it('đăng nhập được: không có thanh báo', async () => {
    mocks.state = { status: 'authenticated', error: undefined };
    const { result } = renderHook(() => useLoginWithNotice());
    await result.current();
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
  });

  it('mất mạng lúc đăng nhập (status error): không báo lời khoá', async () => {
    mocks.state = { status: 'error', error: 'Mất kết nối.' };
    const { result } = renderHook(() => useLoginWithNotice());
    await result.current();
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
  });
});
