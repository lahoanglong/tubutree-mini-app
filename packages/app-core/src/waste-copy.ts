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

/**
 * Câu dưới nhãn "Đang tạm dừng" của yêu cầu: nói đúng lý do đang tạm dừng. Cron hết hạn không xét cờ chương trình nên
 * hạn giữ chỗ vẫn chạy ở mọi lý do.
 */
export function pausedNote(
  r: { method: string },
  f: { programmeEnabled?: boolean | null; blocked?: boolean; shipLockedAt?: string | null; cfg: { enabled: boolean; pickup: boolean; isLoaded: boolean } },
  expiryDayMonth: string,
): string {
  const expiry = `Yêu cầu hết hạn ngày ${expiryDayMonth}.`;
  if (f.programmeEnabled === false || (f.cfg.isLoaded && !f.cfg.enabled)) return `Chương trình đang tạm dừng. ${expiry}`;
  if (f.blocked) return `Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree. ${expiry}`;
  if (r.method === 'PICKUP' && f.shipLockedAt) return `Đường gửi kho và thu kèm đơn đang tạm dừng với tài khoản của bạn, liên hệ CSKH. ${expiry}`;
  if (r.method === 'PICKUP' && !f.cfg.pickup) return `Thu kèm đơn đang tạm dừng. ${expiry}`;
  return expiry;
}

/** Câu ở màn chọn điểm khi giỏ có món chỉ kho nhận: chỉ bảo khách chọn kho khi kho đang nhận được. */
export function warehouseOnlyPointsNote(names: readonly string[], warehouseAvailable: boolean): string {
  const list = names.join(', ');
  return warehouseAvailable
    ? `${list} chỉ kho TP.HCM nhận, nên các điểm đại lý đang bị khoá. Bạn có thể chọn kho Tubu hoặc bỏ món này khỏi yêu cầu.`
    : `${list} chỉ kho TP.HCM nhận, mà kho chưa nhận được lúc này. Hiện chưa có điểm nào nhận món này, bạn có thể bỏ món này khỏi yêu cầu.`;
}

/** Dòng nhắc ở quầy với món cần xử lý riêng (pin): chỉ dùng lý do nhận thiếu có sẵn, không thêm lý do mới. */
export const HAZARDOUS_DESK_NOTES = [
  'Cất riêng vào thùng kín, không lẫn rác khác',
  'Pin phồng hoặc chảy nước thì không đếm, chọn lý do nhận thiếu "Hỏng"',
] as const;

/** Ngày theo giờ Việt Nam (UTC+7), dạng yyyy-mm-dd, cùng quy ước `capDayKey` của máy chủ. */
export function vnDayKey(d: Date): string {
  return new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** Máy chủ tính trần ngày theo ngày tạo yêu cầu (`capDayKey`), nên trang sửa chỉ áp trần ngày phía khách khi yêu cầu tạo hôm nay. */
export function createdTodayVn(createdAt: string, now: Date = new Date()): boolean {
  return vnDayKey(new Date(createdAt)) === vnDayKey(now);
}

/**
 * Số tối đa của ô chọn số. Món chỉ mang tới (nguy hại, như pin) bị chặn cả bởi trần ngày còn lại, vì máy chủ không
 * cho gửi nó qua đường vận chuyển nên không có đường nào khác để mang phần vượt; món khác chỉ theo trần tháng.
 * `dayCap` sai (trang sửa một yêu cầu không tạo hôm nay) thì bỏ trần ngày phía khách, để máy chủ chặn theo ngày của yêu cầu.
 */
export function itemQtyMax(
  item: { monthRemainingQty?: number | null; dayRemainingQty?: number | null; hazardous?: boolean },
  allowance: number,
  uncapped: number,
  dayCap = true,
): number {
  const month = (item.monthRemainingQty ?? uncapped) + allowance;
  if (dayCap && item.hazardous && item.dayRemainingQty != null) return Math.min(month, item.dayRemainingQty + allowance);
  return month;
}

/**
 * Dòng trần ngày cho món chỉ mang tới, thay cho câu trần ngày có sẵn khi phần còn lại hôm nay đã bớt.
 * `allowance` là phần yêu cầu đang sửa đã giữ (máy chủ đã trừ nó khỏi phần còn lại). Còn nguyên trần, không có trần ngày,
 * hoặc `dayCap` sai thì trả null để câu trần của thẻ đứng một mình (không hiện "còn nhận được 0" trên yêu cầu đã giữ đủ trần).
 */
export function dropOffDayLimitText(
  item: { hazardous?: boolean; dailyCapQty?: number | null; dayRemainingQty?: number | null; unitLabel: string },
  allowance = 0,
  dayCap = true,
): string | null {
  if (!dayCap || !item.hazardous || item.dayRemainingQty == null || item.dailyCapQty == null) return null;
  const left = item.dayRemainingQty + allowance;
  if (left >= item.dailyCapQty) return null;
  const fmt = (n: number) => n.toLocaleString('vi-VN');
  return `Hôm nay còn nhận được ${fmt(left)} ${item.unitLabel} (tối đa ${fmt(item.dailyCapQty)} ${item.unitLabel} mỗi ngày)`;
}
