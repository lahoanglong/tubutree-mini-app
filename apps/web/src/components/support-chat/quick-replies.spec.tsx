// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supportCopy, type QuickReply } from '@tubutree/app-core/support-copy';
import { click, render, type Rendered } from '@/test-utils/dom';
import { QuickReplies } from './quick-replies';

const ITEMS: QuickReply[] = [
  { label: 'Đơn của tôi đang ở đâu?', body: 'Đơn của tôi đang ở đâu?' },
  { label: 'Đổi trả hàng', body: 'Mình muốn hỏi về đổi trả hàng.' },
];

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
});
const qc = new QueryClient();
const mount = (ui: ReactElement) => {
  const r = render(ui, qc);
  mounted.push(r);
  return r;
};
const rerender = (r: Rendered, ui: ReactElement) =>
  act(() => {
    r.root.render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  });
const group = (r: Rendered) => r.container.querySelector<HTMLElement>('[role="group"]')!;
const chips = (r: Rendered) => [...group(r).querySelectorAll<HTMLButtonElement>('button')];

describe('QuickReplies (web): dải câu hỏi nhanh', () => {
  it('không có câu nào: không vẽ gì (không để lại dải trống có lề)', () => {
    const r = mount(<QuickReplies items={[]} onPick={vi.fn()} />);
    expect(r.container.innerHTML).toBe('');
    expect(r.container.querySelector('[role="group"]')).toBeNull();
  });

  it('có câu: nhóm tên "Hỏi nhanh", mỗi câu là một nút theo đúng chữ', () => {
    const r = mount(<QuickReplies items={ITEMS} onPick={vi.fn()} />);
    expect(supportCopy.quickTitle).toBe('Hỏi nhanh');
    expect(group(r).getAttribute('aria-label')).toBe(supportCopy.quickTitle);
    expect(chips(r).map((b) => b.textContent)).toEqual(ITEMS.map((q) => q.label));
    for (const b of chips(r)) expect(b.getAttribute('type')).toBe('button');
  });

  it('đúng một câu: vẫn vẽ nhóm với một nút (chỉ danh sách rỗng mới ẩn)', () => {
    const r = mount(<QuickReplies items={[ITEMS[0]!]} onPick={vi.fn()} />);
    expect(chips(r).map((b) => b.textContent)).toEqual([ITEMS[0]!.label]);
  });

  it('chạm một câu: gọi onPick đúng câu đó, đúng một lần', () => {
    const onPick = vi.fn();
    const r = mount(<QuickReplies items={ITEMS} onPick={onPick} />);
    click(chips(r)[1]!);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(ITEMS[1]);
  });

  it('nền: mặc định là nền thanh nhập, inPane thì trong suốt để cùng nền khung tin', () => {
    const r = mount(<QuickReplies items={ITEMS} onPick={vi.fn()} />);
    expect(group(r).style.background).toContain('--color-bg-surface');
    rerender(r, <QuickReplies items={ITEMS} onPick={vi.fn()} inPane />);
    expect(group(r).style.background).toBe('transparent');
  });

  it('chip cao tối thiểu 44px và rộng tối đa 24rem', () => {
    const r = mount(<QuickReplies items={ITEMS} onPick={vi.fn()} />);
    for (const b of chips(r)) {
      expect(b.style.minHeight).toBe('44px');
      expect(b.style.maxWidth).toBe('24rem');
    }
  });
});

describe('QuickReplies (web): khoá khi đang bận hoặc bị tắt', () => {
  it('bình thường: nút bật, con trỏ pointer, không mờ, nhóm không báo bận', () => {
    const r = mount(<QuickReplies items={ITEMS} onPick={vi.fn()} />);
    expect(group(r).hasAttribute('aria-busy')).toBe(false);
    for (const b of chips(r)) {
      expect(b.disabled).toBe(false);
      expect(b.style.cursor).toBe('pointer');
      expect(b.style.opacity).toBe('');
    }
  });

  it('disabled: mọi nút khoá, mờ 0.55, con trỏ not-allowed, bấm không gọi onPick; nhóm không báo bận', () => {
    const onPick = vi.fn();
    const r = mount(<QuickReplies items={ITEMS} onPick={onPick} disabled />);
    expect(group(r).hasAttribute('aria-busy')).toBe(false);
    for (const b of chips(r)) {
      expect(b.disabled).toBe(true);
      expect(b.style.cursor).toBe('not-allowed');
      expect(b.style.opacity).toBe('0.55');
      click(b);
    }
    expect(onPick).not.toHaveBeenCalled();
  });

  it('busy: nhóm aria-busy="true", mọi nút khoá, mờ 0.55, con trỏ not-allowed, bấm không gọi onPick', () => {
    const onPick = vi.fn();
    const r = mount(<QuickReplies items={ITEMS} onPick={onPick} busy />);
    expect(group(r).getAttribute('aria-busy')).toBe('true');
    for (const b of chips(r)) {
      expect(b.disabled).toBe(true);
      expect(b.style.cursor).toBe('not-allowed');
      expect(b.style.opacity).toBe('0.55');
      click(b);
    }
    expect(onPick).not.toHaveBeenCalled();
  });

  it('busy rồi hết bận: nút mở lại và bấm gọi được onPick', () => {
    const onPick = vi.fn();
    const r = mount(<QuickReplies items={ITEMS} onPick={onPick} busy />);
    rerender(r, <QuickReplies items={ITEMS} onPick={onPick} busy={false} />);
    expect(group(r).hasAttribute('aria-busy')).toBe(false);
    click(chips(r)[0]!);
    expect(onPick).toHaveBeenCalledWith(ITEMS[0]);
  });

  it('vừa disabled vừa busy: vẫn khoá và báo bận', () => {
    const r = mount(<QuickReplies items={ITEMS} onPick={vi.fn()} disabled busy />);
    expect(group(r).getAttribute('aria-busy')).toBe('true');
    for (const b of chips(r)) expect(b.disabled).toBe(true);
  });

  it('inPane kết hợp busy: nền trong suốt và vẫn khoá', () => {
    const r = mount(<QuickReplies items={ITEMS} onPick={vi.fn()} inPane busy />);
    expect(group(r).style.background).toBe('transparent');
    for (const b of chips(r)) expect(b.disabled).toBe(true);
  });
});
