# 99 — Đánh giá sẵn sàng phát hành (ghi ngày 2026-10-11, cập nhật sau đợt F ngày 2026-10-12)

Bản được đánh giá: nhánh `hardening/2026-10`, mã ở HEAD sau merge PG-1 (đợt F, F4, trần POINTS `d5acbafa` và đợt G đã gộp; bản `31bde4b8` là mốc sau đợt E). Báo cáo viết lần đầu ở `c46fe6a6`; sau đó chủ dự án duyệt các câu hỏi mở (`00-ROADMAP.md` cuối file) và đợt E (PE-1a, PE-1b, PE-2, PE-3, PE-4, PE-5) được làm, merge và kiểm lại toàn bộ trên HEAD hiện tại. Mọi số ở mục 2 chạy lại trên mã sau đợt F (PF-1..PF-6b), không dựa vào lời báo của agent. Phạm vi diff so với bản VPS `cb92dc8` (Đợt A+B): 765 file, +79.821/−15.236 dòng, 666 commit, 17 migration mới (115 → 132). Chưa push, chưa deploy, chưa ghi vào VPS hay DB dùng chung ở bất kỳ bước nào.

**Giả định nền (chủ dự án xác nhận 2026-10-11):** dự án mới có mã, chưa phát hành cho khách thật; bản `cb92dc8` trên VPS chỉ là bản thử, DNS còn trỏ IP chết, miniapp chưa lên Zalo. Nếu VPS thực ra chứa dữ liệu khách thật (số dư xu, đơn, điểm), các cổng đã bỏ ở mục 1 phải bật lại.

## 1. Kết luận

**Cổng kỹ thuật: ĐẠT trên mã sau đợt F.** Không còn lỗi kỹ thuật nào chặn phát hành mà mình biết. Mọi lệnh trong mục 2 đã chạy lại trên HEAD (không dựa vào lời báo của agent), kể cả sau các gói PE-1..PE-5.

**Quyết định của chủ dự án đã chốt (`00-ROADMAP.md`, mục "Duyệt của chủ dự án 2026-10-11"):** duyệt mặc định mọi câu hỏi mở của PD-3 (OQ-1..OQ-15), PA-7, PC-6 (a)(b)(c), PD-1, PD-2; hoãn "Ví trả một phần đơn" sang gói riêng sau UAT; chốt OQ-15b (điểm hoàn khi huỷ đơn nhận hạn mới, không kế thừa hạn gốc).

**Phát hành:**
- **GO cho UAT/staging và cho bản thử trên VPS ngay khi chủ dự án ra lệnh deploy.** HEAD sẵn sàng để dựng lên và duyệt bằng mắt.
- **Chưa phát hành cho khách thật** cho tới khi xong các việc chỉ chủ dự án làm được: (1) trỏ DNS Cloudflare `api.tubutree.com` và `app.tubutree.com` về 14.225.207.177, DNS-only; (2) quét QR UAT trên Zalo thật (chưa ai chạy miniapp trong WebView Zalo thật, toàn bộ kiểm thử miniapp ở đây là Playwright WebKit iPhone 12 với API giả); (3) nhập nội dung FAQ/Academy. Hạn 12 tháng của điểm vòng quay, nhiệm vụ, đánh giá đã được chủ dự án đồng ý.

**Các cổng của bản báo cáo đầu tiên nay không còn áp dụng** (vì chưa có số dư xu hay dữ liệu khách thật): đo chi phí làm tròn trên bản sao PROD; cửa sổ deploy và việc miniapp bản test cũ hiển thị sai sau khi BE lên; rollback xu → điểm. Migration quy đổi xu chạy trên DB không có xu là no-op. Giữ nguyên các biện pháp rẻ: sao lưu `pg_dump`, chạy migration thành bước riêng (mục 7).

**Phương án B (đưa C3, PD-1, PD-2 lên trước PD-3)** không còn lý do tồn tại: PD-3 đã được duyệt và kiểm. Bỏ.

## 2. Cổng kỹ thuật (lệnh thật trên mã sau đợt F)

Môi trường: macOS arm64, Node 22.23.3 (jsdom 30 cần Node ≥ 22.22), Postgres 16-alpine trong Docker. Đặt `PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` trước mọi lệnh.

| Hạng mục | Kết quả |
|---|---|
| `tsc --noEmit` api, miniapp, web, e2e | 4 gói thoát 0 |
| ESLint api, miniapp (`tubu-ds`), web, `--max-warnings=0` | 3 gói thoát 0 |
| `npm run lint:vars` (ở thư mục gốc) | "every var(--x) reference is defined" |
| `scripts/uiux/static-scan.mjs` | miniapp: alias legacy 0, rgb 0, hex 5 (hợp lệ); web: palette legacy 0 |
| Migration trên DB trống (`prisma migrate deploy`) | 132/132 áp sạch, `migrate status` "up to date" |
| Drift schema (`migrate diff --exit-code`) | "No difference detected" |
| `prisma/check-partial-indexes.ts` | 20/20 |
| `npx jest` (api) | 190 suite / 3.639 test pass |
| Race suite trên Postgres thật (`--runInBand`) | 69 suite / 495 test pass (các spec mới của PE-1a, PE-3, PE-5, PF-3, PF-5a, PF-6a mỗi cái chạy lặp nhiều lần trong gói của nó, không dao động) |
| `vitest run` miniapp | 206 file / 2.710 test pass |
| `vitest run` web | 63 file / 1.005 test pass |
| Build: `nest build`, `next build`, miniapp `tsc --noEmit && vite build` | cả ba thoát 0 (miniapp cảnh báo chunk > 500 kB, đã có từ trước) |
| Playwright 3 project (Zalo Mini App, Web Admin, API), `--workers=2 --retries=0`, DB dev dựng mới | 138/138 pass (2,1 phút), chạy lại sau đợt G (mã `aa64dc66`) |
| axe (`scripts/uiux/capture.mjs`, 390px, trạng thái normal; đo trên mã `fc55c6b0`, PF-6 chỉ đổi chữ và kiểu ở miniapp nên không đo lại) | miniapp 43 route: 0 vi phạm ở mọi mức, mỗi route đúng 1 `<main>` và 1 `<h1>`; web 36 route: 0 serious/critical; `heading-order` 11 → 0 ở 27 route admin và merchant (đo 1440px sau PG-3, số "trước" lấy từ kết quả cũ); đo lại 390px cả 36 route web (PG-7, dữ liệu mock): 0 vi phạm ở mọi mức, mỗi route đúng 1 `<h1>` và có `<main>` |
| Flash sale 200 user/quota 50 với `connection_limit=20&pool_timeout=30` | 3 vòng: mỗi vòng bán đúng 50, 0 bán quá, 0 lỗi P2028 hay lỗi khác, p95 0,68–1,24 giây; đặt trùng cùng user và cùng `Idempotency-Key` chỉ tạo 1 đơn. Máy lúc đo không bị tranh chấp (không có agent chạy cùng) |

