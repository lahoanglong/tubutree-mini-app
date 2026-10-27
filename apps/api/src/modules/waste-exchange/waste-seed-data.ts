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
  kind: 'VOUCHER' | 'TREE';
  name: string;
  description: string;
  label: string | null;
  pointsCost: number;
  status: 'ACTIVE';
  sortOrder: number;
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
  // Pin: hazardous = cần xử lý riêng, chỉ nhận khi khách mang tới điểm (không MAIL_IN/PICKUP). Điểm nào nhận là theo WastePointItem, nên không warehouseOnly. Sắp nhận: chủ bật trong Quản trị khi đủ điều kiện (hợp đồng xử lý, ý kiến Sở, Mini App mới Live).
  { id: 'wi-battery', code: 'BATTERY', name: 'Pin đã dùng', unitLabel: 'viên', unitsPerPoint: 10, pointsPerGroup: 1000, dropsPerUnit: 0, dailyCapQty: 20, monthlyCapQty: 50, status: 'COMING_SOON', prepInstructions: 'Dán băng keo hai đầu cực. Không nhận pin phồng, chảy nước, pin xe điện hay ắc quy.', sortOrder: 50, hazardous: true, warehouseOnly: false },
];

export const WASTE_SEED_GIFTS: readonly WasteSeedGift[] = [
  { id: 'reward-freeship', kind: 'VOUCHER', name: 'Miễn phí vận chuyển', description: 'Miễn phí vận chuyển cho 1 đơn từ 99.000đ — hữu ích khi đơn chưa đạt mức freeship của shop.', label: 'Phổ biến', pointsCost: 20_000, status: 'ACTIVE', sortOrder: 10, voucherType: 'FREESHIP', voucherValue: 0, voucherMinOrder: 99000, voucherMaxDiscount: null, voucherValidDays: 30 },
  { id: 'reward-discount-50k', kind: 'VOUCHER', name: 'Giảm 50.000đ', description: 'Giảm ngay 50.000đ cho đơn hàng từ 300.000đ', label: 'Tiết kiệm', pointsCost: 50_000, status: 'ACTIVE', sortOrder: 20, voucherType: 'AMOUNT', voucherValue: 50000, voucherMinOrder: 300000, voucherMaxDiscount: null, voucherValidDays: 30 },
  { id: 'reward-percent-15pct', kind: 'VOUCHER', name: 'Giảm 15%', description: 'Giảm 15% tối đa 80.000đ cho đơn hàng từ 250.000đ', label: 'Đặc quyền', pointsCost: 75_000, status: 'ACTIVE', sortOrder: 30, voucherType: 'PERCENT', voucherValue: 15, voucherMinOrder: 250000, voucherMaxDiscount: 80000, voucherValidDays: 30 },
  { id: 'reward-discount-100k', kind: 'VOUCHER', name: 'Giảm 100.000đ', description: 'Giảm ngay 100.000đ cho đơn hàng từ 600.000đ', label: 'HOT', pointsCost: 100_000, status: 'ACTIVE', sortOrder: 40, voucherType: 'AMOUNT', voucherValue: 100000, voucherMinOrder: 600000, voucherMaxDiscount: null, voucherValidDays: 30 },
  { id: 'gift-tree', kind: 'TREE', name: 'Góp quỹ trồng cây', description: 'Dùng Điểm Xanh góp vào quỹ trồng cây của Tubu Tree.', label: null, pointsCost: 0, status: 'ACTIVE', sortOrder: 50, voucherType: null, voucherValue: null, voucherMinOrder: null, voucherMaxDiscount: null, voucherValidDays: null },
];

// Empty `update`: a re-run of the seed never overwrites an admin edit.
export function wasteItemUpsertArgs(i: WasteSeedItem): Prisma.WasteItemUpsertArgs {
  return { where: { id: i.id }, update: {}, create: { ...i } };
}

export function wasteGiftUpsertArgs(g: WasteSeedGift): Prisma.WasteGiftUpsertArgs {
  return { where: { id: g.id }, update: {}, create: { ...g } };
}
