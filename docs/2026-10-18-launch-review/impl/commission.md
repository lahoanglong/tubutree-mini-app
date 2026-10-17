# Gói `commission` — báo cáo làm (2026-10-17)

Nhánh `lr/commission`, worktree `.claude/worktrees/lr-commission`. Không đổi công thức hoa hồng, không thêm % mặc định tự động.

## 0. Đơn vị của `affiliateRate`
**Phần trăm: 10 nghĩa là 10%.** Bằng chứng: `affiliate.service.ts` createCommissionForOrder `Math.floor((base * rate) / 100)`; test sẵn có `affiliate.service.spec.ts:94` ("10% * 200k = 20000"); race `commission-create.race-spec.ts` (rate 10, 200.000đ → 20.000đ). Khác các khoá cấu hình lưu phân số (`affiliate.pit_withhold_pct` 0.1), nên mọi câu lỗi/nhãn ghi rõ "10 = 10%".

## 1. Đã làm
- **D1-01 / D3-01 — API admin đặt % hoa hồng CTV** (chỉ ADMIN, không route nào mở cho STAFF):
  `apps/api/src/modules/affiliate/commission-admin.{controller,service}.ts`, `commission-rate-csv.ts`, đăng ký ở `affiliate.module.ts`.
  - `GET admin/commission-rates?q=&missing=1&cursor=&take=` — sản phẩm + biến thể (sku, tên, giá, %, giá sỉ, `affiliateBlocked`, cờ hàng đối tác), keyset theo (tên, id), tối đa 50/trang; tìm tên không dấu (`nameSearch`) hoặc SKU; kèm trần và số biến thể đang bán chưa có %.
  - `PUT .../variations/:id`, `PUT .../products/:id` (mọi biến thể đang bán), `POST .../fill-missing` (chỉ biến thể đang bán, % NULL, hàng Tubu — không đè 0% cố ý, không chạm hàng gian hàng đối tác).
  - `POST .../import/preview` và `.../import/apply` cho CSV `sku,%` (phẩy/chấm phẩy/tab, `7,5` khi không tách bằng phẩy, `10%`, bỏ dòng tiêu đề). Phân loại: khớp / không đổi / không khớp / sai định dạng / vượt trần / SKU lặp. Áp trong một transaction, phân loại lại lúc ghi, khoá dòng `FOR UPDATE` theo id. Còn dòng lỗi thì 400, không ghi dòng nào; SKU không khớp được bỏ qua và trả về.
  - Validate 0 ≤ % ≤ trần, tối đa 2 chữ số thập phân. Trần là SystemConfig mới `affiliate.max_rate_pct` (mặc định 50 trong mã, có luật ghi 0–100 trong `system-config.service.ts` RANGES).
  - Nhật ký: không có bảng nhật ký chung → Logger kèm id admin và mức cũ → mới theo SKU (CSV lớn tách dòng log 100 thay đổi/dòng).
  - Sync Pancake: `pancake-sync.service.ts` upsertProduct không ghi `affiliateRate`/`affiliateBlocked`/`dealerPrices` (kiểm bằng unit test có đột biến + race test trên Postgres thật).
- **D1-06 (phần 3) + tab web** `apps/web/src/components/admin/commission-rates-tab.tsx` (+ `lib/commission-rates.ts`): tab "Hoa hồng & giá sỉ" ở nhóm "Người bán". Có danh sách lọc "chưa có %", tìm kiếm, sửa % tại chỗ (báo lỗi ngay khi gõ), đặt cho cả sản phẩm, áp cho biến thể chưa có % (có hộp xác nhận), nhập CSV có xem trước. Phần "Giá sỉ đại lý theo bậc" dùng lại `importDealerPrices` + `DealerTierSelect` có sẵn. Mọi khối có trạng thái tải/lỗi/rỗng. `page.tsx` chỉ đổi 6 dòng thêm + 1 dòng sửa (import, union Tab, mục menu, dòng render tab, dòng render panel đơn).
- **D3-07** — `GET admin/orders/:id/referral` (ADMIN) và `OrderReferralPanel` trong `order-detail-extras.tsx`. Panel hiện CTV (tên, mã, SĐT), gian hàng, số tiền hoa hồng và trạng thái. Chữ trạng thái giống chữ CTV thấy trên miniapp. Panel cũng giải thích khi có người giới thiệu mà không có hoa hồng (tự mua; hàng chưa có % lúc đặt; đặt % sau chỉ áp cho đơn mới). Chỉ tải khi đơn có `referrerUserId`/`storefrontId`.
- **D3-16** — `storefront.service.ts` applyTemplate lọc thêm `approvalStatus: 'APPROVED'` như picker.

