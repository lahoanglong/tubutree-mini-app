// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Link2, Wallet } from 'lucide-react';
import { click, render, type Rendered } from '@/test-utils/dom';
import { CtvShortcuts } from './ctv-shortcuts';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('CtvShortcuts', () => {
  it('mỗi lối tắt là một nút có tên đầy đủ chứa nhãn hiển thị, đủ cao 44px, bấm gọi onPress', () => {
    const share = vi.fn();
    mounted = render(
      <CtvShortcuts
        items={[
          { key: 'share', label: 'Chia sẻ', ariaLabel: 'Chia sẻ link và mã giới thiệu', icon: Link2, onPress: share },
          { key: 'withdraw', label: 'Rút tiền', icon: Wallet, onPress: vi.fn(), disabled: true },
        ]}
      />,
    );
    const group = mounted.container.querySelector('[role="group"]')!;
    expect(group.getAttribute('aria-label')).toBe('Lối tắt của CTV');
    const buttons = Array.from(group.querySelectorAll('button'));
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.getAttribute('aria-label')).toContain('Chia sẻ');
    expect(buttons[0]!.className).toContain('min-h-11');
    click(buttons[0]!);
    expect(share).toHaveBeenCalledTimes(1);
    expect(buttons[1]!.disabled).toBe(true);
  });
});