Lưu ý: sau khi gộp schema Prisma phải chạy `npx prisma generate` rồi mới `tsc`/race; lần verify đầu có 13 suite race đỏ chỉ vì client Prisma cũ, đã xác nhận xanh sau khi generate.

## 3. Luồng × kết quả

Cột "Bằng chứng" nêu thứ chạy thật. "Ảnh" là ảnh chụp 390px (miniapp) hoặc 1440px (web) bằng `scripts/uiux/capture.mjs`, lưu cục bộ ở `docs/2026-10-review/screens/` (thư mục bị gitignore; sinh lại bằng lệnh ở mục 10). Capture: miniapp 63 ảnh, web 36 ảnh, không ảnh nào tràn ngang, 0 lỗi chụp sau khi chụp lại trang Cài đặt (lần đầu hết giờ chụp).

| Luồng | Bằng chứng | Kết quả |
|---|---|---|
| Trang chủ, duyệt, tìm kiếm, chi tiết sản phẩm | e2e `buy-flow-4b-browse` 21, `buy-flow-4b` 16, `browse-defaults` 2, `design-system-pilot` 8; ảnh home/browse/product-detail; đo tải browse | Đạt. CPU/request browse giảm ~29% so với trước |
| Giỏ hàng | e2e `buy-flow-4a` 31; ảnh cart; đo tải cart | Đạt |
| Thanh toán (COD, chuyển khoản, Ví, đơn 0đ thành COD, dùng Điểm Xanh hai lô) | e2e `checkout` 6 + `buy-flow-4a`; race `pd3-checkout-points`, `pd3-order-reversal`; vitest web `points-label`; ảnh checkout; đo tải checkout | Đạt. Chưa thử cổng ZaloPay thật (không có khoá) |
| Đơn hàng, huỷ, đổi trả, hoàn tiền | e2e `returns-reversal` 3, `shipping-pancake` 3; race order-reversal 8; ảnh orders/order-detail | Đạt |
| Mua định kỳ (PC-6) | e2e `buy-flow-4b` (tab Định kỳ); jest/race subscriptions | Đạt. Ô chọn ngày chưa kiểm trong WebView Zalo |
| Điểm Xanh, hạng, điểm danh, đổi quà | e2e `loyalty` 6; race `pd3-points-lots`; ảnh loyalty, profile | Đạt (xem mục 6 về hộp xác nhận quỹ cây) |
| Ví, hoa hồng, rút tiền | e2e `wallet` 2; ảnh wallet | Đạt |
| Giới thiệu bạn bè, thưởng, thu hồi | race `referral-order2` 27, `pd3-reward-sources`; vitest wallet (điều kiện thưởng, ẩn với CTV) | Đạt, không có e2e riêng |
| Vườn Xanh, quỹ trồng cây | vitest `game-behavior`, `tree-actions`; race `pd3-tree-lock`, `game-tree-idempotency` (12 ca: bấm đôi, cùng key, key khác, user khác); ảnh game | Đạt. PE-1b chặn bấm đôi ở mọi nút ghi và gửi `Idempotency-Key`; PE-1a làm BE tương ứng. Không có e2e riêng cho Vườn |
| CTV / Affiliate, gian hàng | e2e `affiliate-ctv` 3; ảnh affiliate, storefront-builder, storefront-view | Đạt |
| Đại lý và thưởng đại lý | e2e `dealer-rewards` 3, Web Admin `admin.spec` 2 | Đạt |
| Refill / thu gom (recycling) | e2e `recycling-pickup` 16 | Đạt |
| Hồ sơ, địa chỉ, cài đặt, giới thiệu/hỗ trợ (Q-17) | e2e `features` 2, `miniapp` 2; vitest `about` (hotline/email mặc định khi cấu hình lỗi) | Đạt |
| Admin web: dashboard, đại lý, Hoàn tiền khách (PC-12), analytics | Web Admin 10 ca (gồm 390px không tràn ngang); ảnh web admin-* | Đạt sau khi sửa tràn ngang thanh tab (mục 5) |
| Web khách (thanh toán, đơn hàng, tài khoản) | vitest web 891; `next build`; ảnh web 36 | Đạt ở mức đơn vị và ảnh; KHÔNG có Playwright cho web khách (chỉ có cho admin) |
| API checkout / idempotency / health | e2e API 2; jest 3.256; race 363 | Đạt |
| Đăng nhập, refresh token, throttle | race; đọc mã (xoay vòng + phát hiện dùng lại, `forbidNonWhitelisted`); throttle probe | Đạt (mục 4) |
| Cron, retention, thông báo | jest, race | Đạt, chưa chạy trên dữ liệu PROD |
| Migration trên dữ liệu có sẵn | 132 trên DB trống; 17 migration mới trên DB "bẩn" (reviewer deploy, Postgres 16 thật); 29 migration trên DB 200k đơn | Đạt (mục 4, 5) |

Không kiểm được: Zalo WebView thật, cổng thanh toán ZaloPay, Pancake/GomDon thật, Zalo OA, dữ liệu PROD.

## 4. Tải trước/sau, migration, throttle

Phương pháp: cùng một DB 200.000 đơn, 428.902 dòng hàng, 50.000 user (`tubutree_perf`, dựng từ bản 103 migration của `080bc75`). Bên "trước" chạy API build từ `080bc75`; bên "sau" chạy API HEAD sau khi áp 29 migration lên cùng dữ liệu. Mỗi lượt đo khôi phục lại DB nguyên trạng từ bản sao `tubutree_perf_103`. Đo xen kẽ trước/sau, 2 chu kỳ, mỗi kịch bản 3 lần cố định 16 VU × 12 giây lấy trung vị, rồi tăng dần.

**Giới hạn của phép đo, đọc trước khi dùng số:**
- Máy dùng chung với các dự án khác (load average 9–35 trong lúc đo), nên rps và độ trễ lệch 2–5 lần giữa hai lượt cùng một bên. Vì vậy số kết luận là **CPU của tiến trình API trên mỗi request** (đo bằng `ps cputime`, ổn định giữa các lượt), không phải rps.
- Throttler mới (300 request/phút/route theo userId) chặn chính bộ đo vì mỗi VU là một user bắn liên tục. Bên "sau" chạy với `THROTTLE_BYPASS_TOKEN` (cơ chế có sẵn ở HEAD) và bộ đo gửi `x-throttle-bypass`; bên "trước" không cần. Hành vi throttle được đo riêng bằng probe, không bypass.
- Kịch bản `events` trong bộ đo dùng tên sự kiện không còn nằm trong whitelist (PB-4) nên lần đầu báo 100% lỗi 400; đã sửa bộ đo.

