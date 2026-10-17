# Tổng hợp discovery và kế hoạch hoàn thiện ra mắt — Tubu Tree mini-app

Ngày 2026-10-18. Nguồn: 6 báo cáo D1–D6 cùng thư mục, mỗi báo cáo có bằng chứng `path:line`. Phạm vi đã loại trừ (phiên khác làm): đổi rác lấy quà; đơn giao ngày cao điểm; bán trên sàn, social, bán sỉ, cào data (repo chodeli-marketing-support-system).

## 1. Trả lời thẳng: sản phẩm đã hoàn thiện 100% chưa?

Chưa. Giao diện gần xong, nhưng công cụ vận hành và công cụ kênh bán còn hở. Nhân sự nói "vẫn phải làm bên ngoài nhiều" là đúng.

| Nhánh | Mức hoàn thiện | Ý chính |
|---|---|---|
| D5 Giao diện từng màn | ~88–90% | Không màn nào là placeholder, không link chết. Còn thiếu: trang pháp lý, "Mua ngay" trên web, tab Cấu hình admin là JSON thô |
| D1 Vận hành hằng ngày | ~55% | 53 việc hằng ngày: 19 làm trọn trong hệ thống, 14 một phần, 20 phải làm ngoài (8 trên Pancake) |
| D2 Kéo khách từ sàn | ~40% | Luồng mua xong ~80%. Phần dành cho khách từ sàn ~20%, phần đo lường ~20% |
| D3 Kênh đại lý/CTV | ~60% | Phần tiền làm kỹ; công cụ để CTV/đại lý tự bán và để admin quản kênh còn yếu |
| D4 Cộng đồng | ~60% | Có 16 vòng tương tác; thiếu nội dung khởi tạo, người vận hành, đường kéo khách quay lại |
| D6 Hạ tầng | mã ~85%, VPS thật ~35% | Backup, giám sát, DNS gian hàng chưa có bằng chứng chạy thật |

## 2. Việc chặn ra mắt (P0)

| ID | Vấn đề | Ai xử lý | Trạng thái |
|---|---|---|---|
| D1-01 / D3-01 | Không có chỗ nhập % hoa hồng CTV. Với sản phẩm thật, mọi đơn CTV ra 0đ (đã tự kiểm: DB seed mới có 48 biến thể, 0 cái có %) | Agent (gói `commission`) + chủ dự án chọn mức % | Đang làm |
| D4-001 | Quiz, nhiệm vụ, chủ đề cộng đồng, loài cây, mẫu thông báo chỉ có trong `seed.ts`; prod không chạy seed nên ngày ra mắt các phần này trống | Agent (gói `refseed`) | Đang làm |
| D6-01 | Backup DB chưa có bằng chứng chạy trên VPS; sổ ví/điểm/hoa hồng chỉ nằm trong DB này | Agent viết script + runbook (gói `infra`); chủ dự án cài trên VPS và chọn nơi lưu | Đang làm phần repo |
| D6-02 / D3-11 | Màn đại lý quảng bá link `ten.tubutree.com` nhưng chưa có DNS/chứng chỉ wildcard | Agent (đợt 2, cấu hình mặc định tắt subdomain) + chủ dự án chốt | Chờ đợt 2 |
| D2-01 (có điều kiện) | Không ghi nguồn khách. Nếu in thẻ QR trong hộp hàng sàn trước khi sửa, số liệu đợt đó mất hẳn | Agent (gói `source`) | Đang làm |
| Đã biết từ 99 | DNS `api.`/`app.`, quét QR UAT trên Zalo thật, nội dung FAQ/Academy, khoá Zalo/Pancake | Chủ dự án | Chờ |

## 3. Kế hoạch thực hiện

Mỗi gói một worktree `.claude/worktrees/lr-<gói>`, nhánh `lr/<gói>` từ `review/2026-10-18-launch`. Mỗi gói: code (TDD) → review Opus (gói chạm tiền/quyền: hai lượt) → sửa → merge `--no-ff` vào `review/2026-10-18-launch` → gate đầy đủ ở cuối. Không push, không merge vào main.

