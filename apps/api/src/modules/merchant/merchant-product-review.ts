import type { Prisma } from '@prisma/client';

/**
 * Sản phẩm đối tác đang chờ admin duyệt: sản phẩm mới/được gửi lại (chưa bán) và sản phẩm ĐANG BÁN có bản sửa nội dung chờ
 * duyệt (R3-MERCHANT-4). Màn "Duyệt SP đối tác" và số "Việc cần xử lý" dùng chung để hai con số luôn khớp.
 */
export const PENDING_MERCHANT_PRODUCT_WHERE: Prisma.ProductWhereInput = {
  OR: [{ approvalStatus: 'PENDING_REVIEW' }, { editDraft: { isNot: null } }],
};
