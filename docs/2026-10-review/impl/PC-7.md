# PC-7 — Web khách theo DS v2

## Mục 1/3 — C-097 (nền DS v2, trang chủ, layout, header/footer) + Q-20 (SITE_URL)

| Mục | Trạng thái | Commit |
| --- | --- | --- |
| C-097 nền tảng: `tailwind.config.ts`, `globals.css` nạp `tokens.css`, màu `promo-*`, bóng `card/raised` | XONG | bedbd1a |
| C-097 chân trang web khách (hotline/email từ cấu hình công khai) | XONG | f6eb723 |
| C-097 trang chủ, header, thẻ sản phẩm sang palette DS v2 (kèm C-116/C-123/C-025 phần nằm trên các file này) | XONG | dbe8f2b |
| Q-20 SITE_URL/canonical/sitemap/robots = `https://app.tubutree.com`, link chia sẻ miniapp, docker-compose | XONG | a92432a |

Các trang khách còn lại (san-pham, gio-hang, thanh-toan, tai-khoan, s/[slug], dang-nhap) thuộc mục 2/3 và 3/3; chưa nằm trong ratchet `MIGRATED`.

### C-097
- `tailwind.config.ts`: giữ preset `@tubutree/design-tokens` (màu tương phản PC-1 giữ nguyên). Khối legacy v1 (primary/leaf/sun/neutral/clay) vẫn còn vì
  `/admin`, `/merchant`, `/brand` và các trang khách chưa chuyển dùng nó. Khối legacy ghi đè `clay-50/500/700` của preset bằng hex v1, nên giá khuyến mãi
  trên trang đã chuyển dùng tên ngữ nghĩa `promo-fg/bg/solid`, đọc thẳng từ `clay` của preset (`#7E4222/#FAF1EA/#9C532C`), không lệch hex.
- `globals.css`: `@import tokens.css`; `body` lấy `--color-bg-canvas`/`--color-text-primary`; `:focus-visible` dùng `--color-border-focus`; thanh cuộn theo
  `--color-border-default/strong`. Bỏ `.tubu-card/.tubu-glass/.tubu-badge` (không còn nơi dùng; kiểm bằng grep trước khi xoá).
- `page.tsx`: hero `bg-forest-800` + tiêu đề `font-display` (Fraunces), thẻ cam kết/lọc thương hiệu/trạng thái rỗng dùng `rounded-card/sheet/control`,
  `stone-*`, `forest-*`, `sage-*`. Không đổi hành vi (lọc `?brand=`, anchor `#san-pham`). Gỡ nút "Mở gian hàng Đối tác" (/merchant) khỏi trang chủ (C-025).
- `layout.tsx`: thêm `SiteFooter` (ẩn ở `/admin`, `/merchant`, `/brand` qua `HideOnPortals` + `isPortalPath`), thân trang `flex min-h-screen flex-col`.
- `site-header.tsx`: bỏ link "Kênh Đối Tác" (C-025), nút giỏ/đăng nhập/tài khoản cao 44px (`h-11 w-11`, `min-h-11`), `aria-label` giỏ có số lượng,
  `nav aria-label="Điều hướng chính"`, icon `aria-hidden`, chữ 10px thành `text-xs` (C-116).
- `site-footer.tsx` (mới, server component): hotline và email lấy từ `GET /config/public` (`support.hotline/email`), lỗi/null thì rơi về
  `0899 149 229` / `tubutree@gmail.com`; liên kết `tel:` chỉ giữ chữ số và `+`. Mỗi liên kết cao tối thiểu 44px.
- `product-card.tsx`: màu `stone/forest/honey`, nhãn giảm giá `bg-promo-solid`, giá thường `text-stone-900` (giá không còn tô clay), chữ 10-11px thành 12px, svg sao `aria-hidden`.
- Heading (C-123) trên các file này: `h1` một lần ở hero; mục có `h2` (`sr-only` cho "Cam kết", "Danh sách sản phẩm"); thẻ con dùng `h3`; `h4` cũ sửa thành `h3`.

