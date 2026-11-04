// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';
import { duplicateControlNames } from '@/test-utils/a11y';
import { Sheet } from '@/components/ui/sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { BottomSheet } from '@/components/mini/bottom-sheet';
import { QuantitySelector } from '@/components/ui/quantity-selector';
import { ProductGridSkeleton } from '@/components/ui/skeleton';
import { SegmentedTabs } from '@/components/mini/segmented-tabs';
import { Card } from '@/components/mini/card';
import { StatTile } from '@/components/mini/tiles';
import { ActiveFilters } from '@/components/catalog/active-filters';
import { AvatarCropSheet } from '@/components/account/avatar-crop-sheet';
import { useRovingGroup } from '@/lib/use-roving-group';

// Gói U (WCAG 2.2 AA): các hành vi nhỏ không có spec riêng sẵn. Mỗi ca ghi mã A11Y tương ứng.

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.style.overflow = '';
});
const key = (k: string, opts: KeyboardEventInit = {}, target: Element | null = document.activeElement) =>
  act(() => {
    target?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  });

describe('A11Y-06 tên nút số lượng không trùng trong danh sách', () => {
  it('có itemLabel: mỗi dòng có tên riêng, duplicateControlNames rỗng; thiếu itemLabel thì bị bắt', () => {
    const list = mount(
      <ul>
        {['Sữa tắm', 'Dầu gội'].map((n) => (
          <li key={n}>
            <QuantitySelector value={1} max={5} onChange={() => {}} itemLabel={n} editable quickSteps={[5]} />
          </li>
        ))}
      </ul>,
    ).container;
    expect(duplicateControlNames(list)).toEqual([]);
    expect(list.querySelector('button[aria-label="Giảm số lượng Sữa tắm"]')).not.toBeNull();
    expect(list.querySelector('input[aria-label="Số lượng Dầu gội"]')).not.toBeNull();
    const bare = mount(
      <ul>
        {[1, 2].map((i) => (
          <li key={i}>
            <QuantitySelector value={1} max={5} onChange={() => {}} />
          </li>
        ))}
      </ul>,
    ).container;
    expect(duplicateControlNames(bare)).toContain('Giảm số lượng (x2)');
  });
});

describe('A11Y-13 mũi tên chuyển mục trong nhóm radio/tab', () => {
  function Group() {
    const [v, setV] = useState('b');
    const g = useRovingGroup();
    return (
      <div ref={g.ref} onKeyDown={g.onKeyDown} role="radiogroup" aria-label="Chọn">
        {['a', 'b', 'c', 'd'].map((k) => (
          <button key={k} type="button" role="radio" aria-checked={v === k} aria-disabled={k === 'c' ? true : undefined} onClick={() => k !== 'c' && setV(k)}>
            {k}
          </button>
        ))}
      </div>
    );
  }
  const radios = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[role="radio"]'));

  it('một điểm dừng Tab (mục đang chọn); mũi tên chọn + focus mục kế, bỏ qua mục khoá, đi vòng, Home/End', () => {
    const { container } = mount(<Group />);
    expect(radios(container).map((r) => r.tabIndex)).toEqual([-1, 0, -1, -1]);
    radios(container)[1]!.focus();
    key('ArrowRight');
    expect(document.activeElement).toBe(radios(container)[3]);
    expect(radios(container)[3]!.getAttribute('aria-checked')).toBe('true');
    expect(radios(container).map((r) => r.tabIndex)).toEqual([-1, -1, -1, 0]);
    key('ArrowDown');
    expect(document.activeElement).toBe(radios(container)[0]);
    key('ArrowLeft');
    expect(document.activeElement).toBe(radios(container)[3]);
    key('Home');
    expect(document.activeElement).toBe(radios(container)[0]);
    key('End');
    expect(document.activeElement).toBe(radios(container)[3]);
  });

  it('SegmentedTabs của mini: mũi tên trái/phải đổi tab và focus, chỉ tab đang chọn có tabindex 0', () => {
    const onChange = vi.fn();
    function Tabs() {
      const [v, setV] = useState('a');
      return (
        <SegmentedTabs
          items={[{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }]}
          value={v}
          onChange={(k) => {
            onChange(k);
            setV(k);
          }}
        />
      );
    }
    const { container } = mount(<Tabs />);
    const tabs = () => Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]'));
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    tabs()[0]!.focus();
    key('ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('b');
    expect(document.activeElement).toBe(tabs()[1]);
    key('ArrowDown');
    expect(onChange).toHaveBeenCalledTimes(1);
    key('ArrowLeft');
    key('ArrowLeft');
    expect(onChange).toHaveBeenLastCalledWith('c');
  });
});

