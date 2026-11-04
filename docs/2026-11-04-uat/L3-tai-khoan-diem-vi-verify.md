# L3-tai-khoan-diem-vi: kiểm lại đối kháng

Người kiểm: reviewer đối kháng (Opus). Ngày 04/11/2026. Mã: worktree `uat-1104`, `git rev-parse --short HEAD` = `98803f006` (bằng PROD).
Lane 3 còn bật lúc bắt đầu (API 3231, web 3232, Mini 3233), không cần bật lại. Chạy lại hai lệnh repro trên lane đó. Không sửa mã ứng dụng.
Cuối việc đã chạy `lane-down.sh 3` (không `--drop`).

Luật đối chiếu: `AGENTS.md` (parity, `docs/2026-10-19-web-parity/01-thiet-ke.md`), brief UAT 04/11 ("Web 375 phải giống Mini cả chữ lẫn bố cục"),
`docs/2026-11-03-golive/brief.md` "Quyết định đã chốt" (không có mục nào cho phép web khác Mini ở form địa chỉ hay giờ Ví).
Đã tìm trong `docs/` và `apps/web/src` xem có quyết định nào bảo web không điền sẵn địa chỉ: không có.

## Kết luận

| ID | Kết luận | Mức | Tái hiện | Chỗ lỗi thật |
|---|---|---|---|---|
| L3-B01 | CONFIRMED | P2 | Có: `u7-address-ui.mjs` ra `[FAIL] U7-web375-prefill ... điền sẵn=["",""]`, `[FAIL] U7-web1280-prefill ... ["",""]`; Mini `["Phạm Văn CTV","0901000004"]` | `apps/web/src/components/address-form.tsx:20,43-44` |
| L3-B02 | CONFIRMED | P3 | Có: `u8-parity.mjs` ra `[FAIL] U8-address-text` cùng số liệu như lane | `apps/web/src/components/address-form.tsx:101`, `apps/web/src/app/tai-khoan/dia-chi/page.tsx:257,259`, `apps/web/src/components/geo-picker.tsx:45,75` |
| L3-B03 | CONFIRMED | P3 | Có: `u8-parity.mjs` ra `[FAIL] U8-wallet-time Mini="04/11 04:04" web="04:04 04/11/2026"` | `apps/web/src/app/tai-khoan/vi-tubu/page.tsx:246` |

## L3-B01: web không điền sẵn Người nhận, SĐT (và tỉnh/phường gần nhất)

- Tái hiện: chạy lại đúng lệnh repro, kết quả trùng báo cáo lane (dòng FAIL ở web375 và web1280, Mini OK). Ảnh `shots/L3-tai-khoan-diem-vi/addr-1-form-mini375.png` (ô điền "Phạm Văn CTV", "0901000004") và `addr-1-form-web375.png` (hai ô trống) xác nhận.
- Mã:
  - Web: `apps/web/src/components/address-form.tsx:43` `useState(initial?.form ?? EMPTY_FORM)` với `EMPTY_FORM` rỗng ở `:20`; `:44` tỉnh/phường cũng `EMPTY_GEO`. Hai chỗ tạo mới không truyền `initial`: `apps/web/src/app/tai-khoan/dia-chi/page.tsx:256-266` và `apps/web/src/app/thanh-toan/page.tsx:1163-1172`.
  - Mini: `apps/miniapp/src/components/address-form.tsx:71-76` điền `usableProfileName(user?.fullName)` và `user?.phone` khi tạo mới; `:79-90` nhớ tỉnh/phường lần lưu trước (`recallLastGeo`, `pickLastGeo`).
- Kỳ vọng đúng luật: parity web 375 = Mini (AGENTS.md, brief). Không có quyết định chốt nào cho phép web bỏ điền sẵn. Không phải bộ khung: persona `ctv` có `fullName`, `phone` trong DB, Mini đọc được, web cùng phiên đăng nhập.
- Mức: P2 đúng (lệch parity rõ, thêm thao tác ở checkout web đơn đầu). Không sai tiền hay dữ liệu: lưu tay vẫn đúng dòng DB (`U7-web375-add` PASS).
- Phần "xin tên + SĐT Zalo" (`askZaloProfile`) là API riêng của Zalo, web không có; không tính phần đó.
- Sửa: trong web `AddressForm` khi không có `initial`, khởi tạo `recipient`/`phone` từ hồ sơ đang đăng nhập (query `/me` sẵn có của web), lọc tên giả như `usableProfileName` (đưa hàm này vào `packages/app-core` để hai app dùng chung); tỉnh/phường lấy từ địa chỉ mặc định hoặc lần lưu gần nhất trong `['addresses']`. Thêm ca vào `address-form.spec.tsx` web.

