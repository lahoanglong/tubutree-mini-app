import { render } from '@testing-library/react';
import { Search } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';
import { Chip } from './chip';
import { Checkbox, Radio, Switch } from './form';
import { IconButton } from './icon-button';
import { ListRow } from './list-row';
import { QuantitySelector } from './quantity-selector';
import { SegmentedTabs } from './segmented-tabs';

/**
 * Vùng chạm >= 44x44 (C-021, WCAG 2.5.5) cho mọi phần tử bấm được mà DS v2 dựng. jsdom không có layout,
 * nên đọc kích thước KHAI BÁO: width/height/min* >= 44 trên chính phần tử hoặc cha bọc ngay trên nó,
 * hoặc lớp `tubu-hit-44*` (pseudo-element 44px). Component mới thêm vào danh sách này sẽ bị bắt nếu quên.
 */
const px = (v: string): number => (v.endsWith('px') ? parseFloat(v) : 0);

function declared(el: HTMLElement, axis: 'w' | 'h'): number {
  const s = el.style;
  return Math.max(px(axis === 'w' ? s.width : s.height), px(axis === 'w' ? s.minWidth : s.minHeight));
}

function reaches44(el: HTMLElement): boolean {
  if (/\btubu-hit-44(-square)?\b/.test(el.className)) return true;
  for (let node: HTMLElement | null = el; node && node.parentElement !== document.body; node = node.parentElement) {
    if (declared(node, 'w') >= 44 && declared(node, 'h') >= 44) return true;
    // Chiều rộng do bố cục quyết định: nút ZaUI (min-width 120px trong CSS) và hàng <div> block full-width.
    if (declared(node, 'h') >= 44 && (/\bzaui-btn\b/.test(node.className) || node.tagName === 'DIV')) return true;
  }
  return false;
}

const INTERACTIVE = 'button, [role="button"], [role="tab"], input';

function interactiveIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(INTERACTIVE));
}

describe('vùng chạm DS v2 >= 44x44', () => {
  const cases: [string, () => JSX.Element][] = [
    ['Button md', () => <Button>A</Button>],
    ['Button lg', () => <Button size="lg">A</Button>],
    ['IconButton md', () => <IconButton icon={Search} label="Tìm" />],
    ['IconButton sm', () => <IconButton icon={Search} label="Tìm" size="sm" />],
    ['Chip md', () => <Chip>A</Chip>],
    ['Chip sm', () => <Chip size="sm">A</Chip>],
    ['SegmentedTabs', () => <SegmentedTabs items={[{ key: 'a', label: 'A' }]} value="a" onChange={() => {}} />],
    ['QuantitySelector md', () => <QuantitySelector value={2} max={9} size="md" onChange={() => {}} />],
    ['QuantitySelector sm', () => <QuantitySelector value={2} max={9} size="sm" onChange={() => {}} />],
    ['ListRow', () => <ListRow title="Địa chỉ" onPress={() => {}} />],
    ['Checkbox có nhãn', () => <Checkbox label="A" checked={false} onChange={() => {}} />],
    ['Radio có nhãn', () => <Radio label="A" checked={false} onChange={() => {}} />],
    ['Switch có nhãn', () => <Switch label="A" checked={false} onChange={() => {}} />],
  ];

  it.each(cases)('%s', (_name, ui) => {
    const { container } = render(ui());
    const els = interactiveIn(container);
    expect(els.length).toBeGreaterThan(0);
    for (const el of els) {
      // ZaUI vẽ input checkbox/radio/switch đè lên ô gốc; vùng chạm là khối hitArea bọc ngoài.
      expect(reaches44(el), `${el.tagName} ${el.className} không đạt 44x44`).toBe(true);
    }
  });
});
