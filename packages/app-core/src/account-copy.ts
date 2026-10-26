/** Chữ của Sửa hồ sơ và trang Ví. Một nguồn cho Mini App và web khổ điện thoại. */

/** "1990-05-01" thành "01/05/1990"; chuỗi không đúng dạng ngày thì trả rỗng để màn không hiện ngày giả. */
export function formatDobDisplay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? '').trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

export const profileCopy = {
  avatarNoStorage: 'Tạm thời chưa đổi được ảnh đại diện.',
  dobPicked: (display: string) => `Ngày đã chọn: ${display}`,
  dobConfirm: (display: string) => `Ngày sinh ${display} chỉ đặt được một lần. Xác nhận?`,
  dobConfirmYes: 'Xác nhận',
  dobConfirmNo: 'Sửa lại',
};

export const walletCopy = {
  empty: 'Tiền hoàn đơn và hoa hồng CTV sẽ vào Ví Tubu. Ví dùng để trả đơn hàng.',
};
