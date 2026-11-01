import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PdpOffersSheet } from './pdp-offers-sheet';

const END = '2099-01-01T00:00:00.000Z';
const coupons = [
  { code: 'FREESHIP', type: 'FREESHIP' as const, value: 0, minOrder: 99_000, maxDiscount: null, endAt: END },
  { code: 'XANH10', type: 'PERCENT' as const, value: 10, minOrder: 250_000, maxDiscount: 30_000, endAt: END },
  { code: 'GIAM20K', type: 'AMOUNT' as const, value: 20_000, minOrder: null, maxDiscount: null, endAt: END },
];

describe('PdpOffersSheet', () => {
  it('mở thành hộp thoại "Mã giảm giá" với mỗi mã một VoucherTicket row và một nút Sao chép đúng mã', () => {
    const onCopy = vi.fn();
    render(<PdpOffersSheet open onClose={() => undefined} coupons={coupons} onCopy={onCopy} />);
    const dialog = screen.getByRole('dialog', { name: 'Mã giảm giá' });
    expect(within(dialog).getAllByRole('group')).toHaveLength(3);
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Sao chép' })[1]!);
    expect(onCopy).toHaveBeenCalledWith('XANH10');
    expect(within(dialog).getByText('Mỗi đơn dùng 1 mã')).toBeInTheDocument();
  });

  it('đóng thì không có hộp thoại', () => {
    render(<PdpOffersSheet open={false} onClose={() => undefined} coupons={coupons} onCopy={() => undefined} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
