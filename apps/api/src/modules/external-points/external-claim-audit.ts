import type { Prisma } from '@prisma/client';

export type ClaimEventAction =
  | 'CLAIM_CREATED'
  | 'ATTACH'
  | 'APPROVE'
  | 'VOID'
  | 'VOID_REOPEN'
  | 'REOPEN_CLAIM'
  | 'REVERSE'
  | 'KEEP_POINTS'
  | 'CREDIT'
  | 'AUTO_VOID'
  | 'AUTO_REVERSE'
  | 'TO_REVIEW'
  | 'FLAG_PARTIAL';

export interface ClaimEventInput {
  claimId: string;
  action: ClaimEventAction;
  actorId?: string | null;
  fromState?: string | null;
  toState?: string | null;
  userIdBefore?: string | null;
  userIdAfter?: string | null;
  note?: string | null;
}

/** Ghi một dòng nhật ký (chỉ thêm). Gọi TRONG transaction đã đổi claim để dòng và thay đổi cùng commit hay cùng rollback. */
export async function recordClaimEvent(db: Pick<Prisma.TransactionClient, 'externalClaimEvent'>, e: ClaimEventInput): Promise<void> {
  await db.externalClaimEvent.create({
    data: {
      claimId: e.claimId,
      action: e.action,
      actorId: e.actorId ?? null,
      fromState: e.fromState ?? null,
      toState: e.toState ?? null,
      userIdBefore: e.userIdBefore ?? null,
      userIdAfter: e.userIdAfter ?? null,
      note: e.note?.slice(0, 500) ?? null,
    },
  });
}

/** Người đã gắn claim hoặc đưa claim vào REVIEW: không được tự duyệt claim đó. */
export async function claimIntroducers(db: Pick<Prisma.TransactionClient, 'externalClaimEvent'>, claimId: string): Promise<string[]> {
  const rows = await db.externalClaimEvent.findMany({
    where: { claimId, action: { in: ['ATTACH', 'TO_REVIEW'] }, actorId: { not: null } },
    select: { actorId: true },
  });
  return rows.map((r) => r.actorId!).filter(Boolean);
}
