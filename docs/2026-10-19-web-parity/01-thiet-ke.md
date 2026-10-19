# 01 — Thiết kế hai nền tảng

Mục tiêu: web có đủ chức năng Mini App (xem `00-ma-tran.md`), và từ nay một chức năng mới chỉ viết logic một lần.

Nguyên tắc: **chia sẻ logic, không chia sẻ giao diện.** Mini App giữ zmp-ui + react-router. Web giữ Next 14 App Router + Tailwind + `@tubutree/design-tokens`. Phần chung đi vào `packages/app-core`.

Bản này đã sửa theo review Opus lần 1 (16 mục, xem cuối file).

## 1. `packages/app-core`

- Tên `@tubutree/app-core`, `private`, xuất **mã nguồn TS** (không build): `"exports": { "./*": "./src/*.ts", "./route-map.json": "./src/route-map.json" }`. Không có `index.ts` tổng, để lane thêm module không sửa chung một file.
- Hai app thêm `"@tubutree/app-core": "workspace:*"`. Web thêm gói vào `transpilePackages` (`apps/web/next.config.mjs:65`). Vite và vitest của Mini App đọc gói qua `node_modules`. **Phải chứng minh** bằng `next build`, `vite build`, vitest hai app (design-tokens không phải tiền lệ: TS của nó chỉ được `tailwind.config.ts` đọc).
- Có vitest riêng (node), script `typecheck`, `test`, `lint` để turbo chạy.
- **Cấm** trong `src/`: import `react`, `react-dom`, `next/*`, `zmp-sdk`, `zmp-ui`, `axios`, `@tanstack/*`; dùng `window`, `document`, `localStorage`, `process.env` ở mức module. Một spec quét `src/` và đỏ khi vi phạm.
- Kiểu lấy từ `@tubutree/shared-types` khi có; kiểu chỉ client dùng đặt cạnh hàm API.

### 1.1 HttpClient và adapter

```ts
// src/http.ts
export type Query = Record<string, string | number | boolean | null | undefined>;
export interface RequestOptions { query?: Query; headers?: Record<string, string> }
export interface HttpClient {
  get<T>(path: string, opts?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  delete<T>(path: string, opts?: RequestOptions): Promise<T>;
}
```

- Hàm API theo miền ở `src/api/<miền>.ts`, nhận `http` đầu tiên: `getWallet(http)`, `withdraw(http, body, idempotencyKey)`. Đường dẫn, query, body, header (`Idempotency-Key`) **giống hệt** service Mini App. Hàm gọi `http.get(path)` không kèm `opts` khi service Mini App gọi `api.get(path)` một tham số.
- Query cho React Query ở `src/queries/<miền>.ts`: object thuần `{ queryKey, queryFn }`, không import `@tanstack`. Query key giữ đúng key Mini App để invalidate cũ vẫn trúng.
- **Contract spec** trong app-core: mỗi hàm API được gọi với một `HttpClient` giả ghi lại lời gọi; kiểm method, path, query, body, header. Bảng kỳ vọng chép từ spec service Mini App đang có (ví dụ `services/waste-api.spec.ts:13-35`, `services/shop-api.spec.ts:127`), để hai bên không lệch.
- Lỗi: adapter ném lỗi gốc nền tảng (web `ApiError`/`NetworkError`, Mini App `AxiosError`). app-core không đọc lỗi. Bảng mã lỗi → chữ (nếu dùng chung) là hàm thuần nhận `code: string`.
- **Adapter web client** `apps/web/src/lib/core-http.ts` bọc `apiFetch` (`client-api.ts`; đã nhận `headers` ở dòng 204-213). Adapter tự dựng query string, **bỏ khoá `null`/`undefined`** như axios. `apiFetch` không nhận `signal` (nó tự tạo `AbortController`), nên `RequestOptions` không có `signal`.
- **Adapter web server** `apps/web/src/lib/core-http-server.ts` bọc fetch ISR của `lib/api.ts` (`client-api.ts` là `'use client'`, server component không dùng được). Trang công khai dùng adapter này.
- **Adapter Mini App** `apps/miniapp/src/services/core-http.ts` bọc instance axios `api`, **chỉ chuyển tham số được truyền**: không có `opts` thì `api.get(path)`; có `query` thì `api.get(path, { params: query })`; có `headers` thì thêm `headers`. Để spec Mini App đang kiểm đúng đối số (`['/waste/me']`, `['/waste/points', { params: {} }]`) vẫn xanh nếu sau này service chuyển sang app-core.