describe('A11Y-14 / A11Y-15 sheet', () => {
  it('ConfirmSheet là alertdialog và mô tả bằng lời nhắc', () => {
    mount(<ConfirmSheet open title="Xoá?" message="Không hoàn tác được." confirmLabel="Xoá" onConfirm={() => {}} onCancel={() => {}} />);
    const dlg = document.querySelector('[role="alertdialog"]')!;
    expect(dlg).not.toBeNull();
    expect(document.getElementById(dlg.getAttribute('aria-describedby')!)!.textContent).toBe('Không hoàn tác được.');
  });

  it('Sheet có description thì aria-describedby trỏ tới đoạn mô tả; gộp với describedBy truyền vào', () => {
    mount(<Sheet open onClose={() => {}} title="Cắt" description="Kéo để dời" describedBy="extra">nội dung</Sheet>);
    const dlg = document.querySelector('[role="dialog"]')!;
    const ids = dlg.getAttribute('aria-describedby')!.split(' ');
    expect(ids[0]).toBe('extra');
    expect(document.getElementById(ids[1]!)!.textContent).toBe('Kéo để dời');
  });

  it('Esc khi đang gõ tiếng Việt (isComposing) không đóng Sheet và BottomSheet; Esc thường vẫn đóng', () => {
    const onClose = vi.fn();
    mount(<Sheet open onClose={onClose} title="A">x</Sheet>);
    key('Escape', { isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    const onClose2 = vi.fn();
    mount(<BottomSheet open onClose={onClose2} title="B">x</BottomSheet>);
    key('Escape', { isComposing: true });
    expect(onClose2).not.toHaveBeenCalled();
    key('Escape');
    expect(onClose2).toHaveBeenCalledTimes(1);
  });

  it('bẫy Tab bỏ qua nút nằm trong vùng hidden/inert: Tab từ nút cuối nhìn thấy quay về nút đầu', () => {
    mount(
      <Sheet open onClose={() => {}} title="A">
        <button type="button">một</button>
        <div hidden>
          <button type="button">ẩn</button>
        </div>
        <div {...({ inert: '' } as object)}>
          <button type="button">inert</button>
        </div>
        <button type="button">hai</button>
      </Sheet>,
    );
    const hai = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'hai')!;
    hai.focus();
    key('Tab');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Đóng');
    const dong = document.activeElement!;
    dong.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(hai);
  });
});

describe('A11Y-21 khung chờ lưới sản phẩm', () => {
  it('là vùng status bận có chữ đọc; status={false} thì không lồng vùng thứ hai', () => {
    const c = mount(<ProductGridSkeleton count={2} />).container;
    const region = c.firstElementChild!;
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-busy')).toBe('true');
    expect(region.textContent).toBe('Đang tải sản phẩm…');
    const nested = mount(
      <div role="status" aria-busy="true">
        <ProductGridSkeleton count={2} status={false} />
      </div>,
    ).container;
    expect(nested.querySelectorAll('[role="status"]')).toHaveLength(1);
  });
});

describe('A11Y-23 Card/StatTile có onPress là <button> thật', () => {
  it('Card: button, không role=button trên div, bấm gọi onPress; không có onPress thì vẫn là div', () => {
    const onPress = vi.fn();
    const c = mount(<Card onPress={onPress}>nội dung</Card>).container;
    const b = c.querySelector('button')!;
    expect(b.type).toBe('button');
    expect(c.querySelector('[role="button"]')).toBeNull();
    click(b);
    expect(onPress).toHaveBeenCalledTimes(1);
    const plain = mount(<Card>x</Card>).container;
    expect(plain.querySelector('button')).toBeNull();
    expect(plain.firstElementChild!.tagName).toBe('DIV');
  });

  it('StatTile: button thật khi có onPress', () => {
    const onPress = vi.fn();
    const c = mount(<StatTile label="Đơn" value="3" onPress={onPress} />).container;
    click(c.querySelector('button')!);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(c.querySelector('[role="button"]')).toBeNull();
    expect(mount(<StatTile label="Đơn" value="3" />).container.querySelector('button')).toBeNull();
  });
});

describe('A11Y-18 chip bỏ lọc', () => {
  const chips = [
    { key: 'a', label: 'Tubu', patch: { brands: [] } },
    { key: 'b', label: 'Còn hàng', patch: { inStock: false } },
  ];
  function Host({ onPatch }: { onPatch: (p: unknown) => void }) {
    const [list, setList] = useState(chips);
    return (
      <>
        <h2 id="danh-sach-san-pham" tabIndex={-1}>Danh sách</h2>
        <ActiveFilters
          chips={list}
          filtersIgnored={false}
          onPatch={(p) => {
            onPatch(p);
            setList((l) => l.filter((c) => c.patch !== p));
          }}
        />
      </>
    );
  }

  it('là nút thường (không aria-pressed); gỡ chip thì focus sang chip kế, hết chip thì sang tiêu đề kết quả', () => {
    const onPatch = vi.fn();
    const { container } = mount(<Host onPatch={onPatch} />);
    const btn = (name: string) => container.querySelector<HTMLElement>(`button[aria-label="${name}"]`);
    expect(btn('Bỏ lọc Tubu')!.hasAttribute('aria-pressed')).toBe(false);
    btn('Bỏ lọc Tubu')!.focus();
    click(btn('Bỏ lọc Tubu'));
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(btn('Bỏ lọc Còn hàng'));
    click(btn('Bỏ lọc Còn hàng'));
    expect(container.querySelector('button')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('#danh-sach-san-pham'));
  });
});

describe('A11Y-19 cắt ảnh bằng bàn phím', () => {
  it('khung cắt focus được, có tên, mũi tên dời ảnh 10px (Shift 40px)', () => {
    mount(<AvatarCropSheet open imageSrc="data:image/png;base64,AAAA" onClose={() => {}} onConfirm={() => {}} />);
    const area = document.querySelector<HTMLElement>('[role="group"][tabindex="0"]')!;
    expect(area.getAttribute('aria-label')).toMatch(/mũi tên/);
    const img = area.querySelector('img')!;
    area.focus();
    key('ArrowRight');
    expect(img.style.transform).toContain('translate(10px, 0px)');
    key('ArrowDown', { shiftKey: true });
    expect(img.style.transform).toContain('translate(10px, 40px)');
    key('ArrowLeft');
    key('ArrowLeft');
    expect(img.style.transform).toContain('translate(-10px, 40px)');
  });
});
