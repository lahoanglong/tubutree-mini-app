import type { PrismaService } from '../../prisma/prisma.service';

/** Cùng dạng snapshot `Order.shippingAddress` của checkout (kho Pancake đọc tên/SĐT/địa chỉ từ đây). */
export interface DealerShippingSnapshot {
  recipient: string;
  phone: string;
  street: string;
  ward: string;
  district: string;
  province: string;
  provinceCode: string;
  districtCode: string;
  wardCode: string;
  note?: string;
}

export const DEALER_DELIVERY_NOTE = 'Giao theo hợp đồng đại lý';

type Db = Pick<PrismaService, 'address' | 'dealerApplication'>;

/**
 * Người nhận cho đơn đại lý: địa chỉ đại lý chọn → địa chỉ mặc định trong sổ địa chỉ → hồ sơ đăng ký đại lý đã
 * duyệt (địa chỉ dạng chữ: Pancake tự phân tích ra tỉnh/xã khi không có mã). null khi không có địa chỉ nào (hoặc
 * addressId không thuộc đại lý).
 */
export async function resolveDealerRecipient(
  db: Db,
  userId: string,
  addressId?: string | null,
): Promise<DealerShippingSnapshot | null> {
  const book = addressId
    ? await db.address.findFirst({ where: { id: addressId, userId } })
    : await db.address.findFirst({ where: { userId }, orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] });
  if (addressId && !book) return null;
  if (book) {
    return {
      recipient: book.recipient,
      phone: book.phone,
      street: book.street,
      ward: book.ward,
      district: book.district,
      province: book.province,
      provinceCode: book.provinceCode,
      districtCode: book.districtCode,
      wardCode: book.wardCode,
      note: DEALER_DELIVERY_NOTE,
    };
  }
  const app = await db.dealerApplication.findFirst({
    where: { userId, status: 'APPROVED' },
    orderBy: { createdAt: 'desc' },
    select: { businessName: true, ownerName: true, phone: true, address: true },
  });
  if (app?.phone && app.address.trim()) {
    return {
      recipient: app.businessName ? `${app.ownerName} (${app.businessName})` : app.ownerName,
      phone: app.phone,
      street: app.address,
      ward: '',
      district: '',
      province: '',
      provinceCode: '',
      districtCode: '',
      wardCode: '',
      note: DEALER_DELIVERY_NOTE,
    };
  }
  return null;
}
