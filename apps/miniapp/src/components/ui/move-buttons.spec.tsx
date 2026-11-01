import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MoveButtons } from './move-buttons';

const base = { id: 'i1', name: 'Kem dưỡng', canUp: true, canDown: true, onMove: () => undefined };

describe('MoveButtons', () => {
  it('tên nút có tên món; khối thì có chữ "khối"', () => {
    const { rerender } = render(<MoveButtons {...base} />);
    expect(screen.getByRole('button', { name: 'Đưa Kem dưỡng lên' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đưa Kem dưỡng xuống' })).toBeInTheDocument();
    rerender(<MoveButtons {...base} name="Bếp xanh" scope="section" />);
    expect(screen.getByRole('button', { name: 'Đưa khối Bếp xanh lên' })).toBeInTheDocument();
  });

  it('còn dời được thì bấm gọi onMove với hướng, mang data-move-id/dir', () => {
    const onMove = vi.fn();
    render(<MoveButtons {...base} onMove={onMove} />);
    const down = screen.getByRole('button', { name: 'Đưa Kem dưỡng xuống' });
    expect(down).toHaveAttribute('data-move-id', 'i1');
    expect(down).toHaveAttribute('data-move-dir', 'down');
    fireEvent.click(down);
    expect(onMove).toHaveBeenCalledWith('down');
  });

  it('ở rìa: aria-disabled, không phải disabled; bấm không dời mà gọi onBlocked; vẫn nhận focus', () => {
    const onMove = vi.fn();
    const onBlocked = vi.fn();
    render(<MoveButtons {...base} canUp={false} onMove={onMove} onBlocked={onBlocked} />);
    const up = screen.getByRole('button', { name: 'Đưa Kem dưỡng lên' });
    expect(up).toHaveAttribute('aria-disabled', 'true');
    expect(up).not.toHaveAttribute('disabled');
    up.focus();
    expect(document.activeElement).toBe(up);
    fireEvent.click(up);
    expect(onMove).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledWith('up');
    expect(document.activeElement).toBe(up);
  });

  it('nút khác vẫn dời được khi một nút khoá', () => {
    const onMove = vi.fn();
    render(<MoveButtons {...base} canUp={false} onMove={onMove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đưa Kem dưỡng xuống' }));
    expect(onMove).toHaveBeenCalledWith('down');
  });

  it('vùng chạm vuông 44', () => {
    render(<MoveButtons {...base} />);
    for (const b of screen.getAllByRole('button')) {
      expect(parseFloat(b.style.minWidth)).toBeGreaterThanOrEqual(44);
      expect(parseFloat(b.style.minHeight)).toBeGreaterThanOrEqual(44);
    }
  });
});