### 1.2 PlatformBridge

```ts
// src/bridge.ts
export interface PlatformBridge {
  platform: 'miniapp' | 'web';
  capabilities: { verifiedPhone: boolean; zaloLocation: boolean; qrScan: boolean; zaloNotifyPermission: boolean };
  share(input: { title: string; text?: string; path: string }): Promise<'shared' | 'copied' | 'cancelled' | 'failed'>;
  openExternal(url: string): void;
  callPhone(phone: string): void;
  oa: { available: boolean; openChat(message?: string): Promise<void>; follow(): Promise<boolean> };
  storage: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> };
}
```

- Không có hàm vị trí: web đặt `Permissions-Policy: geolocation=()` (`next.config.mjs:80`), đợt này không đổi header bảo mật. "Điểm gần tôi" của đổi rác trên web chỉ chọn theo tỉnh; ghi câu hỏi cho chủ.
- Web: `apps/web/src/lib/platform-bridge.ts`. Web Share API, dự phòng chép link; `tel:`; tab mới; OA = `https://zalo.me/<OA id>` từ `NEXT_PUBLIC_ZALO_OA_ID` (trống thì `available=false`); `localStorage` bọc try/catch; `capabilities` toàn `false`.
- Mini App: `apps/miniapp/src/services/platform-bridge.ts`, chỉ bọc hàm có sẵn trong `zmp-bridge.ts`. Code Mini App cũ không bắt buộc chuyển; chức năng mới viết theo interface.
- Component web `MiniAppOnlyNotice`: "Tính năng này cần mở Tubu Tree trên Zalo." + nút "Mở trên Zalo" deep link **đúng màn Mini App tương ứng** (tra ngược route map web → Mini App; mở rộng `lib/zalo-mini-app.ts`, hiện chỉ dẫn `/san-pham/x`). Dùng cho Q2 (SĐT đã xác minh), chấm công, quét QR.

### 1.3 Bản đồ route và chức năng

`packages/app-core/src/route-map.json`:

```json
{
  "routes": [
    { "lane": "shop", "items": [
      { "miniapp": "/browse", "web": "/san-pham", "private": false, "pending": true },
      { "miniapp": "/group-buy/:id", "web": "/mua-chung/:id", "private": false, "pending": true }
    ]},
    { "lane": "skip", "items": [
      { "miniapp": "/points/scan", "skip": "Q2: cần SĐT đã xác minh và máy quét QR" }
    ]}
  ],
  "features": [
    { "id": "coupon-claim", "lane": "account", "miniapp": ["apps/miniapp/src/components/app.tsx", "CouponClaimGate"], "web": ["apps/web/src/components/app-gates.tsx", "CouponClaimGate"], "pending": true }
  ]
}
```

- `routes`: đúng **53 dòng**, mỗi `<Route path>` trong `app.tsx` một dòng (không tính `*`). Nhóm theo lane để lane sửa cờ `pending` ở khối riêng, ít xung đột. Tham số viết `:x` ở cả hai bên. Query đích được phép (`/subscriptions` → `/tai-khoan/don-hang?tab=subscriptions`).
- `features`: chức năng mức ứng dụng không phải route (dòng 52–54 của ma trận). Kiểm bằng cách tìm tên symbol trong file.
- Dùng ở:
  1. `scripts/check-platform-parity.mjs` (mục 4).
  2. `next.config.mjs` `redirects()`: đường dẫn Mini App → route web (307, giữ query). Bỏ dòng hai bên cùng đường dẫn (`/s/:slug`, `/brand/:slug`, `/admin`) và `/product/:slug` (đã có route handler). Đường tĩnh trước đường động (`/feed/events`, `/feed/leaderboard` trước `/feed/:id`).
  3. `PRIVATE_PATHS` (`lib/site.ts`) = danh sách cũ + **tiền tố** của các route `private: true` (cắt từ tham số đầu, khử trùng). `robots.ts:16` đang ghi `p` và `p/`; thêm `allow` cho route công khai nằm dưới tiền tố riêng tư (ví dụ `/doi-rac/quy-dinh`).
  4. `sitemap.ts`: thêm route `private: false`, không tham số, không `pending`.
  5. Điều hướng (thanh đáy, header, hub tài khoản): **ẩn link có `pending: true`**, để `web/integration` không có link 404 khi lane chưa xong.
