# Gói webconv: khách từ sàn mua nhanh và tin tưởng

Nhánh `lr/webconv`, không cần Postgres. Mỗi mục một commit, đều theo TDD (test đỏ trước). Dòng cuối commit ghi `Claude Sonnet 5.5` (mô hình thực chạy), khác `Opus 5.5` trong impl brief.

## 1. Đã làm (theo ID phát hiện)

| ID | Commit | Nội dung | File chính |
|---|---|---|---|
| D5-03 | 3106b2ed | Nút "Tôi đã chuyển" chỉ khoá khi khách tự bấm kiểm tra, không nhấp nháy theo nhịp dò nền. Dòng trạng thái dò riêng, kết quả bấm tay riêng ("chưa thấy tiền", "mất kết nối"). Dò nền lỗi không còn thay mã QR bằng màn lỗi. Nút "Lưu mã QR" (tải ảnh, lỗi chéo nguồn thì mở ảnh ở tab mới). | `web/src/app/thanh-toan/bank-transfer-panel.tsx`, `web/src/lib/download-image.ts` |
| D5-04 | 3f05ee08 | Trang sản phẩm: "Mua ngay" (thêm giỏ rồi sang thanh toán, xoá lựa chọn giỏ cũ để món mới vào đơn). Khách chưa đăng nhập: nhớ `buyNow` cùng món, đăng nhập xong quay lại đúng trang sản phẩm rồi tự thêm và sang thanh toán. Thanh CTA dính đáy trên điện thoại (giá tạm tính + hai nút). Nút chia sẻ (Web Share, dự phòng chép liên kết; gắn `?ref=` mã giới thiệu nếu đã đăng nhập). | `web/src/components/add-to-cart.tsx`, `share-button.tsx`, `sticky-action-bar.tsx`, `web/src/lib/return-to.ts`, `web/src/app/san-pham/[slug]/page.tsx`, `lib/guest-ui.ts` (`uiBar`), `app/globals.css` |
| D7 việc 4 | 9a12936c | Giỏ hàng và thanh toán có thanh dính đáy (tổng + nút kèm số tiền). Ô mã giảm giá gọn một dòng, bấm mở rộng (tự mở lại khi áp mã lỗi). Checkbox/radio 24px (`h-6 w-6`). Trang đăng nhập có nút "Mở trên Zalo" (chỉ hiện khi có `NEXT_PUBLIC_ZALO_APP_ID`; từ trang sản phẩm thì mở đúng sản phẩm trong Mini App). Luồng đăng nhập không đổi. | `web/src/app/gio-hang/page.tsx`, `thanh-toan/page.tsx`, `thanh-toan/invoice-section.tsx`, `components/coupon-box.tsx`, `components/recycling-checkout.tsx`, `app/dang-nhap/page.tsx`, `lib/zalo-mini-app.ts` |
| D5-01 (API) | a348a11b | `GET /config/legal/:loai` (công khai, cache STATIC). Whitelist bốn loại `dieu-khoan`, `bao-mat`, `doi-tra`, `van-chuyen`, loại lạ 404, không cho dò khoá cấu hình qua đường dẫn. Trả `content` (null nếu admin chưa nhập) và `vars` (hạn đổi trả `returns.window_days`, ngưỡng freeship `shipping.free_threshold`, số hỏng thì về mặc định 7 và 200.000). Luật ghi `legal.*` là chuỗi tối đa 50.000 ký tự. Seed bốn dòng rỗng `createOnly`. | `api/src/modules/system-config/legal-config.controller.ts`, `system-config.service.ts`, `system-config.module.ts`, `api/prisma/seed.ts` |
| D5-01 (web) | 368fdafc | Trang `/chinh-sach/[loai]` (ISR 300 giây). Có nội dung admin thì hiện nội dung đó. Chưa có thì hiện bản nháp soạn sẵn kèm biển "BẢN NHÁP — chờ Tubu Tree duyệt" ở đầu trang, `noindex`. Chỗ pháp nhân để `[Tên công ty]`, `[Mã số thuế]`, `[Địa chỉ trụ sở]`. Hạn đổi trả, ngưỡng freeship, hotline, email lấy từ cấu hình đang chạy. Bốn liên kết ở chân trang, câu "Bằng việc đăng nhập, bạn đồng ý với Điều khoản và Chính sách bảo mật" ở trang đăng nhập. API lỗi tạm thời thì ném lỗi (ISR giữ bản cũ), không thay nội dung đã duyệt bằng bản nháp. Bộ dựng markdown tối giản bằng phần tử React, chặn `javascript:`/`data:`, escape HTML thô. | `web/src/app/chinh-sach/[loai]/page.tsx`, `lib/legal.ts`, `components/legal-markdown.tsx`, `lib/api.ts` (`getLegalDoc`), `components/site-footer.tsx`, `ds-v2-guest.spec.ts` |
| D5-01 (admin) | 1a5b9e2b | Khoá `legal.*` ở tab Cấu hình sửa bằng ô nhiều dòng và lưu chữ thô. Trước đó chỉ có ô JSON một dòng, admin phải tự escape xuống dòng và ngoặc kép nên không dán nổi văn bản dài. Các khoá khác không đổi. | `web/src/components/admin/config-item.tsx` |
| D5-01 (miniapp) | fd9180e7 | Màn "Về Tubu Tree": mỗi sheet tóm tắt có nút "Xem bản đầy đủ trên web" mở `/chinh-sach/<loại>`. Thêm dòng "Chính sách vận chuyển" mở thẳng web. | `miniapp/src/pages/about.tsx` |
| D5-14 | fb30e5c2 | `/tai-khoan` có khối "Thông tin cá nhân": sửa họ tên bằng `PATCH /me` (tối đa 120 ký tự, lỗi tiếng Việt, lưu xong thanh đầu trang đổi theo). Họ tên và số điện thoại lấy từ `/me`. Số điện thoại chỉ đọc. | `web/src/app/tai-khoan/profile-section.tsx`, `page.tsx`, `lib/shop-client.ts` (`updateMyName`), `lib/auth-context.tsx` (`updateProfile`) |
| D5-02 | 3d1d8906 | Miniapp chuyển khoản: biểu tượng sao chép thành nút thật 44px có `aria-label` ("Sao chép số tài khoản", "số tiền", "nội dung chuyển khoản"), đổi sang dấu tick và đọc "Đã sao chép" chỉ khi chép được thật. Khung hạn thêm dòng "Còn 2 giờ 30 phút để chuyển khoản" hoặc "Đã quá hạn chuyển khoản" theo `paymentDeadline` (API đã trả sẵn). Không có hạn thì không hiện gì. Đồng hồ không phải vùng đọc tự động. | `miniapp/src/pages/bank-payment.tsx`, `hooks/use-remaining.ts` |
| D5-12 | 46eaee5a | Trợ lý AI: tự cuộn tới tin mới (gửi, trả lời, đang soạn). Ô nhập thành textarea: Enter gửi, Shift+Enter xuống dòng, không gửi khi bộ gõ đang chốt chữ. Dòng nhỏ "Gợi ý chỉ để tham khảo." Tin xin lỗi cuối cùng có nút "Thử lại" gửi lại đúng câu cũ với lịch sử các lượt trước, không nhân đôi tin của khách. | `miniapp/src/pages/ai-advisor.tsx` |

