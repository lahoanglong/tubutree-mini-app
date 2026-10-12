# PC-2 — Hoàn tất 4b (phần mã Task 26-27) + triage minor còn tồn

## Mục 1/2 — C-084 + Task 26 phần mã (Home / Danh mục / Tìm kiếm)

Trạng thái: C-084 XONG (test vitest xanh; ảnh chụp trạng thái lỗi `capture.mjs --states error` chưa chụp: unverified — chờ T3).
Task 26 phần mã: vùng chạm XONG (guard vitest), khung chờ XONG ở mức hằng số/khai báo + e2e đo thật đã viết nhưng CHƯA chạy (unverified — chờ T3).
Task 27 (chạy full suite, ảnh, ledger): không thuộc lượt này, chờ điều phối viên T3.

### C-084 — khối Trang chủ lỗi không còn mất im lặng (XONG)

- `components/home/home-block-error.tsx` (mới): tiêu đề + một dòng thông báo theo loại lỗi (`getErrorMessage`: mất mạng / máy chủ bận / …) + nút "Thử lại" 44px, `aria-label` "Thử lại <tên khối>", haptic, nút khoá khi đang tải lại (`retrying` lấy từ `isFetching`, vì query lỗi vẫn có `isLoading=false`).
- Phủ các khối: "Bán chạy", "Tubu chọn cho bạn", "Mới về vườn", "Dành cho bạn" (qua `HomeSection`), "Mua lại" (`pages/home.tsx`), "Ưu đãi giờ vàng" (`components/flash-sale.tsx`, ngoài nhóm file, sửa tối thiểu 8 dòng vì khối đó tự dựng).
- Lỗi độc lập từng khối: mỗi khối giữ query riêng nên "Thử lại" chỉ `refetch` đúng query đó (test: bấm một khối, khối khác không bị gọi lại). Đường `GET /home` gộp của PB-6 giữ nguyên: khối `null` của `/home` rơi về request lẻ; request lẻ lỗi mới ra khối lỗi.
- Ngoại lệ có chủ đích: kệ "Mua lại" gặp 404 (API cũ chưa có endpoint, `isEndpointMissing` ở `home-blocks.ts`) vẫn ẩn như trước, vì "Thử lại" không bao giờ khỏi.
- Làm mới lỗi nhưng còn dữ liệu cũ → vẫn hiện dữ liệu cũ, không khối lỗi.
- Thuật ngữ: không đổi (Q-26 không có từ cấm trong các câu này). Chuỗi mới qua `i18n/vi.ts` (`home.retry`, `home.retryLabel`, `flashSale.sectionName`, `home.notificationsUnread`).
- Commit: `b3b6f2e` (khối lỗi + test), `c4919d6` (hàng tiêu đề khớp khung chờ), `a799d8f` (sửa `home.spec` cho nhãn chuông mới).

Test (đỏ → xanh):
- `components/home/home-parts.spec.tsx`: khối lỗi có tiêu đề/nút/thông báo, nút khoá khi đang tải lại, thông báo theo loại lỗi, còn dữ liệu cũ thì không khối lỗi; ca mới "hàng tiêu đề của khối lỗi khai báo cùng minHeight + marginBottom với khung chờ (có và không `seeAllTo`)" đỏ trước (`{minHeight:'44px',marginBottom:''}` ≠ `{minHeight:'',marginBottom:'8px'}`), xanh sau khi thêm prop `seeAllRow`.
- `pages/home.spec.tsx` (28 ca, 4 ca mang tiền tố C-084): Bán chạy/Tubu chọn/Dành cho bạn/Mua lại lỗi → khối lỗi, khối khác vẫn hiện, Thử lại chỉ tải lại khối đó, kệ Mua lại 404 vẫn ẩn.
- `components/flash-sale.spec.tsx` (2 ca): giờ vàng lỗi → khối có tiêu đề + thông báo + Thử lại, thử lại thành công hiện đợt giờ vàng.

