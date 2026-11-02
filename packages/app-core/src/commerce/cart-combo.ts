import type { CartComboGroup } from '@tubutree/shared-types';
import { fillCopy } from '../shop-copy';
import { vnd } from './money';

/** Một khối combo ở giỏ: các dòng của bộ dưới một đầu nhóm "Combo: {tên} · Tiết kiệm {số}". */
export interface ComboBlock<L extends { id: string }> {
  group: CartComboGroup;
  lines: L[];
  /**
   * Thanh toán phần đang chọn vẫn được giảm combo này. Có giá phần chọn của máy chủ (`selection`) thì theo nó (bỏ chọn hết một sản phẩm của bộ không phải
   * dòng khoá vẫn làm bộ hết khớp); chưa có thì theo luật khoá: không dòng khoá nào bị bỏ chọn.
   */
  applied: boolean;
  /** "Combo: {tên}". */
  title: string;
  /**
   * "Tiết kiệm {số}" chỉ khi bộ áp, khối có đủ mọi dòng mang giảm của nhóm (nhóm tách ở nhiều nơi giao thì mỗi khối không ghi số của cả nhóm) và nhóm
   * có số lớn hơn 0 (không ghi "Tiết kiệm 0đ"). Có giá phần chọn của máy chủ thì số là của phần chọn, khớp dòng "Giảm giá combo" ở chân.
   */
  saving: string | null;
  /**
   * Giỏ vừa sửa ở máy khách, chờ máy chủ tính lại: `saving` là số máy chủ trả lần trước (có thể đã cũ). Nơi vẽ giữ chỗ của số (ẩn, không đọc) để đầu nhóm
   * không đổi số dòng mỗi lần bấm +/−, và không đưa số cũ vào chữ đọc của khối (`comboHeadingText`).
   */
  savingPending: boolean;
  /** Lời nhắc khi bộ không còn áp vì bỏ chọn món: số khách sẽ được nếu chọn đủ. */
  hint: string | null;
}

/**
 * Chia dòng giỏ thành khối combo + dòng lẻ (THUẦN, chỉ để hiển thị). Mỗi dòng đúng MỘT chỗ: dòng nằm trong nhiều nhóm thì thuộc nhóm đứng trước.
 * Thành viên của khối là dòng mang giảm (`lineIds`) và dòng khoá (`keyLineIds`): sản phẩm chính của "mua kèm" là dòng khoá không mang giảm, vẫn phải nằm
 * trong khối của bộ (nếu để lẻ thì khách bấm thùng rác ở món "lẻ" mà gặp hộp báo của một bộ họ không thấy). Dòng mang giảm được xếp trước cho mọi nhóm;
 * dòng khoá chỉ vào khối nhóm đã có dòng mang giảm ở nơi giao này, và chỉ khi chưa thuộc nhóm nào.
 * Khối theo thứ tự dòng đầu tiên của nhóm trong `lines`, dòng trong khối theo thứ tự `lines`; nhóm không còn dòng nào trong `lines` bị bỏ. API cũ
 * chưa trả nhóm thì mọi dòng là dòng lẻ, giỏ vẽ như trước.
 * `selection`: nhóm trong giá phần chọn của máy chủ khi khách chỉ chọn một phần giỏ và máy chủ đã trả giá đó; không truyền thì dùng luật khoá với `deselected`.
 * Nhóm có trong phần chọn mà giỏ đầy đủ không có (hai bộ chung món: bộ đứng trước lấy hết dòng ở giỏ đầy đủ, bỏ chọn một món khoá của nó thì bộ sau mới khớp)
 * có khối riêng, và dòng của nó chuyển từ nhóm máy chủ không áp cho phần chọn sang khối này: đầu nhóm luôn cộng đúng dòng "Giảm giá combo" ở chân.
 * `pending`: giỏ vừa sửa ở máy khách, số của nhóm còn là số lần trước (xem `ComboBlock.savingPending`).
 */
export function cartComboBlocks<L extends { id: string }>(
  lines: readonly L[],
  groups: readonly CartComboGroup[] | undefined,
  deselected: ReadonlySet<string> = new Set(),
  selection?: readonly CartComboGroup[] | null,
  pending = false,
): { blocks: ComboBlock<L>[]; loose: L[] } {
  const selected = selection ? new Map(selection.map((g) => [g.id, g])) : null;
  const known = new Set((groups ?? []).map((g) => g.id));
  const all = [...(groups ?? []), ...(selection ?? []).filter((g) => !known.has(g.id))];
  const present = new Set(lines.map((l) => l.id));
  const owner = new Map<string, number>();
  all.forEach((g, gi) => {
    for (const id of g.lineIds) if (present.has(id) && !owner.has(id)) owner.set(id, gi);
  });
  if (selected) {
    all.forEach((g, gi) => {
      for (const id of selected.get(g.id)?.lineIds ?? []) {
        const cur = owner.get(id);
        if (present.has(id) && cur !== gi && (cur === undefined || !selected.has(all[cur]!.id))) owner.set(id, gi);
      }
    });
  }
  const withLines = new Set(owner.values());
  all.forEach((g, gi) => {
    if (!withLines.has(gi)) return;
    for (const id of g.keyLineIds) if (present.has(id) && !owner.has(id)) owner.set(id, gi);
  });
  const blocks: ComboBlock<L>[] = [];
  for (const [gi, group] of all.entries()) {
    const own = lines.filter((l) => owner.get(l.id) === gi);
    if (own.length === 0) continue;
    const live = selected?.get(group.id);
    const applied = selected ? !!live : !group.keyLineIds.some((id) => deselected.has(id));
    const complete = group.lineIds.every((id) => owner.get(id) === gi);
    const amount = live?.discount ?? group.discount;
    const saving = applied && complete && amount > 0 ? fillCopy('cart.comboSaving', { x: vnd(amount) }) : null;
    blocks.push({
      group,
      lines: own,
      applied,
      title: fillCopy('cart.comboTitle', { name: group.title }),
      saving,
      savingPending: pending && saving !== null,
      hint: !applied && group.discount > 0 ? fillCopy('cart.comboNeedAll', { x: vnd(group.discount) }) : null,
    });
  }
  const position = (b: ComboBlock<L>) => lines.findIndex((l) => l.id === b.lines[0]!.id);
  blocks.sort((a, b) => position(a) - position(b));
  return { blocks, loose: lines.filter((l) => !owner.has(l.id)) };
}

/** Chữ đầu nhóm cho trình đọc màn hình và kiểm thử: "Combo: {tên} · Tiết kiệm {số}" (không ghi số khi bộ không áp hoặc số đang chờ máy chủ tính lại). */
export function comboHeadingText(block: Pick<ComboBlock<{ id: string }>, 'title' | 'saving' | 'savingPending'>): string {
  return block.saving && !block.savingPending ? `${block.title} · ${block.saving}` : block.title;
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
  // Số của nhóm là số máy chủ trả lần cuối, giỏ vừa sửa ở máy khách vẫn giữ nó: bỏ món thứ hai khi món đầu còn đang chờ máy chủ vẫn được báo.
  const broken = (groups ?? []).filter((g) => g.discount > 0 && g.keyLineIds.includes(lineId));
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
