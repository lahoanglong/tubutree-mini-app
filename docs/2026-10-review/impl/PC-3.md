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
