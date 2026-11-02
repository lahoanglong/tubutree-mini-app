import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TierBadge } from './tier-badge';

/** Chữ trình đọc màn hình đọc được: bỏ phần tử aria-hidden (emoji). */
function readableText(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[aria-hidden]').forEach((n) => n.remove());
  return (clone.textContent ?? '').trim();
}

describe('TierBadge', () => {
  it('chữ đọc được là "CTV Đồng": emoji aria-hidden, phần còn lại có "CTV"', () => {
    const { container } = render(<TierBadge name="Đồng" emoji="🌿" />);
    expect(readableText(container)).toBe('CTV Đồng');
    expect(container.querySelector('[aria-hidden]')!.textContent).toBe('🌿');
  });

  it('tên bậc dài vẫn ghi "CTV Kim Cương" trên một dòng', () => {
    const { container } = render(<TierBadge name="Kim Cương" emoji="💎" />);
    expect(readableText(container)).toBe('CTV Kim Cương');
    expect((container.firstElementChild as HTMLElement).style.whiteSpace || 'nowrap').toBe('nowrap');
  });
});
