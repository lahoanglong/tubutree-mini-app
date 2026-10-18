// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Truck } from 'lucide-react';
import { render, type Rendered } from '@/test-utils/dom';
import { Badge, StatusPill } from './badge';

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('Badge', () => {
  it('mặc định neutral; mỗi tông dùng token riêng', () => {
    expect(mount(<Badge>Mới</Badge>).container.firstElementChild!.className).toContain('bg-stone-100');
    expect(mount(<Badge tone="success">Xong</Badge>).container.firstElementChild!.className).toContain('bg-success-bg text-success-fg');
    expect(mount(<Badge tone="danger">Lỗi</Badge>).container.firstElementChild!.className).toContain('text-danger-fg');
    expect(mount(<Badge tone="promo">-10%</Badge>).container.firstElementChild!.className).toContain('text-promo-fg');
  });

  it('icon ẩn khỏi trình đọc màn hình, chữ vẫn hiện; StatusPill là bí danh', () => {
    const { container } = mount(<Badge tone="info" icon={Truck}>Đang giao</Badge>);
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(container.textContent).toBe('Đang giao');
    expect(StatusPill).toBe(Badge);
  });

  it('không dùng chữ nhỏ hơn 12px', () => {
    expect(mount(<Badge size="sm">a</Badge>).container.firstElementChild!.className).not.toMatch(/text-\[\d+px\]/);
  });
});
