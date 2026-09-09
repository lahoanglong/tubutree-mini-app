# Báo cáo phiên review qua đêm — Tubu Tree (2026-09-08 → 09)

Điều khiển bởi `docs/2026-09-08-full-project-review-prompt.md`. Nhật ký chi tiết từng bước:
`docs/2026-09-08-review-progress.md`. Bản đồ tính năng gốc: `docs/2026-09-08-feature-map.md`.

## Tóm tắt 1 dòng

Audit đầy đủ 4 mảng (đơn hàng/tồn kho, xã hội/game, tiền/giá, quyền/danh tính) bằng agent độc
lập đọc code thật; sửa **13 lỗi P0/P1 đã xác nhận bằng test đỏ→xanh** (7 P0 mất tiền/bảo mật
thật, 6 P1); **8 commit, đã push `origin/main`**; toàn bộ workspace xanh (typecheck + lint +
test) ở cả API, miniapp, web. Chưa chạm tới Phase 2 (coherence UX), Phase 4-5 (design system),
Phase 6 (hiệu năng), Phase 7 (tính năng tăng trưởng) — xem lý do ở cuối.

## Số liệu trước/sau (đo bằng lệnh thật, không ước lượng)

| | Đầu phiên | Cuối phiên |
|---|---|---|
| API: test suite / test | 86 / 1204 | 93 / 1309 |
| Miniapp: test suite / test | (chưa đo — vitest chưa cấu hình DOM) | 6 / 36 |
| Web: test suite / test | (không đổi) | 1 / 14 |
| typecheck (toàn workspace) | sạch | sạch |
| lint (toàn workspace) | sạch | sạch |
| `nest build` | sạch | sạch |
| Nest DI graph (tự boot `nest start`) | — | resolve đúng, không `UnknownDependenciesException` |

Lệnh verify cuối cùng đã chạy thật (không phải suy đoán):
```
pnpm typecheck   → 5/5 task pass
pnpm lint        → 5/5 task pass
pnpm test:ci     → api 93/1309, web 1/14 pass
pnpm --filter @tubutree/miniapp test → 6/6 suite, 36/36 test pass
```

## Đã sửa — theo domain, mỗi mục có commit + test

### Đơn hàng / tồn kho
1. **P0-1 + P0-4 + P1-1 — 4 nơi ghi `Order.status` không dùng chung 1 bảng chuyển trạng thái.**
   Đơn DELIVERED có thể bị lùi về CONFIRMED rồi bị "hủy" lại (hoàn tiền/restock 2 lần); webhook
   Pancake hủy đơn không restock/hoàn tiền; merchant đổi trạng thái không cộng/đảo điểm-hoa hồng.
   → `order-transition.ts` (bảng chuyển trạng thái dùng chung) + `order-reversal.service.ts`
   (khối hoàn tiền/restock dùng chung) + `order-status.service.ts` (nguồn ghi status duy nhất
   cho admin/merchant/pancake). Bonus: phát hiện `orders.service.cancel` thiếu
   `reverseCommissionsForOrder`. Commit `f4b58fe`, 31 test.
2. **P0-2 — đẩy đơn → Pancake fire-and-forget, lỗi 1 lần là mất vĩnh viễn.**
   → Queue BullMQ mới (`pancake-push`) có retry 5 lần + cron đối soát 15 phút.
   Commit `df19ae4`, 26 test.
3. **P1-2 — VNPAY được chấp nhận ở checkout nhưng không có service/webhook nào xử lý** → đơn
   khóa chết tồn kho vĩnh viễn. Đã bỏ khỏi danh sách phương thức hợp lệ. (gộp trong commit
   `3656d86`)
4. **P1-3 — tiền chuyển khoản/ZaloPay tới SAU khi đơn đã hủy/trả vẫn bị lật PAID êm.**
   → thêm guard status ở cả `pancake.processor.onPaymentReconcile`, `zalopay.service
   .handleCallback`, và chặn từ gốc ở `bank-transfer.service.getBankQr` (không sinh QR sống
   cho đơn đã chết). Commit `384e2e7`, 7 test (trước đây `onPaymentReconcile` KHÔNG có test
   nào).

