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

### Chưa làm (các mục sau của PC-7)
- Mục 2/3, 3/3: chuyển san-pham, gio-hang, thanh-toan, tai-khoan, s/[slug], dang-nhap sang DS v2 (thêm vào `MIGRATED`), C-025 phần còn lại (trang chi tiết đơn + QR,
  ô mã giảm giá ở thanh toán, ô tìm kiếm ở header), C-116/C-123/C-077 trên các trang đó. Xoá khối legacy v1 khỏi `tailwind.config.ts` khi PC-11/PD-1 xong.
