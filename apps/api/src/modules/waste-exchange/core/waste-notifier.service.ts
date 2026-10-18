import { Injectable, Logger } from '@nestjs/common';
import type { WasteCloseReason, WasteRejectionReason } from '@tubutree/shared-types';
import { formatPoints } from '../../../common/format-points';
import { formatVnDate } from '../../../common/vn-time';
import { NotificationsService } from '../../notifications/notifications.service';

export const WASTE_REJECTION_REASON_TEXT: Record<WasteRejectionReason, string> = {
  WET: 'hàng bị ướt',
  DIRTY: 'hàng còn bẩn',
  FOREIGN_OBJECT: 'có lẫn vật lạ',
  WRONG_TYPE: 'không đúng loại hàng Tubu nhận',
  DAMAGED: 'hàng bị hỏng',
  NOT_ACCEPTED: 'có món Tubu không nhận',
  OVERSIZE: 'kiện vượt giới hạn cân nặng hoặc kích thước',
  HAZARDOUS: 'có vật không nhận',
  UNPAID_POSTAGE: 'kiện còn cước phải trả khi nhận',
  OTHER: 'lý do khác, Tubu đã ghi chú trong yêu cầu',
};

export const WASTE_EXPIRED_DETAIL_TEXT: Record<WasteCloseReason, string> = {
  HOLD_EXPIRED: 'hết hạn giữ chỗ, phần trần của bạn đã được trả lại',
  PICKUP_NO_SHOW: 'kho chưa nhận được rác thu kèm đơn',
  PICKUP_NOT_DISPATCHED: 'Tubu chưa sắp xếp được người đến lấy rác thu kèm đơn, xin lỗi bạn. Bạn có thể gửi về kho Tubu ở lần sau',
  LOST: 'đã đóng vì kiện thất lạc trên đường gửi',
  LOST_AT_WAREHOUSE: 'kiện bị thất lạc tại kho Tubu, xin lỗi bạn. Bạn nhắn Tubu Tree để được hỗ trợ',
  SHIP_LOCKED: 'đường gửi kho và thu kèm đơn đang tạm dừng',
  ORDER_CANCELLED: 'đơn mua gắn kèm đã bị huỷ',
};

/** Lý do admin gõ tay: mẫu thông báo đã tự thêm dấu chấm cuối câu. */
export function stripTrailingStop(s: string): string {
  return s.trim().replace(/[.\s]+$/u, '');
}

type RequestRef = { id: string; code: string };

@Injectable()
export class WasteNotifierService {
  private readonly logger = new Logger(WasteNotifierService.name);

  constructor(private readonly notifications: NotificationsService) {}

  async parcelReceived(userId: string, req: RequestRef, receiveEventId: string): Promise<void> {
    await this.notifications
      .notify(userId, 'WASTE_PARCEL_RECEIVED', { code: req.code, request_id: req.id }, { dedupeKey: `waste:${req.id}:RECEIVED:${receiveEventId}` })
      .catch((e: unknown) => this.logger.warn(`notify WASTE_PARCEL_RECEIVED failed: ${String(e)}`));
  }

  async pointsCredited(userId: string, req: RequestRef, points: number, drops: number): Promise<void> {
    const result =
      points > 0
        ? `Tubu đã cộng ${formatPoints(points)} Điểm Xanh${drops > 0 ? ` và ${drops} giọt nước` : ''}`
        : `Số đếm được chưa đủ để cộng Điểm Xanh${drops > 0 ? `, Tubu đã thêm ${drops} giọt nước vào bình của bạn` : ''}`;
    await this.notifications
      .notify(userId, 'WASTE_POINTS_CREDITED', { code: req.code, result, request_id: req.id }, { dedupeKey: `waste:${req.id}:COMPLETED` })
      .catch((e: unknown) => this.logger.warn(`notify WASTE_POINTS_CREDITED failed: ${String(e)}`));
  }

