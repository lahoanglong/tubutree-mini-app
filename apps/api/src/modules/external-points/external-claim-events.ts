import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

type Db = Pick<Prisma.TransactionClient, 'analyticsEvent'>;

/** Ghi sự kiện phễu tích điểm đơn sàn trong chính transaction của nghiệp vụ: rollback thì sự kiện cũng mất, không đếm khống. */
export async function recordExtClaimEvent(
  db: Db,
  e: { name: 'ext_claim_submitted' | 'ext_claim_credited'; userId: string; props: Record<string, unknown>; at?: Date },
): Promise<void> {
  await db.analyticsEvent.create({
    data: { eventId: randomUUID(), eventName: e.name, userId: e.userId, platform: 'system', occurredAt: e.at ?? new Date(), props: e.props as Prisma.InputJsonValue },
  });
}
