import type { Prisma } from '@prisma/client';

// pg_advisory_xact_lock returns void, which $queryRaw cannot deserialize, so every helper uses $executeRaw.
// The class number stays in the SQL text, never a bound parameter, so the two-key overload is chosen.

export async function lockWasteCustomer(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(731001, hashtext(${userId}))`;
}

export async function lockWasteTracking(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(731002, 0)`;
}

export async function lockWasteStaffCap(tx: Prisma.TransactionClient, staffUserId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(731003, hashtext(${staffUserId}))`;
}

export async function lockWastePointCreate(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(731004, 0)`;
}
