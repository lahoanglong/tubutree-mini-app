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
| D1-01 / D3-01 | Không có chỗ nhập % hoa hồng CTV. Với sản phẩm thật, mọi đơn CTV ra 0đ (đã tự kiểm: DB seed mới có 48 biến thể, 0 cái có %) | Agent (gói `commission`) + chủ dự án chọn mức % | Đã làm (nhập CSV + từng SP). Còn chờ chủ dự án nhập % thật (câu A1) |
| D4-001 | Quiz, nhiệm vụ, chủ đề cộng đồng, loài cây, mẫu thông báo chỉ có trong `seed.ts`; prod không chạy seed nên ngày ra mắt các phần này trống | Agent (gói `refseed`) | Đã làm: `seed:reference` chỉ tạo khi thiếu, không ghi đè. Chủ dự án chạy một lần sau deploy |
| D6-01 | Backup DB chưa có bằng chứng chạy trên VPS; sổ ví/điểm/hoa hồng chỉ nằm trong DB này | Agent viết script + runbook (gói `infra`); chủ dự án cài trên VPS và chọn nơi lưu | Phần repo xong (script + runbook). Chờ chủ dự án cài và diễn tập |
| D6-02 / D3-11 | Màn đại lý quảng bá link `ten.tubutree.com` nhưng chưa có DNS/chứng chỉ wildcard | Agent (gói `storefront`, cờ `storefront.subdomain_enabled` mặc định tắt) + chủ dự án chốt | Đã làm: cờ tắt, link dùng `app.tubutree.com/s/<mã>`. Bật khi có DNS wildcard + SSL (câu B4) |
| D2-01 (có điều kiện) | Không ghi nguồn khách. Nếu in thẻ QR trong hộp hàng sàn trước khi sửa, số liệu đợt đó mất hẳn | Agent (gói `source`) | Đã làm. Còn kiểm `?src=` trên Zalo thật trước khi in thẻ (việc chủ dự án 8) |
| Đã biết từ 99 | DNS `api.`/`app.`, quét QR UAT trên Zalo thật, nội dung FAQ/Academy, khoá Zalo/Pancake | Chủ dự án | Chờ |

## 3. Kế hoạch thực hiện

Mỗi gói một worktree `.claude/worktrees/lr-<gói>`, nhánh `lr/<gói>` từ `review/2026-10-18-launch`. Mỗi gói: code (TDD) → review Opus (gói chạm tiền/quyền: hai lượt) → sửa → merge `--no-ff` vào `review/2026-10-18-launch` → gate đầy đủ ở cuối. Không push, không merge vào main.

### Đợt 1 (đã xong)

| Gói | Model | Mục | Mục tiêu |
|---|---|---|---|
| `commission` | Opus | D1-01, D3-01, D1-06 (màn giá sỉ), D3-07, D3-16 | Đại lý/CTV có hoa hồng thật; CSKH tra được ai giới thiệu đơn |
| `refseed` | Sonnet | D4-001, D4-021 | Cộng đồng/game không trống ngày ra mắt |
| `source` | Sonnet | D2-01, D4-007, D3-06, D3-17 | Đo được khách đến từ sàn/thẻ/OA/CTV; mọi nút chia sẻ mang mã giới thiệu |
| `community` | Sonnet | D1-08, D4-003, D4-006, D4-009, D4-010, D4-022, D1-17 (inbox) | CSKH duyệt bài trên web; bài/câu hỏi chờ vào "Việc cần xử lý"; người đăng được báo |
| `infra` | Sonnet | D6-01, 03, 04, 05, 06, 07, 08, 09, 14, 15 | Backup, nén, keep-alive, CI build + race, ảnh web |
| `handbook` | Sonnet | D1-09 | Sổ tay việc hằng ngày cho 6 vai trò, ranh giới Tubu/Pancake |

### Đợt 2 (đã xong, trừ ghi chú ở mục 6)

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

### Việc treo sau khi gộp

- Ẩn ô subdomain ở `/merchant` theo trường `subdomainEnabled` của gói storefront, làm sau khi gộp storefront và affiliate-ui.

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

