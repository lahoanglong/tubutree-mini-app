TITLE: feat(pdp): bấm dòng "Nhận ~X Điểm Xanh" mở popup Cách tính Điểm Xanh (R-97)

## Vấn đề
R-97: khối điểm dưới giá ở trang sản phẩm từng quá dày. Phần rút còn một dòng "Nhận ~X Điểm Xanh" đã có ở main. Phần còn thiếu theo backlog: chi tiết hạng và đơn sàn để trong popup.

## Quyết định của chủ (01/11)
Làm popup. Không đổi luật điểm, chỉ đổi cách hiện.

## Có gì trong PR
- Dòng "Nhận ~X Điểm Xanh" giờ bấm được:
  - Nút có nhãn đọc màn hình "Xem cách tính Điểm Xanh", vùng bấm cao 44px.
  - Vùng bấm chỉ dôi lên phía trên, nên không đẩy bố cục và không che phần tử nào bấm được.
- Bấm vào thì mở popup "Cách tính Điểm Xanh": Mini dùng `BottomSheet` sẵn có. Web dùng `Sheet` sẵn có: dưới md là sheet đáy, từ md là hộp giữa màn.
- **Nội dung popup.** Mọi con số lấy từ config công khai qua `tierEarnOf`, `pointsBoostOf`, `multiplierLabel`, không viết cứng tỷ lệ.
  - Hạng và hệ số của khách, ví dụ "Hạng Lộc Biếc: ×1,2".
    - Khách vãng lai: "Chưa đăng nhập: hệ số ×1. Đăng nhập để được nhân theo hạng."
    - Đã đăng nhập, chưa có hạng: "Bạn chưa có hạng: hệ số ×1."
    - Lúc chưa biết người xem là ai: "Điểm được nhân theo hạng thành viên."
  - Vì sao có "~": "Dấu "~" vì giảm giá, mã giảm giá và điểm dùng lúc thanh toán làm giá trị hàng tính điểm thấp đi, nên số thực nhận có thể thấp hơn số này."
  - "Nhận Điểm Xanh khi đơn giao thành công", cùng chữ với dòng điểm dạng chung.
  - Đơn sàn: dùng lại câu sẵn có của từng nền tảng. Mini: "Đơn sàn 1% · Mua trong Mini App từ 2%, nhân theo hạng". Web: "… Mua tại Tubu Tree từ 2% …". Mục này chỉ hiện khi cờ tích đơn sàn bật.
  - Liên kết "Xem các hạng Điểm Xanh". Riêng Mini có thêm liên kết "Gửi đơn sàn để tích điểm" tới `/points/scan`, cùng đường với lối tắt Đơn sàn.
- Khi dòng ở dạng chung ("Nhận Điểm Xanh khi đơn giao thành công"), popup bỏ mục "~" và mục trùng chữ với dòng.
- Chữ dùng chung ở `packages/app-core/src/points-earn-popup.ts`. lint:parity xanh.
- Không đổi số điểm, cách tính hay phần Giờ vàng. Trong `pdp-extras.tsx` chỉ đổi `PdpPointsEarn`. Không đụng `product-detail.tsx`.

## Cách kiểm
- **Test:**
  - app-core 9 test: có hạng, vãng lai, chưa có hạng, chưa biết người xem, hệ số khác ×1 mà thiếu tên hạng, dòng dạng chung, cờ đơn sàn.
  - Mini `points-earn-line.spec` 9 test.
  - Web `pdp-extras.spec` cùng `points-earn` 47 test: mở popup, Esc và nút Đóng, focus trả về dòng, hộp giữa màn từ md, cờ đơn sàn tắt hoặc bật.
- **Reviewer Opus:** kết luận "merge được" ở lượt 2, sau khi tự chạy lại test và mở ảnh. Đã kiểm lúc Giờ vàng ẩn dòng giá: không phần tử bấm được nào bị che.
- **Ảnh:** 375 Mini và web, 1280 web, cả lúc đóng lẫn lúc mở popup. Ảnh nằm trong thư mục cục bộ `screens-1028f-diem/after2/`, không đưa lên git.
- Gate đầy đủ trên nhánh đã gộp main `357f33555` (tip `dc2c2fb6d`): 0 FAIL. Gate gồm:
  - tsc 6 gói, eslint (API, Mini App, web).
  - vitest: app-core 1772, Mini App 6002 (thêm một lượt giờ UTC), web 8844.
  - jest API: 525 suite / 12244 test.
  - lint:parity, vite build, bundle-report (entry Mini 631/196 KB).

## Còn lại (P3)
- Web 375 khác Mini một chút: web không có thanh kéo trên đầu sheet và không có liên kết "Gửi đơn sàn để tích điểm", vì web chưa có trang gửi đơn sàn. Nội dung, cỡ chữ và dòng cách giống nhau.

## Deploy và migration
Không có migration, không đổi API. Phần web lên khi deploy VPS. Phần Mini chỉ tới khách khi chủ đẩy Mini App lên Zalo.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
