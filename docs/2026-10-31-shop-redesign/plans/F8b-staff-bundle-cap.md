# F8b staff-bundle-cap (đợt 4f): trần tiền của nhân viên cho bộ combo/mua kèm lúc tính tiền, và hai MINOR của form admin

> **Cho người thực hiện:** dùng superpowers:executing-plans, làm từng task theo thứ tự, mỗi task: test đỏ → code → test xanh → commit. Bước dùng ô `- [ ]`.

**Mục tiêu:** đóng bốn việc chủ đã duyệt "Sửa trước khi merge" sau review Opus của F8: hai lỗi tiền có sẵn từ P15 (cộng dồn nhiều bộ của nhân viên vượt trần mỗi đơn; BUNDLE_PCT không có trần lúc tính khi giá tăng sau khi lưu) và hai MINOR của form admin (thêm lại món cũ mất giá tham chiếu; sửa bộ bị 400 khi phân loại ghim đang sale xuống dưới giá kèm).

**Kiến trúc:** một trần mới đặt ở đúng chỗ mọi đường tiền đã đi qua, `ComboService.computeForStorefront` (giỏ, báo giá, xem trước mã, đặt đơn đều gọi hàm này nên số luôn bằng nhau). Phần tính nằm trong hàm thuần mới của `bundle-rules.ts`: gộp khoản giảm của mọi bộ do nhân viên tạo (mỗi dòng lấy lớn nhất như hiện nay), kẹp TỔNG ở `coupon.staff_max_amount_vnd`, rồi gộp với phần của bộ do ADMIN tạo (không bị kẹp) bằng `mergeMaxPerLine`. Vai trò người tạo tra bằng một truy vấn, và chỉ khi tổng giảm thô của các bộ vượt trần.

**Tech Stack:** NestJS 10 + Prisma (Postgres), Jest (`apps/api`, race spec trên DB thật), Vitest (`apps/web`).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §4 Q15 (Tubu tài trợ combo/mua kèm toàn sàn; đường tiền chia dòng qua `paidTotal`), `plans/P15-bundles.md`, `plans/F8-bundles-followups.md` (luật `refPrice`, `isOwnStaffBundle`, `keptRefPrices`). F8b không có mục trong `02-ke-hoach.md`: là gói sửa nối tiếp F8, base `abe9b159b`.

## Global Constraints

- Base `abe9b159b`, nhánh `shop/F8b-staff-bundle-cap`, worktree `.claude/worktrees/shop-F8b`. Không push, không đọc/ghi PROD, không sửa file ngoài phạm vi bundles (chỉ file ở bảng dưới).
- Không có migration, không đổi schema, không đổi giao diện dùng chung (tên, chữ ký, route của gói khác giữ nguyên). Không thêm luật tiền nào ngoài trần này.
- Trần đọc từ `coupon.staff_max_amount_vnd` qua `loadStaffCouponCaps(config).maxAmount` (cùng nguồn `bundles-admin.service.ts` dùng khi ghi), không đọc khoá thô thứ hai.
- Đường tiền: thứ tự giảm Giờ vàng → combo → mã → hạng → điểm, chia về `OrderItem.paidTotal`; một đơn một mã. Race test giỏ = báo giá = đặt đơn cho mọi thay đổi ở đây.
- Comment chỉ giải thích "vì sao"; commit tiếng Việt kiểu repo, cuối message có `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Máy thiếu RAM: chạy test theo file; gate đầy đủ đúng một lần ở cuối. `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`. Worktree mới: `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`) trước khi chạy tsc/jest.
- DB riêng cho race: cụm Postgres native cổng 25554 (KHÔNG đụng 25553 của session chính): `bash docs/2026-10-20-uat/tools/pg-native.sh start 25554`, `createdb` tên đúng `tubutree_it`, `migrate deploy` (user `tubu`), `DATABASE_URL=postgresql://tubu@127.0.0.1:25554/tubutree_it`; xong việc `pg-native.sh stop 25554`.

## Bất biến và hành vi đã chốt

**Bất biến:** khoản giảm thực tế mỗi đơn nhờ các bộ do NHÂN VIÊN tạo không bao giờ vượt `coupon.staff_max_amount_vnd`, qua mọi đường (giỏ, báo giá, xem trước mã, đặt đơn), dù tạo bao nhiêu bộ, dù giá tăng sau khi lưu, dù thêm phân loại đắt hơn.