## 6. Kết quả đợt chạy đêm 2026-10-17 → 18

Mọi thay đổi nằm trên nhánh `review/2026-10-18-launch`: chỉ có ở máy, chưa push, chưa merge vào `main`, chưa deploy. Mỗi gói có báo cáo riêng ở `impl/<gói>.md`, gồm việc đã làm, kiểm chứng, phần cố ý để lại và câu hỏi.

**Đã gộp (18 gói).** Mỗi gói đã được review Opus. Gói chạm tiền hoặc quyền được review 2–3 lượt. Sau mỗi lần gộp, điều phối viên tự chạy lại kiểm chứng trên cây đã gộp.

| Gói | Mục | Ghi chú |
|---|---|---|
| `handbook` | D1-09 | Sổ tay việc hằng ngày cho 6 vai trò |
| `infra` | D6-01, 03–09, 14, 15 | Backup 6 giờ, nén, keep-alive, CI docker build + race, ảnh web |
| `refseed` | D4-001, D4-021 | `seed:reference` chỉ tạo khi thiếu |
| `source` | D2-01, D4-007, D3-06, D3-17 | Ghi nguồn chạm đầu 90 ngày, khử trùng click CTV |
| `community` | D1-08, D4-003/006/009/010/022 | CSKH duyệt bài trên web, báo người đăng |
| `uiquick` | D7 việc 2, 3, 6, 7, 8, 12 | |
| `webconv` | D5-01/02/03/04/12/14 | Trang pháp lý mới là khung, nội dung chờ chủ dự án |
| `reports` | D1-04, D2-02, D3-18, D1-14 | |
| `feedimg` | D6-05 | |
| `democlean` | (thêm) | Script dọn dữ liệu demo, go-live chặn hàng/mã demo |
| `claim` | D2-03, D2-08 | Freeship đơn đầu đang tắt |
| `commission` | D1-01, D3-01, D1-06, D3-07, D3-16 | Chỉ CTV và đại lý được ghi công |
| `affiliate-ui` | D3-03, D7 việc 9, 10 | |
| `orders` | D1-17, D1-06, D1-03 | Công tắc so tổng Pancake bật sẵn, tắt được ở tab Cấu hình |
| `configvis` | (thêm) | Spec buộc khoá cấu hình mới phải hiện ở tab Cấu hình |
| `newcustomer` | D2-07, D2-06, D5-07, D5-10, D7 việc 1 | Bố cục trang chủ và xem trước cộng đồng đang tắt |
| `roles` | D1-05 | MARKETING, KE_TOAN; trần và ngân sách mã của nhân viên |
| `storefront` | D3-02, D3-08, D3-10, D3-11, D3-19, D5-05, D5-09, D6-02 | Admin gỡ/đăng lại/duyệt; duyệt và subdomain sau cờ, mặc định tắt; ảnh chia sẻ chống SSRF, không trả 500 |

**Lỗi review bắt được trước khi gộp (đáng kể):**
- Kế toán tự nhập số tài khoản vào khoản hoàn tiền của khách, chuyển được tiền hoàn về tài khoản mình. Đã chặn: chỉ ADMIN nhập.
- Marketing tạo được mã giảm 100%, không giới hạn lượt, rồi tự dùng. Đã chặn: trần 50% / 200.000đ, 1.000 lượt, 30 triệu đồng/ngày/người; không tự dùng mã mình tạo.
- CSV đơn do nhân viên xuất có đủ SĐT khách. Đã che.
- Cờ cấu hình mới không hiện ở tab Cấu hình nên không bật được. Đã sửa và thêm spec chặn.
- Ảnh xem trước link gian hàng trả 500 (mất ảnh khi chia sẻ) và máy chủ web tải được URL nội bộ do CTV đặt (SSRF). Đã sửa, kiểm bằng build thật.
- Gian hàng bị ẩn (chủ bị khoá, hết vai trò) vẫn được áp combo và ghi công ở checkout. Đã chặn.

**Kiểm chứng toàn nhánh:** chạy trên tip `f9f467c9`, Postgres 16 mới.

