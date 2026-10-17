# Gói `commission` — báo cáo làm (2026-10-17, cập nhật sau review lượt 2 ngày 2026-10-18)

Nhánh `lr/commission`, worktree `.claude/worktrees/lr-commission`. Không đổi công thức hoa hồng, không thêm % mặc định tự động. Chưa push.

## 0. Đơn vị của `affiliateRate`
**Phần trăm: 10 nghĩa là 10%.** Bằng chứng: `affiliate.service.ts` createCommissionForOrder `Math.floor((base * rate) / 100)`; test sẵn có `affiliate.service.spec.ts` ("10% * 200k = 20000"); race `commission-create.race-spec.ts` (rate 10, 200.000đ → 20.000đ). Khác các khoá cấu hình lưu phân số (`affiliate.pit_withhold_pct` 0.1), nên mọi câu lỗi/nhãn ghi rõ "10 = 10%". Mức % nhập mới **chỉ nhận số nguyên** (review D).

## 1. Đã làm
- **D1-01 / D3-01 — API admin đặt % hoa hồng CTV** (chỉ ADMIN, không route nào mở cho STAFF):
  `apps/api/src/modules/affiliate/commission-admin.{controller,service}.ts`, `commission-rate-csv.ts`, đăng ký ở `affiliate.module.ts`.
  - `GET admin/commission-rates?q=&missing=1&cursor=&take=` — sản phẩm + biến thể (sku, tên, giá, %, giá sỉ, `affiliateBlocked`, cờ hàng đối tác), tối đa 50/trang; tìm tên không dấu (`nameSearch`) hoặc SKU; kèm trần và số biến thể chưa có %. Cursor là (tên, id) mã hoá base64url, lọc `(name, id) > (...)` (review B: cursor kiểu `{id}, skip:1` nuốt sản phẩm kế tiếp khi dòng cursor rời bộ lọc).
  - `PUT .../variations/:id`, `PUT .../products/:id` (mọi biến thể đang bán), `POST .../fill-missing` (biến thể đang bán, % NULL, sản phẩm Tubu đang bán — không đè 0% cố ý, không chạm hàng gian hàng đối tác). Cả ba chạy trong transaction: `SELECT id, sku, "affiliateRate" … ORDER BY id FOR NO KEY UPDATE` cùng điều kiện, ghi đúng các id đã khoá, log `sku: cũ→mới` theo lô 100 (review C).
  - `POST .../import/preview` và `.../import/apply` cho CSV `sku,%` (phẩy/chấm phẩy/tab, `10%`, bỏ dòng tiêu đề). Phân loại: khớp / không đổi / không khớp / sai định dạng / vượt trần / SKU lặp. Áp trong một transaction, phân loại lại lúc ghi, khoá `FOR NO KEY UPDATE` theo id, log trong transaction. Còn dòng lỗi thì 400, không ghi dòng nào; SKU không khớp được bỏ qua và trả về.
  - Validate 0 ≤ % ≤ trần, **số nguyên** (`RATE_MAX_DECIMALS = 0` ở API và web; lỗi kèm "nhập số nguyên, vd 10 cho 10%" — chặn luôn kiểu gõ 0.1 thay vì 10). Trần là SystemConfig mới `affiliate.max_rate_pct` (mặc định 50 trong mã, luật ghi 0–100 ở RANGES).
  - Số "chưa có %" (`summary.missing` / `missingTubu`), lọc "chưa có %" và "áp cho chưa có %" cùng một tập: chỉ sản phẩm đang bán (review E).
  - Nhật ký: không có bảng nhật ký chung → Logger kèm id admin và `sku: cũ→mới`.
  - Sync Pancake: `pancake-sync.service.ts` upsertProduct không ghi `affiliateRate`/`affiliateBlocked`/`dealerPrices` (unit test có đột biến + race test).
