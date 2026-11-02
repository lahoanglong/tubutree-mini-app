import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PdpOffersSheet } from './pdp-offers-sheet';

const END = '2099-01-01T00:00:00.000Z';
const coupons = [
  { code: 'FREESHIP', type: 'FREESHIP' as const, value: 0, minOrder: 99_000, maxDiscount: null, endAt: END },
  { code: 'XANH10', type: 'PERCENT' as const, value: 10, minOrder: 250_000, maxDiscount: 30_000, endAt: END },
  { code: 'GIAM20K', type: 'AMOUNT' as const, value: 20_000, minOrder: null, maxDiscount: null, endAt: END },
];

// Tên đọc của phiếu là "tiêu đề, hạn dùng"; tiêu đề phần trăm tự có dấu phẩy ("Giảm 10%, tối đa 30k").
const order = (dialog: HTMLElement, titles: string[]) =>
  expect(within(dialog).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(titles.map((t) => expect.stringMatching(new RegExp(`^${t}`))));

describe('PdpOffersSheet', () => {
  it('mở thành hộp thoại "Mã giảm giá" với mỗi mã một VoucherTicket row và một nút Sao chép đúng mã', () => {
    const onCopy = vi.fn();
    render(<PdpOffersSheet open onClose={() => undefined} coupons={coupons} amount={120_000} onCopy={onCopy} />);
    const dialog = screen.getByRole('dialog', { name: 'Mã giảm giá' });
    expect(within(dialog).getAllByRole('group')).toHaveLength(3);
    const copy = within(dialog).getAllByRole('button', { name: 'Sao chép' });
    expect(copy).toHaveLength(3);
    // amount 120k: GIAM20K (giảm 20k) rồi FREESHIP (đủ điều kiện) rồi XANH10 (chưa đủ), nên nút thứ hai là FREESHIP.
    fireEvent.click(copy[1]!);
    expect(onCopy).toHaveBeenCalledWith('FREESHIP');
    expect(within(dialog).getByText('Mỗi đơn dùng 1 mã')).toBeInTheDocument();
  });

  it('xếp theo lợi cho món đang xem: mã đủ điều kiện giảm nhiều trước, mã chưa đủ sau kèm "Mua thêm … để dùng"', () => {
    render(<PdpOffersSheet open onClose={() => undefined} coupons={coupons} amount={120_000} onCopy={() => undefined} />);
    const dialog = screen.getByRole('dialog');
    order(dialog, ['Giảm 20k', 'Miễn phí giao hàng', 'Giảm 10%, tối đa 30k']);
    expect(within(dialog).getByText('Mua thêm 130k để dùng')).toBeInTheDocument();
    expect(within(dialog).queryAllByText(/Mua thêm/)).toHaveLength(1);
  });

  it('món đủ giá: không còn dòng "Mua thêm", mã giảm nhiều nhất lên đầu', () => {
    render(<PdpOffersSheet open onClose={() => undefined} coupons={coupons} amount={300_000} onCopy={() => undefined} />);
    const dialog = screen.getByRole('dialog');
    order(dialog, ['Giảm 10%, tối đa 30k', 'Giảm 20k', 'Miễn phí giao hàng']);
    expect(within(dialog).queryByText(/Mua thêm/)).toBeNull();
  });

  it('mã chưa đủ vẫn chép được (khách còn mua thêm món khác trong cùng đơn)', () => {
    const onCopy = vi.fn();
    render(<PdpOffersSheet open onClose={() => undefined} coupons={[coupons[1]!]} amount={50_000} onCopy={onCopy} />);
    const copy = screen.getByRole('button', { name: 'Sao chép' });
    expect(copy).not.toHaveAttribute('aria-disabled');
    fireEvent.click(copy);
    expect(onCopy).toHaveBeenCalledWith('XANH10');
  });

  it('đóng thì không có hộp thoại', () => {
    render(<PdpOffersSheet open={false} onClose={() => undefined} coupons={coupons} amount={120_000} onCopy={() => undefined} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
