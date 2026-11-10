import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../services/http';

const mocks = vi.hoisted(() => ({ ensurePhone: vi.fn() }));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ ensurePhoneOrThrow: mocks.ensurePhone }),
}));

import { GuestPointsNote } from './guest-points-note';

const loginBtn = () => screen.getByRole('button', { name: 'Đăng nhập Zalo' });
const deferredLink = () => {
  let finish!: (phone: string | null) => void;
  let fail!: (e: unknown) => void;
  mocks.ensurePhone.mockImplementationOnce(() => new Promise<string | null>((resolve, reject) => { finish = resolve; fail = reject; }));
  return { finish: (phone: string | null) => finish(phone), fail: (e: unknown) => fail(e) };
};

describe('GuestPointsNote — khoá đồng bộ liên kết Zalo (W82A)', () => {
  beforeEach(() => mocks.ensurePhone.mockReset());

  it('hai cú chạm sát nhau (trước khi vẽ lại): chỉ mở luồng xin SĐT một lần, nút báo bận mà không bị disabled', async () => {
    const link = deferredLink();
    render(<GuestPointsNote />);
    const btn = loginBtn();
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mocks.ensurePhone).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));
    expect(btn).not.toBeDisabled();

    await act(async () => link.finish('0901234567'));
    await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
  });

  it('cú chạm thứ hai cách cú đầu một microtask vẫn chưa vẽ lại: vẫn một lần', async () => {
    deferredLink();
    render(<GuestPointsNote />);
    const btn = loginBtn();
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
      fireEvent.click(btn);
    });
    expect(mocks.ensurePhone).toHaveBeenCalledTimes(1);
  });

  it('khách từ chối chia sẻ SĐT: báo thử lại, nhả khoá, bấm lại liên kết được', async () => {
    const link = deferredLink();
    render(<GuestPointsNote />);
    await act(async () => {
      fireEvent.click(loginBtn());
      fireEvent.click(loginBtn());
    });
    await act(async () => link.finish(null));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa đăng nhập được Zalo. Bạn thử lại nhé.');
    expect(mocks.ensurePhone).toHaveBeenCalledTimes(1);

    mocks.ensurePhone.mockResolvedValueOnce('0901234567');
    fireEvent.click(loginBtn());
    await waitFor(() => expect(mocks.ensurePhone).toHaveBeenCalledTimes(2));
  });

  it('máy chủ từ chối (409): báo đúng lời máy chủ rồi liên kết lại được', async () => {
    const link = deferredLink();
    render(<GuestPointsNote />);
    await act(async () => {
      fireEvent.click(loginBtn());
      fireEvent.click(loginBtn());
    });
    await act(async () => link.fail(new HttpError('conflict', undefined, { status: 409, data: { message: 'Số điện thoại này đã gắn với tài khoản Zalo khác.' } })));
    expect(await screen.findByRole('alert')).toHaveTextContent('Số điện thoại này đã gắn với tài khoản Zalo khác.');
    expect(mocks.ensurePhone).toHaveBeenCalledTimes(1);

    mocks.ensurePhone.mockResolvedValueOnce('0901234567');
    fireEvent.click(loginBtn());
    await waitFor(() => expect(mocks.ensurePhone).toHaveBeenCalledTimes(2));
  });
});
