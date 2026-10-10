# PC-3 — Giỏ / checkout / đơn

Nhánh `hz5/PC-3` (tách từ `hardening/2026-10` @ cb92dc8). Quyết định áp dụng: Q-27 (tự điền địa chỉ), Q-26 (thuật ngữ).

## Lượt 1 — C-065 + C-020 (mục 1/2 của gói)

Phạm vi lượt này: C-065 và C-020. C-021 (phần trang), C-080, C-066 thuộc lượt khác.

### C-065 — Form địa chỉ điền sẵn tên/SĐT Zalo + nhớ tỉnh/phường — XONG

Hiện trạng: `AddressForm` đã điền sẵn từ `user.fullName`/`user.phone` của auth store, nhưng (1) không bao giờ XIN quyền Zalo nên khách mới (tài khoản khách, tên giữ chỗ "Khách", chưa có SĐT) vẫn gõ tay cả tên lẫn SĐT; (2) tên giữ chỗ "Khách" bị điền thẳng vào ô Người nhận; (3) tỉnh/phường luôn trống.

Đã làm:
- `services/zalo-profile.ts` (mới): `requestZaloProfile()` hỏi lần lượt tên (`getZaloUserInfo`) rồi SĐT (`authStore.ensurePhone`, đường sẵn có, backend giải mã token → `0xxxxxxxxx`). Chỉ hỏi phần tài khoản còn thiếu; từ chối/ngoài Zalo → trả `''`, không throw. `usableProfileName` bỏ tên giữ chỗ "Khách".
- `utils/address-memory.ts` (mới): nhớ tỉnh+phường của lần lưu địa chỉ gần nhất (localStorage `tubu_last_geo`, bỏ mã `00`), dự phòng `pickLastGeo` từ sổ địa chỉ đã tải (ưu tiên địa chỉ mặc định); cờ "đã xin Zalo rồi" (`tubu_zalo_prefill_asked`, có dự phòng trong bộ nhớ khi storage hỏng).
- `components/address-form.tsx`: prop `askZaloProfile`. Chế độ tạo mới + prop bật + còn thiếu tên/SĐT + chưa xin lần nào → tự xin ĐÚNG 1 lần khi mở form, đánh dấu cờ trước khi gọi (không xin lại khi mở lại / StrictMode), chỉ điền vào ô còn trống (không đè chữ khách gõ trong lúc sheet Zalo mở). Nút "Điền nhanh từ Zalo" (chỉ khi tạo mới và còn thiếu tên/SĐT) cho khách đổi ý; bấm mà vẫn không lấy được → snackbar "nhập tay". Địa chỉ mới điền sẵn tỉnh/phường từ bộ nhớ, lưu thành công thì ghi nhớ. Chế độ sửa không đổi.
- `components/checkout/address-section.tsx`: `askZaloProfile={addresses.length === 0}` (chỉ đơn đầu, tức khách chưa có địa chỉ nào). Sổ địa chỉ `pages/addresses.tsx` không bật prop (không tự bật sheet), vẫn có nút điền nhanh.

Test (đỏ → xanh):
- `utils/address-memory.spec.ts` (11): đỏ "Failed to load url ./address-memory" → 11 xanh.
- `services/zalo-profile.spec.ts` (8): đỏ vì module chưa có → 8 xanh (thứ tự tên rồi SĐT, từ chối từng phần/cả hai, không hỏi lại phần đã có, "Khách" = chưa có tên).
- `components/address-form.spec.tsx` (3 cũ + 13 mới = 16): trước khi sửa 9 đỏ (tên "Khách" bị điền sẵn, không có nút, không xin quyền, không điền tỉnh/phường, không nhớ sau lưu); sau khi sửa 16 xanh. Gồm: tự xin 1 lần, cờ đã xin, từ chối → form trống không lỗi, không đè chữ đã gõ, edit mode không xin, điền sẵn tỉnh/phường → `createAddress` gửi đúng `provinceCode`/`wardCode`, dự phòng từ sổ địa chỉ, ghi nhớ sau lưu, chưa có gì nhớ → vẫn bắt chọn.
- `components/checkout/address-section.spec.tsx` (2): đơn đầu truyền `askZaloProfile: true`, đã có địa chỉ → `false`.
- `pages/checkout.spec.tsx` (2 ca C-065): chưa có địa chỉ → bấm "Thêm địa chỉ mới" xin quyền 1 lần và điền sẵn "Lã Hoàng Long"/"0901234567"; đã có địa chỉ → không xin.

