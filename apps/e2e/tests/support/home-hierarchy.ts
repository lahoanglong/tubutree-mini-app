import type { Page } from '@playwright/test';

/**
 * Thứ bậc lối vào Trang chủ (W177): hàng 1 hai thẻ chính (Mua lẻ · Giờ vàng, Đổi rác), hàng 2 bốn ô phụ (Mua chung, Mua xoay vòng, Vườn Xanh, Kho quà 0đ).
 * Không có suất Giờ vàng nào thì thẻ "Mua lẻ · Giờ vàng" bị bỏ: `heroes: 1` (thẻ Vườn Xanh trải hết hàng 1).
 * Đo hình học thật trên trình duyệt; trả về danh sách lỗi (rỗng = đúng). Dùng chung cho Mini App (375/360/320) và web điện thoại.
 */
export async function homeHierarchyProblems(page: Page, { heroes: heroCount = 2 }: { heroes?: 1 | 2 } = {}): Promise<string[]> {
  return page.evaluate((heroCount) => {
    const grid = document.querySelector<HTMLElement>('[data-testid="shortcut-grid"]');
    if (!grid) return ['không có shortcut-grid'];
    const rect = (el: Element) => el.getBoundingClientRect();
    const heroes = Array.from(grid.querySelectorAll<HTMLElement>('[data-tier="hero"]'));
    const chips = Array.from(grid.querySelectorAll<HTMLElement>('[data-tier="chip"]'));
    const problems: string[] = [];
    if (heroes.length !== heroCount) problems.push(`thẻ chính: ${heroes.length} (cần ${heroCount})`);
    if (chips.length !== 4) problems.push(`ô phụ: ${chips.length} (cần 4)`);
    if (problems.length) return problems;

    const row = (els: HTMLElement[]) => new Set(els.map((e) => Math.round(rect(e).top))).size;
    if (row(heroes) !== 1) problems.push('các thẻ chính không cùng một hàng');
    if (row(chips) !== 1) problems.push('bốn ô phụ không cùng một hàng');

    const heroBottom = Math.max(...heroes.map((e) => rect(e).bottom));
    const chipTop = Math.min(...chips.map((e) => rect(e).top));
    if (chipTop < heroBottom) problems.push(`hàng ô phụ (${Math.round(chipTop)}) nằm trên đáy thẻ chính (${Math.round(heroBottom)})`);

    const minHero = Math.min(...heroes.map((e) => rect(e).height));
    const maxChip = Math.max(...chips.map((e) => rect(e).height));
    if (!(minHero > maxChip)) problems.push(`thẻ chính (${Math.round(minHero)}px) phải cao hơn ô phụ (${Math.round(maxChip)}px)`);
    const minHeroW = Math.min(...heroes.map((e) => rect(e).width));
    const maxChipW = Math.max(...chips.map((e) => rect(e).width));
    if (!(minHeroW > maxChipW)) problems.push(`thẻ chính (${Math.round(minHeroW)}px) phải rộng hơn ô phụ (${Math.round(maxChipW)}px)`);

    for (const el of [...heroes, ...chips]) {
      const r = rect(el);
      const name = el.dataset.pillar;
      if (r.height < 44 || r.width < 44) problems.push(`${name}: vùng chạm ${Math.round(r.width)}×${Math.round(r.height)} dưới 44px`);
      if (r.right > window.innerWidth + 0.5 || r.left < -0.5) problems.push(`${name}: tràn khỏi màn (${Math.round(r.left)}..${Math.round(r.right)} / ${window.innerWidth})`);
      if (el.scrollWidth > el.clientWidth + 1) problems.push(`${name}: nội dung tràn ngang ${el.scrollWidth} > ${el.clientWidth}`);
    }
    for (const label of Array.from(grid.querySelectorAll<HTMLElement>('[data-tier="chip"] [data-pillar-title]'))) {
      if (getComputedStyle(label).fontVariantNumeric.indexOf('tabular-nums') === -1) problems.push(`${label.textContent}: thiếu tabular-nums`);
      if (label.scrollHeight > label.clientHeight + 1) problems.push(`${label.textContent}: nhãn bị cắt (${label.scrollHeight}px nội dung trong ${label.clientHeight}px)`);
    }
    return problems;
  }, heroCount);
}
