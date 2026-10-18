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
  orderStatus?: string | null;
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
      orderStatus: e.orderStatus ?? null,
    },
  });
}

/** Người đã gắn claim, đưa claim vào REVIEW hoặc mở lại mã (rồi người khác nhận lại): không được tự duyệt claim đó. */
export async function claimIntroducers(db: Pick<Prisma.TransactionClient, 'externalClaimEvent'>, claimId: string): Promise<string[]> {
  const rows = await db.externalClaimEvent.findMany({
    where: { claimId, action: { in: ['ATTACH', 'TO_REVIEW', 'VOID_REOPEN'] }, actorId: { not: null } },
    select: { actorId: true },
  });
  return rows.map((r) => r.actorId!).filter(Boolean);
}

/**
 * Lần duyệt/gắn vào PENDING gần nhất có xảy ra khi đơn đã ở PARTIAL_RETURN không. Chỉ quyết định đó mới là "đã quyết cho đơn hoàn một
 * phần"; duyệt lúc đơn còn DELIVERED rồi đơn mới hoàn một phần thì phải kiểm lại.
 */
export async function decidedAtPartialReturn(db: Pick<Prisma.TransactionClient, 'externalClaimEvent'>, claimId: string): Promise<boolean> {
  const e = await db.externalClaimEvent.findFirst({
    where: { claimId, action: { in: ['APPROVE', 'ATTACH'] }, toState: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    select: { orderStatus: true },
  });
  return e?.orderStatus === 'PARTIAL_RETURN';
}

/**
 * User gốc sau khi gộp tài khoản (`mergedIntoId`), đi tối đa 5 bước. Nếu dữ liệu tạo vòng thì trả id nhỏ nhất trong vòng để hai phía
 * so sánh luôn ra cùng một giá trị bất kể điểm vào.
 */
export async function canonicalUserId(db: Pick<Prisma.TransactionClient, 'user'>, userId: string): Promise<string> {
  const path: string[] = [];
  let cur = userId;
  for (let i = 0; i < 8; i++) {
    const seen = path.indexOf(cur);
    if (seen >= 0) return path.slice(seen).reduce((m, id) => (id < m ? id : m));
    path.push(cur);
    const u = await db.user.findUnique({ where: { id: cur }, select: { mergedIntoId: true } });
    if (!u?.mergedIntoId) return cur;
    cur = u.mergedIntoId;
  }
  return cur;
}
