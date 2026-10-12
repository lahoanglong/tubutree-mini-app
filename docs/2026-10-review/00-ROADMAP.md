# Roadmap hardening 2026-10

- Ngày: 2026-10-09 · Nhánh tích hợp: `hardening/2026-10` (từ `feat/buy-flow-4b-discovery-search` 080bc75) · Commit báo cáo: `34a0610`
- Nguồn: 6 báo cáo audit (`01-pm.md` … `06-test-baseline.md`), mỗi báo cáo đã có verifier độc lập; gộp và khử trùng trong `findings-catalog.md` / `.json` (124 mục từ 145 ID gốc).
- Chi tiết từng mục (file:line, lệnh kiểm chứng riêng, verifier) nằm ở `findings-catalog.md`; file này chỉ chia đợt, chia gói việc và thứ tự.

## 1. Bức tranh chung

| Mức cuối (sau verifier) | Số mục | Ghi chú |
|---|---|---|
| P0 | 1 | C-001: tiền hoàn của đơn CTV lên hộ chảy vào ví CTV (đã chứng minh động) |
| P1 | 24 | tiền 6, dữ liệu 4, bảo mật 2, tính năng 7, UI 3, hiệu năng 2 |
| P2 | 72 | |
| P3 | 27 | |
| Đã loại | 2 mục + 8 khẳng định con | Typecheck-001 là lỗi môi trường (mất `packages/shared-types/dist`, đã build lại, `tsc` API + miniapp exit 0) |

Điểm mạnh đã xác nhận: schema khớp 103 migration (drift 0); tiền dùng Int/Decimal; mọi chỗ trừ tồn kho/ví/xu/điểm/coupon/quota flash là UPDATE có điều kiện nguyên tử; flash sale 200 user tranh 50 suất không oversell; 20/22 P0 audit tháng 9 vẫn đứng (2 còn lại: ZNS chờ Zalo duyệt mẫu, upload CCCD chưa verify động); API unit 2364/2364 pass.

Baseline test (verifier chạy lại): API jest 133 suite / 2364 pass; web vitest 162 pass; Playwright 8 fail do fixture trôi (C-062, C-063, C-111); miniapp ESLint 105 lỗi DS v2; API ESLint 2 lỗi.

## 2. Nguyên tắc thực hiện

- Mỗi đợt chia thành vòng; trong một vòng các gói không đụng chung file. Tối đa 5 agent song song, nhưng chỉ 1 job nặng (full test, Playwright, load, build) chạy cùng lúc vì máy 15,5 GB RAM đã sập OOM một lần.
- Mỗi gói chạy trong worktree riêng (`isolation: worktree`), TDD (test đỏ trước), mỗi mục một commit nhỏ. Cấm git stash/reset/checkout lên file không phải của mình.
- Migration chỉ viết file + áp trên Postgres local (`tubu_pg`), không bao giờ lên PROD.
- Sau mỗi vòng: điều phối viên merge tuần tự vào `hardening/2026-10`, chạy API jest + race + miniapp vitest + web vitest + typecheck + lint + build. Đỏ thì sửa tới xanh mới sang vòng sau.
- Gói chạm tiền/auth: 1 reviewer opus độc lập (chỉ nhận diff) review hai lượt trước khi merge.
- Model: opus cho tiền/auth/migration/race; sonnet cho bug, hiệu năng, hoàn thiện tính năng, UI theo DS v2; haiku cho đổi tên/dọn cơ học có lệnh kiểm chứng.

## 3. Đợt A — chặn deploy (tiền, bảo mật, mất dữ liệu, gãy luồng chính)

### Vòng A1 (5 gói song song)