| Kịch bản (CPU ms/request, hai chu kỳ) | Trước | Sau | Đổi |
|---|---|---|---|
| home | 2,03 / 2,00 | 2,02 / 2,08 | +2% (ngang) |
| browse | 2,77 / 2,40 | 1,89 / 1,76 | −29% |
| cart | 3,10 / 2,90 | 3,09 / 2,18 | −12% |
| checkout | 6,16 / 6,91 | 6,68 / 5,44 | −7% (trong biên nhiễu) |
| auth | 1,34 / 1,51 | 1,37 / 1,16 | −11% |
| events | 4,01 / 3,68 | 3,23 / 2,90 | −20% |

Kết luận tải: không thấy hồi quy CPU trên các đường nóng; browse và events nhanh rõ. RSS cuối lượt thấp hơn bên "sau" (180–277 MB so với 267–446 MB). Không có lỗi 5xx hay 429 nào trong các kịch bản chuẩn, trừ ngoại lệ dưới đây.

Các probe riêng:
- **Throttle**: trước, 1 IP gửi 80 request vào `/products` thì 20 bị 429 (giới hạn 60/phút/IP); sau, 80/80 thành công (300/phút/route theo userId). Đã đóng A3-002.
- **`/me/coupons` với 100k coupon, 8 request song song**: trước ~950–1.200 ms mỗi vòng; sau 6–22 ms.
- **Flash sale (200 user cùng mua 1 suất, quota 50)**: cả 12 vòng ở hai bên đều bán đúng 50, không bán quá (so DB: `soldCount`, order items, purchases đều 50); đặt trùng cùng user hoặc cùng Idempotency-Key chỉ tạo 1 đơn. **Ngoại lệ:** một vòng ở bên "sau" (lúc máy đang bị tranh chấp nặng) có 125 request nhận `500 P2028` (Prisma không mở được transaction kịp trong giờ chờ). Không dẫn tới bán quá, nhưng khách thấy 500 thay vì thông báo hết suất. Đã nằm trong C-048/A3-011 (chưa đặt `connection_limit`/`pool_timeout`, cần số vCPU của VPS Vietnix); bằng chứng mới ghi ở đây. Đã đặt `connection_limit=20&pool_timeout=30` cho `DATABASE_URL` của API trong `docker-compose.vietnix.yml` (commit `c7c560cc`); đã đo lại sau đợt F: xem mục 2 (3 vòng sạch, không P2028). Vòng có P2028 trước đây xảy ra lúc máy bị tranh chấp nặng, chưa dựng lại được điều kiện đó nên chưa chứng minh pool 20 là đủ dưới tranh chấp thật.
- **Migration lên 200k đơn**: 29 migration (103 → 132) áp xong trong 3 giây tổng. Lâu nhất là `20261010042435_admin_cron_query_indexes` 0,96 giây (tạo index trên bảng lớn, khoá ghi trong lúc tạo). Số đo cũ ở `03-perf.md` là ~3,7 giây trên máy cũ; VPS Vietnix chậm hơn, dự kiến vài giây, đáng đặt cửa sổ bảo trì ngắn.

## 5. Review độc lập T5 (4 góc, opus) và đã sửa gì

Bốn reviewer độc lập chạy trên toàn bộ diff `cb92dc8..HEAD`, mỗi finding major/blocker bị một reviewer khác cố bác bỏ (không ai bác được). Tổng 18 finding: 0 blocker, 6 major (3 được đánh giá lại thành minor khi phản biện), còn lại minor. Script: `handoff/t5-review.workflow.js`.

Góc "tấn công tiền/auth trên API thật" **không tái hiện được bằng HTTP** (reviewer bị chặn khi dựng API riêng nên chuyển sang đọc mã có trích dòng). Kết quả của góc này là "chứng minh bằng đọc mã", không phải "đã chạy tấn công thật". Phần đã chứng minh: trần điểm theo hai lô, trừ nguyên tử có guard `gte` dưới khoá dòng user, huỷ/trả hai lần song song không hoàn đôi, đơn 0đ ép COD vẫn trả phí ship, mark-paid hai lần chỉ thắng một lần, header `x-throttle-bypass` vô hiệu khi token rỗng, gộp phiên khách không cộng đôi lô, `ValidationPipe` bật `whitelist` và `forbidNonWhitelisted`, refresh token xoay vòng và thu hồi cả họ khi dùng lại (mình tự đọc `main.ts` và `auth.service.ts` để xác nhận hai điều cuối). Độ phủ bằng chạy thật cho các đường này là race suite 363 test.

Đã sửa (có test đỏ → xanh, từng commit, báo cáo `impl/T5-FIX-*.md`):

| Finding | Sửa |
|---|---|
| Migration config `20261012120000` dừng khi `coins.referral_milestones` có số lẻ hoặc quá INTEGER (migration B đã commit, API crash-loop); `seasonpass.tiers` có phần tử không phải object bị biến thành mảng | Mọi phép ép kiểu chỉ chạy khi giá trị hợp lệ, phần tử xấu giữ nguyên; +4 ca race |
| SQL hoàn tác trả xu nhưng để lại thông báo "xu cũ đã thành Điểm Xanh" | Hoàn tác xoá đúng các dòng thông báo do migration chèn |
| Khối "Mời bạn" ở Ví hứa thưởng thiếu điều kiện (đơn thứ hai từ 200.000đ, trong 30 ngày) và hiện cả cho CTV (không bao giờ được thưởng) | Ghi điều kiện lấy từ API, ẩn với CTV |
| Thanh toán web ghi "Dùng 500 Điểm Xanh" trong khi trần 20% chỉ trừ 20 | Hiện đúng số `pointsUsed` và tiền giảm |
| Giá vòng quay ghi cứng 10 Điểm Xanh dù admin chỉnh được | API trả `spinCostPoints`, miniapp đọc |
| Góp quỹ trồng cây trừ 50 Điểm Xanh chỉ với một chạm | Thêm hộp xác nhận, chống bấm đúp |
| Trang Về Tubu Tree mất khối hỗ trợ khi `/config/public` lỗi; trang đơn web nhắc Zalo OA chưa tồn tại | Rơi về hotline/email mặc định Q-17, bấm hotline để gọi; OA chỉ hiện khi có cấu hình |
| Chữ "điểm Xanh" viết thường, "Tick" | Đổi thành "Điểm Xanh", thêm guard từ vựng |
| README, DEMO_SCRIPT còn TubuXu/PanNature/cây thật | Sửa theo hiện trạng sản phẩm |
| (Tự phát hiện ở T3) Thanh tab admin gây cuộn ngang 267px ở 390px khi có huy hiệu `sr-only` | `relative` cho vùng cuộn; e2e 390px xanh |
| (Tự phát hiện ở verify) Mock e2e Ví còn `coinsBalance`/`xuConvertMultiplier` sau PD-3 | Bỏ hai trường |

