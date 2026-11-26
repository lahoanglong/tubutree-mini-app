import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { Order, Prisma } from '@prisma/client';
import type { OrderEditResultDTO } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { GeoService } from '../integrations/pancake/geo.service';
import { assertDeliverableAddress } from '../integrations/pancake/address-geo';
import { PancakePackingError, PancakeSyncHooks, PancakeUnreachableError } from '../integrations/pancake/pancake-sync-hooks';
import {
  countCustomerEdits,
  customerEditBlock,
  ORDER_CUSTOMER_SELF_EDIT_KEY,
  ORDER_EDIT_MAX,
  ORDER_EDIT_REFUSED,
  orderEditHistoryNote,
  orderEditRefusalMessage,
  planCustomerEdit,
  snapshotOf,
  type OrderEditFacts,
  type OrderEditInput,
  type OrderEditRefusal,
} from './order-customer-edit';

function refused(reason: OrderEditRefusal, province?: string): ConflictException | BadRequestException {
  const body = { code: ORDER_EDIT_REFUSED, reason, message: orderEditRefusalMessage(reason, province) };
  // Khác tỉnh là thân yêu cầu sai (400); mọi lý do khác là trạng thái đơn không cho sửa (409, cùng khuôn COD_SWITCH_REFUSED).
  return reason === 'PROVINCE_CHANGED'
    ? new BadRequestException({ statusCode: 400, error: 'Bad Request', ...body })
    : new ConflictException({ statusCode: 409, error: 'Conflict', ...body });
}

type TxOutcome =
  | { kind: 'REFUSED'; reason: OrderEditRefusal; province?: string }
  | { kind: 'NOOP'; order: Order; editsUsed: number }
  | { kind: 'WRITTEN'; order: Order; editsUsed: number; changed: string[] };

/**
 * Chủ đơn đăng nhập tự sửa người nhận, SĐT, phường/xã, số nhà (cùng tỉnh) và ghi chú trước khi đóng gói (PATCH /orders/:code/delivery). Luật ở
 * `order-customer-edit.ts`. Chép khuôn đổi COD (order-cod-switch.service.ts):
 *  - Đơn đã lên Pancake: hỏi Pancake TRƯỚC, ngoài transaction (có mạng). Kho đã đóng gói hay không hỏi được: từ chối (đóng khi không chắc: sửa địa
 *    chỉ sau khi in nhãn là giao sai).
 *  - Trong transaction: khoá dòng đơn (`SELECT … FOR UPDATE`), đọc lại, xét lại luật và lượt dưới khoá, rồi câu ghi có điều kiện (trạng thái +
 *    `updatedAt`). Mọi đường ghi trạng thái khác (đóng gói, huỷ, đổi COD, nhận tiền, webhook) phải chờ khoá nên chạy tuần tự với lần sửa.
 *  - Không bao giờ ghi cột tiền hay trạng thái. Dòng lịch sử cùng trạng thái chỉ ghi tên trường đổi, không ghi SĐT hay địa chỉ.
 *  - Sau commit: xếp job Pancake `customer-edit` (sửa địa chỉ và ghi chú trên đơn kho, đọc lại để đối chiếu).
 */
@Injectable()
export class OrderCustomerEditService {
  private readonly logger = new Logger(OrderCustomerEditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    @Optional() private readonly geo?: GeoService,
    @Optional() private readonly pancakeHooks?: PancakeSyncHooks,
  ) {}

  async flagOn(): Promise<boolean> {
    return (await this.config.get<unknown>(ORDER_CUSTOMER_SELF_EDIT_KEY, false)) === true;
  }

  /** `canEdit` của chi tiết đơn: cùng luật với lần sửa thật, không khoá, không hỏi Pancake (hỏi Pancake chỉ lúc gửi). Cờ tắt: không đọc gì thêm. */
  async canEdit(order: OrderEditFacts & Pick<Order, 'id'>): Promise<boolean> {
    if (!(await this.flagOn())) return false;
    // Rẻ trước: đơn không còn sửa được thì khỏi đếm lượt.
    if (customerEditBlock(order, { flagOn: true, editsUsed: 0 }) !== null) return false;
    return customerEditBlock(order, { flagOn: true, editsUsed: await countCustomerEdits(this.prisma, order.id) }) === null;
  }

