# Gói `storefront` — báo cáo làm (2026-10-18)

Nhánh `lr/storefront`, worktree `.claude/worktrees/lr-storefront`, cắt từ `review/2026-10-18-launch` (0bc7588b). TDD, mỗi mục một commit. Chưa push, chưa deploy, không đụng DB `tubutree`.

Commit: `e5de5d90` (D3-02 API), `f463e0aa` (D3-02 tab admin), `ae8a8cbc` (D3-02/D5-05 web), `51d0b259` (D3-11, D3-08 phía API/web), `a4276062` (miniapp: D3-08, D3-11, D3-02, D5-09, D7), `0ef621b6` (D3-10).

## 1. Đã làm (theo ID)

### D3-02 — kiểm duyệt gian hàng
- **Schema + migration** `20261018170000_lr_storefront_moderation`: `Storefront.approvedAt/approvedById/takenDownAt/takenDownReason/takenDownById`, và 3 mẫu thông báo `STOREFRONT_TAKEN_DOWN`, `STOREFRONT_REINSTATED`, `STOREFRONT_APPROVED` (INSERT ... ON CONFLICT DO NOTHING; cùng 3 dòng `createOnly` ở `prisma/seed.ts`).
- **Ai thấy gian hàng nào** — `storefront-visibility.ts` (`publicStorefrontWhere`, `ownerHiddenReason`, `isStorefrontApproved`): khách chỉ thấy gian hàng đã đăng, chưa bị gỡ, chủ không bị khoá, và (gian hàng CTV) chủ còn thuộc `affiliate.commission_eligible_roles`; gian hàng MERCHANT/BRAND không bị ảnh hưởng. Dùng chung cho trang công khai, `public-list` (sitemap) và endpoint ảnh. Chủ vẫn xem gian hàng của mình trong builder kèm `publicHiddenReason` (dòng giải thích).
- **Cờ** `storefront.require_approval` (mặc định `false`): bật thì CTV chưa duyệt bị ẩn. Có mặc định trong mã (`storefront-config.ts`), luật ghi boolean (`system-config.service.ts` JSON_RULES), nạp qua `prisma/reference-data/config-selection.ts` (EXTRA_CONFIGS + `fallbackSource`), và dòng có thứ tự trong `APPROVED_LOADED_KEYS`.
- **API admin (chỉ ADMIN)** `admin/storefronts`: `GET /`, `GET :id`, `POST :id/take-down {reason}`, `POST :id/reinstate`, `POST :id/approval {approved}`. Mọi lệnh ghi là một `updateMany` có điều kiện trạng thái trong WHERE (5 admin cùng gỡ → một lệnh thắng, một tin báo chủ). Thông báo chủ là best-effort. Chủ không tự đăng lại được khi đang bị gỡ (403 kèm lý do); đăng chen giữa lúc admin gỡ bị chặn bằng `where: { takenDownAt: null }` (race test).
- **Từ cấm subdomain**: thêm `cskh, hotro, support, help, hello, khuyenmai, official, chinhhang, chodeli, zalo, facebook, shopee, lazada, tiktok, login, payment, checkout` vào `RESERVED_STOREFRONT_IDENTIFIERS`; `assertIdentifierAvailable` chặn trùng slug hoặc tên (không phân biệt hoa thường) của nhãn hàng có sẵn, trừ nhãn gắn với chính gian hàng đó.
- **Tab web "Gian hàng"** (`components/admin/storefronts-tab.tsx`, `lib/admin-storefronts-client.ts`, nhóm "Người bán"): lọc trạng thái (Đã đăng / Nháp / Đã gỡ / Chờ duyệt) và loại, tìm theo tên/slug/SĐT chủ, danh sách cuộn vô hạn, ngăn chi tiết, gỡ đăng bắt nhập lý do (qua `useConfirm`), đăng lại, duyệt/bỏ duyệt. `page.tsx` chỉ thêm 4 dòng (import, union, mục menu, dòng render); `page.spec.tsx` 33 → 34 mục.
- **Tick xanh và "CTV tuyển chọn" chỉ khi đã duyệt** (web `s/[slug]` qua `lib/storefront-badge.ts`, miniapp `storefront-view.tsx`). Đối tác ghi "Đối tác của Tubu Tree", nhãn hàng "Nhãn hàng trên Tubu Tree".
- **Rà lời cam kết**: dải trên `s/[slug]` đổi thành "Sản phẩm đã qua duyệt của Tubu Tree", "Theo dõi đơn trên Tubu Tree", "Thanh toán qua Tubu Tree" (bỏ "100% Chính hãng", "Xuất kho tận gốc", "VietQR Napas247" vì khách luôn trả vào tài khoản Tubu, hàng của đối tác tự giao); giữ "Đổi trả 7 ngày (hàng lỗi NSX)". Bỏ chữ "chính hãng" khỏi nhãn miniapp. Mô tả mặc định khi chia sẻ: "Gian hàng sống xanh trên Tubu Tree".
- **Việc thêm của điều phối viên**: gian hàng CTV có chủ không còn thuộc `affiliate.commission_eligible_roles` bị ẩn khỏi trang công khai (giống tài khoản khoá); MERCHANT không bị ảnh hưởng; chủ vẫn xem trong builder kèm dòng giải thích. Có test cho CTV hợp lệ hiện / CTV bị hạ ẩn / MERCHANT hiện, ở cả jest (`storefront.service.spec.ts`, `storefront-visibility.spec.ts`) lẫn race Postgres thật.

