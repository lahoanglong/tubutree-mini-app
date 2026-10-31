# P11 campaigns: banner, trang chiến dịch, admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** model `Campaign` + API công khai/admin, banner `BannerCarousel` ở Trang chủ (gộp vào phần tĩnh của `GET /home`) và đầu `/offers`, trang `/campaign/:slug` ↔ `/chien-dich/:slug`, tab admin "Chiến dịch", ở Mini App và web.

**Architecture:** API thêm module `campaigns` (Prisma only, không phụ thuộc `CatalogModule` ngược lại): `HomeService` đọc banner qua hàm thuần `listLiveBanners(prisma, …)` nên không vòng module. Banner đi cùng blob `/home` (khối `campaigns`, cache công khai, KHÔNG lọc đối tượng ở máy chủ); app-core lọc `ALL/NEW/RETURNING` theo loại khách và lịch rồi đổi thành `BannerSlide`. Khung chờ giữ chỗ theo gợi ý nhớ (`tubu_home_banner`, cùng mẫu `FLASH_HINT_KEY`); không có chiến dịch thì khối trả null, không giữ chỗ. Web SSR đặt `campaigns` vào `HomeInitial`.

**Tech Stack:** NestJS + Prisma + jest (API), vitest (app-core, Mini, web), React 18 + zmp-ui (Mini), Next 15 (web), Playwright (e2e Mini).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4, §5 "Banner + chiến dịch"), mục P11 của `02-ke-hoach.md`, `review/backend-gap.md` §3a, `review/ia-merch.md` D3, `review/a11y.md` B1 + B8. Bàn giao: `plans/handoff-wave1..3.md`.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`; worktree mới đã chạy `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (apps/api).
- Chữ giao diện tiếng Việt, khoá chữ `campaign.*` đã có ở `shop-copy.ts` (P2); khoá mới phải thêm CẢ `shop-copy.ts` và `shop-copy-budget.ts` (spec bắt thiếu một bên). Không dùng "Top", "Freeship", "Kho voucher", "Nhãn hàng".
- Route mới trong `route-map.json` (`/campaign/:slug` ↔ `/chien-dich/:slug`, `private: false`); `pnpm lint:parity` xanh.
- Banner a11y (review/a11y.md B1) đã nằm trong `BannerCarousel` (P5): tự chạy có nút Dừng, `prefers-reduced-motion`, ≥5s/slide, `inert` slide ngoài khung, tên slide "{title}, i trên n". P11 chỉ gắn dữ liệu, không sửa logic carousel.
- Khối `banner` Trang chủ: không có chiến dịch thì trả null, không khung chờ, không khoảng trống. Có chiến dịch thì chiều cao khối = `aspect-ratio var(--banner-ratio)` (5/2), ghi ở `HOME_SETTLING_HEIGHTS.banner` (137 ở 375px). e2e `home-p6-cls` và `buy-flow-4a` "Danh mục không xê dịch" giữ xanh.
- Chunk vào Mini App ≤700 KB (`node scripts/ci/bundle-budget.cjs apps/miniapp/www`; hiện entry 625 KB, tổng 2106 KB đã quá mốc cảnh báo 2048): trang chiến dịch là chunk theo route (`lazy`), banner Trang chủ giữ `lazy` sẵn có, không thêm thư viện. Ghi số trước/sau.
- Migration chỉ thêm model/enum mới (P12 cũng thêm migration song song: `FlashSaleItem.sortOrder`), không sửa model `FlashSale*`. Tạo bằng `prisma migrate dev` trên DB riêng (cụm 25544).
- Không đụng file của P12/P13/F3 (xem task); `route-map.json`, `shop-copy.ts`, `staff-permissions.matrix.spec.ts`, `app/admin/page.tsx` là file gộp tay: chỉ thêm dòng của gói.
- Không deploy, không đọc/ghi PROD, không push. Comment chỉ giải thích "vì sao".

## Review Focus