**Ai là "nhân viên":** người tạo bộ KHÔNG được xác nhận là ADMIN. Cụ thể: `createdById` null (job hoặc dữ liệu ghi tay), tài khoản không còn, hay vai trò khác ADMIN đều bị kẹp; chỉ người tạo có dòng `user` với `role = 'ADMIN'` mới được miễn. Cùng chiều với `isOwnStaffCoupon` ("không rõ vai trò coi như nhân viên"). Bộ do chính nhân viên đang mua tạo đã bị loại ở `withoutOwnStaffBundles` trước bước này.

**Thứ tự gộp (đã nghĩ kỹ):**
1. Bộ nhân viên: `allocateBundleDiscounts` riêng cho nhóm này (mỗi dòng lấy khoản LỚN NHẤT giữa các bộ, đúng như hiện nay; hai bộ trùng dòng không cộng), được kẹp TỔNG ở trần.
2. Phần bị cắt rút khỏi `perLine` theo thứ tự ổn định tăng dần `variationId` (key của `perLine`; mỗi `variationId` là một dòng giỏ): dòng đứng trước giữ nguyên tới khi hết trần, dòng đứng sau bị cắt. Nhờ vậy khoản giảm không phụ thuộc thứ tự dòng trong giỏ (heap Postgres).
3. Rồi `mergeMaxPerLine(phần ADMIN, phần nhân viên đã kẹp)`: ADMIN không bị trần nhân viên cắt (không đi qua bước 1-2); phần nhân viên đóng góp thêm tối đa `Σ max(0, nhânviên[dòng] − admin[dòng]) ≤ phần đã kẹp ≤ trần`, nên dòng trùng với bộ ADMIN không giúp nhân viên lọt qua trần. Đổi lại, khi bộ ADMIN phủ cùng dòng thì phần trần dùng cho dòng đó "mất" (khách không được bù sang dòng khác): chọn đúng chiều an toàn của tiền.
4. Cuối cùng vẫn `mergeMaxPerLine(combo gian hàng, bundle)` như hiện nay: combo gian hàng không phải bộ của nhân viên nên không bị kẹp.

**Tối ưu truy vấn:** `raw = allocateBundleDiscounts(mọi bộ)` đã là cận trên của mọi kết quả sau khi kẹp. Nếu `raw.total ≤ trần` thì không bộ nào bị kẹp, kết quả = `raw`, KHÔNG tra vai trò. Vượt trần thì đúng MỘT `user.findMany` (các `createdById` khác nhau, lọc `role: 'ADMIN'`). Giỏ không có bộ nào thì không tra gì (như hiện nay).

**Hành vi công khai (đã chốt):** PDP, Trang chủ và khối công khai vẫn quảng cáo theo TỪNG bộ (API công khai cache chung, không biết người mua, không biết giỏ). Chỉ khi cộng dồn nhiều bộ của nhân viên vượt trần thì giỏ thấp hơn tổng quảng cáo. Giỏ = báo giá = đặt đơn luôn bằng nhau vì cùng một hàm và cùng dữ liệu. Không thêm trần vào API công khai: giỏ chỉ ra ít hơn quảng cáo, không bao giờ đắt hơn thứ đã quảng cáo (cùng nguyên tắc đã ghi ở F8 cho "nhân viên tự hưởng").

**Không đổi:** bộ do ADMIN tạo không bị kẹp (kể cả BUNDLE_PCT giá tăng sau khi lưu: trần `bundle.max_pct` vẫn áp như cũ, đó là phần tin cậy của quản trị viên); trần lúc ghi (`assertStaffBundleCaps`) giữ nguyên, là lớp chặn đầu, trần mới là lớp chặn tiền.

## Review Focus