- Lane xong route nào thì xoá `"pending": true` của dòng đó, trong khối của lane mình.

## 2. Vỏ ứng dụng web và cấu hình

- **Điện thoại (<768px):** thanh đáy `md:hidden`, chỉ hiện ở 5 route gốc như `ROOT_PATHS` (`nav-config.ts`): Trang chủ `/`, Danh mục `/san-pham`, Vườn Xanh `/vuon-xanh`, Đơn hàng `/tai-khoan/don-hang` (badge đơn đang xử lý), Cá nhân `/tai-khoan`. Cùng nhãn, cùng icon lucide. Không hiện cùng `sticky-action-bar.tsx`.
- **Máy tính (≥768px):** `site-header.tsx` thêm các mục trên, giữ tìm kiếm, giỏ, tài khoản. Khung rộng tối đa như trang hiện có, lưới nhiều cột, sheet thành hộp thoại giữa màn hình. Không cuộn ngang ở 320px.
- **Primitive dùng chung** (core làm, lane không tạo bản trùng): `Sheet` (đáy trên điện thoại, hộp thoại trên máy tính, focus trap, Esc), `SegmentedTabs` (đồng bộ `?tab=`), `PageHeader`, `ErrorState` (Thử lại), `Skeleton`, `Badge`, `ProgressBar`, `QuantitySelector`, `QrCode` (thêm gói `qrcode`), `Field`. Dùng lại cái đã có (`empty-state`, `login-required`, `copy-button`, `share-button`, `sticky-action-bar`, `confirm-dialog`). Mỗi primitive có spec.
- **`components/app-gates.tsx`**: core tạo rỗng và gắn vào `app/layout.tsx`; lane `account` thêm `CouponClaimGate`, `OnboardingGate`.
- **Biến build công khai mới**: `NEXT_PUBLIC_ZALO_OA_ID`, `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` (Mini App dùng `VITE_ZALO_OA_ID`, `image-upload.tsx:6-7`). Core thêm `ARG/ENV` vào `apps/web/Dockerfile`, build args vào `docker-compose.prod.yml`, `docker-compose.vietnix.yml`, file `.env*.example`; build **in cảnh báo** khi trống (không làm build đỏ); ghi vào báo cáo sáng. CSP `connect-src` (`next.config.mjs:47`) thêm `https://api.cloudinary.com`.
- **Danh sách trang trong spec dùng chung** (`ds-v2-guest.spec.ts:10-38` mảng `MIGRATED`, `ds-palette-pc11.spec.ts`, `page-titles.spec.ts:20`, `session-unavailable.spec.tsx:65`, `guest-auth-gate.spec.tsx:65`): core tách mỗi mảng thành khối theo lane (`const SHOP: string[] = []`, …, rồi `[...CORE, ...SHOP, ...]`). Lane chỉ thêm vào khối của mình. Không đổi cơ chế ratchet sang glob. Trang khách vào `ds-v2-guest`; trang nội bộ (`/dai-ly`, `/nhan-vien`, `/chu-thuong-hieu`, tab admin) vào `ds-palette-pc11`.

## 3. Quy ước một trang web

1. Chữ hiển thị giống Mini App từng chữ (lỗi, rỗng, nút). Spec web kiểm chữ chính.
2. Trạng thái: đang tải, rỗng, lỗi có Thử lại, khách (`useAuthPhase` → `login-required`), `unavailable`.
3. Quyền theo vai trò như Mini App. Chỗ Mini App chỉ dựa vào server (dealer, brand-owner, storefront, recycle-desk) thì web cũng vậy, hiển thị 403 tử tế.
4. Trang công khai: server component, `core-http-server.ts`/`lib/api.ts`, ISR `revalidate` như trang hiện có, `generateMetadata`. Trang riêng tư: client component, React Query + app-core, `noindex`.
5. Hành động tiền/điểm/mã giảm giá (rút tiền, đổi quà, điểm danh, hoa hồng, công nợ, trả vỏ, nhận mã, mua chung, đặt định kỳ): **cùng endpoint, cùng body, cùng `Idempotency-Key`** như Mini App. Không thêm logic tiền ở client. Reviewer so body hai bên.
6. Thêm file vào khối lane trong các spec danh sách (mục 2).
7. Test: spec vitest cạnh file, mang đủ ý nghĩa test Mini App của màn đó. Mỗi lane viết một Playwright `apps/e2e/tests/<lane>.web.spec.ts` cho luồng chính (chỉ viết, chạy ở gate cuối).
8. Cờ tính năng: cùng `/config/public` và cùng hằng số. Chuyển `apps/miniapp/src/utils/features.ts` vào `app-core/src/features.ts`, Mini App re-export.

