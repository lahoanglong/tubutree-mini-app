# ctv đợt D

mergeable=False

## Sửa D1 (head 748ffd7ac)

Nhánh review/1028-ctv, 4 commit mới trên 29dcc9616. Không có P0/P1/P2 trong Review 2; làm đủ 4 mục P3.
Commit:
- f72c51993 fix(ctv): hero chờ cả Ví mới vẽ số to, bỏ số Ví trùng và aria-label theo nhãn đang hiện
- d30c62525 test(hoa-hong): race spec dựng commission LOCKED quá hold rồi chạy approveDueCommissions
- 152f6c9bc perf(nhan-vien): minh hoạ trang chặn quyền nạp động
- 748ffd7ac test(ctv): kiểu của mock getWallet trong spec Mini App

Từng việc:
(1) Số to nhảy lúc tải: ĐÃ LÀM (f72c51993). app-core `ctvHeroAmount` có thêm tham số walletLoading và trả `waiting`. Tự chuyển bật, chuyển được 0, Ví đang tải thì Mini và web giữ khung chờ. Test viết trước, thấy đỏ rồi mới sửa: app-core 2, Mini 1, web 1.
(2) Số dư Ví hiện hai lần, aria-label sai: ĐÃ LÀM (f72c51993). Khi số to là "Số dư Ví Tubu", dòng lối sang Ví đổi thành "Xem Ví Tubu" (vẫn là link, không có số). aria-label của section web theo nhãn đang hiện, còn lúc hiện số chuyển được thì giữ "Hoa hồng có thể chuyển vào Ví". Test cho cả hai nền tảng.
(3) Race-spec assert luôn đúng: ĐÃ LÀM (d30c62525). Bỏ dòng assert cũ. Thêm 2 ca gọi `approveDueCommissions` thật trên commission LOCKED quá hold:
  - CTV có MST: Ví +80.000, commission PAID, một tin AUTO_WALLET, không có APPROVED.
  - CTV thiếu MST (5,5 triệu): vẫn nhận APPROVED, Ví 0.
  - Ca thuế ăn hết: đúng một tin TAX_ONLY, không có APPROVED.
  Lưu ý: bỏ thử guard `autoCredited.has` thì spec vẫn xanh, vì khoản đã PAID nên `notifyCommissionsApproved` không còn dòng APPROVED nào để báo. Guard chỉ là phòng thủ thêm; spec vẫn kiểm đúng hành vi thật.
(4) First Load /nhan-vien: ĐÃ LÀM (152f6c9bc). `EmptyState` của trang chặn quyền nạp bằng next/dynamic và bỏ import `Link` thừa trong staff-shell. First Load /nhan-vien 151 → 150 KB (base 148 theo review, tức +2 KB, đạt ≤ +2). /ctv 157 KB và /nhan-vien/bang-luong 162 KB không đổi. Số lấy từ bảng của next build.

Số kiểm thật:
- tsc --noEmit (web, miniapp, app-core): sạch, sau khi sửa kiểu mock getWallet ở 748ffd7ac.
- eslint file đã sửa: miniapp sạch; web `next lint` "No ESLint warnings or errors". Không chạy eslint riêng cho `packages/app-core` (gói không có eslint).
- vitest app-core 942/942; Mini 4887/4887 (chạy thường và TZ=UTC); web 7453/7453.
- jest API toàn bộ: 485 suite, 11239/11239 pass.
- Race Postgres nhúng cổng 35740: affiliate-auto-wallet 16/16; 19 spec affiliate/wallet/payout/commission 171/171 pass. Đã dừng cụm.
- Playwright Mini App toàn bộ (cổng 3743): 205 pass, 10 skipped. Web gate `affiliate.web.spec.ts`: 24/24 pass. Không chạy `account.web.spec.ts` và không chạy cả bộ web (lượt này không đổi khung chung).
- `pnpm lint:parity`: xanh, 0 mục pending.
- Mini vite build + bundle-report: entry 711 KB raw / 222 KB gz, không tăng; chunk affiliate 49,8 KB. Tổng JS 1633 KB so với 1624 KB ở baseline (+9 KB). Mức +9 KB gộp cả gói từ đầu, lượt này chỉ thêm khoảng 0,3 KB ở chunk affiliate. Mình không dựng bản base để tách từng chunk, nên chưa chứng minh được "mỗi gói tối đa +5 KB"; người giao cần đối chiếu số này.
- Không chạy run-all.mjs, không chụp lại ảnh (không được giao). Ca số to là số dư Ví vẫn chưa chụp, như review nêu.
- Dọn dẹp: cổng 3741–3745 và 35740 không còn tiến trình nghe, cây git sạch, không push.

