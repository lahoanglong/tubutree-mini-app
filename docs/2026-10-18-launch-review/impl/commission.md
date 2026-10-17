# Gói `commission` — báo cáo làm (2026-10-17)

Nhánh `lr/commission`, worktree `.claude/worktrees/lr-commission`. Không đổi công thức hoa hồng, không thêm % mặc định tự động. Chưa push.

## 0. Đơn vị của `affiliateRate`
**Phần trăm: 10 nghĩa là 10%.** Bằng chứng: `affiliate.service.ts` createCommissionForOrder `Math.floor((base * rate) / 100)`; test sẵn có `affiliate.service.spec.ts` ("10% * 200k = 20000"); race `commission-create.race-spec.ts` (rate 10, 200.000đ → 20.000đ). Khác các khoá cấu hình lưu phân số (`affiliate.pit_withhold_pct` 0.1), nên mọi câu lỗi/nhãn ghi rõ "10 = 10%". Mức % nhập mới **chỉ nhận số nguyên** (review D).

## 1. Đã làm
- **D1-01 / D3-01 — API admin đặt % hoa hồng CTV** (chỉ ADMIN, không route nào mở cho STAFF):
  `apps/api/src/modules/affiliate/commission-admin.{controller,service}.ts`, `commission-rate-csv.ts`, đăng ký ở `affiliate.module.ts`.
  - `GET admin/commission-rates?q=&missing=1&cursor=&take=` — sản phẩm + biến thể (sku, tên, giá, %, giá sỉ, `affiliateBlocked`, cờ hàng đối tác), tối đa 50/trang; tìm tên không dấu (`nameSearch`) hoặc SKU; kèm trần và số biến thể chưa có %. Cursor là (tên, id) mã hoá base64url, lọc `(name, id) > (...)` (review B: cursor kiểu `{id}, skip:1` nuốt sản phẩm kế tiếp khi dòng cursor rời bộ lọc).
  - `PUT .../variations/:id`, `PUT .../products/:id` (mọi biến thể đang bán), `POST .../fill-missing` (biến thể đang bán, % NULL, sản phẩm Tubu đang bán — không đè 0% cố ý, không chạm hàng gian hàng đối tác). Cả ba chạy trong transaction: `SELECT id, sku, "affiliateRate" … ORDER BY id FOR UPDATE` cùng điều kiện, ghi đúng các id đã khoá, log `sku: cũ→mới` theo lô 100 (review C).
  - `POST .../import/preview` và `.../import/apply` cho CSV `sku,%` (phẩy/chấm phẩy/tab, `10%`, bỏ dòng tiêu đề). Phân loại: khớp / không đổi / không khớp / sai định dạng / vượt trần / SKU lặp. Áp trong một transaction, phân loại lại lúc ghi, khoá `FOR UPDATE` theo id, log trong transaction. Còn dòng lỗi thì 400, không ghi dòng nào; SKU không khớp được bỏ qua và trả về.
  - Validate 0 ≤ % ≤ trần, **số nguyên** (`RATE_MAX_DECIMALS = 0` ở API và web; lỗi kèm "nhập số nguyên, vd 10 cho 10%" — chặn luôn kiểu gõ 0.1 thay vì 10). Trần là SystemConfig mới `affiliate.max_rate_pct` (mặc định 50 trong mã, luật ghi 0–100 ở RANGES).
  - Số "chưa có %" (`summary.missing` / `missingTubu`), lọc "chưa có %" và "áp cho chưa có %" cùng một tập: chỉ sản phẩm đang bán (review E).
  - Nhật ký: không có bảng nhật ký chung → Logger kèm id admin và `sku: cũ→mới`.
  - Sync Pancake: `pancake-sync.service.ts` upsertProduct không ghi `affiliateRate`/`affiliateBlocked`/`dealerPrices` (unit test có đột biến + race test).