1. Chiến dịch hết hạn / chưa tới giờ / tắt / không có slug: `GET /campaigns/:slug` 404 (không lộ bản nháp), web trả HTTP 404 thật, Mini hiện trang 404 thân thiện có lối "Về trang chủ". Test: Task 4 (jest), Task 9 (vitest), Task 11 (e2e).
2. Ảnh banner hỏng (data URL không phục vụ được) hoặc không có: chiến dịch đó bị bỏ khỏi danh sách banner, không slide trống; ảnh lỗi lúc tải rơi về khung chữ (đã có ở `SlideImage`). Test: Task 3.
3. Mốc lịch theo giờ VN, ranh giới `endAt`: `startAt <= now < endAt`; admin nhập giờ VN → ISO `+07:00` bất kể múi giờ máy. Test: Task 3, Task 10.
4. Banner `NEW`/`RETURNING` khi chưa biết loại khách (`unknown`) hoặc khách chưa đăng nhập: `unknown` chỉ thấy `ALL`, khách vãng lai là `new`. Test: Task 6.
5. Trang chủ có 1 banner (không chấm, không nút Dừng), 0 banner sau lọc đối tượng, API 404/lỗi (API cũ chưa có `/campaigns`, khối `campaigns` null): khối ẩn, Trang chủ không lỗi, không gọi thêm request lẻ khi blob đã có. Test: Task 6, Task 7.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `apps/api/prisma/schema.prisma` + `migrations/20261101090000_campaigns/migration.sql` | model `Campaign`, `CampaignProduct`, `CampaignCoupon`, 3 enum; quan hệ ngược trên `Product`, `Coupon` |
| `apps/api/src/common/public-image.ts`, `modules/catalog/public-image.service.ts` | thêm loại ảnh `campaign` (slot `cover`) |
| `apps/api/src/modules/campaigns/campaign-public.ts` | hàm thuần: `liveWhere`, `audienceMatches`, `toBannerDTO`, `listLiveBanners` |
| `apps/api/src/modules/campaigns/campaigns.service.ts`, `campaigns.controller.ts` | `GET /campaigns`, `/campaigns/:slug`, `/campaigns/:slug/products` |
| `apps/api/src/modules/campaigns/campaigns-admin.service.ts`, `campaigns-admin.controller.ts`, `dto/campaign.dto.ts` | `/admin/campaigns` CRUD, đặt sản phẩm, đặt mã |
| `apps/api/src/modules/campaigns/campaigns.module.ts`, `app.module.ts` | nối module |
| `apps/api/src/modules/catalog/catalog.service.ts` | thêm `cardsByIds(ids)` (thẻ công khai theo đúng thứ tự `ids`) |
| `apps/api/src/modules/catalog/home.service.ts` | khối `campaigns` trong phần tĩnh |
| `packages/app-core/src/api/campaign.ts`, `queries/campaign.ts`, `commerce/campaign.ts` | kiểu, hàm gọi API, query, luật lọc đối tượng/lịch, `campaignHref`, slide, chữ ngày |
| `packages/app-core/src/api/home.ts`, `home-feed.ts`, `home-layout.ts`, `route-map.json`, `shop-copy*.ts` | khối `campaigns` của `/home`, ánh xạ request lẻ, gợi ý khung chờ + chiều cao banner, route, chữ |
| `apps/miniapp/src/services/campaign-api.ts`, `hooks/use-home-banners.ts`, `components/home/home-banner.tsx`, `home-settling.tsx`, `pages/home.tsx` | banner Trang chủ Mini |
| `apps/miniapp/src/components/campaign/campaign-banner.tsx`, `pages/offers.tsx` | banner đầu `/offers` |
| `apps/miniapp/src/pages/campaign.tsx`, `components/app.tsx` | trang chiến dịch (chunk theo route) |
| `apps/web/src/lib/home-initial.ts`, `components/home/home-view.tsx`, `home-settling.tsx`, `components/campaign/*`, `app/uu-dai/page.tsx` | banner Trang chủ + `/uu-dai` web |
| `apps/web/src/app/chien-dich/[slug]/{page,not-found}.tsx`, `components/campaign/campaign-body.tsx` | trang chiến dịch web (HTTP 404 thật) |
| `apps/web/src/components/admin/campaigns-tab.tsx`, `lib/admin-campaigns-client.ts`, `app/admin/page.tsx` | tab admin "Chiến dịch" |
| `apps/e2e/tests/campaigns.miniapp.spec.ts`, `support/campaign-mocks.ts` | e2e Mini |

---

### Task 1: Prisma model + migration

**Files:** Modify `apps/api/prisma/schema.prisma` (thêm cuối nhóm khuyến mãi; `Product` thêm `campaignLinks CampaignProduct[]`, `Coupon` thêm `campaignLinks CampaignCoupon[]`); Create migration qua `prisma migrate dev`.

**Interfaces — Produces:** enum `CampaignPlacement { HOME_TOP OFFERS_TOP }`, `CampaignLinkType { CAMPAIGN_PAGE PRODUCT CATEGORY URL_INTERNAL }`, `CampaignAudience { ALL NEW RETURNING }`. `Campaign { id cuid, slug @unique, title, subtitle?, placement, image String, linkType @default(CAMPAIGN_PAGE), linkValue?, audience @default(ALL), startAt, endAt, sortOrder Int @default(0), isActive @default(true), products, coupons, createdAt, updatedAt; @@index([placement, isActive, startAt, endAt]); @@map("campaigns") }`; `CampaignProduct { campaignId, productId, sortOrder; @@id([campaignId, productId]); @@index([productId]); onDelete Cascade cả hai phía; @@map("campaign_products") }`; `CampaignCoupon` tương tự với `couponId` (`campaign_coupons`).

- [ ] **Step 1:** dựng cụm riêng `bash docs/2026-10-20-uat/tools/pg-native.sh start 25544`, tạo DB `tubutree_it` (`createdb` qua `psql -p 25544`), `export DATABASE_URL=postgresql://tubu@127.0.0.1:25544/tubutree_it`.
- [ ] **Step 2:** sửa schema; `cd apps/api && npx prisma migrate dev --name campaigns` (chạy toàn bộ migration cũ + migration mới). Mong đợi: tạo `migrations/<ts>_campaigns/migration.sql` chỉ có `CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX`, FK của 3 bảng mới.
- [ ] **Step 3:** `git diff --stat` chỉ gồm schema + thư mục migration mới (không `ALTER` nào lên bảng cũ); `npx prisma generate`; `npx tsc --noEmit -p tsconfig.json` trong apps/api xanh.
- [ ] **Step 4: Commit** `feat(api): model Campaign, CampaignProduct, CampaignCoupon và migration`.

### Task 2: Loại ảnh `campaign`

**Files:** Modify `apps/api/src/common/public-image.ts` (`PublicImageKind` thêm `'campaign'`, `isPublicImageKind`, slot `cover`), `modules/catalog/public-image.service.ts` (nhánh `campaign`: chỉ chiến dịch `isActive`, slot `cover`, đọc cột `image`); Test `modules/catalog/public-image.service.spec.ts`, `common/public-image.spec.ts` (nếu có).