### Q-20
- `lib/site.ts`: `SITE_URL` mặc định `https://app.tubutree.com` (trước đây `shop.`; middleware coi `shop` là subdomain gian hàng CTV nên không dùng làm gốc).
  `sitemap.ts`, `robots.ts`, `metadataBase` đều đọc `SITE_URL`, nên canonical/sitemap/robots đổi theo.
- Link chia sẻ miniapp (`share-sheet.tsx`, `content-kit-sheet.tsx`, `pages/affiliate.tsx`): fallback `VITE_WEB_BASE_URL` đổi `shop.` thành `app.tubutree.com`.
  Đây là sửa tối thiểu ngoài `apps/web` vì cùng một lỗi tên miền (C-095); spec `content-kit-sheet.spec.tsx` cập nhật theo.
- `docker-compose.vietnix.yml` service web: thêm build arg `NEXT_PUBLIC_SITE_URL: https://app.${WEB_DOMAIN}` (cùng cách `NEXT_PUBLIC_API_BASE_URL`);
  `apps/web/Dockerfile` khai `ARG/ENV NEXT_PUBLIC_SITE_URL` (biến `NEXT_PUBLIC_*` phải có lúc build). `apps/web/.env.example` thêm biến này.
  Việc cần khi deploy: build lại image web (biến nhúng lúc build), `WEB_DOMAIN` trên VPS phải là `tubutree.com`.

### Test (đỏ→xanh)
- Spec và code nằm chung commit (không có commit đỏ riêng). Bằng chứng đỏ→xanh của bánh cóc: cùng regex của `ds-v2-guest.spec.ts` chạy trên bản gốc `ee97986` cho 51 (page.tsx), 28 (site-header.tsx), 15 (product-card.tsx) lớp palette v1 và 4/3/3 chữ 9-11px; bản hiện tại 0. Các spec: `ds-v2-guest.spec.ts` (22 test, bánh cóc cho 6 file đã chuyển: không lớp palette v1, không chữ <12px, không hex cứng;
  nền tảng tokens.css/promo/boxShadow/`font-display` ở h1), `tailwind.config.spec.ts` (28), `site.spec.ts` (6: mặc định `app.`, env ghi đè, bỏ `/` cuối, `isPortalPath`),
  `public-support.spec.ts` (5: mặc định/null từng trường/lỗi mạng/HTTP lỗi), `site-footer.spec.tsx` (3), `site-header.spec.tsx` (4: không có link /merchant, aria-label, 44px),
  `hide-on-portals.spec.tsx` (2).
- Chạy lại lượt này (xác nhận xanh): xem mục "Kiểm chứng" bên dưới.

### Kiểm chứng (lượt này)
```
cd apps/web && npx vitest run tailwind.config.spec.ts src/ds-v2-guest.spec.ts src/components/hide-on-portals.spec.tsx \
  src/components/site-footer.spec.tsx src/components/site-header.spec.tsx src/lib/public-support.spec.ts src/lib/site.spec.ts
 Test Files  7 passed (7)
      Tests  70 passed (70)
cd apps/web && npx tsc --noEmit            -> không lỗi
cd apps/web && npx eslint <file đã sửa>    -> 0 lỗi
cd apps/miniapp && npx vitest run src/components/content-kit-sheet.spec.tsx
 Test Files  1 passed (1)
      Tests  4 passed (4)
```
`node scripts/uiux/static-scan.mjs` không chạy được trong worktree (ENOENT thư mục `scripts/uiux/results`, thư mục kết quả không được commit) nên bánh cóc
`ds-v2-guest.spec.ts` là bằng chứng thay thế cho "legacyPalette=0" trên 6 file đã chuyển. Chưa chụp màn hình (không chạy Playwright theo quy định máy).

