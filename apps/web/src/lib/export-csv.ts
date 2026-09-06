import type { AdminOrder, AdminUser } from './admin-client';

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: 'Chờ thanh toán',
  CONFIRMED: 'Đã xác nhận',
  PACKED: 'Đã đóng gói',
  SHIPPING: 'Đang vận chuyển',
  DELIVERED: 'Đã giao hàng',
  CANCELLED: 'Đã hủy',
  RETURNED: 'Đã trả hàng',
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  COD: 'COD (Tiền mặt)',
  ZALOPAY: 'ZaloPay',
  WALLET: 'Ví Tubu',
  XU: 'Xu Tubu',
};

export function generateOrdersCsvString(orders: AdminOrder[]): string {
  const headers = [
    'Mã đơn hàng',
    'Khách hàng',
    'Số điện thoại',
    'Tổng tiền (VNĐ)',
    'Phương thức TT',
    'Trạng thái',
    'Ghi chú',
    'Số sản phẩm',
    'Ngày tạo',
  ];

  const rows = orders.map((o) => {
    const itemCount = o.items ? o.items.reduce((sum, item) => sum + item.quantity, 0) : 0;
    return [
      escapeCsvCell(o.code),
      escapeCsvCell(o.user?.fullName ?? 'Khách lẻ'),
      escapeCsvCell(o.user?.phone ?? ''),
      escapeCsvCell(o.total),
      escapeCsvCell(PAYMENT_METHOD_LABELS[o.paymentMethod] ?? o.paymentMethod),
      escapeCsvCell(ORDER_STATUS_LABELS[o.status] ?? o.status),
      escapeCsvCell(o.note ?? ''),
      escapeCsvCell(itemCount),
      escapeCsvCell(new Date(o.createdAt).toLocaleString('vi-VN')),
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\r\n');
}

export function generateUsersCsvString(users: AdminUser[]): string {
  const headers = ['User ID', 'Họ và tên', 'Số điện thoại', 'Vai trò', 'Điểm tích lũy', 'Ngày tham gia'];

  const rows = users.map((u) => [
    escapeCsvCell(u.id),
    escapeCsvCell(u.fullName ?? 'Chưa cập nhật'),
    escapeCsvCell(u.phone ?? ''),
    escapeCsvCell(u.role),
    escapeCsvCell(u.pointsBalance ?? 0),
    escapeCsvCell(new Date(u.createdAt).toLocaleString('vi-VN')),
  ].join(','));

  return [headers.join(','), ...rows].join('\r\n');
}

export function downloadCsvFile(csvContent: string, filename: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportOrdersToCsv(orders: AdminOrder[], filename?: string): void {
  const name = filename ?? `danh-sach-don-hang-${new Date().toISOString().slice(0, 10)}.csv`;
  const csv = generateOrdersCsvString(orders);
  downloadCsvFile(csv, name);
}

export function exportUsersToCsv(users: AdminUser[], filename?: string): void {
  const name = filename ?? `danh-sach-nguoi-dung-${new Date().toISOString().slice(0, 10)}.csv`;
  const csv = generateUsersCsvString(users);
  downloadCsvFile(csv, name);
}