### Task 26 phần mã — vùng chạm >= 44px (XONG)

- `pages/discovery-hit-targets.spec.tsx` (7 ca, mới): duyệt mọi `button/[role=button]/a[href]` của Header Trang chủ, HomeSection (cả lỗi), CatalogGrid, CategoryGrid, SortChips/ResultHeader/FilterSheet, SuggestList, RecentlyViewedRail, HomeExtras, UpcomingFlashSales; cao khai báo (height/min-height hoặc lớp `tubu-hit-44*`) < 44px thì đỏ. Khi viết: phát hiện nút "Nhắc tôi" của giờ vàng sắp diễn ra (`flash-sale.tsx`) thấp hơn 44px → sửa (`3398312`).
- Guard thứ hai: pages không import namespace `zmp-ui` cho nút (lint) — `fd2be53`.
- Giới hạn: jsdom không có layout nên test đọc kích thước KHAI BÁO; vùng chạm đo thật ở 320/375/390px do e2e dưới đây (chưa chạy).

### Task 26 phần mã — khung chờ chống nhảy layout

Rà từng khung chờ của Home/Danh mục/Tìm kiếm so với nội dung thật:
- Lưới SP (`CatalogGridSkeleton`): dựng từ cùng hằng số với `ProductTile` (`TILE_BODY_HEIGHT` = 133px, đo thật ở 4b Task 13 = 133,05px ở 320/375/390); số ô khung chờ = `limit` thật của khối (`HomeSection limit`), Danh mục 6 ô.
- Lưới Danh mục: số ô chờ lấy từ lần tải thành công trước (`useCategories.placeholderCount`).
- Dải "Đơn của bạn": khung chờ 78px (60 dòng + 18 viền/đệm Card) CHỈ khi badge đơn > 0; cố ý không giữ chỗ cho khách không có đơn.
- Khối lỗi mới (C-084): hàng tiêu đề khai báo y hệt hàng tiêu đề của khung chờ (`seeAllRow`) nên tiêu đề không nhảy khi loading → lỗi (khối lỗi thấp hơn lưới là bắt buộc, không thể bằng).
- `HomeHeader`: chuông thông báo giờ có tên truy cập kèm số chưa đọc ("Thông báo, 3 chưa đọc") vì huy hiệu là `span` ngoài nút, trình đọc màn hình không nghe (`c4919d6`).
- `RecentlyViewedRail`: đệm dưới 12px (bóng đổ không bị `.scroll-x` cắt), bù lại đệm section 12 → 4 nên tổng chiều cao không đổi (`46964e1`).
- `pages/browse.tsx`: thêm `<h1>` ẩn "Khám phá" (`SR_ONLY`) — landmark tiêu đề còn thiếu ở Danh mục (`0ed3792`).

E2E Task 26 (CHƯA chạy — unverified, chờ T3): `apps/e2e/tests/buy-flow-4b.miniapp.spec.ts` thêm `describe` "bố cục 320/375/390, vùng chạm, khung chờ" (commit `b233873`), 5 ca:
- 3 ca (320/375/390): Home khách cũ + Danh mục + Bộ lọc — không tràn ngang (cả `documentElement` và `.zaui-page`), chip "Gợi ý"/"Bán chạy" phủ vùng chạm 44px (`elementFromPoint` cách mép 3px, sửa selector từ plan cũ `[role=button]` sang `button` vì Chip nay là `<button>`), nút "Xem n sản phẩm"/"Xoá bộ lọc" nằm trọn và không bị rút gọn; chụp `home-4b-*.png`, `browse-4b-*.png`, `filter-sheet-4b-*.png` vào output dir.
- 1 ca (375): khung chờ "Bán chạy" (Home) và lưới kết quả (Danh mục) lệch ≤ 16px so với thẻ thật. Selector thẻ thật cập nhật theo C-072: `button.tubu-tile-link` → tổ tiên `.tubu-press`.
- 1 ca (375, mới so với plan): khung chờ dải "Đơn của bạn" lệch ≤ 8px so với dải thật một dòng đang giao (order-strip.tsx ghi "e2e Task 26 đo lại").
- Đã kiểm: `npx tsc --noEmit -p tsconfig.json` (apps/e2e) sạch, `playwright test --list` liệt kê đủ 16 ca (không chạy trình duyệt). Nếu T3 thấy lệch quá ngưỡng, sửa hằng số trong `catalog-grid.tsx`/`order-strip.tsx`, không nới ngưỡng.

