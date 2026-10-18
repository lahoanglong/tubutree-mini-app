import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { formatVnd } from '../orders/refund-destination';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

/** Mã % từ mức này trở lên bắt buộc có Giảm tối đa: 100% không trần là gõ nhầm hoặc mã lộ ra là mất cả đơn. */
export const COUPON_PERCENT_NEEDS_CAP = 50;

/**
 * Mã ẩn nhận qua thẻ (scope CLAIM, kể cả mã thuộc lô) bắt buộc có tổng lượt: mã chung in trên thẻ bị đăng lên nhóm mạng xã
 * hội mà không có trần thì số lượt nhận, số lượt dùng và tổng tiền giảm đều không giới hạn.
 */
export function assertClaimUsageLimit(coupon: { scope?: string; batch?: string | null }, usageLimit: number | null | undefined): void {
  if (coupon.scope !== 'CLAIM' && !coupon.batch) return;
  if (usageLimit == null || usageLimit < 1) {
    throw new BadRequestException('Mã nhận qua thẻ phải có Tổng lượt nhận từ 1 trở lên: mã lộ ra ngoài mà không có trần thì bị nhận và dùng không giới hạn.');
  }
}

/** Luật tiền và ngày chung cho mọi mã admin tạo (từng mã ở tab Voucher, lô mã thẻ hộp hàng). */
export function assertCouponInput(data: {
  type: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  value: number;
  minOrder?: number;
  maxDiscount?: number;
  startAt: Date;
  endAt: Date;
  scope?: string;
  usageLimit?: number | null;
}): void {
  assertClaimUsageLimit({ scope: data.scope }, data.usageLimit);
  if (data.endAt <= data.startAt) throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu.');
  if (data.endAt <= new Date()) throw new BadRequestException('Ngày kết thúc đã qua — mã tạo ra sẽ không dùng được.');
  if (data.type !== 'FREESHIP' && data.value <= 0) throw new BadRequestException('Mức giảm phải lớn hơn 0.');
  if (data.type === 'PERCENT' && data.value >= COUPON_PERCENT_NEEDS_CAP && !data.maxDiscount) {
    throw new BadRequestException(`Mã giảm từ ${COUPON_PERCENT_NEEDS_CAP}% phải đặt Giảm tối đa (đ) để một đơn lớn không được giảm gần hết.`);
  }
  if (data.type === 'AMOUNT' && data.minOrder && data.value >= data.minOrder) {
    throw new BadRequestException(
      `Mức giảm ${formatVnd(data.value)} phải nhỏ hơn đơn tối thiểu ${formatVnd(data.minOrder)} — không thì đơn ở mức tối thiểu được giảm hết tiền hàng. ` +
        'Kiểm tra lại số 0 của hai ô.',
    );
  }
}

/** Người bấm tạo/sửa mã: nhân viên (STAFF) hay quản trị viên; `system` khi gọi từ job/seed. */
export interface CouponActor {
  id: string;
  staff: boolean;
}
export const SYSTEM_ACTOR: CouponActor = { id: 'system', staff: false };

export const actorLabel = (actor: CouponActor) => `${actor.staff ? 'Nhân viên' : 'Admin'} ${actor.id}`;

/** Nhân viên Marketing tạo mã cho khách, không tự cấp hay gia hạn mã cá nhân của chính mình. */
export function assertNotOwnCoupon(actor: CouponActor, ownerId: string | undefined): void {
  if (actor.staff && ownerId && ownerId === actor.id) {
    throw new ForbiddenException('Không tạo hay sửa mã giảm giá cá nhân của chính mình — nhờ quản trị viên.');
  }
}

/** Id ghi vào createdById / updatedById: lời gọi từ job (SYSTEM_ACTOR) không có người. */
export const actorUserId = (actor: CouponActor): string | null => (actor === SYSTEM_ACTOR ? null : actor.id);

export const STAFF_COUPON_MAX_PERCENT_KEY = 'coupon.staff_max_percent';
export const STAFF_COUPON_MAX_PERCENT_DEFAULT = 50;
export const STAFF_COUPON_MAX_AMOUNT_KEY = 'coupon.staff_max_amount_vnd';
export const STAFF_COUPON_MAX_AMOUNT_DEFAULT = 200_000;

export interface StaffCouponCaps {
  maxPercent: number;
  maxAmount: number;
}

/** Giá trị cấu hình hỏng (không phải số dương) thì dùng mặc định: trần không bao giờ tự mở. */
export async function loadStaffCouponCaps(config: Pick<SystemConfigService, 'get'>): Promise<StaffCouponCaps> {
  const [pct, amount] = await Promise.all([
    config.get<unknown>(STAFF_COUPON_MAX_PERCENT_KEY, STAFF_COUPON_MAX_PERCENT_DEFAULT),
    config.get<unknown>(STAFF_COUPON_MAX_AMOUNT_KEY, STAFF_COUPON_MAX_AMOUNT_DEFAULT),
  ]);
  const positive = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fb);
  return {
    maxPercent: Math.min(positive(pct, STAFF_COUPON_MAX_PERCENT_DEFAULT), 100),
    maxAmount: positive(amount, STAFF_COUPON_MAX_AMOUNT_DEFAULT),
  };
}

/**
 * Mã nhân viên tạo hoặc sửa (kể cả từng mã của lô thẻ): mức giảm trong trần cấu hình và bắt buộc có tổng lượt dùng — mã
 * lộ ra ngoài mà không có trần là mất tiền không giới hạn.
 */
export function assertStaffCouponCaps(
  c: { type: string; value: number; maxDiscount?: number | null; usageLimit?: number | null },
  caps: StaffCouponCaps,
): void {
  const amount = formatVnd(caps.maxAmount);
  const deny = (msg: string) => new ForbiddenException(`${msg} Cần mức cao hơn thì nhờ quản trị viên tạo mã.`);
  if (c.type === 'PERCENT') {
    if (c.value > caps.maxPercent) throw deny(`Nhân viên tạo mã giảm tối đa ${caps.maxPercent}%.`);
    if (!c.maxDiscount) throw deny(`Mã giảm % do nhân viên tạo phải có Giảm tối đa (không quá ${amount}).`);
    if (c.maxDiscount > caps.maxAmount) throw deny(`Giảm tối đa của mã do nhân viên tạo không quá ${amount}.`);
  }
  if (c.type === 'AMOUNT' && c.value > caps.maxAmount) throw deny(`Nhân viên tạo mã giảm tối đa ${amount}.`);
  if (c.usageLimit == null || c.usageLimit < 1) throw deny('Mã do nhân viên tạo phải có Tổng lượt dùng.');
}

/**
 * Nhân viên chỉ sửa mã do nhân viên tạo. Mã quản trị viên tạo, mã hệ thống hay mã cũ (không rõ người tạo) giữ cho quản trị
 * viên: nhân viên không bật lại hay bỏ trần lượt của mã quản trị viên đã tắt.
 */
export async function assertStaffCreatedCoupons(
  prisma: Pick<PrismaService, 'user'>,
  creatorIds: readonly (string | null)[],
): Promise<void> {
  const deny = () => new ForbiddenException('Mã do quản trị viên hoặc hệ thống tạo — nhân viên không sửa được, nhờ quản trị viên.');
  if (creatorIds.length === 0 || creatorIds.some((id) => !id)) throw deny();
  const ids = [...new Set(creatorIds as string[])];
  const creators = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, role: true } });
  if (creators.length !== ids.length || creators.some((u) => u.role !== 'STAFF')) throw deny();
}
