import type { AdminPayoutStatus, DealerRewardClaimStatus } from '@/lib/admin-client';

// Thẻ ở Việc cần xử lý nhắn bộ lọc cho tab Chi trả / Yêu cầu thưởng qua biến module (trang admin không truyền seed xuống): số trên thẻ
// phải khớp số dòng khi bấm vào. Chỉ có hiệu lực cho lần mở tab kế tiếp, tab đọc xong thì xoá. Đặt ở tệp nhỏ riêng để Việc cần
// xử lý (tab mặc định) không kéo theo mã của hai tab kia.
let claimSeed: DealerRewardClaimStatus | null = null;
let payoutSeed: AdminPayoutStatus | null = null;

export const seedDealerClaimFilter = (status: DealerRewardClaimStatus | null) => {
  claimSeed = status;
};
export const peekDealerClaimSeed = () => claimSeed;

export const seedPayoutFilter = (status: AdminPayoutStatus | null) => {
  payoutSeed = status;
};
export const peekPayoutSeed = () => payoutSeed;
