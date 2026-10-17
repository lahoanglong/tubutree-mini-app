# Gói uiquick (D7 top 12) — báo cáo thực thi

Nhánh `lr/uiquick`, tách từ `review/2026-10-18-launch`. Mã trong `apps/miniapp/src`. Mỗi mục một commit, test đỏ trước. Phần "Sửa theo review" ở cuối mục 1 ghi 5 sửa sau vòng review của điều phối (commit `2034d7ea`…`714ee0af`).

## 1. Đã làm gì (theo mục D7)

| Mục D7 | Commit | Nội dung | File chính |
|---|---|---|---|
| Việc 2: thẻ đơn "Chờ thanh toán" | `645e3781` | Thẻ đơn có hạn thanh toán (`Hạn HH:mm dd/MM/yyyy`, theo `formatDateTime`) và nút "Thanh toán ngay" → `/bank-payment/:code`. Điều kiện gom một chỗ `canPayOrderNow` (PENDING_PAYMENT + chuyển khoản + không `manualHandling` + chưa quá hạn), trang chi tiết đơn dùng chung nên hai nơi không lệch. Nút nằm trên lớp stretched-link (z-index 1) nên không lồng nút trong nút. | `utils/refund-rules.ts`, `components/orders/order-card.tsx`, `pages/orders.tsx`, `pages/order-detail.tsx` |
| Việc 3: chi tiết SP | `566d4680` | Nút "Chat với Tubu Tree" Zalo OA (`openOAChat`, ẩn khi `hasOA` = false) trong khối "Cam kết Tubu", không còn ở thanh CTA dính; tên SP 17/600 (token title-md); mọi tiêu đề mục dùng một `SectionTitle`. Không đụng khối chia sẻ. | `pages/product-detail.tsx`, `components/ui/section-title.tsx`, `components/reviews-section.tsx` |
| Việc 12: chặn hiển thị biên | `5176e528` | "Đã bán" kẹp 0–100% (`soldPercent`); hết giờ thì ẩn "Còn 0h 00m", thẻ sắp diễn ra đổi thành "Đang diễn ra" và bỏ nút nhắc; "Mời thêm N bạn" chỉ hiện khi N > 0; ẩn "nhận tới % hoa hồng" khi không có %; vòng quay và ô thưởng dùng `formatNumber`; nút "Điểm danh"/"Mua" `flexShrink: 0` nên không còn "Điểm d…". `formatCountdown` trả '' khi hết giờ. | `utils/flash-display.ts`, `hooks/use-countdown.ts`, `components/flash-sale.tsx`, `pages/wallet.tsx`, `pages/brand-view.tsx`, `pages/cart.tsx`, `components/wheel.tsx`, `components/game/wheel-prize-sheet.tsx`, `components/game/checkin-streak.tsx` |
| Việc 7: trạng thái lỗi/rỗng | `98409081` | Trang chủ có một dải lỗi cấp trang (các khối con tự ẩn lỗi riêng qua context `HomeBlockErrorSuppressed`). `ErrorState` có icon lỗi riêng, tiêu đề, "Cần hỗ trợ? Gọi hotline" (số từ cấu hình công khai, lỗi thì dùng số mặc định). Kệ "Có thể bạn thích" (4 SP bán chạy, còn hàng) dưới giỏ trống, SP không tìm thấy, gian hàng không tìm thấy. `storefront-view` thêm `PageHeader` và màn 404. | `components/ui/empty-state.tsx`, `components/support-hotline.tsx`, `components/catalog/suggested-rail.tsx`, `components/home/home-page-error.tsx`, `components/home/home-block-error.tsx`, `pages/home.tsx`, `pages/cart.tsx`, `pages/product-detail.tsx`, `pages/storefront-view.tsx` |
| Việc 8: thẻ bài cộng đồng | `cbdcaeba` | Tên tác giả một dòng, cắt "…"; huy hiệu chuyên gia/hạng xuống dòng cùng thời gian; chip hashtag có `maxWidth` + cắt "…"; bỏ hashtag trùng thẻ SP gắn kèm (`dedupeTagsAgainstProducts`, so theo nguyên từ, xem "Sửa theo review"). Trang chi tiết bài và hàng bình luận dùng chung `AuthorLine` (bỏ `ExpertBadge` cục bộ). | `components/community/author-line.tsx`, `components/community/post-tags.ts`, `components/community/post-card.tsx`, `pages/post-detail.tsx` |
| Việc 6: emoji trong `vi.ts` | `1f53de1b` | 19 chuỗi đổi sang icon lucide: giờ vàng (huy hiệu, tiêu đề, đồng hồ, "Sắp diễn ra", "Nhắc tôi"/"Đã đặt nhắc"), nhãn loại bài cộng đồng (4), "Chờ duyệt", Chặng Mùa (tiêu đề, "Đã nhận", "Chưa mở", gợi ý Premium), hồi sinh chuỗi, Academy (2), lời chào Trang chủ. `Badge` thêm prop `icon`, `Icon` thêm tông `current`. Spec `i18n/ui-emoji.spec.ts` khoá danh sách emoji được giữ. Số dòng `vi.ts` còn emoji theo bộ so khớp của `static-scan`: 36 → 19. | `i18n/vi.ts`, `components/ui/badge.tsx`, `components/ui/icon.tsx`, `components/flash-sale.tsx`, `components/product-card.tsx`, `components/catalog/catalog-grid.tsx`, `components/community/post-card.tsx`, `components/game/season-pass.tsx`, `components/game/streak-repair.tsx`, `pages/academy.tsx`, `pages/post-detail.tsx`, `pages/cart.tsx`, `pages/product-detail.tsx` |

