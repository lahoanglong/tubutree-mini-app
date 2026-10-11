# 99 — Đánh giá sẵn sàng phát hành (ghi ngày 2026-10-11)

Bản được đánh giá: nhánh `hardening/2026-10`, HEAD `c46fe6a6` (cộng các commit tài liệu ghi sau báo cáo này). PROD đang chạy `cb92dc8` (Đợt A+B). Phạm vi diff so với PROD: 683 file, +66.509/−13.917 dòng, 17 migration mới (115 → 132). Chưa push, chưa deploy, chưa ghi vào PROD hay DB dùng chung ở bất kỳ bước nào.

## 1. Kết luận

**Cổng kỹ thuật: ĐẠT.** Không còn lỗi kỹ thuật nào chặn phát hành mà mình biết. Mọi lệnh trong mục 2 đã chạy lại trên HEAD, không dựa vào lời báo của agent.

**Quyết định phát hành lên PROD: NO-GO cho tới khi chủ dự án đóng 5 cổng dưới đây.** Đây không phải lỗi mã mà là những việc chỉ chủ dự án làm được hoặc cần quyết:

1. Duyệt (hoặc chỉnh) các câu hỏi mở OQ-1..OQ-16 của PD-3, nhất là OQ-1, 2, 5, 6, 9, 14 (thưởng mới thành điểm thường hết hạn và có trần 20%, điểm không trừ phí ship, góp quỹ cây 50 điểm có thể lấy từ phần tiền trả trước, thu hồi thưởng giới thiệu). Quyết định có làm "Ví trả một phần đơn" (Q-03 phương án 1) hay hoãn sang gói riêng: hiện Ví chỉ trả trọn đơn, thiếu thì báo 400.
2. Chạy `apps/api/prisma/manual/pd3_measure_before_deploy.sql` trên bản sao PROD và điền số vào `impl/PD-3.md` (chi phí làm tròn lên của Điểm Xanh, cấu hình `loyalty.vnd_per_point_redeem` phải là số 1000, các khoá JSON cấu hình). Máy này không được đụng PROD nên đây là cổng mở duy nhất của Q-03a.
3. Hạ tầng: Cloudflare trỏ `api.tubutree.com` và `app.tubutree.com` về 14.225.207.177 (hiện còn IP GCP đã chết), DNS-only.
4. Chọn cửa sổ deploy và chấp nhận các tác động lên miniapp bản test cũ (mục 7.4). Miniapp mới phải lên kênh test Zalo cùng đợt với BE.
5. Quét QR UAT trên Zalo thật. Chưa ai chạy miniapp trong WebView Zalo thật: toàn bộ kiểm thử miniapp ở đây là Playwright WebKit iPhone 12 với API giả.

**GO ngay cho UAT/staging**: HEAD sẵn sàng để dựng lên môi trường thử và cho chủ dự án duyệt bằng mắt.

**Phương án B (nếu muốn đưa C3, PD-1, PD-2 lên trước khi quyết xong PD-3):** commit `bf127ac3` (ngay trước khi gộp PD-3, đã gồm sửa e2e, sửa thanh tab admin, công cụ đo tải). Tại commit đó mình chưa chạy lại toàn bộ bộ kiểm; mức đã kiểm là mốc verify của D1 (jest 3132, race 290, vitest miniapp 2480, web 864, 125 migration, drift 0) cộng Playwright miniapp 121/121 và Web Admin 10/10. Nếu chọn phương án này phải chạy lại mục 2 trên `bf127ac3` và bỏ sót các sửa lỗi T5 nằm trên HEAD (chỉ có lỗi sửa chữ ở trang đơn hàng web là không liên quan PD-3).

