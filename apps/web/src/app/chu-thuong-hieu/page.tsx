'use client';

import { BrandOwnerHub } from '@/components/brand-owner/brand-owner-hub';

/**
 * `/chu-thuong-hieu` theo `brand-owner.tsx` của Mini App: chủ nhãn sửa hồ sơ, khuyến mãi và xem doanh thu. Không kiểm vai trò
 * ở client: máy chủ trả 404 (chưa được cấp nhãn) hoặc 403 và trang nói lại bằng lời dễ hiểu.
 */
export default function BrandOwnerPage() {
  return <BrandOwnerHub />;
}