  async requestRejected(userId: string, req: RequestRef, reason: WasteRejectionReason): Promise<void> {
    await this.notifications
      .notify(userId, 'WASTE_REQUEST_REJECTED', { code: req.code, reason: WASTE_REJECTION_REASON_TEXT[reason], request_id: req.id }, { dedupeKey: `waste:${req.id}:REJECTED` })
      .catch((e: unknown) => this.logger.warn(`notify WASTE_REQUEST_REJECTED failed: ${String(e)}`));
  }

  async requestExpired(userId: string, req: RequestRef, closeReason: WasteCloseReason, closedAt: Date): Promise<void> {
    await this.notifications
      .notify(userId, 'WASTE_REQUEST_EXPIRED', { code: req.code, detail: WASTE_EXPIRED_DETAIL_TEXT[closeReason], request_id: req.id }, { dedupeKey: `waste:${req.id}:EXPIRED:${closedAt.toISOString()}` })
      .catch((e: unknown) => this.logger.warn(`notify WASTE_REQUEST_EXPIRED failed: ${String(e)}`));
  }

  async pickupStarted(userId: string, req: RequestRef, expiresAt: Date): Promise<void> {
    await this.notifications
      .notify(userId, 'WASTE_PICKUP_STARTED', { code: req.code, until: formatVnDate(expiresAt), request_id: req.id }, { dedupeKey: `waste:${req.id}:IN_TRANSIT` })
      .catch((e: unknown) => this.logger.warn(`notify WASTE_PICKUP_STARTED failed: ${String(e)}`));
  }

  async pickupCancelled(userId: string, req: RequestRef): Promise<void> {
    await this.notifications
      .notify(userId, 'WASTE_PICKUP_CANCELLED', { code: req.code, request_id: req.id }, { dedupeKey: `waste:${req.id}:CANCELLED` })
      .catch((e: unknown) => this.logger.warn(`notify WASTE_PICKUP_CANCELLED failed: ${String(e)}`));
  }

  async pointsReversed(userId: string, req: RequestRef, taken: number, reason: string): Promise<void> {
    await this.notifications
      .notify(userId, 'WASTE_POINTS_REVERSED', { code: req.code, points: formatPoints(taken), reason: stripTrailingStop(reason), request_id: req.id }, { dedupeKey: `waste:${req.id}:REVERSED` })
      .catch((e: unknown) => this.logger.warn(`notify WASTE_POINTS_REVERSED failed: ${String(e)}`));
  }

  async shipLocked(userId: string, shipLockedAt: Date): Promise<void> {
    await this.notifications
      .notify(userId, 'WASTE_SHIP_LOCKED', {}, { dedupeKey: `waste-lock:${userId}:${shipLockedAt.toISOString()}` })
      .catch((e: unknown) => this.logger.warn(`notify WASTE_SHIP_LOCKED failed: ${String(e)}`));
  }

  async giftCancelled(userId: string, r: { id: string; giftName: string }, refundedPoints: number): Promise<void> {
    const pointsNote = refundedPoints > 0 ? ` Tubu đã hoàn ${formatPoints(refundedPoints)} Điểm Xanh vào tài khoản của bạn.` : ' Lượt đổi này không được hoàn điểm.';
    await this.notifications
      .notify(userId, 'WASTE_GIFT_CANCELLED', { gift: r.giftName, points_note: pointsNote, redemption_id: r.id }, { dedupeKey: `waste-gift:${r.id}:CANCELLED` })
      .catch((e: unknown) => this.logger.warn(`notify WASTE_GIFT_CANCELLED failed: ${String(e)}`));
  }

  async perkReviewed(ownerUserId: string, p: { id: string; name: string }, approved: boolean, reviewEventId: string): Promise<void> {
    await this.notifications
      .notify(ownerUserId, 'WASTE_PERK_REVIEWED', { point: p.name, result: approved ? 'đã được duyệt' : 'chưa được duyệt', point_id: p.id }, { dedupeKey: `waste-perk:${p.id}:${reviewEventId}` })
      .catch((e: unknown) => this.logger.warn(`notify WASTE_PERK_REVIEWED failed: ${String(e)}`));
  }
}