### Đợt 1 (đang chạy)

| Gói | Model | Mục | Mục tiêu |
|---|---|---|---|
| `commission` | Opus | D1-01, D3-01, D1-06 (màn giá sỉ), D3-07, D3-16 | Đại lý/CTV có hoa hồng thật; CSKH tra được ai giới thiệu đơn |
| `refseed` | Sonnet | D4-001, D4-021 | Cộng đồng/game không trống ngày ra mắt |
| `source` | Sonnet | D2-01, D4-007, D3-06, D3-17 | Đo được khách đến từ sàn/thẻ/OA/CTV; mọi nút chia sẻ mang mã giới thiệu |
| `community` | Sonnet | D1-08, D4-003, D4-006, D4-009, D4-010, D4-022, D1-17 (inbox) | CSKH duyệt bài trên web; bài/câu hỏi chờ vào "Việc cần xử lý"; người đăng được báo |
| `infra` | Sonnet | D6-01, 03, 04, 05, 06, 07, 08, 09, 14, 15 | Backup, nén, keep-alive, CI build + race, ảnh web |
| `handbook` | Sonnet | D1-09 | Sổ tay việc hằng ngày cho 6 vai trò, ranh giới Tubu/Pancake |

### Đợt 2 (sau khi đợt 1 merge, theo thứ tự ưu tiên)

| Gói | Model | Mục | Ghi chú |
|---|---|---|---|
| `newcustomer` | Sonnet | D2-07, D2-06, D5-10, D5-07 | Voucher chào mừng cấp ngay khi tạo tài khoản; khối "Quà khách mới"; số điểm sẽ nhận ở trang sản phẩm |
| `claim` | Opus | D2-03, D2-08 | Mã ẩn cho thẻ hộp hàng, cờ "chỉ khách mới", nhận mã qua `?claim=`; freeship đơn đầu (cấu hình, mặc định tắt) |
| `storefront` | Sonnet | D3-02, D3-08, D3-11/D6-02, D3-03, D3-10, D3-19, D5-05, D5-09 | Admin gỡ được gian hàng; subdomain theo cấu hình (mặc định tắt); đại lý không mất màn hoa hồng |
| `reports` | Sonnet | D1-04, D2-02, D3-18, D1-14 | KPI theo ngày/kênh; báo cáo nguồn → đơn đầu → đơn 2; xuất CSV TNCN, rút tiền, hoàn tiền |
| `roles` | Opus | D1-05 | Nhóm việc MARKETING, KE_TOAN; thôi cấp ADMIN cho mọi người |
| `webconv` | Sonnet | D5-04, D5-03, D5-02, D5-12, D5-14, D5-01 (khung) | "Mua ngay", thanh CTA dính, chia sẻ trên web; trang pháp lý dạng khung, nội dung chờ chủ dự án |
| `orders` | Sonnet | D1-17 (bộ lọc), D1-06 (danh sách đại lý + công nợ), D1-03 (cảnh báo lệch tổng Pancake) | |
| `feedimg` | Sonnet | D6-05 | Ảnh feed trả URL có cache thay vì base64 nội tuyến |
| `uiquick` | Sonnet | D7 việc 2, 3, 7, 8, 12 | Nút Thanh toán trên thẻ đơn chờ; Chat OA ở trang SP; trạng thái lỗi/rỗng có tiêu đề, Trang chủ lỗi một dải thay 6 thẻ; thẻ bài cộng đồng không tràn; chặn hiển thị biên ("Đã bán 400%", "Còn 0h 00m") |
| `affiliate-ui` | Sonnet | D7 việc 9, 10 (phần miniapp) | Trang CTV đưa lối tắt chia sẻ/gian hàng/rút lên đầu; sửa danh sách khuyến mãi vỡ cột |