- [ ] **Step 1: test đỏ:** `isPublicImageKind('campaign') === true`; `service.get('campaign', 'c1', 'cover', v)` trả ảnh khi `prisma.campaign.findFirst` có `{ image: <data URL png> }` và `versionOk` đúng với `publicImageVersion('campaign','c1','cover',image)`; slot khác `cover` → `NotFoundException`; chiến dịch không có/`isActive=false` → `NotFoundException`.
- [ ] **Step 2:** chạy `npx jest src/modules/catalog/public-image.service.spec.ts` → FAIL.
- [ ] **Step 3:** implement (nhánh `campaign` đặt trước `else` của `academy`, `findFirst({ where: { id, isActive: true }, select: { image: true } })`; không lọc theo lịch: ảnh vẫn phát cho trang đã mở trong tab).
- [ ] **Step 4:** chạy lại → PASS. **Step 5: Commit** `feat(api): ảnh công khai loại campaign`.

### Task 3: Lọc banner theo lịch + đối tượng (hàm thuần)

**Files:** Create `apps/api/src/modules/campaigns/campaign-public.ts`, `campaign-public.spec.ts`.

**Interfaces — Produces:**
```ts
export const BANNER_FETCH_LIMIT = 10;
export interface CampaignBannerDTO { id: string; slug: string; title: string; image: string; linkType: CampaignLinkType; linkValue: string | null; audience: CampaignAudience; startAt: string; endAt: string }
export function liveWhere(now: Date, placement?: CampaignPlacement): Prisma.CampaignWhereInput; // isActive, startAt <= now, endAt > now
export function audienceMatches(audience: CampaignAudience, wanted?: 'NEW' | 'RETURNING'): boolean; // wanted thiếu → true; ALL luôn true
export function toBannerDTO(row: CampaignRow): CampaignBannerDTO | null; // image qua publicImage('campaign', id, 'cover', …); null khi không phục vụ được
export function listLiveBanners(prisma: Pick<PrismaService,'campaign'>, placement: CampaignPlacement, opts?: { now?: Date; audience?: 'NEW' | 'RETURNING' }): Promise<CampaignBannerDTO[]>; // xếp sortOrder↑, startAt↓, id↑; tối đa BANNER_FETCH_LIMIT
```
- [ ] **Step 1: test đỏ:** `liveWhere` ghi `startAt: { lte: now }`, `endAt: { gt: now }` (hai ca biên: `endAt === now` không nằm trong where vì `gt`); `audienceMatches('ALL','NEW')` true, `('NEW','RETURNING')` false, `('RETURNING', undefined)` true; `toBannerDTO` trả null với `image: 'data:image/svg+xml;base64,PHN2Zz4='` và với `image: ''`, trả link nguyên với `https://...`, trả `/public-image/campaign/c1/cover?v=` với PNG base64; `listLiveBanners` gọi `findMany` với `orderBy [{sortOrder:'asc'},{startAt:'desc'},{id:'asc'}]`, `take: 10`, bỏ chiến dịch `toBannerDTO` null, lọc `audience: 'NEW'` giữ `ALL` + `NEW` (bỏ `RETURNING`).
- [ ] **Step 2:** chạy `npx jest src/modules/campaigns/campaign-public.spec.ts` → FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5: Commit** `feat(api): lọc banner chiến dịch theo lịch và đối tượng`.

### Task 4: API công khai `/campaigns`

**Files:** Create `campaigns.service.ts`, `campaigns.controller.ts`, `dto/campaign-query.dto.ts`, `campaigns.module.ts` (+ spec mỗi file); Modify `catalog.service.ts` (`cardsByIds`), `app.module.ts`.

**Interfaces — Consumes:** Task 3. **Produces:**
```ts
// CatalogService
cardsByIds(ids: readonly string[]): Promise<ReturnType<CatalogService['toCards']> extends Promise<infer R> ? R : never>; // PUBLIC_PRODUCT_WHERE, giữ thứ tự ids
// CampaignsService
listPublic(placement: CampaignPlacement, audience?: 'NEW' | 'RETURNING'): Promise<CampaignBannerDTO[]>;
getPublic(slug: string, now?: Date): Promise<CampaignDetailDTO>; // 404 NotFoundException khi không có / tắt / chưa tới giờ / hết hạn
getProducts(slug: string, page: number, limit: number): Promise<PageResponse<Card>>; // theo CampaignProduct.sortOrder, chỉ sản phẩm công khai
interface CampaignDetailDTO extends Omit<CampaignBannerDTO,'image'> { image: string | null; subtitle: string | null; productCount: number; coupons: { code: string; type: CouponType; value: number; minOrder: number | null; maxDiscount: number | null; endAt: string }[] }
```
Route: `@Public() @PublicCache('CATALOG')` cho cả ba; `GET /campaigns` bắt buộc `placement` (`IsEnum`), `audience` tuỳ chọn (`IsIn(['NEW','RETURNING'])`); `GET /campaigns/:slug/products?page&limit` dùng `PaginationQuery` sẵn có (tối đa 100/trang).
Mã gắn kèm chỉ hiện khi: `isActive`, trong `[startAt, endAt)`, scope `PUBLIC` hoặc `CLAIM`, `batch == null`, chưa hết lượt (`usageLimit == null || usedCount < usageLimit`).

