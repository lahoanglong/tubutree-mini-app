// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { click, render } from '@/test-utils/dom';
import { ShopPager } from './shop-pager';

const nav = (c: HTMLElement) => c.querySelector('nav')!;
const label = (el: Element) => el.getAttribute('aria-label') ?? el.textContent ?? '';
const buttons = (c: HTMLElement) => Array.from(c.querySelectorAll('button'));

describe('ShopPager', () => {
  it('một trang thì không vẽ gì', () => {
    const r = render(<ShopPager page={1} pages={1} onChange={() => undefined} />);
    expect(r.container.innerHTML).toBe('');
    r.unmount();
  });

  it('nav có tên "Phân trang"; số hiện tại aria-current="page" và không bấm được', () => {
    const onChange = vi.fn();
    const r = render(<ShopPager page={2} pages={3} onChange={onChange} />);
    expect(nav(r.container).getAttribute('aria-label')).toBe('Phân trang');
    const cur = buttons(r.container).find((b) => b.getAttribute('aria-current') === 'page')!;
    expect(cur.textContent).toBe('2');
    expect(cur.disabled).toBe(true);
    click(cur);
    expect(onChange).not.toHaveBeenCalled();
    r.unmount();
  });

  it('bấm số hoặc mũi tên gọi onChange đúng trang; mũi tên ‹ ở trang 1 là aria-disabled và không gọi', () => {
    const onChange = vi.fn();
    const r = render(<ShopPager page={1} pages={3} onChange={onChange} />);
    const prev = buttons(r.container).find((b) => label(b) === 'Trang trước')!;
    expect(prev.getAttribute('aria-disabled')).toBe('true');
    click(prev);
    expect(onChange).not.toHaveBeenCalled();
    click(buttons(r.container).find((b) => label(b) === 'Trang 3')!);
    expect(onChange).toHaveBeenCalledWith(3);
    click(buttons(r.container).find((b) => label(b) === 'Trang sau')!);
    expect(onChange).toHaveBeenLastCalledWith(2);
    r.unmount();
  });

  it('trang 10 trên 20: có dấu … ở hai phía, không in cả 20 số', () => {
    const r = render(<ShopPager page={10} pages={20} onChange={() => undefined} />);
    expect(r.container.textContent).toContain('…');
    const nums = buttons(r.container).map((b) => b.textContent).filter((t) => /^\d+$/.test(t ?? ''));
    expect(nums).toEqual(['1', '9', '10', '11', '20']);
    r.unmount();
  });

  it('trang ở cuối: › aria-disabled', () => {
    const r = render(<ShopPager page={3} pages={3} onChange={() => undefined} />);
    expect(buttons(r.container).find((b) => label(b) === 'Trang sau')!.getAttribute('aria-disabled')).toBe('true');
    r.unmount();
  });

  it('nhận nhãn riêng cho nav', () => {
    const r = render(<ShopPager page={1} pages={2} onChange={() => undefined} label="Phân trang sản phẩm" />);
    expect(nav(r.container).getAttribute('aria-label')).toBe('Phân trang sản phẩm');
    r.unmount();
  });
});