### C-020 — Ô nhập mã giới thiệu CTV ở checkout — XONG (chỉ FE, không đổi API)

Hiện trạng: caption CTV dặn "Nhập mã X khi mua" nhưng checkout chỉ gửi `referralCode` lấy từ link (`sfCtx`). Backend đã nhận `referralCode` trong `PlaceOrderDto` và `CheckoutService.resolveReferrer` (chuẩn hoá HOA, loại mã của chính người mua) nên không đổi API.

Đã làm:
- `components/checkout/referral-code-box.tsx` (mới, dùng DS v2: `ui/button`, `ui/text`, token màu, vùng chạm ≥44px): mặc định 1 dòng thu gọn "Mã giới thiệu — Nhập mã"; mở ra thì Input + "Áp dụng"/"Huỷ". Mã chuẩn hoá (bỏ khoảng trắng, HOA) rồi xác nhận qua `POST /affiliate/touch` (`recordReferralTouch`, cơ chế attribution sẵn có: server tra mã, `ok:false` nếu không thấy hoặc là mã của chính mình). Hợp lệ → hiện mã + "Đổi"; sai → "Không tìm thấy mã này, hoặc đây là mã của chính bạn..."; lỗi mạng → `getErrorMessage`. Khi phiên đã có mã từ link/gian hàng (`sfCtx.referralCode ?? sfCtx.slug`) → hiện cố định, KHÔNG cho nhập đè.
- `pages/checkout.tsx`: state `referralApplied`, chèn `<ReferralCodeBox>` giữa "Mã giảm giá" và "Thanh toán", `referralCode: effectiveReferralCode(referralApplied, sfCtx.referralCode)` (mã vừa nhập thắng mã link; không có gì → `undefined` như cũ).

Test (đỏ → xanh):
- `components/checkout/referral-code-box.spec.tsx` (8): đỏ vì module chưa có → 8 xanh (thu gọn, cố định khi có link, hợp lệ chuẩn hoá HOA + gọi touch đúng body, `ok:false`, ô trống không gọi server, lỗi mạng giữ nguyên chữ để thử lại, Đổi/Huỷ/đổi mã mới, `effectiveReferralCode`).
- `pages/checkout.spec.tsx` (4 ca C-020): trước khi nối vào trang 3/4 đỏ ("Unable to find ... Nhập mã" / "LINKCODE"), ca "không có mã → không gửi referralCode" xanh sẵn (chứng minh bộ mock trang đúng); sau khi nối 6/6 xanh. Kiểm đúng `placeOrder` nhận `referralCode: 'AB12CD34'` end-to-end; mã link vẫn gửi; mã sai không bị gửi.

### Lệnh kiểm chứng (output thật)

```
$ npx vitest run src/components/checkout src/components/address-form.spec.tsx src/pages/checkout.spec.tsx \
    src/utils/address-memory.spec.ts src/services/zalo-profile.spec.ts src/services/zmp-bridge.spec.ts \
    src/store/auth.spec.ts src/pages/cart.spec.tsx src/components/ui/button-guard.spec.ts \
    src/ds-legacy-vars-4a.spec.ts src/ds-legacy-vars-4b.spec.ts src/utils/checkout-rules.spec.ts
 Test Files  14 passed (14)
      Tests  195 passed (195)
$ npx tsc --noEmit                      -> exit 0, không output
$ npx eslint <12 file .ts/.tsx đã sửa/thêm của lượt này (6 nguồn + 6 spec)>   -> exit 0, 0 error, 0 warning
```

### Migration

Không có (FE thuần; không đổi API/DB).

### Giả định

1. Q-27 "nhớ tỉnh/quận/phường": hệ địa giới hiện 2 cấp (Tỉnh → Phường/Xã, mã Pancake), không có quận → chỉ nhớ tỉnh + phường.
2. "Đơn đầu" = khách chưa có địa chỉ nào trong sổ (`addresses.length === 0` ở checkout). Xin quyền tự động đúng 1 lần/thiết bị (cờ localStorage); từ chối → nhập tay, muốn thử lại có nút "Điền nhanh từ Zalo".
3. Nhớ tỉnh/phường lưu ở localStorage thiết bị (tiện ích từng người xem, như `tubu_invoice`); đổi máy thì rơi về địa chỉ mặc định trong sổ.
4. Xác nhận mã giới thiệu bằng `POST /affiliate/touch` có tác dụng phụ: server ghi "chạm" giới thiệu (cùng bản ghi mà link giới thiệu vẫn ghi, hạn `affiliate.attribution_days`). Vì vậy UI chỉ có "Đổi" sang mã hợp lệ khác, KHÔNG có "Bỏ mã" (bỏ ở UI mà server vẫn giữ chạm cũ thì đơn vẫn bị ghi cho CTV đó qua đường fallback). Chọn phương án này thay vì thêm endpoint kiểm mã mới để không đổi API.
5. Khi phiên đã có mã từ link CTV/gian hàng thì không cho nhập đè: `storefrontSlug`/combo của báo giá gắn theo slug link, nhập mã người khác sẽ làm người nhận hoa hồng lệch với gian hàng.
6. Chuỗi mới (nhãn ô mã giới thiệu, nút "Điền nhanh từ Zalo", thông báo) viết ngay trong component, không thêm vào `i18n/vi.ts` để khỏi đụng gói PC-9 (đang sửa `miniapp/src/i18n`). Có thể chuyển vào `vi.ts` ở lượt dọn câu chữ.

