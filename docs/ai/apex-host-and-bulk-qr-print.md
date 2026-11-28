# Host của mã QR thẻ bỏ hộp và in hàng loạt (W58-03)

Đo ngày 28/11/2026 13:15 UTC (20:15 +07). Chỉ GET/HEAD và DNS công khai, không ghi gì lên PROD, không đọc `.env`, không SSH vào VPS.

## Kết luận

- **QR in trên thẻ PHẢI dùng `https://tubutree.com`.** Apex đã là web mới: `A tubutree.com = 14.225.207.177`, cùng VPS Vietnix với `app.` và `api.`; WordPress/ZenCloud (`42.1.122.84`, ghi ở `docs/launch/apex-cutover-rehearsal-2026-11-14.md`) không còn trả lời ở apex.
- `SITE_URL` của bản build web PROD là `https://tubutree.com`. Bằng chứng từ chính bản đang chạy: `canonical`, `og:url` và JSON-LD của trang chủ đều là `https://tubutree.com`, và trong chunk JS công khai biểu thức đã nướng là `"https://tubutree.com".trim()||"https://app.tubutree.com"` (nhánh `app.` chỉ là mặc định khi thiếu biến). Chưa đọc image/env trên VPS nên "khoá có mặt trong env" là UNVERIFIED; số liệu trên là suy từ sản phẩm đã dựng.
- Các báo cáo W49 ghi "apex vẫn là WordPress, QR theo `SITE_URL` = `app.tubutree.com`" là **lỗi thời**: `app.tubutree.com` chỉ là mặc định trong mã (`apps/web/src/lib/site.ts`), không phải giá trị PROD.
- `app.tubutree.com` vẫn trả đúng bản dựng này (cùng ETag) nhưng kèm `x-robots-tag: noindex, nofollow`: là bí danh, không phải host chính. Thẻ đã in trước đây với `app.` vẫn quét được; không tắt bí danh này.

## Bảng đo

| URL | Mã | Chuyển hướng | Ai trả lời |
| --- | --- | --- | --- |
| `https://tubutree.com/` | 200 | 0 | Next.js (`x-nextjs-prerender: 1`), `server: Apache`, 182080 B, ETag `cz1u1qj9903uv4`, canonical `https://tubutree.com`, không có `wp-content` |
| `https://tubutree.com/dang-nhap` | 200 | 0 | Next.js, "Đăng nhập — Tubu Tree", 62268 B |
| `https://tubutree.com/quet-ma` | 200 | 0 | Next.js, "Tích điểm đơn sàn — Tubu Tree", 64185 B |
| `https://tubutree.com/dai-ly` | 200 | 0 | Next.js, "Kênh đại lý — Tubu Tree", 89350 B |
| `https://app.tubutree.com/` | 200 | 0 | cùng bản dựng và ETag với apex, thêm `x-robots-tag: noindex, nofollow`, canonical vẫn trỏ apex |
| `http://tubutree.com/` | 301 | 1 | tới `https://tubutree.com/` |
| `https://www.tubutree.com/` | 301 | 1 | tới `https://tubutree.com/` (DNS qua Cloudflare) |
| `http://app.tubutree.com/` | 301 | 1 | tới `https://app.tubutree.com/` |

`/wp-login.php` ở apex: 404. Bốn trang `/`, `/dang-nhap`, `/quet-ma`, `/dai-ly` có số byte giống hệt giữa apex và `app.`.

## In hàng loạt (admin, tab Tích điểm đơn sàn, khối "In hàng loạt")

- Chọn sàn + tên đợt thẻ (bắt buộc ở chế độ này) + số thẻ 1 tới 200 + "Bắt đầu từ số" (1 tới 999, thẻ cuối không quá 999). Một nút in.
- Tờ A4 xếp 2 × 2 thẻ A6 (105 × 148 mm, đúng cỡ thật), dấu cắt đặt đúng trên đường cắt giữa tờ, ngắt trang giữa các tờ, tờ cuối không ngắt. Trong hộp thoại in chọn A4, 100%, không lề.
- Link mỗi thẻ: `https://tubutree.com/quet-ma?utm_source=<sàn>&card=<đợt>&n=<số 3 chữ số>`. `card` giữ nguyên cả đợt để báo cáo nguồn gom một dòng; `n` riêng từng thẻ và bộ đọc nguồn bỏ qua nó (Mini App cũng chỉ giữ tham số trong `MINIAPP_KEEP_PARAMS`, nên `n` chỉ còn trong nhật ký truy cập web).
- Idempotent: mã là hàm thuần của (sàn, đợt, số bắt đầu, số thẻ), không ghi máy chủ; in lại lượt cũ ra đúng cùng mã. Lượt sau cùng đợt thì đặt "Bắt đầu từ số" nối tiếp số cuối.
- Mã: `apps/web/src/lib/insert-qr-batch.ts`; thẻ lẻ vẫn ở `insert-qr-card.ts` (thêm tuỳ chọn `serial`).
