// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CategoryNode } from '@tubutree/app-core/browse/category-tree';
import { click, render, type Rendered } from '@/test-utils/dom';
import { CategoryChipRow } from './category-chip-row';

const node = (id: string, name: string): CategoryNode => ({ id, parentId: null, name, slug: id, image: null, productCount: 2, children: [] });
const PARENT = node('da', 'Chăm sóc da');
const CHIPS = [node('rua-mat', 'Rửa mặt'), node('chong-nang', 'Chống nắng')];

let mounted: Rendered | null = null;
const mount = (activeId: string, onSelect = vi.fn()) => {
  mounted = render(<CategoryChipRow parent={PARENT} chips={CHIPS} activeId={activeId} onSelect={onSelect} />);
  const group = mounted.container.querySelector<HTMLElement>('[role="group"][aria-label="Danh mục con"]')!;
  const btn = (name: string) => [...group.querySelectorAll('button')].find((b) => b.textContent === name)!;
  return { group, btn, onSelect };
};
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('CategoryChipRow', () => {
  it('nhóm "Danh mục con": chip Tất cả + một chip mỗi danh mục con; Tất cả chọn khi đang ở cha', () => {
    const { group, btn } = mount('da');
    expect(group.querySelectorAll('button')).toHaveLength(3);
    expect(btn('Tất cả').getAttribute('aria-pressed')).toBe('true');
    expect(btn('Rửa mặt').getAttribute('aria-pressed')).toBe('false');
  });

  it('đang ở một con: chip đó được chọn; Tất cả quay về cha; anh em chuyển sang anh em', () => {
    const { btn, onSelect } = mount('chong-nang');
    expect(btn('Chống nắng').getAttribute('aria-pressed')).toBe('true');
    click(btn('Tất cả'));
    expect(onSelect).toHaveBeenLastCalledWith('da');
    click(btn('Rửa mặt'));
    expect(onSelect).toHaveBeenLastCalledWith('rua-mat');
  });

  it('chạm chip đang chọn không gọi onSelect', () => {
    const { btn, onSelect } = mount('rua-mat');
    click(btn('Rửa mặt'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('hàng cuộn ngang tràn mép màn hình điện thoại (như Mini), đệm dọc ≥ 4px để vùng chạm 44px không bị cắt, ẩn từ lg (cột lọc đã có cây)', () => {
    const { group } = mount('da');
    expect(group.className).toContain('scroll-x');
    expect(group.className).toContain('-mx-4');
    expect(group.className).toContain('lg:hidden');
    expect(parseFloat(group.style.paddingTop)).toBeGreaterThanOrEqual(4);
    expect(parseFloat(group.style.paddingBottom)).toBeGreaterThanOrEqual(4);
  });
});
