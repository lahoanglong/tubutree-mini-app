import type { WasteItemDTO, WasteMethod, WastePointDTO, WasteRequestDetailDTO, WasteRequestSummaryDTO } from '@tubutree/shared-types';
import { fillCopy } from '../shop-copy';

/** Yêu cầu HOÀN TẤT gần nhất (theo lúc tạo); không có thì null và màn Đổi rác giữ lối vào cũ. */
export function lastCompletedRequest(list: readonly WasteRequestSummaryDTO[] | null | undefined): WasteRequestSummaryDTO | null {
  let best: WasteRequestSummaryDTO | null = null;
  for (const r of list ?? []) {
    if (r.status !== 'COMPLETED' || r.lines.length === 0) continue;
    if (!best || r.createdAt > best.createdAt) best = r;
  }
  return best;
}

export interface RepeatCardView {
  title: string;
  /** "Mang tới điểm nhận Long Bình · 3 loại". */
  subtitle: string;
  cta: string;
  /** Liên kết phụ thay cho nút chính "Tạo yêu cầu". */
  newRequest: string;
}

/** "Điểm nhận Long Bình" sau nhãn "Mang tới điểm nhận" thành "Long Bình", không lặp chữ. */
function shortPointName(point: string, methodLabel: string): string {
  const fold = (s: string) => s.toLocaleLowerCase('vi');
  const prefix = 'điểm nhận ';
  return fold(methodLabel).endsWith(prefix.trim()) && fold(point).startsWith(prefix) ? point.slice(prefix.length) : point;
}

/** Chữ thẻ "Gửi lại như lần trước". `methodLabel` là nhãn cách gửi của app (METHOD_LABELS). */
export function repeatCardView(req: WasteRequestSummaryDTO, methodLabel: string): RepeatCardView {
  const n = req.lines.length;
  const point = req.pointName.trim();
  const subtitle = fillCopy('wasteRepeat.sub', { method: methodLabel, point: req.method === 'DROP_OFF' && point ? ` ${shortPointName(point, methodLabel)}` : '', n });
  return { title: fillCopy('wasteRepeat.title'), subtitle, cta: fillCopy('wasteRepeat.cta'), newRequest: fillCopy('wasteRepeat.newRequest') };
}

export interface RepeatDraftInput {
  detail: WasteRequestDetailDTO;
  /** Danh mục loại rác của khách (`/waste/me` items). Chỉ loại đang ACTIVE được giữ. */
  items: readonly Pick<WasteItemDTO, 'id' | 'status'>[];
  /** Cách gửi khách đang dùng được (cờ cấu hình + làn của khách + khoá gửi hàng), cùng luật màn tạo yêu cầu. */
  enabledMethods: readonly WasteMethod[];
  /** Điểm nhận đang mở (`/waste/points`); null khi chưa tải được thì không giữ điểm cũ. */
  points: readonly WastePointDTO[] | null;
}

export interface RepeatDraft {
  /** itemId → số lượng khai lần trước (chỉ loại còn nhận). */
  lines: Record<string, number>;
  method: WasteMethod | null;
  pointId: string | null;
  pickedPoint: WastePointDTO | null;
  /** Shipper lấy tận nhà: cân nặng khai lần trước; địa chỉ lấy theo sổ địa chỉ như luồng thường. */
  homePickupWeight: number | null;
  /** Nói ở bước chọn loại rác (loại không còn nhận đã bị bỏ). */
  itemsNote: string | null;
  /** Nói ở bước cách gửi (cách gửi hoặc điểm nhận cũ không dùng được). */
  methodNote: string | null;
}

/**
 * Bản nháp "Gửi lại như lần trước" (THUẦN): lấy loại rác, số lượng, cách gửi và điểm nhận của yêu cầu hoàn tất, bỏ phần không còn hợp lệ
 * (loại ngừng nhận, cách gửi tạm đóng, điểm nhận ngưng, hết suất hoặc không nhận đủ các loại) và nói rõ phần nào bị bỏ ở đúng bước.
 * Không bao giờ điền sẵn ô đồng ý thể lệ.
 */
export function buildRepeatDraft(input: RepeatDraftInput): RepeatDraft {
  const active = new Set(input.items.filter((i) => i.status === 'ACTIVE').map((i) => i.id));
  const lines: Record<string, number> = {};
  let dropped = 0;
  for (const l of input.detail.lines) {
    if (!active.has(l.itemId) || !(l.declaredQty > 0)) {
      dropped += 1;
      continue;
    }
    lines[l.itemId] = (lines[l.itemId] ?? 0) + l.declaredQty;
  }
  const itemsNote = dropped > 0 ? fillCopy('wasteRepeat.droppedItems', { n: dropped }) : null;

  const methodOk = input.enabledMethods.includes(input.detail.method);
  const method = methodOk ? input.detail.method : null;
  let pointId: string | null = null;
  let pickedPoint: WastePointDTO | null = null;
  let methodNote: string | null = methodOk ? null : fillCopy('wasteRepeat.pickAgain');
  if (method === 'DROP_OFF') {
    const prev = input.detail.point;
    const point = prev ? input.points?.find((p) => p.id === prev.id) : undefined;
    const ids = Object.keys(lines);
    if (point && !point.quotaFull && ids.every((id) => point.acceptedItemIds.includes(id))) {
      pointId = point.id;
      pickedPoint = point;
    } else {
      methodNote = fillCopy('wasteRepeat.pickAgain');
    }
  }
  const homePickupWeight = method === 'HOME_PICKUP' ? (input.detail.homePickup?.declaredWeightGrams ?? null) : null;
  return { lines, method, pointId, pickedPoint, homePickupWeight, itemsNote, methodNote };
}