## L3-B02: chữ form thêm địa chỉ khác giữa Mini và web 375

- Tái hiện: có. So ảnh hai khổ (đã mở xem): Mini tiêu đề "Thêm địa chỉ", nhãn "Tỉnh/Thành phố", "Phường/Xã" hiện trên ô chọn, "Số nhà, tên đường", nút "Lưu"; web 375 tiêu đề "Thêm địa chỉ mới", không có nhãn hiện cho hai ô chọn, "Số nhà, đường", nút "Lưu địa chỉ".
- Mã:
  - Mini: tiêu đề `apps/miniapp/src/pages/addresses.tsx:139` ("Thêm địa chỉ" / "Sửa địa chỉ"); nhãn đường `apps/miniapp/src/i18n/vi.ts:267` (`street: 'Số nhà, tên đường'`); nút `vi.common.save` ("Lưu") trong `apps/miniapp/src/components/address-form.tsx`; nhãn tỉnh/phường `apps/miniapp/src/components/geo-picker.tsx:68,94`.
  - Web: nhãn đường `apps/web/src/components/address-form.tsx:101` ("Số nhà, đường"); tiêu đề + nút do trang truyền: `apps/web/src/app/tai-khoan/dia-chi/page.tsx:257,259` ("Thêm địa chỉ mới", "Lưu địa chỉ"), sửa thì `:151,153` ("Sửa địa chỉ", "Lưu thay đổi"); checkout `apps/web/src/app/thanh-toan/page.tsx:1095-1096,1164-1165`; hai ô chọn chỉ có `aria-label` `apps/web/src/components/geo-picker.tsx:45,75` (không nhãn hiện).
- Chỉ ghi chú: lane trỏ `address-form.tsx:119`; dòng đó chỉ in `submitLabel`, chữ thật nằm ở trang gọi (`dia-chi/page.tsx:259`).
- Ngoài phạm vi báo cáo nhưng thấy trong ảnh: Mini mở form trong sheet đáy, web 375 mở thẻ trong trang; nút Huỷ web viền trắng, Mini nền xanh nhạt. Lệch bố cục này chưa ghi FAIL riêng.
- Mức: P3 giữ nguyên (chữ khác, không sai nghĩa, không chặn hành trình). Nhãn hiện cho hai ô chọn thiếu ở web chỉ là lệch giao diện; trình đọc màn hình vẫn có `aria-label`.
- Sửa: web dùng cùng chữ với Mini: `address-form.tsx:101` thành "Số nhà, tên đường"; `dia-chi/page.tsx` tiêu đề "Thêm địa chỉ", nút "Lưu" (ít nhất ở `max-md`); `geo-picker.tsx` web thêm nhãn hiện "Tỉnh/Thành phố", "Phường/Xã" như Mini. Tốt nhất đưa các chuỗi này vào `packages/app-core` để hai app dùng chung.

## L3-B03: dạng ngày giờ Lịch sử Ví

- Tái hiện: có, cả hai là giờ VN (04:04), chỉ khác dạng.
- Mã:
  - Mini: `apps/miniapp/src/pages/wallet.tsx:270` gọi `formatWalletTxTime`, định nghĩa ở `packages/app-core/src/wallet-rules.ts:44-48` ("dd/MM HH:mm").
  - Web: `apps/web/src/app/tai-khoan/vi-tubu/page.tsx:246` gọi `formatDateTime` của `apps/web/src/lib/format-date.ts:30-33` ("HH:mm dd/MM/yyyy").
- Phản biện đã xét: `format-date.ts:1-6` ghi web cố ý dùng một dáng cho mọi nơi. Đó là chú thích mã, không phải "quyết định đã chốt"; luật parity của chủ (web 375 giống Mini cả chữ) đứng trên. Hàm của Mini đã nằm sẵn trong `app-core`, web dùng được ngay, nên không cần chủ chốt.
- Mức: P3 giữ nguyên (đúng giờ, chỉ khác dáng).
- Sửa: ở `vi-tubu/page.tsx:246` dùng `formatWalletTxTime` từ `@tubutree/app-core/wallet-rules` (ít nhất ở khổ `max-md`; 1280 có thể giữ năm nếu muốn). Thêm ca vào spec trang Ví web.

## Lệnh đã chạy

```
cd /Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
node .../scripts/L3-tai-khoan-diem-vi/u7-address-ui.mjs   # 13 OK, 2 FAIL (web375/web1280 prefill)
node .../scripts/L3-tai-khoan-diem-vi/u8-parity.mjs       # 2 FAIL (U8-wallet-time, U8-address-text)
docs/2026-10-20-uat/tools/uat-harness/lane-down.sh 3
```
