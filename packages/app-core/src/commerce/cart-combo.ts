import type { CartComboGroup } from '@tubutree/shared-types';
import { fillCopy } from '../shop-copy';
import { vnd } from './money';

/** Một khối combo ở giỏ: các dòng của bộ dưới một đầu nhóm "Combo: {tên} · Tiết kiệm {số}". */
export interface ComboBlock<L extends { id: string }> {
  group: CartComboGroup;
  lines: L[];
  /** Không dòng khoá nào của bộ bị bỏ chọn: thanh toán phần chọn vẫn được giảm combo này. */
  applied: boolean;
  /** "Combo: {tên}". */
  title: string;
  /** "Tiết kiệm {số}" chỉ khi bộ áp và khối có đủ mọi dòng của nhóm (nhóm tách ở nhiều nơi giao thì mỗi khối không ghi số của cả nhóm). */
  saving: string | null;
  /** Lời nhắc khi bộ không còn áp vì bỏ chọn món: số khách sẽ được nếu chọn đủ. */
  hint: string | null;
}

/**
 * Chia dòng giỏ thành khối combo + dòng lẻ (THUẦN, chỉ để hiển thị). Mỗi dòng đúng MỘT chỗ: dòng nằm trong nhiều nhóm thì thuộc nhóm đứng trước.
 * Khối theo thứ tự dòng đầu tiên của nhóm trong `lines`, dòng trong khối theo thứ tự `lines`; nhóm không còn dòng nào trong `lines` bị bỏ. API cũ
 * chưa trả nhóm thì mọi dòng là dòng lẻ, giỏ vẽ như trước.
 */
export function cartComboBlocks<L extends { id: string }>(
  lines: readonly L[],
  groups: readonly CartComboGroup[] | undefined,
  deselected: ReadonlySet<string> = new Set(),
): { blocks: ComboBlock<L>[]; loose: L[] } {
  const present = new Set(lines.map((l) => l.id));
  const owner = new Map<string, number>();
  (groups ?? []).forEach((g, gi) => {
    for (const id of g.lineIds) if (present.has(id) && !owner.has(id)) owner.set(id, gi);
  });
  const blocks: ComboBlock<L>[] = [];
  for (const [gi, group] of (groups ?? []).entries()) {
    const own = lines.filter((l) => owner.get(l.id) === gi);
    if (own.length === 0) continue;
    const applied = !group.keyLineIds.some((id) => deselected.has(id));
    const complete = group.lineIds.every((id) => owner.get(id) === gi);
    blocks.push({
      group,
      lines: own,
      applied,
      title: fillCopy('cart.comboTitle', { name: group.title }),
      saving: applied && complete ? fillCopy('cart.comboSaving', { x: vnd(group.discount) }) : null,
      hint: applied ? null : fillCopy('cart.comboNeedAll', { x: vnd(group.discount) }),
    });
  }
  const position = (b: ComboBlock<L>) => lines.findIndex((l) => l.id === b.lines[0]!.id);
  blocks.sort((a, b) => position(a) - position(b));
  return { blocks, loose: lines.filter((l) => !owner.has(l.id)) };
}

/** Chữ đầu nhóm cho trình đọc màn hình và kiểm thử: "Combo: {tên} · Tiết kiệm {số}" (không ghi số khi bộ không áp). */
export function comboHeadingText(block: Pick<ComboBlock<{ id: string }>, 'title' | 'saving'>): string {
  return block.saving ? `${block.title} · ${block.saving}` : block.title;
}

export interface ComboRemovalNotice {
  title: string;
  message: string;
  confirmLabel: string;
  keepLabel: string;
  /** Tổng khoản giảm các bộ sẽ mất (cận trên khi hai bộ chung một món: dòng còn lại có thể rơi về bộ kia). */
  discount: number;
}

/**
 * Báo trước khi khách bỏ một món làm combo mất giảm: `lineId` là dòng khoá của ít nhất một nhóm (bỏ MỘT mình nó thì bộ không còn khớp). Giảm số lượng
 * còn từ 1 trở lên không làm bộ mất khớp nên không báo; chỉ số lượng về 0 (như xoá) mới báo. Không chặn: nơi gọi cho khách chọn "Vẫn bỏ" hoặc "Giữ lại".
 */
export function comboRemovalNotice(groups: readonly CartComboGroup[] | undefined, lineId: string, nextQuantity = 0): ComboRemovalNotice | null {
  if (nextQuantity >= 1) return null;
  const broken = (groups ?? []).filter((g) => g.keyLineIds.includes(lineId));
  if (broken.length === 0) return null;
  const discount = broken.reduce((sum, g) => sum + g.discount, 0);
  return {
    title: fillCopy('cart.comboRemoveTitle'),
    message: fillCopy('cart.comboRemoveBody', { name: broken.map((g) => g.title).join(', '), x: vnd(discount) }),
    confirmLabel: fillCopy('cart.comboRemoveConfirm'),
    keepLabel: fillCopy('cart.comboRemoveKeep'),
    discount,
  };
}