### Việc còn lại / ghi chú

- Đếm chạm luồng 1 (A4 mục 5) CHƯA đo lại bằng UI thật (không chạy Playwright theo quy định máy). Ước tính: ô Người nhận + SĐT không còn phải chạm/gõ khi khách đồng ý quyền (thay bằng 2 chạm đồng ý trên sheet native của Zalo); khách quay lại thêm địa chỉ mới bỏ được 4 chạm chọn Tỉnh/Phường. Khách mới tinh đặt đơn đầu vẫn phải chọn Tỉnh/Phường (chưa có gì để nhớ) nên mục tiêu "≤ 8 chạm" có thể chưa đạt với đơn đầu — cần verify trên Zalo thật. Có thể giảm thêm 1 chạm bằng cách tự mở form địa chỉ khi chưa có địa chỉ nào (chưa làm vì sheet quyền sẽ bật ngay khi vào trang).
- Khi bấm "Đặt hàng" `authStore.ensurePhone()` vẫn xin SĐT lần nữa nếu tài khoản chưa có (hành vi cũ, ngoài phạm vi) — khách vừa từ chối ở form địa chỉ có thể thấy sheet SĐT lần thứ hai. Nên quyết định có bỏ bước này khi khách đã từ chối không (liên quan Q-27).
- Caption CTV ở `pages/affiliate.tsx` giữ nguyên ("Nhập mã X khi mua" nay đúng với checkout).
- Chưa verify trên Zalo thật: hành vi `getUserInfo({autoRequestPermission: true})` sau khi khách từng từ chối (có thể reject ngay, không hiện sheet) — đã xử lý như từ chối, nhập tay.

## Lượt 2 — C-080, C-066, C-021 (phần trang) (mục 2/2 của gói)

### C-080 — Checkout: Ví/TubuXu mờ phải nói lý do, điểm có dấu nghìn — XONG

Hiện trạng: dòng "Ví Tubu"/"TubuXu" bị `opacity: 0.45` + khoá khi số dư < tổng đơn nhưng không có chữ giải thích; dòng Điểm Xanh hiện "Dùng được 48/65000 điểm"; "Dùng 1250 điểm", "+1250 điểm Xanh" cũng không có dấu nghìn.

Đã làm:
- `utils/checkout-rules.ts`: `paymentUnavailableReason(method, balance, total)` trả "Số dư chưa đủ — cần thêm 668.000đ" (Ví) / "... 649.000 xu" (xu), `null` khi đủ. Cùng điều kiện `balance < total` với `shouldFallbackToCod` nên dòng bị mờ luôn có lý do và dòng đang chọn không bị tự đổi về COD mà không báo. `checkoutPoints` định dạng bằng `formatPoints` ("Dùng được 48/65.000 điểm", "Bạn đang có 1.250 điểm", "64.952 điểm từ đơn còn trong hạn..."). `pointsUseLabel` ("Dùng 1.250 điểm — giảm 12.500đ") và `pointsEarnLabel` ("+1.250 điểm Xanh khi giao thành công").
- `pages/checkout.tsx`: danh sách phương thức thanh toán có thêm `hint`; dòng khoá hiện lý do (chữ `--color-text-secondary`, `aria-describedby`). Mờ 0.45 chỉ áp cho nút radio + nhãn, KHÔNG áp cho dòng lý do (trước đây mờ cả dòng nên có thêm chữ cũng khó đọc). Nhãn xu dùng `formatXu` thay `toLocaleString` trực tiếp. Chưa có báo giá (chưa chọn địa chỉ) thì chưa khoá, chưa có lý do (như cũ).