### Sửa theo review (5 mục)

| # | Commit | Sửa gì |
|---|---|---|
| 1 MAJOR | `2034d7ea` (api) | `GET /orders` (danh sách) không trả `paymentDeadline` nên "Hạn …" trên thẻ đơn không bao giờ hiện với dữ liệu thật; spec cũ xanh vì fixture tự gắn. `attachItemMedia` giờ gắn hạn cho cả trang bằng `pendingPaymentDeadlines` (`orders/pending-payment-ttl.ts`): mỗi khoá TTL đọc tối đa một lần cho cả trang, không đọc gì khi trang không có đơn chờ tiền, đơn đại lý dùng TTL riêng, `autoCancelBlockedAt` thì null. `detailView` dùng chung giá trị này (bỏ `paymentDeadline()` riêng). Shared-types đã có sẵn trường nên không đổi. |
| 5 MINOR | `d3f3393a` | `canPayOrderNow(o, now = Date.now())` ẩn nút khi `paymentDeadline` đã qua (kể cả đúng mốc); không có hạn hoặc hạn không đọc được thì giữ hành vi cũ. Áp cho cả thẻ đơn và chi tiết đơn (dùng chung hàm), nên chi tiết đơn quá hạn cũng không còn nút "Thanh toán ngay". Fixture hạn trong `order-card.spec`/`orders.spec` đổi sang mốc tương lai/đồng hồ giả. |
| 3 MINOR | `e282e817` | `dedupeTagsAgainstProducts` so theo TỪ (bỏ dấu, tách theo ký tự lạ) thay vì chuỗi đã xoá dấu cách, nên không còn khớp vắt qua ranh giới từ (`#Thương` không còn bị bỏ vì "giặt hương"). Chỉ bỏ khi trùng hẳn tên/slug hoặc là phần ĐẦU của tên theo nguyên từ và dài từ 6 ký tự. Spec mới `post-tags.spec.ts` có cả hai ví dụ của review. |
| 4 MINOR | `4fbb920b` | `soonestEndAt` của `FlashSale` chỉ tính suất có `endAt` ở tương lai và tính lại ngay khi suất đang đếm về 0, nên đồng hồ chuyển sang suất kế tiếp thay vì biến mất. Hai spec mới (suất hết giờ lẫn suất còn giờ; hết giờ khi đang xem, đồng hồ giả). |
| 2 MAJOR | `714ee0af` | Nút Chat OA ra khỏi thanh CTA dính (diff của `StickyActionBar` so với gốc = 0); thành `Button` "Chat với Tubu Tree" (secondary, cao 44px, ẩn khi không có OA) ở cuối khối "Cam kết Tubu". Bỏ prop `tone` của `IconButton` vì không còn nơi dùng (file về đúng bản gốc). `product-detail-chat.spec.tsx` viết lại: nút nằm trong khối cam kết, thanh dính không có nút Chat, giỏ vẫn 48px. |

