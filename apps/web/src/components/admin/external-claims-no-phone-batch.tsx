'use client';

import { noPhoneBatchApprove, type NoPhoneBatchRow } from '@/lib/admin-external-no-phone-batch-client';
import { formatCount } from '@/lib/checkout-points';
import { RECIPIENT_NAME_LABEL } from '@/lib/external-claims';
import { BatchApproveButton, type BatchApproveConfig } from './external-claims-batch-approve';

export const NO_PHONE_BATCH_BUTTON = 'Duyệt nhanh đơn Lazada đủ điều kiện';

const NO_PHONE_CONFIG: BatchApproveConfig<NoPhoneBatchRow> = {
  kind: 'no-phone',
  button: NO_PHONE_BATCH_BUTTON,
  emptyText: 'Không có claim đơn Lazada nào đang chờ duyệt chỉ vì đơn không có SĐT để đối chiếu.',
  criteria:
    'Chỉ claim đơn Lazada chờ duyệt duy nhất vì đơn không có SĐT để đối chiếu, của thành viên đã xác minh SĐT qua Zalo và là khách quen (đã nhận ít nhất 1 đơn app tự đặt hoặc có đơn sàn khác đã cộng điểm). Tên người nhận khác tên thành viên, đơn đang hoàn, vượt ngưỡng tiền hay trần tháng thì duyệt tay. Không duyệt được claim của chính bạn.',
  rowDetail: (r) =>
    ` · ${formatCount(r.points)} điểm · ${r.deliveredAppOrders} đơn app đã giao · ${r.creditedClaims} đơn sàn đã cộng · ${RECIPIENT_NAME_LABEL[r.recipientNameMatch]}`,
  approve: noPhoneBatchApprove,
};

/**
 * Nút CSKH (PO W45): xem trước các claim đơn Lazada đang chờ duyệt CHỈ vì sàn che SĐT, của thành viên đã xác minh và là khách quen, rồi bấm
 * duyệt. Máy chủ xét lại mọi luật trong khoá từng claim, ghi dấu lượt vào nhật ký từng claim và một dòng sổ thao tác quản trị.
 */
export function ExternalClaimsNoPhoneBatch() {
  return <BatchApproveButton config={NO_PHONE_CONFIG} />;
}
