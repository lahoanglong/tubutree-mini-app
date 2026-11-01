// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@/test-utils/dom';
import { StoreLayout } from './store-layout';

const mountIt = () =>
  render(
    <StoreLayout
      header={<header data-testid="h">đầu</header>}
      stats={<div data-testid="s">số liệu</div>}
      intro={<p data-testid="i">giới thiệu</p>}
      tabs={<nav data-testid="t">tab</nav>}
    >
      <section data-testid="c">nội dung</section>
    </StoreLayout>,
  );

describe('StoreLayout', () => {
  it('đặt đầu shop, số liệu, phần giới thiệu, tab rồi nội dung theo thứ tự', () => {
    const r = mountIt();
    const ids = Array.from(r.container.querySelectorAll('[data-testid]')).map((e) => e.getAttribute('data-testid'));
    expect(ids.filter((i) => ['h', 's', 'i', 't', 'c'].includes(i!))).toEqual(['h', 's', 'i', 't', 'c']);
    r.unmount();
  });

  it('khung lưới chỉ có lớp lg: dưới md không thêm viền, nền hay đệm; thanh tab giữ được dính (ô bọc là contents)', () => {
    const r = mountIt();
    const root = r.container.querySelector<HTMLElement>('[data-testid="store-layout"]')!;
    const own = root.className.split(/\s+/).filter(Boolean);
    expect(own.some((c) => c.startsWith('lg:'))).toBe(true);
    expect(own.filter((c) => !c.startsWith('lg:'))).toEqual([]);
    const tabsCell = r.container.querySelector('[data-testid="t"]')!.parentElement!;
    expect(tabsCell.className).toContain('max-lg:contents');
    r.unmount();
  });

  it('từ lg đầu shop là một thẻ lưới hai cột: bìa trái cao cả hai hàng, số liệu nằm cột phải hàng dưới, cùng một thẻ với đầu shop', () => {
    const r = mountIt();
    const head = r.container.querySelector<HTMLElement>('[data-testid="store-head"]')!;
    const cls = head.className.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(['lg:grid', 'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]', 'lg:grid-rows-[1fr_auto]', 'lg:rounded-card', 'lg:border']));
    expect(cls.filter((c) => !c.startsWith('lg:'))).toEqual(['max-lg:contents']);
    expect(head.contains(r.container.querySelector('[data-testid="h"]'))).toBe(true);
    expect(head.contains(r.container.querySelector('[data-testid="s"]'))).toBe(true);
    expect(head.contains(r.container.querySelector('[data-testid="t"]'))).toBe(false);
    const statsCell = r.container.querySelector('[data-testid="s"]')!.parentElement!;
    expect(statsCell.className).toEqual(expect.stringContaining('lg:col-start-2'));
    expect(statsCell.className).toEqual(expect.stringContaining('lg:row-start-2'));
    expect(statsCell.className.split(/\s+/)).toContain('contents');
    r.unmount();
  });

  it('không có số liệu hay tab thì bỏ ô tương ứng', () => {
    const r = render(<StoreLayout header={<b data-testid="h">đầu</b>}>x</StoreLayout>);
    expect(r.container.querySelector('[data-testid="s"]')).toBeNull();
    expect(r.container.textContent).toContain('x');
    r.unmount();
  });
});
