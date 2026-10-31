import { render, renderHook, screen, fireEvent, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('zmp-sdk/apis', () => ({ setStorage: vi.fn(), getStorage: vi.fn(), removeStorage: vi.fn() }));

import { useAuthStore } from '../../store/auth';
import { vi as copy } from '../../i18n/vi';
import { AuthGate, useBlockedMessage } from './auth-gate';

const restore = vi.fn(() => Promise.resolve());
const login = vi.fn(() => Promise.resolve());

function setStatus(status: 'idle' | 'loading' | 'authenticated' | 'error') {
  act(() => useAuthStore.setState({ status, restore, login }));
}

function renderGate(props: Partial<React.ComponentProps<typeof AuthGate>> = {}) {
  return render(
    <AuthGate {...props}>
      <div>nội dung đã đăng nhập</div>
    </AuthGate>,
  );
}

describe('AuthGate — một cổng cho mọi trang cần đăng nhập (R5-BUYER-1)', () => {
  beforeEach(() => {
    restore.mockClear();
    login.mockClear();
  });

  it('đã đăng nhập → hiện nội dung', () => {
    setStatus('authenticated');
    renderGate();
    expect(screen.getByText('nội dung đã đăng nhập')).toBeInTheDocument();
  });

  it('đang khôi phục phiên → khung chờ do trang đưa vào (hoặc khung chờ mặc định), không lộ nội dung', () => {
    setStatus('loading');
    renderGate({ loading: <div>khung chờ riêng</div> });
    expect(screen.getByText('khung chờ riêng')).toBeInTheDocument();
    expect(screen.queryByText('nội dung đã đăng nhập')).toBeNull();
  });

  it('mất kết nối lúc khôi phục phiên → câu tiếng Việt + nút Thử lại gọi restore(); không phải màn trống hay lời mời đăng nhập', () => {
    setStatus('error');
    renderGate({ guest: <div>mời đăng nhập</div> });
    expect(screen.getByText(copy.errors.sessionUnavailable)).toBeInTheDocument();
    expect(screen.queryByText('mời đăng nhập')).toBeNull();
    expect(screen.queryByText('nội dung đã đăng nhập')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('chưa đăng nhập thật sự (idle) → lời mời đăng nhập mặc định gọi login(); trang có thể đưa lời mời riêng', () => {
    setStatus('idle');
    const { unmount } = renderGate();
    fireEvent.click(screen.getByRole('button', { name: copy.auth.loginCta }));
    expect(login).toHaveBeenCalledTimes(1);
    unmount();

    renderGate({ guest: <div>mời đăng nhập riêng</div> });
    expect(screen.getByText('mời đăng nhập riêng')).toBeInTheDocument();
  });

  it('tài khoản bị khoá (idle kèm lời máy chủ) → lời mời đăng nhập mặc định nói lời đó thay cho lời mời chung', () => {
    act(() => useAuthStore.setState({ status: 'idle', restore, login, error: 'Tài khoản đã bị khoá.' }));
    renderGate();
    expect(screen.getByText('Tài khoản đã bị khoá.')).toBeInTheDocument();
    expect(screen.queryByText(copy.auth.loginHint)).toBeNull();
    act(() => useAuthStore.setState({ error: undefined }));
  });

  it('bị giới hạn tốc độ (error kèm lời 429) → tiêu đề "Bạn thao tác quá nhanh" như màn web, vẫn có Thử lại', () => {
    act(() => useAuthStore.setState({ status: 'error', restore, login, error: copy.errors.sessionRateLimited }));
    renderGate();
    expect(screen.getByText('Bạn thao tác quá nhanh')).toBeInTheDocument();
    expect(screen.getByText(copy.errors.sessionRateLimited)).toBeInTheDocument();
    expect(screen.queryByText(/vẫn đang đăng nhập/)).toBeNull();
    expect(screen.queryByText(copy.errors.title)).toBeNull();
    expect(screen.getByTestId('error-state-icon').querySelector('.lucide-clock')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(restore).toHaveBeenCalledTimes(1);
    act(() => useAuthStore.setState({ error: undefined }));
  });

  it('mất mạng (không phải 429) → giữ tiêu đề lỗi tải chung', () => {
    act(() => useAuthStore.setState({ status: 'error', restore, login, error: copy.errors.sessionUnavailable }));
    renderGate();
    expect(screen.getByText(copy.errors.title)).toBeInTheDocument();
    expect(screen.queryByText('Bạn thao tác quá nhanh')).toBeNull();
    expect(screen.getByTestId('error-state-icon').querySelector('.lucide-triangle-alert')).not.toBeNull();
    act(() => useAuthStore.setState({ error: undefined }));
  });

  it('phục hồi xong (error → authenticated) thì nội dung tự hiện, không cần tải lại app', () => {
    setStatus('error');
    renderGate();
    expect(screen.queryByText('nội dung đã đăng nhập')).toBeNull();
    setStatus('authenticated');
    expect(screen.getByText('nội dung đã đăng nhập')).toBeInTheDocument();
  });
});

describe('useBlockedMessage', () => {
  const setAuth = (status: 'idle' | 'loading' | 'authenticated' | 'error', error: string | undefined) =>
    act(() => useAuthStore.setState({ status, error }));

  it('idle kèm lời máy chủ (tài khoản bị khoá) → trả lời đó', () => {
    setAuth('idle', 'Tài khoản đã bị khoá.');
    expect(renderHook(() => useBlockedMessage()).result.current).toBe('Tài khoản đã bị khoá.');
  });

  it('idle không có lỗi (đăng xuất bình thường) → null', () => {
    setAuth('idle', undefined);
    expect(renderHook(() => useBlockedMessage()).result.current).toBeNull();
  });

  it('status error (mất mạng lúc khôi phục phiên): lời lỗi mạng không được coi là tài khoản bị khoá → null', () => {
    setAuth('error', 'Mất kết nối, thử lại nhé.');
    expect(renderHook(() => useBlockedMessage()).result.current).toBeNull();
  });
});