| Gói | Model | Mục | Nhóm file | Công sức | Kiểm chứng chính |
|---|---|---|---|---|---|
| PA-1 Tiền CTV đơn hộ + hoa hồng | opus | C-001 (P0, Q-01), C-028, C-002 | `api/orders/order-reversal*`, `api/affiliate/*`, `api/checkout/checkout.service.ts` (chỉ khối tạo hoa hồng), migration unique commissions | L | jest affiliate/orders/checkout + race spec mới: huỷ/trả/COD đơn hộ → tiền về khách, không về ví CTV; hoa hồng tạo trong tx, không trùng |
| PA-2 Auth: gộp khách + throttle | opus | C-004 (Q-11), C-005, C-033 (Q-22) | `api/auth/*`, `api/app.module.ts` (throttler), `web/src/lib` (429/SSR), `miniapp/src/services` (xử lý 429) | M | race spec Postgres thật cho `mergeGuestInto` cùng ngày điểm danh; jest auth; probe 429 theo userId |
| PA-3 Admin đơn chuyển khoản + XSS | opus | C-024 (Q-06), C-050 | `web/src/app/admin/page.tsx` (khối đơn/đổi trả), `api/admin/*`, `api/orders` (order-transition, DTO đổi trả), cron huỷ PENDING_PAYMENT 24h | M | jest admin/orders: DELIVERED bị chặn khi CK chưa PAID; nút "Đã nhận tiền" ghi log; URL `javascript:` bị từ chối |
| PA-4 Toàn vẹn đại lý / Pancake / lộ dữ liệu | sonnet | C-008 (Q-07), C-011 (Q-08), C-013, C-036 | `api/dealer`, `api/integrations/pancake`, `api/merchant`, `api/catalog` (serializer) | S-M | jest dealer/pancake/merchant/catalog; đơn CREDIT không tier → 400 |
| PA-5 Rò tiền game + bẫy P2002 | opus | C-009 (Q-02), C-043, C-061 | `api/game`, `api/wallet`, `api/coupons` | S-M | jest game/wallet/coupons; race spec grantCoins/redeem trên Postgres thật |

### Vòng A2 (sau khi merge A1)

| Gói | Model | Mục | Nhóm file | Công sức | Kiểm chứng chính |
|---|---|---|---|---|---|
| PA-6 SP ngừng bán + địa chỉ/gói định kỳ | opus (có migration) | C-007 (Q-14), C-014 (Q-12), C-057 (Q-13) | `api/cart`, `api/checkout` (compute/reserve), `api/affiliate` (placeForCustomer), `api/dealer` (kiểm isActive), `api/subscriptions`, `api/users` (xoá địa chỉ), prisma FK + unique | M | jest + race spec: SP REJECTED/isActive=false không đặt được ở 4 đường; xoá địa chỉ đang dùng bị chặn; double-tap tạo 1 gói |
| PA-7 Luật voucher thưởng | opus | C-003, C-059 (Q-05) | `api/affiliate` (khối thưởng giới thiệu), `api/vouchers`, `api/orders/order-status*` (thu hồi khi trả), `api/auth` (guest) | M | jest vouchers/affiliate; guest không nhận welcome/birthday/winback; trả hàng thu hồi voucher REFER |
| PA-8 Vệ sinh test | sonnet | C-062, C-063, C-111, C-031 | `apps/e2e/tests/*`, `api/analytics/analytics.controller.ts` (lint), `api/feed/*.spec.ts` | S-M | Playwright 3 project xanh (`--workers=2` từng project); ESLint API 0 lỗi |

## 4. Đợt B — dữ liệu + hiệu năng

### Vòng B1

