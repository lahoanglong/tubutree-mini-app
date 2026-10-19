// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { Field } from './field';

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('Field', () => {
  it('con duy nhất: nhãn gắn với control qua htmlFor/id', () => {
    const { container } = mount(
      <Field label="Họ tên">
        <input />
      </Field>,
    );
    const input = container.querySelector('input')!;
    const label = container.querySelector('label')!;
    expect(input.id).toBeTruthy();
    expect(label.getAttribute('for')).toBe(input.id);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('giữ id có sẵn và nối aria-describedby khi có lỗi', () => {
    const { container } = mount(
      <Field label="SĐT" error="Số điện thoại chưa đúng">
        <input id="phone" aria-describedby="hint" />
      </Field>,
    );
    const input = container.querySelector('input')!;
    expect(input.id).toBe('phone');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const ids = input.getAttribute('aria-describedby')!.split(' ');
    expect(ids[0]).toBe('hint');
    expect(document.getElementById(ids[1]!)!.textContent).toContain('Số điện thoại chưa đúng');
  });

  it('nhiều con: bọc nhóm role=group có tên theo nhãn', () => {
    const { container } = mount(
      <Field label="Giới tính" error="Chọn một">
        <input type="radio" />
        <input type="radio" />
      </Field>,
    );
    const group = container.querySelector('[role="group"]')!;
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)!.textContent).toBe('Giới tính');
    expect(group.getAttribute('aria-describedby')).toBeTruthy();
    expect(container.querySelector('label')).toBeNull();
  });
});