- [ ] **Step 1: test đỏ** (`campaigns.service.spec.ts`, prisma giả): `getPublic` ném `NotFoundException` khi `findFirst` trả null (where có `liveWhere` và `slug`); trả `image: null` khi ảnh không phục vụ được nhưng vẫn trả chiến dịch; lọc mã: mã `TIER`, mã có `batch`, mã hết hạn, mã hết lượt, mã `isActive=false` bị bỏ, mã `PUBLIC` còn hạn được giữ; `getProducts` ném 404 như trên, gọi `catalog.cardsByIds` đúng lát trang (`page=2, limit=2` từ 5 id → id thứ 3, 4), `meta.total` = số sản phẩm công khai; controller spec: metadata `PublicCache` = `CATALOG`, `placement` thiếu/lạ → 400 qua `ValidationPipe`.
- [ ] **Step 2:** `npx jest src/modules/campaigns` → FAIL. **Step 3:** implement; `CampaignsModule` imports `CatalogModule` (không ngược lại). **Step 4:** PASS + `npx jest src/modules/catalog/catalog.service.spec.ts` xanh (thêm test `cardsByIds` giữ thứ tự, bỏ sản phẩm ẩn/chưa duyệt, mảng rỗng → `[]` không gọi DB).
- [ ] **Step 5: Commit** `feat(api): GET /campaigns, /campaigns/:slug, /campaigns/:slug/products`.

### Task 5: API admin `/admin/campaigns`

**Files:** Create `campaigns-admin.service.ts`, `campaigns-admin.controller.ts`, `dto/campaign.dto.ts` (+ spec); Modify `modules/campaigns/campaigns.module.ts`, `common/staff-permissions.matrix.spec.ts` (dòng của gói).

**Interfaces — Produces:** controller `@Roles('ADMIN') @AllowStaff('MARKETING') @Controller('admin/campaigns')`:
`GET /` (`?placement=`) → `AdminCampaignRow[]` {id, slug, title, subtitle, placement, image (tham chiếu công khai cho ảnh nhỏ), linkType, linkValue, audience, startAt, endAt, sortOrder, isActive, productCount, couponCount, status: 'live'|'scheduled'|'ended'|'off'}; `GET /:id` (ảnh nguyên bản, `products: {id,name,slug}[]`, `couponCodes: string[]`); `POST /`; `PATCH /:id`; `DELETE /:id`; `PUT /:id/products {productIds: string[]}` (≤200, thay hết, `sortOrder` = chỉ số); `PUT /:id/coupons {codes: string[]}` (≤10; mã lạ, mã có `batch`, scope ngoài `PUBLIC/CLAIM` → 400 nêu mã).
DTO: `title` 1..120, `subtitle` ≤200, `slug` tuỳ chọn `^[a-z0-9]+(-[a-z0-9]+)*$` ≤80 (thiếu thì sinh từ `title` không dấu, trùng thì 409), `placement`, `audience`, `image` `@IsNotEmpty() @IsImageRef() @MaxLength(1_500_000)`, `linkType` + `linkValue` (CAMPAIGN_PAGE: bỏ qua giá trị; PRODUCT/CATEGORY: slug `^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$`; URL_INTERNAL: bắt đầu `/`, không `//`, không khoảng trắng, ≤200), `startAt`/`endAt` `IsDateString`, `endAt > startAt` (400), `sortOrder` int 0..9999, `isActive`.

- [ ] **Step 1: test đỏ:** DTO (`plainToInstance` + `validate`): `image` `javascript:`, `http:`, SVG bị chặn, https và PNG base64 qua; `linkType=URL_INTERNAL` với `//evil.com`, `https://x`, `/a b` bị chặn, `/offers` qua; `endAt <= startAt` → service ném `BadRequestException`; service: `create` sinh slug `chien-dich-giua-thu` từ "Chiến dịch Giữa Thu", trùng slug → `ConflictException`; `setCoupons` từ chối mã có `batch` và mã scope `TIER` kèm tên mã trong thông báo; `setProducts` từ chối >200; `list` tính `status` đúng ở các ca `isActive=false` (off), `startAt>now` (scheduled), `endAt<=now` (ended), còn lại live. Matrix: 7 dòng `'GET /admin/campaigns'`, `'POST /admin/campaigns'`, `'GET /admin/campaigns/:id'`, `'PATCH /admin/campaigns/:id'`, `'DELETE /admin/campaigns/:id'`, `'PUT /admin/campaigns/:id/products'`, `'PUT /admin/campaigns/:id/coupons'` đều `[MARKETING]`.
- [ ] **Step 2:** `npx jest src/modules/campaigns src/common/staff-permissions.matrix.spec.ts` → FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5: Commit** `feat(api): quản trị chiến dịch (CRUD, sản phẩm, mã gắn kèm)`.

### Task 6: Banner trong `/home` (API) + luật dùng chung (app-core)

**Files:** Modify `apps/api/src/modules/catalog/home.service.ts` (+ `home.service.spec.ts`); Create `packages/app-core/src/api/campaign.ts`, `commerce/campaign.ts`, `queries/campaign.ts` (+ spec mỗi file); Modify `api/home.ts`, `home-feed.ts`, `home-layout.ts`, `route-map.json`, `shop-copy.ts` + `shop-copy-budget.ts`, specs liên quan (`home-layout.spec.ts`, `home-feed.spec.ts`).