| Gói | Model | Mục | Nhóm file | Công sức | Kiểm chứng chính |
|---|---|---|---|---|---|
| PB-1 Gói migration index/kiểu dữ liệu | opus | C-027, C-052, C-038, C-045, C-055 (Q-10), C-109 | `api/prisma` (schema + migration), `api/admin` (tìm kiếm đơn), `api/catalog` (suggest giới hạn q), `api/integrations/pancake` (webhook dedupe + cron cứu), DTO brand/dealer | M | `prisma migrate deploy` trên DB trống + `tubutree_perf`; EXPLAIN trước/sau (hết seq scan); jest liên quan |
| PB-2 /me/coupons + dọn coupon cá nhân | sonnet | C-012 (Q-21 phần coupon) | `api/loyalty` (listMyCoupons), `api/coupons`, job dọn theo lô | M | EXPLAIN + autocannon `/me/coupons` trên `tubutree_perf` (mục tiêu < 50 ms p95) |
| PB-3 Sổ cái Ví Tubu | opus | C-060 (Q-04) | bảng `wallet_transactions` mới + 8 chỗ ghi số dư (`api/wallet`, `affiliate`, `cashback`, `orders`, `checkout`, `auth`) | L | race spec: mọi biến động ví có đúng 1 dòng sổ, tổng sổ = số dư; migration số dư đầu kỳ |
| PB-4 Vòng đời dữ liệu + analytics | sonnet | C-046 (Q-21), C-030 (Q-24), C-101 | job TTL mới (`api/jobs`), `api/analytics` (whitelist eventName, throttle theo user), `api/notifications`, dọn refresh token | M | jest analytics/jobs; client gửi `order_paid` → 400 |
| PB-5 Cron múi giờ + feed + danh sách chưa giới hạn | sonnet | C-026 (Q-09), C-042, C-100 | mọi `@Cron` (thêm `timeZone: 'Asia/Ho_Chi_Minh'`), `docker-compose*.yml` (TZ), `api/feed`, `api/affiliate` (listLinks), `api/subscriptions` (list) | M | test đếm `@Cron` thiếu timeZone = 0; EXPLAIN feed trước/sau |

### Vòng B2

| Gói | Model | Mục | Nhóm file | Công sức | Kiểm chứng chính |
|---|---|---|---|---|---|
| PB-6 Home gộp request + cache + bundle | sonnet | C-037, C-039, C-088 | endpoint `GET /home` mới (`api/catalog`), `miniapp/src/pages/home` + services, Cache-Control public, `miniapp/vite.config` (tách chunk) | L | E2E Home 4b xanh; số request Home 17 → ≤ 5; bundle entry giảm |

## 5. Đợt C — UI/UX đồng nhất + hoàn thiện tính năng dở

### Vòng C1

| Gói | Model | Mục | Nhóm file | Công sức |
|---|---|---|---|---|
| PC-1 Nền DS v2 + a11y component | sonnet | C-023, C-089, C-068, C-070, C-071, C-072, C-114, C-075 (Q-28), C-077 (phần miniapp/ui), C-021 (phần component) | `packages/design-tokens`, `miniapp/src/components/ui`, `miniapp/index.html` | M |
| PC-3 Giỏ / checkout / đơn | sonnet | C-021 (trang), C-065 (Q-27), C-080, C-066, C-020 | `miniapp/src/pages/{cart,checkout,order-detail}`, `components/{checkout,reorder}` | M |
| PC-4 Hồ sơ / giới thiệu / cài đặt / onboarding / xoá tài khoản | sonnet (C-016 opus review) | C-018, C-019 (Q-17), C-022, C-078, C-085, C-086 (Q-15), C-016 | `miniapp/src/pages/{profile,about,settings,addresses,notifications}`, `components/onboarding`, `api/notifications`, `api/users`, tab admin xử lý yêu cầu xoá | M |
| PC-5 CTV / đại lý / nhãn hàng | sonnet | C-006, C-034 (Q-18), C-064, C-067, C-081, C-029, C-117 | `miniapp/src/pages/{affiliate,dealer,brand-owner,brand-view}`, `components/{affiliate,share-sheet}`, `api/brand`, thông báo CTV | M-L |
| PC-8 Admin web + seed/config | sonnet | C-092, C-094, C-032, C-122, C-053, C-054 | `web/src/app/admin/*`, `api/prisma/seed.ts`, `api/system-config`, `api/analytics` (NS-1) | M |

### Vòng C2

