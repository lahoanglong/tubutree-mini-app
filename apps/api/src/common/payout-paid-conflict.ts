import { ConflictException } from '@nestjs/common';
import { formatVnDateTime } from './vn-time';

type PaidRow = { paidBy: string | null; paidAt: Date | null; bankRef: string | null };
type UserNames = { user: { findUnique(args: { where: { id: string }; select: { fullName: true } }): Promise<{ fullName: string | null } | null> } };

/**
 * Chuyển tiền diễn ra ngoài hệ thống trước khi bấm "Đã chuyển", nên người bấm sau một phiếu đã PAID phải biết ngay là
 * có người khác đã chuyển (để đòi lại tiền chuyển trùng), không được nhận thành công im lặng. Cùng người, cùng mã giao dịch
 * gọi lại (bấm lặp, mất mạng giữa chừng) vẫn là thành công.
 */
export const isSameConfirmation = (row: PaidRow, adminId: string, bankRef: string | undefined): boolean =>
  row.paidBy === adminId && (!bankRef || row.bankRef === bankRef);

export async function alreadyPaidConflict(prisma: UserNames, row: PaidRow): Promise<ConflictException> {
  const holder = row.paidBy
    ? ((await prisma.user.findUnique({ where: { id: row.paidBy }, select: { fullName: true } }))?.fullName?.trim() || 'một quản trị viên khác')
    : 'một quản trị viên khác';
  const at = row.paidAt ? ` lúc ${formatVnDateTime(row.paidAt)}` : '';
  const ref = row.bankRef ? `, mã GD ${row.bankRef}` : '';
  return new ConflictException(`Phiếu đã được ${holder} xác nhận chuyển${at}${ref}. Nếu bạn đã chuyển tiền, liên hệ người nhận để thu hồi khoản chuyển trùng.`);
}