### Xã hội / Game (Vườn Xanh, mua chung)
5. **P0-1 — xu mua nước rẻ hơn hàng chục lần giá trị coupon thu hoạch** → vòng
   mua-nước→tưới→thu-hoạch in coupon vô hạn. → trần cứng `game.harvest_coupon_daily_cap`
   (3/ngày) bằng CODE, đếm trong transaction Serializable (không TOCTOU). Bonus: mirror guard
   `eco.target<=0` từ `game-garden.service.ts` sang `waterTree` (chặn vòng lặp vô hạn).
6. **P0-2 — group buy mint coupon miễn phí** (không `minOrder`/product restriction, tự làm đủ
   thành viên bằng tài khoản phụ là có tiền). → bắt buộc `minOrder = unitPrice` + trần số nhóm
   OPEN/user. Commit `eb4a7b3`, 8 test.
7. **P1-5 — trần số câu quiz/ngày không được thực thi**, chỉ chặn trả lời trùng 1 câu.
   → đếm attempt hôm nay trước khi tạo mới. Commit `f976d9b`, 2 test.

### Tiền / Giá
8. **P0 — CTV tự đăng ký (không cần duyệt) tự đặt `comboDiscountPct` gian hàng mình tới 100%**
   → đơn thật 0đ, shop trả tiền. → trần `storefront.max_combo_pct` (30%) clamp ở CẢ nơi ghi
   (`StorefrontService`) và nơi tính (`ComboService`, defense in depth).
9. **P1 — hủy đơn không hoàn coupon** → voucher 1 lần (birthday/welcome/referral) bị đốt vĩnh
   viễn cho đơn chưa hoàn tất. → `CouponsService.release()` mới, đối xứng với `redeem()`, wired
   vào `OrderReversalService` (tự động cho cả 3 luồng hủy/trả). Commit `3656d86`, 19 test.

### Quyền / Danh tính
10. **P0-1 + P0-2 (nguồn gốc) — `slug`/`subdomain`/`customDomain` mỗi cột unique riêng nhưng
    đọc trộn cả 3 bằng OR, ghi chỉ kiểm trùng CHÍNH cột** → CTV chiếm subdomain trùng slug
    gian hàng khác, có thể giả mạo QR ngân hàng/lộ đơn hàng qua merchant order API (khớp slug).
    → `identifier-validation.ts` dùng chung, kiểm trùng CHÉO cả 3 cột; `customDomain` bắt buộc
    có dấu chấm, `subdomain` bắt buộc không có — tách biệt 2 không gian tên tự nhiên.
11. **P0-3 — hạ quyền admin không thu hồi `RoleGrant`** → lần refresh token sau, `applyGrants`
    (chỉ nâng không hạ) tự phục hồi quyền đã bị thu hồi. → `RbacService.revokeGrantsAbove()`
    mới, gọi từ `setUserRole`. Commit `15f417b`, 24 test.
12. **P1-1 — IDOR `addResellProduct`**: `collectionId` từ body không kiểm thuộc gian hàng
    caller → chèn sản phẩm vào gian hàng người khác.
13. **P1-2 — refresh-token reuse chỉ chặn đúng token bị replay**, không thu hồi cả chuỗi →
    kẻ trộm đã rotate 1 lần thì chuỗi của họ sống nguyên 30 ngày. → thu hồi TOÀN BỘ token active
    của user khi phát hiện reuse. Commit `bfef88d`, 4 test.

## Chưa làm — vì sao, và để lại gì

- **P0-3 (đơn hàng) — Pancake catalog sync ghi đè tuyệt đối `stock`.** Đây là quyết định kiến
  trúc (reserved-stock riêng hay Pancake-là-nguồn-chân-lý), không phải fix 1 dòng an toàn để
  làm vội lúc 3-4 giờ sáng. Để lại nguyên vẹn, mô tả kỹ trong progress log.
- **P1 quyền/danh tính còn lại**: AFFILIATE tự cấp không cần duyệt (audit tự nhận có thể là
  quyết định sản phẩm hợp lý, không phải bug) — để user quyết định.
- **P1 xã hội còn lại**: reputation farming không trần (`bumpReputation` không có
  reason/refId để đếm — cần thêm cột/bảng, không phải sửa nhanh), best-answer farming không
  trần, comment thiếu endpoint ẩn/kiểm duyệt, edit sau duyệt không reset về PENDING.