| Gói | Model | Mục | Nhóm file | Công sức |
|---|---|---|---|---|
| PC-2 Hoàn tất 4b (Task 26-27) + triage deferred minors | sonnet | Task 26 (E2E 320/375/390, hit area, skeleton), Task 27 (full suite + ảnh + ledger), C-084, minors ghi trong `.superpowers/sdd/2026-09-30-buy-flow-4b-discovery-search/progress.md` | `miniapp/src/pages/{home,browse}`, `components/{home,browse,search}`, `apps/e2e/tests/buy-flow-4b-*` | M |
| PC-6 Giao định kỳ + đơn thứ 2 | sonnet | C-015 (Q-13), C-017 | `api/subscriptions`, `api/vouchers`, `api/lifecycle`, `miniapp/src/pages/orders` (tab Định kỳ) | M |
| PC-7 Web khách theo DS v2 | sonnet | C-097 (Q-25), C-025, C-077/C-116/C-123 (phần web) | `web/src/app/{(shop),san-pham,gio-hang,thanh-toan,tai-khoan,s}`, `web/tailwind.config`, `web/src/components` | L |
| PC-9 Nhân sự + câu chữ | sonnet | C-056, C-073, C-074 (Q-26), C-083, C-115, C-120, C-119 | `api/staff`, `miniapp/src/i18n`, `pages/{order-detail,not-found}` | S-M |

### Vòng C3 — di chuyển trang còn lại sang DS v2 (C-076)

Chia 3 agent theo nhóm trang không chồng nhau, mỗi trang một commit, kiểm chứng bằng ESLint `tubu-ds` của trang đó = 0 lỗi + ảnh 390px trước/sau:
- PC-10a (sonnet): `game`, `loyalty` (+ C-082 chia khối, C-113 emoji ngoài game).
- PC-10b (sonnet): `affiliate`, `dealer`, `storefront*`, `brand-story` (+ C-079).
- PC-10c (haiku, có ESLint làm chốt): các trang còn lại có alias legacy.
Bỏ qua trang sẽ bị ẩn/xoá ở Đợt D.

## 6. Đợt D — dọn tính năng thừa / gộp

| Gói | Model | Mục | Nội dung (theo phương án khuyến nghị, sẽ chỉnh theo Cổng 1) |
|---|---|---|---|
| PD-1 Ẩn/xoá | sonnet | C-010, C-044 (Q-16), C-086 phần cashback (Q-15), C-096, C-118 (Q-19), C-069 | Ẩn Season Pass; đổi "cây thật" → "góp quỹ trồng cây", bỏ perk hạng không có quy trình; ẩn Hoàn tiền sàn ngoài khỏi hub; bỏ lối vào `/merchant` khỏi web khách; xoá `/beta`; xoá `ui/primitives.tsx` chết. Không xoá bảng/dữ liệu (chỉ ẩn lối vào). |
| PD-2 Dọn code chết + logic trùng | sonnet/haiku | C-040, C-098, C-108, C-054 (khoá chết), C-099 (Q-31), C-110 (Q-30) | Gom helper sinh mã đơn/maskName/SĐT/dayKey về `api/common`; gỡ endpoint không ai gọi (sau khi xác nhận không có client cũ trên PROD gọi); đánh dấu bảng chết là deprecated (không DROP). |
| PD-3 Gộp Điểm Xanh / TubuXu | — | C-047, C-105 (Q-03) | Khuyến nghị tách thành dự án con riêng (spec → plan → migration số dư) sau khi giao khách; không làm trong đợt hardening vì đụng tiền trả trước của khách. |

## 7. Backlog sau giao khách (không làm trong đợt này, có lý do)

| Mục | Lý do để sau |
|---|---|
| C-041 tách 5 service > 800 dòng, C-106 vòng phụ thuộc thư mục, C-090 shared-types | Refactor lớn, không đổi hành vi; rủi ro hồi quy cao hơn lợi ích trước giao khách |
| C-048 nhiều instance, C-049 ECONNRESET ~800 rps | Q-23 khuyến nghị 1 instance; tải đo được (~300-500 user đồng thời) đủ cho giai đoạn đầu |
| C-051 thêm FK cho 80 cột | Thêm FK trên dữ liệu PROD cần dọn mồ côi trước; làm riêng sau khi có bản sao dữ liệu thật |
| C-091, C-093 (Q-29) tái cấu trúc admin 19 tab | L, chỉ ảnh hưởng nội bộ; Q-29 khuyến nghị admin chỉ dùng máy tính |
| C-087 đổi vỏ / Gomdon | Cần hợp đồng Gomdon + danh sách cửa hàng thật |
| C-102, C-103, C-104, C-107, C-112, C-121, C-124 | P3, rủi ro thấp |