1. Hai bộ của nhân viên, mỗi bộ đúng trần khi đứng một mình, giỏ có cả hai: tổng giảm ra đúng trần (giỏ = báo giá = đơn), không phải tổng hai bộ. Test: Task 1 (hàm thuần), Task 2, race (Task 3).
2. BUNDLE_PCT của nhân viên sau khi giá món tăng, hoặc khách chọn phân loại đắt hơn không ghim: kẹp ở trần. Test: Task 1, race (Task 3).
3. Bộ ADMIN cùng giỏ với bộ nhân viên: phần ADMIN nguyên vẹn, phần nhân viên kẹp riêng; dòng trùng không giúp nhân viên lọt trần. Test: Task 1 (hoán vị, trùng dòng), Task 3.
4. Thứ tự dòng giỏ và thứ tự bộ không đổi khoản giảm sau khi kẹp. Test: Task 1 (hoán vị cả hai).
5. Người tạo không rõ (null, tài khoản không còn) bị kẹp; trần cấu hình hỏng về mặc định, trần lẻ không tạo khoản giảm lẻ. Test: Task 1, Task 2.
6. Sửa bộ qua form khi phân loại ghim đang sale dưới giá kèm, hoặc xoá rồi thêm lại đúng món cũ: form và máy chủ cùng số. Test: Task 4, Task 5.

## Giao diện (giữ đúng tên)

- `apps/api/src/modules/bundles/bundle-rules.ts` thêm: `StaffBundleCap { isStaff(b: LiveBundle): boolean; maxAmount: number }`, `clampDiscountTotal(d: BundleDiscount, maxAmount: number): BundleDiscount`, `allocateBundleDiscountsCapped(bundles: readonly LiveBundle[], lines: readonly BundleLine[], maxPct: number, cap: StaffBundleCap): BundleDiscount`. `allocateBundleDiscounts` giữ nguyên chữ ký (hàm thô, không kẹp: chỉ `ComboService` gọi, JSDoc ghi rõ).
- `apps/api/src/modules/bundles/bundle-admin-rules.ts`: `resolveBundleItems(content, products, kept?: readonly (number | null)[])` (đối số mới tuỳ chọn, mặc định như cũ).
- `apps/web/src/lib/admin-bundle-form.ts` thêm: `savedPricesFor(initial: Pick<AdminBundle, 'items'> | undefined, productId: string, variationId: string | null): { refPrice: number | null; savedAddonPrice: number | null }`.

## Cấu trúc file

| File | Việc |
|---|---|
| `apps/api/src/modules/bundles/bundle-rules.ts` (+`bundle-rules.spec.ts`) | hàm thuần kẹp tổng và gộp ADMIN/nhân viên |
| `apps/api/src/modules/storefront/combo.service.ts` (+`combo.service.spec.ts`) | đọc trần, tra vai trò một truy vấn, gọi hàm thuần |
| `apps/api/test/integration-race/bundle-price-parity.race-spec.ts` | race: giỏ = báo giá = đơn với trần mới |
| `apps/api/src/modules/bundles/bundle-admin-rules.ts` (+spec), `bundles-admin.service.ts` (+spec) | MINOR 4: so giá kèm với giá tham chiếu giữ lại |
| `apps/web/src/lib/admin-bundle-form.ts` (+spec), `apps/web/src/components/admin/bundle-form.tsx`, `bundles-tab.spec.tsx` | MINOR 3 và phần phía form của MINOR 4 |
| `docs/2026-10-31-shop-redesign/plans/P15-bundles.md` | ghi "đã sửa ở F8b" cho hai lỗi |

---

### Task 1: Hàm thuần kẹp tổng khoản giảm của bộ nhân viên

**Files:** Modify `bundle-rules.ts`; Test `bundle-rules.spec.ts`.

**Interfaces — Produces:** `StaffBundleCap`, `clampDiscountTotal`, `allocateBundleDiscountsCapped` (xem "Giao diện").

