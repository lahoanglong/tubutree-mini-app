import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ recordReferralTouch: vi.fn() }));
vi.mock('../../services/affiliate-api', () => ({ recordReferralTouch: mocks.recordReferralTouch }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { ReferralCodeBox, effectiveReferralCode } from './referral-code-box';

function setup(props: Partial<React.ComponentProps<typeof ReferralCodeBox>> = {}) {
  const onApplied = vi.fn();
  const utils = render(<ReferralCodeBox linkedCode={null} appliedCode={null} onApplied={onApplied} {...props} />);
  return { onApplied, ...utils };
}
const input = () => screen.getByPlaceholderText('Nhập mã người giới thiệu') as HTMLInputElement;

describe('ReferralCodeBox — ô nhập mã giới thiệu CTV ở checkout (C-020)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mặc định thu gọn: 1 dòng mời nhập, chưa có ô nhập', () => {
    setup();
    expect(screen.getByText('Mã người giới thiệu')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Nhập mã người giới thiệu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Nhập mã'));
    expect(input()).toBeInTheDocument();
  });

  it('nhãn "Nhập mã" không xuống dòng ở màn hẹp: giữ nguyên kích thước, dòng mô tả bên trái co lại (R5-BUYER-5)', () => {
    setup();
    const label = screen.getByText('Nhập mã');
    expect(label.style.whiteSpace).toBe('nowrap');
    expect(label.parentElement!.style.flexShrink).toBe('0');
    expect(screen.getByText('Mã người giới thiệu').parentElement!.parentElement!.style.minWidth).toBe('0px');
  });

  it('đã có mã từ link CTV/gian hàng → hiện cố định, KHÔNG cho nhập đè (tránh lệch slug gian hàng với người nhận hoa hồng)', () => {
    setup({ linkedCode: 'ab12cd34' });
    expect(screen.getByText('AB12CD34')).toBeInTheDocument();
    expect(screen.queryByText('Nhập mã')).not.toBeInTheDocument();
    expect(screen.queryByText('Đổi')).not.toBeInTheDocument();
  });

  it('mã hợp lệ: chuẩn hoá HOA + bỏ khoảng trắng, xác nhận qua /affiliate/touch rồi báo lên checkout', async () => {
    mocks.recordReferralTouch.mockResolvedValue({ ok: true });
    const { onApplied } = setup();
    fireEvent.click(screen.getByText('Nhập mã'));
    fireEvent.change(input(), { target: { value: '  ab12 cd34 ' } });
    fireEvent.click(screen.getByText('Áp dụng'));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith('AB12CD34'));
    expect(mocks.recordReferralTouch).toHaveBeenCalledWith({ referralCode: 'AB12CD34', kind: 'ctv' });
  });

  it('mã không tìm thấy / mã của chính mình (server trả ok:false) → báo lỗi, không áp dụng', async () => {
    mocks.recordReferralTouch.mockResolvedValue({ ok: false });
    const { onApplied } = setup();
    fireEvent.click(screen.getByText('Nhập mã'));
    fireEvent.change(input(), { target: { value: 'ZZZZ9999' } });
    fireEvent.click(screen.getByText('Áp dụng'));
    expect(await screen.findByText(/Không tìm thấy mã này/)).toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('ô nhập có nhãn truy cập riêng cho trình đọc màn hình (không chỉ placeholder)', () => {
    setup();
    fireEvent.click(screen.getByText('Nhập mã'));
    expect(input()).toHaveAttribute('aria-label', 'Mã người giới thiệu');
  });

  it('ô trống → nhắc nhập, không gọi server', () => {
    const { onApplied } = setup();
    fireEvent.click(screen.getByText('Nhập mã'));
    fireEvent.click(screen.getByText('Áp dụng'));
    expect(screen.getByText(/Bạn nhập mã người giới thiệu giúp Tubu nhé/)).toBeInTheDocument();
    expect(mocks.recordReferralTouch).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('lỗi mạng/máy chủ → hiện thông báo lỗi, vẫn cho thử lại', async () => {
    mocks.recordReferralTouch.mockRejectedValue(new Error('boom'));
    const { onApplied } = setup();
    fireEvent.click(screen.getByText('Nhập mã'));
    fireEvent.change(input(), { target: { value: 'AB12CD34' } });
    fireEvent.click(screen.getByText('Áp dụng'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onApplied).not.toHaveBeenCalled();
    expect(input()).toHaveValue('AB12CD34');
  });

  it('đã áp dụng: hiện mã + nút Đổi; Huỷ giữ nguyên mã cũ, đổi sang mã mới hợp lệ thì báo mã mới', async () => {
    mocks.recordReferralTouch.mockResolvedValue({ ok: true });
    const { onApplied } = setup({ appliedCode: 'AB12CD34' });
    expect(screen.getByText('AB12CD34')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Đổi'));
    fireEvent.click(screen.getByText('Huỷ'));
    expect(screen.getByText('AB12CD34')).toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Đổi'));
    fireEvent.change(input(), { target: { value: 'ff00ee11' } });
    fireEvent.click(screen.getByText('Áp dụng'));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith('FF00EE11'));
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const REGION = { name: 'Mã người giới thiệu' };
const submitButton = () => screen.getByRole('button', { name: 'Áp dụng' });
const cancelButton = () => screen.getByRole('button', { name: 'Huỷ' });
function openAndType(value = 'ab12cd34') {
  fireEvent.click(screen.getByText('Nhập mã'));
  fireEvent.change(input(), { target: { value } });
}

describe('ReferralCodeBox — vùng có tên cho trình đọc màn hình (W59B)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('thu gọn, đã có mã và đang nhập đều nằm trong vùng "Mã người giới thiệu"', () => {
    const collapsed = setup();
    expect(screen.getByRole('region', REGION).tagName).toBe('SECTION');
    fireEvent.click(screen.getByText('Nhập mã'));
    expect(screen.getByRole('region', REGION)).toContainElement(input());
    collapsed.unmount();

    setup({ linkedCode: 'ab12cd34' });
    expect(screen.getByRole('region', REGION)).toHaveTextContent('AB12CD34');
  });
});

describe('ReferralCodeBox — liên kết ô nhập với dòng lỗi (W59B)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('chưa có lỗi: ô nhập không báo aria-invalid/aria-describedby', () => {
    setup();
    fireEvent.click(screen.getByText('Nhập mã'));
    expect(input()).not.toHaveAttribute('aria-invalid');
    expect(input()).not.toHaveAttribute('aria-describedby');
  });

  it('ô trống → ô nhập aria-invalid và aria-describedby trỏ đúng vùng role=alert', () => {
    setup();
    fireEvent.click(screen.getByText('Nhập mã'));
    fireEvent.click(submitButton());
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('id', 'referral-code-error');
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    expect(input()).toHaveAttribute('aria-describedby', 'referral-code-error');
    expect(document.getElementById(input().getAttribute('aria-describedby')!)).toBe(alert);
  });

  it('server trả ok:false và lỗi mạng đều gắn aria-invalid + aria-describedby', async () => {
    mocks.recordReferralTouch.mockResolvedValueOnce({ ok: false });
    setup();
    openAndType();
    fireEvent.click(submitButton());
    await screen.findByText(/Không tìm thấy mã này/);
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    expect(input()).toHaveAttribute('aria-describedby', 'referral-code-error');

    mocks.recordReferralTouch.mockRejectedValueOnce(new Error('boom'));
    fireEvent.change(input(), { target: { value: 'ZZ99' } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    expect(input()).toHaveAttribute('aria-describedby', 'referral-code-error');
  });

  it('gõ lại thì lỗi và hai thuộc tính aria biến mất', () => {
    setup();
    fireEvent.click(screen.getByText('Nhập mã'));
    fireEvent.click(submitButton());
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.change(input(), { target: { value: 'a' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input()).not.toHaveAttribute('aria-invalid');
    expect(input()).not.toHaveAttribute('aria-describedby');
  });
});

describe('ReferralCodeBox — phím Enter trong ô nhập (W59B)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('Enter gọi apply: chuẩn hoá mã rồi xác nhận qua /affiliate/touch', async () => {
    mocks.recordReferralTouch.mockResolvedValue({ ok: true });
    const { onApplied } = setup();
    openAndType('  ab12 cd34 ');
    const notPrevented = fireEvent.keyDown(input(), { key: 'Enter' });
    expect(notPrevented).toBe(false);
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith('AB12CD34'));
    expect(mocks.recordReferralTouch).toHaveBeenCalledTimes(1);
    expect(mocks.recordReferralTouch).toHaveBeenCalledWith({ referralCode: 'AB12CD34', kind: 'ctv' });
  });

  it('Enter ở ô trống nhắc nhập, không gọi server', () => {
    setup();
    fireEvent.click(screen.getByText('Nhập mã'));
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByText(/Bạn nhập mã người giới thiệu giúp Tubu nhé/)).toBeInTheDocument();
    expect(mocks.recordReferralTouch).not.toHaveBeenCalled();
  });

  it('phím khác Enter không gửi mã và không bị chặn mặc định', () => {
    setup();
    openAndType();
    const notPrevented = fireEvent.keyDown(input(), { key: 'a' });
    expect(notPrevented).toBe(true);
    expect(mocks.recordReferralTouch).not.toHaveBeenCalled();
  });

  it('Enter lúc bộ gõ đang ghép chữ (isComposing hoặc keyCode 229) chỉ chốt chữ, không gửi mã', () => {
    setup();
    openAndType();
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input(), { key: 'Enter', keyCode: 229 });
    expect(mocks.recordReferralTouch).not.toHaveBeenCalled();
  });
});

describe('ReferralCodeBox — khoá bận khi đang kiểm tra mã (W59B)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('đang chờ server: ô nhập + Huỷ khoá, Áp dụng báo bận; Enter và bấm lại không gọi server lần hai', async () => {
    const gate = deferred<{ ok: boolean }>();
    mocks.recordReferralTouch.mockReturnValue(gate.promise);
    const { onApplied } = setup();
    openAndType();
    fireEvent.click(submitButton());

    await waitFor(() => expect(input()).toBeDisabled());
    expect(cancelButton()).toBeDisabled();
    expect(submitButton()).toHaveAttribute('aria-busy', 'true');
    expect(submitButton()).toHaveAttribute('aria-disabled', 'true');

    fireEvent.keyDown(input(), { key: 'Enter' });
    fireEvent.click(submitButton());
    fireEvent.click(cancelButton());
    expect(mocks.recordReferralTouch).toHaveBeenCalledTimes(1);
    expect(input()).toBeInTheDocument();

    gate.resolve({ ok: true });
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith('AB12CD34'));
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it('server báo lỗi thì mở khoá lại: ô nhập gõ được, Huỷ bấm được, Áp dụng hết báo bận', async () => {
    const gate = deferred<{ ok: boolean }>();
    mocks.recordReferralTouch.mockReturnValue(gate.promise);
    setup();
    openAndType();
    fireEvent.click(submitButton());
    await waitFor(() => expect(input()).toBeDisabled());

    gate.reject(new Error('boom'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(input()).toBeEnabled();
    expect(cancelButton()).toBeEnabled();
    expect(submitButton()).not.toHaveAttribute('aria-busy');
    expect(input()).toHaveValue('ab12cd34');
  });

  it('lỗi xong thì focus về ô nhập (Chromium thả focus khi ô bị khoá lúc kiểm tra; jsdom không, nên đẩy focus sang nút phụ)', async () => {
    const gate = deferred<{ ok: boolean }>();
    mocks.recordReferralTouch.mockReturnValue(gate.promise);
    setup();
    openAndType();
    input().focus();
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(input()).toBeDisabled());
    const sink = document.createElement('button');
    document.body.appendChild(sink);
    sink.focus();
    expect(sink).toHaveFocus();

    gate.resolve({ ok: false });
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    await waitFor(() => expect(input()).toHaveFocus());
    sink.remove();
  });

  it('Huỷ khi rảnh vẫn đóng ô nhập', () => {
    setup();
    openAndType();
    fireEvent.click(cancelButton());
    expect(screen.queryByPlaceholderText('Nhập mã người giới thiệu')).not.toBeInTheDocument();
    expect(screen.getByText('Nhập mã')).toBeInTheDocument();
  });
});