| Lệnh | Kết quả |
|---|---|
| `pnpm typecheck`, `pnpm lint`, `pnpm lint:vars`, `tsc --noEmit` 4 app (api, web, miniapp, e2e) | 6/6, 5/5, OK, sạch |
| `prisma migrate deploy` trên DB mới + `migrate diff --exit-code` | 197 migration, không lệch |
| jest API (toàn bộ) | 347 suite, 7622 test xanh |
| race toàn bộ (`--runInBand`, `pool_timeout=30`) | 223 suite, 1566/1568 test xanh. 2 ca đỏ khi chạy cả bộ lúc máy tải cao: `wallet-ledger` (P2028) và `referral-guest-referrer` ca (7) ("Hệ thống đang bận"). Chạy riêng xanh 2/2 lần. Nhánh không sửa ví; nhánh có thêm 2 lệnh nhỏ vào transaction gộp tài khoản |
| vitest miniapp (giờ VN và UTC) | 259 file, 3746 test xanh cả hai |
| vitest web (giờ VN và UTC) | 174 file, 2686 test xanh cả hai |
| Playwright Mini App (`E2E_SCOPE=miniapp`, API giả lập) | 162/162 xanh, sau khi thêm mock mặc định cho `/cart` và `/me/new-customer-offer` (`f9f467c9`) |
| `pnpm build` | 4/4 |

Chưa chạy: Playwright phần API và Web admin. Phần này cần DB dev dùng chung (cổng 5434), mà theo luật không ghi vào DB dùng chung. CI sẽ chạy khi mở PR.

**Race chập chờn khi máy tải cao.** Máy dùng chung, load 45–60. Một số race spec trượt với P2028 "Unable to start a transaction in the given time" khi chạy cả bộ. Thêm `&pool_timeout=30` vào `DATABASE_URL` thì xanh. Đây không phải lỗi logic. CI có máy riêng nên không gặp.

**Chưa làm (cần chủ dự án quyết hoặc chờ phiên đổi rác):** D1-02, D2-04, D2-05/D4-004, D3-04/05, D1-07, D4-002, D4-008, D5-06, D1-19 (xem mục 3). Phễu sự kiện theo nguồn để sau (xem `impl/reports.md`).

## 7. Trạng thái cuối đợt 2 (2026-10-18 tối)

Tip `fbf31da9`, đã push `origin/review/2026-10-18-launch`, PR nháp #20 vào `main`. Chưa merge, chưa deploy.

**Gói đợt 2 đã gộp:** docs, ui, config, legal, ai, ketoan, catmap, extorders, commission, fixreg, points1d, pts1dpolish, extclaim, extui, chatpts, extsearch, polish. Báo cáo từng gói ở `impl/<gói>.md`. Các gói đụng tiền đã qua review Opus nhiều lượt:

| Gói | Số lượt review |
|---|---|
| points1d | 2 |
| pts1dpolish | 3 |
| extclaim | 4 |
| chatpts | 4 + 1 lượt nhanh |
| extsearch | 3 |

**Cờ đang TẮT, chưa bật được:**
- `loyalty.marketplace_claim_enabled` (B6, tích điểm đơn sàn).
- `loyalty.chat_order_points_enabled` (B9, tự cộng điểm đơn chat/điện thoại).

Hai cờ chờ payload Pancake thật (runbook Bước 15) và ít nhất 2 người duyệt (ADMIN/CSKH).

**Quyết định thêm của chủ dự án trong đợt này:**
- Hotline cho khách: `0984 606 774`. SĐT kho gom đơn giữ `0899149229`.
- Link cộng đồng điền sẵn theo website: Facebook `https://www.facebook.com/tubutree`, TikTok `https://www.tiktok.com/@tubutree.com`. Chưa có nhóm Zalo nên nút Zalo ẩn.
- Mini App KHÔNG định kỳ xin lại SĐT. Hệ quả: 180 ngày sau lần xác minh SĐT, đơn chat của thành viên vào REVIEW (CSKH duyệt, phải ghi chú). Nới thời hạn bằng `loyalty.chat_phone_verified_max_days`.