## 2. Cổng kỹ thuật (lệnh thật trên HEAD `c46fe6a6`)

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
| `npx jest` (api) | 172 suite / 3.256 test pass |
| Race suite trên Postgres thật (`--runInBand`) | 59 suite / 363 test pass (đã chạy 3 lần liên tiếp ở HEAD trước đó, 359/359 mỗi lần, không dao động) |
| `vitest run` miniapp | 197 file / 2.546 test pass |
| `vitest run` web | 59 file / 891 test pass |
| Build: `nest build`, `next build`, miniapp `tsc --noEmit && vite build` | cả ba thoát 0 (miniapp cảnh báo chunk > 500 kB, đã có từ trước) |
| Playwright 3 project (Zalo Mini App, Web Admin, API), `--workers=2 --retries=0`, DB dev dựng mới | 138/138 pass (2,3 phút) |

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
| Vườn Xanh, quỹ trồng cây | vitest `game-behavior`, `tree-actions`; race `pd3-tree-lock`; ảnh game | Đạt về logic; không có e2e riêng; cảnh báo React trùng `key` ở game/loyalty (chưa rõ do mã hay do dữ liệu giả của bộ chụp) |
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
- **Flash sale (200 user cùng mua 1 suất, quota 50)**: cả 12 vòng ở hai bên đều bán đúng 50, không bán quá (so DB: `soldCount`, order items, purchases đều 50); đặt trùng cùng user hoặc cùng Idempotency-Key chỉ tạo 1 đơn. **Ngoại lệ:** một vòng ở bên "sau" (lúc máy đang bị tranh chấp nặng) có 125 request nhận `500 P2028` (Prisma không mở được transaction kịp trong giờ chờ). Không dẫn tới bán quá, nhưng khách thấy 500 thay vì thông báo hết suất. Đã nằm trong C-048/A3-011 (chưa đặt `connection_limit`/`pool_timeout`, cần số vCPU của VPS Vietnix); bằng chứng mới ghi ở đây. Nên đặt `connection_limit` tường minh trước khi mở flash sale.
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

## 6. Bug và rủi ro còn mở

**Chặn deploy cho tới khi có quyết định hoặc số đo (cổng của chủ dự án):** các mục 1–5 ở phần Kết luận.

**Rủi ro cần biết khi lên PROD (không chặn mã):**

| Mục | Mô tả | Giảm thiểu |
|---|---|---|
| Migration dừng giữa chừng | `Dockerfile:39` chạy `prisma migrate deploy && node dist/main.js` với `restart: unless-stopped`: khi một migration fail, cả image mới lẫn image cũ crash-loop với P3009 tới khi chạy `migrate resolve --rolled-back` (tái hiện thật). Migration B (xu → điểm) cố ý RAISE nếu sổ xu lệch, số dư âm hoặc tỉ giá khác 1000 | Chạy migration thành bước riêng trước `up -d` (mục 7); chạy truy vấn đo trước deploy |
| Miniapp bản test cũ sau khi BE lên | Trang `/storefront` của CTV lỗi render, Ví không thấy xu/điểm quy đổi, nút mua cây báo "−50 xu", thưởng CTV hiện "+0 xu". Thông báo XU_CONVERTED vẫn gửi ngay lúc deploy | Miniapp chưa phát hành production nên chỉ ảnh hưởng bản test: cập nhật bản test cùng đợt; không nộp production tới khi UAT xong |
| Web PROD cũ chạm BE mới | Web cũ gửi `pointsToUse` chỉ theo lô thường, BE mới có thể lấy phần vượt trần từ lô quy đổi mà web cũ không hiển thị | Deploy BE và web liền nhau (cùng phút), không để web cũ chạy lâu |
| Hoàn điểm lô thường khi huỷ/trả chạy ở transaction riêng sau commit | Tiến trình chết đúng khoảnh khắc đó thì khách mất phần điểm thường được hoàn (lô quy đổi đã hoàn trong cùng transaction). Có từ trước PD-3 | Đối soát điểm theo lô (`reconcile-points`) sau deploy |
| P2028 khi tải bùng nổ | Mục 4 (flash sale), C-048 | Đặt `connection_limit`/`pool_timeout`, giữ 1 instance |
| `CREATE INDEX` khoá ghi vài giây | Mục 4 | Cửa sổ bảo trì ngắn |
| Cấu hình mới PC-9 (chấm công ngoài vùng N=3, M=15) | PROD không chạy seed. Reviewer kiểm 205 lượt `config.get`: không lượt nào thiếu giá trị mặc định trong mã, nên thiếu khoá không làm hỏng | Không cần làm gì, có thể chèn tay để admin chỉnh được |
| Chi phí làm tròn lên của Điểm Xanh | Trần lý thuyết 999đ/user có xu; chưa đo trên số dư thật | Cổng 2 |
| PC-6 | (a) mua định kỳ rồi huỷ ngay vẫn hưởng giảm giá "Đăng ký & Tiết kiệm" của đơn đầu; (b) ví thiếu thì gói PAUSED, bật lại bỏ kỳ lỡ; (c) voucher đơn thứ hai 30.000đ cho đơn từ 199.000đ | Chủ dự án quyết |
| PA-7 | Đơn đã thưởng cho cùng người mời thì không thưởng lại | Chủ dự án duyệt |
| Quỹ cây | Tubu cam kết 50.000đ mỗi lượt góp, có thể trừ vào lô quy đổi (tiền trả trước); chưa có chống bấm đôi ở BE (FE đã chặn và có hộp xác nhận) | OQ-5 |

