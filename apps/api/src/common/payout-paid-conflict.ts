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

export type PaidConflictContext = {
  /** Tên gọi trên màn hình: lệnh rút của CTV là "Lệnh rút", phiếu gian hàng là "Phiếu đối soát". */
  noun: 'Lệnh rút' | 'Phiếu đối soát';
  /** Phiếu âm: gian hàng nộp tiền cho Tubu, không có khoản nào chuyển đi để thu hồi. */
  collected?: boolean;
  /** Người đang gọi. Trùng người đã xác nhận (nhưng mã GD khác) thì không phải "người khác chuyển trùng", nên không dặn thu hồi. */
  actorId?: string;
};

export async function alreadyPaidConflict(prisma: UserNames, row: PaidRow, ctx: PaidConflictContext): Promise<ConflictException> {
  if (ctx.actorId && row.paidBy === ctx.actorId) {
    const when = row.paidAt ? ` lúc ${formatVnDateTime(row.paidAt)}` : '';
    const code = row.bankRef ? ` với mã GD «${row.bankRef}»` : '';
    // Mã GD khác có thể là gõ nhầm lần đầu, cũng có thể là đã chuyển tiền thật lần hai, nên chỉ dặn thu hồi có điều kiện.
    // Phiếu âm là tiền gian hàng nộp vào, không có khoản nào chuyển đi để thu hồi.
    const recover = ctx.collected ? '' : ' Nếu bạn đã chuyển thêm một lần nữa, liên hệ người nhận để thu hồi khoản chuyển trùng.';
    return new ConflictException(`Bạn đã xác nhận khoản này${when}${code}. Hệ thống không ghi lần hai.${recover}`);
  }
  const holder = row.paidBy
    ? ((await prisma.user.findUnique({ where: { id: row.paidBy }, select: { fullName: true } }))?.fullName?.trim() || 'một quản trị viên khác')
    : 'một quản trị viên khác';
  const at = row.paidAt ? ` lúc ${formatVnDateTime(row.paidAt)}` : '';
  const ref = row.bankRef ? `, mã GD ${row.bankRef}` : '';
  if (ctx.collected) return new ConflictException(`${ctx.noun} đã được ${holder} xác nhận đã thu${at}${ref}. Tải lại danh sách để xem trạng thái mới nhất.`);
  return new ConflictException(
    `${ctx.noun} đã được ${holder} xác nhận chuyển${at}${ref}. Nếu bạn đã chuyển tiền, liên hệ người nhận để thu hồi khoản chuyển trùng.`,
  );
}
