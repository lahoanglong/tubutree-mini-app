import type { FlashSlot, FlashSlotItem, FlashSlotStatus } from '../api/flash-sale';
import { slotClock } from '../merch/flash-next-slot';
import { fillCopy } from '../shop-copy';

/** Số tab khung giờ tối đa: nhiều hơn thì dải tab phải cuộn ngang và khách không còn thấy khung kế. */
const MAX_TABS = 5;
/** Từ số món này trở lên mới hiện chip danh mục; ít hơn thì chip chỉ thêm một hàng để lọc ra vài món. */
export const FLASH_CHIP_MIN_ITEMS = 12;

export interface SlotTab {
  id: string;
  /** "HH:mm" giờ Việt Nam. */
  clock: string;
  caption: string;
  /** Tên đọc cho trình đọc màn hình: "12:00, đang diễn ra". */
  spoken: string;
  status: FlashSlotStatus;
}

const VN_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Trạng thái tính lại theo `now`: `status` của máy chủ có thể đã cũ trong cache hoặc ở lần tải trước. */
function statusAt(slot: FlashSlot, now: number): FlashSlotStatus {
  if (now >= Date.parse(slot.endAt)) return 'ENDED';
  return now >= Date.parse(slot.startAt) ? 'LIVE' : 'UPCOMING';
}

const byStart = (a: FlashSlot, b: FlashSlot) => Date.parse(a.startAt) - Date.parse(b.startAt) || (a.id < b.id ? -1 : 1);

function liveSlots(slots: readonly FlashSlot[], now: number): FlashSlot[] {
  return slots.filter((s) => statusAt(s, now) !== 'ENDED').sort(byStart);
}

export function slotTabs(slots: readonly FlashSlot[], now: number): SlotTab[] {
  const today = VN_DAY.format(now);
  return liveSlots(slots, now)
    .slice(0, MAX_TABS)
    .map((s) => {
      const status = statusAt(s, now);
      const caption =
        status === 'LIVE'
          ? fillCopy('flash.slotLive')
          : VN_DAY.format(Date.parse(s.startAt)) === today
            ? fillCopy('flash.slotNext')
            : fillCopy('flash.slotTomorrow');
      const clock = slotClock(s.startAt);
      return { id: s.id, clock, caption, spoken: `${clock}, ${caption.toLowerCase()}`, status };
    });
}

/** Khung mở sẵn khi vào trang: đang diễn ra sớm nhất, không có thì sắp tới sớm nhất. */
export function initialSlotId(slots: readonly FlashSlot[], now: number): string | null {
  const open = liveSlots(slots, now);
  return (open.find((s) => statusAt(s, now) === 'LIVE') ?? open[0])?.id ?? null;
}

/**
 * Khung hiển thị tiếp theo khi khung đang xem vừa hết giờ (đồng hồ đếm về 0): khung bắt đầu sau nó, null nếu nó là khung cuối để trang
 * báo "đã kết thúc". Khung vừa hết đã biến mất khỏi danh sách (tải lại) thì lấy khung phù hợp nhất lúc này.
 */
export function slotAfterEnd(slots: readonly FlashSlot[], endedId: string, now: number): string | null {
  const ended = slots.find((s) => s.id === endedId);
  const candidates = liveSlots(slots, now).filter((s) => s.id !== endedId);
  if (!ended) return initialSlotId(candidates, now);
  return candidates.find((s) => Date.parse(s.startAt) > Date.parse(ended.startAt))?.id ?? null;
}

/** Phím mũi tên và Home/End trên dải tab (APG tabs): trả chỉ số tab nhận tiêu điểm, null khi không phải phím của dải tab. */
export function tabKeyTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

interface CategoryNode {
  id: string;
  name: string;
  children?: readonly { id: string }[];
}