## 8. Quyết định chủ dự án (Cổng 1)

31 câu đầy đủ ở `findings-catalog.md` mục 4. Hỏi trực tiếp chủ dự án các câu về nghiệp vụ/tiền: Q-01, Q-02, Q-03(+Q-26), Q-05(+Q-31), Q-06, Q-09, Q-13, Q-15/Q-16/Q-19, Q-18, Q-20, Q-25, Q-27. Các câu kỹ thuật còn lại điều phối viên chọn phương án khuyến nghị (Q-04, Q-07, Q-08, Q-10, Q-11, Q-12, Q-14, Q-17*, Q-21, Q-22, Q-23, Q-24, Q-28, Q-29, Q-30).
\* Q-17 cần dữ liệu thật (hotline, Zalo OA, email): làm cấu hình qua `app_config` và ẩn dòng chưa có giá trị; chủ dự án tự điền.

Kết quả Cổng 1 ghi ở mục 9.

## 9. Kết quả Cổng 1 (2026-10-09)

### Chủ dự án chọn

| Câu | Chọn | Ảnh hưởng roadmap |
|---|---|---|
| Q-01 đơn CTV lên hộ | Hoàn về khách thật (SĐT snapshot), CTV không tự huỷ đơn PAID, ghi userId = khách cuối (CTV là người giới thiệu), chặn CTV nhập SĐT của chính mình | PA-1 |
| Q-02 rò game | Bỏ mua giọt nước bằng xu; minOrder coupon thu hoạch = 199k | PA-5 |
| Q-03 Điểm Xanh / TubuXu | **Gộp ngay trong đợt này** | PD-3 thành gói thật (opus, L) |
| Q-03a quy đổi số dư xu | 1.000 xu = 1 Điểm Xanh (làm tròn lên); lô quy đổi không hết hạn, không bị trần 20%, không ra tiền mặt | PD-3 |
| Q-05 giới thiệu + voucher | Một chương trình: người mời được thưởng khi bạn được mời có đơn thứ 2 trong 30 ngày, thu hồi nếu trả hàng; CTV chỉ hưởng hoa hồng; voucher chào mừng/sinh nhật/winback chỉ cho user có zaloId/SĐT thật | PA-7 |
| Q-06 đơn chuyển khoản chưa trả | Nút "Đã nhận tiền" (ghi log), chặn DELIVERED khi chưa PAID, tự huỷ PENDING_PAYMENT sau 24 giờ | PA-3 |
| Q-09 luật tiền cũ | Duyệt cả gói (điểm danh 8 điểm/tuần, hạng chỉ tính mua, doanh số CTV theo đơn chốt, bỏ bonus bậc CTV, claim đại lý bị từ chối là cuối + nút admin mở lại, thưởng quý ngày 10 có timeZone, Cổ Thụ giảm 5% mọi đơn) | PB-5 (timeZone), PC-8 (nút mở lại claim) |
| Q-13 giao định kỳ | Đơn đầu giao ngay hoặc khách chọn ngày; trả bằng COD/Ví/chuyển khoản; sửa được số lượng/địa chỉ; nhiều gói cùng SP chỉ khi khác địa chỉ | PA-6, PC-6 |
| Q-15/16/19 ẩn/xoá | Ẩn Season Pass + đổi "cây thật" thành "góp quỹ trồng cây" + bỏ perk không có quy trình; ẩn Hoàn tiền sàn ngoài; bỏ lối vào /merchant trên web khách; xoá trang Beta Tester | PD-1 |
| Q-17 liên hệ | Hotline 0899 149 229, email tubutree@gmail.com; Zalo OA chưa có thì ẩn; lưu thành cấu hình admin sửa được | PC-4 |
| Q-18 chủ nhãn | Tab chỉ-đọc trong /brand-owner (số đơn, doanh thu, SP bán chạy theo kỳ), ẩn PII khách | PC-5 |
| Q-20 tên miền | app.tubutree.com | PC-7 (SITE_URL, fallback share miniapp) |
| Q-25 web DS v2 | **Đồng bộ cả admin** | PC-7 (web khách) + PC-11 mới (admin web DS v2, vòng C3) |
| Q-26 thuật ngữ | "Mã giảm giá", "Điểm Xanh", "Ví Tubu", "giọt nước" | PC-9, PD-3 |
| Q-27 tự điền địa chỉ | Xin quyền tên + SĐT Zalo ở đơn đầu, từ chối thì nhập tay, nhớ tỉnh/phường lần trước | PC-3 |
| Q-31 cửa sổ giới thiệu CTV | 7 ngày (cấu hình được) | PA-7 |

