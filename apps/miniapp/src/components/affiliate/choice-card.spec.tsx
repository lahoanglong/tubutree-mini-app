import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ChoiceCard } from './choice-card';

describe('ChoiceCard — thẻ chọn một phương án', () => {
  it('là nút thật có tên gồm tiêu đề và mô tả, báo trạng thái chọn bằng aria-pressed', () => {
    const { rerender } = render(<ChoiceCard active={false} title="Ví Tubu" sub="Nhận ngay" onPress={() => {}} />);
    const btn = screen.getByRole('button', { name: /Ví Tubu/ });
    expect(btn).toHaveAccessibleName('Ví Tubu Nhận ngay');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    rerender(<ChoiceCard active title="Ví Tubu" sub="Nhận ngay" onPress={() => {}} />);
    expect(screen.getByRole('button', { name: /Ví Tubu/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('chạm gọi onPress, vùng chạm cao ít nhất 44px', () => {
    const onPress = vi.fn();
    render(<ChoiceCard active={false} title="COD" sub="Thu khi giao" onPress={onPress} />);
    const btn = screen.getByRole('button', { name: /COD/ });
    fireEvent.click(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(btn.style.minHeight).toBe('44px');
  });

  it('thẻ đang chọn dùng token viền chọn, thẻ chưa chọn dùng viền nhạt', () => {
    const { rerender } = render(<ChoiceCard active title="A" sub="a" onPress={() => {}} />);
    expect(screen.getByRole('button').style.border).toContain('var(--color-border-selected)');
    rerender(<ChoiceCard active={false} title="A" sub="a" onPress={() => {}} />);
    expect(screen.getByRole('button').style.border).toContain('var(--color-border-subtle)');
  });
});