### Giả định
- Giá sản phẩm trên thẻ dùng `stone-900` thay vì tô màu clay: DS v2 dành màu clay cho khuyến mãi, và giá thường không phải khuyến mãi. Giá giảm vẫn có nhãn `-x%` màu `promo-solid`.
- Footer ẩn ở `/admin`, `/merchant`, `/brand` vì hotline dành cho khách mua hàng; các cổng đó có giao diện riêng (PC-11/PD-1).
- `shop.tubutree.com` còn xuất hiện ở `site.ts` (chú thích) và `site.spec.ts` (kiểm không còn là mặc định), cố ý.

### Chưa làm sau mục 1/3
- Chuyển san-pham, gio-hang, thanh-toan, tai-khoan, s/[slug], dang-nhap sang DS v2: đã làm ở mục 2/3 bên dưới.
- C-025 phần còn lại (trang chi tiết đơn + QR, danh sách mã giảm giá ở thanh toán, ô tìm kiếm ở header): mục 3/3. Xoá khối legacy v1 khỏi `tailwind.config.ts` khi PC-11/PD-1 xong.

## Mục 2/3 — C-097 (các trang khách còn lại) + C-116 + C-123 + C-077 phần web khách

| Mục | Trạng thái | Commit |
| --- | --- | --- |
| C-097 `/san-pham/[slug]` và component dùng chung (`add-to-cart`, `copy-button`, `geo-picker`, `recycling-*`), màu trạng thái `danger/warning/success/info`, `lib/guest-ui.ts` | XONG | 1e7d97c |
| C-097 `/gio-hang` (kèm C-077: nút −/+/Xóa gắn tên sản phẩm, ô "Mã giảm giá" có nhãn) | XONG | 9420992 |
| C-097 `/thanh-toan` + khung chuyển khoản (kèm C-077: ô địa chỉ, select tỉnh/phường, radio; vùng cuộn focus được) | XONG | e1a8bbf |
| C-097 `/tai-khoan`, `/dang-nhap`, `/dang-nhap/callback`, `error`, `global-error`, `not-found`, `loading` (kèm C-123: thêm h1 cho tài khoản + callback) | XONG | e9331fa |
| C-097 `/s/[slug]` (kèm C-116: chữ 10-11px; hex cứng) | XONG | 9a590a8 |
| C-077/C-097 kiểm vùng chạm 44px, cho phép xuống dòng ở hàng điều khiển giỏ | XONG | aee558b |
| Bánh cóc + spec truy cập (đỏ trước) | XONG | 7dafbe5 |

C-123 phần web khách: đủ. Trang thiếu h1 trong báo cáo gốc là `tai-khoan`, `dang-nhap/callback` (đã thêm) và `merchant-denied` (thuộc `/merchant`, KHÔNG sửa, để PC-11/PD-1).

### Số đo trước/sau (cùng regex của bánh cóc, 17 file khách đã chuyển trong mục này)
| | Trước (ee97986 + mục 1) | Sau |
| --- | --- | --- |
| Lớp palette v1/stock (primary/leaf/clay/sun/neutral/green/red/amber…) | 289 | 0 |
| `white`/`black` thô của Tailwind | 45 | 0 |
| Chữ < 12px (`text-[10px]`, `text-[11px]`) | 6 | 0 |
| Hex cứng (`s/[slug]`: `#16a34a`, `#1e293b`, `#ffffff`, `#95D222`, `#509018`) | 5 | 0 |

Quét chính thức của báo cáo gốc (`node scripts/uiux/static-scan.mjs`, thư mục `scripts/uiux/results` tạo tạm, đã gitignore): web khách 51 file cho hex 0, legacyPalette 0, neutral 0, greenRed 0, v2Cls 295, 13 file dùng Fraunces.
Nhóm cổng (admin/merchant/brand, 34 file) giữ nguyên hex 8, legacyPalette 45, neutral 774, greenRed 431, v2 0 — đúng phạm vi PC-11/PD-1.