- **Giá sỉ đại lý (review A, P1)** — `apps/api/src/modules/admin/dealer-price-import.ts`: đọc số tiền kiểu Việt Nam chặt (`185000`, `185.000`, `1.250.000`, `240,000` kể cả khi Excel tách thành 2 ô, `185 000`, kèm `đ`/`VND`; `185.5`, `185.000,00` là lỗi dòng). Giá phải từ sàn `max(10%, 1 − dealer.max_discount_pct) × giá lẻ` (mặc định 55% giá lẻ) tới giá lẻ; dòng ngoài khoảng bị chặn kèm lý do (review 2 mục 2). Có `POST admin/dealer-prices/import/preview`; áp tất-cả-hoặc-không trong transaction có khoá; `skipped` đúng. Parser cũ đọc `185.000` thành 185đ.
- **Tab web** `apps/web/src/components/admin/commission-rates-tab.tsx` (+ `lib/commission-rates.ts`): "Hoa hồng & giá sỉ" ở nhóm "Người bán". Có lọc "chưa có %", tìm kiếm, sửa % tại chỗ (báo lỗi ngay khi gõ, "Đã lưu" không mất khi danh sách tải lại — review H), đặt cho cả sản phẩm, áp cho biến thể chưa có % (hộp xác nhận ghi đúng số biến thể), nhập CSV có xem trước. Ẩn "≈ Xđ/sp" ở sản phẩm bị chặn CTV (review F). Phần "Giá sỉ đại lý theo bậc" có xem trước từng dòng rồi mới ghi. Mọi khối có trạng thái tải/lỗi/rỗng. `page.tsx` chỉ đổi 6 dòng thêm + 1 dòng sửa.
- **D3-07** — `GET admin/orders/:id/referral` (chỉ ADMIN) và `OrderReferralPanel` trong `order-detail-extras.tsx`: CTV (tên, mã, SĐT), gian hàng, số tiền và trạng thái hoa hồng (chữ giống miniapp). Giải thích khi có người giới thiệu mà không có hoa hồng: tự mua; hàng chưa có % / bị chặn CTV / hàng ký gửi của chính người giới thiệu (review G); người giới thiệu không phải CTV/đại lý (J).
- **D3-16** — `storefront.service.ts` applyTemplate lọc thêm `approvalStatus: 'APPROVED'` như picker.
- **J — chỉ CTV/đại lý hưởng hoa hồng.** SystemConfig mới `affiliate.commission_eligible_roles`, mặc định `["AFFILIATE","DEALER"]` (luật ghi: mảng vai trò hợp lệ, không rỗng; giá trị hỏng đọc ra mặc định). `createCommissionForOrder` bỏ qua đơn mà người giới thiệu ngoài các vai trò này, xét vai trò lúc đặt đơn. CTV được duyệt lên đại lý (D3-03, `admin.service.ts` reviewDealerApplication → role DEALER) vẫn hưởng; race `ctv-upgrade-to-partner` vẫn xanh. Đơn lên hộ khách (`placedForCustomer`) cũng xét vai trò từ review 2 mục 4.
- **K — link của khách thường không cướp ghi công CTV.** `AffiliateService.findEligibleReferrer` (hoa hoá mã như A5-01, khác người mua, đúng vai trò) dùng chung cho `recordTouch` (mã khách thường không ghi/đè chạm) và `checkout/attribution.ts` (mã khách thường bị bỏ qua, rơi về chủ gian hàng CTV / chạm còn hạn). `attribution.ts` đổi 12 dòng, `checkout.service.spec.ts` 9 dòng. Chặn ở J giữ làm lớp phòng thủ thứ hai (vd chạm cũ ghi trước bản sửa).
  - **Kết luận về `referrerUserId` của khách thường:** thưởng "giới thiệu bạn bè" (5 điểm khi bạn có đơn 2, thưởng mốc) đi theo `User.referredById` gán lúc tạo tài khoản (`auth.service.ts:851` resolveReferrerId → `reward-points.service.ts:209-217` grantReferralOrderReward), không đọc `Order.referrerUserId`. Vì vậy không cần giữ khách thường làm người giới thiệu của đơn; K bỏ ở lớp ghi công. Race test chứng minh thưởng điểm vẫn chạy.

## 1b. Review lượt 2 (APPROVE kèm sửa) — mỗi mục một commit, test đỏ trước
- **Mục 0** — merge `review/2026-10-18-launch` (344dfb00), build `shared-types`, `prisma generate`.
- **Mục 1** (59168739, 1dfe2538) — `affiliate.max_rate_pct` (50) và `affiliate.commission_eligible_roles` (`["AFFILIATE","DEALER"]`) vào `EXTRA_CONFIGS` của `prisma/reference-data/config-selection.ts` (`fallbackSource` trỏ `commission-rate-csv.ts:8` và `commission-eligibility.ts:9`) và `APPROVED_LOADED_KEYS` (đúng thứ tự). Race `reference-seed` cập nhật: seed-reference chạy sau `seed.ts` dev giờ thêm 7 khoá bổ sung (5 khoá cộng đồng + 2 khoá này), vì `seed.ts` (file phiên đổi-rác) không sửa.
- **Mục 2** (3478f85e) — sàn giá sỉ = `max(10%, 1 − dealer.max_discount_pct) × giá lẻ`, tính theo phần vạn (200.000 × 0,55 ra đúng 110.000). Đọc khoá ngoài transaction, khoá hỏng thì dùng mặc định 0,45. Dòng dưới sàn: "thấp hơn sàn …đ — giá lẻ …đ trừ chiết khấu đại lý tối đa (khoá dealer.max_discount_pct); gõ thiếu số?".
- **Mục 3** (7e3612ac) — `checkout/attribution.ts`: chủ gian hàng CTV và người của "chạm" còn hạn cũng phải qua `isCommissionEligible`, không thì rơi xuống bậc kế tiếp. `attribution.ts` +7/−6 dòng, `checkout.service.spec.ts` +15.
- **Mục 4** (262e7660) — `createCommissionForOrder` xét vai trò cả với đơn `placedForCustomer`: ADMIN/STAFF lên hộ khách không có hoa hồng; CTV lên hộ giữ như cũ (đại lý không gọi được route lên đơn hộ). `orderReferral.referrerEligible` bỏ ngoại lệ đơn hộ; khung đơn admin báo "người lên đơn hộ không phải CTV/đại lý". Route lên đơn hộ vẫn cho ADMIN dùng.
- **Mục 5** (dfdff49e) — `products/sold-external` dùng parser mới `admin/sold-external-csv.ts`: số nhóm nghìn đọc như giá sỉ (`1.250` là 1250, `parseWholeNumber` tách từ `parseVndAmount`), cho phép 0, còn dòng lỗi thì 400 nêu dòng, không ghi dòng nào. Xoá `parseSkuNumberCsv`.
- **Mục 6** (ae2df816) — `common/sku-csv.ts` `splitSkuCsvLine` dùng chung cho CSV giá sỉ, % hoa hồng và đã bán ngoài sàn: tách cột bỏ qua ký tự trong ngoặc kép, bỏ ngoặc (`"A2",185000` → `A2`; `"A3","185,000"` → 185.000đ; `""` là một dấu ngoặc). Ô % `"7,5"` đọc ra 7,5 để báo "không phải số nguyên".
- **Mục 7** (02d2f29f) — `FOR UPDATE` → `FOR NO KEY UPDATE` ở `commission-admin.service.ts` (đặt % biến thể / sản phẩm, `FOR NO KEY UPDATE OF v` ở fill, khoá CSV) và `dealer-price-import.ts`, như `lockVariationsInIdOrder`.