### D3-08 — Chia sẻ, Gỡ đăng, nháp
- Builder miniapp: gian hàng đã đăng có nút chính "Chia sẻ gian hàng" (dùng lại `ShareSheet`, mang `referralCode` của chủ; `GET /storefront/me` trả thêm `referralCode`) và nút "Gỡ đăng" có bước xác nhận (`publishStorefront(false)`). Gian hàng còn nháp mà chưa có sản phẩm: "Lưu & Đăng" tắt kèm lời nhắc (API cũng chặn: `assertCanPublish`). Nháp chưa có nút chia sẻ vì link chưa mở được.
- `merchant.service.ts getOrCreateStore`: gian hàng tạo từ cổng `/merchant` là nháp (trước đây `isPublished: true`); đăng được khi có ≥ 1 sản phẩm. Nháp không vào `public-list` (sitemap) và không hiện với khách (race test).

### D3-11 / D6-02 — cờ subdomain
- Cờ `storefront.subdomain_enabled` (mặc định `false`), đủ 4 chỗ như `require_approval`. Tắt thì `GET /storefront/public/:slug`, `GET /storefront/me` và `GET/PUT /merchant/store`, `POST /merchant/store/publish` trả `subdomain: null`, `customDomain: null`, `subdomainEnabled: false` (`withSubdomainFlag`, `MerchantService.presentStore`). Dữ liệu vẫn ở DB nên bật cờ là hiện lại.
- Builder miniapp: dòng URL là `/s/<slug>`, ô "Subdomain riêng" ẩn và không gửi subdomain khi cờ tắt. Web `s/[slug]`: dòng `https://…tubutree.com` chỉ khi `subdomainEnabled`. Link chia sẻ luôn là `…/s/<slug>?ref=` (ShareSheet vốn đã như vậy). Builder không có ô tên miền riêng nên không có gì để ẩn.
- **Middleware** (`lib/tenant-subdomain.ts`, dùng chung bởi `middleware.ts`, `entry-source.ts`, `site.ts`): chỉ coi là gian hàng host dạng `<một nhãn>.<tên miền gốc>` (hoặc `<nhãn>.localhost` khi dev). Tên miền gốc lấy từ `NEXT_PUBLIC_TENANT_ROOT_DOMAIN`, mặc định `tubutree.com`. `*.vercel.app`, `*.nip.io`, `a.b.tubutree.com`, `x.example.com` không còn là gian hàng. `site.ts` (`tenantSubdomainOf`, `tenantHostBootScript`) dùng cùng quy tắc; `middleware.spec.ts` mới. Đã thêm ARG/ENV vào `apps/web/Dockerfile`, `.env.example`, `docker-compose.vietnix.yml` (`${WEB_DOMAIN}`).
- **Vì sao middleware không đọc cờ SystemConfig**: middleware chạy ở Edge trên mọi lượt truy cập; gọi API (kể cả có cache) thêm một bước mạng và một điểm lỗi cho cả site chỉ để quyết định có rewrite hay không. Quy tắc theo tên miền gốc là hàm thuần, không tốn gì. Cờ chỉ quyết định chỗ nào quảng bá/hiện/chia sẻ link subdomain; một URL không ai được cho thì vô hại. Nếu cần chặn cứng cả host đã trỏ DNS khi cờ tắt thì cần một cách khác (biến build thứ hai hoặc endpoint cache ở Edge) — xem câu hỏi 4.

