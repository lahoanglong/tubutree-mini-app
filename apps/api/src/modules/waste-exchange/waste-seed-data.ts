import type { CouponType, Prisma } from '@prisma/client';

export interface WasteSeedItem {
  id: string;
  code: string;
  name: string;
  unitLabel: string;
  unitsPerPoint: number;
  pointsPerGroup: number;
  dropsPerUnit: number;
  dailyCapQty: number | null;
  monthlyCapQty: number | null;
  status: 'ACTIVE' | 'COMING_SOON';
  prepInstructions: string | null;
  sortOrder: number;
  hazardous: boolean;
  warehouseOnly: boolean;
}

export interface WasteSeedGift {
  id: string;
  kind: 'VOUCHER' | 'TREE' | 'GIFT' | 'SEED_PACK';
  name: string;
  description: string;
  label: string | null;
  pointsCost: number;
  status: 'ACTIVE';
  sortOrder: number;
  /** Chỉ quà hiện vật đặt tồn kho hữu hạn; vắng mặt = không giới hạn. */
  stock?: number;
  voucherType: CouponType | null;
  voucherValue: number | null;
  voucherMinOrder: number | null;
  voucherMaxDiscount: number | null;
  voucherValidDays: number | null;
}

export const WASTE_SEED_ITEMS: readonly WasteSeedItem[] = [
  { id: 'wi-carton', code: 'CARTON', name: 'Thùng carton cũ', unitLabel: 'thùng', unitsPerPoint: 1, pointsPerGroup: 1000, dropsPerUnit: 0, dailyCapQty: 10, monthlyCapQty: 60, status: 'ACTIVE', prepInstructions: 'Gấp phẳng, giữ khô và sạch.', sortOrder: 10, hazardous: false, warehouseOnly: false },
  { id: 'wi-bubble-wrap', code: 'BUBBLE_WRAP', name: 'Nilon chống sốc', unitLabel: 'túi lớn', unitsPerPoint: 1, pointsPerGroup: 1000, dropsPerUnit: 0, dailyCapQty: 10, monthlyCapQty: 60, status: 'ACTIVE', prepInstructions: 'Túi còn nguyên, khô, không dính băng keo hay nhãn.', sortOrder: 20, hazardous: false, warehouseOnly: false },
  { id: 'wi-milk-carton', code: 'MILK_CARTON', name: 'Vỏ hộp sữa sạch', unitLabel: 'vỏ', unitsPerPoint: 5, pointsPerGroup: 1000, dropsPerUnit: 0, dailyCapQty: 50, monthlyCapQty: 300, status: 'ACTIVE', prepInstructions: 'Rửa sạch, để ráo, ép dẹt.', sortOrder: 30, hazardous: false, warehouseOnly: true },
  { id: 'wi-tubu-bottle', code: 'TUBU_BOTTLE', name: 'Vỏ chai, hộp Tubu Tree', unitLabel: 'vỏ', unitsPerPoint: 1, pointsPerGroup: 2000, dropsPerUnit: 2, dailyCapQty: null, monthlyCapQty: 20, status: 'ACTIVE', prepInstructions: 'Vỏ chai hoặc hộp Tubu Tree đã dùng hết, rửa sạch, để ráo.', sortOrder: 40, hazardous: false, warehouseOnly: true },
  // Pin: hazardous = cần xử lý riêng, không đi MAIL_IN (gửi bưu cục liên tỉnh). Điểm nào nhận là theo WastePointItem, nên không warehouseOnly. Chỉ nhận qua DROP_OFF hoặc lấy tận nơi TP.HCM.
  { id: 'wi-battery', code: 'BATTERY', name: 'Pin đã dùng', unitLabel: 'viên', unitsPerPoint: 10, pointsPerGroup: 1000, dropsPerUnit: 0, dailyCapQty: 20, monthlyCapQty: 50, status: 'ACTIVE', prepInstructions: 'Dán băng keo hai đầu cực. Không nhận pin phồng, chảy nước, pin xe điện hay ắc quy.', sortOrder: 50, hazardous: true, warehouseOnly: false },
];