- **Giá sỉ đại lý (review A, P1)** — `apps/api/src/modules/admin/dealer-price-import.ts`: đọc số tiền kiểu Việt Nam chặt (`185000`, `185.000`, `1.250.000`, `240,000` kể cả khi Excel tách thành 2 ô, `185 000`, kèm `đ`/`VND`; `185.5`, `185.000,00` là lỗi dòng). Giá phải trong 10–100% giá lẻ. Có `POST admin/dealer-prices/import/preview`; áp tất-cả-hoặc-không trong transaction có khoá; `skipped` đúng. Parser cũ đọc `185.000` thành 185đ.
- **Tab web** `apps/web/src/components/admin/commission-rates-tab.tsx` (+ `lib/commission-rates.ts`): "Hoa hồng & giá sỉ" ở nhóm "Người bán". Có lọc "chưa có %", tìm kiếm, sửa % tại chỗ (báo lỗi ngay khi gõ, "Đã lưu" không mất khi danh sách tải lại — review H), đặt cho cả sản phẩm, áp cho biến thể chưa có % (hộp xác nhận ghi đúng số biến thể), nhập CSV có xem trước. Ẩn "≈ Xđ/sp" ở sản phẩm bị chặn CTV (review F). Phần "Giá sỉ đại lý theo bậc" có xem trước từng dòng rồi mới ghi. Mọi khối có trạng thái tải/lỗi/rỗng. `page.tsx` chỉ đổi 6 dòng thêm + 1 dòng sửa.
- **D3-07** — `GET admin/orders/:id/referral` (chỉ ADMIN) và `OrderReferralPanel` trong `order-detail-extras.tsx`: CTV (tên, mã, SĐT), gian hàng, số tiền và trạng thái hoa hồng (chữ giống miniapp). Giải thích khi có người giới thiệu mà không có hoa hồng: tự mua; hàng chưa có % / bị chặn CTV / hàng ký gửi của chính người giới thiệu (review G); người giới thiệu không phải CTV/đại lý (J).
- **D3-16** — `storefront.service.ts` applyTemplate lọc thêm `approvalStatus: 'APPROVED'` như picker.
- **J — chỉ CTV/đại lý hưởng hoa hồng.** SystemConfig mới `affiliate.commission_eligible_roles`, mặc định `["AFFILIATE","DEALER"]` (luật ghi: mảng vai trò hợp lệ, không rỗng; giá trị hỏng đọc ra mặc định). `createCommissionForOrder` bỏ qua đơn mà người giới thiệu ngoài các vai trò này, xét vai trò lúc đặt đơn. CTV được duyệt lên đại lý (D3-03, `admin.service.ts` reviewDealerApplication → role DEALER) vẫn hưởng; race `ctv-upgrade-to-partner` vẫn xanh. Đơn lên hộ khách (`placedForCustomer`) giữ như cũ.
- **K — link của khách thường không cướp ghi công CTV.** `AffiliateService.findEligibleReferrer` (hoa hoá mã như A5-01, khác người mua, đúng vai trò) dùng chung cho `recordTouch` (mã khách thường không ghi/đè chạm) và `checkout/attribution.ts` (mã khách thường bị bỏ qua, rơi về chủ gian hàng CTV / chạm còn hạn). `attribution.ts` đổi 12 dòng, `checkout.service.spec.ts` 9 dòng. Chặn ở J giữ làm lớp phòng thủ thứ hai (vd chạm cũ ghi trước bản sửa).
  - **Kết luận về `referrerUserId` của khách thường:** thưởng "giới thiệu bạn bè" (5 điểm khi bạn có đơn 2, thưởng mốc) đi theo `User.referredById` gán lúc tạo tài khoản (`auth.service.ts:851` resolveReferrerId → `reward-points.service.ts:209-217` grantReferralOrderReward), không đọc `Order.referrerUserId`. Vì vậy không cần giữ khách thường làm người giới thiệu của đơn; K bỏ ở lớp ghi công. Race test chứng minh thưởng điểm vẫn chạy.

