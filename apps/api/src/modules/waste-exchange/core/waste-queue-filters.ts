import type { Prisma } from '@prisma/client';
import { WASTE_OPEN_STATUSES } from '../waste.constants';

export const WASTE_TO_COUNT_WHERE: Prisma.WasteRequestWhereInput = { method: { in: ['MAIL_IN', 'PICKUP'] }, status: 'RECEIVED' };

export const WASTE_EXPIRED_WHERE: Prisma.WasteRequestWhereInput = { status: 'EXPIRED' };

export const WASTE_UNMATCHED_OPEN_WHERE: Prisma.WasteUnmatchedParcelWhereInput = { status: 'OPEN' };

export const WASTE_POINTS_PENDING_WHERE: Prisma.WastePointWhereInput = { status: 'PENDING' };

export const WASTE_PERKS_PENDING_WHERE: Prisma.WastePointWhereInput = { AND: [{ perkPendingText: { not: null } }, { perkPendingText: { not: '' } }] };

export function wasteCustomerBlockedWhere(): Prisma.WasteRequestWhereInput {
  return {
    status: { in: [...WASTE_OPEN_STATUSES] },
    user: { OR: [{ isBlocked: true }, { wasteFlags: { is: { blockedAt: { not: null } } } }] },
  };
}

export function wasteOrderNotDeliveredWhere(): Prisma.WasteRequestWhereInput {
  return {
    method: 'PICKUP',
    orderId: { not: null },
    status: 'OPEN',
    order: { is: { status: { notIn: ['DELIVERED', 'RETURNED', 'CANCELLED'] } } },
  };
}

export function wasteTransitOverdueWhere(now: Date, reviewDays: number): Prisma.WasteRequestWhereInput {
  return { method: 'MAIL_IN', status: 'IN_TRANSIT', inTransitAt: { lt: new Date(now.getTime() - reviewDays * 86_400_000) } };
}

export function wasteOrderMismatchWhere(): Prisma.WasteRequestWhereInput {
  return {
    OR: [
      { status: { not: 'CANCELLED' }, order: { is: { status: 'CANCELLED' } } },
      { status: 'CANCELLED', order: { is: { status: { in: ['DELIVERED', 'RETURNED'] } } } },
    ],
  };
}

export function wasteGiftOverdueWhere(now: Date): Prisma.WasteGiftRedemptionWhereInput {
  return { status: 'READY', claimExpiresAt: { lt: now } };
}
