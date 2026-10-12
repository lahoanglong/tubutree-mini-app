// Dùng cho test (không import từ mã chạy thật): xấp xỉ luật axe `nested-interactive`. Vai trò mà con của nó
// "trình bày thuần tuý" (button/radio/checkbox/switch/tab...) không được chứa phần tử focus được, vì trình đọc
// màn hình gộp con vào cha và bỏ rơi chúng. Cây `inert` không focus được nên không tính; `tabindex="-1"` thì
// VẪN tính (axe: tabindex âm không ngăn công nghệ hỗ trợ focus phần tử, kể cả khi aria-hidden).
const WIDGET =
  'button, [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="option"], [role="menuitemcheckbox"], [role="menuitemradio"]';
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex], [contenteditable=""], [contenteditable="true"]';

export interface NestedInteractive {
  outer: Element;
  inner: Element;
}

export function findNestedInteractive(root: ParentNode): NestedInteractive[] {
  const found: NestedInteractive[] = [];
  for (const outer of Array.from(root.querySelectorAll(WIDGET))) {
    if (outer.closest('[inert]')) continue;
    for (const inner of Array.from(outer.querySelectorAll(FOCUSABLE))) {
      if (inner.closest('[inert]')) continue;
      found.push({ outer, inner });
    }
  }
  return found;
}

/** Mô tả ngắn để thông báo lỗi test đọc được: `div[role=radio] > input[type=radio]`. */
export function describeNested(n: NestedInteractive): string {
  const d = (el: Element) => `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}${el.getAttribute('aria-label') ? `[aria-label="${el.getAttribute('aria-label')}"]` : ''}`;
  return `${d(n.outer)} > ${d(n.inner)}`;
}