## 2. Kiểm chứng đã chạy

Máy dùng Node từ `~/.local/node`. Chạy trong worktree `lr-webconv`.

- Web, vitest trên 28 file spec đã đổi cộng các spec bảo vệ (`ds-v2-guest`, `ds-palette-pc11`, `page-titles`, `guest-pages.a11y`, `session-unavailable`, `guest-auth-gate`, `layout`, `sitemap`, `merchant-no-guest-entry`): `Test Files 28 passed (28)`, `Tests 579 passed (579)`.
- Web, vitest cả thư mục `app/thanh-toan app/gio-hang app/tai-khoan app/san-pham app/dang-nhap app/chinh-sach components lib`: `Test Files 125 passed (125)`, `Tests 1603 passed (1603)`. Sau commit admin chạy lại `components/admin`: `Test Files 34 passed (34)`, `Tests 482 passed (482)`.
- Miniapp, vitest trên 8 file spec đã đổi cộng bộ `ds-c076-*`, `ds-legacy-vars-*`, `ds-no-legacy-aliases`, `no-merchant-web-entry`, `beta-removed`: `Test Files 14 passed (14)`, `Tests 674 passed (674)`.
- API, `npx jest src/common src/modules/system-config`: `Test Suites: 38 passed, 38 total`, `Tests: 585 passed, 585 total` (gồm `dead-config-keys`, `config-seed`, `public-cache.interceptor`, 7 test mới của `legal-config.controller`, 4 test mới trong `system-config.service.spec`). Đã chạy `npx prisma generate` trong `apps/api` trước.
- `npx tsc --noEmit` ở `apps/web`, `apps/miniapp`, `apps/api`: không có dòng lỗi.
- `npx eslint --max-warnings=0` trên toàn bộ file `.ts/.tsx` đã thêm hoặc sửa (44 web, 8 miniapp, 6 api): sạch.
- `npm run -s lint:vars` ở gốc: `OK — every var(--x) reference is defined.`
- Grep `apps/e2e/tests`: web chỉ dùng `getByRole('button',{name:'Đặt hàng'})`, link `/^Thanh toán/`, radio `/Ví Tubu/`, `footer a[href^="tel:"]`, `footer a[href^="mailto:"]`, heading "Tài khoản" cấp 1. Playwright "Web Customer" chạy Desktop Chrome nên thanh dính đáy (chỉ hiện dưới 768px) và nút bản sao CSS-ẩn không ảnh hưởng. Chữ "Đã copy" ở miniapp bank-payment không có test e2e nào bám. Không sửa e2e nào.