Các sửa migration làm đổi checksum của `20261012120000`. Vì PROD chưa áp (đang ở `cb92dc8`) nên không ảnh hưởng PROD; DB dev đã áp bản cũ phải dựng lại.

## 5b. Đợt E sau duyệt của chủ dự án (PE-1a..PE-5)

Mỗi gói làm trong worktree riêng, TDD, review opus độc lập (PE-1a, PE-3, PE-5 hai lượt vì đụng điểm), tôi merge và chạy lại toàn bộ mục 2. Báo cáo gốc `impl/PE-*.md`, script `handoff/wave-e1..e3.workflow.js`.

| Gói | Việc | Review |
|---|---|---|
| PE-1a | `POST /game/tree/buy` nhận `Idempotency-Key` (mã chứng nhận suy ra tất định từ user + key, kiểm "đã góp chưa" trong transaction sau khoá dòng user): gọi lại cùng key trả đúng kết quả cũ, không trừ thêm; 8 request song song đã từng ra 8 cây, nay ra 1. Điểm hoàn `ORDER_REFUND_POINTS` có hạn `loyalty.point_expire_months`. Sửa thêm lỗi cũ của cron hết hạn (trừ hai lần khi trước lô hết hạn có lô không hạn) | APPROVE hai lượt, chỉ còn minor |
| PE-1b | Miniapp: chặn chạm đúp ở mọi nút ghi của trang Vườn; hộp xác nhận góp quỹ cây gửi `Idempotency-Key` (giữ khi thử lại, đổi khi mở lại); sửa cảnh báo `key` trùng ở bảng xếp hạng tuần | APPROVE |
| PE-2 | Gỡ 4 route `/beta/*` và module Beta (giữ bảng `BetaFeedback`); nhãn CO₂: HEAD đã không còn chữ CO₂ nào ở thẻ Tác động xanh (PD-1 bỏ hẳn ô này, mạnh hơn "ước tính"), thêm guard | APPROVE |
| PE-3 | Điểm thưởng vòng quay, nhiệm vụ, đánh giá có hạn như điểm thưởng khác; test chốt chặn tĩnh buộc mọi dòng cộng điểm có `expiresAt` hoặc nằm trong ngoại lệ có lý do. Review lượt 1 tìm ra lỗi do chính gói gây ra (xoá đánh giá còn hạn làm trừ hai lần); đã sửa | lượt 1 CHANGES (1 major), lượt 2 APPROVE |
| PE-4 | Dọn tham chiếu `/beta` ở script audit/uiux; bảng route của `endpoint-inventory.spec.ts` dựng từ đồ thị AppModule nên mục REMOVED có tác dụng thật | APPROVE |
| PE-5 | Dòng thu hồi của huỷ/trả đơn và thưởng giới thiệu ăn đúng lô gốc khi cron tính hạn. Lỗi đã **chứng minh bằng race Postgres thật trước khi sửa**: lô cũ 30 + đơn giao 20, huỷ đơn, cron sau hạn ra số dư 10 thay vì 30; trả đơn 40 điểm bị trừ 60; thu hồi thưởng giới thiệu trừ thêm 5, 15, 30. 8/10 ca đỏ trước, xanh sau, đột biến bị bắt. Công thức hạn của điểm đơn giao dùng chung `pointsExpiryFrom` (cấu hình 0/âm/hỏng rơi về 12 tháng) | APPROVE hai lượt |

Tác động hồi tố của PE-3 và PE-5 lên sổ điểm đã ghi trước khi deploy (không có dữ liệu thật thì bỏ qua): replay mới đổi nghĩa của dòng thu hồi cũ, nên ngay lượt cron 1 giờ sáng đầu tiên một số khách có thể bị trừ sớm phần điểm đáng ra hết hạn muộn hơn, không có nhắc trước. Số dư cuối cùng không đổi so với bản cũ. SQL đếm và khuyến nghị đo từng user nằm ở `impl/PE-5.md` mục 3; nếu VPS có dữ liệu thật thì chạy SQL (2) và so hai bản `computePointExpiry` trước khi deploy.

## 5c. Đợt F: sửa các bug còn lại sau đợt E (PF-1..PF-6b)

Chủ dự án yêu cầu "xử luôn các bug chưa sửa". Mỗi gói làm trong worktree riêng, TDD, review opus độc lập (PF-3 và PF-5a đụng điểm nên hai lượt), tôi merge và chạy lại toàn bộ mục 2. Báo cáo gốc `impl/PF-*.md`, script `handoff/wave-f1..f3.workflow.js`, script kiểm chứng tổng `handoff/verify-full.sh`.