### Điều phối viên chọn theo khuyến nghị (câu kỹ thuật)

Q-04 số dư đầu kỳ cho sổ cái Ví · Q-07 creditLimit mặc định 0, gán DEALER bắt buộc chọn tier · Q-08 chỉ đẩy Pancake khi đủ 100% hàng · Q-10 cột tích luỹ sang BigInt · Q-11 giữ cả hai lượt điểm danh, khoá khách thành `MERGED:<guestId>:<dayKey>` · Q-12 chặn xoá địa chỉ đang dùng cho gói định kỳ · Q-14 lọc SP ngừng bán khỏi giỏ và kiểm lại ở mọi đường đặt · Q-21 analytics thô 13 tháng, notification_logs 180 ngày, webhook/OA 90 ngày, refresh token thu hồi/hết hạn 30 ngày, dọn coupon cá nhân hết hạn theo lô · Q-22 throttle theo userId khi có JWT, IP khi chưa, ~300/phút, đăng nhập/refresh theo thiết bị/tài khoản, SSR web miễn bằng token nội bộ · Q-23 giữ 1 instance · Q-24 whitelist eventName · Q-28 bỏ chặn phóng to · Q-29 admin web tối ưu cho máy tính (vẫn không vỡ ở 390px) · Q-30 một đánh giá/SP, sửa được khi mua lại, thưởng điểm lần đầu.

### Điều chỉnh roadmap sau Cổng 1

- PD-3 (gộp Điểm Xanh/TubuXu) chuyển từ "dự án riêng" thành gói thực hiện ở Đợt D, opus, có spec ngắn + migration quy đổi số dư + race test. PA-5 và PA-7 không tạo thêm luồng xu mới để PD-3 không phải gỡ lại.
- Thêm PC-11 (admin web sang DS v2, opus không cần, sonnet) ở vòng C3, sau PC-7 vì dùng chung `web/tailwind.config`.
- PD-3 chưa làm phần "Ví trả một phần đơn" của Q-03 phương án 1 (spec PD-3 OQ-12): Cổng 1 chỉ ghi Q-03 là "Gộp ngay", không nêu riêng phần này. CHƯA CÓ QUYẾT ĐỊNH của chủ dự án: cần xác nhận hoãn sang gói riêng sau PD-3 hoặc giao làm ngay (đụng đặt đơn, hoàn tiền, QR chuyển khoản, COD gửi Pancake). Dòng này do review C1 của PD-3 thêm để việc không bị bỏ sót.
- PD-3 làm theo đề xuất mặc định của spec cho OQ-1..15; CHƯA có chủ dự án duyệt. Các câu đổi giá trị khách/CTV nhận cần duyệt hoặc chỉnh, và ghi kết quả vào đây, TRƯỚC KHI deploy: OQ-1 (thưởng mới là Điểm Xanh thường, hết hạn 12 tháng, trần 20%/đơn; mốc CTV 80 triệu = 2.000 điểm trước đây là xu trả được tới 100% đơn), OQ-2 (điểm, kể cả lô quy đổi, không trừ phí ship và phần lẻ dưới 1.000đ phải trả tiền; trước đây xu trả cả tổng đơn), OQ-5 (góp quỹ trồng cây 50 Điểm Xanh, có thể lấy từ lô quy đổi), OQ-6 (điểm cộng đồng: đăng bài 1, hay nhất 1, trả lời 0; trần 4.000đ/ngày), OQ-9 (thu hồi thưởng giới thiệu cấp bằng xu thì trừ lô quy đổi), OQ-14 (xoá tài khoản bị chặn khi còn điểm quy đổi). Dòng này do review D1 của PD-3 thêm; chưa có quyết định nào của chủ dự án ở đây.

