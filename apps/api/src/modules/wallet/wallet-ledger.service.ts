import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, WalletTxType } from '@prisma/client';

export interface WalletDeltaInput {
  userId: string;
  /** VND có dấu: dương = vào ví, âm = ra khỏi ví. Số nguyên khác 0. */
  delta: number;
  type: WalletTxType;
  refType?: string | null;
  /** Khoá chống ghi trùng cùng (userId, type). Bỏ trống chỉ khi biến động không có tham chiếu. */
  refId?: string | null;
  reason?: string | null;
}

export interface WalletDeltaResult {
  /** false = (userId, type, refId) đã ghi sổ trước đó → không đổi số dư lần nữa. */
  applied: boolean;
  balanceAfter: number;
  entryId: string;
}

/**
 * Điểm DUY NHẤT được thay đổi users.walletBalance (Ví Tubu — VND thật, rút được). Mỗi biến động
 * ghi đúng 1 dòng wallet_transactions trong transaction của caller, nên số dư và sổ cùng commit
 * hoặc cùng rollback với nghiệp vụ gây ra nó (bất biến walletBalance == SUM(delta), C-060).
 *
 * Không có phụ thuộc DI: module nào cũng khai báo provider được mà không phải import WalletModule
 * (tránh vòng import orders/checkout/auth ↔ wallet).
 */
@Injectable()
export class WalletLedgerService {
  async applyDelta(tx: Prisma.TransactionClient, input: WalletDeltaInput): Promise<WalletDeltaResult> {
    const { userId, delta, type } = input;
    if (!Number.isSafeInteger(delta) || delta === 0) {
      throw new BadRequestException('Số tiền không hợp lệ.');
    }
    const refId = input.refId?.trim() || null;

    // Khoá dòng user TRƯỚC khi tra trùng: mọi lần ghi sổ của cùng user đều đi qua khoá này, nên
    // việc tra trùng + đọc số dư + ghi dòng mới được tuần tự hoá theo user. Không khoá thì 2 tx
    // cùng refId đều thấy "chưa có", tx thua chỉ nổ P2002 ở INSERT — lỗi đó huỷ cả tx của caller
    // (Postgres abort transaction, xem C-061) thay vì được bỏ qua êm.
    const locked = await tx.$queryRaw<{ walletBalance: number }[]>`
      SELECT "walletBalance" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
    const row = locked[0];
    if (!row) throw new NotFoundException('Không tìm thấy tài khoản.');
    const current = row.walletBalance;

    if (refId) {
      const existing = await tx.walletTransaction.findUnique({
        where: { userId_type_refId: { userId, type, refId } },
        select: { id: true },
      });
      if (existing) return { applied: false, balanceAfter: current, entryId: existing.id };
    }

    // Chỉ chặn lệnh TRỪ làm âm; lệnh cộng vẫn cho vào ví lỡ âm từ dữ liệu cũ để nó tiến về 0.
    if (delta < 0 && current + delta < 0) throw new BadRequestException('Số dư ví không đủ.');

    const updated = await tx.user.update({
      where: { id: userId },
      data: { walletBalance: { increment: delta } },
      select: { walletBalance: true },
    });
    const entry = await tx.walletTransaction.create({
      data: {
        userId,
        delta,
        balanceAfter: updated.walletBalance,
        type,
        refType: input.refType ?? null,
        refId,
        reason: input.reason ?? null,
      },
      select: { id: true },
    });
    return { applied: true, balanceAfter: updated.walletBalance, entryId: entry.id };
  }
}