const idsOf = (c: CategoryNode): Set<string> => new Set([c.id, ...(c.children ?? []).map((k) => k.id)]);
const inCategory = (it: FlashSlotItem, ids: Set<string>) => it.categoryIds.some((id) => ids.has(id));

/** Chip danh mục của một khung: chỉ khi đủ món để lọc có ích; mỗi danh mục gốc có món một chip, đếm cả món của danh mục con. */
export function slotCategoryChips(items: readonly FlashSlotItem[], categories: readonly CategoryNode[]): { id: string; name: string; count: number }[] {
  if (items.length < FLASH_CHIP_MIN_ITEMS) return [];
  return categories
    .map((c) => ({ id: c.id, name: c.name, count: items.filter((it) => inCategory(it, idsOf(c))).length }))
    .filter((c) => c.count > 0);
}

/** Danh sách hiển thị: lọc theo danh mục (cha gồm con), món hết suất xuống cuối nhưng giữ thứ tự tương đối. */
export function slotListView(items: readonly FlashSlotItem[], categoryId: string | null, categories: readonly CategoryNode[]): FlashSlotItem[] {
  let rows = [...items];
  if (categoryId !== null) {
    const node = categories.find((c) => c.id === categoryId);
    const ids = node ? idsOf(node) : new Set([categoryId]);
    rows = rows.filter((it) => inCategory(it, ids));
  }
  return [...rows.filter((it) => !it.soldOut), ...rows.filter((it) => it.soldOut)];
}

/**
 * Dòng ghi chú dưới giá của một món: giới hạn mua mỗi khách rồi tên phân loại (chỉ khi sản phẩm nhiều phân loại). Con số giới hạn đứng ĐẦU vì ghi chú
 * một dòng nowrap bị cắt ở đuôi trên thẻ 375px: tên phân loại bị cắt thì khách vẫn thấy mình mua được mấy, còn mất con số thì dòng vô nghĩa. Rỗng khi không có gì để nói.
 */
export function slotItemNote(item: Pick<FlashSlotItem, 'variationName' | 'perUserLimit'>): string {
  const limit = hasLimit(item) ? fillCopy('flash.limitShort', { n: item.perUserLimit }) : null;
  return [limit, item.variationName].filter((x): x is string => Boolean(x)).join(' · ');
}

/**
 * Bản đọc của `slotItemNote` cho trình đọc màn hình: "Tối đa 2 sản phẩm mỗi khách, 500g". Dòng nhìn thấy dùng "/" để vừa thẻ 375px nhưng
 * trình đọc nói "gạch chéo"; thẻ ẩn dòng ghi chú khỏi cây trợ năng và đưa câu này vào mô tả của thẻ.
 */
export function slotItemNoteSpoken(item: Pick<FlashSlotItem, 'variationName' | 'perUserLimit'>): string {
  const limit = hasLimit(item) ? fillCopy('flash.limitSpoken', { n: item.perUserLimit }) : null;
  return [limit, item.variationName].filter((x): x is string => Boolean(x)).join(', ');
}

const hasLimit = (item: Pick<FlashSlotItem, 'perUserLimit'>): boolean => Number.isFinite(item.perUserLimit) && item.perUserLimit > 0;

/** Tên đọc của nút "Mua ngay": nhãn nhìn thấy cộng tên sản phẩm, để danh sách nhiều nút giống nhau vẫn phân biệt được. */
export const slotBuyLabel = (productName: string): string => `${fillCopy('flash.buy')} ${productName}`;

/** Tên đọc của nút nhắc: chưa nhắc "Nhắc tôi {tên}"; đã nhắc nói trạng thái trước rồi việc nút làm, vẫn chứa chữ nhìn thấy "Đã đặt nhắc". */
export const slotRemindLabel = (productName: string, reminded: boolean): string =>
  reminded ? `${fillCopy('flash.reminded')} ${productName}, ${fillCopy('flash.unremind').toLowerCase()}` : `${fillCopy('flash.remind')} ${productName}`;
