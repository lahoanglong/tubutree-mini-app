import type { Page } from '@playwright/test';

/**
 * Lối tắt Trang chủ (W47): MỘT lưới biểu tượng 4 cột, tối đa 2 hàng, 4–8 ô cùng cỡ (sáu lối vào hệ sinh thái, lối tắt phụ, ô "Thêm"). Không còn thẻ chính
 * hay ô phụ (`data-tier`). `retail: false` = không có suất Giờ vàng nào: ô Giờ vàng bị bỏ, lưới vẫn đủ hai hàng.
 * Đo hình học thật trên trình duyệt; trả về danh sách lỗi (rỗng = đúng). Dùng chung cho Mini App (375/360/320) và web điện thoại.
 */
export async function homeHierarchyProblems(page: Page, { retail = true }: { retail?: boolean } = {}): Promise<string[]> {
  return page.evaluate((retail) => {
    const grid = document.querySelector<HTMLElement>('[data-testid="shortcut-grid"]');
    if (!grid) return ['không có shortcut-grid'];
    const rect = (el: Element) => el.getBoundingClientRect();
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('.tubu-shortcut-cell'));
    const problems: string[] = [];
    if (grid.querySelector('[data-tier]')) problems.push('còn thẻ chính/ô phụ (data-tier) của lưới ba tầng cũ');
    if (cells.length < 4 || cells.length > 8) problems.push(`số ô: ${cells.length} (cần 4–8)`);
    const hasRetail = grid.querySelector('[data-pillar="retail"]') !== null;
    if (hasRetail !== retail) problems.push(retail ? 'thiếu ô Giờ vàng' : 'còn ô Giờ vàng dù không có suất nào');
    if (problems.length) return problems;

    const rows = new Map<number, HTMLElement[]>();
    for (const el of cells) {
      const top = Math.round(rect(el).top);
      rows.set(top, [...(rows.get(top) ?? []), el]);
    }
    if (rows.size > 2) problems.push(`lưới ${rows.size} hàng (tối đa 2)`);
    for (const [top, row] of rows) if (row.length > 4) problems.push(`hàng ở ${top}px có ${row.length} ô (tối đa 4)`);

    const widths = cells.map((e) => Math.round(rect(e).width));
    const heights = cells.map((e) => Math.round(rect(e).height));
    if (Math.max(...widths) - Math.min(...widths) > 1) problems.push(`ô không cùng rộng: ${Math.min(...widths)}–${Math.max(...widths)}px`);
    if (Math.max(...heights) - Math.min(...heights) > 1) problems.push(`ô không cùng cao: ${Math.min(...heights)}–${Math.max(...heights)}px`);

    for (const el of cells) {
      const r = rect(el);
      const name = el.dataset.pillar ?? el.dataset.shortcut ?? 'more';
      if (r.height < 44 || r.width < 44) problems.push(`${name}: vùng chạm ${Math.round(r.width)}×${Math.round(r.height)} dưới 44px`);
      if (r.right > window.innerWidth + 0.5 || r.left < -0.5) problems.push(`${name}: tràn khỏi màn (${Math.round(r.left)}..${Math.round(r.right)} / ${window.innerWidth})`);
      if (el.scrollWidth > el.clientWidth + 1) problems.push(`${name}: nội dung tràn ngang ${el.scrollWidth} > ${el.clientWidth}`);
    }
    for (const label of Array.from(grid.querySelectorAll<HTMLElement>('[data-shortcut-label]'))) {
      if (label.scrollHeight > label.clientHeight + 1) problems.push(`${label.textContent}: nhãn bị cắt (${label.scrollHeight}px nội dung trong ${label.clientHeight}px)`);
      const words = (label.textContent ?? '').trim().split(/\s+/).length;
      if (words > 3) problems.push(`${label.textContent}: nhãn ${words} chữ (tối đa 2 từ ghép)`);
    }
    return problems;
  }, retail);
}
