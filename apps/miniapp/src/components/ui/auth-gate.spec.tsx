import { render, screen, fireEvent, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('zmp-sdk/apis', () => ({ setStorage: vi.fn(), getStorage: vi.fn(), removeStorage: vi.fn() }));

import { useAuthStore } from '../../store/auth';
import { vi as copy } from '../../i18n/vi';
import { AuthGate } from './auth-gate';

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

  it('phục hồi xong (error → authenticated) thì nội dung tự hiện, không cần tải lại app', () => {
    setStatus('error');
    renderGate();
    expect(screen.queryByText('nội dung đã đăng nhập')).toBeNull();
    setStatus('authenticated');
    expect(screen.getByText('nội dung đã đăng nhập')).toBeInTheDocument();
  });
});
