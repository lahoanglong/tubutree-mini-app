import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CouponPreviewDTO } from '@tubutree/shared-types';
import type { CouponDTO } from '@tubutree/app-core/api/loyalty';
import { pickerRows } from '@tubutree/app-core/commerce/voucher-picker';
import { VoucherPicker } from './voucher-picker';

const NOW = Date.parse('2026-11-01T05:00:00Z');
const END = '2099-01-01T00:00:00.000Z';
const coupon = (code: string, over: Partial<CouponDTO> = {}): CouponDTO => ({ code, type: 'AMOUNT', value: 20_000, minOrder: null, maxDiscount: null, endAt: END, ...over });
const WALLET = [
  coupon('OK'),
  coupon('APPLIED', { value: 5_000 }),
  coupon('SHORT', { minOrder: 500_000 }),
  coupon('SHIP', { type: 'FREESHIP', value: 0 }),
];
const rowsFor = (previews: CouponPreviewDTO[] = []) =>
  pickerRows(WALLET, { currentCode: 'APPLIED', subtotal: 150_000, shippingFee: 0, previews: new Map(previews.map((p) => [p.code, p])), now: NOW });
const props = (over: Partial<Parameters<typeof VoucherPicker>[0]> = {}) => ({ rows: rowsFor(), onUse: vi.fn(), onRemove: vi.fn(), ...over });

describe('VoucherPicker (Mini)', () => {
  it('mỗi nhóm một nhãn nút: Bỏ chọn (đang dùng), Dùng, Chưa đủ, Không áp dụng', () => {
    render(<VoucherPicker {...props()} />);
    const names = screen.getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['Bỏ chọn', 'Dùng', 'Chưa đủ', 'Không áp dụng']);
  });

  it('nút có tên đọc kèm mã', () => {
    render(<VoucherPicker {...props()} />);
    expect(screen.getByRole('button', { name: 'Dùng mã OK' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bỏ chọn mã APPLIED' })).toBeInTheDocument();
  });

  it('bấm Dùng gọi onUse(mã), bấm Bỏ chọn gọi onRemove; hai nút khoá không gọi gì', () => {
    const p = props();
    render(<VoucherPicker {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dùng mã OK' }));
    expect(p.onUse).toHaveBeenCalledWith('OK');
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ chọn mã APPLIED' }));
    expect(p.onRemove).toHaveBeenCalledTimes(1);
    for (const name of ['Chưa đủ điều kiện dùng mã SHORT', 'Không áp dụng mã SHIP']) {
      const b = screen.getByRole('button', { name });
      expect(b).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(b);
    }
    expect(p.onUse).toHaveBeenCalledTimes(1);
    expect(p.onRemove).toHaveBeenCalledTimes(1);
  });

  it('hàng đang dùng có chữ "Đang dùng"; hàng chưa đủ có lý do bằng chữ', () => {
    render(<VoucherPicker {...props()} />);
    expect(screen.getAllByTestId('voucher-selected')).toHaveLength(1);
    expect(within(screen.getAllByRole('listitem')[1]!).queryByTestId('voucher-reason')).toBeNull();
    expect(screen.getByText('Mua thêm 350k để dùng')).toBeInTheDocument();
    expect(screen.getByText('Đơn này đã miễn phí giao hàng')).toBeInTheDocument();
  });

  it('mức giảm máy chủ báo hiện ở hàng dùng được', () => {
    render(<VoucherPicker {...props({ rows: rowsFor([{ code: 'OK', eligible: true, discount: 20_000 }]) })} />);
    expect(screen.getByTestId('voucher-saving')).toHaveTextContent('Giảm 20.000đ cho đơn này');
  });

  it('busy: mọi nút aria-disabled (không aria-busy) và bấm không gọi gì', () => {
    const p = props({ busy: true });
    render(<VoucherPicker {...p} />);
    for (const b of screen.getAllByRole('button')) {
      expect(b).toHaveAttribute('aria-disabled', 'true');
      expect(b).not.toHaveAttribute('aria-busy');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Dùng mã OK' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ chọn mã APPLIED' }));
    expect(p.onUse).not.toHaveBeenCalled();
    expect(p.onRemove).not.toHaveBeenCalled();
  });

  it('pendingCode: chỉ nút của mã đó aria-busy', () => {
    render(<VoucherPicker {...props({ pendingCode: 'OK' })} />);
    expect(screen.getByRole('button', { name: 'Dùng mã OK' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Bỏ chọn mã APPLIED' })).not.toHaveAttribute('aria-busy');
  });

  it('không phần tử nào bị làm mờ (opacity < 1), kể cả hàng chưa đủ điều kiện và không áp dụng', () => {
    const { container } = render(<VoucherPicker {...props()} />);
    const dimmed = Array.from(container.querySelectorAll<HTMLElement>('*')).filter((el) => el.style.opacity !== '' && Number(el.style.opacity) < 1);
    expect(dimmed).toEqual([]);
  });

  it('danh sách có tên "Mã giảm giá của bạn"', () => {
    render(<VoucherPicker {...props()} />);
    expect(screen.getByRole('list', { name: 'Mã giảm giá của bạn' })).toBeInTheDocument();
  });
});
