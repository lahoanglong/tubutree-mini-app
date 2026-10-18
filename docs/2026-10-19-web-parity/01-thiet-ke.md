# 01 — Thiết kế hai nền tảng

Mục tiêu: web có đủ chức năng Mini App (xem `00-ma-tran.md`), và từ nay một chức năng mới chỉ viết logic một lần.

Nguyên tắc: **chia sẻ logic, không chia sẻ giao diện.** Mini App giữ zmp-ui + react-router. Web giữ Next 14 App Router + Tailwind + `@tubutree/design-tokens`. Phần chung đi vào `packages/app-core`.

## 1. `packages/app-core`

- Tên `@tubutree/app-core`, `private`. Xuất **mã nguồn TS** như `@tubutree/design-tokens` (không build): `"exports": { "./*": "./src/*.ts", "./route-map.json": "./src/route-map.json" }`. Không có file `index.ts` tổng, để các lane thêm module mà không sửa chung một file.
- Hai app thêm `"@tubutree/app-core": "workspace:*"`. Web thêm gói này vào `transpilePackages` (`apps/web/next.config.mjs:65`). Kiểm cả `next build`, `vite build`, vitest của hai app đều nạp được.
- Có vitest riêng (môi trường node) và script `typecheck`, `test`, `lint` để turbo chạy.
- **Cấm import** trong `src/`: `react`, `react-dom`, `next/*`, `zmp-sdk`, `zmp-ui`, `axios`, `@tanstack/*`; cấm dùng `window`, `document`, `localStorage`, `process.env` ở mức module. Một spec trong app-core quét `src/` và đỏ khi vi phạm.
- Kiểu dữ liệu lấy từ `@tubutree/shared-types` khi đã có; kiểu chỉ client dùng thì đặt cạnh hàm gọi API.

### 1.1 HttpClient

```ts
// src/http.ts
export type Query = Record<string, string | number | boolean | null | undefined>;
export interface RequestOptions { query?: Query; headers?: Record<string, string>; signal?: AbortSignal }
export interface HttpClient {
  get<T>(path: string, opts?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  delete<T>(path: string, opts?: RequestOptions): Promise<T>;
}
```

- Hàm gọi API theo miền ở `src/api/<miền>.ts`, nhận `http` làm tham số đầu: `getWallet(http)`, `withdraw(http, body, idempotencyKey)`. Đường dẫn, tham số, header (`Idempotency-Key`) **giống hệt** service Mini App đang dùng.
- Tuỳ chọn query cho React Query ở `src/queries/<miền>.ts` dạng object thuần `{ queryKey, queryFn }` (không import `@tanstack`), dùng `useQuery(walletQuery(http))` ở cả hai app. Query key giữ đúng key Mini App đang dùng, để lệnh invalidate cũ vẫn trúng.
- Lỗi: adapter ném lỗi gốc của nền tảng (web `ApiError`/`NetworkError` ở `client-api.ts`, Mini App `AxiosError`). app-core không đọc lỗi. Bảng mã lỗi → chữ tiếng Việt (nếu cần dùng chung) là hàm thuần nhận `code: string`.
- Adapter web: `apps/web/src/lib/core-http.ts`, bọc `apiFetch`. Nếu `apiFetch` chưa nhận `headers`, thêm tham số tuỳ chọn (không đổi hành vi cũ, có test).
- Adapter Mini App: `apps/miniapp/src/services/core-http.ts`, bọc instance axios `api` (`api.get(path, { params, headers }).then(r => r.data)`), để mock `api` trong test Mini App hiện có vẫn trúng.

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