GHI BACKLOG:
- Chờ chủ chốt: Review 2 dặn hỏi chủ trước khi merge việc hero đổi thành "Số dư Ví Tubu" khi hết hoa hồng chờ chuyển. Số dư Ví gồm cả tiền hoàn tiền... không chỉ hoa hồng. Lượt này giữ hướng worker, chỉ bỏ trùng và sửa aria-label.
- `reviews/ctv-b.md` dòng 15 ở worktree review-1028 vẫn ghi mốc migration cũ 110000 (chỉ là tài liệu).
- Đo lại CLS/LCP của /ctv bằng run-all.mjs sau lượt này (hero chờ thêm Ví).
- Tổng JS Mini +9 KB so với baseline cần ghi nhận hoặc tách chunk.

## Review D1

KẾT LUẬN: chưa merge

- [P2] apps/miniapp/www/assets (cả gói, các chunk lazy): tổng Mini tăng **+8,2 KB raw** (gz +2,7). Luật của người giao là tối đa +5 KB mỗi gói và phải ghi số từng chunk; worker ghi +9 KB và không tách theo chunk. Mình đo bằng `tools/perf/chunk-diff.mjs`, so bản build ở `review-1028/apps/miniapp/www` (code giống base 1384ff38, đã kiểm `git diff`) với `r1028-ctv/apps/miniapp/www`:

  | Chunk | Thay đổi (raw) |
  |---|---|
  | affiliate | 45,2 → 48,7 (+3,5) |
  | ctv-dashboard (mới) | +1,5 |
  | dealer | +0,7 |
  | staff | +0,6 |
  | storefront-signup | +0,5 |
  | storefront-builder | +0,5 |
  | wallet | +0,4 |
  | **Tổng** | **1911,3 → 1919,5** |

  Entry không đổi. Lưu ý: dealer, staff, storefront và wallet là phần sửa lỗi, không phải "tính năng mới" mà luật cho phép tăng.
  Cách sửa: cắt ít nhất 3,3 KB raw ở chunk affiliate, ví dụ nạp động sheet hoặc tab ít dùng như ở web. Hoặc người giao ghi miễn trừ kèm bảng số trên. Nếu người giao tính theo gz (+2,7) thì mục này hạ xuống P3.

- [P3] apps/miniapp/src/pages/affiliate.tsx:310 và :979-988; apps/web/src/app/ctv/page.tsx:361 và :396-403 — Sau khi bấm "Chuyển vào Ví" (cờ bật, CTV vừa bổ sung MST), số to vẫn nhảy theo kiểu cũ.
  - Hai query dashboard và Ví được invalidate song song. Lúc Ví tải lại thì `walletQ.isLoading` là false vì đã có data cũ, nên `waiting` không bật.
  - Nếu dashboard về trước: hero đổi từ "Có thể chuyển vào Ví 120.000đ" sang "Số dư Ví Tubu 50.000đ" (số cũ), rồi mới thành 170.000đ.
  - Cách sửa: trong onDone, ghi số dư mới vào cache Ví trước, hoặc `await` refetch Ví xong mới invalidate dashboard. Thêm test cho ca dashboard về trước Ví sau khi chuyển.

