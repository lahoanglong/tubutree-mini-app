/** Chữ của Sửa hồ sơ và trang Ví. Một nguồn cho Mini App và web khổ điện thoại. */

/** "1990-05-01" thành "01/05/1990"; chuỗi không đúng dạng ngày thì trả rỗng để màn không hiện ngày giả. */
export function formatDobDisplay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? '').trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** "03/05/1990" thành "3 tháng 5 năm 1990": ghi tháng bằng chữ để khách thấy ngay nếu ô đọc đảo ngày và tháng. Không đúng dd/mm/yyyy thì giữ nguyên. */
function dobInWords(display: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display);
  return m ? `${Number(m[1])} tháng ${Number(m[2])} năm ${m[3]}` : display;
}

export const orderCopy = {
  /** `eta` là khoảng ngày đã ghép sẵn ("30/10 – 01/11"). */
  etaLine: (eta: string) => `Dự kiến giao ${eta}`,
};

/** Nhãn ngắn cho hàng trạng thái đơn ở Cá nhân: 5 ô trên màn 375px chỉ vừa một dòng; phần đọc cho trình đọc màn hình vẫn dùng nhãn đầy đủ. */
const ORDER_ROW_SHORT: Record<string, string> = {
  pending_payment: 'Thanh toán',
  processing: 'Xử lý',
};
export function orderRowLabel(key: string, fullLabel: string): string {
  return ORDER_ROW_SHORT[key] ?? fullLabel;
}

export const profileCopy = {
  ordersFailed: 'Không tải được số đơn.',
  dobPicked: (display: string) => `Ngày đã chọn: ${display}`,
  dobConfirm: (display: string) => `Ngày sinh ${dobInWords(display)} chỉ đặt được một lần. Xác nhận?`,
  dobConfirmYes: 'Xác nhận',
  dobConfirmNo: 'Sửa lại',
};

export const walletCopy = {
  empty: 'Tiền hoàn đơn và hoa hồng CTV sẽ vào Ví Tubu. Ví dùng để trả đơn hàng.',
};

/** Học viện chỉ mở cho CTV, đại lý, nhân viên, quản trị (API 403 với khách thường), nên khách thường không thấy lối vào. */
export { canUseAcademy as canSeeAcademy } from './academy-access';
