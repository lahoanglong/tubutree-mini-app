import type { Prisma } from '@prisma/client';

/**
 * Sản phẩm đối tác đang chờ admin duyệt: sản phẩm mới/được gửi lại (chưa bán) và sản phẩm ĐANG BÁN có bản sửa nội dung chờ
 * duyệt (R3-MERCHANT-4). Màn "Duyệt SP đối tác" và số "Việc cần xử lý" dùng chung để hai con số luôn khớp.
 */
export const PENDING_MERCHANT_PRODUCT_WHERE: Prisma.ProductWhereInput = {
  OR: [{ approvalStatus: 'PENDING_REVIEW' }, { editDraft: { isNot: null } }],
};

/** Đối tác sửa sản phẩm chờ duyệt lần đầu sau khi admin tải danh sách (409). */
export const MERCHANT_PRODUCT_CONTENT_CHANGED = 'MERCHANT_PRODUCT_CONTENT_CHANGED';
/** Sản phẩm đã được admin khác duyệt/từ chối (409). */
export const MERCHANT_PRODUCT_ALREADY_REVIEWED = 'MERCHANT_PRODUCT_ALREADY_REVIEWED';
/** Bản sửa của sản phẩm đang bán đã được xử lý hoặc đối tác sửa tiếp (409). */
export const MERCHANT_PRODUCT_EDIT_STALE = 'MERCHANT_PRODUCT_EDIT_STALE';