- [ ] **Step 1: test đỏ** trong `bundle-rules.spec.ts`, nhóm mới `describe('trần tổng của bộ do nhân viên tạo')`. Dùng helper sẵn có `line`, `item`, `pct`, `addon`, `kem`; thêm `const staffCap = (staffIds: string[], maxAmount = 100_000) => ({ isStaff: (b: LiveBundle) => b.createdById === null || staffIds.includes(b.createdById), maxAmount })`. Ca:
  - `clampDiscountTotal`: tổng ≤ trần trả nguyên; `{v2: 100_000, v1: 100_000}` với trần 100_000 → `{ total: 100_000, perLine: { v1: 100_000 } }` (cắt theo `variationId` tăng dần, không theo thứ tự khoá chèn vào); `{v1: 70_000, v2: 70_000}` trần 100_000 → `{ v1: 70_000, v2: 30_000 }`; trần lẻ 99_999,5 → tổng 99_999; trần 0 → `{ total: 0, perLine: {} }`.
  - Cộng dồn (ví dụ của chủ): ADDON `B1` (chính `P`, món `X` ghim, `refPrice` 340_000, giá kèm 240_000, `maxQty` 1, `createdById 's1'`) và `B2` (chính `P`, món `Y` cùng số, `createdById 's2'`); giỏ `P 80_000`, `X 340_000`, `Y 340_000`: `allocateBundleDiscounts` thô ra 200_000 (ghi lại để thấy lỗi), `allocateBundleDiscountsCapped(..., staffCap(['s1','s2']))` ra `total` 100_000, và `perLine` giống nhau khi đảo thứ tự bộ và đảo thứ tự dòng giỏ.
  - BUNDLE_PCT 30% (A, B mỗi món `maxQty` 1, `createdById 's1'`), giá dòng tăng 150_000 → 400_000: thô 240_000, kẹp 100_000. Thêm phân loại 2_000_000 của A không ghim vào giỏ (`line('vA-big', 'pA', 2_000_000)` thay dòng A): thô 720_000, kẹp 100_000.
  - Bộ ADMIN (`createdById 'a1'`, không nằm trong `staffIds`) cùng khoản 200_000 ở hai dòng: không bị kẹp (200_000).
  - Trộn: ADMIN ADDON giảm 100_000 trên `X`, hai bộ nhân viên giảm 100_000 trên `Y` và `Z`: tổng 200_000 (ADMIN 100_000 nguyên vẹn, nhân viên kẹp 100_000), `perLine.X` bằng đúng giá trị ADMIN tính một mình.
  - Dòng trùng: ADMIN giảm 100_000 trên `X`; nhân viên giảm 100_000 trên `X` và 100_000 trên `Y`, trần 100_000: phần nhân viên kẹp theo `variationId` ('X' trước) giữ `X` 100_000 và cắt `Y`; kết quả `X` 100_000, `Y` 0, tổng 100_000 (nhân viên không đóng góp thêm quá trần, không lọt nhờ dòng trùng).
  - `createdById` null: bị kẹp như nhân viên. Không bộ nào của nhân viên (chỉ ADMIN): kết quả bằng `allocateBundleDiscounts`.
  - Bất biến ngẫu nhiên có hạt giống cố định: 200 giỏ sinh bằng bộ sinh số nhỏ tự viết (không thêm thư viện): mọi kết quả thoả `Σ max(0, kết quả[dòng] − admin[dòng]) ≤ trần` và `kết quả[dòng] ≤ thô[dòng]`.
- [ ] **Step 2:** `cd apps/api && npx jest src/modules/bundles/bundle-rules.spec.ts` → FAIL (chưa có hàm).
- [ ] **Step 3: implement** trong `bundle-rules.ts` (đặt sau `allocateBundleDiscounts`). `clampDiscountTotal`: `left = Math.max(0, Math.floor(maxAmount))`, đi qua `Object.keys(d.perLine).sort` với đúng bộ so `byVariationId`/chuỗi đã dùng ở `addUnits`, giữ `min(giá trị, left)`, bỏ dòng về 0; dùng `fromPerLine`. `allocateBundleDiscountsCapped`: chia theo `cap.isStaff`, `staffPart = clampDiscountTotal(allocateBundleDiscounts(staff, ...), cap.maxAmount)`, trả `mergeMaxPerLine(allocateBundleDiscounts(admin, ...), staffPart)`. Thêm JSDoc: lý do kẹp tổng (trần chỉ kiểm từng bộ lúc ghi nên không chặn cộng dồn hay giá tăng), thứ tự gộp, và dòng cảnh báo trên `allocateBundleDiscounts` rằng nó là hàm thô.
- [ ] **Step 4:** spec xanh (`npx jest src/modules/bundles/bundle-rules.spec.ts`).
- [ ] **Step 5: Commit** `fix(api): hàm thuần kẹp tổng khoản giảm của các bộ do nhân viên tạo ở trần mỗi đơn`.

### Task 2: ComboService áp trần ở nơi tính tiền

**Files:** Modify `combo.service.ts`; Test `combo.service.spec.ts`.

**Interfaces — Consumes:** `allocateBundleDiscounts`, `allocateBundleDiscountsCapped`, `StaffBundleCap` (Task 1), `loadStaffCouponCaps` (`../admin/coupon-input-rules`). Chữ ký `computeForStorefront(slug, lines, buyerId?, now?)` giữ nguyên.