export const WASTE_SEED_GIFTS: readonly WasteSeedGift[] = [
  { id: 'reward-freeship', kind: 'VOUCHER', name: 'Miễn phí vận chuyển', description: 'Miễn phí vận chuyển cho 1 đơn từ 99.000đ — hữu ích khi đơn chưa đạt mức freeship của shop.', label: 'Phổ biến', pointsCost: 20_000, status: 'ACTIVE', sortOrder: 10, voucherType: 'FREESHIP', voucherValue: 0, voucherMinOrder: 99000, voucherMaxDiscount: null, voucherValidDays: 30 },
  { id: 'reward-discount-50k', kind: 'VOUCHER', name: 'Giảm 50.000đ', description: 'Giảm ngay 50.000đ cho đơn hàng từ 300.000đ', label: 'Tiết kiệm', pointsCost: 50_000, status: 'ACTIVE', sortOrder: 20, voucherType: 'AMOUNT', voucherValue: 50000, voucherMinOrder: 300000, voucherMaxDiscount: null, voucherValidDays: 30 },
  { id: 'reward-percent-15pct', kind: 'VOUCHER', name: 'Giảm 15%', description: 'Giảm 15% tối đa 80.000đ cho đơn hàng từ 250.000đ', label: 'Đặc quyền', pointsCost: 75_000, status: 'ACTIVE', sortOrder: 30, voucherType: 'PERCENT', voucherValue: 15, voucherMinOrder: 250000, voucherMaxDiscount: 80000, voucherValidDays: 30 },
  { id: 'reward-discount-100k', kind: 'VOUCHER', name: 'Giảm 100.000đ', description: 'Giảm ngay 100.000đ cho đơn hàng từ 600.000đ', label: 'HOT', pointsCost: 100_000, status: 'ACTIVE', sortOrder: 40, voucherType: 'AMOUNT', voucherValue: 100000, voucherMinOrder: 600000, voucherMaxDiscount: null, voucherValidDays: 30 },
  { id: 'gift-tree', kind: 'TREE', name: 'Góp quỹ trồng cây', description: 'Dùng Điểm Xanh góp vào quỹ trồng cây của Tubu Tree.', label: null, pointsCost: 0, status: 'ACTIVE', sortOrder: 50, voucherType: null, voucherValue: null, voucherMinOrder: null, voucherMaxDiscount: null, voucherValidDays: null },
  // Tồn kho 200/100/50 là con số giả định để quà không bán vô hạn; chủ chỉnh trong Quản trị.
  { id: 'gift-seed-pack', kind: 'SEED_PACK', name: 'Gói hạt giống rau mầm Xanh', description: 'Gói hạt giống dễ gieo tại nhà, tự động gửi tặng kèm đơn hàng tiếp theo của bạn.', label: null, pointsCost: 5_000, status: 'ACTIVE', sortOrder: 60, stock: 200, voucherType: null, voucherValue: null, voucherMinOrder: null, voucherMaxDiscount: null, voucherValidDays: null },
  { id: 'gift-loofah-pad', kind: 'GIFT', name: 'Miếng xơ mướp rửa chén tự nhiên', description: 'Xơ mướp hữu cơ phân huỷ sinh học, tự động gửi tặng kèm đơn hàng tiếp theo.', label: null, pointsCost: 12_000, status: 'ACTIVE', sortOrder: 70, stock: 100, voucherType: null, voucherValue: null, voucherMinOrder: null, voucherMaxDiscount: null, voucherValidDays: null },
  { id: 'gift-canvas-bag', kind: 'GIFT', name: 'Túi vải Canvas Tubu Sống Xanh', description: 'Túi vải bố dày dặn tái sử dụng nhiều lần, tự động gửi tặng kèm đơn hàng tiếp theo.', label: null, pointsCost: 35_000, status: 'ACTIVE', sortOrder: 80, stock: 50, voucherType: null, voucherValue: null, voucherMinOrder: null, voucherMaxDiscount: null, voucherValidDays: null },
];

// Empty `update`: a re-run of the seed never overwrites an admin edit.
export function wasteItemUpsertArgs(i: WasteSeedItem): Prisma.WasteItemUpsertArgs {
  return { where: { id: i.id }, update: {}, create: { ...i } };
}

export function wasteGiftUpsertArgs(g: WasteSeedGift): Prisma.WasteGiftUpsertArgs {
  return { where: { id: g.id }, update: {}, create: { ...g } };
}