- [P3] docs/2026-10-28-review/screens-ctv/ — Vẫn chưa có ảnh Mini và web 375 cho ca số to là "Số dư Ví Tubu" có dòng "Xem Ví Tubu". Nghĩa là hai nền tảng chưa được so khớp bằng ảnh ở trạng thái mặc định khi cờ bật. Cách sửa: chụp ca chuyển được = 0 trên lane có số dư Ví.

- [P3] apps/web/src/components/staff/staff-shell.tsx:17 — `EmptyState` giờ nạp bằng next/dynamic, nhưng worker không chạy lại e2e web `apps/e2e/tests/pro.web.spec.ts:109` (màn từ chối /nhan-vien). Unit vitest vẫn xanh. Cách sửa: chạy spec đó một lần trước khi merge.

- [P3] apps/api/src/modules/affiliate/affiliate.service.ts:1420 — Guard `autoCredited.has` thực tế không bao giờ có tác dụng: khoản đã tự cộng thì đã PAID, nên `notifyCommissionsApproved` không còn dòng APPROVED nào để báo. Worker đã nói rõ điều này. Không phải lỗi; ghi lại để không ai coi race spec là bằng chứng cho guard đó.

Mình đã kiểm, không thấy lỗi:
- **Test Mini (1) có bắt lỗi thật.** Mình chép spec ra thư mục tạm (/private/tmp/claude-501/-Users-longla-coding-tubutree-mini-app/e60524b4-300a-4d5d-a95d-b2ca8ab897dc/scratchpad/mut), mock `ctvHeroAmount` cho bỏ `walletLoading`: ca "dashboard về trước Ví" đỏ (không thấy khung chờ). Trả lại logic thật thì 3/3 xanh.
- **Chạy lại test liên quan:** app-core `ctv-dashboard.spec` 20/20; web `ctv/page.spec` và staff 47/47.
- **Race spec (3):** đã gọi `approveDueCommissions` thật trên commission LOCKED có `lockedAt` 40 ngày trước, đơn DELIVERED. Assert APPROVED/AUTO_WALLET/TAX_ONLY theo từng CTV là chặt. Mình chưa chạy lại vì không bật Postgres.
- **First Load (4):** ước lượng gzip từ app-build-manifest cho /nhan-vien là +1,4 KB so với base, khớp báo cáo 148 → 150. /ctv giảm.
- **Hero (1) và dòng Ví (2):** `waiting` chỉ bật khi cờ bật, chuyển được ≤ 0 và Ví đang tải lần đầu. Ví lỗi thì quay về "Có thể chuyển vào Ví". `aria-label` web theo nhãn đang hiện. Dòng Ví không lặp số. Logic nằm ở app-core, Mini và web khớp nhau.
- **Tiền:** lượt này không đổi đường ghi tiền, tỉ lệ, hold_days, ngưỡng thuế hay migration.

GHI BACKLOG: cần chủ chốt có giữ số to là "Số dư Ví Tubu" không, vì số này gồm cả tiền hoàn chứ không chỉ hoa hồng (worker đã nêu).

## Sửa D2 (head af7cf59a4)

Nhánh review/1028-ctv, worktree r1028-ctv. Không push. Lane 7 đã dừng (không còn cổng 3741-3745 nghe). P2 bundle CHƯA đạt, cần người giao quyết (xem dưới).

Commit lượt này:
- 451e6e6cc fix(ctv): sau khi chuyển vào Ví, làm mới dashboard sau Ví để số to không nhảy qua số dư cũ
- af7cf59a4 perf(ctv): Mini gộp kiểu nút dòng và toast sao chép, chunk affiliate 48,7 → 48,3 KB