## 2. Kiểm chứng (đã chạy)
- API jest: `src/modules/affiliate` + `pancake-sync.service.spec.ts` → `Test Suites: 13 passed, Tests: 301 passed`; controller + staff matrix + affiliate.module + system-config → `Test Suites: 12 passed, Tests: 200 passed`; storefront → `Tests: 65 passed`.
- Đột biến (sửa tạm mã sai rồi khôi phục): bỏ chặn dòng lỗi CSV / nới điều kiện fill-missing → 3 test đỏ; thêm `affiliateRate: null` vào upsert sync → test sync đỏ; bỏ khoá `FOR UPDATE` → race test đỏ vì Postgres `40P01 deadlock detected`.
- Race Postgres thật (cổng 5561, `migrate deploy` + `migrate diff --exit-code` = 0): `commission-rates-admin.race-spec.ts` → `Tests: 7 passed`. Spec chứng minh:
  - đơn CTV ra 0đ khi chưa có %; đặt 7,5% → đơn sau giao xong có hoa hồng LOCKED 20.250đ;
  - CSV và fill-missing tính đúng theo từng dòng;
  - fill-missing không đè mức đã đặt, kể cả 0%, và không đụng hàng đối tác;
  - CSV sai / vượt trần / trùng không ghi gì;
  - hai lần nhập chồng nhau không deadlock và kết quả là trọn một file;
  - keyset với tên trùng nhau trả mỗi sản phẩm đúng một lần;
  - sync Pancake đổi giá nhưng giữ %.
- Hồi quy: `commission-create` + `partial-return-commission-tier` race → `Tests: 17 passed`.
- `npx tsc --noEmit` api và web: sạch. `eslint --max-warnings=0` các file đã sửa: sạch. `npm run -s lint:vars`: OK.
- Web vitest: `commission-rates-tab`, `order-detail-extras`, `lib/commission-rates`, `ds-palette-pc11`, `app/admin/page` → `Test Files 5 passed, Tests 317 passed`.
- Review đối kháng (Opus) đã được khởi chạy trên diff nhưng **chưa có kết quả lúc bàn giao** → coi như chưa review.

## 3. Chưa làm / cố ý để lại
- **Chưa seed** `affiliate.max_rate_pct` vào `prisma/seed.ts` (file của phiên đổi-rác). Mã dùng mặc định 50. Admin vẫn ghi được khoá qua `PUT admin/config` vì khoá đã có luật trong RANGES.
- Nhật ký chỉ qua Logger; chưa có bảng lịch sử % (kiểu `DealerPriceHistory`). Nên thêm nếu kế toán cần tra lại "ai đổi % lúc nào".
- Chưa thêm dòng kiểm go-live "biến thể đang bán chưa có %" (D1-01 đề xuất). Tab đã hiện số này.
- Nhập giá sỉ dùng API cũ: không có bước xem trước, và dòng sai bị bỏ qua (hành vi sẵn có).
- `page.spec.tsx` sửa 2 dòng (30 → 31 mục menu). Có thể xung đột nhẹ với phiên đổi-rác khi merge.

## 4. Câu hỏi cho chủ dự án
1. Mức % cho từng nhóm hàng là bao nhiêu? Mặc định đang dùng: không tự đặt, mọi biến thể giữ NULL (CTV nhận 0đ) tới khi admin nhập.
2. Trần 50% có hợp lý không? Mặc định 50; đổi bằng khoá `affiliate.max_rate_pct`.
3. Hàng của gian hàng đối tác có trả hoa hồng CTV không? Hiện Tubu chịu khoản này, không trừ vào đối soát đối tác. Mặc định: "áp cho biến thể chưa có %" bỏ qua hàng đối tác; muốn trả thì đặt từng sản phẩm.
