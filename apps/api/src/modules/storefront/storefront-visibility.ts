import type { Prisma, StorefrontType, UserRole } from '@prisma/client';

export interface PublicVisibilityOptions {
  /** Vai trò được ghi công đơn và hưởng hoa hồng (`affiliate.commission_eligible_roles`). */
  eligibleRoles: readonly UserRole[];
  /** Cờ `storefront.require_approval`. */
  requireApproval: boolean;
}

/**
 * Gian hàng đã được duyệt (tick xanh, nhãn "CTV tuyển chọn"). Gian hàng đối tác đã qua bước duyệt đại lý và nhãn hàng do admin
 * tạo nên luôn tính là đã duyệt; chỉ gian hàng CTV cần `approvedAt`.
 */
export function isStorefrontApproved(sf: { type: StorefrontType; isPartner: boolean; approvedAt: Date | null }): boolean {
  return sf.type !== 'CTV' || sf.isPartner || sf.approvedAt != null;
}

/**
 * Vai trò của chủ mà gian hàng CTV còn hiện với khách: nhóm hưởng hoa hồng, và ADMIN (tài khoản vận hành tự lập gian hàng CTV
 * không hưởng hoa hồng nhưng gian hàng vẫn phải hiện).
 */
function visibleOwnerRoles(opts: PublicVisibilityOptions): UserRole[] {
  return opts.eligibleRoles.includes('ADMIN') ? [...opts.eligibleRoles] : [...opts.eligibleRoles, 'ADMIN'];
}

/**
 * Điều kiện để khách thấy một gian hàng: đã đăng, không bị admin gỡ, chủ không bị khoá, và (gian hàng CTV) chủ còn thuộc vai trò
 * hưởng hoa hồng (hoặc là ADMIN), nên CTV bị hạ về khách thường thì gian hàng ẩn theo. Gian hàng MERCHANT/BRAND không xét vai trò. Dùng chung cho
 * trang công khai, sitemap và mọi nơi tra gian hàng cho khách.
 */
export function publicStorefrontWhere(opts: PublicVisibilityOptions): Prisma.StorefrontWhereInput {
  const and: Prisma.StorefrontWhereInput[] = [
    { OR: [{ ownerUserId: null }, { owner: { isBlocked: false } }] },
    { OR: [{ type: { not: 'CTV' } }, { owner: { role: { in: visibleOwnerRoles(opts) } } }] },
  ];
  if (opts.requireApproval) and.push({ OR: [{ approvedAt: { not: null } }, { type: { not: 'CTV' } }, { isPartner: true }] });
  return { isPublished: true, takenDownAt: null, AND: and };
}

export type OwnerStorefrontStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'LIVE' | 'TAKEN_DOWN' | 'HIDDEN';

type OwnerStorefrontFacts = { type: StorefrontType; isPartner: boolean; isPublished: boolean; approvedAt: Date | null; takenDownAt: Date | null; takenDownReason: string | null };

/**
 * Trạng thái của gian hàng với chính chủ, kèm lý do khi khách chưa thấy dù chủ đã đăng. DRAFT = chủ chưa đăng (hoặc đã tự gỡ);
 * PENDING_APPROVAL = đã gửi duyệt, chờ Tubu Tree duyệt lần đầu; LIVE = khách thấy; TAKEN_DOWN = admin gỡ; HIDDEN = đang ẩn vì
 * chủ bị khoá hoặc không còn thuộc nhóm CTV. Cùng luật với `publicStorefrontWhere`.
 */
export function ownerStorefrontState(
  sf: OwnerStorefrontFacts,
  owner: { role: UserRole; isBlocked: boolean } | null,
  opts: PublicVisibilityOptions,
): { status: OwnerStorefrontStatus; reason: string | null } {
  if (sf.takenDownAt) {
    return {
      status: 'TAKEN_DOWN',
      reason: `Tubu Tree đã gỡ gian hàng này khỏi trang công khai${sf.takenDownReason ? `: ${sf.takenDownReason}` : ''}. Liên hệ CSKH nếu bạn cần được xem xét lại.`,
    };
  }
  if (!sf.isPublished) return { status: 'DRAFT', reason: null };
  if (owner?.isBlocked) return { status: 'HIDDEN', reason: 'Tài khoản của bạn đang bị khoá nên gian hàng không hiện với khách.' };
  if (sf.type === 'CTV' && !(owner && visibleOwnerRoles(opts).includes(owner.role))) {
    return {
      status: 'HIDDEN',
      reason: 'Tài khoản của bạn hiện không thuộc nhóm CTV nên gian hàng đang ẩn với khách. Đăng ký lại CTV để gian hàng hiện trở lại.',
    };
  }
  if (opts.requireApproval && !isStorefrontApproved(sf)) {
    return { status: 'PENDING_APPROVAL', reason: 'Gian hàng đang chờ Tubu Tree duyệt lần đầu; khi được duyệt sẽ hiện với khách.' };
  }
  return { status: 'LIVE', reason: null };
}

/** Vì sao gian hàng ĐANG ĐĂNG mà khách không thấy, nói cho chính chủ trong trình dựng (null = khách thấy, hoặc là bản nháp do chủ tự chưa đăng). */
export function ownerHiddenReason(sf: OwnerStorefrontFacts, owner: { role: UserRole; isBlocked: boolean } | null, opts: PublicVisibilityOptions): string | null {
  return ownerStorefrontState(sf, owner, opts).reason;
}
