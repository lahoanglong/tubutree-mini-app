// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Check } from 'lucide-react';
import { act } from 'react';
import { click, flush } from '@/test-utils/dom';
import { mount } from './harness';
import { Button } from './button';

const btn = (c: HTMLElement) => c.querySelector('button')!;

describe('Button', () => {
  it('mặc định là nút primary type=button, cao tối thiểu 44px, bo --radius-control', () => {
    const b = btn(mount(<Button>Mua ngay</Button>).container);
    expect(b.type).toBe('button');
    expect(b.className).toContain('zaui-btn zaui-btn-primary');
    expect(b.className).toContain('tubu-btn');
    expect(b.style.minHeight).toBe('44px');
    expect(b.style.borderRadius).toBe('var(--radius-control)');
    expect(b.textContent).toBe('Mua ngay');
  });

  it('size lg cao tối thiểu 48px; fullWidth thêm lớp full-width', () => {
    const b = btn(mount(<Button size="lg" fullWidth>Đặt hàng</Button>).container);
    expect(b.style.minHeight).toBe('48px');
    expect(b.className).toContain('zaui-btn-full-width');
  });

  it.each([
    ['secondary', 'zaui-btn-secondary'],
    ['ghost', 'zaui-btn-tertiary'],
    ['danger', 'zaui-btn-primary'],
    ['flash', 'zaui-btn-primary'],
  ] as const)('variant %s dùng lớp %s', (variant, cls) => {
    expect(btn(mount(<Button variant={variant}>x</Button>).container).className).toContain(cls);
  });

  it('danger/flash đổi nền bằng token riêng; danger tắt thì giữ nền disabled', () => {
    expect(btn(mount(<Button variant="danger">x</Button>).container).style.background).toBe('var(--color-action-danger-bg)');
    expect(btn(mount(<Button variant="flash">x</Button>).container).style.background).toBe('var(--color-flash-solid-bg)');
    expect(btn(mount(<Button variant="danger" disabled>x</Button>).container).style.background).toBe('');
  });

  it('disabled thật: thuộc tính disabled + aria-disabled, không gọi onPress', () => {
    const onPress = vi.fn();
    const b = btn(mount(<Button disabled onPress={onPress}>x</Button>).container);
    expect(b.disabled).toBe(true);
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.className).toContain('zaui-btn-disabled');
    click(b);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('loading: không disabled thật, hiện spinner, giữ nhãn truy cập, aria-busy, và chặn onPress', () => {
    const onPress = vi.fn();
    const c = mount(<Button loading onPress={onPress}>Đặt hàng · 100.000đ</Button>).container;
    const b = btn(c);
    expect(b.disabled).toBe(false);
    expect(b.className).toContain('zaui-btn-loading');
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.getAttribute('aria-label')).toBe('Đặt hàng · 100.000đ');
    expect(c.querySelector('.zaui-btn-loading-icon')).not.toBeNull();
    click(b);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('loading với children phức tạp không đoán nhãn; aria-label truyền vào thắng', () => {
    const b1 = btn(mount(<Button loading><b>x</b></Button>).container);
    expect(b1.getAttribute('aria-label')).toBeNull();
    const b2 = btn(mount(<Button loading aria-label="Đang gửi"><b>x</b></Button>).container);
    expect(b2.getAttribute('aria-label')).toBe('Đang gửi');
  });

  it('onPress trả Promise thì khoá bấm lại tới khi xong, rồi mở khoá', async () => {
    let resolve!: () => void;
    const onPress = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    const b = btn(mount(<Button onPress={onPress}>Gửi</Button>).container);
    click(b);
    click(b);
    expect(onPress).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(); });
    await flush();
    click(b);
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('onPress đồng bộ không khoá: bấm dồn được', () => {
    const onPress = vi.fn();
    const b = btn(mount(<Button onPress={onPress}>+</Button>).container);
    click(b);
    click(b);
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('icon vẽ trong ô icon phía trước nhãn; aria-* được chuyển xuống nút', () => {
    const c = mount(<Button icon={Check} aria-expanded={true} aria-controls="p">Xong</Button>).container;
    expect(c.querySelector('.zaui-btn-icon svg')).not.toBeNull();
    expect(btn(c).className).toContain('zaui-btn-prefix-icon');
    expect(btn(c).getAttribute('aria-expanded')).toBe('true');
    expect(btn(c).getAttribute('aria-controls')).toBe('p');
  });

  it('type=submit đang loading: chạm lần nữa không gửi lại form', () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    const c = mount(<form onSubmit={onSubmit}><Button type="submit" loading>Đặt hàng</Button></form>).container;
    click(btn(c));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