### D3-10 — cache, ảnh chia sẻ, canonical
- `@PublicCache('CATALOG')` (15 giây trình duyệt, 30 giây CDN) cho `GET storefront/public/:slug` và `by-host`; `public-cache.decorator.spec.ts` thêm 2 dòng.
- Ảnh đại diện/ảnh bìa base64 không còn nằm trong JSON công khai: trả `/storefront/image/<id>/<avatar|cover>?v=<md5 nội dung>` (mô phỏng ảnh bài cộng đồng: `private` cache vĩnh viễn khi `v` khớp, 5 phút khi sai, 404 khi gian hàng không còn hiển thị, hạn mức 1200/phút, CORP cross-origin). URL thường giữ nguyên; data URL không phục vụ được (SVG, HTML) bị bỏ. Web `getStorefront` và miniapp `/s/:slug` ghép đường dẫn với gốc API công khai.
- Web `s/[slug]/opengraph-image.tsx`: thẻ 1200x630 theo gian hàng (ảnh đại diện hoặc chữ cái đầu, tên, tối đa 3 ảnh sản phẩm). Bỏ ảnh base64/không phải http(s); ảnh tải chậm (3 giây), nặng (> 1,5 MB), webp/svg hoặc lỗi thì bỏ riêng ảnh đó (`lib/og-image-fetch.ts`). Cần font có dấu tiếng Việt nên thêm `apps/web/src/assets/fonts/BeVietnamPro-SemiBold.ttf` (137 KB, SIL OFL, kèm `BeVietnamPro-OFL.txt`). Đã dựng thử bằng satori rồi xem ảnh PNG: dấu tiếng Việt đúng.
- `generateMetadata`: thêm `alternates.canonical` = `${SITE_URL}/s/<slug>` (dù vào bằng subdomain hay chữ hoa/thường khác), bỏ nhét ảnh gốc vào `og:image`.

### D3-19
Web không có cơ chế làm mới ngay (không có `revalidatePath`/`revalidateTag`, không có route làm mới có khoá) và trang dùng `revalidate = 300`. Theo brief: builder hiện dòng "Trang web cập nhật sau vài phút khi bạn đổi nội dung." khi gian hàng đã đăng.

### D5-05 / D5-09 / D7 mục 10
- Web `s/[slug]` và `brand/[slug]`: trạng thái rỗng (`components/empty-state.tsx`) có nút về danh mục; bộ sưu tập không có sản phẩm bị ẩn.
- Miniapp `/s/:slug`: khách thấy "Xem sản phẩm" (→ `/browse`), chủ gian hàng (mã giới thiệu của chủ trùng mã của mình) giữ "Chia sẻ gian hàng"; gian hàng không có sản phẩm khách thấy hiện trạng thái rỗng (khách: "Xem sản phẩm", chủ: "Thêm sản phẩm" → `/storefront`).
- Builder: khung ảnh bìa trống có biểu tượng + chữ "Thêm ảnh bìa".