| Gói | Việc | Review |
|---|---|---|
| PF-1 | Miniapp a11y: hết `nested-interactive` (checkout, orders, feed), `scrollable-region-focusable` (brand-view, product-detail), `target-size` (brand-story); mỗi route đúng một `<main>` và một `<h1>` (C-114); hai mục khác (hàng địa chỉ, tên "Giờ" trùng) kiểm trên mã thấy không phải lỗi; ngày ở thẻ đơn và sheet Mã giảm giá dùng `formatDate` | APPROVE, 4 minor |
| PF-2 | Miniapp hành vi: Home không còn chớp khối lỗi/khung chờ khi tải lại nền; kệ "Mua lại" không biến mất khi làm mới lỗi; chip Danh mục không làm lệch ô tìm; `formatVnd` không che giá thiếu thành "0đ"; ngày dd/MM/yyyy ở mọi chỗ (có guard); lưới Ví và Danh mục hết key trùng khi dữ liệu đổi giữa hai trang; `/search/suggest` từ 1 ký tự | APPROVE, 2 minor |
| PF-3 | API điểm: `reverseOrderPoints` khoá dòng user (cron chen vào từng trừ 40 cho lô 20) và chỉ thu hồi phần còn lại của lô, không để số dư âm; xoá đánh giá không còn làm số dư âm; thưởng đánh giá chỉ nhận một lần cho mỗi (khách, sản phẩm); biên `loyalty.point_expire_months` 1–120; `route-graph.ts` khỏi `dist`; guard `/beta` không đọc thư mục sinh ra. Review lượt 1 chặn hai blocker (farm điểm đánh giá bằng vòng tạo/tiêu/xoá; lô khác bị coi là đã tiêu), đã sửa | lượt 1 CHANGES (2 blocker), lượt 2 APPROVE |
| PF-4 | Web: axe serious/critical về 0 (select-name, label, target-size, vùng cuộn, thiếu h1/main); PC-7: link Content Kit `/product/<slug>` không còn 404 (redirect), ô tìm kiếm trên host CTV hết nháy, khung "Đã nhận thanh toán" không biến mất; PC-9: "Mã giảm giá", không còn chữ TubuXu/xu, ngày qua helper | APPROVE, 3 minor |
| PF-5a | Lỗi thật do review lượt 2 của PF-3 tìm ra: vòng quay không chặn `lockedOrderPoints`, nên khách quay hết điểm của đơn còn trong cửa sổ đổi trả rồi trả hàng vẫn giữ điểm. Sửa `spin()` (khoá dòng user, chỉ tiêu phần dùng được). Đã **chứng minh bằng race Postgres thật trước khi sửa** (9/12 ca đỏ trước, 12/12 xanh sau, đột biến bị bắt) | lượt 1 CHANGES (1 major về câu chữ comment), lượt 2 APPROVE |
| PF-5b | Minor còn lại: `<h1>` ở mọi trạng thái của chi tiết sản phẩm; chấm chọn không tên là thuần hình (sửa test giả xanh và thêm guard tĩnh); tương phản nút ở chi tiết đơn đạt 4,5:1; chỉ báo "Đã cộng Điểm Xanh" khi thật sự có điểm; `useBlockQuery` nhớ lỗi theo từng lần mount; link Content Kit sinh đúng ở nơi sinh; guard ngày của web phủ rộng hơn | APPROVE, 4 minor |
| PF-6a | Nợ API điểm do review PF-5a ghi lại: `lockedOrderPoints` đọc `returns.window_days` NGOÀI transaction ở cả bốn đường tiêu (checkout, đổi quà, góp quỹ cây, vòng quay; cache cấu hình hết hạn không còn lấy thêm kết nối pool lúc đang giữ khoá dòng user; race Postgres đếm phiên "idle in transaction", đỏ 7/8 trước, xanh 8/8 sau; kiểu TypeScript bắt buộc truyền `windowDays` khi truyền `db`); vòng quay trúng giải SEEDS cũng đọc trần bình nước ngoài tx; giải vòng quay có thưởng điểm âm (admin ghi được vì `game.spin_prizes` chưa có luật) bị chặn ở lúc ghi cấu hình và lọc lúc đọc, nên `creditPoints` không còn trừ điểm khách | lượt 1 APPROVE (3 minor), lượt 2 APPROVE (3 minor) |
| PF-6b | Miniapp: `createReview` khai `pointsEarned` và `updated` (bỏ kiểu bù cục bộ); câu gợi ý điểm trước khi gửi đánh giá nêu rõ "lần đầu đánh giá sản phẩm này", không hứa điểm vô điều kiện | APPROVE, 1 minor |

### Đợt G (PG-1): rà finding của night agent trên mã hiện tại

Night agent để lại 28 finding. Mình đối chiếu từng nhóm với mã ở `d5acbafa` thay vì tin số dòng. Đã xử lý từ trước hoặc không phải lỗi: gợi ý tìm kiếm `catalog/search/suggest` (đã có `SuggestQuery` giới hạn độ dài), webhook cashback (provider kiểm token bằng `timingSafeEqual` và `parseWebhook` kiểm kiểu số tiền), `acquireLocationPayload` (máy chủ trả 400 "Không lấy được vị trí", nhịp heartbeat lỗi không được tính là ngoài vùng), `ensurePhone().catch` ở checkout (cố ý, có chú thích), sao chép link ở share-sheet (đã báo lỗi cho khách). Lỗi thật và đã sửa: `GET /feed?kind=…` ngoài enum hoặc query lặp (mảng) trả 500 vì Prisma ném validation error, nay trả 400 qua `FeedQuery`; `GET /storefront/by-host?host=a&host=b` gọi `.split` trên mảng trả 500, nay trả 400. Miniapp không gửi `kind` tới `/feed` nên không bị ảnh hưởng. Báo cáo chi tiết ở `impl/PG-1.md`, gồm 8 chỗ nghi vấn cùng lớp lỗi chưa xác minh (cursor mảng ở comment của sự kiện và đăng ký định kỳ, `provinceCode` mảng, tham số `from/to/year/month` của payroll, `days` của analytics), phần nằm trong module tiền hoặc nhân sự nên chưa sửa. Không sửa nhóm trùng lặp, N+1 trong cron, `findMany` không `take`, mã chết: chưa có khách và dữ liệu nên rủi ro đổi lớn hơn lợi.

Đợt G tiếp (PG-2, PG-3, PG-4, gộp ở `a2977383` sau review opus độc lập, mỗi gói có ít nhất một lượt, riêng PG-2 hai lượt vì chạm module tiền và lương):

- PG-2 xác minh bằng Postgres thật tám chỗ nghi vấn của PG-1. Sáu chỗ là 500 thật và đã thành 400 bằng DTO kiểm đầu vào: `feed/events/:id/posts` và `feed/:id/comments` (`take` không phải số, `cursor` mảng), `me/subscriptions` (cursor mảng), `affiliate/links` (cursor mảng), `admin/cashback/transactions` (`status` ngoài enum, `take`), và ngày/năm/tháng cực đoan ở lịch ca, chấm công, lương (năm ngoài 2000..2100 bị chặn). Hai chỗ không phải 500: `geo/communes` (mảng đi tới Pancake, không qua Prisma; còn một điểm rò bộ nhớ chậm vì khoá cache là chính mảng đó, chưa sửa) và `analytics retention-daily` (`days` đã được kẹp). Hệ quả đã biết: `take` ở affiliate và subscriptions nay chặt hơn (`?take=abc` trước trả 200, nay 400); tham số lạ như `_t=1` ở các endpoint staff bị 400 do `forbidNonWhitelisted`. Không client trong repo gửi các giá trị này. Không đổi service hay quyền.
- PG-3: hết `heading-order` ở web admin và cổng đối tác (đổi h3 thành h2, giữ nguyên kiểu), và ghim bản đồ `/brand-story` không còn chồng nhau (hàm thuần `pinBoxes` có test).
- PG-4: cờ `rewardAvailable` của `can-review` và dòng giải thích khi hết thưởng (xem mục 6).

Tác động của PF-5a lên khách: nút Quay hiện lỗi 400 "Cần N Điểm Xanh để quay" kèm câu giải thích phần điểm chưa dùng được khi số dư toàn là điểm đơn còn trong hạn đổi trả (thông báo đi qua `getErrorMessage`, chưa xem được trên snackbar thật). Điểm chốt hành vi mới của PF-3: xoá đánh giá rồi tạo lại **không còn được thưởng lại** (kể cả khi điểm đã hết hạn); đây là chặn farm điểm, mặc định đã duyệt, chủ dự án phản đối thì đổi ở `reviews.service.ts`.

## 6. Bug và rủi ro còn mở

