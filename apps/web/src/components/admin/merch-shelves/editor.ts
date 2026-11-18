import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { isoToVnLocal, vnLocalToIso } from '@/lib/admin-campaign-form';
import type { MerchPinInput, MerchPinView, MerchPinWarning, MerchProductView } from './api';

/** Một món trong bản nháp của kệ. Giờ hiệu lực giữ dạng ô nhập giờ Việt Nam ("yyyy-mm-ddTHH:mm"), rỗng là không giới hạn. */
export interface DraftPin {
  productId: string;
  name: string;
  brand: string;
  thumbnail: string | null;
  warnings: MerchPinWarning[];
  card: ProductCard | null;
  startsLocal: string;
  endsLocal: string;
  note: string;
}

/** Chữ của cảnh báo sẵn sàng. Chỉ "Chưa có ảnh" chặn lưu (máy chủ cũng chặn); còn lại nhắc để admin biết món sẽ không hiện hoặc hiện kém. */
export const WARNING_TEXT: Record<MerchPinWarning, string> = {
  NOT_ON_SALE: 'Đang ẩn hoặc chưa duyệt: khách không thấy',
  OUT_OF_STOCK: 'Hết hàng: tự rơi khỏi kệ tới khi có hàng',
  NO_IMAGE: 'Chưa có ảnh: không ghim được',
  NO_SHORT_DESC: 'Thiếu mô tả ngắn',
  NO_CATEGORY: 'Chưa có danh mục',
  OUTSIDE_CATEGORY: 'Không thuộc danh mục này: khách không thấy ở đầu danh mục',
};

/** Cảnh báo khiến món không đứng đầu kệ của khách lúc này (khác "thiếu mô tả", "chưa có danh mục" chỉ là nhắc). */
const HIDDEN_WARNINGS: readonly MerchPinWarning[] = ['NOT_ON_SALE', 'OUT_OF_STOCK', 'NO_IMAGE', 'OUTSIDE_CATEGORY'];

export function draftFromProduct(p: MerchProductView): DraftPin {
  return { productId: p.productId, name: p.name, brand: p.brand, thumbnail: p.thumbnail, warnings: p.warnings, card: p.card, startsLocal: '', endsLocal: '', note: '' };
}

export function draftFromPin(p: MerchPinView): DraftPin {
  return {
    ...draftFromProduct(p),
    startsLocal: p.startsAt ? isoToVnLocal(p.startsAt) : '',
    endsLocal: p.endsAt ? isoToVnLocal(p.endsAt) : '',
    note: p.note ?? '',
  };
}

/** Thêm vào cuối, bỏ món đã có, không quá `max`. */
export function addPins(list: readonly DraftPin[], items: readonly DraftPin[], max: number): { list: DraftPin[]; added: number; skipped: number } {
  const out = [...list];
  const have = new Set(out.map((p) => p.productId));
  let added = 0;
  for (const it of items) {
    if (have.has(it.productId) || out.length >= max) continue;
    out.push(it);
    have.add(it.productId);
    added++;
  }
  return { list: out, added, skipped: items.length - added };
}

export function removePin(list: readonly DraftPin[], productId: string): DraftPin[] {
  return list.filter((p) => p.productId !== productId);
}

/** Đổi chỗ: đưa món ở `from` tới `to` (kẹp trong danh sách). */
export function movePin<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (from < 0 || from >= list.length || from === target) return out;
  const [item] = out.splice(from, 1);
  out.splice(target, 0, item!);
  return out;
}

export function updatePin(list: readonly DraftPin[], productId: string, patch: Partial<Pick<DraftPin, 'startsLocal' | 'endsLocal' | 'note'>>): DraftPin[] {
  return list.map((p) => (p.productId === productId ? { ...p, ...patch } : p));
}

export type DraftIssue = { productId: string; text: string };

/** Lỗi chặn lưu, kiểm trước khi gửi để admin sửa tại chỗ: món chưa có ảnh, giờ gõ dở, giờ kết thúc không sau giờ bắt đầu. */
export function draftIssues(list: readonly DraftPin[]): DraftIssue[] {
  const out: DraftIssue[] = [];
  for (const p of list) {
    if (p.warnings.includes('NO_IMAGE')) out.push({ productId: p.productId, text: `"${p.name}" chưa có ảnh: thêm ảnh ở tab Sản phẩm hoặc gỡ khỏi kệ.` });
    const start = p.startsLocal ? vnLocalToIso(p.startsLocal) : null;
    const end = p.endsLocal ? vnLocalToIso(p.endsLocal) : null;
    if ((p.startsLocal && !start) || (p.endsLocal && !end)) out.push({ productId: p.productId, text: `"${p.name}": giờ hiệu lực chưa đủ ngày và giờ.` });
    else if (start && end && Date.parse(end) <= Date.parse(start)) out.push({ productId: p.productId, text: `"${p.name}": giờ kết thúc phải sau giờ bắt đầu.` });
  }
  return out;
}

export function toPinInputs(list: readonly DraftPin[]): MerchPinInput[] {
  return list.map((p) => ({
    productId: p.productId,
    startsAt: p.startsLocal ? vnLocalToIso(p.startsLocal) : null,
    endsAt: p.endsLocal ? vnLocalToIso(p.endsLocal) : null,
    note: p.note.trim() ? p.note.trim() : null,
  }));
}

/** Bản nháp khác bản đã lưu (thứ tự, món, giờ, ghi chú). */
export function isDirty(draft: readonly DraftPin[], saved: readonly DraftPin[]): boolean {
  const sig = (l: readonly DraftPin[]) => JSON.stringify(l.map((p) => [p.productId, p.startsLocal, p.endsLocal, p.note.trim()]));
  return sig(draft) !== sig(saved);
}

/** Món sẽ đứng đầu kệ của khách nếu lưu bây giờ: có thẻ, không bị ẩn/hết hàng/ngoài danh mục, đang trong khung giờ. */
export function previewCards(list: readonly DraftPin[], now: number = Date.now()): ProductCard[] {
  const out: ProductCard[] = [];
  for (const p of list) {
    if (!p.card || p.warnings.some((w) => HIDDEN_WARNINGS.includes(w))) continue;
    const start = p.startsLocal ? vnLocalToIso(p.startsLocal) : null;
    const end = p.endsLocal ? vnLocalToIso(p.endsLocal) : null;
    if ((start && Date.parse(start) > now) || (end && Date.parse(end) <= now)) continue;
    out.push(p.card);
  }
  return out;
}
