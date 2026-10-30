TITLE: fix(ctv): khoá nút Chuyển vào Ví tới khi dashboard tải lại; bỏ guard thừa (R-161)

## Vấn đề
Ngay sau khi CTV chuyển hoa hồng vào Ví, nút lối tắt "Chuyển vào Ví" vẫn bấm được cho tới khi dashboard tải lại. Máy chủ từ chối nên không mất tiền, nhưng CTV thấy báo lỗi. Ngoài ra, guard `autoCredited.has` trong `affiliate.service.ts` không bao giờ có tác dụng.

## Có gì trong PR
- Mini App (`apps/miniapp/src/pages/affiliate.tsx`) và web (`apps/web/src/app/ctv/page.tsx`) dùng cùng một cách:
  - Khi chuyển xong, lưu mốc `dashQ.dataUpdatedAt`.
  - Nút bị khoá khi mốc còn bằng `dataUpdatedAt` và dashboard không lỗi.
  - Dashboard tải lại xong thì nút mở. Dashboard lỗi thì nút cũng mở, để máy chủ quyết.
- API: bỏ guard `autoCredited.has` và tham số tương ứng của `notifyCommissionsApproved`.
  - Guard thừa vì `requestPayout` chuyển toàn bộ khoản APPROVED chưa gắn batch sang PAID trong cùng transaction. CTV đã được tự cộng thì không còn dòng APPROVED nào để báo.
  - Mock unit test được sửa cho giống DB thật: khoản đã chuyển có trạng thái PAID.
- Sửa hai comment còn gọi APPROVED là điểm "không đảo được" (`approveDueCommissions`, `effectiveHoldDays`). Sau E-43, khoản APPROVED chưa vào Ví thu hồi bằng REJECTED; khoản đã vào Ví thì trừ Ví CTV. Chỉ đổi comment.

Không đổi tỉ lệ hoa hồng, hold_days, thuế hay ngưỡng. Không thêm đường ghi tiền nào.

## Cách kiểm
- Test mới cùng tên ở hai nền: "vừa chuyển vào Ví: nút ... mờ tới khi dashboard tải lại, rồi bấm lại được". File: `apps/web/src/app/ctv/page.spec.tsx`, `apps/miniapp/src/pages/affiliate.spec.tsx`. Bỏ điều kiện `disabled` thì cả hai test đỏ (mỗi nền 1 failed), đã thử rồi trả lại mã.
- Race trên Postgres thật: `affiliate-auto-wallet`, `ctv-notifications`, `affiliate.race-spec`, 21 test đạt. Trong đó có ca cron và bấm tay cùng lúc chỉ cộng một lần, và ca không báo trùng.
- Jest API: 504 suite, 11789 test đạt.
- Gate đầy đủ trên nhánh đã gộp main `2ca045580`: 0 FAIL. Gate gồm tsc 5 gói, eslint, vitest app-core 1283, Mini App 5271 (thêm một lượt giờ UTC), web 8061, jest API 505 suite / 11806 test, lint:parity, vite build. Gói đầu Mini App 709 KB. Commit sửa comment E-43 vào sau gate; commit đó chỉ đổi chữ comment, eslint sạch.
- Playwright (`affiliate.web.spec.ts`, `ctv-375.web.spec.ts`, Mini App) chưa chạy cục bộ; CI của PR sẽ chạy.

## Còn lại (P3, không chặn merge)
- Nút khoá theo kiểu "mốc bằng nhau", nên còn hai khe:
  - Một lần tải lại bắt đầu trước khi chuyển xong nhưng về sau đó vẫn làm nút mở, trong khi số dư còn cũ.
  - Rời trang rồi quay lại thì mất mốc khoá.
  - Máy chủ vẫn từ chối trong cả hai khe.
- Chưa có test cho nửa "tải lại bị lỗi thì nút mở".
- Ca unit "CTV đã tự cộng thì không nhận thêm tin" giờ chỉ kiểm mock. Bằng chứng thật nằm ở race `ctv-notifications` và `affiliate-auto-wallet`.
- Lúc nút mờ, hero vẫn hiện số "Có thể chuyển vào Ví" cũ và không nói lý do. Khoảng thời gian này ngắn và đã có câu báo "đã chuyển" đi kèm.

## Deploy và migration
Không có migration. Đổi API, web và Mini App. Phần Mini App chỉ tới khách sau khi đẩy bản Mini App mới.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
