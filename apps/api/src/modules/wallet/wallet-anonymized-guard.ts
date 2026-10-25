import type { Prisma } from '@prisma/client';
import { applyWalletDelta, type WalletDeltaInput } from './wallet-ledger.service';

/** Giờ ẩn danh mà AccountDeletionService.anonymize ghi vào users.metadata; null khi tài khoản còn dùng được. */
export function anonymizedAtOf(metadata: unknown): string | null {
  const at = (metadata as { anonymizedAt?: unknown } | null | undefined)?.anonymizedAt;
  return typeof at === 'string' ? at : null;
}

/**
 * Cộng Ví trừ khi tài khoản đã ẩn danh (khách đã xoá: Ví đã bị trừ về 0 và không ai đăng nhập được, tiền cộng vào đó là mất).
 * Đọc cờ và cộng là một bước dưới cùng khoá dòng user (NO KEY UPDATE, mức khoá của sổ Ví) nên một lần xoá chen giữa không
 * lọt qua được: xoá ẩn danh cần ghi dòng đó nên đứng chờ hoặc đã commit trước khi ta đọc.
 */
export async function creditWalletUnlessAnonymized(
  tx: Prisma.TransactionClient,
  input: WalletDeltaInput,
): Promise<{ credited: true; anonymizedAt: null } | { credited: false; anonymizedAt: string }> {
  const rows = await tx.$queryRaw<{ metadata: unknown }[]>`SELECT "metadata" FROM "users" WHERE "id" = ${input.userId} FOR NO KEY UPDATE`;
  const anonymizedAt = anonymizedAtOf(rows?.[0]?.metadata);
  if (anonymizedAt) return { credited: false, anonymizedAt };
  await applyWalletDelta(tx, input);
  return { credited: true, anonymizedAt: null };
}
