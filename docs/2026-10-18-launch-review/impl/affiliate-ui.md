# Gói affiliate-ui (nhánh `lr/affiliate-ui`)

Đã gộp `review/2026-10-18-launch` mới nhất (26cc9555) vào nhánh; gộp sạch.

## 1. Đã làm

### D3-03: CTV được duyệt lên đại lý không mất màn hoa hồng
- `apps/api/src/modules/affiliate/affiliate-access.ts` (mới): `affiliateAccess` trả `{ hasAccess, canOpenStorefront }` trong một lần tra DB; `hasAffiliateAccess` là bản rút gọn của nó; `canRegisterAsAffiliate`, `canPlaceOrderForCustomer`.
  - CTV và ADMIN luôn có cả hai.
  - Đại lý có `hasAccess` khi còn gian hàng CTV hoặc dòng hoa hồng (kể cả đã trả/từ chối), và `canOpenStorefront` chỉ khi còn gian hàng CTV.
- `affiliate.service.ts`: `getMe` trả `isAffiliate`, `canRegister`, `canOrderForCustomer`, `canOpenStorefront`. Dashboard, danh sách hoa hồng, sao kê thuế và `requestPayout` vốn không kiểm vai trò nên đại lý dùng đúng sổ cũ (`commissions`, `payouts`, `wallet_transactions`, `applyWalletDelta`), không thêm nhánh tiền mới.
- `storefront.service.ts`: picker mở cho đại lý có gian hàng CTV hoặc hoa hồng; `getOrCreateMine` cho đại lý mở lại gian hàng CTV đã có nhưng không tạo mới.
- `academy.controller.ts`, `content-kit.controller.ts`: `DEALER` thêm vào `@Roles`. Quyền theo vai trò, mở cho mọi đại lý (khớp D3-13), không phải chỉ đại lý có gian hàng CTV. Hai controller này không có route ghi nào chạm sổ tiền (Academy chỉ ghi tiến độ học).
- Lối tắt "Gian hàng" ở trang CTV ẩn khi `canOpenStorefront === false` (đại lý chưa có gian hàng CTV: builder sẽ trả 400). API cũ không trả cờ thì vẫn hiện.
- Lên đơn hộ: giữ chặn đại lý (xem mục 4, Q1).
- Test: `affiliate-access.spec.ts` (kể cả `affiliateAccess` cho từng vai trò), `ctv-tools-roles.spec.ts`, ca đại lý trong `storefront.service.spec.ts`, miniapp `affiliate.spec.tsx` (hai ca có/không lối tắt Gian hàng).
- Race `affiliate-dealer-access.race-spec.ts` (4 ca): chỉ ca đầu (getMe, picker, gian hàng, `canOpenStorefront`) phụ thuộc mã mới của D3-03; bỏ nhánh đại lý thì ca đó đỏ. Ba ca rút song song (Ví + TNCN một lần, ngân hàng một lệnh REQUESTED, Ví và ngân hàng chạy chồng) gọi hàm không đổi nên xanh cả trước D3-03; chúng là ca "khoá hành vi" (đường rút không phụ thuộc vai trò: thêm kiểm vai trò hoặc nhánh riêng cho đại lý vào `requestPayout`/`dashboard` thì đỏ), không phải bằng chứng cho mã mới. Tên ca và docblock đã ghi đúng như vậy.

### D7 việc 9: trang CTV (miniapp `pages/affiliate.tsx`)
- Bốn lối tắt ngay dưới thẻ hoa hồng (`components/affiliate/ctv-shortcuts.tsx`): Chia sẻ link/mã, Gian hàng (ẩn khi không mở được), Lên đơn hộ (ẩn khi `canOrderForCustomer === false`), Rút (khoá khi không còn gì rút).
- Mốc thưởng thành danh sách gọn kèm "Nhận tất cả" (`components/affiliate/milestone-rewards.tsx`): gọi tuần tự API từng mốc có sẵn, mốc tháng trước trước. Lỗi từng mốc hiện riêng dạng "tên mốc (tháng M/YYYY): lý do"; key dòng lỗi là tháng + mốc nên một mốc lỗi ở cả hai tháng không trùng key.
- Hai ô KPI cùng một kiểu (`raised`). Màn "Tài khoản này không đăng ký CTV được" thay cho ngõ cụt đăng ký với đại lý thuần.
- Cập nhật e2e `affiliate-ctv.miniapp.spec.ts`, `features.miniapp.spec.ts` theo chữ mới (chưa chạy Playwright).

