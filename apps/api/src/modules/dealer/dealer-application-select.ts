/** Cột của hồ sơ đại lý trả ra ngoài: bỏ 3 cột ảnh (base64 hàng trăm KB), ảnh lấy riêng qua route ảnh của admin. */
export const DEALER_APPLICATION_LIST_SELECT = {
  id: true,
  userId: true,
  businessName: true,
  taxCode: true,
  ownerName: true,
  phone: true,
  address: true,
  monthlyVolumeEstimate: true,
  notes: true,
  status: true,
  reviewedBy: true,
  reviewedAt: true,
  rejectionReason: true,
  createdAt: true,
} as const;
