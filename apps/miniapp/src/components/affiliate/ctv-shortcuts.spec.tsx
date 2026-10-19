import { render, screen, fireEvent, within } from '@testing-library/react';
import { Link2, Receipt, Store, Wallet } from 'lucide-react';
import { describe, it, expect, vi } from 'vitest';
import { CtvShortcuts, type CtvShortcut } from './ctv-shortcuts';

function items(over: Partial<Record<string, Partial<CtvShortcut>>> = {}): CtvShortcut[] {
  return [
    { key: 'share', label: 'Chia sẻ', ariaLabel: 'Chia sẻ link và mã giới thiệu', icon: Link2, onPress: vi.fn(), ...over.share },
    { key: 'store', label: 'Gian hàng', ariaLabel: 'Gian hàng của tôi', icon: Store, onPress: vi.fn(), ...over.store },
    { key: 'order', label: 'Lên đơn hộ', ariaLabel: 'Lên đơn hộ khách', icon: Receipt, onPress: vi.fn(), ...over.order },
    { key: 'withdraw', label: 'Rút tiền', ariaLabel: 'Rút tiền hoa hồng', icon: Wallet, onPress: vi.fn(), ...over.withdraw },
  ];
}

describe('CtvShortcuts — hàng lối tắt dưới thẻ hoa hồng', () => {
  it('bốn nút thật theo thứ tự, nhãn hiển thị ngắn còn tên đọc đầy đủ và chứa nhãn hiển thị', () => {
    render(<CtvShortcuts items={items()} />);
    const buttons = within(screen.getByRole('group', { name: 'Lối tắt của CTV' })).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Chia sẻ link và mã giới thiệu',
      'Gian hàng của tôi',
      'Lên đơn hộ khách',
      'Rút tiền hoa hồng',
    ]);
    expect(buttons.map((b) => b.textContent)).toEqual(['Chia sẻ', 'Gian hàng', 'Lên đơn hộ', 'Rút tiền']);
    for (const b of buttons) expect(b.getAttribute('aria-label')).toContain(b.textContent);
  });

  it('mỗi nút cao ít nhất 44px, chia đều cột theo số nút', () => {
    const { rerender } = render(<CtvShortcuts items={items()} />);
    for (const b of screen.getAllByRole('button')) expect(parseInt(b.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
    expect(screen.getByRole('group').style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
    rerender(<CtvShortcuts items={items().slice(0, 3)} />);
    expect(screen.getByRole('group').style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
  });

  it('chạm gọi đúng onPress', () => {
    const list = items();
    render(<CtvShortcuts items={list} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gian hàng của tôi' }));
    expect(list[1]!.onPress).toHaveBeenCalledTimes(1);
    expect(list[0]!.onPress).not.toHaveBeenCalled();
  });

  it('nút bị khoá: disabled thật, chạm không gọi onPress', () => {
    const list = items({ withdraw: { disabled: true } });
    render(<CtvShortcuts items={list} />);
    const btn = screen.getByRole('button', { name: 'Rút tiền hoa hồng' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(list[3]!.onPress).not.toHaveBeenCalled();
  });
});
