TITLE: feat(tai-khoan): Xoá tài khoản sang Cài đặt, ô ngày sinh gõ dd/mm/yyyy, câu hạn chuyển khoản chung, chip Sự kiện web như Mini (R-111, R-110, R-32, R-55)

## Vấn đề
Rà mã trên main `a5469abe9` cho thấy bốn mục tài khoản còn dở:
- R-111: nút "Xoá tài khoản" nằm ở trang Giới thiệu, chỗ khách không tìm. Trang Cài đặt mới là chỗ của nó.
- R-110: ô ngày sinh là ô chọn ngày của trình duyệt, hiện mm/dd/yyyy, không báo lỗi rõ và không chặn ngày tương lai.
- R-32: câu hạn chuyển khoản ở Mini và web khác nhau.
- R-55: ở web, "Sự kiện" chưa là chip đầu hàng danh mục Cộng đồng như Mini.

## Quyết định của chủ (01/11)
- R-32: dùng câu ngắn của web cho cả hai nền.
- R-55: web theo Mini. "Sự kiện" là chip đầu, giữ một nút "Đăng bài".

## Có gì trong PR
- **R-111:**
  - Mini và web chuyển khối "Xoá tài khoản" từ Giới thiệu sang Cài đặt (`account-deletion-section.tsx` ở mỗi nền).
  - Giữ nguyên luồng cũ: hỏi lại, nút Huỷ, ô tick đồng ý mất số dư Ví, gửi yêu cầu xoá, API cũ.
  - Khối ẩn với khách tạm, giống nút Đăng xuất.
  - Ở khổ 375, nút trên web không nền, không bóng, giống Mini.
  - e2e `account-deletion.miniapp` và `account.web` đã đổi sang đường mới.
- **R-110:**
  - Ô ngày sinh gõ tay dd/mm/yyyy, dùng chung ở `packages/app-core/src/dob-input.ts` cho Mini (Sửa hồ sơ) và web (`/tai-khoan/ho-so`).
  - Giá trị gửi API vẫn là `yyyy-mm-dd`.
  - Lời lỗi nói rõ cần làm gì: "Nhập đủ ngày/tháng/năm, ngày và tháng gõ 2 số, ví dụ 05/03/1990.", ngày không có thật (kể cả 29/02 năm không nhuận), ngày tương lai, năm trước 1900.
  - Ô viền đỏ khi có lỗi.
  - Cách ô sửa chữ khi khách gõ:
    - Ô trống, dán hoặc trình duyệt tự điền: chuẩn hoá cả ô. "5.3.1990", "5-3-1990", "5,3,1990", "1990-03-05" đều thành "05/03/1990". Không cắt bớt chữ số. Dán thừa số thì để nguyên cho lời lỗi chỉ cách sửa, không thành một ngày hợp lệ nhưng sai.
    - Gõ tiến ở cuối ô: tự thêm "/" và số 0. Gõ liền 8 số trên bàn phím số ra dd/mm/yyyy.
    - Sửa giữa ô (xoá, chèn, bôi đen thay): giữ nguyên như khách gõ, không dồn hay cắt chữ số, con trỏ không nhảy.
    - Bàn phím số iPhone không có phím "/". Khách lỡ xoá dấu "/" rồi gõ lại đủ 8 số thì ô tự về dd/mm/yyyy.
- **R-32:** hằng chung `BANK_DEADLINE_LEAD` / `BANK_DEADLINE_TAIL` ở `app-core/bank-payment-copy.ts`, dùng ở Mini `bank-payment.tsx` và web `bank-transfer-panel.tsx`.
  - Trước (Mini): "Vui lòng chuyển khoản trước <ngày giờ>. Quá hạn đơn sẽ tự huỷ; tiền chuyển sau đó Tubu sẽ hoàn lại cho bạn."
  - Sau (cả hai nền): "Chuyển khoản trước <ngày giờ> — quá hạn đơn sẽ tự huỷ."
  - Câu "tiền chuyển sau đó Tubu sẽ hoàn lại" không còn ở dòng hạn, theo câu ngắn của web mà chủ chọn. Câu báo sau khi đã quá hạn không đổi.
- **R-55:** web đưa "Sự kiện" thành chip đầu hàng danh mục Cộng đồng, giữ một nút "Đăng bài".

Không đổi API, schema hay migration. Không đổi luật điểm, giá, phí hay chữ pháp lý.

## Cách kiểm
- **Ô ngày sinh:**
  - 35 test hàm. Các ca sửa giữa ô, dán, gõ trên bàn phím iPhone và Android đều từng đỏ trên bản trước khi sửa.
  - Thử ngẫu nhiên 34.719 lần xoá, chèn hoặc thay một ký tự: không mất chữ số, không dồn số. 20.000 lần dán thử: không mất chữ số.
- **Reviewer Opus:**
  - Gói kết luận "merge được" ở lượt 2.
  - Ô ngày sinh được review đối kháng thêm 4 lượt, mỗi lượt chạy hàm thật với các chuỗi bàn phím. Lượt cuối kết luận "merge được".
- **Worker chạy:**
  - Playwright Mini `account-deletion.miniapp`: 2/2.
  - Playwright web `account.web`: 28/28.
  - vitest các trang đổi; tsc; eslint; lint:parity.
- **Ảnh 375 Mini và web:** Giới thiệu, Cài đặt, Sửa hồ sơ, chuyển khoản, đầu trang Cộng đồng. Ảnh nằm trong thư mục cục bộ `screens-1028e-taikhoan/`, không đưa lên git.
- Gate đầy đủ trên nhánh đã gộp main `6f4fd6733` (tip `95f8720ef`): 0 FAIL. Gate gồm:
  - tsc 6 gói, eslint (API, Mini App, web).
  - vitest: app-core 1681, Mini App 5876 (thêm một lượt giờ UTC), web 8637.
  - jest API: 516 suite / 12090 test.
  - lint:parity, vite build, bundle-report (entry Mini 625/194 KB).

## Còn lại (P3, không chặn merge)
- Dán kiểu Mỹ "3/5/1990", hoặc trình duyệt tự điền theo locale en-US, ra "03/05/1990": hợp lệ nhưng đảo ngày và tháng.
  - Lỗi có từ trước.
  - Hộp xác nhận ngày sinh (ngày sinh chỉ đặt được một lần) là chốt chặn.

## Deploy và migration
Không có migration. Đổi web và Mini App. Phần web lên khi deploy VPS. Phần Mini chỉ tới khách khi chủ đẩy Mini App lên Zalo.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
