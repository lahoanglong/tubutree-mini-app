TITLE: perf(mini): gói đầu Mini App nhẹ hơn 16 KB, thẻ sản phẩm đầu không chậm hơn main (R-77, bước 1)

## Vấn đề
R-77: gói đầu (entry) của Mini App là 711 KB raw / 222 KB gzip. Mọi thứ khách cần ở lần mở đầu đều nằm trong đó, kể cả các khối cuối Trang chủ và chữ nhịp người mới của trò chơi trong `vi.ts`.

## Quyết định của chủ (31/10)
- Kệ Mua lại và kệ Bán chạy nạp ngay trong gói đầu như main. Các khối khác của Trang chủ nạp lười, trừ khối nào làm thẻ sản phẩm đầu chậm hơn hoặc làm nhảy bố cục.
- Tiêu chí: thẻ sản phẩm đầu không chậm hơn main quá 50 ms ở mọi ca, không dùng preload. CLS mỗi ca không cao hơn main.
- Không thêm bước deploy nào: không preload, không `listAsyncJS`, không lệnh `zmp:preloads`.
- Chủ đã chấp nhận tổng gói tăng nhẹ.

## Có gì trong PR
- Hành trình nguyên liệu, Cộng đồng và Gợi ý nằm trong chunk riêng `home-below`.
  - Chunk này tải ngay khi mã Trang chủ chạy, song song với dữ liệu.
  - Ba khối này luôn là ba khối cuối ở mọi thứ tự (`homeBlockOrder`). Chúng hiện muộn hơn main một nhịp chunk, nhưng không đẩy khối nào đang hiện.
- Kệ Mua lại, kệ Bán chạy, Giờ vàng và dải Quà khách mới vẫn nạp ngay như main.
  - Giờ vàng: khi nạp lười, CLS khách mở lại tăng 0,0087 → 0,0211.
  - Dải Quà khách mới: khi chunk chậm, khách có đơn chưa giao bị nhảy 76 px sau khi thẻ sản phẩm đã hiện.
- Khung chờ chung của Trang chủ không đợi chunk, nên thẻ sản phẩm đầu không phụ thuộc chunk.
- Chunk tải hỏng (mạng rớt):
  - Trang chủ hiện dải lỗi có nút Thử lại, bấm thì tải lại app.
  - Kéo để làm mới cũng tải lại chunk.
  - `isChunkError` nhận diện lỗi tải chunk của Vite.
- Chữ nhịp người mới (`game.newbie`) chuyển từ `vi.ts` sang `packages/app-core/src/game-newbie.ts`. Chỉ chuyển chỗ, không đổi chữ nào.
- Các lượt trước có thử preload (modulepreload, `listAsyncJS`, `zmp:preloads`). Phần này đã bị bỏ hết theo quyết định của chủ. So với main, `package.json`, `vite.config.mts`, `app-config.json` và tài liệu deploy không đổi.

## Số đo
Đo bằng Chromium headless khổ 375 px, mạng 4G chậm, CPU chậm 4 lần, không modulepreload. Mỗi ca chạy 3 lần xen kẽ giữa trước (main `d8c46a7a8`) và sau, lấy trung vị. Cột "chênh" là thời gian tới thẻ sản phẩm đầu, tính bằng ms.

| ca | chunk bình thường | chunk trễ 3 s | CLS trước = sau |
|---|---|---|---|
| khách vãng lai, mở lạnh | −10 | +11 | 0,0152 |
| khách vãng lai, mở lại | −370 | −309 | 0,0087 |
| khách mới, mở lạnh | −125 | −111 | 0,0152 |
| khách mới, mở lại | −377 | −327 | 0,0087 |
| khách có đơn chưa giao, mở lạnh | −107 | −101 | 0,0795 |
| khách có đơn chưa giao, mở lại | −398 | −176 | 0,0882 |
| khách cũ, mở lạnh | −28 | −60 | 0 |
| khách cũ, mở lại | −391 | −217 | 0,0304 |

- Không ca nào chậm hơn quá 50 ms. Chậm nhất là +11 ms.
- Phần nhanh hơn ~400 ms ở các ca mở lại có thể do API của máy đo chạy HTTP/1.1, mỗi host tối đa 6 kết nối. Không nên coi đây là cải thiện thật.
- CLS của khách có đơn chưa giao (0,0795 và 0,0882) bằng nhau ở main và nhánh này. Đây là bố cục sẵn có từ main.
- Gói Mini App (bundle-report):
  - Entry: 711 KB raw / 222 KB gzip xuống 695 KB / 217 KB, dưới ngưỡng cảnh báo 700 KB của bundle-report.
  - Tổng: 1994 / 770 lên 1997 / 774. Phần tăng do tách chunk.
- R-77 đặt đích 600 KB. Đích này chưa đạt, vì hai kệ sản phẩm, Giờ vàng và dải quà ở lại gói đầu theo quyết định của chủ.
- Bằng chứng:
  - Probe, kết quả đo và bundle-report trước/sau nằm ở `docs/2026-10-28-review/perf/1028c-goi-dau/` (nhánh tài liệu, PR #86).
  - Ảnh dải lỗi chunk và Trang chủ khách mới ở 375 px nằm trong thư mục ảnh cục bộ `screens-1028c-goi-dau/`, không đưa lên git.

## Cách kiểm
- Test mới cho các ca:
  - Chunk chưa về: khung chờ chung vẫn nhả và thẻ sản phẩm hiện.
  - Chunk hỏng: hiện dải lỗi, kéo làm mới tải lại chunk.
  - Máy đã nhớ loại khách (khách mới, khách cũ, vãng lai): không có ô giữ chỗ thừa.
  - Chunk treo: dải quà vẫn hiện chữ, và trả về null đúng lúc cho khách có đơn chưa giao.
  - Các test mới đỏ ở commit trước khi sửa, xanh sau.
- Worker chạy:
  - vitest Mini App (TZ=UTC): 340 file / 5348 test.
  - Playwright Mini App, spec Trang chủ: 13/13.
  - Playwright Mini App toàn bộ, ở lượt có Giờ vàng nạp ngay: 220 passed, 10 skipped.
  - tsc, eslint, lint:parity, vite build.
- Reviewer Opus kết luận "merge được" qua ba lượt, sau khi tự chạy lại test Trang chủ và đối chiếu số đo với file kết quả.
- Gate đầy đủ trên nhánh đã gộp main `cb0007c35` (#87, tip `70cfd8c7c`): 0 FAIL. Gate gồm:
  - tsc 6 gói, eslint (API, Mini App, web).
  - vitest: app-core 1335, Mini App 5375 (thêm một lượt giờ UTC), web 8152.
  - jest API: 509 suite / 11904 test.
  - lint:parity, vite build, bundle-report (entry 695/218 KB, tổng 2001/775 KB).
- Trước khi gộp #87, gate trên main `d8c46a7a8` cũng 0 FAIL.

## Còn lại
- R-77 bước tiếp (đích 600 KB) cần chủ chọn lại: tách tiếp khỏi gói đầu những phần không thuộc Trang chủ, hoặc chấp nhận 695 KB.
- Hành trình nguyên liệu và Gợi ý hiện muộn hơn main một nhịp tải chunk. Khối nằm cuối trang nên không gây nhảy bố cục.

## Deploy và migration
Không có migration. Chỉ đổi Mini App, không cần deploy VPS. Khách chỉ nhận thay đổi khi chủ đẩy Mini App lên Zalo.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