## 2. Kiểm chứng (đã chạy)
- Review: hai review Opus trên bản đầu → REQUEST_CHANGES (P1 parser giá sỉ). Đã sửa A–K. Review lượt 2 → APPROVE kèm sửa mục 0–7, đã sửa hết (mục 1b). **Chưa review lại sau lượt sửa 2.**
- **Lượt 2** (DB race dựng lại trên cổng 5561, `migrate deploy`, `migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code` = 0):
  - API jest `src/modules/{affiliate,admin,checkout,system-config,catalog,orders}`, `src/common`, `prisma/reference-data`: `Test Suites: 104 passed, Tests: 2303 passed`.
  - Race (spec của gói + `reference-seed` + `r6*`/`r9*`/`affiliate*` + `r13-merge-checkout-lock` + `ctv-*` có đơn hộ), chạy sau mọi commit lượt 2: `Test Suites: 26 passed, Tests: 155 passed`. Lượt trước đó `reference-seed` đỏ 1 ca (mục 1 thêm 2 khoá bổ sung) → sửa ở 1dfe2538.
  - `tsc --noEmit` api và web sạch; eslint trên 29 file đổi ở lượt 2 sạch; vitest các spec web đổi (`order-detail-extras`, `commission-rates-tab`): `Tests 28 passed`.
  - Test đỏ trước khi sửa: mục 2 (10 test), mục 3 (2 race), mục 4 (3 unit + 1 race + 1 web), mục 5 (2 test + spec mới), mục 6 (4 test), mục 7 (9 unit).
  - `r13-merge-checkout-lock` đỏ 1 lần khi chạy chung 13 spec đơn hộ (ca (c) đua giữ khoá `addresses`; đơn không có người giới thiệu nên không đi qua mã đổi ở mục 3–4), chạy riêng 2 lần đều 8/8, và xanh ở lượt chạy tổng → coi là chập chờn.
- **Lượt 1:**
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
- `affiliate.max_rate_pct` và `affiliate.commission_eligible_roles` đã vào seed-reference (mục 1); `prisma/seed.ts` dev (file phiên đổi-rác) vẫn chưa có, mã dùng mặc định.
- Nhật ký % chỉ qua Logger; chưa có bảng lịch sử % (kiểu `DealerPriceHistory`). Nên thêm nếu kế toán cần tra "ai đổi % lúc nào".
- Chưa thêm dòng kiểm go-live "biến thể đang bán chưa có %" (D1-01 đề xuất). Tab đã hiện số này.
- `apps/web/src/lib/admin-client.ts` `importSoldExternal` khai kiểu trả về `{ ok, updatedCount }` nhưng API trả `{ updated }`; chưa có màn nào gọi hàm này.
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
6. ADMIN/STAFF có được hưởng hoa hồng khi tự chia sẻ không? Mặc định: không. Từ review 2 mục 4, đơn ADMIN lên hộ khách cũng không có hoa hồng.
7. **CTV bị hạ vai trò sau khi đặt đơn vẫn nhận hoa hồng PENDING tới khi giao.** Vai trò xét lúc đặt đơn; dòng hoa hồng đã tạo không bị huỷ khi admin đổi vai trò. Mặc định: giữ nguyên; admin xử lý tay nếu cần.