## 2. Kiểm chứng (đã chạy)
- Review: hai review Opus trên bản đầu → REQUEST_CHANGES (P1 parser giá sỉ). Đã sửa A–K, mỗi mục một commit. **Chưa review lại sau khi sửa.**
- API jest (affiliate, admin, system-config, checkout, cart, storefront, wallet, auth, pancake-sync): `Test Suites: 64 passed, Tests: 1472 passed`.
- Web vitest (`commission-rates-tab`, `order-detail-extras`, `lib/commission-rates`, `app/admin/page`, `ds-palette-pc11`): `Test Files 5 passed, Tests 321 passed`.
- `tsc --noEmit` api và web: sạch. `eslint --max-warnings=0` trên 23 file API + 9 file web đổi trong nhánh: sạch. `npm run -s lint:vars`: OK. Không có migration mới.
- Race Postgres thật (cổng 5561, DB `tubutree_it` trên tmpfs, `migrate deploy`):
  - Bốn spec của gói (`commission-rates-admin`, `commission-eligible-roles`, `dealer-price-import`, `admin-engagement-price-history`) trên DB mới: `Tests: 20 passed`.
  - Mọi race spec có hoa hồng / người giới thiệu / mã giới thiệu / đặt đơn, sau J: 54 suite, `Tests: 483 passed`. Sau K: 69 suite, 570/571 xanh. Ca đỏ là `d2-dealer-revoke-partner` (đua khoá giữa xoá tài khoản và thu hồi đại lý, không đụng ghi công), chạy lại riêng 2 lần đều `48 passed`, và đã xanh ở lượt sau J → coi là chập chờn theo thời gian khoá.
  - `commission-eligible-roles` từng đỏ khi chạy sau spec khác đổi `referral.referrer_reward_points` (r12-merge-four-guests đặt 100). Đã tái hiện bằng cách đặt 100, rồi sửa: spec tự đặt các khoá `referral.*`.
- Đột biến (sửa tạm mã về bản cũ, thấy test đỏ, rồi khôi phục): bỏ khoá `FOR UPDATE` của CSV/giá sỉ → race đỏ (40P01); cursor cũ `{id}, skip:1` → race "Tải thêm" đỏ; bỏ khoá dòng ở đặt %/fill → 8 unit đỏ; bỏ lọc sản phẩm đang bán → race đỏ; key hàng cũ + bỏ cờ chặn CTV → 2 test web đỏ; bỏ chặn vai trò ở createCommissionForOrder → 2 race đỏ; ghi công cũ (attribution + recordTouch) → 2 race K đỏ; thêm `affiliateRate: null` vào upsert sync → test sync đỏ.
- Race chứng minh:
  - đơn CTV ra 0đ khi chưa có %; đặt 8% → đơn sau giao xong có hoa hồng LOCKED 21.600đ;
  - CSV và fill-missing tính đúng theo từng dòng; fill không đè mức đã đặt (kể cả 0%), không đụng hàng đối tác hay sản phẩm ngừng bán;
  - CSV sai / vượt trần / trùng không ghi gì; hai lần nhập chồng nhau không deadlock, kết quả là trọn một file;
  - fill chạy song song với đặt % sản phẩm / biến thể / CSV: không deadlock, không đè;
  - keyset với tên trùng nhau trả mỗi sản phẩm đúng một lần; "Tải thêm" sau khi đặt % không nuốt sản phẩm;
  - sync Pancake đổi giá nhưng giữ %;
  - giá sỉ: mọi cách viết tiền kiểu Việt Nam ghi đúng, một dòng lỗi thì không ghi gì, hai bậc nhập chồng nhau giữ giá cả hai;
  - khách thường được ghi công (chạm cũ) → giữ `referrerUserId`, không có dòng hoa hồng; CTV và đại lý → 20.000đ;
  - bạn (khách thường) mời khách, khách có 2 đơn giao → bạn nhận 5 điểm, không có hoa hồng;
  - chạm CTV → mở `?ref=bạn` → mua kèm mã bạn → đơn và hoa hồng vẫn của CTV; trong gian hàng CTV kèm mã bạn → chủ gian hàng; chỉ có mã bạn → không ai được ghi công;
  - admin thêm CUSTOMER vào khoá → khách thường được hưởng; giá trị khoá sai bị từ chối lúc ghi.

