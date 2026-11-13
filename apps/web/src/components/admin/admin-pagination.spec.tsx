// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createRef, useState } from 'react';
import { AdminPagination } from './admin-pagination';
import { byText, click, render, typeInto, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.restoreAllMocks();
});

function setup(over: Partial<React.ComponentProps<typeof AdminPagination>> = {}) {
  const onPageChange = vi.fn();
  const r = render(<AdminPagination page={2} totalPages={5} total={95} noun="đơn hàng" onPageChange={onPageChange} {...over} />);
  mounted.push(r);
  const input = () => r.container.querySelector<HTMLInputElement>('input[type="number"]')!;
  const jump = (value: string) => {
    typeInto(input(), value);
    act(() => void r.container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  };
  return { root: r.container, onPageChange, input, jump };
}

describe('AdminPagination', () => {
  it('một trang trở xuống thì không vẽ gì', () => {
    expect(setup({ totalPages: 1 }).root.textContent).toBe('');
    expect(setup({ totalPages: 0 }).root.textContent).toBe('');
  });

  it('hiện tổng số kèm đơn vị, trang hiện tại trong ô số và tổng số trang', () => {
    const { root, input } = setup();
    expect(root.textContent).toContain('Tổng số: 95 đơn hàng');
    expect(input().value).toBe('2');
    expect(input().getAttribute('aria-label')).toBe('Số trang, từ 1 đến 5');
    expect(root.textContent).toContain('/ 5');
  });

  it('Trước/Sau giữ đúng nhãn, cao 44px, bar xuống dòng được; khoá ở đầu và cuối', () => {
    const { root, onPageChange } = setup();
    const prev = byText(root, 'button', '← Trang trước') as HTMLButtonElement;
    const next = byText(root, 'button', 'Trang sau →') as HTMLButtonElement;
    expect(prev.className).toContain('min-h-[44px]');
    expect(prev.parentElement!.parentElement!.className).toContain('flex-wrap');
    click(prev);
    expect(onPageChange).toHaveBeenLastCalledWith(1);
    click(next);
    expect(onPageChange).toHaveBeenLastCalledWith(3);
    const first = setup({ page: 1 });
    expect((byText(first.root, 'button', '← Trang trước') as HTMLButtonElement).disabled).toBe(true);
    const last = setup({ page: 5 });
    expect((byText(last.root, 'button', 'Trang sau →') as HTMLButtonElement).disabled).toBe(true);
  });

  it('nhảy trang: nhập số rồi gửi; số ngoài khoảng bị kẹp về 1..totalPages', () => {
    const { jump, onPageChange, input } = setup();
    jump('4');
    expect(onPageChange).toHaveBeenLastCalledWith(4);
    jump('99');
    expect(onPageChange).toHaveBeenLastCalledWith(5);
    expect(input().value).toBe('5');
    jump('0');
    expect(onPageChange).toHaveBeenLastCalledWith(1);
  });

  it('nhảy về chính trang đang xem hoặc chữ không phải số nguyên: không đổi trang, ô trả về trang hiện tại', () => {
    const { jump, onPageChange, input } = setup();
    jump('2');
    jump('2.5');
    jump('');
    expect(onPageChange).not.toHaveBeenCalled();
    expect(input().value).toBe('2');
  });

  it('ô số trang theo prop page khi trang đổi từ nơi khác (bộ lọc đặt lại về 1)', () => {
    function Wrap() {
      const [page, setPage] = useState(3);
      return (
        <>
          <button type="button" onClick={() => setPage(1)}>đặt lại</button>
          <AdminPagination page={page} totalPages={5} total={95} noun="đơn hàng" onPageChange={() => {}} />
        </>
      );
    }
    const r = render(<Wrap />);
    mounted.push(r);
    const input = () => r.container.querySelector<HTMLInputElement>('input')!;
    typeInto(input(), '4');
    expect(input().value).toBe('4');
    click(byText(r.container, 'button', 'đặt lại'));
    expect(input().value).toBe('1');
  });

  it('đổi trang thì cuộn đích về đầu; không cuộn khi trang không đổi', () => {
    const target = document.createElement('div');
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    const ref = { current: target };
    const { root, jump } = setup({ scrollTargetRef: ref });
    click(byText(root, 'button', 'Trang sau →'));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
    scrollIntoView.mockClear();
    jump('2');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('người đặt giảm chuyển động thì cuộn thẳng, không mượt', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    const target = document.createElement('div');
    target.scrollIntoView = vi.fn();
    const { root } = setup({ scrollTargetRef: { current: target } });
    click(byText(root, 'button', 'Trang sau →'));
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
  });

  it('đích chưa gắn hoặc trình duyệt không có scrollIntoView: vẫn đổi trang, không lỗi', () => {
    const { root, onPageChange } = setup({ scrollTargetRef: createRef<HTMLElement>() });
    click(byText(root, 'button', 'Trang sau →'));
    expect(onPageChange).toHaveBeenCalledWith(3);
    const noApi = setup({ scrollTargetRef: { current: document.createElement('div') } });
    expect(() => click(byText(noApi.root, 'button', 'Trang sau →'))).not.toThrow();
  });
});