- [ ] **Step 1: test đỏ** trong nhóm "combo toàn sàn (bundle)" của `combo.service.spec.ts`; `makePrisma` thêm `user.findMany: jest.fn().mockResolvedValue(admins)` (tham số mới `adminIds: string[] = []`, trả `[{ id }]`). Thêm helper `addon(id, createdById, itemProductId)` dựng bộ ADDON giống `bundle()`. Ca:
  - Ví dụ cộng dồn: hai bộ ADDON `createdById 's1'`, `'s2'`, giỏ `P`, `X`, `Y`: `out.total` 100_000, `perLine` đúng một trong hai dòng giữ 100_000 (dòng nhỏ hơn theo `variationId`), `prisma.user.findMany` gọi đúng 1 lần với `where` chứa `role: 'ADMIN'` và `id: { in: ['s1','s2'] }`.
  - Cùng hai bộ nhưng `adminIds = ['s1','s2']`: 200_000 (không kẹp).
  - Một bộ ADMIN + hai bộ nhân viên: `adminIds = ['a1']` → tổng 200_000, ADMIN nguyên.
  - Tổng thô ≤ trần (một bộ 100_000): `user.findMany` KHÔNG được gọi. Không bộ nào: không gọi. Tất cả bộ `createdById: null` và vượt trần: `findMany` không gọi (không có id để tra) nhưng vẫn kẹp.
  - Trần cấu hình: `config.get('coupon.staff_max_amount_vnd')` trả 50_000 → kẹp ở 50_000; trả chuỗi rác → về mặc định 100_000.
  - Combo gian hàng (30%) cùng dòng với bộ nhân viên đã kẹp: dòng lấy lớn hơn giữa hai nguồn (combo gian hàng không bị trần nhân viên).
  - Buyer là người tạo một trong hai bộ: bộ đó bị loại trước (F8), phần còn lại tính trần như trên.
- [ ] **Step 2:** `npx jest src/modules/storefront/combo.service.spec.ts` → FAIL ở các ca kẹp.
- [ ] **Step 3: implement** trong `computeForStorefront`: sau khi có `bundles` và `maxPct`, `const staffMax = (await loadStaffCouponCaps(this.config)).maxAmount`, `raw = allocateBundleDiscounts(...)`; `raw.total <= staffMax` thì dùng `raw`, ngược lại `allocateBundleDiscountsCapped(..., { isStaff: await this.staffBundlePredicate(bundles), maxAmount: staffMax })`. Hàm riêng `staffBundlePredicate(bundles)`: gom `createdById` khác null, không có id thì mọi bộ là nhân viên; có thì MỘT `this.prisma.user.findMany({ where: { id: { in }, role: 'ADMIN' }, select: { id: true } })`, `isStaff = (b) => b.createdById === null || !adminIds.has(b.createdById)`. Comment giải thích vì sao tra khi vượt trần mới tra, và vì sao không rõ người tạo thì kẹp.
- [ ] **Step 4:** spec xanh; `npx tsc --noEmit -p apps/api` xanh; `npx jest src/modules/cart src/modules/checkout` không đỏ thêm (chúng mock ComboService).
- [ ] **Step 5: Commit** `fix(api): trần tổng khoản giảm của bộ do nhân viên tạo lúc tính tiền (cộng dồn nhiều bộ, BUNDLE_PCT sau tăng giá)`.

### Task 3: Race spec giỏ = báo giá = đặt đơn với trần mới

**Files:** Test `apps/api/test/integration-race/bundle-price-parity.race-spec.ts`.

Dùng helper có sẵn `buyer(role?)`, `product`, `addVariation`, `bundle(kind, items, { createdById, pct, anchor })`, `cartQuoteOrder`, `paidOf`. Trần là mặc định 100.000 (không đặt khoá `coupon.staff_max_amount_vnd` trong DB; cache cấu hình 60 giây nên không ghim). Người tạo bộ là người dùng thật (`buyer('STAFF')`, `buyer('ADMIN')`) khác người mua.