**Bug nhỏ và nợ kỹ thuật (không chặn):**
- Trang Vườn không có khoá `busyRef` cho mọi nút (vòng quay có): bấm đôi có thể gọi API hai lần; BE phải chống trùng (PC-10a).
- Cảnh báo React trùng `key` ở game, loyalty (miniapp), admin-config (web): chưa phân biệt do mã hay do dữ liệu giả của bộ chụp.
- a11y còn lại (axe serious/critical trên ảnh chụp): miniapp 7 (`nested-interactive` ở checkout/feed/orders, `scrollable-region-focusable` ở brand-view/product-detail, `target-size` ở brand-story); web 13 (`select-name` ở 7 màn admin/merchant, `label` ở 4, `target-size` ở 2). Chủ yếu là mẫu có từ trước, đã ghi ở `04-uiux.md`.
- 4 route `/beta/*` còn chạy ở BE dù không FE nào gọi (PD-1 giao cho PD-2 nhưng không được theo dõi): quyết định gỡ hay giữ cùng `BetaFeedback`.
- PD-2: 3 endpoint admin nghi ngờ, 25 khoá cấu hình chết (xoá vật lý cần DELETE riêng có sao lưu), xoá đánh giá đã thưởng mà khách tiêu hết điểm có thể làm số dư âm.
- Các minor cũ của PC-2, PC-7, PC-9 và danh sách ở `HANDOFF.md` mục 6.
- `scripts/uiux/generated/miniapp-endpoints.json` còn 4 endpoint `/beta/*`: chạy lại `node scripts/uiux/extract-endpoints.mjs miniapp`.

## 7. Checklist deploy (khi có lệnh của chủ dự án): BE → web → miniapp

Quy trình `cb92dc8` đã dùng: `git bundle` lên VPS, `pg_dump` backup trước, `git merge --ff-only`, `docker compose -f docker-compose.vietnix.yml up -d --build`, migrate, smoke test. Không đụng root `tubutree.com` (chung VPS với ChoDeli/WordPress).

**7.1 Trước deploy (chủ dự án)**
1. Có đủ 5 cổng ở mục 1.
2. `pg_dump` PROD ra nơi an toàn.
3. Trên bản sao PROD: chạy `pd3_measure_before_deploy.sql` (các truy vấn (a)–(j)); kỳ vọng các truy vấn kiểm lệch bằng 0, `loyalty.vnd_per_point_redeem` là số `1000` (không phải chuỗi), các khoá JSON hợp lệ. Ghi số (a) vào `impl/PD-3.md`.
4. Nếu truy vấn nào khác 0, đối soát trước. Đừng bỏ qua: migration B sẽ dừng.

**7.2 Deploy**
1. Đưa mã lên VPS (`git bundle`, `git merge --ff-only`).
2. **Chạy migration thành bước riêng**: `docker compose -f docker-compose.vietnix.yml run --rm --no-deps api pnpm exec prisma migrate deploy`. Lỗi thì dừng ở đây; container cũ vẫn đang chạy.
3. `docker compose -f docker-compose.vietnix.yml up -d --build` cho API rồi web, cách nhau không quá vài phút.
4. Smoke test: `/api/health`, `/api/config/public` (có hotline/email), đăng nhập, `POST /checkout/quote` có điểm hai lô, `GET /admin/customer-refunds`, log khởi động của các cron.
5. Miniapp: `zmp deploy -t -e` lên kênh test, quét QR UAT trên Zalo thật. Chỉ nộp production sau UAT.