**Interfaces — Produces (app-core):**
```ts
// api/campaign.ts
export type CampaignPlacement = 'HOME_TOP' | 'OFFERS_TOP';
export type CampaignLinkType = 'CAMPAIGN_PAGE' | 'PRODUCT' | 'CATEGORY' | 'URL_INTERNAL';
export type CampaignAudience = 'ALL' | 'NEW' | 'RETURNING';
export interface CampaignBanner { id: string; slug: string; title: string; image: string; linkType: CampaignLinkType; linkValue: string | null; audience: CampaignAudience; startAt: string; endAt: string }
export interface CampaignCouponDTO { code: string; type: CouponDTO['type']; value: number; minOrder: number | null; maxDiscount: number | null; endAt: string }
export interface CampaignDetail extends Omit<CampaignBanner, 'image'> { image: string | null; subtitle: string | null; productCount: number; coupons: CampaignCouponDTO[] }
export const fetchCampaigns = (http: HttpClient, placement: CampaignPlacement): Promise<CampaignBanner[]>; // GET /campaigns?placement=
export const fetchCampaign = (http: HttpClient, slug: string): Promise<CampaignDetail>;
export const fetchCampaignProducts = (http: HttpClient, slug: string, q?: { page?: number; limit?: number }): Promise<PageResponse<ProductCard>>;
// queries/campaign.ts
campaignsQuery(http, placement) → { queryKey: ['campaigns', placement], queryFn }; campaignQuery(http, slug) → ['campaign', slug]; campaignProductsQuery(http, slug, page) → ['campaign-products', slug, page]
// commerce/campaign.ts
export const CAMPAIGN_SLIDES_MAX = 5; export const CAMPAIGN_PRODUCTS_PAGE = 20;
export function campaignVisible(c: Pick<CampaignBanner,'audience'|'startAt'|'endAt'>, o: { kind: HomeKindState; now?: number }): boolean; // now thiếu → bỏ qua kiểm lịch (web trước hydrate)
export function campaignHref(c: Pick<CampaignBanner,'slug'|'linkType'|'linkValue'>, platform: 'mini' | 'web'): string | null; // null khi đích không hợp lệ
export function campaignSlides(list: readonly CampaignBanner[] | null | undefined, o: { kind: HomeKindState; platform: 'mini'|'web'; now?: number }): { id: string; image: string; alt: string; href: string }[]; // lọc, bỏ href null, tối đa 5
export const CAMPAIGN_INTERNAL_TARGETS: readonly { value: string; label: string; web: string }[];
export function campaignDateRange(c: Pick<CampaignBanner,'startAt'|'endAt'>): string; // "Từ 01/11 đến 11/11" giờ VN, khoá campaign.dateRange
export function campaignVoucherViews(coupons: readonly CampaignCouponDTO[], now: number): VoucherView[]; // voucherView + sortVouchers
// home-layout.ts
export const BANNER_HINT_KEY = 'tubu_home_banner'; readBannerHint(storage: MemoryStorage | null): boolean; writeBannerHint(storage: MemoryStorage | null, has: boolean): void;
HOME_SETTLING_HEIGHTS.banner = 137
// api/home.ts: HomePublicDTO.campaigns: Block<CampaignBanner[]>
```
Luật: `audience ALL` luôn thấy; `NEW` chỉ khi `kind==='new'`; `RETURNING` chỉ khi `kind==='returning'`; `unknown` chỉ `ALL`. `campaignHref` Mini/web: `CAMPAIGN_PAGE` → `/campaign/{slug}` · `/chien-dich/{slug}`; `PRODUCT` → `/product/{v}` · `/san-pham/{v}`; `CATEGORY` → `/browse?category={v}` · `/san-pham?category={v}`; `URL_INTERNAL` → tra `CAMPAIGN_INTERNAL_TARGETS` theo `value` (route Mini) rồi qua `liveRoute(value, platform)`; giá trị lạ → null. Targets: `/offers`→`/uu-dai`, `/browse`→`/san-pham`, `/flash-sale`→`/gio-vang`, `/best-sellers`→`/ban-chay`, `/vouchers`→`/ma-giam-gia`, `/group-buy`→`/mua-chung`, `/rewards`→`/kho-qua`. `takeHomeRequest`: `/campaigns` với đúng khoá `placement` = `HOME_TOP` → `feed.takePublic('campaigns')`, mọi dạng khác (OFFERS_TOP, có `audience`) → null.

- [ ] **Step 1: test đỏ API:** `getPublic` của `HomeService` có khối `campaigns` = `listLiveBanners(prisma,'HOME_TOP')` (gọi không có `audience`), khối lỗi/quá hạn → `null` mà các khối khác còn nguyên; blob cache dùng chung (một lần gọi `findMany` cho hai request cùng TTL).
- [ ] **Step 2: test đỏ app-core:** `campaignVisible` 4 loại khách × 3 đối tượng, ranh giới `endAt === now` ẩn, `startAt === now` hiện, `now` thiếu bỏ lịch; `campaignHref` đủ 4 loại × 2 nền + `URL_INTERNAL` lạ/`//x`/`https://x` → null + `/flash-sale` ra `/offers` (đang chờ P12) hoặc `/gio-vang` theo `liveRoute`; `campaignSlides` tối đa 5, `alt === title`, bỏ slide href null; `campaignDateRange` đúng ngày giờ VN (UTC 17:30 ngày 10/11 → "11/11"); `campaignVoucherViews` sắp hết hạn trước, `state === 'saved'`; `readBannerHint/writeBannerHint` (kho null, ném lỗi, giá trị lạ → false); `HOME_SETTLING_HEIGHTS.banner === Math.round((375 - 32) / 2.5)`; `takeHomeRequest('/campaigns', {placement:'HOME_TOP'})` lấy khối, `OFFERS_TOP` hoặc thêm `audience` → null; `fetchCampaigns` gọi `/campaigns` với `query: { placement }`; `shelves.spec.ts`/`route-map-parity.spec.ts` xanh với dòng route mới; `shop-copy.spec.ts` xanh với khoá chữ mới (nếu thêm: `campaign.copyCode`="Sao chép mã", `campaign.productsEmpty`="Chương trình chưa có sản phẩm", `campaign.backHome`="Về trang chủ").
- [ ] **Step 3:** `npx jest src/modules/catalog/home.service.spec.ts` và `cd packages/app-core && npx vitest run src/commerce/campaign.spec.ts src/api/campaign.spec.ts src/queries/campaign.spec.ts src/home-layout.spec.ts src/home-feed.spec.ts src/route-map-parity.spec.ts src/shop-copy.spec.ts` → FAIL.
- [ ] **Step 4:** implement rồi chạy lại → PASS. **Step 5: Commit** (hai commit: `feat(api): banner chiến dịch trong /home`, `feat(app-core): luật banner/chiến dịch, query, gợi ý khung chờ, route`).