### D7 việc 10
- (a) `pages/brand-owner.tsx`: hàng khuyến mãi dùng `IconButton` Sửa/Xoá (44px, `flexShrink: 0`, nhãn có tên khuyến mãi), cột không còn vỡ.
- (b) Web `merchant/page.tsx`:
  - Không có hàm tải ảnh lên cho đối tác trên web (chỉ có nén ảnh minh chứng gửi dạng data URL), nên giữ dán URL và thêm `ImageUrlField` (`image-url-field.tsx`): ảnh xem trước, báo liên kết sai hoặc ảnh không tải được, nút Xoá ảnh. Chỉ nhận `https:` (web chạy https nên ảnh http bị chặn mixed content); `http:`, `javascript:`, `data:` hiện gợi ý "cần bắt đầu bằng https://". Nhãn và id cũ giữ nguyên.
  - Hàng của cả hai bảng sản phẩm có `ProductThumb` 40px (cùng quy tắc https) và `RowMenu` "⋯" (Sửa, Ngừng bán / Mở bán lại, Gỡ khỏi shop).
  - `RowMenu` dựng menu bằng portal ra `body` với `position: fixed`, tính vị trí từ `getBoundingClientRect` lúc mở và mở lên trên khi gần đáy màn hình, nên không bị `ScrollRegion` (overflow-x) cắt ở hàng cuối. A11y: tiêu điểm vào mục đầu khi mở, mũi tên/Home/End di chuyển, Escape đóng và trả tiêu điểm về nút, Tab đóng, bấm ra ngoài đóng, cuộn hoặc đổi cỡ cửa sổ đóng. Các mục và nút cao 44px.
- (c) Thanh đầu riêng cho admin/POS/đối tác: làm, vì `app/layout.tsx` chỉ đổi hai dòng (`SiteHeader` bọc trong `HideOnPortals` sẵn có, thêm `<PortalHeader />` tự ẩn ở trang khách). `components/admin/portal-header.tsx` có nhãn Quản trị/Đối tác, Về cửa hàng, tên ngắn, Đăng xuất. Đặt trong `components/admin/` để không lọt vào bộ quét `merchant-no-guest-entry`. Host gian hàng CTV không đổi.

## 2. Kiểm chứng đã chạy (sau review, trên nhánh đã gộp)
| Lệnh | Kết quả |
|---|---|
| `npx jest src/modules/{affiliate,storefront,academy,content-kit} src/modules/system-config` (api) | 35 suites, 718 tests, xanh |
| `npx jest prisma/reference-data` | Không có spec (jest `rootDir: src`); phần seed tham chiếu nằm ở `src/modules/system-config` (đã nằm trong lệnh trên), `loyalty/tier-perks-seed.spec.ts` 15 tests xanh, race `reference-seed` 10 tests xanh |
| race (DB `tubutree_it` cổng 5570): `affiliate-dealer-access affiliate.race wallet-ledger-flows wallet-ledger.race commission-eligible-roles ctv-upgrade-to-partner n2d-ctv-role-derived-flag affiliate-link-click affiliate-product-breakdown affiliate-storefront-analytics dealer-affiliate-buyer-fields` | 11 suites, 64 tests, xanh |
| vitest web: `app/merchant`, `components/admin` (gồm `portal-header`), `app/layout.spec`, `lib/no-raw-date-format.spec` | 49 files, 738 tests, xanh |
| vitest miniapp: `pages/affiliate.spec`, `components/affiliate`, `pages/brand-owner.spec` | 8 files, 128 tests, xanh |
| `npx tsc --noEmit` api, miniapp, web | sạch |
| `npx eslint <file đã sửa> --max-warnings=0` api, miniapp, web | sạch |
| `npm run -s lint:vars` (gốc) | OK |

Container `lr-affiliate-ui-pg` đã xoá (`docker rm -f -v`).

## 3. Chưa làm hoặc cố ý để lại
- Ô trống ở bìa trong storefront builder: thuộc gói storefront, bỏ qua theo brief.
- Ẩn ô subdomain ở `/merchant`: phụ thuộc trường `subdomainEnabled` của gói storefront (chưa merge), điều phối viên xử lý sau khi gộp cả hai.
- Playwright: đã sửa chữ trong hai spec e2e nhưng không chạy (giới hạn RAM). Cần chạy một lượt ở CI.
- `product-form.tsx` (đăng/sửa sản phẩm) vẫn dán URL ảnh không xem trước; có thể dùng lại `ImageUrlField` ở lượt sau.
- Tải ảnh lên thật cho đối tác (Cloudinary) cần endpoint ký tải ở API, ngoài phạm vi gói.
- `picker` vẫn mở cho đại lý chỉ có hoa hồng (đọc danh sách, không ghi); chỉ lối tắt Gian hàng được ẩn.

## 4. Câu hỏi cho chủ dự án
1. Q1 (D3-04, gộp với câu hỏi mô hình bán lẻ của đại lý): đại lý có gian hàng CTV có được lên đơn hộ khách và hưởng hoa hồng đơn hộ không? Mặc định đã dùng: chặn, vì `createCommissionForOrder` xét vai trò người lên đơn và chưa chốt cách tính cho đại lý. Mở khi có quyết định: đổi `canPlaceOrderForCustomer` và thêm test hoa hồng đơn hộ cho đại lý.
2. Đại lý thuần (chưa từng có gian hàng CTV hay hoa hồng) vào trang CTV sẽ thấy "Tài khoản này không đăng ký CTV được" kèm nút về Hồ sơ. Mặc định: không cho đại lý thuần đăng ký CTV (giữ luật cũ). Muốn cho đăng ký thì cần chốt trước.
3. Đại lý chưa có gian hàng CTV chỉ có hoa hồng cũ: xem và rút được, nhưng không tự tạo gian hàng CTV mới và không thấy lối tắt Gian hàng. Mặc định: vậy.
