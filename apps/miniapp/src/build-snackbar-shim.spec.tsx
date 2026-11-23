import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SnackbarProvider, { SNACKBAR_DEFAULT_DURATION, SNACKBAR_EXIT_MS, SNACKBAR_SWAP_GAP_MS, useSnackbar, type SnackbarOptions } from './build-snackbar-shim';
import { announce, useAnnouncements } from './lib/announce';

type Api = ReturnType<typeof useSnackbar>;
let api: Api;
function Grab() {
  api = useSnackbar();
  return null;
}
function Live() {
  const a = useAnnouncements();
  return (
    <>
      <div data-testid="live-status">{a.status}</div>
      <div data-testid="live-alert">{a.alert}</div>
    </>
  );
}
const mount = () =>
  render(
    <SnackbarProvider>
      <Grab />
      <Live />
    </SnackbarProvider>,
  );
const open = (o: SnackbarOptions) => act(() => api.openSnackbar(o));
const toast = () => screen.queryByTestId('tubu-toast');
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('build-snackbar-shim: hộp thông báo thay zmp-ui SnackbarProvider ở bản build', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    act(() => {
      announce('status', '');
      announce('alert', '');
    });
    vi.useRealTimers();
  });

  it('hiện câu ở đáy, ẩn sau 2 giây mặc định rồi gỡ khỏi DOM sau hiệu ứng ra', () => {
    mount();
    open({ text: 'Đã thêm vào giỏ' });
    expect(toast()).toHaveTextContent('Đã thêm vào giỏ');
    expect(toast()).toHaveAttribute('data-position', 'bottom');
    expect(toast()).not.toHaveAttribute('role');
    tick(SNACKBAR_DEFAULT_DURATION - 1);
    expect(toast()).not.toHaveAttribute('data-leaving');
    tick(1);
    expect(toast()).toHaveAttribute('data-leaving', 'true');
    tick(SNACKBAR_EXIT_MS);
    expect(toast()).toBeNull();
  });

  it('theo `duration` và `position: top` của bên gọi', () => {
    mount();
    open({ text: 'Đã chép mã', duration: 5000, position: 'top' });
    expect(toast()).toHaveAttribute('data-position', 'top');
    tick(4999);
    expect(toast()).not.toHaveAttribute('data-leaving');
    tick(1);
    expect(toast()).toHaveAttribute('data-leaving', 'true');
  });

  it('nút hành động gọi onClick rồi đóng khi `close`, `onClose` gọi đúng một lần lúc bắt đầu ẩn', () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    mount();
    open({ text: 'Đã thêm 3 món', action: { text: 'Xem giỏ', close: true, onClick }, onClose });
    const btn = screen.getByRole('button', { name: 'Xem giỏ' });
    expect(btn).toHaveAttribute('type', 'button');
    expect(toast()).toHaveAttribute('data-wide');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toast()).toHaveAttribute('data-leaving', 'true');
    tick(SNACKBAR_DEFAULT_DURATION);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('nút hành động không `close` thì hộp vẫn hiện; không có chữ thì không vẽ nút', () => {
    mount();
    open({ text: 'A', action: { text: 'Hoàn tác', onClick: vi.fn() } });
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }));
    expect(toast()).not.toHaveAttribute('data-leaving');
    open({ text: 'B', action: { onClick: vi.fn() } });
    tick(SNACKBAR_SWAP_GAP_MS);
    expect(toast()).toHaveTextContent('B');
    expect(screen.queryByRole('button')).toBeNull();
    expect(toast()).not.toHaveAttribute('data-wide');
  });

  it('mở câu mới khi câu cũ còn hiện: ẩn câu cũ, 250ms sau mới hiện câu mới (như zmp-ui)', () => {
    mount();
    open({ text: 'Câu một' });
    open({ text: 'Câu hai' });
    expect(toast()).toHaveTextContent('Câu một');
    expect(toast()).toHaveAttribute('data-leaving', 'true');
    tick(SNACKBAR_SWAP_GAP_MS);
    expect(toast()).toHaveTextContent('Câu hai');
    expect(toast()).not.toHaveAttribute('data-leaving');
    tick(SNACKBAR_DEFAULT_DURATION + SNACKBAR_EXIT_MS);
    expect(toast()).toBeNull();
  });

  it('closeSnackbar đóng ngay; gọi khi không có hộp thì không sao', () => {
    mount();
    act(() => api.closeSnackbar());
    open({ text: 'X' });
    act(() => api.closeSnackbar());
    expect(toast()).toHaveAttribute('data-leaving', 'true');
    tick(SNACKBAR_EXIT_MS);
    expect(toast()).toBeNull();
  });

  it('type success/error/warning/info có icon đặc ẩn với trình đọc và hộp rộng hết khổ; không type hay type lạ thì chỉ có chữ', () => {
    mount();
    const icon = () => toast()?.querySelector('svg.tubu-toast__icon');
    for (const type of ['success', 'error', 'warning', 'info']) {
      act(() => api.closeSnackbar());
      tick(SNACKBAR_EXIT_MS);
      open({ text: type, type });
      expect(icon(), type).toHaveClass(`tubu-toast__icon--${type}`);
      expect(icon()).toHaveAttribute('aria-hidden', 'true');
      expect(toast()).toHaveAttribute('data-wide');
    }
    for (const type of [undefined, 'default']) {
      act(() => api.closeSnackbar());
      tick(SNACKBAR_EXIT_MS);
      open({ text: 'Chỉ chữ', type });
      expect(icon()).toBeNull();
      expect(toast()).not.toHaveAttribute('data-wide');
    }
  });

  it('ghi câu vào vùng aria-live: lỗi/cảnh báo vào vùng assertive, còn lại vào polite, bỏ emoji', () => {
    mount();
    open({ text: 'Đã lưu 🌿', type: 'success' });
    tick(50);
    expect(screen.getByTestId('live-status')).toHaveTextContent(/^Đã lưu$/);
    open({ text: 'Lỗi mạng', type: 'error' });
    tick(50);
    expect(screen.getByTestId('live-alert')).toHaveTextContent('Lỗi mạng');
  });

  it('useSnackbar trả hàm mới mỗi lần render như zmp-ui; ngoài Provider thì không ném lỗi', () => {
    const seen: Api['openSnackbar'][] = [];
    function Twice() {
      const { openSnackbar } = useSnackbar();
      const renders = useRef(0);
      renders.current++;
      seen.push(openSnackbar);
      useEffect(() => {}, [openSnackbar]);
      return null;
    }
    const { rerender } = render(
      <SnackbarProvider>
        <Twice />
      </SnackbarProvider>,
    );
    rerender(
      <SnackbarProvider>
        <Twice />
      </SnackbarProvider>,
    );
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[0]).not.toBe(seen[1]);
    render(<Grab />);
    expect(() => api.openSnackbar({ text: 'x' })).not.toThrow();
    expect(() => api.setDownloadProgress()).not.toThrow();
  });
});