### Thay đổi chính
- `tailwind.config.ts`: thêm màu ngữ nghĩa `danger/warning/success/info-{fg,bg}` trỏ vào `var(--color-status-*)` của tokens.css (preset không có tên cho nhóm này, còn `red/amber/green` thô nằm ngoài DS v2).
  Là biến CSS nên không dùng hậu tố độ trong suốt (`/40`); khối legacy v1 giữ nguyên cho cổng chưa chuyển.
- `lib/guest-ui.ts` (mới): hằng lớp dùng chung `ui.card/field/fieldError/btnPrimary/btnSecondary/btnText/backLink/pageTitle/sectionTitle/error`. `field` và `fieldError` là hai chuỗi riêng (không chồng hai lớp `border-*`, vì thứ tự CSS không đảm bảo).
  Viền ô nhập `stone-450` (đủ 3:1, WCAG 1.4.11); vùng chạm `min-h-11`.
- Thay thế: primary/leaf thành `forest`, neutral thành `stone`, clay của giá thành `stone-900` (như thẻ sản phẩm ở mục 1), clay của mã giảm giá thành `promo-*`, red/amber/green thành `danger/warning/success`,
  `rounded-md/lg/2xl` thành `rounded-control/card/sheet`, `shadow-sm` thành `shadow-card`. Tiêu đề trang dùng `font-display` (Fraunces).
- C-077: `aria-label` cho nút −/+/Xóa/Xoá/Bỏ mã (kèm tên sản phẩm hoặc mã), `aria-pressed` cho nút phân loại, `aria-label` "Tỉnh/thành"/"Phường/xã" cho select, nhãn hiển thị cho 3 ô địa chỉ (kèm `autoComplete`/`inputMode`),
  nhãn "Mã giảm giá" cho ô nhập mã, nút Sao chép có tên kèm giá trị ("Sao chép: 9984606774"), icon trang trí `aria-hidden`, vùng cuộn danh sách món ở thanh toán có `tabIndex=0` + `role="region"`.
- C-116: mọi chữ ≥ 12px trên các trang này.
- Thuật ngữ Q-26 trong chữ vừa chạm tới: "Nhập mã ưu đãi" thành "Nhập mã giảm giá", "Không áp được mã" thành "Không áp dụng được mã giảm giá", "Không bỏ được mã" thành "Không bỏ được mã giảm giá". "Điểm Xanh"/"Ví Tubu" giữ nguyên.
- `/tai-khoan`: h1 "Tài khoản" ở cả ba trạng thái (đang tải: `sr-only`); danh sách đơn thành `ul/li`; nhãn trạng thái đơn có tông màu (chờ thanh toán = cảnh báo, hủy/hoàn = trung tính, còn lại = xanh).
- `/dang-nhap/callback`: h1 "Đăng nhập chưa thành công" (lỗi) / "Đang đăng nhập…" (chờ).
- `/s/[slug]`: màu chủ đề của chủ gian hàng chỉ còn là điểm nhấn không mang chữ (ảnh bìa, nền avatar, thanh bộ sưu tập); huy hiệu loại gian hàng dùng `forest-700`, giá dùng `stone-900`; thêm h2 `sr-only` cho dải cam kết; tên sản phẩm là h3; svg lá dùng `currentColor`.

### Test (đỏ→xanh)
- Commit 7dafbe5 là commit ĐỎ có chủ đích: mở rộng `MIGRATED` của `ds-v2-guest.spec.ts` (6 → 24 file, thêm luật không `white/black` thô và kiểm màu trạng thái) và thêm `guest-pages.a11y.spec.tsx` + `test-utils/a11y.ts`.
  Chạy thấy đỏ: bánh cóc 34 test; spec truy cập 5/11 test (giỏ hàng: ô mã không nhãn; thanh toán: 5 điều khiển không tên; tài khoản và callback: 0 h1; không có `#cart-coupon`).
