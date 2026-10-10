import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
const input = () => screen.getByPlaceholderText('Nhập mã giới thiệu') as HTMLInputElement;

describe('ReferralCodeBox — ô nhập mã giới thiệu CTV ở checkout (C-020)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mặc định thu gọn: 1 dòng mời nhập, chưa có ô nhập', () => {
    setup();
    expect(screen.getByText('Mã giới thiệu')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Nhập mã giới thiệu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Nhập mã'));
    expect(input()).toBeInTheDocument();
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
    expect(input()).toHaveAttribute('aria-label', 'Mã giới thiệu');
  });

  it('ô trống → nhắc nhập, không gọi server', () => {
    const { onApplied } = setup();
    fireEvent.click(screen.getByText('Nhập mã'));
    fireEvent.click(screen.getByText('Áp dụng'));
    expect(screen.getByText(/Bạn nhập mã giới thiệu giúp Tubu nhé/)).toBeInTheDocument();
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

describe('effectiveReferralCode — mã gửi kèm đơn', () => {
  it('mã khách vừa nhập thắng mã từ link; không có gì thì undefined', () => {
    expect(effectiveReferralCode('AB12CD34', 'LINKCODE')).toBe('AB12CD34');
    expect(effectiveReferralCode(null, 'LINKCODE')).toBe('LINKCODE');
    expect(effectiveReferralCode(null, null)).toBeUndefined();
  });
});