- Đã xử lý ở đợt G cuối: `geo/communes` nay đối chiếu `provinceCode` với danh sách tỉnh nên số ô cache bị chặn bằng số tỉnh (trước đó mảng/object và chuỗi tuỳ ý đều thành ô cache giữ 24 giờ). Hàm danh sách của web (`getProducts`, `getBrands`, `getStorefrontList`) ném `ApiUnavailableError` lúc runtime thay vì trả `[]` (PG-6): lúc `next build` vẫn trả `[]`; sitemap không còn nuốt lỗi. Đánh đổi cần biết: trang chủ web là route động, nên khi API lỗi và chưa có bản cache thì khách thấy trang lỗi "Có chút trục trặc" kèm nút Thử lại thay vì trang chủ với danh sách rỗng; crawler nhận 500 thay vì 200 rỗng. Việc Next giữ bản cũ khi tái tạo ISR lỗi dựa vào tài liệu Next 14, chưa chạy thử với API lúc sống lúc chết.
**Cần chủ dự án xác nhận hoặc làm (không phải lỗi mã):**
- Trỏ DNS Cloudflare, quét QR UAT trên Zalo thật, nhập FAQ/Academy (mục 1). Từng bước UAT có kỳ vọng nằm ở `UAT-ZALO.md`.
- Hạn 12 tháng cho điểm vòng quay, nhiệm vụ, đánh giá (PE-3): chủ dự án đã đồng ý giữ có hạn (2026-10-11).
- PA-1 yêu cầu 5 (đơn CTV lên hộ ghi `userId` là khách cuối): hoãn sang sau UAT theo quyết định của chủ dự án; không có lỗi tiền đang mở. Ô chọn ngày của gói định kỳ chỉ kiểm được trên Zalo thật.
- "Ví trả một phần đơn" (Q-03 phương án 1) hoãn: Ví chỉ trả trọn đơn, thiếu thì báo 400 và khách chọn COD/chuyển khoản.

**Rủi ro cần biết khi lên VPS (không chặn mã):**

| Mục | Mô tả | Giảm thiểu |
|---|---|---|
| Migration dừng giữa chừng | `Dockerfile:39` chạy `prisma migrate deploy && node dist/main.js` với `restart: unless-stopped`: khi một migration fail, cả image mới lẫn image cũ crash-loop với P3009 tới khi chạy `migrate resolve --rolled-back` (tái hiện thật). Migration B (xu → điểm) cố ý RAISE nếu sổ xu lệch, số dư âm hoặc tỉ giá khác 1000 | Chạy migration thành bước riêng trước `up -d` (mục 7). Với DB không có xu, B là no-op |
| Web cũ chạm BE mới | Web cũ gửi `pointsToUse` chỉ theo lô thường; BE mới có thể lấy phần vượt trần từ lô quy đổi mà web cũ không hiển thị | Chỉ xảy ra nếu có số dư xu thật; vẫn deploy BE và web liền nhau |
| Hoàn điểm lô thường khi huỷ/trả chạy ở transaction riêng sau commit | Tiến trình chết đúng khoảnh khắc đó thì khách mất phần điểm thường được hoàn. Có từ trước PD-3. `reverseOrderPoints` cũng vẫn trừ khi lô gốc đã hết hạn và không khoá dòng user (PE-5 ghi nhận, chưa sửa) | Đối soát điểm theo lô (`reconcile-points`) sau deploy |
| Hạn điểm hoàn khi huỷ đơn (OQ-15b, đã chốt giữ) | Điểm hoàn nhận hạn mới 12 tháng, nên đặt-huỷ lặp lại kéo dài hạn của điểm sắp hết; mỗi vòng cần một đơn thật, trần dùng 20%/đơn | Theo dõi; nếu lạm dụng, làm gói riêng cho dòng hoàn kế thừa `min(hạn gốc, now + N tháng)` (phương án 2 ở `impl/PE-1a.md`) |
| Đánh giá | Tạo, chờ 12 tháng, xoá, tạo lại được 5–15 điểm/sản phẩm/năm (PE-3, đã nêu) | Chấp nhận |
| `loyalty.point_expire_months` không có biên | Cấu hình 0 hoặc âm nay rơi về 12 tháng ở điểm đơn giao, nhưng khoá chưa có RANGES | Thêm biên ở `system-config.service.ts` khi rảnh |
| `CREATE INDEX` khoá ghi vài giây | Mục 4 | Cửa sổ bảo trì ngắn nếu DB đã có dữ liệu |
| P2028 khi tải bùng nổ | Mục 4, C-048. Đã đặt `connection_limit=20&pool_timeout=30`; đo lại sau đợt F trên máy rảnh: 3 vòng sạch. Chưa dựng lại điều kiện tranh chấp nặng đã từng gây P2028 | Giữ 1 instance; đo lại flash sale khi có staging |
| Cấu hình mới PC-9 (chấm công ngoài vùng N=3, M=15) | VPS không chạy seed. Reviewer kiểm 205 lượt `config.get`: không lượt nào thiếu giá trị mặc định trong mã | Không cần làm gì |
| PC-6, PA-7, PD-1, PD-2 | Chủ dự án đã duyệt mặc định: giữ giảm giá đơn đầu kể cả khi huỷ gói (theo dõi `subscription_changed`); ví thiếu thì PAUSED và bỏ kỳ lỡ; voucher đơn thứ hai 30.000đ cho đơn từ 199.000đ (chỉnh trong SystemConfig nếu biên lãi không chịu được); mỗi người được mời chỉ thưởng người mời một lần; giữ nguyên 25 khoá cấu hình chết, 3 endpoint admin, ZaloPay, `/storefront/by-host`, `DELETE /reviews/:id` | Theo dõi sau phát hành |
| Quỹ cây | Tubu cam kết 50.000đ mỗi lượt góp, có thể trừ vào điểm thưởng miễn phí (OQ-5, đã duyệt). BE đã chống bấm đôi bằng `Idempotency-Key` (PE-1a) và FE đã gửi key (PE-1b) | Theo dõi ngân sách quỹ |
| Cộng đồng (OQ-6) | 1 điểm = 1.000đ nên dễ bị farm bằng nick phụ; có trần ngày, hạn 12 tháng, trần dùng 20% | Theo dõi tuần đầu |

