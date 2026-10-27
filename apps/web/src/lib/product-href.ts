/**
 * Đường dẫn trang chi tiết. `variationId` (`?v=`) chỉ có khi khách vào từ thẻ hay dải Giờ vàng để mở đúng phân loại đang giảm;
 * `pinnedVariationId` (`?pv=`) khi món gian hàng CTV ghim một phân loại. Giờ vàng thắng khi có cả hai.
 */
export function productHref(slug: string, variationId?: string | null, pinnedVariationId?: string | null): string {
  const base = `/san-pham/${slug}`;
  if (variationId) return `${base}?v=${encodeURIComponent(variationId)}`;
  return pinnedVariationId ? `${base}?pv=${encodeURIComponent(pinnedVariationId)}` : base;
}