- Web: `apps/web/src/lib/platform-bridge.ts`. Web Share API, dự phòng chép link; `tel:`; tab mới; OA = `https://zalo.me/<OA id>` (biến môi trường web, trống thì `available=false`); `localStorage` bọc try/catch; `capabilities` toàn `false`.
- Mini App: `apps/miniapp/src/services/platform-bridge.ts`, chỉ bọc các hàm có sẵn trong `zmp-bridge.ts`. Code Mini App hiện có **không bắt buộc** chuyển sang; chức năng mới viết theo interface này.
- Component web `MiniAppOnlyNotice`: "Tính năng này cần mở Tubu Tree trên Zalo." kèm nút "Mở trên Zalo" (dùng `lib/zalo-mini-app.ts`). Dùng cho mọi chỗ Q2 (SĐT đã xác minh), chấm công, quét QR.

### 1.3 Bản đồ route chung

- `packages/app-core/src/route-map.json`: mảng nhóm theo lane, mỗi phần tử `{ "miniapp": "/feed/:id", "web": "/cong-dong/:id", "private": true, "pending": true }` hoặc `{ "miniapp": "/points/scan", "skip": "<lý do>" }`. Tham số viết dạng `:x` ở cả hai bên.
- Ba chỗ dùng bản đồ này:
  1. `scripts/check-platform-parity.mjs` (mục 4).
  2. `apps/web/next.config.mjs` `redirects()`: đường dẫn Mini App → route web (307, giữ query), để link chia sẻ từ Mini App mở được trên web. Bỏ qua dòng mà hai bên cùng đường dẫn (`/s/:slug`, `/brand/:slug`, `/admin`) và `/product/:slug` (đã có route handler). Đường tĩnh xếp trước đường động (`/feed/events` trước `/feed/:id`).
  3. `PRIVATE_PATHS` (`apps/web/src/lib/site.ts`) sinh từ các dòng `private: true` cộng danh sách cũ. Mục đích: lane không phải sửa chung một mảng.
- Lane làm xong route nào thì xoá `"pending": true` của dòng đó.

## 2. Vỏ ứng dụng web

- **Điện thoại (<768px):** thanh điều hướng đáy `md:hidden`, chỉ hiện ở 5 route gốc như `ROOT_PATHS` của Mini App (`nav-config.ts`): Trang chủ `/`, Danh mục `/san-pham`, Vườn Xanh `/vuon-xanh`, Đơn hàng `/tai-khoan/don-hang` (badge đơn đang xử lý), Cá nhân `/tai-khoan`. Cùng nhãn, cùng icon lucide. Không hiện cùng lúc với `sticky-action-bar.tsx`.
- **Máy tính (≥768px):** `site-header.tsx` thêm các mục điều hướng trên, giữ ô tìm kiếm, giỏ, tài khoản. Nội dung trong khung rộng tối đa như các trang web đang có; danh sách sản phẩm và lưới nhiều cột; sheet đáy hiển thị thành hộp thoại giữa màn hình. Không có cuộn ngang ở 320px.
- **Primitive dùng chung** (lane `core` làm trước, các lane khác không tự tạo bản trùng): `Sheet` (đáy trên điện thoại, hộp thoại trên máy tính, có focus trap và Esc), `SegmentedTabs` (đồng bộ `?tab=`), `PageHeader` (tiêu đề + nút quay lại), `ErrorState` (có Thử lại), `Skeleton`, `Badge`, `ProgressBar`, `QuantitySelector`, `QrCode` (thêm gói `qrcode` cho web), `Field`. Kiểm `components/` trước, đã có thì dùng lại (`empty-state`, `login-required`, `copy-button`, `share-button`, `sticky-action-bar`, `confirm-dialog`). Mỗi primitive có spec và nằm trong danh sách `ds-v2-guest.spec.ts`.

## 3. Quy ước một trang web

