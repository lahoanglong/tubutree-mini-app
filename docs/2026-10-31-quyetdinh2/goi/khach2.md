# Gói qd2 khach2: tin khi lên hạng, tự áp mã giảm ở thanh toán

Gốc: `6fae1a289`. Đọc kỹ luật chung `tools/brief-worker.md`. `migration: true`, thư mục migration bắt đầu bằng `20261031100000`.

## E-80: tin khi khách lên hạng

Chủ chốt (nguyên văn): "E-80: gửi tin trong app khi khách lên hạng (câu chỉ nêu tên hạng); không gửi khi hạ hạng (đã có tin nhắc trước 14 ngày)."

Hiện trạng (scout):
- `apps/api/src/modules/loyalty/loyalty.service.ts`: `recalcTier(userId)` (khoảng :334) ghi `tierId` và `tierGraceUntil` (khoảng :371); `recalcAllTiers()` (khoảng :432).
- Cron tính lại: `loyalty.cron.ts` `'0 15 3 * * *'`. Tin nhắc hạ hạng: `tier-drop-notice.service.ts`, mã `TIER_DROP_NOTICE`.
- Biến: `notification-variables.ts` (khoảng :60 `TIER_DROP_NOTICE`, :209 `tier: 'hạng'`). Route: `packages/app-core/src/notification-route.ts` (khoảng :59, :146 `/loyalty`).
- PR #84 của b4 (đã merge) vừa sửa `loyalty.service.ts`. Đọc diff (`git log --oneline 216c50935..0c9f8eb69`).

Luật mới:
1. Khi `tierId` đổi sang hạng có thứ bậc cao hơn hạng cũ: gửi một tin trong app, mã mới (ví dụ `TIER_UPGRADED`). Câu chỉ nêu tên hạng, ví dụ "Chúc mừng bạn đã lên hạng {{tier}} tại Tubu Tree 🌿". Bấm tin mở trang hạng thành viên (`/loyalty`).
2. Không gửi khi:
   - hạ hạng;
   - giữ nguyên hạng;
   - người dùng mới được gán hạng thấp nhất lần đầu (null sang hạng đầu);
   - đổi hạng do admin cấu hình lại bậc hạng hàng loạt, nếu phân biệt được. Không phân biệt được thì ghi vào báo cáo.
3. Đúng một tin cho mỗi lần lên hạng thật, kể cả khi `recalcTier` chạy hai lần hay hai tiến trình chạy cùng lúc. Gửi sau khi ghi hạng thành công.
   - Lên rồi xuống rồi lên lại cùng hạng: được gửi lại. Chọn dedupeKey thoả ca này và ghi lý do.
4. Mẫu tin chèn bằng migration (ON CONFLICT DO NOTHING), thêm vào seed, thêm biến vào `notification-variables.ts`, thêm route.

Test: unit `recalcTier` (lên, xuống, giữ, lần đầu); race spec mới: hai `recalcTier` cùng lúc cho cùng khách lên hạng thì một tin. Chạy lại các race spec `tier-*` và `loyalty-*`.

## E-6: thanh toán tự áp mã giảm nhiều nhất

Chủ chốt (nguyên văn): "E-6: thanh toán tự áp mã giảm nhiều nhất khách đang có, hiện rõ 'Đã tự áp' và nút gỡ."

Hiện trạng (scout):
- Mini:
  - `apps/miniapp/src/pages/checkout.tsx` (khoảng :201, gợi ý khi giỏ chưa có mã);
  - `components/checkout/voucher-sheet.tsx` (tấm chọn mã);
  - `components/checkout/use-coupon-hint.ts`.
- Web: `apps/web/src/components/coupon-box.tsx` (khoảng :131).
- Câu gợi ý: `packages/app-core/src/coupon-use.ts` `couponHintText`.
- API:
  - `POST /checkout/coupon-previews` (`checkout.service.ts` `couponPreviews`, khoảng :961) trả số giảm của từng mã với giỏ hiện tại;
  - `GET /loyalty/me/coupons`;
  - áp mã `POST /cart/coupon` (`cart.applyCoupon`).

Luật mới:
1. Vào màn thanh toán, nếu giỏ chưa có mã và khách chưa gỡ mã tự áp trong lượt thanh toán này: chọn mã có số giảm lớn nhất theo `coupon-previews` (chỉ mã dùng được, giảm > 0). Hoà thì chọn mã hết hạn sớm hơn. Áp bằng đúng đường áp mã hiện có.
2. Dòng mã hiện rõ "Đã tự áp" kèm nút "Gỡ".
   - Bấm Gỡ: bỏ mã bằng đường gỡ hiện có, không tự áp lại trong lượt này (nhớ trong sessionStorage hoặc state của luồng thanh toán).
   - Sau khi gỡ, câu gợi ý "Bạn có N mã dùng được" hiện lại như trước.
3. Khách tự chọn mã khác: nhãn "Đã tự áp" biến mất.
4. Không đổi cách tính giảm, điều kiện mã, giá, phí, điểm. Không đổi API, trừ khi bắt buộc; nếu bắt buộc thì chỉ thêm trường tuỳ chọn và ghi lý do.
5. Lỗi khi tự áp (mạng, mã vừa hết): im lặng, giữ màn như chưa áp, không hiện lỗi đỏ.
6. Không tự áp khi giỏ đang có mã, khi đang đặt hộ khách (CTV đặt cho khách), hoặc khi khách chưa đăng nhập.
7. Hai nền giống nhau. Logic chọn mã đặt ở `packages/app-core` (ví dụ `pickBestCoupon`), có unit test.

Test: unit app-core (chọn mã, hoà, không có mã dùng được); vitest màn thanh toán hai nền (tự áp, gỡ, không áp lại, giỏ có sẵn mã, lỗi); Playwright: Mini toàn bộ, web cả bộ (vì đụng thanh toán). Nếu sửa API thì thêm race spec áp mã.

## Báo cáo thêm cho chủ
- Mã tin và câu tin lên hạng.
- Ca nào không tự áp mã và vì sao.