Mục reviewer:
- P2 bundle: KHÔNG đạt, vẫn +7,8 KB raw (gz +2,7), luật là +5 KB raw. Đã cắt 0,4 KB bằng cách gộp kiểu nút dòng (ROW_BUTTON) và hàm toast sao chép trong affiliate.tsx. Cắt thêm 2,9 KB không được nếu không bỏ tính năng (thẻ "Việc đầu tiên", dòng lối sang Ví, hộp giải thích chuyển, tab). Chunk ctv-dashboard 1,5 KB là chuỗi chữ dùng chung với web nên không cắt được. Chia nhỏ chunk không giảm tổng. Cần người giao ghi miễn trừ hoặc tính theo gz.
  Số đo bằng chunk-diff.mjs so www của review-1028 (base 1384ff38) với www của r1028-ctv, raw KB: affiliate 45,2 → 48,3 (+3,1); ctv-dashboard mới +1,5; dealer +0,7; staff +0,6; storefront-signup +0,5; storefront-builder +0,5; wallet +0,4. Tổng 1911,3 → 1919,1 (+7,8); gz 737,1 → 739,8 (+2,7). Entry không đổi. Dealer, staff, storefront, wallet là sửa lỗi.
- P3 số to nhảy theo số Ví cũ: ĐÃ SỬA. Mini affiliate.tsx onDone và web ctv/page.tsx transferDone làm mới dashboard sau khi Ví làm mới xong. `invalidateBalances` ở apps/web/src/lib/balances.ts giờ trả Promise (callers khác vẫn chạy). Test trước: Mini và web đều đỏ trên mã cũ (web đã kiểm lại đỏ khi trả page.tsx về bản cũ), xanh sau sửa.
- P3 ảnh ca "Số dư Ví Tubu" + "Xem Ví Tubu": KHÔNG làm. Phải dựng lane, nạp dữ liệu, chụp 2 nền tảng. Người giao chụp lại khi cần.
- P3 e2e /nhan-vien: ĐÃ chạy web-gate pro.web.spec.ts, 24 passed (2,0 phút).
- P3 guard autoCredited: không đổi mã, chỉ ghi lại.