Lệch với lời review ở mục 3: ví dụ thứ hai ("Nước rửa chén sinh học" mất `#Sinh học`) là một dãy nguyên từ liền nhau, nên đúng chữ của luật "bỏ mọi dãy nguyên từ liền nhau" vẫn bỏ nó. Để cả hai ví dụ cùng được giữ tôi thu hẹp luật xuống "phần đầu của tên theo nguyên từ": `#Nước rửa chén` vẫn bị bỏ (cách gọi tắt chính sản phẩm), `#Sinh học` và `#rửa chén` (đoạn giữa/cuối, là chủ đề dùng chung nhiều sản phẩm) được giữ. Giữ nhầm một chip chỉ tốn chỗ, bỏ nhầm là mất chủ đề.

Chuỗi giữ nguyên emoji (lời nhắn khích lệ/thông báo, theo yêu cầu): `added`, `skipOk`, `createdNow`, `createdScheduled`, `createdExisting`, `freeshipReached`, `published`, `successTitle`, community `subtitle`, `posted`, `reported`, `pendingNotice`, `eventCreated`, `streakRepair.ok`, `seasonPass.claimOk`, `missions.claimOk`, `markDoneOk`. Giữ ký tự `★` của `rating4Chip`/`rating4` ("Từ 4★"): là chữ, không phải emoji, và 5 spec cùng selector e2e (`buy-flow-4b-browse.miniapp.spec.ts`) đang dùng nguyên chuỗi.

Cố ý không sửa: `pages/game.tsx`, `pages/loyalty.tsx`, `pages/checkout.tsx`, `components/app.tsx`; khối chia sẻ `product-detail.tsx:309-321` (diff không có hunk nào ở vùng này).

## 2. Lệnh kiểm chứng đã chạy

Từ `apps/miniapp`, `TZ=UTC` cho spec ngày/đếm ngược:

- Vitest sau 5 sửa review (37 spec đã sửa/thêm trên nhánh + các spec liên quan theo tên: cart, product, home, game, community, flash, catalog, browse, orders, wallet, brand, ds-c076, discovery, academy, ui, i18n, storefront, empty-state, refund, post-, order), chạy hai lần:
  `TZ=UTC`: `Test Files  132 passed (132)` / `Tests  1952 passed (1952)`;
  `TZ=Asia/Ho_Chi_Minh`: `Test Files  132 passed (132)` / `Tests  1952 passed (1952)`.
- API: `npx jest src/modules/orders src/modules/integrations/payment` (từ `apps/api`, sau `npx prisma generate` trong worktree): `Test Suites: 25 passed, 25 total` / `Tests: 631 passed, 631 total`.
- `npx tsc --noEmit`: miniapp exit 0, api exit 0.
- `npx eslint <mọi file .ts/.tsx đã sửa của miniapp, và orders.service.ts, pending-payment-ttl.ts, orders.service.spec.ts của api> --max-warnings=0`: exit 0.
- `npm run -s lint:vars` ở gốc: `OK — every var(--x) reference is defined.`
- Spec chạy đỏ trước khi viết mã ở mỗi mục (ví dụ mục 6: 17 test đỏ, gồm `ui-emoji.spec.ts`, `badge.spec.tsx`, `season-pass.spec.tsx`, `flash-sale.spec.tsx`, `post-card.spec.tsx`), sau đó xanh.
- Lệch quy trình, nói thẳng: khi chạy mục 8, một lệnh vitest nhận danh sách spec rỗng nên chạy cả bộ miniapp (242 file, 3.379 test đều xanh, trước mục 6). Không có lần chạy toàn bộ nào khác. Không build, không Playwright, không dev server.
- Một lần `product-detail-a11y.spec.tsx` ("thư viện ảnh ... tabindex") đỏ khi chạy song song 97 file, chạy riêng 8/8 xanh, và lượt 120 file cuối xanh. Nguyên nhân chưa điều tra, nghi đo tràn trong jsdom bị trễ khi máy tải cao: chưa kiểm.
- e2e (`apps/e2e/tests`) chỉ grep, không chạy: các chuỗi đã đổi không có selector nào dính (`Thanh toán ngay` ở `buy-flow-4a`/`shipping-pancake` là trang chi tiết đơn, không phải thẻ đơn).