## 3. Chưa làm / cố ý để lại
- **Chưa seed** `affiliate.max_rate_pct` và `affiliate.commission_eligible_roles` vào `prisma/seed.ts` (file của phiên đổi-rác). Mã dùng mặc định. Admin vẫn ghi được qua `PUT admin/config` vì hai khoá đã có luật ghi.
- Nhật ký % chỉ qua Logger; chưa có bảng lịch sử % (kiểu `DealerPriceHistory`). Nên thêm nếu kế toán cần tra "ai đổi % lúc nào".
- Chưa thêm dòng kiểm go-live "biến thể đang bán chưa có %" (D1-01 đề xuất). Tab đã hiện số này.
- `admin.controller.ts` `parseSkuNumberCsv` (chỉ còn dùng cho `products/sold-external`) vẫn đọc số kiểu cũ: `1.250` thành 1. Không phải tiền, nhưng nên dùng chung luật đọc số với giá sỉ.
- Miniapp `referral-code-box.tsx:27`: khách nhập mã của khách thường ở checkout giờ nhận câu "Không tìm thấy mã này…" (API trả `ok:false`). Nên đổi câu thành "mã CTV/đại lý" — chưa sửa vì ngoài phạm vi gói.
- Chạm giới thiệu của khách thường ghi trước bản sửa vẫn sống tới hết hạn (7 ngày). Đơn trong thời gian đó vẫn ghi người đó, nhưng J chặn hoa hồng.
- Gian hàng CTV do ADMIN tạo (`storefront.service.ts` getOrCreateMine cho phép ADMIN) không còn sinh hoa hồng cho ADMIN. Muốn giữ thì thêm "ADMIN" vào khoá.
- `page.spec.tsx` sửa 2 dòng (30 → 31 mục menu). Có thể xung đột nhẹ với phiên đổi-rác khi merge.

## 4. Câu hỏi cho chủ dự án
1. Mức % cho từng nhóm hàng là bao nhiêu? Mặc định đang dùng: không tự đặt, mọi biến thể giữ NULL (CTV nhận 0đ) tới khi admin nhập.
2. Trần 50% có hợp lý không? Mặc định 50; đổi bằng khoá `affiliate.max_rate_pct`.
3. Hàng của gian hàng đối tác có trả hoa hồng CTV không? Hiện Tubu chịu khoản này, không trừ vào đối soát đối tác. Mặc định: "áp cho biến thể chưa có %" bỏ qua hàng đối tác; muốn trả thì đặt từng sản phẩm.
4. **CTV có hưởng hoa hồng trên sản phẩm của đối tác không?** Khi đối tác liên kết sản phẩm với mã Pancake "Tubu giao hộ", `merchant-pancake-link.ts:211-217` chuyển nguyên biến thể Tubu sang sản phẩm của đối tác (`updateMany … data: { productId }`). Biến thể giữ nguyên `affiliateRate`. Vì vậy biến thể Tubu đã có % thì sau khi liên kết vẫn mang % đó, và CTV vẫn được trả hoa hồng trên sản phẩm của đối tác, do Tubu chịu. "Áp cho biến thể chưa có %" không chạm hàng đối tác, nhưng không xoá mức đã có. Mặc định hiện tại là giữ nguyên %, vì đây là hành vi sẵn có và chưa đổi. Nếu chủ dự án muốn không trả hoa hồng trên hàng đối tác, có hai cách: đặt 0% cho các sản phẩm đó, hoặc xoá % lúc liên kết (cần sửa `merchant-pancake-link.ts`).
5. **Khách thường chia sẻ có hưởng hoa hồng không?** Mặc định: không, chỉ nhận điểm giới thiệu bạn bè. Muốn trả thì thêm "CUSTOMER" vào `affiliate.commission_eligible_roles`. Khi thêm, mã của khách thường cũng được ghi chạm và ghi công đơn như mã CTV.
6. ADMIN/STAFF có được hưởng hoa hồng khi tự chia sẻ không? Mặc định: không. Đơn ADMIN lên hộ khách vẫn hưởng như cũ.