Kiểm (số thật):
- tsc --noEmit: miniapp OK, web OK.
- eslint file đã sửa: sạch (miniapp và web).
- vitest miniapp TZ=UTC: 314 file, 4888 test pass.
- vitest web: 441 file, 7454 test pass.
- vitest app-core: 942 test pass.
- pnpm lint:parity: xanh, 0 pending.
- vite build Mini (VITE_API_BASE_URL=https://api.tubutree.com/api): built in 2,38 s.
- Không chạy lại: jest API và race (lượt này không đụng API), Playwright Mini toàn bộ, bundle-report.mjs, First Load web (không đổi gì ngoài logic invalidate).

GHI BACKLOG:
- Chủ chốt có giữ số to là "Số dư Ví Tubu" không (số này gồm cả tiền hoàn, không chỉ hoa hồng).
- Guard `autoCredited.has` ở affiliate.service.ts:1420 không bao giờ có tác dụng (khoản đã tự cộng thì đã PAID); race spec không phải bằng chứng cho guard đó.
- Ảnh ca số to là "Số dư Ví Tubu" (Mini và web 375) chưa chụp.

## Review D2

KẾT LUẬN: chưa merge

- [P2] apps/miniapp/www/assets (các chunk lazy): tổng Mini vẫn vượt luật, +7,8 KB raw so với trần +5 KB mỗi gói.
  - Mình đo lại bằng `chunk-diff.mjs`, so `review-1028/apps/miniapp/www` với `r1028-ctv/apps/miniapp/www`. Bản build có mã của 451e6e6cc, đã kiểm trong `affiliate.xdhdQ3v3.module.js`.
  - Từng chunk (raw):

    | Chunk | Thay đổi | Ghi chú |
    |---|---|---|
    | affiliate | +3,1 (45,2 → 48,3) | tính năng mới |
    | ctv-dashboard | +1,5 | chunk mới, tính năng mới |
    | dealer | +0,7 | sửa lỗi |
    | staff | +0,6 | sửa lỗi |
    | storefront-signup | +0,5 | sửa lỗi |
    | storefront-builder | +0,5 | sửa lỗi |
    | wallet | +0,4 | sửa lỗi |
    | các chunk nhỏ hơn 0,3 KB | khoảng +0,5 | |
    | **Tổng** | **1911,3 → 1919,1 (+7,8)** | gz 737,1 → 739,8 (+2,7) |

  - Entry không đổi. Riêng phần tính năng mới là +4,6 KB, nằm trong trần. Phần vượt đến từ các chunk sửa lỗi.
  - Cách sửa: người giao ghi miễn trừ kèm bảng trên (hoặc chốt tính theo gz, khi đó hạ xuống P3). Nếu không thì phải cắt thêm khoảng 2,8 KB raw. Worker nói cắt được nữa thì phải bỏ tính năng.

- [P3] apps/miniapp/src/pages/affiliate.tsx:988 và apps/web/src/app/ctv/page.tsx:404 — Sửa lỗi số to nhảy lại làm dài thời gian số cũ còn hiện.
  - Giờ dashboard chỉ tải lại sau khi Ví tải xong; ở web còn phải đợi cả `me`, `wallet-txn`, `points-txn`. Suốt lúc đó hero vẫn hiện "Có thể chuyển vào Ví 120.000đ" và nút "Chuyển vào Ví Tubu" vẫn bấm được.
  - Ví dụ: CTV vừa chuyển xong, bấm tiếp ngay thì sheet hiện "Nhận 120.000đ vào Ví". Bấm xác nhận thì server từ chối và CTV thấy báo lỗi.
  - Không mất tiền: số tiền do server tính, đã có race spec cho bấm đồng thời.
  - Cách sửa: thêm một state "vừa chuyển" để khoá nút (hoặc hiện khung chờ ở hero) cho tới khi dashboard tải lại xong. Thêm test bấm lại trong khoảng này.

- [P3] apps/api/test/integration-race/affiliate-auto-wallet.race-spec.ts:321-357 — Hai ca race thêm ở d30c62525 chưa có bằng chứng đã chạy trên Postgres.
  - Hai ca này dùng `approveDueCommissions` thật. Báo cáo lượt này ghi "Không chạy lại race". Ở ctv-c.md, số race cuối cùng (14/14) là từ trước commit này. Review D1 cũng không chạy.
  - Mình không bật Postgres vì brief cấm bật server.
  - Cách sửa: chạy `affiliate-auto-wallet.race-spec.ts` trên cổng 35740 và ghi số pass trước khi merge.

- [P3] apps/web/src/lib/balances.ts:10 — `invalidateBalances` giờ trả Promise. Các chỗ gọi khác vẫn bỏ qua kết quả, nên hiện chưa sai. Riêng ở /ctv, dashboard giờ phụ thuộc vào thời gian tải lại `me`. Cách sửa: chỉ đợi `walletQuery` rồi mới tải lại dashboard, giống Mini (chỉ đợi `['wallet']`).

Mình đã kiểm:
- Chạy lại `affiliate.spec.tsx` của Mini (TZ=UTC, Node 22): 60/60 pass. `ctv/page.spec.tsx` của web: 46/46 pass.
- Test mới ở cả hai nền tảng có giữ Ví lại bằng promise chờ. Với mã cũ (dashboard tải lại song song), dashboard về trước sẽ làm hiện "Số dư Ví Tubu" với số dư cũ, nên assert phủ định sẽ đỏ.
- af7cf59a4 (gộp `ROW_BUTTON`, `copyWithToast`) giữ đúng kiểu cũ: `border:'none'` vẫn đứng trước `borderTop`; câu báo lỗi chép link vẫn giữ.
- Lượt này không đổi API, tỉ lệ, hold_days, ngưỡng thuế hay migration.

GHI BACKLOG:
- Chủ chốt có giữ số to là "Số dư Ví Tubu" không, vì số này gồm cả tiền hoàn chứ không chỉ hoa hồng.
- Guard `autoCredited.has` ở affiliate.service.ts:1420 không bao giờ có tác dụng: khoản đã tự cộng thì đã PAID. Race spec không phải bằng chứng cho guard này.
- Chưa có ảnh Mini và web 375 cho ca số to là "Số dư Ví Tubu" kèm dòng "Xem Ví Tubu".
