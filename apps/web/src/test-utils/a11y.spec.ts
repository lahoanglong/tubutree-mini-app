// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { iconOnlyControlProblems, smallTouchTargets } from './a11y';

const check = (html: string) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  return smallTouchTargets(root);
};

describe('smallTouchTargets', () => {
  it('nhận min-h-11, h-11 và style.minHeight >= 44px', () => {
    expect(check('<button class="min-h-11">a</button><button class="h-11">b</button><button style="min-height:44px">c</button>')).toEqual([]);
    expect(check('<button class="h-9">a</button>')).toHaveLength(1);
    expect(check('<button style="min-height:36px">a</button>')).toHaveLength(1);
  });

  it('tubu-hit-44 chỉ giãn theo chiều dọc: chỉ nhận khi kèm chiều rộng tối thiểu 44px (như Chip)', () => {
    expect(check('<button class="tubu-hit-44" style="min-width:44px">5</button>')).toEqual([]);
    expect(check('<button class="tubu-hit-44 min-w-11">5</button>')).toEqual([]);
    expect(check('<button class="tubu-hit-44 w-11">5</button>')).toEqual([]);
    expect(check('<button class="tubu-hit-44 w-6">x</button>')).toHaveLength(1);
    expect(check('<button class="tubu-hit-44" style="min-width:24px">x</button>')).toHaveLength(1);
    expect(check('<button class="tubu-hit-44">x</button>')).toHaveLength(1);
  });

  it('tubu-hit-44-square vẽ vùng chạm vuông 44px nên đủ một mình', () => {
    expect(check('<button class="tubu-hit-44-square h-9 w-9">+</button>')).toEqual([]);
  });
});

describe('iconOnlyControlProblems', () => {
  const icon = '<svg aria-hidden="true"></svg>';
  const find = (html: string) => {
    const root = document.createElement('div');
    root.innerHTML = html;
    return iconOnlyControlProblems(root);
  };

  it('nút hay liên kết chỉ có biểu tượng phải có aria-label tiếng Việt', () => {
    expect(find(`<button aria-label="Quay lại">${icon}</button><a href="/x" aria-label="Giỏ hàng">${icon}</a><div role="button" aria-label="Đóng">${icon}</div>`)).toEqual([]);
  });

  it('thiếu aria-label, aria-label rỗng hoặc không phải tiếng Việt đều bị báo', () => {
    expect(find(`<button>${icon}</button>`)).toHaveLength(1);
    expect(find(`<button aria-label="  ">${icon}</button>`)).toHaveLength(1);
    expect(find(`<button aria-label="Close">${icon}</button>`)).toHaveLength(1);
    expect(find(`<a href="/x" aria-label="Back">${icon}</a>`)).toHaveLength(1);
  });

  it('nút có chữ nhìn thấy hay ẩn khỏi trình đọc màn hình thì bỏ qua', () => {
    expect(find(`<button>${icon}Lưu</button><button aria-hidden="true">${icon}</button>`)).toEqual([]);
  });

  it('biểu tượng trạng thái role="img" không ẩn cũng cần nhãn tiếng Việt', () => {
    expect(find('<svg role="img" aria-label="Đã học"></svg>')).toEqual([]);
    expect(find('<svg role="img"></svg>')).toHaveLength(1);
    expect(find('<svg role="img" aria-label="Done"></svg>')).toHaveLength(1);
  });
});