**7.3 Theo dõi 7 ngày sau deploy**: truy vấn ở `PD-3-SPEC.md` mục 10 (số đơn dùng lô quy đổi, đơn 0đ, drift điểm theo lô bằng `reconcile-points`).

**7.4 Tác động lên khách trong cửa sổ deploy**: miniapp bản test cũ lỗi/ hiển thị sai (mục 6); web cũ không hiện lô quy đổi cho tới khi web mới lên. Phiên đăng nhập không bị đổi: reviewer đối chiếu `git diff cb92dc8..HEAD` thấy không có thay đổi nào ở JWT, cookie `tubu_rt`, khoá lưu token, thuật toán hay migration của `refresh_tokens`. `HANDOFF.md` mục 7 vẫn ghi deploy web có thể đăng xuất mọi phiên một lần do cookie refresh HttpOnly; coi đó là khả năng nhỏ (ví dụ khi đổi host API sang `api.tubutree.com` thì cookie theo host cũ không còn gửi tới), không phải hệ quả của mã trong diff này.

## 8. Rollback

- **Migration dừng giữa chừng**: lấy tên migration lỗi bằng `SELECT migration_name, finished_at, logs FROM _prisma_migrations WHERE finished_at IS NULL`, rồi `pnpm exec prisma migrate resolve --rolled-back <tên>`; sửa dữ liệu gây lỗi; chạy lại bước migrate. Lưu ý migration B (xu → điểm) đã commit trước khi migration config lỗi: `resolve` chỉ đánh dấu migration lỗi, không hoàn tác B. Chi tiết: `impl/PD-3-SPEC.md` mục 10.
- **Quay image cũ sau deploy thành công**: image cũ chạy `migrate deploy` trên DB đã áp đủ HEAD báo "No pending migrations", không kẹt (đã chạy thật).
- **Hoàn tác quy đổi xu → điểm**: `psql -v ON_ERROR_STOP=1 -1 -f apps/api/prisma/manual/pd3_xu_to_points_rollback.sql`, chạy được hai lần, trả đúng xu, xoá các thông báo XU_CONVERTED, gỡ ràng buộc `users_coins_frozen`. Từ chối (RAISE) nếu đã có đơn tiêu lô quy đổi hoặc có khoản cộng vào lô quy đổi ngoài dòng quy đổi gốc (gộp phiên khách, hoàn đơn XU, thu hồi giới thiệu); khi đó phải xử lý tay. Sau hoàn tác phải quay image và miniapp/web về bản trước PD-3.
- **Cảnh báo**: khi image trước PD-3 chạy lại sau hoàn tác, cron hết hạn của code cũ duyệt FIFO mọi dòng sổ không lọc lô; kiểm điểm thường sau vài ngày.

## 9. Môi trường và dọn dẹp (ghi lại để chủ dự án biết)

- Docker Desktop hết chỗ (ổ ảo 39 GB đầy 100%, Postgres `tubu_pg` crash-loop `No space left on device`) giữa lượt đo tải. Theo đồng ý của chủ dự án, đã chạy `docker volume prune` xoá 560 volume ẩn danh không gắn container (tạo từ 02/10, ~35 GB). Volume có tên (`tubu_pg_data`, `tubu_redis_data`) và container đang chạy không bị đụng. Nguyên nhân gốc: container Postgres tạm của race test bị `docker rm` mà không có `-v` nên volume ẩn danh còn lại. Các agent đã được dặn dùng `--rm --tmpfs`.
- Chỉ chủ dự án dọn (theo `HANDOFF.md` mục 8): worktree `.claude/worktrees/hz*-*` (đừng `git worktree remove --force`), container `tubu_it_main`, `tubu_it_pd2`, `tubu_it_pd3`, DB `tubutree_perf`, `tubutree_perf_103` trong `tubu_pg`, thư mục `scripts/loadtest/results/` (gitignore).
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