- [ ] **Step 1: viết ca** (đỏ trên mã trước Task 2, xanh sau):
  - `hai bộ ADDON của nhân viên cộng dồn vượt trần`: `P` 80_000 (chính), `X`, `Y` 340_000; `B1` (món `X` ghim, giá kèm 240_000) và `B2` (món `Y`, cùng số) do hai nhân viên khác nhau tạo; khách thường có `P+X+Y`: `cartQuoteOrder` ra `c.comboDiscount === 100_000` (không 200_000); tiền hàng giỏ = báo giá = đơn = 660_000 (80_000 + 340_000 + 340_000 − 100_000); tổng `paidTotal` các dòng = 660_000; công khai `publicBundles.forProduct(P.slug)` vẫn quảng cáo cả hai bộ (hành vi đã chốt).
  - `BUNDLE_PCT của nhân viên sau khi giá tăng bị kẹp`: bộ 30%, A và B mỗi món 150_000 (`maxQty` 1); sau khi tạo, `prisma.variation.update` `retailPrice` 400_000 cho cả hai: `comboDiscount === 100_000` (thô là 240_000); thêm phân loại 2_000_000 của A (không ghim) và khách mua phân loại đó + B: vẫn 100_000, giỏ = báo giá = đơn.
  - `bộ ADMIN không bị kẹp`: đúng hai bộ ADDON ở ca đầu nhưng người tạo là ADMIN: `comboDiscount === 200_000`; BUNDLE_PCT ADMIN sau tăng giá không bị kẹp bởi trần nhân viên (giữ nguyên số thô, vẫn kẹp `bundle.max_pct`).
  - `trộn ADMIN + nhân viên`: ADMIN ADDON giảm 100_000 trên món `X`, hai bộ nhân viên giảm 100_000 trên `Y` và `Z` (cùng khách `P+X+Y+Z`): `comboDiscount === 200_000`; `paidOf(X) === giá X − 100_000` (phần ADMIN nguyên); `paidOf(Y) + paidOf(Z) === giá Y + giá Z − 100_000`; giỏ = báo giá = đơn; hai khách thêm dòng theo thứ tự ngược nhau ra cùng `comboDiscount` và cùng `paidOf` từng dòng.
  - `người tạo không rõ (createdById null) bị kẹp như nhân viên`: hai bộ ADDON `createdById` null ra 100_000.
- [ ] **Step 2:** dựng DB riêng (xem Global Constraints), `cd apps/api && DATABASE_URL=postgresql://tubu@127.0.0.1:25554/tubutree_it npx jest -c test/integration-race/jest.config.js --runInBand test/integration-race/bundle-price-parity.race-spec.ts -t "trần"` → các ca mới FAIL trên mã trước Task 2. Chứng minh đỏ: tạm `git checkout <commit Task 1> -- apps/api/src/modules/storefront/combo.service.ts`, chạy, thấy đỏ, rồi `git checkout HEAD -- <file>` khôi phục (không dùng `git stash`).
- [ ] **Step 3:** chạy cả file race với mã đủ: xanh, kể cả các ca cũ (bộ ghi `createdById` null có khoản giảm nhỏ hơn trần nên không bị đổi).
- [ ] **Step 4: Commit** `test(api): race giỏ = báo giá = đơn cho trần tổng của bộ do nhân viên tạo`.

### Task 4: MINOR 4 (máy chủ): sửa bộ qua form khi phân loại ghim đang sale dưới giá kèm

**Files:** Modify `bundle-admin-rules.ts` (`resolveBundleItems`), `bundles-admin.service.ts` (`validateContent` truyền `kept`); Test `bundle-admin-rules.spec.ts`, `bundles-admin.service.spec.ts`.

**Interfaces — Produces:** `resolveBundleItems(content, products, kept?: readonly (number | null)[])`.