**Bug nhỏ và nợ kỹ thuật (không chặn):**
- a11y: axe serious/critical đã về 0 trên ảnh chụp miniapp (43 route) và web (36 route), trạng thái normal ở 390px. Chưa quét trạng thái loading/lỗi/rỗng, viewport khác, VoiceOver/TalkBack và WebView Zalo thật (WebView không hỗ trợ `inert` thì chấm Checkbox/Radio ở checkout có thể vẫn nhận chạm riêng; hàng cha vẫn bấm được). Web hết `heading-order` ở 27 route admin/merchant sau PG-3 (đã đo lại 390px cả 36 route ở PG-7, 0 vi phạm). Ghim bản đồ brand-story đã tách nhãn trái/phải và dịch vị trí (PG-3), còn ghim Pơ Lang che một phần chữ "Khánh Hòa"/"Lâm Đồng" vẽ sẵn trong SVG; kiểm tra chồng nhau dùng ước lượng độ rộng nhãn, khung hẹp hơn 328px chưa thử.
- Cảnh báo React trùng `key` từng thấy trong bộ chụp ở game, loyalty, about, admin (miniapp) và admin-config (web) không phải lỗi app: `scripts/uiux/lib/fabricate.mjs` giả mọi phần tử của một danh sách cùng một giá trị (cùng số điện thoại, cùng chữ "Nội dung mẫu", `day`/`rank` lặp), còn dữ liệu thật có khoá duy nhất (`rank = i + 1` ở API, khoá cấu hình là khoá chính). Đã sửa bộ giả cho giá trị khác nhau theo thứ tự; chạy lại 5 route, 0 cảnh báo.
- Bộ chụp `scripts/uiux` không giả `GET /home` và `GET /home/me`: trả 404 nên Home tự lùi về các request lẻ (đúng đường dự phòng của `home-feed.ts`, các request lẻ có mock), vì vậy ảnh Home vẫn đủ nội dung nhưng đường request gộp chưa được chụp; 404 ở console là của bộ chụp. Route Cài đặt hay hết giờ chụp ảnh.
- Điểm thu hồi và vòng quay: thu hồi đánh giá và thu hồi thưởng giới thiệu bị chặn theo số dư chứ không theo phần dùng được. Khách đã tiêu điểm của lô bị thu hồi thì phần hụt nằm ở dòng `ORDER_REVERSED` ngắn hơn (khách giữ giá trị đó), đúng chính sách PF-3 "điểm đã tiêu không đòi lại".
- Trần giải POINTS của vòng quay: đã chốt 100 Điểm Xanh mỗi giải (`SPIN_POINTS_PRIZE_MAX`), luật ghi và lọc lúc đọc dùng chung; giải đã lưu vượt trần bị bỏ khỏi vòng quay kèm log cảnh báo. Seed (tối đa 50) không bị ảnh hưởng. Lưu ý riêng: `game.spin_prizes` trong seed không phải `createOnly`, nên chạy lại seed trên môi trường đã chỉnh sẽ ghi đè bảng giải do admin sửa.
- Seed chặn ở production (PG-2): `prisma/seed.ts` nay thoát với lỗi khi `NODE_ENV=production` trừ khi đặt `ALLOW_PROD_SEED=1`. Trước đây việc "prod không chạy seed" chỉ nằm trong tài liệu và chú thích migration, trong khi seed ghi đè sản phẩm, hạng và hơn 50 khoá cấu hình không `createOnly` (gồm `payment.bank_account_no`, `payment.bank_account_name` và `game.spin_prizes`). Lần đầu dựng DB mới trên VPS mà cần seed thì đặt cờ đó có chủ đích. Bước deploy ở mục 7 không gọi seed nên không bị ảnh hưởng.
- Nhỏ, không chặn: `checkout.service.ts` điều kiện trừ điểm nay dựa vào `windowDays !== null` thay cho `usedStandard > 0` (tương đương hiện tại, nên giữ cả hai điều kiện nếu sửa); kiểu TypeScript của `lockedOrderPoints` chỉ chặn "truyền `db` mà thiếu `windowDays`", vị trí đọc cấu hình của đường chi tiêu mới vẫn phải theo mẫu race `pf6-locked-window-outside-tx`.
- Link chia sẻ Content Kit: `shareLink` của API dùng chung cho đường Zalo và liên kết web; chưa thử dán `app.tubutree.com/san-pham/<slug>?ref=...` trên Zalo thật. Câu gợi ý điểm đánh giá nay nêu "lần đầu" (PF-6b) và PG-4 đã cho `can-review` trả cờ `rewardAvailable`: khách đã nhận thưởng không còn thấy lời hứa +5/+10/+15 mà thấy dòng "Bạn đã nhận Điểm Xanh cho đánh giá sản phẩm này trước đó.". Cờ đọc ngoài transaction chỉ để hiển thị, máy chủ vẫn quyết định thưởng lúc tạo.
- `apps/api/src/common/route-graph.ts` chỉ dùng cho test nhưng bị `nest build` đưa vào `dist`; `beta-removed-audit.spec.ts` đọc file ngoài package nên cache turbo có thể bỏ qua khi chỉ sửa `scripts/`.
- Hai tiền tố thưởng mốc giới thiệu nay import từ `referral-reward.ts` (PE-5); các nơi khác trùng hằng số thì chưa rà.
- Không có Playwright cho web khách; không có e2e riêng cho Vườn, Giới thiệu.
- Các minor cũ của PC-2, PC-7, PC-9 và danh sách ở `HANDOFF.md` mục 6.

## 7. Checklist deploy (khi có lệnh của chủ dự án): BE → web → miniapp

Quy trình `cb92dc8` đã dùng: `git bundle` lên VPS, `pg_dump` backup trước, `git merge --ff-only`, `docker compose -f docker-compose.vietnix.yml up -d --build`, migrate, smoke test. Không đụng root `tubutree.com` (chung VPS với ChoDeli/WordPress).

**7.1 Trước deploy (chủ dự án)**
1. Có đủ các việc ở mục 1 (DNS, QR UAT khi chuẩn bị phát hành cho khách).
2. `pg_dump` DB trên VPS ra nơi an toàn.
3. Kiểm xem VPS có dữ liệu khách thật hay không (`select count(*) from users where "coinsBalance" > 0`, số đơn, số user thật). Không có: bỏ qua bước 4. Có: dừng lại và báo, vì các cổng đã bỏ ở mục 1 phải bật lại.
4. (Chỉ khi có dữ liệu thật) Trên bản sao: chạy `pd3_measure_before_deploy.sql` (a)–(j), kỳ vọng các truy vấn kiểm lệch bằng 0, `loyalty.vnd_per_point_redeem` là số `1000`; chạy SQL (2) của `impl/PE-5.md` mục 3.

**7.2 Deploy**
1. Đưa mã lên VPS (`git bundle`, `git merge --ff-only`).
2. **Chạy migration thành bước riêng**: `docker compose -f docker-compose.vietnix.yml run --rm --no-deps api pnpm exec prisma migrate deploy`. Lỗi thì dừng ở đây; container cũ vẫn đang chạy.
3. `docker compose -f docker-compose.vietnix.yml up -d --build` cho API rồi web, cách nhau không quá vài phút.
4. Smoke test: `/api/health`, `/api/config/public` (có hotline/email), đăng nhập, `POST /checkout/quote` có điểm hai lô, `GET /admin/customer-refunds`, log khởi động của các cron.
5. Miniapp: `zmp deploy -t -e` lên kênh test, quét QR UAT trên Zalo thật. Chỉ nộp production sau UAT.

**7.3 Theo dõi 7 ngày sau deploy**: truy vấn ở `PD-3-SPEC.md` mục 10 (số đơn dùng lô quy đổi, đơn 0đ, drift điểm theo lô bằng `reconcile-points`).

