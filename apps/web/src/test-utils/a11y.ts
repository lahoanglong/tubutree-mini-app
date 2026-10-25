/**
 * Kiểm tra truy cập tối thiểu trên DOM đã render (jsdom), thay cho axe vì máy không chạy Playwright:
 * điều khiển phải có tên (luật axe `button-name`/`label`/`select-name`/`link-name`) và thứ tự heading
 * (luật `page-has-heading-one`/`heading-order`). CHỈ dùng trong *.spec.tsx.
 */

const CONTROLS = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="switch"], [role="radio"], [role="checkbox"]';

function visibleText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof HTMLElement)) return '';
  if (node.getAttribute('aria-hidden') === 'true') return '';
  if (node instanceof HTMLImageElement) return node.alt;
  return Array.from(node.childNodes).map(visibleText).join(' ');
}

/** Tên truy cập của phần tử, theo thứ tự ưu tiên của accname (placeholder KHÔNG được tính là tên). */
export function accessibleName(el: Element): string {
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (text) return text;
  }
  const aria = el.getAttribute('aria-label')?.trim();
  if (aria) return aria;

  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    const fromLabels = Array.from(el.labels ?? [])
      .map((l) => visibleText(l).replace(/\s+/g, ' ').trim())
      .join(' ')
      .trim();
    if (fromLabels) return fromLabels;
  } else {
    const text = visibleText(el).replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return el.getAttribute('title')?.trim() ?? '';
}

/** Mô tả các điều khiển thiếu tên truy cập (rỗng = đạt). */
export function unnamedControls(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>(CONTROLS))
    .filter((el) => el.getAttribute('aria-hidden') !== 'true')
    .filter((el) => !accessibleName(el))
    .map((el) => `<${el.tagName.toLowerCase()}${el.getAttribute('type') ? ` type=${el.getAttribute('type')}` : ''}> ${el.outerHTML.slice(0, 120)}`);
}

/** Danh sách cấp heading theo thứ tự tài liệu. */
export function headingLevels(root: ParentNode): number[] {
  return Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, [role="heading"]')).map((h) =>
    h.getAttribute('aria-level') ? Number(h.getAttribute('aria-level')) : Number(h.tagName.slice(1)),
  );
}

/** Lỗi thứ tự heading: không đúng một h1, hoặc nhảy cấp (vd h1 → h3). Rỗng = đạt. */
export function headingProblems(root: ParentNode): string[] {
  const levels = headingLevels(root);
  const problems: string[] = [];
  const h1s = levels.filter((l) => l === 1).length;
  if (h1s !== 1) problems.push(`cần đúng 1 h1, có ${h1s}`);
  let prev = 0;
  for (const level of levels) {
    if (prev > 0 && level > prev + 1) problems.push(`nhảy cấp h${prev} -> h${level}`);
    prev = level;
  }
  return problems;
}

/**
 * Nút/ô nhập chưa khai vùng chạm 44px (`min-h-11`/`h-11`). jsdom không dàn trang nên kiểm theo lớp Tailwind;
 * radio/checkbox bỏ qua vì nhãn bao quanh mới là vùng chạm, liên kết trong đoạn văn bỏ qua (ngoại lệ inline của WCAG 2.5.8).
 */
export function smallTouchTargets(root: ParentNode): string[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('button, input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]), select, textarea'),
  )
    .filter((el) => !/\b(?:min-h-11|h-11)\b/.test(el.className) && !(/^\d+(?:\.\d+)?px$/.test(el.style.minHeight) && parseFloat(el.style.minHeight) >= 44))
    .map((el) => el.outerHTML.slice(0, 120));
}

const FIELDS = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea';

/**
 * Ô nhập/select thiếu nhãn theo đúng luật axe `label` và `select-name`: tên lấy từ <label>, aria-label,
 * aria-labelledby hoặc title; `placeholder` chỉ được axe chấp nhận cho ô chữ (input/textarea), KHÔNG cho select
 * và không có tác dụng với ô ngày giờ (trình duyệt không hiện placeholder). Dùng cho màn admin/merchant, nơi
 * nhiều ô chữ chỉ có placeholder (axe cho qua); khác với `unnamedControls` chặt hơn của web khách.
 */
export function unlabeledFields(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FIELDS))
    .filter((el) => el.getAttribute('aria-hidden') !== 'true')
    .filter((el) => {
      if (accessibleName(el)) return false;
      const type = el.getAttribute('type');
      const placeholderCounts = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !/^(date|datetime-local|time|month|week|color|file|range)$/.test(type ?? ''));
      return !(placeholderCounts && el.getAttribute('placeholder')?.trim());
    })
    .map((el) => `<${el.tagName.toLowerCase()}${el.getAttribute('type') ? ` type=${el.getAttribute('type')}` : ''}> ${el.outerHTML.slice(0, 120)}`);
}

/**
 * Khung cuộn ngang bọc bảng phải focus được bằng bàn phím (axe `scrollable-region-focusable`): `tabindex="0"`,
 * kèm `role="region"` + `aria-label` để người dùng đọc màn hình biết đang đứng trong bảng nào. Rỗng = đạt.
 */
export function scrollRegionProblems(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>('table'))
    .map((t) => t.parentElement!)
    .filter((box) => /\boverflow-(?:x-)?auto\b/.test(box.className))
    .filter((box) => box.getAttribute('tabindex') !== '0' || box.getAttribute('role') !== 'region' || !box.getAttribute('aria-label')?.trim())
    .map((box) => box.outerHTML.slice(0, 120));
}