- [ ] **Step 1: test đỏ.** `bundle-admin-rules.spec.ts` (nhóm `resolveBundleItems`): ADDON món ghim giá kèm 39_000, phân loại đang sale 30_000 (< giá kèm), `kept = [50_000]` → KHÔNG ném, trả `[{ price: 30_000, maxPrice: 30_000 }]`; cùng nội dung `kept = [null]` hoặc không truyền → vẫn ném "thấp hơn giá đang bán"; `kept = [39_000]` (giá kèm không thấp hơn giá tham chiếu giữ lại: dữ liệu hỏng) → ném, lời nói đúng cơ sở ("giá lúc đặt giá kèm (39.000đ)"); `kept = [50_000]` giá kèm 39_000 giá đang bán 500_000 → không ném (như cũ). `bundles-admin.service.spec.ts`: `update` gửi lại `items` của bộ ADDON có `refPrice` 50_000 khi catalog trả phân loại 30_000: không 400, `bundleItem` ghi `refPrice: 50_000` (giữ, không hạ xuống 30_000); admin không bị trần nhân viên; nhân viên cũng qua vì `capAtRefPrices` tính theo 50_000.
- [ ] **Step 2:** `npx jest src/modules/bundles/bundle-admin-rules.spec.ts src/modules/bundles/bundles-admin.service.spec.ts` → FAIL.
- [ ] **Step 3: implement.** `resolveBundleItems`: với `content.kind === 'ADDON'`, cơ sở so sánh là `kept?.[i] ?? price` (tham số `i` là chỉ số món); thấp hơn cơ sở thì qua; ném `BadRequestException` khi `addonPrice >= cơ sở`, lời: dùng "giá đang bán" khi cơ sở là `price`, "giá lúc đặt giá kèm (…)" khi là giá giữ lại. `validateContent` truyền `kept`. Không đổi `capAtRefPrices`, `withRefPrices`.
- [ ] **Step 4:** hai spec xanh; thêm một ca race trong `bundles-admin.race-spec.ts` (DB thật): tạo bộ ADDON qua `BundlesAdminService.create`, hạ `salePrice` của phân loại ghim xuống dưới giá kèm, `update` gửi lại cả `items` + đổi tên: thành công, `refPrice` vẫn là giá lúc tạo; chạy file race xanh.
- [ ] **Step 5: Commit** `fix(api): sửa bộ mua kèm so giá kèm với giá tham chiếu giữ lại, không với giá sale hiện tại`.

### Task 5: MINOR 3 và phía form của MINOR 4

**Files:** Modify `apps/web/src/lib/admin-bundle-form.ts`, `apps/web/src/components/admin/bundle-form.tsx`; Test `admin-bundle-form.spec.ts`, `bundles-tab.spec.tsx`.

**Interfaces — Produces:** `savedPricesFor(initial, productId, variationId)` (xem "Giao diện").