## Mục 2/2 — triage "deferred minors" của 4b (`.superpowers/sdd/2026-09-30-buy-flow-4b-discovery-search/progress.md`)

LÀM (rẻ, an toàn, trong nhóm file):

| Minor gốc | Việc | Commit |
|---|---|---|
| Task 17: slug không mã hoá URL khi điều hướng (slug lấy từ localStorage sửa tay được) | `encodeURIComponent(it.slug)` + test `a/b?x=1#y` | `46964e1` |
| Task 17: bóng đổ của dải bị cắt đáy bởi overflow | đệm dưới 12px (tổng chiều cao giữ nguyên) + test khai báo | `46964e1` |
| Task 17: chưa có test localStorage bị chặn | test `getItem` ném → dải ẩn, không ném (đã xanh sẵn, chỉ là guard) | `46964e1` |
| Task 18: ô trống + chưa có lịch sử, chạm chip sắp xếp thì `editing` kẹt ("Hủy" thay giỏ) | `stopEditing()` khi đổi sắp xếp + test (đỏ trước) | `0ed3792` |
| Task 18: trang Danh mục không có h1 | `<h1>` ẩn + test (đỏ trước) | `0ed3792` |
| Task 20: tên nút chuông không có số chưa đọc cho trình đọc màn hình | nhãn "Thông báo, n chưa đọc" + test (đỏ trước) | `c4919d6`, `a799d8f` |
| Task 20: `isError/error` của `SectionQuery` không dùng | nay dùng cho khối lỗi C-084 | `b3b6f2e` |

ĐÃ ĐƯỢC XỬ LÝ TRƯỚC (không làm lại):
- Task 2/8: `?maxPrice=` rỗng → 0 và "NaN" gửi lên API: `intParam` trong `utils/search-state.ts` đã trả `undefined` cho chuỗi rỗng và giá trị không phải số nguyên >= 0 (có test).
- Task 11: test đường lỗi `useCategories`: `use-categories-count.spec.tsx` có ca "lỗi tải không ghi đè số đã nhớ".
- Task 12/18: chip trong `.scroll-x` thiếu đệm dọc, ✕ gốc của ô tìm, focus ring, trả focus sau xoá: đã làm trong Task 18 (không còn trong danh sách minor của Task 18; `::-webkit-search-cancel-button` đã có ở `css/tokens.css`).

BỎ (kèm lý do):
- Task 21: FlashSale (ZaUI) hiện muộn ở slot 4 cần khung chờ có kích cỡ — giữ chỗ cho khách không có giờ vàng sẽ kéo cả nội dung bên dưới nhích ngược (hại hơn); cần dữ liệu thật + đo e2e và thuộc đợt migrate màn flash-sale (đã ghi ở ledger 4b).
- Task 21: sắp xếp lại khối trong cửa sổ khôi phục đăng nhập / `kind` lưu một ô: đổi hành vi thứ tự khối, cần e2e để chứng minh; để dự án redesign Home.
- Task 24 (4 minor của e2e: `.first()` yếu, tiêu đề ca, `findIndex()+1 = 0`, mảng thứ tự cứng): chỉ sửa được trong e2e mà lượt này không được chạy Playwright; ghi lại cho T3.
- Task 1-7, 3 (API): sort giá theo `basePrice`, NBSP/`LIMIT 2000`, cap N best_seller, dọn dữ liệu real-PG spec — thuộc `apps/api` (PA/PB), ngoài nhóm file.
- Task 12/13/19 (`components/ui`: font 15px của SearchField, aria-description giá gốc, Space theo keydown của ListRow): `components/ui` đã giao PC-1, cấm sửa ở đây.
- Task 8 `vn-fold.ts` ký tự ẩn → `\u`-escape; Task 9 slice cắt surrogate; Task 15 (đếm thừa khi mở lại, `data-testid`, khoảng giá chạm biên); Task 16 (danh sách cũ hiện lại sau lỗi, `aria-live` số gợi ý, màu/cursor nút dòng); Task 18 (kéo làm mới không làm mới danh mục, khoá `search_performed` toàn cục, `useCategories` import `browserStorage` từ recently-viewed): giá trị thấp so với rủi ro đổi hành vi/hook ngoài nhóm file; không có test e2e để bảo vệ.
- Task 20: chuông khác tone giỏ, dải thương hiệu cắt mép 16px: chỉnh thẩm mỹ, cần mắt người trên máy thật.