describe('ReferralCodeBox — khoá đồng bộ chống chạm đúp (W81A)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hai cú bấm "Áp dụng" trong cùng một khung hình, chưa kịp vẽ lại: chỉ gọi /affiliate/touch một lần', async () => {
    const gate = deferred<{ ok: boolean }>();
    mocks.recordReferralTouch.mockReturnValue(gate.promise);
    const { onApplied } = setup();
    openAndType();
    const button = submitButton();
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(mocks.recordReferralTouch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
    await act(async () => gate.resolve({ ok: true }));
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it('bấm "Áp dụng" rồi Enter trong cùng một khung hình: chỉ gọi một lần', async () => {
    const gate = deferred<{ ok: boolean }>();
    mocks.recordReferralTouch.mockReturnValue(gate.promise);
    setup();
    openAndType();
    await act(async () => {
      fireEvent.click(submitButton());
      fireEvent.keyDown(input(), { key: 'Enter' });
    });
    expect(mocks.recordReferralTouch).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve({ ok: false }));
  });

  it('Enter hai lần liền (không phải giữ phím) trong cùng một khung hình: chỉ gọi một lần', async () => {
    const gate = deferred<{ ok: boolean }>();
    mocks.recordReferralTouch.mockReturnValue(gate.promise);
    setup();
    openAndType();
    await act(async () => {
      fireEvent.keyDown(input(), { key: 'Enter' });
      fireEvent.keyDown(input(), { key: 'Enter' });
    });
    expect(mocks.recordReferralTouch).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve({ ok: false }));
  });

  it('lỗi mạng thì nhả khoá: bấm lại gọi lần hai; mã không tìm thấy (ok:false) cũng nhả khoá', async () => {
    mocks.recordReferralTouch
      .mockRejectedValueOnce(new Error('mạng'))
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue({ ok: true });
    const { onApplied } = setup();
    openAndType();
    await act(async () => {
      fireEvent.click(submitButton());
    });
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(submitButton());
    });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Không tìm thấy mã này/));
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(mocks.recordReferralTouch).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith('AB12CD34'));
  });

  it('ô trống: không giữ khoá, gõ mã rồi bấm lại gọi được', async () => {
    mocks.recordReferralTouch.mockResolvedValue({ ok: true });
    setup();
    openAndType('');
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(mocks.recordReferralTouch).not.toHaveBeenCalled();
    fireEvent.change(input(), { target: { value: 'ab12cd34' } });
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(mocks.recordReferralTouch).toHaveBeenCalledTimes(1);
  });
});

