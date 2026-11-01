// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
import { FlashSlotGenerator, generatedText } from './flash-slot-generator';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const bodyOf = (call: { init?: RequestInit } | undefined) => JSON.parse(String(call?.init?.body ?? '{}')) as Record<string, unknown>;

function mount(routes: Parameters<typeof mockFetch>[0]) {
  const api = mockFetch(routes);
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const onDone = vi.fn();
  const r = render(<FlashSlotGenerator onDone={onDone} />);
  mounted.push(r);
  return { r, api, onDone, button: () => byText(r.container, 'button', 'Tạo khung giờ 2 ngày tới') as HTMLButtonElement };
}

describe('FlashSlotGenerator (nút Tạo khung giờ của tab Giờ vàng)', () => {
  it('generatedText nói cả số đã tạo và số bỏ qua', () => {
    expect(generatedText({ created: 3, skipped: 1 })).toBe('Đã tạo 3 khung, bỏ qua 1.');
    expect(generatedText({ created: 0, skipped: 4 })).toBe('Đã tạo 0 khung, bỏ qua 4.');
  });

  it('bấm nút: POST generate-slots với days=2, báo "Đã tạo n khung, bỏ qua m" và nạp lại danh sách đợt', async () => {
    const { r, api, onDone, button } = mount({ '/admin/flash-sales/generate-slots': { body: { created: 4, skipped: 0 } } });
    expect(button().disabled).toBe(false);
    click(button());
    await flush();
    const post = api.calls.find((c) => c.init?.method === 'POST');
    expect(post?.url).toContain('/admin/flash-sales/generate-slots');
    expect(bodyOf(post)).toEqual({ days: 2 });
    expect(r.container.querySelector('[role="status"]')?.textContent).toBe('Đã tạo 4 khung, bỏ qua 0.');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('bấm lần hai khi mọi khung đã có: báo bỏ qua, không phải lỗi', async () => {
    const { r, button } = mount({ '/admin/flash-sales/generate-slots': { body: { created: 0, skipped: 4 } } });
    click(button());
    await flush();
    expect(r.container.querySelector('[role="status"]')?.textContent).toBe('Đã tạo 0 khung, bỏ qua 4.');
    expect(r.container.querySelector('[role="alert"]')).toBeNull();
  });

  it('API lỗi: hiện câu lỗi bằng chữ (role=alert), không gọi nạp lại', async () => {
    const { r, onDone, button } = mount({ '/admin/flash-sales/generate-slots': { status: 400, body: { message: 'Số ngày tạo khung giờ phải từ 1 đến 7.' } } });
    click(button());
    await flush();
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain('Số ngày tạo khung giờ phải từ 1 đến 7.');
    expect(onDone).not.toHaveBeenCalled();
  });
});
