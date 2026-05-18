/**
 * Format Utilities — Định dạng tiền, ngày
 */

// Format tiền VNĐ: 125000 → "125.000đ"
export function formatPrice(price: number): string {
  return price.toLocaleString('vi-VN') + 'đ';
}

// Format ngày: "2026-05-18T10:30:00" → "18/05/2026"
export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('vi-VN');
}

// Format ngày giờ: "2026-05-18T10:30:00" → "18/05/2026 10:30"
export function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('vi-VN') + ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

// Lấy giá thấp nhất từ variations
export function getMinPrice(variations: { retail_price: number }[]): number {
  if (!variations?.length) return 0;
  return Math.min(...variations.map(v => v.retail_price));
}

// Lấy ảnh sản phẩm (fallback nếu không có)
export function getProductImage(product: { image?: string | null; variations?: { images?: string[] }[] }): string {
  if (product.image) return product.image;
  const firstVariation = product.variations?.[0];
  if (firstVariation?.images?.[0]) return firstVariation.images[0];
  return 'https://via.placeholder.com/300x300?text=No+Image';
}

// Trạng thái đơn hàng → text tiếng Việt
export function getOrderStatusText(status: string): string {
  const map: Record<string, string> = {
    PENDING: 'Chờ xác nhận',
    WAITING_PAYMENT: 'Chờ thanh toán',
    COMPLETED: 'Hoàn thành',
    CANCELLED: 'Đã hủy',
  };
  return map[status] || status;
}

// Trạng thái đơn → màu
export function getOrderStatusColor(status: string): string {
  const map: Record<string, string> = {
    PENDING: '#FF9800',
    WAITING_PAYMENT: '#2196F3',
    COMPLETED: '#4CAF50',
    CANCELLED: '#F44336',
  };
  return map[status] || '#9E9E9E';
}