Chưa kiểm chứng (nói rõ là unverified):
- Chưa mở bằng trình duyệt hay điện thoại thật: bố cục thanh dính đáy ở 390px, cảm giác cuộn tự động của trợ lý AI, hình dạng textarea của zmp-ui trong Zalo, hộp chia sẻ hệ thống, liên kết `https://zalo.me/s/<appId>/` mở được Mini App hay không.
- Endpoint `/config/legal/:loai` chỉ test bằng đối tượng giả, chưa chạy với Postgres. Bốn dòng seed chưa chạy lên DB nào.
- Chưa chạy Playwright, chưa build.

## 3. Chưa làm hoặc cố ý để lại

- **D5-14 phần còn lại**: không có liên kết tới ví voucher, yêu thích, đánh giá của tôi vì web chưa có trang nào (`app/tai-khoan/` chỉ có `dia-chi`, `diem-xanh`, `don-hang`, `vi-tubu`). Làm đủ cần ba trang mới, ngoài phạm vi "không trang lớn mới". Xoá tài khoản trên web cũng chưa làm: không có trong danh sách việc của gói, API đã có `POST /me/deletion-request`. Nên làm tiếp, vì Nghị định 13/2023 cho khách quyền yêu cầu xoá dữ liệu.
- **Sửa số điện thoại**: `UpdateMeDto` không nhận `phone` nên chỉ hiển thị, không cho sửa.
- **Sitemap**: không thêm bốn trang chính sách. Bản nháp `noindex` nên đưa vào sitemap là mâu thuẫn. Khi admin đã dán nội dung duyệt thì thêm bốn đường dẫn vào `app/sitemap.ts` (một dòng mỗi trang).
- **Tóm tắt trong app còn cứng**: `miniapp/src/pages/about.tsx` vẫn có đoạn tóm tắt điều khoản/bảo mật/đổi trả viết cứng (đổi trả ghi "7 ngày", "Tubu chịu phí ship 2 chiều"). Có thể lệch với trang web khi admin đổi `returns.window_days`. Giữ để không rời mini app, nút "Xem bản đầy đủ" là nguồn đúng. Nên thay bằng nội dung từ API ở lần sau.
- **Bản nháp chính sách là bản soạn sẵn, chưa qua luật sư.** Các chỗ không biết dữ kiện để trong ngoặc vuông: thời gian hoàn tiền `[số ngày làm việc]`, thời gian giao nội thành và tỉnh khác `[số ngày]`.
- **`apps/api/prisma/seed.ts`** nằm trong danh sách file phiên đổi-rác đang sửa. Chỉ thêm 7 dòng (một dòng trống, hai dòng comment, bốn dòng cấu hình) ngay sau `returns.window_days`; nếu merge xung đột thì giữ cả hai phía.
- **Thanh dính đáy chỉ ở màn hình hẹp** (dưới 768px) theo thiết kế. Nút ở trong thẻ ẩn trên điện thoại, thanh dính ẩn trên máy tính, nên trong DOM có hai bản nút (cùng chữ).
- Nút "Mở trên Zalo" cần biến build `NEXT_PUBLIC_ZALO_APP_ID` (cùng biến đăng nhập Zalo trên web). Chưa đặt thì nút ẩn.
- Chưa thêm `loading.tsx` toàn trang (D5-15), không thuộc gói này.

## 4. Câu hỏi cho chủ dự án, kèm mặc định đã dùng

1. Pháp nhân: tên công ty, mã số thuế, địa chỉ trụ sở là gì? Mặc định: để `[Tên công ty]`, `[Mã số thuế]`, `[Địa chỉ trụ sở]` trong bản nháp, trang có biển "BẢN NHÁP" và `noindex` cho tới khi có nội dung duyệt. Cách thay: vào Admin, tab Cấu hình, dán markdown vào bốn khoá `legal.dieu-khoan`, `legal.bao-mat`, `legal.doi-tra`, `legal.van-chuyen` (ô nhiều dòng, tối đa 50.000 ký tự). Khoá để rỗng thì web dùng lại bản nháp.
2. Ai duyệt nội dung bốn trang này (luật sư hay chủ shop), và đã đăng ký website thương mại điện tử với Bộ Công Thương chưa? Mặc định: chưa gắn gì về đăng ký, chỉ để chỗ trống.
3. Thời gian hoàn tiền và thời gian giao hàng dự kiến (nội thành, tỉnh khác) là bao nhiêu ngày? Mặc định: để `[số ...]` trong bản nháp, không tự đặt số.
4. Có cho khách sửa số điện thoại trên web không? Mặc định: không (API không có đường sửa). Nếu muốn thì cần thêm luồng xác minh số mới.
5. Có làm xoá tài khoản và ba trang ví voucher, yêu thích, đánh giá của tôi cho web ở đợt sau không? Mặc định: chưa, ghi ở mục 3.
6. Giá trị `NEXT_PUBLIC_ZALO_APP_ID` của bản web PROD để hiện nút "Mở trên Zalo" là gì? Mặc định: không đặt, nút ẩn.
