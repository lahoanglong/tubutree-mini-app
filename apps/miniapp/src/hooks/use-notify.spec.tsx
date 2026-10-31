import { act, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ openSnackbar: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));

import { NotifyRegion } from '../components/notify-region';
import { announce, spokenText, useNotify, type NotifyOptions } from './use-notify';

function Probe({ opts }: { opts: NotifyOptions }) {
  const { notify } = useNotify();
  return <button type="button" onClick={() => notify(opts)}>gọi</button>;
}

const status = () => screen.getByTestId('notify-status');
const alert = () => screen.getByTestId('notify-alert');
const settle = () => act(() => { vi.advanceTimersByTime(60); });

describe('spokenText', () => {
  it('bỏ emoji, gộp khoảng trắng, cắt hai đầu', () => {
    expect(spokenText('Đã thêm vào giỏ 🌿')).toBe('Đã thêm vào giỏ');
    expect(spokenText('Đã theo dõi nhãn 💚')).toBe('Đã theo dõi nhãn');
    expect(spokenText('  Đã   chép mã  ABC  ')).toBe('Đã chép mã ABC');
    expect(spokenText('Đã mở nhóm mua chung! Rủ bạn bè tham gia nhé 🛒')).toBe('Đã mở nhóm mua chung! Rủ bạn bè tham gia nhé');
  });
  it('câu chỉ có emoji hoặc rỗng → chuỗi rỗng', () => {
    expect(spokenText('🌿')).toBe('');
    expect(spokenText('')).toBe('');
  });
  it('giữ chữ số, dấu tiếng Việt và ký tự "·"', () => {
    expect(spokenText('Đã thêm vào giỏ · Giảm 20k')).toBe('Đã thêm vào giỏ · Giảm 20k');
    expect(spokenText('Còn 3 sản phẩm')).toBe('Còn 3 sản phẩm');
  });
});

describe('useNotify + NotifyRegion (a11y A2: WCAG 4.1.3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.openSnackbar.mockClear();
    // Vùng đọc là trạng thái module-level: xoá câu của test trước.
    act(() => {
      announce('status', '');
      announce('alert', '');
    });
  });
  afterEach(() => {
    act(() => { vi.runOnlyPendingTimers(); });
    vi.useRealTimers();
  });

  it('có hai vùng ẩn trực quan: polite và assertive (atomic), không mang role nên không thành alert/status rỗng thường trực', () => {
    render(<NotifyRegion />);
    expect(status()).toHaveAttribute('aria-live', 'polite');
    expect(status()).toHaveAttribute('aria-atomic', 'true');
    expect(alert()).toHaveAttribute('aria-live', 'assertive');
    expect(alert()).toHaveAttribute('aria-atomic', 'true');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(status().textContent).toBe('');
  });

  it('success: gọi openSnackbar đúng khoá được truyền (giữ emoji ở chữ hiện), vùng status đọc bản bỏ emoji', () => {
    render(<><NotifyRegion /><Probe opts={{ text: 'Đã thêm vào giỏ 🌿', type: 'success' }} /></>);
    fireEvent.click(screen.getByRole('button', { name: 'gọi' }));
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã thêm vào giỏ 🌿', type: 'success' });
    settle();
    expect(status().textContent).toBe('Đã thêm vào giỏ');
    expect(alert().textContent).toBe('');
  });

  it('truyền duration và position thì chuyển nguyên cho openSnackbar', () => {
    render(<Probe opts={{ text: 'Xong', type: 'info', duration: 3200, position: 'top' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'gọi' }));
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Xong', type: 'info', duration: 3200, position: 'top' });
  });

  it('error và warning đi vào vùng assertive, không vào polite', () => {
    render(<><NotifyRegion /><Probe opts={{ text: 'Cần đăng nhập để theo dõi nhãn.', type: 'warning' }} /></>);
    fireEvent.click(screen.getByRole('button', { name: 'gọi' }));
    settle();
    expect(alert().textContent).toBe('Cần đăng nhập để theo dõi nhãn.');
    expect(status().textContent).toBe('');
  });

  it('cùng một câu hai lần liên tiếp: vùng bị xoá rồi ghi lại nên vẫn được đọc lại (Review Focus 2)', () => {
    render(<><NotifyRegion /><Probe opts={{ text: 'Đã chép mã GIAM20', type: 'success' }} /></>);
    const button = screen.getByRole('button', { name: 'gọi' });
    fireEvent.click(button);
    settle();
    expect(status().textContent).toBe('Đã chép mã GIAM20');
    fireEvent.click(button);
    expect(status().textContent).toBe('');
    settle();
    expect(status().textContent).toBe('Đã chép mã GIAM20');
  });

  it('câu chỉ có emoji: snackbar vẫn hiện, vùng đọc để trống, không ném lỗi (Review Focus 2)', () => {
    render(<><NotifyRegion /><Probe opts={{ text: '🌿', type: 'success' }} /></>);
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'gọi' }))).not.toThrow();
    settle();
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
    expect(status().textContent).toBe('');
  });

  it('không có NotifyRegion trong cây (spec của trang) vẫn gọi được, không lỗi', () => {
    render(<Probe opts={{ text: 'Xong', type: 'success' }} />);
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'gọi' }))).not.toThrow();
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
  });
});