Test (đỏ → xanh):
- `utils/checkout-rules.spec.ts`: 9 ca mới đỏ (hàm chưa có / sai chuỗi) → 23 xanh (gồm ca đối chiếu `paymentUnavailableReason !== null` ⇔ `shouldFallbackToCod` trên 4 mốc số dư).
- `pages/checkout.spec.tsx` (8 ca C-080): 5 đỏ trước khi nối vào trang (không có lý do, "Dùng 1250", "+1250"), 3 ca còn lại (nhãn có dấu nghìn, chưa báo giá thì chưa khoá, "48/65.000") xanh ngay vì helper đã commit trước; sau khi nối 16/16 xanh. Có ca khẳng định không tổ tiên nào của dòng lý do có opacity < 1 và ca Ví đủ tiền/xu thiếu chỉ dòng xu có lý do.

### C-066 — "Mua lại" ở Home/tab Đơn hàng tự sang giỏ — XONG

Hiện trạng: `PurchasedRail` không truyền `navigateToCart` cho `ReorderSheet` → thêm xong ở lại Home (snackbar "Xem giỏ"), khách tự tìm giỏ.

Đã làm: `components/reorder/purchased-rail.tsx` truyền `navigateToCart` (cả `home_rail` và `orders_tab`, giống thẻ đơn/chi tiết đơn đã sang giỏ). Không thêm được món nào (hết hàng/lỗi) vẫn ở lại + snackbar lỗi (logic sẵn trong `useReorder`). Sửa comment `hooks/use-reorder.ts`. Cập nhật e2e `apps/e2e/tests/buy-flow-4a.miniapp.spec.ts` (2 ca khẳng định hành vi cũ "ở lại trang chủ"/"Xem giỏ": nay mong URL `/cart`; ca đếm `reorder_clicked` quay lại bằng `page.goBack()` giữa 2 lần chạm). CHƯA chạy Playwright (quy định máy), chỉ sửa tĩnh.

Test: `purchased-rail.spec.tsx` ca "2 chạm... ở lại trang" đổi thành mong `navigate('/cart')` → 2 đỏ (home_rail + orders_tab mới thêm), sau khi sửa 9/9 xanh; thêm ca hết hàng không sang giỏ. `reorder-sheet.spec.tsx` + `use-reorder.spec.tsx` giữ xanh.

### C-021 (phần trang) — Vùng chạm >= 44px ở giỏ / checkout / chi tiết đơn — XONG phần trang (phần component thuộc PC-1)

Đối chiếu số đo cũ (`scripts/uiux/results/miniapp.jsonl`: cart 13/23, checkout 5/17, order-detail 0/6) với mã: 13 phần tử nhỏ của giỏ = 6 nút stepper 36x36 + 4 ô tick 24x24 + 3 tên SP 210x36; checkout = hàng "Mã giảm giá" 358x38 + 4 ô radio/tick 24x24. Ô tick/radio 24x24: `Checkbox`/`Radio` của `ui/form` đã có vùng chạm 44px bọc ngoài (`hitArea`), `span` 24x24 chỉ là điểm mù của script đo (hàng `role="radio"` không nằm trong selector, ô tick lồng trong hàng 44px) nên không cần sửa.

Đã sửa:
- `pages/cart.tsx`: `QuantitySelector size="md"` (44x44, trước `sm` 36); hàng điều khiển cho `flexWrap` để thùng rác 44px xuống dòng ở màn 320px thay vì tràn khỏi thẻ; tên SP (bấm mở trang sản phẩm) thêm `tubu-hit-44` + `display:block`; nút "Hoàn tác" (thanh undo) thêm `tubu-hit-44`.
- `pages/checkout.tsx`: hàng "Mã giảm giá" `minHeight: 44` (trước 38); nút "Thử lại" khi báo giá lỗi thêm `tubu-hit-44`.
- `components/checkout/voucher-sheet.tsx`: nút đóng (x) từ 32x32 thành nút vuông 44x44 (vòng tròn 32px nhìn thấy vẫn nằm bên trong); "Dùng mã"/"Chưa đủ"/"Bỏ dùng" `minHeight` 36 → 44; "Thử lại" `minHeight: 44`.
- `pages/order-detail.tsx`: lối vào "★ Đánh giá" (chữ xSmall ~16px) thêm `tubu-hit-44`.