### Task 7: Banner Trang chủ Mini App

**Files:** Create `apps/miniapp/src/services/campaign-api.ts`; Modify `hooks/use-home-banners.ts`, `components/home/home-banner.tsx`, `home-banner.spec.tsx`, `home-settling.tsx` (+ spec), `pages/home.tsx`, `pages/home.spec.tsx` (nếu mock cần).

**Interfaces:** `fetchHomeCampaigns(): Promise<CampaignBanner[]>` = `(await takePublicBlock('campaigns')) ?? fetchCampaigns(coreHttp,'HOME_TOP')`. `useHomeBanners(kind: HomeKindState): { slides: BannerSlide[]; loading: boolean }` (`useQuery(['campaigns','HOME_TOP'], staleTime 60s, retry:false)`; `slides = campaignSlides(data, { kind, platform:'mini', now: serverNow() })`; `writeBannerHint(browserStorage(), slides.length>0)` khi query xong). `HomeBanner({ kind }: { kind: HomeKindState })`: có slide → `<BannerCarousel>` (lazy, đệm ngang 16); loading + gợi ý true → khung `data-testid="home-banner-loading"` `aspect-ratio: var(--banner-ratio)`; còn lại null. `HomeSettlingSkeleton({ categoryCells?, banner?: boolean })`: `banner` đứng đầu, `Skeleton` cao `aspect-ratio` banner.

- [ ] **Step 1: test đỏ** (vitest, mock `fetchHomeCampaigns`): không chiến dịch → `container` rỗng; 2 chiến dịch `ALL` → region "Chương trình nổi bật" có nút "Dừng tự chuyển" (`aria-pressed=false`), 2 slide tên "{title}, 1 trên 2"; 1 chiến dịch → không nút Dừng, không chấm; kind `returning` ẩn chiến dịch `NEW`; kind `unknown` chỉ `ALL`; API lỗi (reject) → rỗng, không ném; gợi ý `tubu_home_banner='1'` + đang tải → có `home-banner-loading`, xong rỗng thì ghi gợi ý `'0'`; `HomeSettlingSkeleton banner` có phần tử banner cao đúng tỉ lệ; `home.tsx` truyền `kind` (spec cũ `home-blocks` giữ xanh).
- [ ] **Step 2:** `cd apps/miniapp && npx vitest run src/components/home src/hooks/use-home-banners.spec.ts` → FAIL. **Step 3:** implement; `useHomeSettling` đã chờ `flashQuery`, thêm `campaigns.loading` vào `dataPending` trong `home.tsx`. **Step 4:** PASS. **Step 5: Commit** `feat(miniapp): banner chiến dịch ở Trang chủ`.

### Task 8: Trang chiến dịch Mini + banner `/offers`

**Files:** Create `apps/miniapp/src/pages/campaign.tsx` (+ spec), `components/campaign/campaign-banner.tsx` (+ spec); Modify `components/app.tsx` (`CampaignPage = lazy(...)`, `<Route path="/campaign/:slug">` trước `*`), `pages/offers.tsx` (một dòng `<CampaignBanner placement="OFFERS_TOP" />` ngay dưới `PageHeader`, ngoài nhánh đăng nhập; không đổi phần còn lại), `packages/app-core/src/route-map.json` (đã ở Task 6).

**Interfaces:** `CampaignBanner({ placement, kind })` dùng chung hook theo `placement` (Offers: `kind = authed ? readStoredHomeKind(userId) ?? 'unknown' : 'new'`; không khung chờ, không gợi ý). `pages/campaign.tsx` (default export): `useParams().slug`; `useQuery(campaignQuery)` + `useQuery(campaignProductsQuery(slug,1))` + "Xem thêm" nạp trang kế (`CAMPAIGN_PRODUCTS_PAGE`); bố cục: `PageHeader` (tên cố định "Chương trình"), ảnh đầu `aspect-ratio var(--banner-ratio)` (không có ảnh thì bỏ), `h1` tiêu đề, phụ đề, `campaignDateRange`, vùng mã `section aria-label=campaign.sectionCoupons` với `h2` + `VoucherTicket variant="ticket"` (primary "Sao chép" gọi `useCouponUse().copy(code)`, an toàn cho khách), vùng sản phẩm `section aria-label=campaign.sectionProducts` với `h2` + `ProductGrid variant="grid"`. Lỗi `isNotFoundError` → `EmptyState` `heading=campaign.endedTitle` `body=campaign.endedBody` `ctaLabel=campaign.backHome` `onCta → navigate('/', {replace:true})`; lỗi khác → `ErrorState` + Thử lại. Khách chưa đăng nhập xem được (không `AuthPhaseView`).