### Duyệt của chủ dự án 2026-10-11 (sau 99-release-readiness)

Giả định đã nêu và chủ dự án không phản đối: dự án chưa có khách thật, chưa có số dư xu thật; bản `cb92dc8` trên VPS chỉ là bản thử. Chủ dự án chọn "duyệt mặc định" cho mọi mục đề xuất:

| Mục | Quyết định |
|---|---|
| PD-3 OQ-1 | Thưởng mới là Điểm Xanh thường, hết hạn theo `loyalty.point_expire_months`, trần `loyalty.max_redeem_pct` (20%) |
| PD-3 OQ-2 | Điểm không trừ phí ship; phần lẻ dưới 1.000đ khách trả tiền |
| PD-3 OQ-3, OQ-4 | Lô quy đổi không dùng cho vòng quay, voucher catalog, mở lô vườn; bỏ mở lô vườn bằng xu |
| PD-3 OQ-5 | Góp quỹ cây 50 Điểm Xanh, tiêu lô thường trước; thêm chống bấm đôi ở BE |
| PD-3 OQ-6 | Cộng đồng: đăng bài 1 điểm (≤1/ngày), hay nhất 1 (≤3/ngày), trả lời 0; theo dõi lạm dụng nick phụ tuần đầu |
| PD-3 OQ-7, OQ-11 | Nhiệm vụ gian hàng 2/2/2/1/5 điểm; khoá cứng tỉ giá 1.000đ/điểm |
| PD-3 OQ-8, 9, 10, 13, 14 | Không còn tác dụng khi chưa có số dư xu cũ; giữ mã, không gỡ |
| PD-3 OQ-12 | "Ví trả một phần đơn" HOÃN sang gói riêng sau UAT |
| PA-7 | Mỗi người được mời chỉ thưởng người mời một lần |
| PC-6 (a), (b), (c) | Chấp nhận: giảm giá đơn đầu kể cả khi huỷ gói (theo dõi `subscription_changed`); ví thiếu thì PAUSED và bỏ kỳ lỡ; voucher đơn thứ hai 30.000đ cho đơn từ 199.000đ (chỉnh trong SystemConfig nếu biên lãi không chịu được) |
| PD-1 | Nhãn "CO₂ hấp thụ" ở thẻ Tác động xanh đổi thành "ước tính" |
| PD-2 | Gỡ 4 route `/beta/*`, giữ bảng `BetaFeedback`; giữ nguyên 25 khoá cấu hình chết, 3 endpoint admin nghi ngờ, ZaloPay, `/storefront/by-host`, `DELETE /reviews/:id` |

Việc của chủ dự án còn lại: trỏ DNS Cloudflare, báo số vCPU của VPS (`nproc`) để đặt `connection_limit`, quét QR UAT trên Zalo thật, nội dung FAQ/Academy, dọn worktree/container. Gói PE-1/PE-2 (chống bấm đôi góp quỹ cây, hạn của điểm hoàn khi huỷ đơn, gỡ `/beta/*`, nhãn CO₂, `busyRef` trang Vườn, cảnh báo `key` trùng) làm theo các quyết định trên.

### Chốt OQ-15b (2026-10-11)

Điểm hoàn khi huỷ đơn (`ORDER_REFUND_POINTS`) nhận hạn mới `now + loyalty.point_expire_months`, không kế thừa hạn của lô gốc. Chủ dự án chốt giữ như vậy. Lý do: mỗi vòng lặp cần tạo một đơn thật và huỷ, trần dùng điểm 20%/đơn giới hạn lợi ích. Nếu sau này thấy lạm dụng, làm gói riêng cho dòng hoàn kế thừa `min(hạn gốc, now + N tháng)` kèm review opus (phương án 2 trong `impl/PE-1a.md`, OQ-15b).