**Kiểm chứng trên `d2dcbe0b`, Postgres 16 mới:**

| Lệnh | Kết quả |
|---|---|
| tsc 4 app, `pnpm lint`, `pnpm lint:vars` | sạch, 5/5, OK |
| `prisma migrate deploy` + drift + partial index | 206 migration, không lệch, 25/25 |
| jest API | 371 suite, 8088 test xanh |
| race toàn bộ | 234 suite, 1745 test xanh |
| vitest web (VN và UTC) | 179 file, 2752 test xanh |
| vitest miniapp (VN và UTC) | 3801/3802 mỗi lần. Hai ca khác nhau trượt do quá giờ chờ khi load 46–60; chạy riêng 6/6 xanh. Chạy lại toàn bộ trên `fbf31da9`: 3802/3802 |
| Playwright Mini App | 165/165 |
| `pnpm build` | 4/4 |
| CI GitHub (PR #20, `d2dcbe0b`) | CI, Docker build, Playwright E2E đầy đủ (API, Web, Mini App) xanh |

**Giới hạn đã biết** (chi tiết trong `impl/chatpts.md`, `impl/extsearch.md`):
- Tên trường Pancake (`creator.id`, status 16, `partner.extend_code`, `trackingCodes`) chưa đối chiếu với payload thật.
- Che SĐT trong ghi chú tự do còn sót vài dạng (`901 234 567`, số dính sau chữ).
- Đua rất hẹp khi admin thêm grant cho số cũ đúng lúc nhân viên đổi số Zalo.
- Đơn chat tạo trước khi khách lên hạng giữ hệ số cũ.
- Lượt chờ mã vận đơn quá 3 ngày của khách khác: CSKH gắn tay.

**Việc chủ dự án còn phải làm:** mục 5 ở trên, cộng thêm:
- khoá `PANCAKE_API_KEY` và `PANCAKE_SHOP_ID` (để bắt payload thật);
- đăng ký Bộ Công Thương (footer tubutree.com đang ghi "Website đang chờ đăng ký bộ công thương");
- DNS wildcard;
- rclone Google Drive.

## 8. Đợt 3: review chéo toàn nhánh (đêm 2026-10-18 → 19)

Mỗi gói đã được review riêng. Đợt này soát lỗi chỉ lộ ra khi các gói chạy cùng nhau, bằng 3 reviewer Opus độc lập theo 3 trục: điểm và tiền, quyền và dữ liệu cá nhân, migration và deploy. Sau khi sửa, gói sửa được soát thêm 2 lượt Opus.

**Kết quả review chéo:**
- Điểm và tiền: không có lỗi chặn. Migration `points_1d` nhân đủ 16 cột điểm, chạy lại không nhân đôi. Mọi trần và ngưỡng so cùng đơn vị.
- Quyền và dữ liệu cá nhân: có 2 đường vòng (mục a, b dưới). Không có route admin nào mà khách, CTV hay đại lý gọi được.
- Migration và deploy: chỉ có cảnh báo. Không thêm migration nào.

**Đã sửa (gói `lr3/fixes`, `lr3/e2eadmin`, `lr3/raceci`):**

a. **Nhân viên Marketing không còn xem được mã của lô thẻ QR do ADMIN hay nhân viên khác tạo.**
   - Trước đây có hai đường lộ mã: `GET /admin/coupon-batches/:batch/codes` và tìm kiếm `GET /admin/coupons?q=`. Có mã thì nhân viên tự nhận được thẻ, vượt trần B19.
   - Nay nhân viên chỉ thấy mã của lô mình tạo.
   - Danh sách lô có thêm cờ `mine`. Lô của người khác thì web ẩn nút tải CSV.

b. **Kế toán không còn thấy đủ SĐT khách ở hàng chờ hoàn tiền** (`GET /admin/customer-refunds` và các thao tác của hàng chờ) **và ở CSV hoàn tiền.**
   - SĐT chỉ còn 3 số cuối.
   - Ghi chú tự do chỉ che dãy giống SĐT VN, nên số tiền và mã giao dịch ngân hàng vẫn đọc được.
   - Số tài khoản và tên chủ tài khoản vẫn hiện đủ, vì cần để chuyển tiền.
   - SĐT đã che thì không có nút "Chép SĐT".
   - CSV thuế vẫn giữ SĐT và MST của CTV, vì CTV là người nhận tiền.

c. **Trần tháng của claim đơn sàn và đơn chat có thêm cận trên.**
   - Lỗi cũ: duyệt muộn một claim của tháng trước thì bị tính chung với claim của tháng này, nên có thể báo `MONTHLY_CAP` sai và khách mất điểm.
   - Nay cửa sổ tính trần là đúng tháng tạo claim, ở cả 5 chỗ: duyệt PHONE, duyệt SCAN, cron cộng SCAN, liên kết chat (trần tháng), liên kết chat (trần người tạo).
   - Mỗi chỗ có ca race riêng, và ca đó đỏ khi bỏ cận trên.

d. **Trợ lý AI:** mọi tài khoản khách vãng lai (tạo theo deviceId) dùng chung trần 10 lượt mỗi phút, nên một người xoay vòng tài khoản khách không chiếm hết hạn mức của khách thật. Lượt bị từ chối không bị trừ vào hạn mức theo giờ.

e. **Hiển thị sau đổi 1 điểm = 1đ:**
   - Popup "lên hạng" không còn hiện sai, vì khoá lưu mốc hạng đổi sang `_v2`.
   - Giá vòng quay khi chưa tải hồ sơ là 10.000.
   - Web thanh toán ghi "Điểm Xanh (25.000)".

f. **Bộ kiểm partial index** có thêm 3 khoá chống cộng trùng của điểm đơn ngoài app.

g. **Playwright web admin cho tab "Tích điểm đơn sàn":**
   - duyệt claim có SĐT cũ thì bắt ghi chú;
   - duyệt claim có SĐT mới thì hiện hộp xác nhận thường;
   - hiện khối "người khác cùng gửi".

h. **CI race:**
   - Lần đầu chạy trên GitHub, bộ race quá 60 phút và trượt hàng loạt. Lý do: Prisma chỉ mở 5 kết nối trên runner 2 vCPU.
   - Cách sửa: chia 3 phần song song, mỗi phần có Postgres riêng, và `connection_limit=20`.

i. **Runbook và tài liệu:**
   - Bước kiểm trước deploy: đếm gian hàng CTV đang đăng mà chưa duyệt. Mặc định B3 bật, nên các gian hàng này sẽ bị ẩn.
   - `pancake.external_capture_enabled` lưu đơn ngoài app kèm SĐT người mua.
   - Bật B9 sẽ tạo claim bù cho đơn chat trong 60 ngày gần nhất.
   - `coupons.createdAt` của mã cũ bằng giờ chạy migration.

**Ghi nhận, không sửa:**
- Gian hàng CTV có từ trước deploy bị ẩn cho tới khi admin duyệt. Đây là đúng quyết định B3 ("duyệt lần đầu"), và hiện chưa có dữ liệu thật.
- Đơn chat được tính vào xét hạng, đúng như `impl/extpoints-plan.md`. Đơn sàn thì không.

**Kiểm chứng trên tip `5913fd80`** (đã gộp `main` #19):

| Lệnh | Kết quả |
|---|---|
| tsc 4 app, `pnpm lint`, `lint:vars` | sạch |
| `prisma migrate deploy` + drift + partial index | 206 migration, không lệch, 25/25 |
| jest API | 371 suite, 8112 ca |
| race toàn bộ | 235 suite, 1750 ca |
| vitest miniapp (VN và UTC) | 3803 ca mỗi lần |
| vitest web (VN và UTC) | 2755 ca mỗi lần |
| Playwright Mini App | 166 ca |
| Playwright Web Admin | 14 ca |
| `pnpm build` | 4/4 |

Playwright Web Admin chạy bằng config tạm chỉ dựng web server. Không dựng API, nên không đụng DB dùng chung.
