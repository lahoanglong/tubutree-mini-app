import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Độ dài tối đa của ghi chú nội bộ (DTO kiểm cùng số; ô nhập web dùng chung số này qua input-limits.table). */
export const ORDER_STAFF_NOTE_MAX = 500;
export const ORDER_STAFF_NOTE_AUDIT_ACTION = 'ORDER_STAFF_NOTE';

/** Đơn còn mở (kho còn soạn, còn giao). Đơn đã giao, đã huỷ hay đã trả thì không ai ở kho đọc ghi chú này nữa. */
export const STAFF_NOTE_OPEN_STATUSES: readonly OrderStatus[] = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING'];

export interface OrderStaffNoteView {
  note: string;
  updatedAt: string;
  updatedById: string;
  updatedByName: string | null;
}

type NoteRow = { note: string; updatedAt: Date; updatedById: string };

/** Gắn tên người lưu gần nhất cho các ghi chú (một truy vấn users cho cả trang). */
export async function staffNoteViews(
  db: Pick<PrismaService, 'user'> | Prisma.TransactionClient,
  rows: ReadonlyMap<string, NoteRow>,
): Promise<Map<string, OrderStaffNoteView>> {
  const ids = [...new Set([...rows.values()].map((r) => r.updatedById))];
  const names = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
  const nameOf = new Map(names.map((u) => [u.id, u.fullName]));
  const out = new Map<string, OrderStaffNoteView>();
  for (const [orderId, r] of rows) {
    out.set(orderId, { note: r.note, updatedAt: r.updatedAt.toISOString(), updatedById: r.updatedById, updatedByName: nameOf.get(r.updatedById) ?? null });
  }
  return out;
}

const STATUS_CLOSED_TEXT: Partial<Record<OrderStatus, string>> = {
  DELIVERED: 'đã giao',
  CANCELLED: 'đã huỷ',
  RETURNED: 'đã trả hàng',
};

/**
 * Ghi chú nội bộ CSKH/Admin gửi kho trên đơn còn mở. Không đụng `orders.note` (lời khách gõ lúc đặt, in lên phiếu và gửi Pancake),
 * không báo khách. Mỗi lần đổi chữ ghi một dòng admin_audit_logs trong cùng transaction.
 */
@Injectable()
export class OrderStaffNoteService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `baseUpdatedAt`: mốc của ghi chú người sửa đang thấy (null = lúc mở chưa có ghi chú). Người khác vừa lưu chen giữa thì mốc lệch và
   * lệnh bị từ chối 409, để không ghi đè mất chữ của đồng nghiệp. Chữ rỗng là xoá ghi chú.
   */
  async save(actorId: string, idOrCode: string, note: string, baseUpdatedAt: string | null) {
    const order = await this.prisma.order.findFirst({ where: { OR: [{ id: idOrCode }, { code: idOrCode }] }, select: { id: true, code: true, status: true } });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng.');
    if (!STAFF_NOTE_OPEN_STATUSES.includes(order.status)) {
      throw new BadRequestException(`Đơn ${order.code} ${STATUS_CLOSED_TEXT[order.status] ?? 'đã đóng'}, không sửa ghi chú nội bộ nữa.`);
    }
    if (note.length > ORDER_STAFF_NOTE_MAX) throw new BadRequestException(`Ghi chú nội bộ tối đa ${ORDER_STAFF_NOTE_MAX} ký tự.`);

    return this.prisma.$transaction(async (tx) => {
      // Hai người lưu cùng một đơn: khoá theo đơn để lần đọc mốc + ghi + audit của từng người không đan vào nhau.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'order-staff-note'}), hashtext(${order.id}))`;
      // Kho giao/huỷ đơn đúng lúc đang lưu: đọc lại trạng thái với FOR SHARE (lệnh đổi trạng thái đang chạy phải xong trước, lệnh mới chờ
      // transaction ngắn này) để không lưu ghi chú lên đơn vừa đóng và audit ghi đúng trạng thái lúc lưu.
      const [fresh] = await tx.$queryRaw<{ status: OrderStatus }[]>`SELECT "status"::text AS status FROM "orders" WHERE "id" = ${order.id} FOR SHARE`;
      if (!fresh) throw new NotFoundException('Không tìm thấy đơn hàng.');
      if (!STAFF_NOTE_OPEN_STATUSES.includes(fresh.status)) {
        throw new BadRequestException(`Đơn ${order.code} ${STATUS_CLOSED_TEXT[fresh.status] ?? 'đã đóng'}, không sửa ghi chú nội bộ nữa.`);
      }
      const current = await tx.orderStaffNote.findUnique({ where: { orderId: order.id }, select: { note: true, updatedAt: true, updatedById: true } });
      const seen = current?.updatedAt.toISOString() ?? null;
      if (seen !== baseUpdatedAt) {
        throw new ConflictException('Ghi chú nội bộ của đơn này vừa được người khác sửa. Tải lại để xem bản mới rồi sửa tiếp.');
      }
      const before = current?.note ?? null;
      const after = note || null;
      if (before === after) return { orderId: order.id, code: order.code, changed: false, staffNote: await this.view(tx, order.id, current) };

      const saved = after
        ? await tx.orderStaffNote.upsert({
            where: { orderId: order.id },
            create: { orderId: order.id, note: after, updatedById: actorId },
            update: { note: after, updatedById: actorId },
            select: { note: true, updatedAt: true, updatedById: true },
          })
        : null;
      if (!after) await tx.orderStaffNote.delete({ where: { orderId: order.id } });
      await tx.adminAuditLog.create({
        data: {
          actorId,
          action: ORDER_STAFF_NOTE_AUDIT_ACTION,
          targetType: 'ORDER',
          targetIds: [order.id],
          payload: { code: order.code, status: fresh.status, before, after },
        },
      });
      return { orderId: order.id, code: order.code, changed: true, staffNote: await this.view(tx, order.id, saved) };
    });
  }

  private async view(tx: Prisma.TransactionClient, orderId: string, row: NoteRow | null): Promise<OrderStaffNoteView | null> {
    if (!row) return null;
    return (await staffNoteViews(tx, new Map([[orderId, row]]))).get(orderId) ?? null;
  }
}