describe('ReferralCodeBox — prop disabled khi đơn đang gửi (W59B)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('thu gọn: nút Nhập mã bị khoá, bấm không mở ô nhập', () => {
    setup({ disabled: true });
    const trigger = screen.getByText('Nhập mã').closest('button')!;
    expect(trigger).toBeDisabled();
    expect(trigger.style.opacity).toBe('0.6');
    expect(trigger.style.cursor).toBe('not-allowed');
    fireEvent.click(trigger);
    expect(screen.queryByPlaceholderText('Nhập mã người giới thiệu')).not.toBeInTheDocument();
  });

  it('mặc định không khoá: nút Nhập mã bấm được, đủ độ rõ và con trỏ tay', () => {
    setup();
    const trigger = screen.getByText('Nhập mã').closest('button')!;
    expect(trigger).toBeEnabled();
    expect(trigger.style.opacity).toBe('1');
    expect(trigger.style.cursor).toBe('pointer');
  });

  it('đã áp dụng: nút Đổi bị khoá, bấm không mở ô nhập; mã vẫn hiện', () => {
    setup({ appliedCode: 'AB12CD34', disabled: true });
    expect(screen.getByRole('button', { name: 'Đổi' })).toBeDisabled();
    fireEvent.click(screen.getByText('Đổi'));
    expect(screen.queryByPlaceholderText('Nhập mã người giới thiệu')).not.toBeInTheDocument();
    expect(screen.getByText('AB12CD34')).toBeInTheDocument();
  });

  it('đã áp dụng, không khoá: nút Đổi bấm được', () => {
    setup({ appliedCode: 'AB12CD34' });
    expect(screen.getByRole('button', { name: 'Đổi' })).toBeEnabled();
  });

  it('đang mở ô nhập mà đơn bắt đầu gửi: ô nhập + Huỷ + Áp dụng đều khoá, Enter không gọi server', () => {
    const onApplied = vi.fn();
    const { rerender } = render(<ReferralCodeBox linkedCode={null} appliedCode={null} onApplied={onApplied} />);
    openAndType();
    rerender(<ReferralCodeBox linkedCode={null} appliedCode={null} onApplied={onApplied} disabled />);

    expect(input()).toBeDisabled();
    expect(cancelButton()).toBeDisabled();
    expect(submitButton()).toBeDisabled();
    fireEvent.keyDown(input(), { key: 'Enter' });
    fireEvent.click(cancelButton());
    expect(mocks.recordReferralTouch).not.toHaveBeenCalled();
    expect(input()).toBeInTheDocument();

    rerender(<ReferralCodeBox linkedCode={null} appliedCode={null} onApplied={onApplied} />);
    expect(input()).toBeEnabled();
    expect(cancelButton()).toBeEnabled();
  });
});

describe('effectiveReferralCode — mã gửi kèm đơn', () => {
  it('mã khách vừa nhập thắng mã từ link; không có gì thì undefined', () => {
    expect(effectiveReferralCode('AB12CD34', 'LINKCODE')).toBe('AB12CD34');
    expect(effectiveReferralCode(null, 'LINKCODE')).toBe('LINKCODE');
    expect(effectiveReferralCode(null, null)).toBeUndefined();
  });
});