## Lệnh kiểm chứng và output thật

```
apps/miniapp: npx vitest run src/pages/home.spec.tsx src/pages/home-requests.spec.tsx src/pages/browse.spec.tsx \
  src/pages/discovery-hit-targets.spec.tsx src/components/home src/components/catalog src/components/flash-sale.spec.tsx \
  src/hooks src/ds-legacy-vars-4b.spec.ts src/ds-legacy-vars-4a.spec.ts
  -> Test Files 28 passed (28), Tests 342 passed (342)
     (một lượt chạy đầu có 1 ca đỏ thoáng qua, không tái hiện trong 4 lượt chạy lại liên tiếp; ghi nhận flaky dưới tải, không xác định được ca)
apps/miniapp: npx tsc --noEmit                      -> sạch
apps/miniapp: npx eslint <mọi file đã sửa/thêm>     -> 0 lỗi, 0 cảnh báo
apps/e2e:     npx tsc --noEmit -p tsconfig.json     -> sạch
apps/e2e:     npx playwright test --list buy-flow-4b.miniapp -> Total: 16 tests in 1 file (liệt kê, KHÔNG chạy)
```

## Migration

Không.

## Giả định

- Khối lỗi Trang chủ ưu tiên "không mất khối im lặng" hơn "gọn": khi mất mạng hoàn toàn, tối đa 4-5 thẻ lỗi nhỏ xếp dọc (mỗi thẻ có Thử lại) thay vì chỉ có header + khối phụ như spec 4b §9 cũ. Chủ dự án có thể muốn gộp thành một thẻ chung khi mọi khối cùng lỗi (chưa làm: sẽ đổi mô hình "lỗi độc lập từng khối").
- Kệ "Mua lại" 404 giữ ẩn (API cũ chưa có endpoint), không hiện lỗi.
- Chuông thông báo: giữ nguyên huy hiệu `span aria-label` (component `CountBadge` dùng chung, thuộc `components/ui`) và chỉ đổi tên của nút; hai nơi cùng nói số chưa đọc nhưng chỉ nút là tên truy cập thật.

## Việc còn lại (cho T3 / lượt sau)

- Chạy `E2E_SCOPE=miniapp ... playwright test buy-flow-4b --workers=1 --retries=0` và xem ảnh `home-4b-*`, `browse-4b-*`, `filter-sheet-4b-*` ở 320/375/390px (Task 27 bước 3).
- Chụp trạng thái lỗi Home: `node scripts/uiux/capture.mjs miniapp --only '^home$' --states error --vp 390 --force`, kiểm khối lỗi + nút Thử lại (catalog C-084).
- Task 27 bước 4: cập nhật ledger `docs/superpowers/plans/2026-09-28-design-system-v2-followups.md` (mục "Buy-flow 4b follow-ups" + "Deploy notes"); chưa làm vì ngoài nhóm file của gói.
- Nếu e2e đo khung chờ dải đơn lệch > 8px: chỉnh `PLACEHOLDER_ROW_HEIGHT` trong `components/home/order-strip.tsx`.
