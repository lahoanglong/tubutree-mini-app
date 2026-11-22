/**
 * Cặp lớp cho trang dựng sẵn giao diện khách ở máy chủ (`PrebuiltGuest`) mà không có middleware tách khách có phiên: script ở <head>
 * (`restoringBootScript`) đặt `data-restoring` lên <html> trước khi vẽ khi máy còn cờ phiên. Khi đó màn khách bị giấu và khung chờ hiện thay,
 * nên khách đã đăng nhập không thấy màn khách chớp qua trước khi hydrate biết pha thật. Khách vãng lai không có thuộc tính này: thấy ngay màn khách.
 */
export const GUEST_ONLY_WHILE_RESTORING = '[html[data-restoring]_&]:hidden';
export const RESTORING_ONLY = 'hidden [html[data-restoring]_&]:block';