**7.4 Tác động lên khách trong cửa sổ deploy**: với giả định chưa có khách thật thì không có. Nếu có: miniapp bản test cũ lỗi/hiển thị sai (trang `/storefront` của CTV, Ví không thấy điểm quy đổi, nút mua cây báo "−50 xu"); web cũ không hiện lô quy đổi cho tới khi web mới lên. Phiên đăng nhập không bị đổi: reviewer đối chiếu `git diff cb92dc8..HEAD` thấy không có thay đổi nào ở JWT, cookie `tubu_rt`, khoá lưu token, thuật toán hay migration của `refresh_tokens`. `HANDOFF.md` mục 7 vẫn ghi deploy web có thể đăng xuất mọi phiên một lần do cookie refresh HttpOnly; coi đó là khả năng nhỏ (ví dụ khi đổi host API sang `api.tubutree.com` thì cookie theo host cũ không còn gửi tới), không phải hệ quả của mã trong diff này.

## 8. Rollback

- **Migration dừng giữa chừng**: lấy tên migration lỗi bằng `SELECT migration_name, finished_at, logs FROM _prisma_migrations WHERE finished_at IS NULL`, rồi `pnpm exec prisma migrate resolve --rolled-back <tên>`; sửa dữ liệu gây lỗi; chạy lại bước migrate. Lưu ý migration B (xu → điểm) đã commit trước khi migration config lỗi: `resolve` chỉ đánh dấu migration lỗi, không hoàn tác B. Chi tiết: `impl/PD-3-SPEC.md` mục 10.
- **Quay image cũ sau deploy thành công**: image cũ chạy `migrate deploy` trên DB đã áp đủ HEAD báo "No pending migrations", không kẹt (đã chạy thật).
- **Hoàn tác quy đổi xu → điểm**: `psql -v ON_ERROR_STOP=1 -1 -f apps/api/prisma/manual/pd3_xu_to_points_rollback.sql`, chạy được hai lần, trả đúng xu, xoá các thông báo XU_CONVERTED, gỡ ràng buộc `users_coins_frozen`. Từ chối (RAISE) nếu đã có đơn tiêu lô quy đổi hoặc có khoản cộng vào lô quy đổi ngoài dòng quy đổi gốc (gộp phiên khách, hoàn đơn XU, thu hồi giới thiệu); khi đó phải xử lý tay. Sau hoàn tác phải quay image và miniapp/web về bản trước PD-3.
- **Cảnh báo**: khi image trước PD-3 chạy lại sau hoàn tác, cron hết hạn của code cũ duyệt FIFO mọi dòng sổ không lọc lô; kiểm điểm thường sau vài ngày.

## 9. Môi trường và dọn dẹp (ghi lại để chủ dự án biết)

- Docker Desktop hết chỗ (ổ ảo 39 GB đầy 100%, Postgres `tubu_pg` crash-loop `No space left on device`) giữa lượt đo tải. Theo đồng ý của chủ dự án, đã chạy `docker volume prune` xoá 560 volume ẩn danh không gắn container (tạo từ 02/10, ~35 GB). Volume có tên (`tubu_pg_data`, `tubu_redis_data`) và container đang chạy không bị đụng. Nguyên nhân gốc: container Postgres tạm của race test bị `docker rm` mà không có `-v` nên volume ẩn danh còn lại. Các agent đã được dặn dùng `--rm --tmpfs`.
- Sau đợt F, theo đồng ý của chủ dự án (2026-10-12), đã dọn: 27 worktree `.claude/worktrees/hz*-*` (đều sạch, 0 commit chưa merge; xoá không `--force`), container `tubu_it_main`, `tubu_it_pd2`, `tubu_it_pd3` (`docker rm -f -v`), 107 volume Docker ẩn danh (~6,8 GB). Volume có tên `tubutree-mini-app_tubu_pg_data` và `tubutree-mini-app_tubu_redis_data` không bị đụng. Các nhánh `hz*/…` vẫn còn (đã merge hết, xoá bằng `git branch -d` khi muốn).
- Sau đợt G cuối (2026-10-12): đã gỡ 13 worktree `hz18`..`hz21` còn lại và xoá 34 nhánh `hz*` đã merge bằng `git branch -d`; chỉ còn `hardening/2026-10` và `main` ở máy này (nhánh trên origin không đụng). DB `tubutree_perf` (207.668 đơn, 1,2 GB) và `tubutree_perf_103` (200.000 đơn, 929 MB), dữ liệu tổng hợp của bài đo tải, đã không còn trong `tubu_pg` (kiểm bằng `pg_database` ngày 2026-10-12, chỉ còn `postgres`, `template0`, `template1`, `tubutree`). Muốn đo tải lại thì dựng lại theo `03-perf.md` mục 6. Thư mục `scripts/loadtest/results/` (12 MB, gitignore) giữ lại vì báo cáo mục 4 dẫn số đo từ đó. Muốn chạy lại race suite thì dựng container mới bằng lệnh ở mục 10.
- Việc cũ: README, DEMO_SCRIPT đã sửa ở T5; `scripts/loadtest/node_modules` cài bằng `npm ci` (không thuộc workspace pnpm).

## 10. Phụ lục: lệnh tái hiện

```bash
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
pnpm install && pnpm --filter @tubutree/shared-types build
cd apps/api && npx prisma generate
docker run -d --rm --name tubu_it_main --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p 5550:5432 postgres:16-alpine
export DATABASE_URL="postgresql://tubu:tubu@localhost:5550/tubutree_it?schema=public"
npx prisma migrate deploy                                  # 132
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
npx tsx prisma/check-partial-indexes.ts                    # 20/20
npx jest && npx jest -c test/integration-race/jest.config.js --runInBand
(cd ../miniapp && npx tsc --noEmit && npx vitest run && npx eslint "src/**/*.{ts,tsx}" --max-warnings=0)
(cd ../web && npx tsc --noEmit && npx vitest run && npx next build)
(cd ../e2e && npx tsc --noEmit -p tsconfig.json && npx playwright test --workers=2 --retries=0)   # cần Postgres dev 5434 đã migrate + seed
npm run lint:vars && node scripts/uiux/static-scan.mjs
# ảnh chụp (cần API 3001, miniapp 3113, web 3112 đang chạy)
node scripts/uiux/capture.mjs miniapp --vp 390 --states normal
node scripts/uiux/capture.mjs web --vp 1440 --states normal
# tải trước/sau: xem scripts/loadtest (start-api.sh nhận API_DIR, PERF_DB; PERF_BYPASS + THROTTLE_BYPASS_TOKEN để vượt throttler)
```

Báo cáo từng gói: `impl/*.md`. Quyết định chủ dự án: `00-ROADMAP.md` mục 9. Script workflow: `handoff/*.workflow.js`.