- [ ] **Step 1: test đỏ:** trang: có đủ ảnh, `h1`, 1 `h2` mỗi khối, vé mã bấm "Sao chép" gọi `copy`, lưới sản phẩm, khối mã/sản phẩm rỗng thì không vẽ tiêu đề trơ trọi (sản phẩm rỗng: `campaign.productsEmpty`); 404 → thấy "Chương trình đã kết thúc" + nút "Về trang chủ" bấm điều hướng `/`; 500 → "Thử lại"; guest (`useAuthStore` chưa đăng nhập) vẫn thấy nội dung. `CampaignBanner`: 0 chiến dịch → rỗng; offers có `ALL` thấy, `NEW` với `kind='unknown'` ẩn; `offers.tsx` spec cũ xanh và có banner khi mock có chiến dịch OFFERS_TOP.
- [ ] **Step 2:** `npx vitest run src/pages/campaign.spec.tsx src/components/campaign src/pages/offers` → FAIL. **Step 3:** implement. **Step 4:** PASS (+ `ds-shop-guard.spec`, `a11y-click-targets.spec` xanh). **Step 5: Commit** `feat(miniapp): trang chiến dịch và banner đầu Ưu đãi`.

### Task 9: Web Trang chủ + `/uu-dai` + trang chiến dịch

**Files:** Modify `apps/web/src/lib/home-initial.ts` (`campaigns` trong `HomeInitial`, lỗi thì bỏ phần đó), `components/home/home-view.tsx` (`banner:` thay `null`; `useQuery(campaignsQuery(coreHttp,'HOME_TOP'))` với `initialData`), `components/home/home-settling.tsx`, `app/uu-dai/page.tsx` (một khối banner đầu trang); Create `components/campaign/home-banner.tsx`, `components/campaign/campaign-body.tsx`, `app/chien-dich/[slug]/page.tsx`, `app/chien-dich/[slug]/not-found.tsx` (+ spec mỗi file).

**Interfaces:** `HomeBanner({ kind, initial? }: …)` web: slide qua `campaignSlides({platform:'web', now: hydrated ? serverNow() : undefined})`, `BannerCarousel` của `@/components/mini`; hint theo `useSyncExternalStore` như `flash-sale.tsx`. `page.tsx` (server, `revalidate = 60`): `fetchCampaign(createServerHttp(), slug)`; `ApiNotFoundError` → `notFound()` (HTTP 404 thật), lỗi khác ném để Next giữ bản cũ; `generateMetadata` đặt `title`, `openGraph.images`; thân trang `CampaignBody` (client: ảnh `<img>` đầu, `h1`, ngày, `VoucherTicket` + `useCouponUse().copy`, `ProductGrid` phân trang "Xem thêm"). `not-found.tsx`: như `brand/[slug]/not-found.tsx`, chữ `campaign.endedTitle/endedBody/backHome`, nút về `/`.

- [ ] **Step 1: test đỏ:** `loadHomeInitial` có `campaigns` khi API trả, thiếu khi API lỗi và các phần khác không đổi; `HomeView` có `[data-home-block="banner"]` với slide khi `initial.campaigns` có, không có gì (`banner` rỗng, không chừa cột HubLayout) khi rỗng; page chiến dịch: `fetchCampaign` ném `ApiNotFoundError` → page ném `NEXT_NOT_FOUND`; trả chiến dịch → render `h1`, vé mã, lưới; `uu-dai` có banner khi có chiến dịch OFFERS_TOP.
- [ ] **Step 2:** `cd apps/web && npx vitest run src/lib/home-initial src/components/home src/components/campaign src/app/chien-dich src/app/uu-dai` → FAIL. **Step 3:** implement. **Step 4:** PASS (+ `ds-shop-guard.spec`, `route-map` specs, `sitemap.spec` xanh). **Step 5: Commit** `feat(web): banner chiến dịch ở Trang chủ, Ưu đãi và trang /chien-dich/[slug]`.

### Task 10: Tab admin "Chiến dịch" (web)

**Files:** Create `apps/web/src/lib/admin-campaigns-client.ts`, `components/admin/campaigns-tab.tsx` (+ spec); Modify `apps/web/src/app/admin/page.tsx` (ba dòng: `Tab` thêm `'campaigns'`, nhóm "Khuyến mãi và điểm" thêm `{ k: 'campaigns', label: 'Chiến dịch' }`, `STAFF_TABS.MARKETING` thêm `'campaigns'`, render `{active === 'campaigns' && <CampaignsTab />}`), `admin-nav` spec nếu đếm mục.