  async editForOwner(userId: string, code: string, input: OrderEditInput): Promise<OrderEditResultDTO> {
    if (!input.address && input.note === undefined) throw new BadRequestException('Bạn chưa đổi địa chỉ hay ghi chú nào.');
    const order = await this.prisma.order.findUnique({ where: { code } });
    if (!order || order.userId !== userId) throw new NotFoundException('Không tìm thấy đơn hàng.');
    const flagOn = await this.flagOn();
    const block = customerEditBlock(order, { flagOn, editsUsed: await countCustomerEdits(this.prisma, order.id) });
    if (block) throw refused(block);
    const precheck = planCustomerEdit(order, input);
    if (precheck.kind === 'REFUSED') throw refused(precheck.reason, snapshotOf(order.shippingAddress).province);
    // Không đổi gì: trả đơn như đang có, không khoá, không hỏi Pancake, không tính lượt.
    if (precheck.kind === 'NOOP') return this.result(order, ORDER_EDIT_MAX - (await countCustomerEdits(this.prisma, order.id)));
    // Kiểm địa giới trên đúng địa chỉ khách gửi (không chỉ khi khác đơn lúc đọc): lần sửa song song có thể đổi ảnh chụp trước khi ta lấy khoá.
    if (input.address) await assertDeliverableAddress(this.geo, input.address);
    if (order.pancakeOrderId) await this.precheckPancake(order);

    const outcome = await this.prisma.$transaction(async (tx): Promise<TxOutcome> => {
      await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${order.id} FOR UPDATE`;
      const current = await tx.order.findUnique({ where: { id: order.id } });
      if (!current) throw new NotFoundException('Không tìm thấy đơn hàng.');
      const editsUsed = await countCustomerEdits(tx, order.id);
      // Trạng thái, mốc bàn giao, lượt sửa có thể vừa đổi giữa lần đọc ngoài và lúc lấy khoá.
      const reason = customerEditBlock(current, { flagOn, editsUsed });
      if (reason) return { kind: 'REFUSED', reason };
      // Lệnh tạo đơn Pancake vừa xong giữa lúc hỏi Pancake và lúc lấy khoá: đơn kho chưa được hỏi.
      if (current.pancakeOrderId !== order.pancakeOrderId) return { kind: 'REFUSED', reason: 'SYNCING' };
      // Dựng lại trên đơn hiện tại: lần sửa chạy song song có thể vừa đổi ảnh chụp.
      const plan = planCustomerEdit(current, input);
      if (plan.kind === 'REFUSED') return { kind: 'REFUSED', reason: plan.reason, province: snapshotOf(current.shippingAddress).province };
      if (plan.kind === 'NOOP') return { kind: 'NOOP', order: current, editsUsed };
      const data: Prisma.OrderUpdateManyMutationInput = {
        shippingAddress: { ...plan.shippingAddress },
        note: plan.note,
        ...(plan.disableRecipientZalo ? { notifyRecipientZalo: false } : {}),
      };
      // Dưới khoá điều kiện không đổi được nữa; vẫn giữ điều kiện trong câu ghi để một đường ghi không khoá (nếu có) cũng không chen được.
      const written = await tx.order.updateMany({
        where: { id: order.id, status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] }, updatedAt: current.updatedAt },
        data,
      });
      if (written.count !== 1) return { kind: 'REFUSED', reason: 'NOT_EDITABLE_STATUS' };
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: current.status,
          toStatus: current.status,
          actorType: 'CUSTOMER',
          actorId: userId,
          note: orderEditHistoryNote(plan.changed),
        },
      });
      const after = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
      return { kind: 'WRITTEN', order: after, editsUsed: editsUsed + 1, changed: plan.changed };
    });

    if (outcome.kind === 'REFUSED') {
      this.logger.log(`order_customer_edit_refused order=${order.code} reason=${outcome.reason}`);
      throw refused(outcome.reason, outcome.province);
    }
    if (outcome.kind === 'WRITTEN') {
      this.logger.log(`order_customer_edit order=${order.code} fields=${outcome.changed.join('|')}`);
      await this.afterEdit(outcome.order);
    }
    return this.result(outcome.order, ORDER_EDIT_MAX - outcome.editsUsed);
  }

  private result(o: Order, editsLeft: number): OrderEditResultDTO {
    return {
      code: o.code,
      shippingAddress: snapshotOf(o.shippingAddress),
      note: o.note,
      notifyRecipientZalo: o.notifyRecipientZalo,
      editsLeft: Math.max(0, editsLeft),
    };
  }

  /** Đơn đã lên kho: Pancake còn trước đóng gói mới cho sửa. Không có móc Pancake (cấu hình lạ): từ chối như không hỏi được. */
  private async precheckPancake(order: Order): Promise<void> {
    if (!this.pancakeHooks) throw refused('PANCAKE_UNREACHABLE');
    try {
      await this.pancakeHooks.precheckCustomerEdit(order);
    } catch (err) {
      if (err instanceof PancakePackingError) throw refused('PACKING_ON_PANCAKE');
      if (err instanceof PancakeUnreachableError) throw refused('PANCAKE_UNREACHABLE');
      throw err;
    }
  }

  /** Sau commit, tự bắt lỗi (đơn đã sửa xong, khách không được thấy lỗi): báo kho Pancake sửa địa chỉ/ghi chú. */
  private async afterEdit(order: Order): Promise<void> {
    await this.pancakeHooks
      ?.afterCustomerEdit(order.id)
      .catch((err: unknown) => this.logger.error(`Không xếp được việc sửa đơn Pancake cho ${order.code}: ${err instanceof Error ? err.message : String(err)}`));
  }
}