- Các commit 1e7d97c đến 9a590a8 làm xanh dần; kết quả cuối ở mục "Kiểm chứng".
- `guest-pages.a11y.spec.tsx` (12 test, jsdom, mock auth/shop-client/api): `/san-pham/[slug]`, `/gio-hang` (có hàng, đã áp mã, trống, chưa đăng nhập), `/thanh-toan` (form địa chỉ mở; sau khi đặt đơn chuyển khoản), `/tai-khoan` (3 trạng thái),
  `/dang-nhap`, `/dang-nhap/callback` (lỗi + chờ), `/s/[slug]`, 404, lỗi chung. Mỗi trang: đúng 1 h1, không nhảy cấp heading, mọi nút/ô nhập/select/liên kết có tên truy cập (placeholder KHÔNG tính là tên, chặt hơn axe),
  nút/ô nhập có lớp vùng chạm 44px. Kèm kiểm hành vi: nút "Áp dụng" mã giảm giá vẫn chỉ bật khi có chữ, địa chỉ không còn dấu phẩy thừa khi quận/huyện rỗng (hệ 2 cấp), nút Sao chép có tên đúng.

### Kiểm chứng
```
cd apps/web && npx vitest run tailwind.config.spec.ts src/ds-v2-guest.spec.ts src/app/guest-pages.a11y.spec.tsx \
  src/app/thanh-toan/bank-transfer-panel.spec.tsx src/components/hide-on-portals.spec.tsx src/components/site-footer.spec.tsx \
  src/components/site-header.spec.tsx src/lib/public-support.spec.ts src/lib/site.spec.ts src/lib/recycling.spec.ts \
  src/lib/checkout-points.spec.ts src/lib/storefront-context.spec.ts
 Test Files  12 passed (12)
      Tests  213 passed (213)
cd apps/web && npx tsc --noEmit        -> exit 0
cd apps/web && npx eslint <các file đã sửa/thêm> -> 0 lỗi, 0 cảnh báo
node scripts/uiux/static-scan.mjs      -> web khách: hex 0, legacyPalette 0, neutral 0, greenRed 0, v2Cls 295
tailwindcss CLI (config web)           -> sinh đủ border-stone-450, text-danger-fg, bg-promo-bg, rounded-card, min-h-11, disabled:bg-stone-200, placeholder:text-stone-500
```
Không chạy Playwright/chụp màn hình (quy định máy 15,5GB); bố cục chỉ kiểm bằng spec và đọc mã.

### Giả định
- Màu trạng thái đi qua `danger/warning/success` (biến CSS token) thay vì thêm `red/amber/green` thô; thông báo lỗi của "Thêm vào giỏ" trước đây hiện màu xanh cả khi lỗi, nay lỗi dùng `danger`.
- Giá luôn `stone-900` (giỏ, thanh toán, chi tiết sản phẩm, gian hàng), nhất quán với mục 1; clay chỉ cho mã giảm giá/khuyến mãi.
- `error/global-error/not-found/loading` nằm ngoài danh sách file của gói nhưng là trang web khách, chỉ đổi tên lớp, không đổi logic. `global-error` do Next dựng thay layout gốc nên có thể không nạp `globals.css`; không kiểm chứng trực quan.
- Avatar chữ cái đầu của gian hàng vẫn đặt chữ trắng lên màu chủ đề do chủ gian hàng chọn (dữ liệu tuỳ ý); chưa tính tương phản động. Huy hiệu và chữ giá đã chuyển sang token cố định.
- Nút "Thử lại" dạng chữ cao 44px nên hơi lớn trong đoạn văn; ưu tiên vùng chạm theo yêu cầu gói.

### Chưa làm (mục 3/3)
- C-025 phần còn lại: trang chi tiết đơn + QR trả lại đơn, danh sách mã giảm giá ở thanh toán, ô tìm kiếm ở header.
- `merchant-denied` thiếu h1 và khối `legacyV1Colors` của `tailwind.config.ts`: chờ PC-11/PD-1 (cổng admin/merchant/brand).