**Interfaces:** client: `listAdminCampaigns(placement?)`, `getAdminCampaign(id)`, `createAdminCampaign(body)`, `updateAdminCampaign(id, body)`, `deleteAdminCampaign(id)`, `setAdminCampaignProducts(id, ids)`, `setAdminCampaignCoupons(id, codes)` (dùng `apiFetch`, kiểu theo Task 5). `CampaignsTab`: chip lọc "Tất cả / Đầu Trang chủ / Đầu Ưu đãi" (`aria-pressed`), mỗi dòng: ảnh nhỏ, tên, khoảng ngày (giờ VN), nhãn trạng thái (Đang chạy / Sắp chạy / Đã kết thúc / Đang tắt), nút Bật/Tắt (`updateAdminCampaign(id,{isActive})`), Sửa, Xoá (hỏi `useConfirm`). Form tạo/sửa: tên, phụ đề, slug (chỉ khi tạo), vị trí, đối tượng, `ImageUrlField` ảnh banner (ghi chú tỉ lệ 5:2), đích bấm (`CAMPAIGN_PAGE` / sản phẩm bằng `ProductPicker mode="product"`... lấy slug qua tên: dùng ô nhập slug / danh mục nhập slug / `URL_INTERNAL` chọn trong `CAMPAIGN_INTERNAL_TARGETS`), `VnDateTimeInput` bắt đầu và kết thúc (đổi qua `vnDateTimeISO`), thứ tự, sản phẩm (danh sách + `ProductPicker mode="product"`), mã gắn kèm (ô nhập mã cách nhau bởi dấu phẩy/xuống dòng).

- [ ] **Step 1: test đỏ:** liệt kê gọi `listAdminCampaigns(undefined)` rồi `('HOME_TOP')` khi bấm chip; nút Tắt gọi `update(id,{isActive:false})` và làm mới danh sách; tạo: ISO gửi lên là `+07:00` (nhập 01/11/2026 00:00 → `2026-10-31T17:00:00.000Z`); `endAt <= startAt` chặn gửi và báo lỗi; chọn `URL_INTERNAL` ẩn ô giá trị tự do, chỉ liệt kê đích hợp lệ; xoá chỉ chạy sau xác nhận; STAFF có nhóm MARKETING vào được tab (spec trang admin).
- [ ] **Step 2:** `cd apps/web && npx vitest run src/components/admin/campaigns-tab.spec.tsx src/app/admin/page.spec.tsx src/components/admin/admin-nav.spec.tsx` → FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5: Commit** `feat(web): tab quản trị Chiến dịch`.

### Task 11: e2e Mini + đo bundle + chụp ảnh

**Files:** Create `apps/e2e/tests/support/campaign-mocks.ts` (`mockCampaigns(api, { home?, offers?, detail? })`, ảnh banner là data-URI SVG không mạng), `apps/e2e/tests/campaigns.miniapp.spec.ts`; Modify `apps/e2e/tests/support/tour.ts` (thêm `TOUR['/offers']` chưa có từ base, nếu chạm được mà không đụng gói khác).

- [ ] **Step 1: spec đỏ** (WebKit 375×812, API mock, không `waitForTimeout`): (a) không chiến dịch: không phần tử `[data-home-block="banner"]` có chiều cao, màn đầu giữ "Giờ vàng trong 812" như `home-p6`; (b) 2 chiến dịch HOME_TOP (`ALL` + `NEW`, khách mới): carousel hiện, nút "Dừng tự chuyển" bấm được (`aria-pressed`), chiều cao khối = 137±1px, bấm slide tới trang chiến dịch; `RETURNING`-only không hiện với khách mới; (c) trang chiến dịch khách chưa đăng nhập: ảnh, h1, mã, lưới SP; (d) chiến dịch hết hạn (mock 404) → "Chương trình đã kết thúc" + "Về trang chủ" về `/`; (e) `/offers` có banner OFFERS_TOP trên cùng; (f) CLS (Chromium, như `home-p6-cls`): gợi ý `tubu_home_banner='1'` + dữ liệu về muộn ≤ 0,02.
- [ ] **Step 2:** `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3311 npx playwright test campaigns.miniapp home-p6 buy-flow-4a --workers=1` → FAIL trước khi code Task 7/8 xong; sau đó PASS.
- [ ] **Step 3:** đo bundle trước/sau (`git stash` không dùng: đo base bằng log gate cũ `gate-integ-w3.txt`: entry 625 KB, tổng 2106 KB) bằng `node scripts/ci/bundle-budget.cjs apps/miniapp/www` sau `vite build`; ghi vào PROGRESS/notes.
- [ ] **Step 4:** chụp 375px Mini (cổng 3311) và web (cổng 3312): Trang chủ có banner, `/offers`, trang chiến dịch, 404; lưu `docs/2026-10-31-shop-redesign/screens/P11/`; so hai bản; tắt server.
- [ ] **Step 5: Commit** `test(e2e): banner và trang chiến dịch Mini App`.

### Task 12: Gate cuối

- [ ] **Step 1:** `bash docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/shop-P11 --base 77433c0d0 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-P11.txt` (một lần). Mong đợi: 0 `FAIL`; FAIL nào thì so với base (worktree tạm) để ghi "có sẵn" hay sửa.
- [ ] **Step 2:** race spec liên quan (không đụng tiền nhưng chạy bộ nhỏ để chắc migration áp được): `DATABASE_URL=postgresql://tubu@127.0.0.1:25544/tubutree_it npx jest -c test/integration-race/jest.config.js --runInBand <một spec nhỏ có sẵn>`; dừng cụm `pg-native.sh stop 25544`.
- [ ] **Step 3:** bộ e2e Mini đầy đủ (tắt server chụp ảnh trước): `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3311 npx playwright test --workers=2 --reporter=line`; test cũ đỏ vì thiết kế đã chốt thì sửa theo thiết kế và ghi notes, đỏ vì hồi quy thì sửa mã.
- [ ] **Step 4:** cập nhật plan này mục "Điều chỉnh lúc làm" nếu lệch; commit `docs(P11): bàn giao`.

## Điều chỉnh lúc làm

(điền khi làm)
