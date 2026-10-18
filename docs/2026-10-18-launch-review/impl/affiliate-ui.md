# Gói affiliate-ui (nhánh `lr/affiliate-ui`)

## 1. Đã làm

### D3-03: CTV được duyệt lên đại lý không mất màn hoa hồng
- `apps/api/src/modules/affiliate/affiliate-access.ts` (mới): `hasAffiliateAccess` (CTV và ADMIN luôn có; đại lý có khi còn gian hàng CTV hoặc còn dòng hoa hồng, kể cả đã trả/từ chối), `canRegisterAsAffiliate`, `canPlaceOrderForCustomer`.
- `affiliate.service.ts`: `getMe` trả `isAffiliate` theo `hasAffiliateAccess`, thêm `canRegister`, `canOrderForCustomer`. Dashboard, danh sách hoa hồng, sao kê thuế và `requestPayout` vốn không kiểm vai trò nên đại lý dùng đúng sổ cũ (`commissions`, `payouts`, `wallet_transactions`, `applyWalletDelta`), không thêm nhánh tiền mới.
- `storefront.service.ts`: picker mở cho đại lý có gian hàng CTV hoặc hoa hồng; `getOrCreateMine` cho đại lý mở lại gian hàng CTV đã có nhưng không tạo mới.
- `academy.controller.ts`, `content-kit.controller.ts`: thêm `DEALER` vào `@Roles` (bộ nội dung bán hàng và Academy là công cụ của CTV, cùng nhóm với màn hoa hồng).
- Lên đơn hộ: giữ chặn đại lý (xem mục 4, Q1).
- Test: `affiliate-access.spec.ts` (17), `ctv-tools-roles.spec.ts`, ca đại lý trong `storefront.service.spec.ts`, race `affiliate-dealer-access.race-spec.ts` (4 ca: rút Ví 4 lần song song một lần thắng và TNCN một lần, rút ngân hàng song song một lệnh REQUESTED, Ví và ngân hàng chạy chồng, sổ cân). Có mutation check: bỏ nhánh đại lý thì race đỏ.

### D7 việc 9: trang CTV (miniapp `pages/affiliate.tsx`)
- Bốn lối tắt ngay dưới thẻ hoa hồng (`components/affiliate/ctv-shortcuts.tsx`): Chia sẻ link/mã, Gian hàng, Lên đơn hộ (ẩn khi `canOrderForCustomer === false`), Rút (khoá khi không còn gì rút).
- Mốc thưởng thành danh sách gọn kèm "Nhận tất cả" (`components/affiliate/milestone-rewards.tsx`): gọi tuần tự API từng mốc có sẵn, mốc tháng trước trước, lỗi từng mốc hiện riêng, snackbar tổng kết.
- Hai ô KPI cùng một kiểu (`raised`). Màn "Tài khoản này không đăng ký CTV được" thay cho ngõ cụt đăng ký với đại lý thuần.
- Cập nhật e2e `affiliate-ctv.miniapp.spec.ts`, `features.miniapp.spec.ts` theo chữ mới (chưa chạy Playwright).

### D7 việc 10
- (a) `pages/brand-owner.tsx`: hàng khuyến mãi dùng `IconButton` Sửa/Xoá (44px, `flexShrink: 0`, nhãn có tên khuyến mãi), cột không còn vỡ.
- (b) Web `merchant/page.tsx`:
  - Không có hàm tải ảnh lên cho đối tác trên web (chỉ có nén ảnh minh chứng gửi dạng data URL), nên giữ dán URL và thêm `ImageUrlField` (`image-url-field.tsx`): ảnh xem trước, báo liên kết sai hoặc ảnh không tải được, nút Xoá ảnh. Chỉ http/https được dựng thẻ img. Nhãn và id cũ giữ nguyên.
  - Hàng của cả hai bảng sản phẩm có `ProductThumb` 40px và `RowMenu` "⋯" (Sửa, Ngừng bán / Mở bán lại, Gỡ khỏi shop) cao 44px, đóng khi chọn, bấm ngoài hoặc Escape.
- (c) Thanh đầu riêng cho admin/POS/đối tác: làm, vì chỉ đổi hai dòng ở `app/layout.tsx` (`SiteHeader` bọc trong `HideOnPortals` sẵn có, thêm `<PortalHeader />` tự ẩn ở trang khách). `components/admin/portal-header.tsx` có nhãn Quản trị/Đối tác, Về cửa hàng, tên ngắn, Đăng xuất. Đặt trong `components/admin/` để không lọt vào bộ quét `merchant-no-guest-entry`. Host gian hàng CTV không đổi.

## 2. Kiểm chứng đã chạy
| Lệnh | Kết quả |
|---|---|
| `npx jest src/modules/affiliate src/modules/storefront src/modules/academy src/modules/content-kit` (api) | 23 suites, 480 tests, xanh |
| race `affiliate-dealer-access affiliate.race wallet-ledger-flows commission-eligible-roles ctv-upgrade-to-partner n2d-ctv-role-derived-flag` (DB `tubutree_it` cổng 5570) | 6 suites, 33 tests, xanh |
| `npx vitest run src/pages/affiliate.spec.tsx src/pages/brand-owner.spec.tsx src/components/affiliate` (miniapp) | 8 files, 125 tests, xanh |
| `npx vitest run` web: `app/merchant`, `portal-header`, `layout`, `hide-on-portals`, `site-header`, `merchant-no-guest-entry`, `ds-v2-guest`, `lib/site`, `guest-pages.a11y`, `admin/layout` | 17 files, 352 tests, xanh |
| `npx tsc --noEmit` api, miniapp, web | sạch |
| `npx eslint <file đã sửa> --max-warnings=0` api, miniapp, web | sạch |
| `npm run -s lint:vars` (gốc) | OK |

Container `lr-affiliate-ui-pg` đã xoá (`docker rm -f -v`).

## 3. Chưa làm hoặc cố ý để lại
- Ô trống ở bìa trong storefront builder: thuộc gói storefront, bỏ qua theo brief.
- Playwright: đã sửa chữ trong hai spec e2e nhưng không chạy (giới hạn RAM). Cần chạy một lượt ở CI.
- `product-form.tsx` (đăng/sửa sản phẩm) vẫn dán URL ảnh không xem trước; có thể dùng lại `ImageUrlField` ở lượt sau.
- Tải ảnh lên thật cho đối tác (Cloudinary) cần endpoint ký tải ở API, ngoài phạm vi gói.
- Nhắc: `app/merchant/page.tsx` còn lớn (hơn 1.500 dòng); phần mới đã tách file riêng.

## 4. Câu hỏi cho chủ dự án
1. Q1 (D3-04, gộp với câu hỏi mô hình bán lẻ của đại lý): đại lý có gian hàng CTV có được lên đơn hộ khách và hưởng hoa hồng đơn hộ không? Mặc định đã dùng: chặn, vì `createCommissionForOrder` xét vai trò người lên đơn và chưa chốt cách tính cho đại lý. Mở khi có quyết định: đổi `canPlaceOrderForCustomer` và thêm test hoa hồng đơn hộ cho đại lý.
2. Đại lý thuần (chưa từng có gian hàng CTV hay hoa hồng) vào trang CTV sẽ thấy "Tài khoản này không đăng ký CTV được" kèm nút về Hồ sơ. Mặc định: không cho đại lý thuần đăng ký CTV (giữ luật cũ). Muốn cho đăng ký thì cần chốt trước.
3. Đại lý chưa có gian hàng CTV chỉ có hoa hồng cũ: xem và rút được, nhưng không tự tạo gian hàng CTV mới. Mặc định: vậy.