## 2. Kiểm chứng đã chạy (cuối gói)
- `cd apps/api && npx jest src/modules/storefront src/modules/merchant src/modules/system-config src/modules/notifications src/common prisma/reference-data src/modules/staff` → `Test Suites: 86 passed, 86 total`, `Tests: 1509 passed, 1509 total`.
- Riêng các bài chặn: `npx jest reference-config-selection staff-permissions.matrix notification-templates-seed` → `Test Suites: 3 passed`, `Tests: 70 passed`.
- Race (Postgres thật, `lr-storefront-pg` cổng 5569, DB `tubutree_it`): `npx jest -c test/integration-race/jest.config.js --runInBand` cho `storefront-moderation` (mới, 15 test), `n2d-ctv-role-derived-flag`, `n2b-partner-history`, `d2-dealer-revoke-partner`, `ctv-upgrade-to-partner` → `Test Suites: 5 passed, 5 total`, `Tests: 80 passed, 80 total`.
- `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code` → `No difference detected.`
- Web: `npx vitest run src/app/admin src/app/s src/app/brand src/lib src/middleware.spec.ts src/app/layout.spec.tsx src/app/merchant` → `Test Files 1 failed | 75 passed (76)`, `Tests 1 failed | 1149 passed`. Một test đỏ là `src/lib/no-raw-date-format.spec.ts`: `lib/commission-rates.ts` (gói commission, đã có sẵn ở `review/2026-10-18-launch`, không đổi ở nhánh này) có 1 `.toLocaleString(` chưa nằm trong danh sách xác nhận. Không phải của gói này; cần gói commission hoặc điều phối viên thêm dòng vào danh sách hoặc đổi sang `formatDate`.
- Web thêm: `ds-palette-pc11`, `ds-v2-guest`, `merchant-no-guest-entry`, `layout.spec` → `Tests: 288 passed`.
- Miniapp: `npx vitest run src/pages/storefront src/components/share-sheet src/services src/i18n` → `Test Files 29 passed`, `Tests 334 passed`.
- `npx tsc --noEmit` ở `apps/api`, `apps/web`, `apps/miniapp`: không lỗi.
- `eslint --max-warnings=0` trên mọi file `.ts/.tsx` đổi so với `0bc7588b` (api 26 file, web 24, miniapp 6): sạch.
- `npm run -s lint:vars` → `OK — every var(--x) reference is defined.`
- **Chưa kiểm chứng**: không build Next, không Playwright, không chạy full suite (máy dùng chung). Route `opengraph-image.tsx` (nạp font bằng `new URL(..., import.meta.url)`, build standalone) chưa chạy trong Next thật; phần dựng ảnh đã chạy riêng bằng `next/og` trong test tạm (đã xoá).

