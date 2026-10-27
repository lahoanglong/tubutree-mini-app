/** Đường dẫn trang chi tiết; `variationId` chỉ có khi khách vào từ thẻ hay dải Giờ vàng để mở đúng phân loại đang giảm. */
export function productHref(slug: string, variationId?: string | null): string {
  const base = `/san-pham/${slug}`;
  return variationId ? `${base}?v=${encodeURIComponent(variationId)}` : base;
}
