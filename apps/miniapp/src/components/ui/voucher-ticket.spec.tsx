import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { VoucherView } from '@tubutree/app-core/commerce/voucher';
import { VoucherTicket } from './voucher-ticket';

const view = (patch: Partial<VoucherView> = {}): VoucherView => ({
  id: 'FUWA3E',
  code: 'FUWA3E',
  title: 'Giảm 15% (tối đa 45.000đ)',
  kind: 'discount',
  condition: 'Đơn từ 250k',
  expiry: 'Còn 2 ngày',
  state: 'collectable',
  ...patch,
});
const q = (id: string) => screen.queryByTestId(id);

describe('VoucherTicket', () => {
  it.each(['collectable', 'saved'] as const)('trạng thái %s: đúng một nút chính, bấm gọi onClick một lần', (state) => {
    const onClick = vi.fn();
    render(<VoucherTicket voucher={view({ state })} variant="ticket" primary={{ label: 'Dùng ngay', onClick }} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['used', 'Đã dùng'],
    ['expired', 'Đã hết hạn'],
    ['soldout', 'Đã hết lượt'],
  ] as const)('trạng thái %s: không có nút dù truyền primary, có dấu chữ "%s"', (state, stamp) => {
    render(<VoucherTicket voucher={view({ state })} variant="ticket" primary={{ label: 'Dùng ngay', onClick: vi.fn() }} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(stamp)).toBeVisible();
    expect(screen.getByRole('group')).toHaveAccessibleName(`Giảm 15% (tối đa 45.000đ), ${stamp}`);
  });

  it('ineligible: nút aria-disabled mô tả bằng reason, bấm không gọi onClick', () => {
    const onClick = vi.fn();
    render(<VoucherTicket voucher={view({ state: 'ineligible' })} variant="ticket" reason="Mua thêm 50k để dùng" primary={{ label: 'Dùng ngay', onClick }} />);
    const btn = screen.getByRole('button', { name: 'Dùng ngay' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).toHaveAccessibleDescription('Mua thêm 50k để dùng');
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('ineligible không có reason: mô tả bằng điều kiện của mã', () => {
    render(<VoucherTicket voucher={view({ state: 'ineligible' })} variant="ticket" primary={{ label: 'Dùng ngay', onClick: vi.fn() }} />);
    expect(screen.getByRole('button')).toHaveAccessibleDescription(/Đơn từ 250k/);
  });

  it('busy: aria-disabled + aria-busy, bấm hai lần không gọi', () => {
    const onClick = vi.fn();
    render(<VoucherTicket voucher={view()} variant="ticket" primary={{ label: 'Lưu mã', onClick, busy: true }} />);
    const btn = screen.getByRole('button', { name: 'Lưu mã' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('không đơn tối thiểu và không hạn: không dòng trống, dòng meta không có dấu "·" thừa', () => {
    render(<VoucherTicket voucher={view({ condition: '', expiry: '' })} variant="ticket" />);
    expect(q('voucher-expiry')).toBeNull();
    expect(q('voucher-meta')!.textContent).toBe('FUWA3E');
  });

  it('có đủ điều kiện, mã và hạn: meta "Đơn từ 250k · FUWA3E" và dòng hạn riêng', () => {
    render(<VoucherTicket voucher={view()} variant="ticket" />);
    expect(q('voucher-meta')!.textContent).toBe('Đơn từ 250k · FUWA3E');
    expect(q('voucher-expiry')!.textContent).toBe('Còn 2 ngày');
  });

  it('ticket và row: mã là một khối không ngắt giữa chừng, meta không nowrap/ellipsis (hẹp thì xuống dòng, không cắt điều kiện hay mã)', () => {
    render(<VoucherTicket voucher={view({ condition: 'Đơn từ 500k', code: 'CHUADU' })} variant="ticket" primary={{ label: 'Dùng ngay', onClick: vi.fn() }} />);
    const code = q('voucher-code')!;
    expect(code.textContent).toBe('CHUADU');
    expect(code.style.whiteSpace).toBe('nowrap');
    const meta = q('voucher-meta')!;
    expect(meta.textContent).toBe('Đơn từ 500k · CHUADU');
    expect(meta.style.whiteSpace).toBe('');
    expect(meta.style.textOverflow).toBe('');
  });

  it('chip chỉ có tiêu đề và điều kiện: không mã; ticket và row vẫn có mã', () => {
    const { rerender } = render(<VoucherTicket voucher={view()} variant="chip" />);
    expect(q('voucher-meta')!.textContent).toBe('Đơn từ 250k');
    expect(q('voucher-meta')!.style.whiteSpace).toBe('nowrap');
    expect(q('voucher-meta')!.style.textOverflow).toBe('ellipsis');
    expect(q('voucher-code')).toBeNull();
    rerender(<VoucherTicket voucher={view({ condition: '' })} variant="chip" />);
    expect(q('voucher-meta')).toBeNull();
    rerender(<VoucherTicket voucher={view()} variant="row" />);
    expect(q('voucher-meta')!.textContent).toBe('Đơn từ 250k · FUWA3E');
  });

  it('expiring: dòng hạn tông cảnh báo; không thì chữ phụ', () => {
    const { rerender } = render(<VoucherTicket voucher={view()} variant="ticket" expiring />);
    expect(q('voucher-expiry')!.style.color).toBe('var(--color-status-warning-fg)');
    rerender(<VoucherTicket voucher={view()} variant="ticket" />);
    expect(q('voucher-expiry')!.style.color).toBe('var(--color-text-tertiary)');
  });

  it('tiêu đề rất dài vẫn còn nút: thân co được (min-width 0), nút không co', () => {
    render(<VoucherTicket voucher={view({ title: 'Giảm 15% (tối đa 45.000đ) cho mọi đơn hàng mỹ phẩm thiên nhiên của thương hiệu' })} variant="ticket" primary={{ label: 'Lưu mã', onClick: vi.fn() }} />);
    expect(q('voucher-body')!.style.minWidth).toBe('0px');
    expect(screen.getByRole('button', { name: 'Lưu mã' }).style.flex).toBe('0 0 auto');
  });

  it('onDetail: thân là nút anh em của nút chính (không lồng), bấm thân không gọi primary', () => {
    const onDetail = vi.fn();
    const onClick = vi.fn();
    const { container } = render(<VoucherTicket voucher={view()} variant="ticket" onDetail={onDetail} primary={{ label: 'Lưu mã', onClick }} />);
    expect(container.querySelector('button button')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(q('voucher-body')!.tagName).toBe('BUTTON');
    fireEvent.click(q('voucher-body')!);
    expect(onDetail).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('cuống ba loại dùng đúng biến màu', () => {
    const { rerender } = render(<VoucherTicket voucher={view({ kind: 'discount' })} variant="ticket" />);
    expect(q('voucher-stub')!.style.background).toBe('var(--color-voucher-stub-bg)');
    rerender(<VoucherTicket voucher={view({ kind: 'freeship' })} variant="ticket" />);
    expect(q('voucher-stub')!.style.background).toBe('var(--color-voucher-ship-bg)');
    rerender(<VoucherTicket voucher={view({ kind: 'shop' })} variant="ticket" />);
    expect(q('voucher-stub')!.style.background).toBe('var(--color-voucher-shop-stub-bg)');
  });

  it('đã dùng: cuống xám (--color-bg-chip)', () => {
    render(<VoucherTicket voucher={view({ state: 'used' })} variant="ticket" />);
    expect(q('voucher-stub')!.style.background).toBe('var(--color-bg-chip)');
  });

  it('ticket cao tối thiểu 88px, có cuống; chip cao tối thiểu 44px không cuống; row cao tối thiểu 56px không cuống', () => {
    const { container, rerender } = render(<VoucherTicket voucher={view()} variant="ticket" />);
    expect((container.firstElementChild as HTMLElement).style.minHeight).toBe('88px');
    expect(q('voucher-stub')).not.toBeNull();
    rerender(<VoucherTicket voucher={view()} variant="chip" />);
    expect((container.firstElementChild as HTMLElement).style.minHeight).toBe('44px');
    expect(q('voucher-stub')).toBeNull();
    rerender(<VoucherTicket voucher={view()} variant="row" />);
    expect((container.firstElementChild as HTMLElement).style.minHeight).toBe('56px');
    expect(q('voucher-stub')).toBeNull();
  });

  it.each(['ticket', 'chip', 'row'] as const)('%s: mọi nút có vùng chạm 44px', (variant) => {
    render(<VoucherTicket voucher={view()} variant={variant} onDetail={() => {}} primary={{ label: 'Lưu', onClick: vi.fn() }} />);
    for (const b of screen.getAllByRole('button')) {
      expect(b.className.includes('tubu-hit-44') || b.style.minHeight === '44px', b.textContent ?? '').toBe(true);
    }
  });

  it('icon cuống aria-hidden', () => {
    render(<VoucherTicket voucher={view({ kind: 'freeship' })} variant="ticket" />);
    expect(q('voucher-stub')!.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