## 4. Rào chắn hai nền tảng

- `scripts/check-platform-parity.mjs`:
  - đọc mọi `<Route path="...">` trong `apps/miniapp/src/components/app.tsx` (bỏ `*`);
  - đỏ khi: route Mini App không có dòng; có dòng thừa; `skip` thiếu lý do; dòng không `pending` mà route web không có `page.tsx`/`route.ts` (`:x` → `[x]`, bỏ query); feature không `pending` mà symbol không có trong file web; symbol Mini App của feature không còn trong file Mini App;
  - `pending` chỉ cảnh báo; `--strict` coi `pending` là lỗi.
  - Logic tách hàm thuần có test (vitest app-core import file `.mjs`).
- Root `package.json`: `"lint:parity": "node scripts/check-platform-parity.mjs"`. Thêm bước vào `.github/workflows/ci.yml` sau bước lint (sửa file, không push).
- `AGENTS.md` ở gốc, mục "Hai nền tảng": logic API ở `packages/app-core` (kèm contract spec); khả năng riêng nền tảng qua `PlatformBridge`; chức năng khách hàng mới phải có màn Mini App và trang web trong cùng nhánh, hoặc dòng `skip` có lý do trong `route-map.json`; chạy `pnpm lint:parity` trước khi xong. `CLAUDE.md` ở gốc một dòng trỏ tới `AGENTS.md`.

## 5. Chuyển Mini App sang app-core

Không chuyển hàng loạt. Lane `core-api` **chép** mọi hàm service Mini App vào app-core (theo miền, có contract spec), không sửa Mini App. Lane `core` chuyển **một module mẫu** (wishlist) của Mini App sang gọi app-core qua adapter: test Mini App không sửa, vẫn xanh, số test không giảm dưới 4243. Lane sau được chuyển thêm module Mini App khi test Mini App không phải sửa; không thì giữ bản cũ và ghi vào `impl/<lane>.md`.

## 6. Kiểm chứng sẵn có

- Q3: `appId` Mini App (`apps/miniapp/app-config.json:4`) bằng giá trị `ZALO_APP_ID` của API (`.env.production.example:38`); compose truyền `ZALO_APP_ID` sang `NEXT_PUBLIC_ZALO_APP_ID` (`docker-compose.prod.yml:89`). Hai luồng đăng nhập cùng lấy `id` từ graph `/me` (`zalo.service.ts:74-96`), tra user theo `zaloId`. Phía Zalo có trả cùng id không: chưa kiểm chứng, cần đăng nhập thử trên UAT.
- `web/base`: typecheck đỏ khi `@tubutree/shared-types` chưa build; gate phải build gói này trước.

## 7. Review lần 1 đã xử lý

1 geolocation bị chặn → không làm "gần tôi" trên web, bỏ vị trí khỏi bridge. 2 gate mức ứng dụng → dòng 52–54, mục `features`. 3 lane wave 1 cần app-core của nhau → lane `core-api` chép mọi miền ở đợt 0. 4 file `tai-khoan` không chủ → bảng chủ file ở 02. 5 `/` là trang danh mục → shop sở hữu `site-search.tsx`, `home-seo.ts`, chuyển hướng query. 6 thiếu review → core, shop, account lên 2 lượt. 7 e2e đụng Redis/DB chung → gate cuối dựng Postgres + Redis tạm, migrate + seed, `E2E_SCOPE=web`, cổng cấu hình được. 8 biến build mới → core sửa Dockerfile/compose. 9 adapter đổi đối số axios → chỉ chuyển tham số được truyền + contract spec. 10 `apiFetch` đã có headers, thiếu query/signal/server → mục 1.1. 11 ratchet không hỗ trợ glob → tách khối theo lane. 12 robots với `:id` → tiền tố + `allow`. 13 route map 53 dòng, khoá `private`. 14 link tới route chưa có → ẩn khi `pending`. 15 deep link Mini App → tra ngược route map. 16 thứ tự Q7 và thiếu test di động → ghi lý do ở 02, thêm project Playwright di động.