Test (đỏ → xanh): `cart.spec.tsx` +3 ca (tên SP, Hoàn tác, stepper 44x44) 3 đỏ → 6/6 xanh; `checkout.spec.tsx` +2 ca (hàng Mã giảm giá `minHeight` 44, Thử lại) 2 đỏ → xanh; `voucher-sheet.spec.tsx` (mới, 4 ca) 4 đỏ (32/36/NaN) → xanh; `order-detail.spec.tsx` (mới, 1 ca; trang chưa có spec trước đó) 1 đỏ → xanh.

### Lệnh kiểm chứng lượt 2 (output thật)

```
$ npx vitest run src/pages/checkout.spec.tsx src/pages/cart.spec.tsx src/pages/order-detail.spec.tsx \
    src/pages/orders.spec.tsx src/pages/home.spec.tsx src/components/checkout src/components/reorder \
    src/hooks/use-reorder.spec.tsx src/utils/checkout-rules.spec.ts src/components/address-form.spec.tsx \
    src/services/zalo-profile.spec.ts src/utils/address-memory.spec.ts src/ds-legacy-vars-4a.spec.ts src/ds-legacy-vars-4b.spec.ts
 Test Files  21 passed (21)
      Tests  276 passed (276)
$ npx tsc --noEmit                      -> exit 0, không output
$ npx eslint <13 file .ts/.tsx đã sửa/thêm>  -> exit 0, 0 error, 1 warning có sẵn (cart.spec.tsx:13 `typeof import('zmp-ui')`, không phải do lượt này)
```

### Migration

Không có (FE thuần).

### Giả định (lượt 2)

1. Lý do mờ nói "cần thêm <số còn thiếu>" (không phải cả tổng đơn) vì khách biết ngay phải nạp bao nhiêu; xu so thẳng với tổng đơn (1 xu = 1đ, BE kiểm `coinsBalance < total`).
2. Giữ tên "TubuXu" trong nhãn dòng thanh toán: Q-26 chưa chốt tên xu, Q-03 (gộp xu vào Điểm Xanh) thuộc PD-3. Chuỗi lý do/nhãn điểm mới viết trong `utils/checkout-rules.ts` (không sửa `i18n/vi.ts` để khỏi đụng PC-9). Hệ quả: `vi.checkout.pointsUse` không còn nơi dùng trong checkout (`pointsEarn` vẫn dùng ở `order-detail.tsx`); PC-9/PD-3 có thể dọn hoặc gộp vào i18n.
3. C-066: GIỮ sheet xác nhận (khách thấy ghi chú giá + chỉnh số lượng) rồi tự sang giỏ. Đường Home từ 5 → 4 chạm (Mua lại, Thêm vào giỏ, [tự sang giỏ] Thanh toán, Đặt hàng) so với 3 chạm đường PDP; muốn 3 chạm phải bỏ sheet (thêm thẳng số lượng lần mua trước), đó là quyết định sản phẩm, chưa làm. Áp dụng cho cả kệ ở tab Đơn hàng để nhất quán với thẻ đơn.
4. C-021: dùng `tubu-hit-44` (kỹ thuật DS v2, pseudo `::after` cao 44px nằm trên anh em sau) cho chữ bấm được nhỏ để không đổi bố cục; chiều vật lý đổi thật chỉ ở stepper giỏ (md), hàng Mã giảm giá, nút đóng sheet voucher. Lưu ý số đo `tapSmall` của `scripts/uiux` dùng `w/h` thật (không tính `::after`), phần tử dùng `tubu-hit-44` vẫn có thể bị đếm ở cột `tap<44` nhưng không còn ở `tapSmallEff`.

### Việc còn lại / ghi chú

- CHƯA chạy lại `node scripts/uiux/capture.mjs miniapp --only '^(cart|checkout|order-detail)$' ...` (không chạy Playwright theo quy định máy) nên chưa có số `tap<44` và ảnh checkout mới; đợt verify cần đo lại. Ước tính cart: 6 stepper + 3 tên SP hết nhỏ theo `tapSmallEff`; còn lại 4 ô tick 24x24 là điểm mù đo (vùng chạm thật đã 44px).
- Sửa tĩnh e2e (`buy-flow-4a`) chưa chạy; ca đếm `reorder_clicked` dựa vào `page.goBack()` từ `/cart` về Home, nếu lịch sử khác dự kiến cần chỉnh khi chạy thật.
- `order-detail.tsx` còn `o.pointsUsed.toLocaleString('vi-VN')` và `vi.checkout.pointsEarn(o.pointsEarned)` không dấu nghìn: thuộc C-083 (PC-9), không đụng.
- PC-1 sửa `QuantitySelector`/Chip ở `components/ui`: giỏ đã chuyển `md` nên không phụ thuộc thay đổi đó.