D7 (chấm từ ảnh chụp thật 390px): giao diện "trông hoàn thiện" khoảng 75%. Luồng mua lõi đạt 4/5. Màn CTV, ví, điểm, cộng đồng đạt 2,5–3/5. Axe 0 vi phạm ở cả miniapp và web. Việc 1 của D7 (màn đầu cho khách mới) gộp vào `newcustomer`, việc 4 (CTA dính ở giỏ/thanh toán web) gộp vào `webconv`. Việc 5–6 (logo, typography) chờ chủ dự án chốt logo.

### Để sau khi chủ dự án quyết hoặc sau khi nhánh đổi-rác merge

- D1-02 CSKH lên đơn hộ (chờ câu hỏi 4), D2-04 ghép đơn sàn để tích điểm, D2-05/D4-004 ZNS và tin OA (chờ Zalo duyệt mẫu), D3-04/05 mô hình bán online của đại lý (câu hỏi 3), D1-07 trưng bày danh mục/banner, D4-002 bài khởi tạo và danh tính shop (cần nội dung), D4-008 lịch sự kiện.
- D5-06 tab Cấu hình dạng form và D1-19 tách `admin/page.tsx` theo tab: làm sau khi nhánh đổi-rác merge, vì cùng file.

## 4. Chiến lược (rút gọn)

**Kéo khách từ sàn (D2 mục 8).** Không đấu giá niêm yết với sàn. Bán lời hứa "mua trực tiếp ở Tubu được nhiều hơn": quà đơn đầu + freeship, hoàn ~10% bằng Điểm Xanh, đặt định kỳ giảm 12–15%, tư vấn Zalo và cộng đồng. Điểm chạm theo chi phí thấp dần: thẻ trong hộp hàng sàn (lời "kích hoạt thành viên", không nhắc giá), Zalo OA, link bio `hello.tubutree.com` (đưa mini-app lên đầu; hiện có 6 link Shopee và 0 link mini-app), CTV. Đo: quét → đơn đầu trong 30 ngày → đơn 2 trong 30 ngày, theo nguồn.

**Đại lý/CTV (D3).** Coi đại lý là "CTV cấp cao": bán qua gian hàng, Tubu giao, hưởng % theo bậc. Cho CTV công cụ tự bán: link rút gọn có QR, "bài đăng hôm nay", bảng xếp hạng tháng, "khách của tôi".

**Cộng đồng (D4).** Ngày đầu phải có: danh tính "Tubu Tree" chính thức, 10 bài khởi tạo, 2 bài ghim, CSKH duyệt bài trong 4 giờ làm việc, 1 sự kiện mỗi tháng có trang người thắng.

## 5. Việc chủ dự án phải tự làm (agent không làm thay được)

1. DNS Cloudflare `api.`/`app.tubutree.com` → `14.225.207.177` (DNS-only), certbot.
2. Nơi lưu backup ngoài VPS (R2 hoặc Google Drive) + cài cron backup + diễn tập restore một lần.
3. Uptime monitor (UptimeRobot/BetterStack) cho `api/health` và `app`.
4. Cloudinary (hoặc dịch vụ ảnh khác): thiếu thì ảnh người dùng lưu base64 trong DB, ảnh đại diện bị bỏ âm thầm.
5. Khoá bắt buộc: Pancake (API key, shop id, webhook secret), `ZALO_APP_ID/SECRET`, `THROTTLE_BYPASS_TOKEN` (≥ 32 ký tự), kênh cảnh báo `OPS_ALERT_*`.
6. Nộp mẫu ZNS (duyệt 7–14 ngày): mời đánh giá, nhắc mua lại, voucher đơn 2.
7. Quét QR UAT trên Zalo thật; nhập FAQ/Academy.
8. Sửa `hello.tubutree.com`: đưa mini-app lên đầu kèm `?src=linkbio`.
9. Nội dung: điều khoản/bảo mật/đổi trả + thông tin pháp nhân; 10 bài cộng đồng khởi tạo; 3 bài Academy cho CTV.
10. Kiểm điều khoản Shopee/Lazada/TikTok Shop về thẻ trong hộp hàng trước khi in.
