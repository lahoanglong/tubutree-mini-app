import type { EditOrderDeliveryBody, OrderEditAddressInput, OrderEditRefusalReason, ShippingAddressSnapshot } from '@tubutree/shared-types';

/**
 * Chữ và luật phía khách của tấm "Sửa địa chỉ và ghi chú" ở chi tiết đơn (web và Mini App phải giống nhau). Máy chủ là nguồn sự thật: câu từ chối
 * máy chủ gửi kèm 409 luôn được hiện trước; câu theo `reason` ở đây chỉ dùng khi lỗi không có `message`.
 */
export const ORDER_EDIT_COPY = {
  link: 'Sửa',
  title: 'Sửa địa chỉ và ghi chú',
  provinceHint: 'Muốn giao tỉnh khác, bạn huỷ đơn rồi đặt lại nhé.',
  recipientLabel: 'Người nhận',
  phoneLabel: 'Số điện thoại',
  streetLabel: 'Số nhà, tên đường',
  noteLabel: 'Ghi chú cho đơn',
  notePlaceholder: 'Ví dụ: gọi trước khi giao, giao giờ hành chính',
  noteOnly: 'Địa chỉ của đơn này chưa theo địa giới mới nên chỉ sửa được ghi chú.',
  save: 'Lưu thay đổi',
  close: 'Đóng',
  noChange: 'Bạn chưa đổi gì.',
  required: 'Bạn điền đủ người nhận, số điện thoại, phường/xã và số nhà nhé.',
} as const;

export const orderEditLinkAria = (code: string) => `Sửa địa chỉ và ghi chú đơn ${code}`;
export const orderEditProvinceLine = (province: string) => `Tỉnh/thành: ${province} (không đổi được)`;
export const orderEditSaved = (code: string) => `Đã cập nhật đơn ${code}`;
export const orderEditsLeftText = (n: number) => (n > 0 ? `Còn ${n} lần sửa cho đơn này.` : 'Đơn đã hết lượt tự sửa.');
/** Đơn tách theo kho (cùng lần đặt nhiều đơn): lần sửa chỉ áp cho đơn đang xem. */
export const orderEditSplitNote = (code: string) => `Thay đổi chỉ áp dụng cho đơn ${code}.`;

/** Câu cho mỗi lý do từ chối, cùng chữ với `orderEditRefusalMessage` của API (spec so từng câu). */
export function orderEditRefusalText(reason: OrderEditRefusalReason, province?: string): string {
  switch (reason) {
    case 'DISABLED':
      return 'Tính năng tự sửa đơn đang tạm tắt. Bạn nhắn Zalo OA hoặc gọi hotline Tubu để đổi địa chỉ nhé.';
    case 'NOT_ELIGIBLE':
      return 'Đơn này không tự sửa được. Bạn nhắn Zalo OA hoặc gọi hotline Tubu để được hỗ trợ nhé.';
    case 'NOT_EDITABLE_STATUS':
      return 'Đơn đã vào khâu đóng gói nên không sửa được nữa. Bạn nhắn Zalo OA hoặc gọi hotline Tubu để được hỗ trợ nhé.';
    case 'HANDED_OVER':
      return 'Đơn đã bàn giao cho đơn vị vận chuyển nên không sửa được nữa. Bạn nhắn Zalo OA hoặc gọi hotline Tubu nhé.';
    case 'PACKING_ON_PANCAKE':
      return 'Kho đã bắt đầu đóng gói đơn này nên không sửa được nữa. Bạn nhắn Zalo OA hoặc gọi hotline Tubu nhé.';
    case 'PANCAKE_UNREACHABLE':
      return 'Kho chưa phản hồi, bạn thử lại sau ít phút nhé.';
    case 'SYNCING':
      return 'Đơn đang được chuyển sang kho, bạn thử lại sau ít phút nhé.';
    case 'EDIT_LIMIT':
      return 'Đơn đã sửa đủ 3 lần. Bạn nhắn Zalo OA hoặc gọi hotline Tubu nếu cần đổi thêm nhé.';
    case 'PROVINCE_CHANGED':
      return `Chỉ đổi được địa chỉ trong ${province?.trim() || 'tỉnh/thành của đơn'}. Muốn giao tỉnh khác, bạn huỷ đơn rồi đặt lại nhé.`;
    case 'PROVINCE_LOCKED':
      return 'Địa chỉ của đơn này chưa theo địa giới mới nên chỉ sửa được ghi chú. Bạn nhắn Zalo OA hoặc gọi hotline Tubu để đổi địa chỉ nhé.';
  }
}

/** Địa chỉ sửa được khi ảnh chụp đã theo địa giới mới "84_VN*" (như `addressEditable` của API); đơn cũ chỉ sửa ghi chú. */
export const orderEditAddressEditable = (a: Pick<ShippingAddressSnapshot, 'provinceCode'>) => /^84_VN[0-9A-Za-z_]+$/.test(a.provinceCode ?? '');

/** Giá trị form của tấm sửa (người nhận, SĐT, phường/xã, số nhà; tỉnh giữ theo đơn) và ghi chú. */
export interface OrderEditForm {
  recipient: string;
  phone: string;
  ward: string;
  wardCode: string;
  street: string;
  note: string;
}

export const orderEditFormOf = (a: ShippingAddressSnapshot, note: string | null | undefined): OrderEditForm => ({
  recipient: a.recipient ?? '',
  phone: a.phone ?? '',
  ward: a.ward ?? '',
  wardCode: a.wardCode ?? '',
  street: a.street ?? '',
  note: note ?? '',
});

/**
 * Thân PATCH chỉ gồm phần khách đổi: `address` khi một ô địa chỉ khác bản gốc (gửi đủ 7 trường, tỉnh lấy từ đơn), `note` khi ghi chú khác
 * (ô trống = xoá ghi chú). Không đổi gì thì null. Thiếu ô bắt buộc của địa chỉ thì `'REQUIRED'`.
 */
export function orderEditBody(
  original: ShippingAddressSnapshot,
  originalNote: string | null | undefined,
  form: OrderEditForm,
): EditOrderDeliveryBody | null | 'REQUIRED' {
  const body: EditOrderDeliveryBody = {};
  if (orderEditAddressEditable(original)) {
    const next: OrderEditAddressInput = {
      recipient: form.recipient.trim(),
      phone: form.phone.trim(),
      ward: form.ward.trim(),
      street: form.street.trim(),
      provinceCode: original.provinceCode,
      districtCode: original.districtCode ?? '',
      wardCode: form.wardCode.trim(),
    };
    const changed =
      next.recipient !== (original.recipient ?? '').trim() ||
      next.phone !== (original.phone ?? '').trim() ||
      next.wardCode !== (original.wardCode ?? '').trim() ||
      next.street !== (original.street ?? '').trim();
    if (changed) {
      if (!next.recipient || !next.phone || !next.wardCode || !next.ward || !next.street) return 'REQUIRED';
      body.address = next;
    }
  }
  const note = form.note.trim();
  if (note !== (originalNote ?? '').trim()) body.note = note === '' ? null : note;
  return body.address || body.note !== undefined ? body : null;
}