- **P2 khắp 4 domain**: guest login `Math.random()`, refresh token web trong localStorage,
  milestone voucher cấp 2 lần ở ranh giới tháng, cashback rate hiển thị sai ×100 ở FE, hạng
  thành viên tính theo điểm CÒN LẠI (tiêu điểm bị tụt hạng), zalopay paymentTxnId bị ghi đè
  giữa các lần thử (cần bảng PaymentAttempt riêng), vài chỗ thiếu `@ArrayMaxSize`.
- **Phase 2 (coherence audit UX), Phase 4-5 (design system + áp dụng theo lô), Phase 6 (hiệu
  năng), Phase 7 (tính năng tăng trưởng): CHƯA BẮT ĐẦU.** Lý do: prompt gốc ưu tiên "chất lượng
  hơn số lượng" — với ngần ấy lỗ hổng bảo mật/tiền P0 thật được audit tìm ra bởi 4 agent độc
  lập, dành toàn bộ thời gian còn lại của phiên để sửa và verify chúng đúng cách (mỗi lỗi có
  test đỏ trước khi sửa) là lựa chọn đúng hơn là dàn mỏng sang UI/tính năng mới trong khi vẫn
  còn lỗ hổng tiền-mất-thật chưa đóng. Toàn bộ 4 audit đã HOÀN THÀNH — phiên sau có thể bắt đầu
  thẳng vào Phase 2/4 với danh sách P1/P2 còn lại đã có sẵn, không cần audit lại.

## Việc cần người (không tự làm được / ngoài phạm vi phiên này)

1. **Không có migration Prisma nào cần chạy** — mọi sửa lỗi tối nay là logic ứng dụng thuần,
   không đổi schema. `db:migrate` không cần chạy.
2. **Docker Desktop / DB local đang tắt** (do restart máy/phiên) — không tự bật lại được từ
   phiên này (ngoài phạm vi công cụ). Trước khi verify UI/luồng thật trên máy, chạy:
   `docker compose -f docker-compose.dev.yml up -d` rồi `pnpm --filter @tubutree/api dev`.
3. **Audit trước khi deploy prod (khuyến nghị mạnh, không bắt buộc để merge)**: chạy trên DB
   PROD thật (không phải qua tool này):
   ```sql
   SELECT count(*) FROM storefronts
   WHERE (subdomain IS NOT NULL AND subdomain NOT IN (SELECT slug FROM storefronts))
      OR (custom_domain IS NOT NULL AND custom_domain IN
          (SELECT slug FROM storefronts UNION SELECT subdomain FROM storefronts));
   ```
   (đổi tên cột theo `@@map` thật nếu cần) — kiểm xem có collision slug/subdomain/customDomain
   nào đã tồn tại TRƯỚC bản vá P0-1 hay không. Code mới chỉ chặn collision MỚI, không tự dọn
   collision cũ. Nếu có, cần đổi tên thủ công 1 bên.
4. **Quyết định nghiệp vụ còn treo**: có nên siết CTV tự đăng ký (`POST /affiliate/register`)
   thành có duyệt hay không — hiện để nguyên, rủi ro chính (combo 100%) đã chặn ở nguồn.
5. **Deploy**: mọi thay đổi mới chỉ ở nhánh `main` local + đã push GitHub — CHƯA deploy BE/WEB
   lên VM prod, CHƯA deploy miniapp lên Zalo. Cần deploy thủ công theo quy trình đã ghi ở
   memory (`project_retention_features.md`) nếu muốn đưa các bản vá này lên môi trường thật.

## Cách tiếp tục phiên sau

1. Đọc `docs/2026-09-08-review-progress.md` để thấy đầy đủ chi tiết kỹ thuật từng mục (đã ghi
   commit hash + số test cho mọi thứ đã sửa).
2. Việc rẻ/nhanh còn lại (ưu tiên trước khi sang Phase 2/4): reputation farming cap, comment
   moderation endpoint, best-answer farming cap — đều đã có root cause xác định sẵn.
3. Sau đó vào Phase 2 (coherence audit UX) rồi Phase 4-5 (design system) theo đúng thứ tự
   prompt gốc.
