// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { SearchPicker } from './search-picker';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe('SearchPicker: danh sách kết quả không nán lại sau khi chọn hoặc xoá chữ', () => {
  const search = vi.fn(async () => ({ options: [{ id: 'p1', label: 'Nước rửa bình sữa' }] }));
  const mount = (onChange = vi.fn()) => {
    mounted = render(<SearchPicker value={null} onChange={onChange} label="Thêm sản phẩm" placeholder="Gõ…" queryKey="w13-picker" search={search} debounceMs={60} />);
    return mounted.container;
  };

  it('xoá hết chữ thì danh sách biến mất ngay, không chờ hết khoảng debounce', async () => {
    const c = mount();
    typeInto(c.querySelector('input[type="search"]'), 'nuoc');
    await wait(120);
    await flush();
    expect(c.querySelectorAll('[role="option"]')).toHaveLength(1);
    typeInto(c.querySelector('input[type="search"]'), '');
    await flush();
    expect(c.querySelector('[role="listbox"]')).toBeNull();
  });

  it('chọn một dòng thì ô gõ rỗng và danh sách biến mất ngay', async () => {
    const onChange = vi.fn();
    const c = mount(onChange);
    typeInto(c.querySelector('input[type="search"]'), 'nuoc');
    await wait(120);
    await flush();
    click(c.querySelector('[role="option"]'));
    await flush();
    expect(onChange).toHaveBeenCalledWith({ id: 'p1', label: 'Nước rửa bình sữa' });
    expect(c.querySelector('[role="listbox"]')).toBeNull();
  });
});