- [ ] **Step 1: test đỏ.** `admin-bundle-form.spec.ts`: `savedPricesFor(initial, 'p2', 'v2')` trả `{ refPrice: 50_000, savedAddonPrice: 39_000 }` khi `initial.items` có đúng sản phẩm + phân loại; khác phân loại hoặc `initial` undefined → `{ refPrice: null, savedAddonPrice: null }`; `buildBundleInput`: món có `refPrice` 50_000, `savedAddonPrice` 39_000, `addonPrice` '39000', `price` 30_000 (đang sale thấp hơn giá kèm) → `ok: true` (cùng luật máy chủ ở Task 4); `addonPrice` đổi sang '45000' (không còn giữ) với `price` 30_000 → `ok: false` "phải thấp hơn giá đang bán"; món mới `refPrice` null `price` 30_000 giá kèm 39_000 → vẫn lỗi như cũ. `bundles-tab.spec.tsx` (nhóm "sửa bộ"): bộ ADDON có món `refPrice` 50_000 giá kèm 39_000, mở sửa, xoá món, thêm lại đúng phân loại đó qua `AddonVariationPicker` mock (giá nay 500_000), gõ 39000: gợi ý hiện "Giảm 11.000đ (22%)" (không "Giảm 461.000đ") và Lưu gửi đủ món; thêm một phân loại khác của cùng sản phẩm thì không có gợi ý tham chiếu (giữ "Giảm 461.000đ" cho món thực sự mới).
- [ ] **Step 2:** `cd apps/web && npx vitest run src/lib/admin-bundle-form.spec.ts src/components/admin/bundles-tab.spec.tsx` → FAIL.
- [ ] **Step 3: implement.** `savedPricesFor` trong `admin-bundle-form.ts`: tìm trong `initial.items` đúng `productId` và `variationId`. `bundle-form.tsx` `addAddonItem`: dùng `savedPricesFor(initial, v.productId, v.variationId)` cho `refPrice` và `savedAddonPrice`. `buildBundleInput`: cơ sở so giá kèm là `keptRefPrice(i) ?? i.price` (cùng `addonBasePrice`'s cơ sở trần cũ), lời lỗi giữ như cũ khi cơ sở là giá đang bán, "giá lúc đặt giá kèm" khi là giá giữ lại.
- [ ] **Step 4:** hai spec xanh; `npx tsc --noEmit -p apps/web` xanh.
- [ ] **Step 5: Commit** `fix(web): form Combo giữ giá tham chiếu khi thêm lại đúng món cũ; sửa bộ khi phân loại ghim đang sale dưới giá kèm`.

### Task 6: Gate, ghi nhận

**Files:** Modify `plans/P15-bundles.md` ("Chờ chủ quyết" mục liên quan: ghi "đã sửa ở F8b"); Modify file này (mục "Kết quả").

- [ ] **Step 1:** `export PATH=...; pnpm --filter @tubutree/shared-types build`; `cd apps/api && npx prisma generate`.
- [ ] **Step 2:** race liên quan với DB riêng cổng 25554: `bundle-price-parity`, `bundles-admin`, `cart-combo-equals-quote`, `coupon-preview-equals-quote`, `split-checkout`, `buyer-totals-regression`, `partner-goods-rules` (`--runInBand`, từng file một).
- [ ] **Step 3:** gate một lần: `bash docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/shop-F8b --base abe9b159b --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-F8b.txt`; bước FAIL nào cũng kiểm trên base (worktree tạm hoặc so log) trước khi kết luận.
- [ ] **Step 4:** `bash docs/2026-10-20-uat/tools/pg-native.sh stop 25554`; commit `docs(shop): F8b ghi kết quả, đóng hai lỗi tiền P15 và hai MINOR form`.

## Self-review

- **Độ phủ:** (1) cộng dồn → Task 1 + 2 + 3; (2) BUNDLE_PCT giá tăng → Task 1 + 2 + 3 (cùng trần); (3) form thêm lại món → Task 5; (4) sửa bộ khi sale → Task 4 (máy chủ) + Task 5 (form, vì form chặn trước khi gọi API bằng đúng luật cũ).
- **Nhất quán tên:** `StaffBundleCap`, `clampDiscountTotal`, `allocateBundleDiscountsCapped` (Task 1) là tên Task 2 dùng; `resolveBundleItems(..., kept)` (Task 4) khớp `keptRefPrices`/`validateContent` sẵn có; `savedPricesFor` (Task 5) dùng trong `bundle-form.tsx`.
- **Không có giao diện dùng chung nào bị đổi:** không route, không schema, không DTO công khai.
- **Rủi ro biết trước:** (a) trần dùng trên khoản giảm tổng của nhóm nhân viên, nên khi bộ ADMIN phủ cùng dòng thì khách có thể nhận ít hơn mức tối đa lý thuyết (chiều an toàn); (b) bộ `createdById` null bị kẹp: bộ ghi tay hay từ job không có người tạo cần admin tạo lại bằng tài khoản ADMIN nếu muốn vượt trần; (c) PDP quảng cáo từng bộ, giỏ có thể thấp hơn khi cộng dồn vượt trần (đã chốt).

## Kết quả

Gate `gate.sh --base abe9b159b` (log `.claude/worktrees/gate-F8b.txt`): 0 FAIL (tsc 6 gói, eslint api/miniapp/web, vitest app-core 2099, miniapp 6206 (cả UTC), web 9158, jest api 12558, lint:parity, vite-build, bundle-mini entry 645 KB / giới hạn 700). Race trên DB riêng cổng 25554: `bundle-price-parity` 25/25 (5 ca mới), `bundles-admin` 21/21 (1 ca mới), `cart-combo-equals-quote` 16, `coupon-preview-equals-quote` 5, `split-checkout` 1, `buyer-totals-regression` 11, `partner-goods-rules` 10. Cụm 25554 đã dừng.

Chỗ làm khác kế hoạch:
- Task 3 Step 2: chứng minh đỏ bằng cách tạm vô hiệu hoá điều kiện kẹp trong `combo.service.ts` (sửa một dòng rồi trả lại, `git diff` sạch), không phải bằng việc lấy lại file từ commit cũ (hook của máy chặn lệnh đó). Kết quả đỏ đúng lý do: 200.000 / 240.000 / 300.000 thay vì trần. Ca race mới của Task 4 chứng minh đỏ cùng cách (bỏ đối số `kept`).
- Task 5 sửa thêm `buildBundleInput` (web): form chặn "giá kèm phải thấp hơn giá đang bán" ngay trước khi gọi API, nên chỉ sửa máy chủ chưa gỡ được MINOR 4 ở form.
- Không chụp 375px và không chạy e2e Mini: F8b không đổi giao diện nào (chỉ logic điền sẵn của form admin và luật tiền ở API), không đụng Mini App.