## 3. Chưa làm hoặc cố ý để lại

- Emoji ngoài `vi.ts` còn nhiều: `components/community/rank-badge.tsx` (🌳 theo hạng), `components/game/game-utils.ts` (có spec khoá cho file này), emoji nằm trong chuỗi cứng của `pages/game.tsx`, `pages/loyalty.tsx:418` (🔥 cạnh "ngày liên tiếp"), tên hạng CTV `tier.emoji` ở `pages/affiliate.tsx:430`. D7 chỉ nêu 26 chuỗi `vi.ts` nên tôi dừng ở đó; hai file `game.tsx`/`loyalty.tsx` đang bị phiên đổi-rác sửa.
- Biên nằm trong file bị cấm, cần phiên đó xử lý: `pages/loyalty.tsx:402` in thẳng `getErrorMessage(...)` vào khối lỗi lịch điểm danh; `pages/loyalty.tsx:415-418` chuỗi tiếng Việt và emoji cứng ngoài `vi.ts`. `pages/game.tsx` dựng `StreakRepair`/`SeasonPass`: props không đổi nên tương thích với phần tôi sửa trong `components/game/`.
- Việc 7: kệ "Có thể bạn thích" chỉ gắn vào ba chỗ D7 nêu (giỏ trống, SP không tìm thấy, gian hàng không tìm thấy); các màn rỗng khác (tìm kiếm không ra kết quả, v.v.) chưa kiểm và chưa gắn.
- Việc 12: "Mời thêm" chỉ được sửa ở `wallet.tsx`; chưa thấy chỗ khác in chuỗi này (grep `Mời thêm` ra duy nhất `vi.ts:515` và `wallet.tsx`).
- Chưa kiểm trên máy Zalo thật hay trình duyệt 390px: mọi kết luận hiển thị dựa trên jsdom và spec, không có ảnh chụp.
- Không có thư viện mới nào.

## 4. Câu hỏi cho chủ dự án

1. Nút Chat OA ở trang sản phẩm: mặc định nằm trong khối "Cam kết Tubu" (dưới màn, không còn trên thanh dính) và chỉ hiện khi app có OA (`hasOA`); không có OA thì ẩn, không thay bằng gọi hotline. Muốn nó lên gần giá hơn, hay thêm nút gọi hotline khi không có OA?
2. Nút "Thanh toán ngay" (thẻ đơn và chi tiết đơn): mặc định chỉ cho đơn chuyển khoản đang chờ, không `manualHandling`, chưa quá hạn. Đơn không phải chuyển khoản hoặc đã quá hạn không có nút. Đúng ý chưa?
3. Kệ "Có thể bạn thích": mặc định 4 SP bán chạy còn hàng. Muốn đổi sang SP cùng danh mục/gian hàng hay giữ bán chạy?
4. Hashtag trùng thẻ SP: mặc định bỏ khi trùng hẳn tên/slug SP hoặc là phần đầu của tên theo nguyên từ (từ 6 ký tự); đoạn giữa/cuối của tên là chủ đề riêng nên giữ. Muốn chặt hơn (chỉ khớp tuyệt đối) không?
5. Có muốn dọn tiếp emoji ngoài `vi.ts` (hạng cộng đồng, Vườn Xanh, trang Điểm Xanh) ở đợt sau không? Mặc định: chưa, đợi phiên đổi-rác xong để khỏi xung đột `game.tsx`/`loyalty.tsx`.
