/**
 * Chữ và quy tắc nhỏ của màn Đổi rác dùng chung cho Mini App và web khổ điện thoại (khách chưa đăng nhập, khai món,
 * lý do nút bị khoá, tiến độ). Chữ riêng từng nền tảng vẫn ở `waste-labels.ts` (Mini App) và `recycle-labels.ts` (web).
 */

export const WAREHOUSE_ONLY_TEXT = 'Chỉ kho TP.HCM nhận';

export const wasteGuestCopy = {
  introTitle: 'Đổi bao bì lấy Điểm Xanh',
  intro: 'Mang bao bì sạch tới điểm nhận hoặc gửi về kho Tubu. Điểm Xanh dùng để đổi quà và mã giảm giá.',
  stepsTitle: 'Cách đổi',
  steps: ['Chọn món và số lượng bạn có', 'Mang tới điểm nhận hoặc gửi về kho Tubu', 'Tubu đếm xong là cộng Điểm Xanh cho bạn'],
  itemsTitle: 'Tubu nhận những món này',
  rulesLink: 'Xem Thể lệ chương trình',
  whyPhone: 'Cần số điện thoại để cộng Điểm Xanh đúng tài khoản của bạn.',
  loginButton: 'Đăng nhập để đổi rác',
  historyTitle: 'Đăng nhập để xem yêu cầu',
  historyButton: 'Đăng nhập',
  historyBody: 'Đăng nhập để xem các yêu cầu đổi rác của bạn.',
} as const;

export const wasteStepCopy = {
  items: 'Bước 1/2: Chọn món',
  method: 'Bước 2/2: Chọn cách giao',
  points: 'Chọn điểm nhận',
} as const;

export const ITEMS_NEXT_HINT = 'Chọn ít nhất 1 món để tiếp tục';
export const WASTE_CONSENT_TEXT = 'Tôi đồng ý với Thể lệ Đổi rác và để Tubu Tree xử lý yêu cầu này';
export const WASTE_RULES_LINK = 'Xem Thể lệ';

/** Số lượng nhập nhanh: nút cộng thêm cho món tính theo gói. */
export const QUICK_QTY_STEPS = [5, 10] as const;

/** Gõ số vào ô: bỏ ký tự không phải số, kẹp vào [min, max]; rỗng thì về min. */
export function parseQtyInput(raw: string, min: number, max: number): number {
  const digits = raw.replace(/\D/g, '').slice(0, 7);
  if (digits === '') return min;
  return Math.max(min, Math.min(max, Number(digits)));
}

/** Lý do một điểm nhận bị khoá vì thiếu món; món chỉ kho nhận thì nói thẳng để khách biết phải đi kho. */
export function missingItemsReason(missing: readonly { name: string; warehouseOnly?: boolean }[]): string {
  const onlyWarehouse = missing.filter((m) => m.warehouseOnly).map((m) => m.name);
  const others = missing.filter((m) => !m.warehouseOnly).map((m) => m.name);
  const parts: string[] = [];
  if (onlyWarehouse.length > 0) parts.push(`Đại lý không nhận ${onlyWarehouse.join(', ')}, món này chỉ kho TP.HCM nhận`);
  if (others.length > 0) parts.push(`Điểm này không nhận: ${others.join(', ')}`);
  return parts.join('. ');
}

/** Dòng giải thích đặt dưới nút "Tạo yêu cầu" khi nút còn khoá do khách chưa làm xong bước nào; null khi không phải lỗi của khách. */
export function createBlockedHint(s: {
  selected: boolean;
  needsPoint: boolean;
  pointChosen: boolean;
  consentsOk: boolean;
}): string | null {
  if (!s.selected) return 'Chọn cách giao để tạo yêu cầu';
  if (s.needsPoint && !s.pointChosen) return 'Chọn điểm nhận để tạo yêu cầu';
  if (!s.consentsOk) return 'Tick các ô đồng ý ở trên để tạo yêu cầu';
  return null;
}

/** "Bước 2/4: Mang tới điểm"; mọi bước xong thì "Hoàn tất". */
export function timelineCaption(steps: readonly string[], current: number): string {
  if (current >= steps.length) return 'Hoàn tất';
  return `Bước ${current + 1}/${steps.length}: ${steps[current]}`;
}

const LAST_POINT_KEY = 'tubu.waste.lastPointId';
type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

/** Điểm nhận khách chọn lần trước trên máy này; lưu trình duyệt hỏng hay bị chặn thì coi như chưa có. */
export function readLastPointId(store: KeyValueStore | undefined): string | null {
  try {
    return store?.getItem(LAST_POINT_KEY) || null;
  } catch {
    return null;
  }
}

export function writeLastPointId(store: KeyValueStore | undefined, pointId: string): void {
  try {
    store?.setItem(LAST_POINT_KEY, pointId);
  } catch {
    // Lưu điểm lần trước chỉ để tiện, mất cũng không sao.
  }
}

/** Điểm nhận chọn sẵn: điểm lần trước nếu còn dùng được, không thì điểm gần nhất khi đã có vị trí sẵn; không có thì để khách tự chọn. */
export function defaultPointId(
  points: readonly { id: string; quotaFull: boolean; acceptedItemIds: readonly string[]; distanceKm: number | null }[],
  selectedItemIds: readonly string[],
  lastPointId: string | null,
): string | null {
  const usable = points.filter((p) => !p.quotaFull && selectedItemIds.every((id) => p.acceptedItemIds.includes(id)));
  const last = usable.find((p) => p.id === lastPointId);
  if (last) return last.id;
  const near = usable.filter((p) => p.distanceKm != null).sort((a, b) => (a.distanceKm as number) - (b.distanceKm as number))[0];
  return near?.id ?? null;
}

export type WasteItemIconKey = 'package' | 'layers' | 'milk' | 'bottle' | 'battery';

const ITEM_ICONS: Record<string, WasteItemIconKey> = {
  CARTON: 'package',
  BUBBLE_WRAP: 'layers',
  MILK_CARTON: 'milk',
  TUBU_BOTTLE: 'bottle',
  BATTERY: 'battery',
};

/** Biểu tượng cho món chưa có ảnh, theo mã món của chương trình; mã lạ thì null (nền hiện lá xanh mặc định). */
export function wasteItemIconKey(code: string): WasteItemIconKey | null {
  return ITEM_ICONS[code] ?? null;
}

/** Mục xem lịch sử trong Cá nhân khi chương trình Đổi rác đang tắt mà khách từng có yêu cầu: chỉ để xem, không tạo mới. */
export const wasteHistoryMenu = { label: 'Yêu cầu đổi rác', hint: 'Xem lại các yêu cầu của bạn' } as const;