1. Chữ hiển thị giống Mini App từng chữ (cả lỗi, trạng thái rỗng, nút). Spec web kiểm các chữ chính.
2. Trạng thái: đang tải (Skeleton), rỗng, lỗi có Thử lại, khách (`useAuthPhase` → `login-required`), phiên không khả dụng (`unavailable`).
3. Quyền theo vai trò giống Mini App. Chỗ Mini App chỉ dựa vào server (dealer, brand-owner, storefront, recycle-desk) thì web cũng chỉ dựa vào server, và hiển thị lỗi 403 tử tế.
4. Trang công khai: server component, lấy dữ liệu qua `lib/api.ts` (ISR `revalidate` như trang hiện có), `generateMetadata`, thêm vào `sitemap.ts`. Trang riêng tư: client component, React Query + app-core, `noindex`.
5. Hành động tiền/điểm (rút tiền, đổi quà, điểm danh, rút hoa hồng, công nợ, trả vỏ): gửi **cùng endpoint, cùng body, cùng `Idempotency-Key`** như Mini App. Không thêm logic tiền ở client. Reviewer so body hai bên.
6. File mới theo ratchet design system: thêm vào danh sách trong `ds-v2-guest.spec.ts` (trang khách) hoặc `ds-palette-pc11.spec.ts` (trang nội bộ).
7. Test: spec vitest đặt cạnh file (`page.spec.tsx`), mang đủ ý nghĩa các test Mini App của màn đó. Luồng chính mỗi lane có một Playwright `apps/e2e/tests/<lane>.web.spec.ts`, mock API ngay trong spec như `web-checkout.web.spec.ts` (không cần DB).
8. Cờ tính năng: đọc cùng `/config/public` và cùng hằng số. Chuyển `apps/miniapp/src/utils/features.ts` vào `app-core/src/features.ts`, Mini App re-export.

## 4. Rào chắn hai nền tảng

- `scripts/check-platform-parity.mjs`:
  - đọc `<Route path="...">` trong `apps/miniapp/src/components/app.tsx` (bỏ `*`);
  - đỏ khi route Mini App không có dòng trong `route-map.json`, khi có dòng thừa, khi `skip` thiếu lý do, khi dòng không `pending` mà route web không có file `page.tsx`/`route.ts` tương ứng (`:x` → `[x]`, bỏ query);
  - dòng `pending` chỉ in cảnh báo; cờ `--strict` coi `pending` là lỗi.
  - Logic có test (vitest trong app-core import file `.mjs`, hoặc tách hàm thuần).
- Root `package.json`: `"lint:parity": "node scripts/check-platform-parity.mjs"`. Thêm bước vào `.github/workflows/ci.yml` sau bước lint (sửa file, không push).
- `AGENTS.md` ở gốc, mục "Hai nền tảng": logic API và quy tắc nghiệp vụ ở `packages/app-core`; khả năng riêng nền tảng qua `PlatformBridge`; chức năng khách hàng mới phải có màn Mini App và trang web trong cùng nhánh, hoặc dòng `skip` có lý do trong `route-map.json`; chạy `pnpm lint:parity` trước khi xong. `CLAUDE.md` ở gốc một dòng trỏ tới `AGENTS.md`.

## 5. Chuyển Mini App sang app-core

Không chuyển hàng loạt. Lane `core` chuyển **một module mẫu** (wishlist hoặc thông báo) để chứng minh mẫu: service Mini App gọi app-core qua adapter, test Mini App không sửa, vẫn xanh, số test không giảm. Các lane khác: hàm API web cần thì đặt vào app-core (chép đúng đường dẫn/body từ service Mini App). Lane được chuyển service Mini App tương ứng sang app-core khi test Mini App không phải sửa; không thì giữ bản Mini App và ghi vào `impl/<lane>.md`.

## 6. Những điều đã kiểm

- Q3: `appId` Mini App (`apps/miniapp/app-config.json:4`) bằng giá trị `ZALO_APP_ID` của API (`.env.production.example:38`); compose truyền `ZALO_APP_ID` sang `NEXT_PUBLIC_ZALO_APP_ID` (`docker-compose.prod.yml:89`). Hai luồng đăng nhập cùng lấy `id` từ graph `/me` (`zalo.service.ts:74-96`) và tra user theo `zaloId`. Phía Zalo có trả cùng id không: chưa kiểm chứng, cần đăng nhập thử thật trên UAT.
- `web/base`: typecheck web đỏ khi `@tubutree/shared-types` chưa build (gói xuất `dist`). Gate phải build gói này trước.