### Cần chủ dự án xác nhận: hạn của điểm vòng quay, nhiệm vụ, đánh giá (PE-3)

Gói PE-3 cho điểm thưởng vòng quay (`GAME_SPIN_WIN`), nhiệm vụ (`MISSION`) và đánh giá (`REVIEW`) hết hạn sau `loyalty.point_expire_months` tháng như các điểm thưởng thường khác. Trước đó ba nguồn này ghi `expiresAt` rỗng nên không bao giờ hết hạn, khác với FAQ trong miniapp ("điểm có hạn 12 tháng"). OQ-1 chỉ liệt kê rõ "nhiệm vụ"; vòng quay và đánh giá do điều phối viên suy ra từ nguyên tắc "Điểm Xanh thường có hạn". Chủ dự án chưa xác nhận hai nguồn này. Hoàn tác được bằng cách revert hai commit `e5dd7b10` (game) và `386e1255` (reviews); chưa có dữ liệu thật nên không cần backfill.

### Chốt ngày 2026-10-11 (sau đợt F)

- Hạn 12 tháng cho điểm vòng quay, nhiệm vụ, đánh giá (PE-3): chủ dự án đồng ý giữ có hạn. Mục "Cần chủ dự án xác nhận" ngay phía trên đã được chốt.
- PA-1 yêu cầu 5 (đơn CTV lên hộ ghi `userId` là khách cuối, thiết kế ở `impl/PA-1.md` Lượt 2): HOÃN sang sau UAT. Lý do: không có lỗi tiền đang mở (hoàn về khách thật qua SĐT snapshot, CTV không tự huỷ đơn PAID, SĐT của chính CTV bị chặn), đổi chủ đơn chạm luồng CTV đang chạy và cần migration `placedByUserId`. Khi làm lại cần chủ dự án gật hai điểm: hạng CTV chỉ tính từ đơn CTV tự mua (Q-09), và nội dung tin gửi khách cuối ("CTV [tên] đã đặt hộ bạn đơn [mã]"). Làm thành gói riêng, review opus hai lượt.
- Ô chọn ngày của gói định kỳ chỉ kiểm được trên Zalo thật: thử khi quét QR UAT; nếu lỗi thì thay bằng nút chọn nhanh ("Giao ngay", "Ngày mai", "Sau 3 ngày", "Sau 7 ngày").

### Chốt ngày 2026-10-12 (sau đợt F, PF-1..PF-5b)

- Đợt F đã sửa các bug còn lại có thể sửa bằng mã; danh sách và kết quả kiểm ở `99-release-readiness.md` mục 5c.
- Hành vi mới cần chủ dự án biết (mặc định coi là duyệt, phản đối thì đổi): xoá đánh giá rồi tạo lại không còn được thưởng điểm lần hai (chặn farm điểm); vòng quay không tiêu được điểm của đơn còn trong cửa sổ đổi trả (giống checkout, đổi quà, góp quỹ cây).
- Việc còn lại chỉ chủ dự án làm được hoặc hoãn có chủ đích: DNS, quét QR UAT trên Zalo thật (kèm ô chọn ngày gói định kỳ, WebView có hỗ trợ `inert` không), nội dung FAQ/Academy, PA-1 yêu cầu 5 và "Ví trả một phần đơn" sau UAT, dọn worktree/container/volume Docker.

### Cần chủ dự án chọn (sau đợt F4, 2026-10-12): trần giải POINTS của vòng quay

`game.spin_prizes` do admin ghi qua `PUT /admin/config`. Từ PF-6a giải POINTS không còn nhận số âm hay quá Int32, nhưng chưa có trần trên, nên gõ nhầm đơn vị (xu thay vì Điểm Xanh) làm một lượt quay cộng cả triệu điểm. Đề xuất mặc định: trần 100 Điểm Xanh mỗi giải (100.000đ). Chủ dự án chọn số khác thì sửa một hằng số ở `apps/api/src/modules/system-config/spin-prizes.ts`.
