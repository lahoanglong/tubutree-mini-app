import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { supportCopy, type QuickReply } from '@tubutree/app-core/support-copy';
import { QuickReplies } from './quick-replies';

const ITEMS: QuickReply[] = [
  { label: 'Đơn của tôi đang ở đâu?', body: 'Đơn của tôi đang ở đâu?' },
  { label: 'Đổi trả hàng', body: 'Mình muốn hỏi về đổi trả hàng.' },
];
const group = () => screen.getByRole('group', { name: supportCopy.quickTitle });
const chips = () => within(group()).getAllByRole('button');

describe('QuickReplies: dải câu hỏi nhanh', () => {
  it('không có câu nào: không vẽ gì (không để lại dải trống có lề)', () => {
    const { container } = render(<QuickReplies items={[]} onPick={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('có câu: nhóm tên "Hỏi nhanh", mỗi câu là một nút theo đúng chữ', () => {
    render(<QuickReplies items={ITEMS} onPick={vi.fn()} />);
    expect(supportCopy.quickTitle).toBe('Hỏi nhanh');
    expect(chips().map((b) => b.textContent)).toEqual(ITEMS.map((q) => q.label));
    for (const b of chips()) expect(b).toHaveAttribute('type', 'button');
  });

  it('đúng một câu: vẫn vẽ nhóm với một nút (chỉ danh sách rỗng mới ẩn)', () => {
    render(<QuickReplies items={[ITEMS[0]!]} onPick={vi.fn()} />);
    expect(chips().map((b) => b.textContent)).toEqual([ITEMS[0]!.label]);
  });

  it('chạm một câu: gọi onPick đúng câu đó, đúng một lần', () => {
    const onPick = vi.fn();
    render(<QuickReplies items={ITEMS} onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đổi trả hàng' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(ITEMS[1]);
  });

  it('nền: mặc định là nền thanh nhập, inPane thì trong suốt để cùng nền khung tin', () => {
    const { rerender } = render(<QuickReplies items={ITEMS} onPick={vi.fn()} />);
    expect(group().style.background).toContain('--color-bg-surface');
    rerender(<QuickReplies items={ITEMS} onPick={vi.fn()} inPane />);
    expect(group().style.background).toBe('transparent');
  });

  it('chip cao tối thiểu 44px và rộng tối đa 24rem (cùng web)', () => {
    render(<QuickReplies items={ITEMS} onPick={vi.fn()} />);
    for (const b of chips()) {
      expect(b.style.minHeight).toBe('44px');
      expect(b.style.maxWidth).toBe('24rem');
    }
  });
});

describe('QuickReplies: khoá khi đang bận hoặc bị tắt', () => {
  it('bình thường: nút bật, con trỏ pointer, không mờ, nhóm không báo bận', () => {
    render(<QuickReplies items={ITEMS} onPick={vi.fn()} />);
    expect(group()).not.toHaveAttribute('aria-busy');
    for (const b of chips()) {
      expect(b).toBeEnabled();
      expect(b.style.cursor).toBe('pointer');
      expect(b.style.opacity).toBe('');
    }
  });

  it('disabled: mọi nút khoá, mờ 0.55, con trỏ not-allowed, chạm không gọi onPick; nhóm không báo bận', () => {
    const onPick = vi.fn();
    render(<QuickReplies items={ITEMS} onPick={onPick} disabled />);
    expect(group()).not.toHaveAttribute('aria-busy');
    for (const b of chips()) {
      expect(b).toBeDisabled();
      expect(b.style.cursor).toBe('not-allowed');
      expect(b.style.opacity).toBe('0.55');
      fireEvent.click(b);
    }
    expect(onPick).not.toHaveBeenCalled();
  });

  it('busy: nhóm aria-busy="true", mọi nút khoá, mờ 0.55, con trỏ not-allowed, chạm không gọi onPick', () => {
    const onPick = vi.fn();
    render(<QuickReplies items={ITEMS} onPick={onPick} busy />);
    expect(group()).toHaveAttribute('aria-busy', 'true');
    for (const b of chips()) {
      expect(b).toBeDisabled();
      expect(b.style.cursor).toBe('not-allowed');
      expect(b.style.opacity).toBe('0.55');
      fireEvent.click(b);
    }
    expect(onPick).not.toHaveBeenCalled();
  });

  it('busy rồi hết bận: nút mở lại và chạm gọi được onPick', () => {
    const onPick = vi.fn();
    const { rerender } = render(<QuickReplies items={ITEMS} onPick={onPick} busy />);
    rerender(<QuickReplies items={ITEMS} onPick={onPick} busy={false} />);
    expect(group()).not.toHaveAttribute('aria-busy');
    fireEvent.click(chips()[0]!);
    expect(onPick).toHaveBeenCalledWith(ITEMS[0]);
  });

  it('vừa disabled vừa busy: vẫn khoá và báo bận', () => {
    render(<QuickReplies items={ITEMS} onPick={vi.fn()} disabled busy />);
    expect(group()).toHaveAttribute('aria-busy', 'true');
    for (const b of chips()) expect(b).toBeDisabled();
  });

  it('inPane kết hợp busy: nền trong suốt và vẫn khoá', () => {
    render(<QuickReplies items={ITEMS} onPick={vi.fn()} inPane busy />);
    expect(group().style.background).toBe('transparent');
    for (const b of chips()) expect(b).toBeDisabled();
  });
});
