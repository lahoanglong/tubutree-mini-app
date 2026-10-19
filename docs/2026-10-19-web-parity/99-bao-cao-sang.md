# Báo cáo sáng 2026-10-19: đưa chức năng Mini App lên website

## Tóm tắt

- Mọi màn của Mini App nay đã có trên web (`pnpm lint:parity`: 0 route còn thiếu). Hai màn cố ý không làm trên web: `/refill` (Mini App đã gỡ Refill, chỉ còn chuyển sang đổi rác) và `/points/scan` (cần SĐT đã xác minh qua Zalo, theo Q2).
- Toàn bộ nằm trên nhánh `web/integration` (worktree `.claude/worktrees/web-parity`), tách từ `web/base`. **Đã push nhánh này lên origin (theo lệnh "làm tiếp rồi push"); chưa mở PR, chưa gộp vào `main`, chưa deploy.**
- Nhánh đã gộp `feat/recycle-rewards` tới 80c0842a (gồm launch c6c4a3ac) và `origin/main` 3712ca08 (PR #20 đã merge), nên chạy trên mã Mini App và API mới nhất của hai phiên kia. Web đã theo cả các commit Mini App mới của nhánh đổi rác (integ6, integ7, 71908dac).
- Gate tổng hợp trên `web/integration` 71908dac (đỉnh nhánh lúc push, chỉ thêm tài liệu sau đó) xanh trọn: web 6177 test (cả giờ VN và UTC), Mini App 4299, app-core 489, typecheck, lint, build web và Mini App. Web-parity không sửa `apps/api`; với Mini App chỉ chuyển hàm thuần sang `packages/app-core` (thân giống hệt) và thêm lớp gọi API dùng chung.
- Playwright web (máy chủ `next build` + `next start`; phần lớn ca mock API, một số ca shop gọi API thật với Postgres tạm đã seed): trên 71908dac **286 passed, 0 failed, 6 skipped** (Web Customer 136, Web Customer Mobile 136, Web Admin 20). Lần chạy đầu trên 0e344645 đỏ 274 ca vì máy chủ `next dev` chết giữa chừng và vỏ web gọi API chưa mock; lane e2efix chuyển e2e sang bản build và sửa spec. Ca đỏ cuối cùng (mở lô vườn) là spec cũ chưa theo integ7, đã sửa ở 54bdd04a.

## Các lane đã làm

Mỗi lane: worker (Sonnet) viết code theo TDD trong worktree riêng, chạy gate (typecheck, lint, test web/app-core/Mini App, build), Opus review đối kháng rồi sửa; chỗ dính tiền/điểm review ít nhất 2 lượt. Phiên chính đọc lại các bản sửa MAJOR đụng tiền trước khi gộp.

| Lane | Phạm vi | Gộp | Review (lỗi lớn đã sửa) |
|---|---|---|---|
| core, core-api, core-shell, core-ui | app-core (gọi API dùng chung), vỏ web, bridge, route map, rào `lint:parity` | 1e1d9859, d65ea51d, bf270b19, d6e43f4f | `ordersListQuery` bỏ trang; Sheet nhường bàn phím |
| shop | trang chủ như Mini App, `/san-pham`, chi tiết sản phẩm | 4c9017bf | mất phân trang crawl được |
| order | giỏ, thanh toán, chuyển khoản, đơn hàng, địa chỉ | 885e814a | đặt đơn hai lần sau lỗi mạng (đóng băng yêu cầu) |
| account | hub tài khoản, hồ sơ, thông báo, nhận mã `?claim=`, onboarding | b76526a7 | 3 MAJOR |
| loyalty | Điểm Xanh, kho quà, hoàn tiền sàn | cb5c0d58 | e2e hoàn tiền |
| affiliate | CTV, gian hàng, hoa hồng, rút tiền | 2d328824 | gỡ giao diện combo mà Mini App không có |
| game | vườn xanh, tư vấn AI | 17398cc5 | 1 MAJOR |
| community | bảng tin, bài viết, sự kiện, xếp hạng, học viện | 085a676c | 3 MAJOR |
| pro | đại lý, nhân viên, bảng lương, chủ thương hiệu, tab admin | cff53ab7 | đổi Idempotency-Key giữa chừng có thể tạo đơn công nợ thứ hai |
| recycle | đổi rác lấy quà (9 màn) | ce888470 | 2 MAJOR |
| integ1–5 | hợp nhất mua lại, nối lại các link lane trước để tạm, QR theo hạn | cbb80806, 11410e72, 1a6cce93, 8595da2d, 919ce5a6 | nút Thanh toán không xét hạn |
| integ6 | đồng bộ web đổi rác theo 20+ commit Mini App mới (dòng trạng thái, bước hiện tại, tạm dừng, phí gửi theo tỉnh, quầy) | 1ed08424 | chữ hạn mức cũ trong spec e2e; 3 lượt, lượt cuối không phát hiện |
| integ7 | đồng bộ web game, Điểm Xanh, kho quà theo Mini App bản mới (`unlockPlot` gửi `slot`, giá vòng quay mặc định, khoá `tubu_last_tier_min_v2`, thẻ kho quà) | 562f8e92 | thiếu test lỗi 400 khi mở lô; lượt 2 không phát hiện |
| e2efix g1–g3 | Playwright web chạy trên bản build (`next build` + `next start`), mock vỏ trang, sửa spec theo hành vi bản build | e0dfe13e, d898004a, 9663abcb | thay đổi app duy nhất 6a5456aa (lưới mua chung ở 320px như Mini App), Opus không phát hiện |

Chi tiết từng lane: `impl/<lane>.md`. Dòng thời gian: `PROGRESS.md`. Ma trận màn: `00-ma-tran.md`.

## Cần anh/chị quyết (xếp theo mức rủi ro)

1. **Mini App có thể tạo đơn thứ hai sau lỗi mạng.** Khi đặt đơn gặp lỗi mạng, ví/điểm nạp lại làm `pickPaymentMethod` tự đổi phương thức, Idempotency-Key đổi theo, lần bấm sau tạo đơn mới. Web đã chặn (đóng băng yêu cầu sau lần chưa rõ kết quả). Mặc định: chưa sửa Mini App. Đề xuất: sửa Mini App theo cách của web, có review Opus 2 lượt.
2. **Mini App không lưu được hồ sơ cho khách đã có ngày sinh.** `edit-profile.tsx` luôn gửi lại `dob`, API chỉ cho đặt một lần nên trả 400 và tên/email không lưu. Web đã sửa. Mặc định: chưa sửa Mini App. Đề xuất: sửa.
3. **Khối chương trình đại lý ở trang nhãn `/brand/[slug]`** (shop:3). Mini App hiện cho mọi người; web đang ẩn với khách lẻ theo quyết định cũ BUYERWEB-18 (30cfe565). Mặc định: giữ BUYERWEB-18. Muốn giống Mini App thì lấy lại 94e40f36.
4. **Giao diện combo cho bộ sưu tập CTV** (affiliate:1). API cho phép combo/% giảm (trần 30%), cả hai nền tảng chưa có giao diện. Mặc định: không làm.
5. **Ghi nguồn giới thiệu ở trang nhãn không kèm `?ref=`** (core-shell:3). Mini App gửi slug nhãn làm mã; API chỉ ghi công khi mã là của CTV/đại lý, nên thường bị bỏ qua và chỉ ghi nhầm nếu slug trùng mã một CTV. Web không gửi. Mặc định: giữ web như vậy.
6. **Điểm dùng được ở thanh toán web** (order:2) lấy từ báo giá, Mini App lấy từ `/me/loyalty`. Mặc định: giữ báo giá.
7. **Analytics trên web** (shop:1, account, order): web chưa có tầng gửi sự kiện (tìm kiếm, mở thông báo, mua lại). Mặc định: chưa gửi.
8. **Biến môi trường khi deploy web:** `ZALO_OA_ID`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET` (core-shell:4), và cấu hình Zalo App dùng chung (Q3) cho tên miền web (callback đăng nhập).
9. **Công tắc bật/tắt khuyến mãi ở cổng đại lý web** mà Mini App không có (pro:1). Mặc định: giữ.

Đã tự trả lời, không cần quyết: hai câu của integ6 (kho quà web theo Mini App mới, khoá `tubu_last_tier_min_v2`) đã làm ở integ7; sàn test Mini App (nay 4299, giảm từ 4243 xuống 4214 là do nhánh đổi rác gỡ Refill, rồi tăng vì nhánh đổi rác thêm test); API so mã giới thiệu không phân biệt hoa thường (`findEligibleReferrer` gọi `toUpperCase`).

Toàn bộ câu hỏi nhỏ hơn (kèm mặc định lane đã dùng): `98-cau-hoi-va-chua-kiem-chung.md`.

## Chưa kiểm chứng

- Playwright: 6 ca tự bỏ theo `test.skip` có điều kiện ở `shop.web.spec.ts` (DB e2e thiếu sản phẩm hoặc nhãn công khai mà ca đó cần); chưa xem cụ thể ca nào bỏ.
- Spec Playwright community và `/gioi-thieu` dựng lại phản hồi RSC của Next để giả dữ liệu trang chủ do máy chủ tải; cách này dễ gãy khi nâng Next. Ca shop "API sản phẩm sập" được viết lại theo hành vi bản build (trang lỗi của Next), không còn kiểm chữ lỗi tự viết.
- Jest API và race không chạy trong phiên này (web-parity không sửa `apps/api`); số API theo báo cáo phiên đổi rác và launch.
- Đăng nhập Zalo OAuth thật trên web chưa thử (cần tên miền và cấu hình Zalo App).
- Chưa build Docker thật cho web; chỉ `next build` qua.
- Giao diện thật ở 320px và máy tính chỉ kiểm qua test jsdom và Playwright, chưa có người xem.
- Chấm công và heartbeat của nhân viên chỉ chạy trên Mini App (cần token vị trí Zalo); web dẫn sang Mini App.

## Bước tiếp theo đề xuất

1. Trả lời các câu 1–3 ở trên (đụng tiền và khách hàng).
2. Chọn cách đưa lên: PR #20 (launch) đã vào `main`; `web/integration` chứa cả nhánh đổi rác 80c0842a chưa vào `main`. Hoặc PR nhánh đổi rác trước rồi PR `web/integration`, hoặc một PR `web/integration` mang cả hai.
3. Cấu hình môi trường deploy web (mục 8) rồi thử đăng nhập Zalo thật trên UAT.
4. Từ nay mỗi chức năng làm cho cả hai nền tảng: thêm route vào `packages/app-core/src/route-map.json`, `pnpm lint:parity` chặn route Mini App chưa có trên web; logic và gọi API đặt ở `packages/app-core`.
