import type { Prisma } from '@prisma/client';

/**
 * Điều kiện để một sản phẩm HIỆN CÔNG KHAI — một nguồn duy nhất cho catalog, gợi ý của trợ lý AI và mọi truy vấn
 * "khách có thể thấy sản phẩm này không".
 *
 * SP đối tác được tạo với isActive:true ngay cả khi approvalStatus:'PENDING_REVIEW', bị từ chối (REJECTED) hay bị đưa
 * về chờ duyệt sau khi sửa nội dung cũng không tự tắt isActive, nên chỉ kiểm isActive là để lọt nội dung chưa kiểm
 * duyệt (P0 A2-03). isActive là cờ vòng đời của sản phẩm, approvalStatus là cờ kiểm duyệt: cần cả hai.
 */
export const PUBLIC_PRODUCT_WHERE = {
  isActive: true,
  approvalStatus: 'APPROVED',
} as const satisfies Prisma.ProductWhereInput;

export function isPublicProduct(p: { isActive: boolean; approvalStatus: string }): boolean {
  return p.isActive && p.approvalStatus === PUBLIC_PRODUCT_WHERE.approvalStatus;
}
