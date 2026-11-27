'use client';

import { staleBatchApprove, type StaleBatchRow } from '@/lib/admin-external-stale-batch-client';
import { formatCount } from '@/lib/checkout-points';
import { BatchApproveButton, type BatchApproveConfig } from './external-claims-batch-approve';

export const STALE_BATCH_BUTTON = 'Duyệt nhanh đơn chat SĐT đã từng nhận app';

const STALE_CONFIG: BatchApproveConfig<StaleBatchRow> = {
  kind: 'stale-phone',
  button: STALE_BATCH_BUTTON,
  emptyText: 'Không có claim nào đang chờ duyệt chỉ vì SĐT xác minh đã cũ.',
  criteria:
    'Chỉ claim đơn chat vướng duy nhất SĐT cũ, SĐT trên đơn vẫn thuộc đúng thành viên và thành viên đã nhận ít nhất 1 đơn app tự đặt (không tính đơn CTV đặt hộ, đơn đại lý). Không duyệt được claim của chính bạn.',
  rowDetail: (r) => ` · ${formatCount(r.points)} điểm · ${r.deliveredAppOrders} đơn app đã giao`,
  approve: staleBatchApprove,
};

/**
 * Nút CSKH: xem trước các claim đơn chat đang chờ duyệt CHỈ vì SĐT xác minh đã cũ, của thành viên đã nhận ít nhất một đơn app, rồi bấm duyệt.
 * Hộp thoại và cách gửi từng nhóm dùng chung `BatchApproveButton`.
 */
export function ExternalClaimsStaleBatch() {
  return <BatchApproveButton config={STALE_CONFIG} />;
}