## 3. Chưa làm hoặc cố ý để lại
- **Trang web `/merchant`** (`apps/web/src/app/merchant/page.tsx`, của gói affiliate-ui nên không sửa): dòng 293-302 (link `https://…tubutree.com`) tự biến mất vì API trả `subdomain: null` khi cờ tắt. Còn lại: ô nhập "Subdomain riêng biệt" (dòng 527-537, nhãn `.tubutree.com`) và dòng xem trước `subdomain.tubutree.com` (dòng 675). Cần gói affiliate-ui ẩn theo `store.subdomainEnabled` (API đã trả; cần thêm trường vào `merchant-client.ts`). Dòng 311 đã rơi về `/s/<slug>`.
- **PUT subdomain khi cờ tắt vẫn được nhận** (không từ chối): miniapp không gửi nữa, `/merchant` còn gửi nếu người dùng gõ. Tên vẫn được giữ chỗ và kiểm trùng; chỉ là không hiện đâu cho tới khi bật cờ.
- **Làm mới web ngay khi đăng/sửa**: chưa có; làm cần một route `/api/revalidate` có khoá bí mật dùng chung giữa API và web (biến môi trường mới ở 2 dịch vụ). Để dòng nhắc "vài phút".
- **Ảnh base64 của thumbnail sản phẩm** trong `collections[].items[].product.thumbnail` (JSON công khai) chưa tách; chỉ tách ảnh đại diện/ảnh bìa gian hàng. `GET /storefront/me` (view riêng của chủ) vẫn trả base64 như cũ.
- `getPublicByHost` vẫn tra theo subdomain/tên miền riêng khi cờ tắt; chỉ cổng ở middleware (tên miền gốc) và việc không quảng bá link.
- Gian hàng đối tác đã đăng sẵn mà 0 sản phẩm (tạo trước bản sửa) không bị chuyển về nháp (không migrate dữ liệu).
- Lịch sử gỡ/đăng lại chỉ giữ ở các cột mới nhất + `logger.warn` (không có bảng nhật ký chung).
- Dòng "Đổi trả 7 ngày (hàng lỗi NSX)" vẫn là chữ cố định, chưa lấy từ cấu hình.
- `brand/[slug]`: chưa làm canonical và ảnh chia sẻ riêng (chỉ trạng thái rỗng).
- Chủ gian hàng đối tác (MERCHANT) mở `/s/:slug` của chính mình trong miniapp được coi là khách (không có mã giới thiệu để nhận ra chủ); họ chia sẻ từ builder.
- Dòng test `ctv-an.staging.tubutree.com → ctv-an` trong `tenant-subdomain.spec.ts` bị thay: với gốc mặc định nay là `null`, môi trường staging phải đặt `NEXT_PUBLIC_TENANT_ROOT_DOMAIN=staging.tubutree.com` (có test cho cấu hình đó). `docker-compose.prod.yml` không đổi (dùng mặc định `tubutree.com`).
- Gói chạm mã tiền/khách/thông báo (thông báo gỡ/duyệt cho chủ, ghi công qua `commission_eligible_roles`): nên có một lượt review Opus trước khi gộp.

## 4. Câu hỏi cho chủ dự án (mặc định đã dùng)
1. `storefront.require_approval`: bắt buộc duyệt trước khi CTV mới hiện công khai? **Mặc định tắt** (giữ hành vi hiện tại). Tick và "CTV tuyển chọn" luôn chỉ cho gian hàng đã duyệt.
2. `storefront.subdomain_enabled`: **Mặc định tắt** cho tới khi DNS wildcard và chứng chỉ xong. Khi bật, cần đồng bộ `NEXT_PUBLIC_TENANT_ROOT_DOMAIN` của web (mặc định `tubutree.com`).
3. Gian hàng loại CTV do tài khoản ADMIN làm chủ nay bị ẩn (ADMIN không nằm trong `affiliate.commission_eligible_roles` mặc định). **Mặc định: chấp nhận**; nếu cần hiện, thêm `ADMIN` vào khoá đó (ảnh hưởng cả hoa hồng) hoặc báo để tách điều kiện hiển thị.
4. Có cần chặn cứng host `*.tubutree.com` khi cờ subdomain tắt (không chỉ ngừng quảng bá)? **Mặc định không** (middleware không gọi API).
5. Có làm route làm mới web ngay khi đăng/sửa? **Mặc định không**; hiện dòng "cập nhật sau vài phút".
6. Gian hàng đối tác tạo mới từ `/merchant` là nháp tới khi có ≥ 1 sản phẩm và bấm Đăng. **Mặc định: đúng như vậy**.
7. Thêm font Be Vietnam Pro (SIL OFL) vào repo cho ảnh chia sẻ: **mặc định giữ**; nếu không muốn thêm tài sản nhị phân thì phải bỏ chữ khỏi ảnh chia sẻ.
