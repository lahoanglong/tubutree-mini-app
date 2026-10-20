// @vitest-environment jsdom
import { Baby } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import type { CategoryEntry } from '@/lib/browse-categories';
import { CategoryGrid } from './category-grid';

const ENTRIES: CategoryEntry[] = [
  { kind: 'category', key: 'a', label: 'Cho bé', icon: Baby, image: 'https://img/be.png' },
  { kind: 'category', key: 'b', label: 'Cho mẹ & bầu', icon: Baby, image: null },
];
let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('CategoryGrid — ảnh danh mục (D6-09)', () => {
  it('có ảnh: vẽ ảnh 24px thay icon; không ảnh: icon 20px; tên danh mục vẫn là tên truy cập', () => {
    mounted = render(<CategoryGrid entries={ENTRIES} isLoading={false} onSelect={vi.fn()} />);
    const [withImage, noImage] = Array.from(mounted.container.querySelectorAll('button'));
    const img = withImage!.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://img/be.png');
    expect(img.getAttribute('width')).toBe('24');
    expect(img.getAttribute('height')).toBe('24');
    expect(img.getAttribute('alt')).toBe('');
    expect(withImage!.querySelector('svg')).toBeNull();
    expect(noImage!.querySelector('img')).toBeNull();
    expect(noImage!.querySelector('svg')!.getAttribute('class')).toContain('h-5');
    expect(withImage!.textContent).toBe('Cho bé');
  });

  it('tên dài xuống tối đa 2 dòng thay vì cắt một dòng', () => {
    mounted = render(<CategoryGrid entries={ENTRIES} isLoading={false} onSelect={vi.fn()} />);
    const label = mounted.container.querySelector('button span')!;
    expect(label.className).toContain('line-clamp-2');
    expect(label.className).not.toContain('truncate');
  });
});
