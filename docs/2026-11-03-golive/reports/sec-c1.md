# sec-c1 (vòng sửa theo reviewer)
- P1 charset utf-7/utf-16 treo event loop: ĐÃ SỬA. rawGuard kiểm tham số encoding của verify, ném 415 trước iconv; /api/events dùng eventsBodyParser cùng chốt. Test đỏ khi đảo điều kiện (5 ca fail), xanh sau sửa.
- P2 thiếu test luật tên <>: ĐÃ THÊM 4 ca ở users.service.spec.ts (ca trim đỏ khi gỡ trim).
- P3 so khớp tên không trim: ĐÃ SỬA (trim hai vế) kèm test.
- P3 thiếu ca độ sâu thô >1024 byte: ĐÃ THÊM (đệm 2000 byte, spy JSON.parse, unit scanRawJson).
- P3 ảnh trước/sau + bundle-report: KHÔNG làm vòng này (cần lane/Playwright, máy tải); chỉ đổi thông báo lỗi MST, không đổi layout.
Kiểm: jest --maxWorkers=2 body-limits + users.service = 100/100; tsc api sạch.
