# PROGRESS — phiên UAT 2026-10-20

Phiên: `tubutree-mini-app-b4` (ListAgents). Worktree `.claude/worktrees/uat`, nhánh `uat/2026-10-20` từ origin/main `05e6ae97`.
Bị ngắt thì đọc file này, `00-brief.md`, rồi journal workflow (đường dẫn ghi ở mục Workflow) và chạy lại bằng `resumeFromRunId`.

## Mốc

| Giờ | Commit | Việc | Lệnh | Kết quả |
|---|---|---|---|---|
| 21:50 | 05e6ae97 | Tạo worktree, cài deps | `git worktree add -b uat/2026-10-20 .claude/worktrees/uat origin/main`; `pnpm install --prefer-offline`; build shared-types; prisma generate | exit 0 (`logs/install.log`) |
| 21:52 | 05e6ae97 | Postgres chạy thẳng 25432, Redis Docker 26379 | `tools/pg-native.sh install/start 25432/createdb 25432 tubutree_uat`; `docker run -d --rm --name tubu-uat-redis --tmpfs /data -p 127.0.0.1:26379:6379 redis:7-alpine` | PG 16.14 lên, Redis PONG |
| 21:53 | 05e6ae97 | Migrate + seed DB UAT | `prisma migrate deploy`; `tsx prisma/seed.ts`; `tsx prisma/seed-reference.ts --with-business-defaults` | exit 0 cả ba (`logs/seed*.log`) |
| 21:54 | 05e6ae97 | Mốc đầu đêm (sàn) | `tools/baseline.sh` → `logs/baseline/` | xem mục "Sàn test" |
| 07:30 | — | Phiên tắt khoảng 00:20 đến 07:30 (W10, gate 5 dừng giữa chừng); 07:32 viết báo cáo sáng bản đầu, hỏi chủ 3 lượt | `99-bao-cao-sang.md`, `98-cau-hoi.md` | chủ trả lời 12 câu |
| 20:39 | — | Máy khởi động lại (mất scratchpad, cụm Postgres, Redis, API, lane); chủ trả lời thêm Q2, Q15, Q19, Q20 | dựng lại 25432, Redis 26379, API 3221; `tools/race-one.sh` thay helper scratchpad | API 3221 lên |

## Sàn test đầu đêm (05e6ae97)

| Bộ | Lệnh | Số |
|---|---|---|
| jest api | `cd apps/api && npx jest --maxWorkers=4` | 426 suite / 9308 test, exit 0 |
| vitest miniapp (VN) | `cd apps/miniapp && npx vitest run` | 283 file / 4313 test, exit 0 |
| vitest miniapp (UTC) | `TZ=UTC npx vitest run` | 283 / 4313, exit 0 |
| vitest web (VN) | `cd apps/web && npx vitest run` | 358 file / 6178 test, exit 0 |
| vitest web (UTC) | `TZ=UTC npx vitest run` | 358 / 6178, exit 0 |
| vitest app-core | `cd packages/app-core && npx vitest run` | 41 file / 489 test, exit 0 |
| vitest eslint-config | `cd packages/eslint-config && npx vitest run` | 2 / 7, exit 0 |
| Playwright Mini App (list) | `E2E_SCOPE=miniapp npx playwright test --list` | 170 test / 24 file |
| Playwright web (list) | `E2E_SCOPE=web npx playwright test --list` | 292 test / 17 file |
| race (2 luồng, Postgres chạy thẳng 25541/25542) | `tools/race-shard.sh` (`--shard=i/2 --runInBand`) | 127+126 = 253 suite, 1007+957 = 1964 test, exit 0 cả hai, không spec nào phải chạy lại |

Log: `logs/baseline.out`, `logs/baseline/*.log`. Xong 22:01.

## Phối hợp

| Giờ | Chiều | Nội dung |
|---|---|---|
| 21:56 | gửi d3 | Báo tên phiên b4, worktree, nhánh, cổng 3221/3222/3223/25432/26379; phân vùng; hỏi lịch gate nặng |
| 21:57 | nhận d3 | Đồng ý phân vùng. Gate nặng phía web: 21:40–22:30 web-gate + Playwright Mini App (3121–3123, 5199); 22:30–01:00 lane `mshell`; 01:00–05:00 tối đa 4 lane (3131–3133, 3141–3143, 3151–3153, 3161–3163, PG 15432+/Redis 16379+); 05:00–07:00 gate tổng + PR nháp. Không chạy jest API hay race. Không cần báo trước gate của mình, chỉ tránh cổng; không dùng 32xx/255xx/25432/26379. |
| 22:13 | gửi d3 | Xin giữ `apps/web/src/components/admin/**` (sửa nút Ghim D2-02 và màn admin) |
| 22:15 | nhận d3 | Đồng ý giữ `components/admin/**` đêm nay, trừ `components/admin/portal-header.tsx` (lane `mshell` đang sửa vỏ trang): đổi file đó thì nhắn trước. Phiên web không sửa `components/admin/**` khác, không đụng `app/merchant/**`. |
| 22:39 | gửi d3 | Lô 1 lỗi web khách: D7-28…D7-36 (1440, P3), D15-01 (lọc themeColor ở /brand/[slug]), D15-05 và D8-5 chỉ báo. Báo trước Mini App sẽ đổi giao diện vài màn. |
| 22:42 | nhận d3 | Đã giao vào lane (00:30–04:00): mv-shop D7-28 brand, D7-29/30/31/32/35, D15-01; mv-order D7-28 đơn hàng, D7-33 (theo Mini App), D7-34; mv-loyalty D7-36. Không sửa D15-05, D8-5. Web đêm nay theo Mini App trên main 332f53aa; màn Mini App đổi xong trước ~04:00 thì nhắn tên màn + commit để họ theo thêm một lượt, muộn hơn thì ghi vào báo cáo. |
| 23:09 | gửi d3 | Lô 2: màn Mini App đổi (external-points, bank-payment, wallet, giờ vàng serverNow, FAQ, dealer orderRules, brand-view) kèm commit trên uat/int 70be1b2f; báo file vùng web đã sửa (lib/admin-client.ts InboxKey, shared-types waste.ts); lỗi web P3: ledger-labels REVIEW_RETURN, brand/[slug] themeColor SSR, waste-mocks.ts:70; dealer price-tab P2 cần orderRules ở app-core (hỏi trước) |
| 23:12 | nhận d3 | Nhận lô 2. Lane web `mv-uat2` chạy sau khi 4 lane giao diện gộp vào web/mobile-visual. Theo: bfd3918d, 9dcc431b, 95d6a687, bc92a683 (server-clock chép sang app-core), 94f2db2a, bc5e4c5b, 269aec88, nhãn REVIEW_RETURN. Không theo: 3a7514a6 (web không quét mã sàn), 17fabec5 (mv-shop đã lọc themeColor), waste-mocks (chờ API vào main). Báo trước: lane THÊM `orderRules?` vào DealerMe ở `packages/app-core/src/api/dealer.ts` và file mới `server-clock` trong app-core, không đổi chữ ký cũ, không đụng shared-types. Đồng ý mục B (admin-client.ts, waste.ts). Lô 3 gửi trước ~04:00 thì theo trong đêm. |
| 23:20 | gửi d3 | Lô 3: màn Mini App đổi ở đợt 3 (ui-miniapp-1: 9a4d13f7, 544c9ad7, 7edb9c02; ảnh `screens/fix/ui-miniapp-1`); báo sau việc sửa `apps/e2e/tests/pro.web.spec.ts:294-299` (f52e0b65, hộp xác nhận chốt lương); lỗi web P3: Đắk Lắk brand-origins.ts:89, tương phản cau-chuyen/brand-theme.css, câu hoàn tiền legal.ts |
| 23:21 | nhận d3 | Nhận lô 3. Không lane web nào sửa `apps/e2e/tests/pro.web.spec.ts`, giữ f52e0b65. Lập lane `mv-uat3` (song song `mv-uat2`, sau khi 4 lane giao diện gộp): theo 9a4d13f7, 544c9ad7, 7edb9c02, so ảnh `screens/fix/ui-miniapp-1/after` (chỉ đọc). legal.ts: đọc luồng hoàn tiền ở API, khớp thì dùng câu Mini App, không thì ghi câu hỏi. Hai lane không sửa apps/miniapp, apps/api, packages/** (trừ app-core đã báo), admin. |
| 00:01 | gửi d3 | Lô 4: màn Mini App đổi ở đợt 4b (ui-miniapp-2 9968242c, 4ee6b81d: bank-payment, wallet, external-points; ui-miniapp-3 e852c807: vi.ts "Miễn phí giao hàng", "Mã giảm giá chào mừng", bàn phím product-detail/flash-sale, logo nhỏ, recycle-new, cart, address-section, loyalty, recycle-desk); gợi ý web đổi chuỗi "miễn phí ship"/"Voucher chào mừng" |
| 00:03 | nhận d3 | Nhận lô 4: A1, A2 vào lane `mv-uat2`; B và C (grep "miễn phí ship", "Voucher chào mừng") vào `mv-uat3`; A3 external-points web không có màn. Câu "Mã giảm giá chào mừng" lấy bản 755fede9, sửa tiếp thì báo commit. |
| 00:04 | gửi d3 | Chốt câu vi.home.newGift: voucherAmount giữ; voucherPercent `Mã giảm giá chào mừng ${pct}%`; voucherFreeship 'Mã miễn phí giao hàng chào mừng'; commit sau gate 4 rồi nhắn sha. |
| 00:13 | gửi d3 | Lô 5: P2 web `apps/web/src/app/mua-chung/group-buy-view.tsx:221,231` còn in số tiền cố định (mã mua chung nay PERCENT có trần, Mini App đổi chữ % ở 959bf4f4); P3 `apps/web/src/lib/home-text.ts:38-39` chữ "Voucher chào mừng"; báo đã thêm `'dealerClaimsToPay'` vào InboxKey ở `lib/admin-client.ts` (05fad4f0) |
| 00:15 | nhận d3 | Nhận lô 5: mua chung P2 vào lane `mv-uat2` (2 vòng review Opus, grep mọi chỗ `basePrice - unitPrice`); home-text.ts vào `mv-uat3`; ghi nhận dealerClaimsToPay. Lưu ý: chữ % web chỉ khớp khi API 29795d4e vào main, nên PR UAT và PR web phải gộp cùng đợt. 3/4 lane giao diện đã gộp, còn mv-order; sau đó chạy mv-uat2, mv-uat3, mshell2. |

## Workflow

| Giờ | Tên | runId | Script | Trạng thái |
|---|---|---|---|---|
| 22:00 | uat-w1-review (5 góc review + soát chéo + báo cáo D1–D5) | wf_97071786-f31 | `tools/w1-review.workflow.js` | xong 22:15: P0=0, P1=5, P2=7, P3=14 |
| 22:01 | uat-w2-uiux-perf-docker (D6–D10) | wf_a29b9daf-94b | `tools/w2-uiux-perf-docker.workflow.js` | xong 22:38: D6 P2=7 P3=15; D7 P2=10 P3=26 (9 lỗi web khách); D8 P1=1 (chủ tự làm) P2=4 P3=13; D9 P2=3 P3=6; D10 P1=1 P2=2 P3=7. Build Docker api 154 s, web 214 s, exit 0 |
| 22:03 | uat-w3-e2e (bộ khung + 6 lane UAT U1–U6) | wf_88990532-be7 | `tools/w3-uat.workflow.js` | chạy |
| 22:17 | uat-w4-fix-wave1 (8 gói sửa từ D1–D5: voucher-moc, thuong-tra-hang, flash-sale-staff, quyen-admin, trien-khai, race-p3, zns, tin-cong-dong) | wf_9f687a4c-7ab | `tools/w4-fix-wave1.workflow.js` | xong, đã gộp vào uat/int (xem Gộp nhánh) |
| 22:19 | uat-w5-review2 (D11–D15) | wf_c0947e10-25c | `tools/w5-review2.workflow.js` | xong 22:35: P1=4, P2=8, P3=7 |
| 22:41 | uat-w7-fix-wave3-ui (3 gói: ui-miniapp-1, ui-admin-1, perf-api) | wf_ab47db78-573 | `tools/w7-fix-wave3-ui.workflow.js` | xong 23:17: 3/3 rev2 ok (chỉ còn P3), 11 agent, 0 lỗi; `impl/dot3.md` |
| 22:37 | uat-w6-fix-wave2 (5 gói: dai-ly, pancake-hoan-cod, doi-rac-kho, miniapp-logic, admin-web) | wf_25916745-4eb | `tools/w6-fix-wave2.workflow.js` | xong 23:08: 5/5 rev2 ok (chỉ còn P3), 19 agent, 0 lỗi; `impl/dot2.md` |
| 23:11 | uat-w8-fix-wave4a (5 gói từ uat/int 70be1b2f: don-sau-huy D12-02, mua-chung D11-05, tai-lieu-deploy D10-02…08/10, p3-thuong-tin, p3-nhan-vien) | wf_8afb05fe-f3a | `tools/w8-fix-wave4a.workflow.js` | xong: 5/5 gộp vào uat/int (mua-chung qua review lượt 3 ở 959bf4f4); `impl/dot4a.md` |
| 23:23 | uat-w9-fix-wave4b (5 gói từ uat/int b419dd9c: ui-miniapp-2 chuyển khoản/ví, ui-miniapp-3 chữ + a11y, ui-admin-2 page.tsx, ui-admin-3 components/admin, api-p3-hieu-nang) | wf_7502a8d0-93f | `tools/w9-fix-wave4b.workflow.js` | xong 23:58: 5/5 rev2 ok (chỉ còn P3), 18 agent, 0 lỗi; `impl/dot4b.md` |
| 00:19 | uat-w10-fix-wave5 (6 gói từ uat/int 4d71b653: tien-mua U1-B04/B01, gio-mini U1-B02/B03/B05, ctv-su-kien U3-B01/U4-29/U5-B05/Q21, admin-chu U5-B04/Q20, p3-don, p3-tai-lieu) | wf_7d32ae8f-0e0 | `tools/w10-fix-wave5.workflow.js` | dừng 00:20 (phiên tắt, Edit của worker bị chặn, không commit); chạy lại 07:36 là wf_cd7831ab-0ad: 6/6 xong; rev2 ok: tien-mua, gio-mini, p3-tai-lieu; rev2 còn lỗi: p3-don P1 (dời giờ flash lách trần), admin-chu P2 (khoá điểm game.*, seasonpass.*), ctv-su-kien P2 (GO-LIVE-KEYS discount %) |
| 20:45 | uat-w11-fix-wave5-round3 (sửa lỗi rev2 của p3-don, admin-chu, ctv-su-kien; review Opus lượt 3, tối đa lượt 4) | wf_8833a695-384 | script trong session | chạy |
| 20:47 | uat-w12-fix-wave6-chu-quyet (10 gói theo quyết định của chủ sáng nay: q1-xet-hang, q8-thuong-quy, q10-goi-that, q2-tncn, q19-dao-don, q12-freeship, q18-mua-chung, q22-chu-ky, q15-fetch, chu-viet; từ uat/int 30de91c9) | wf_cc6633fb-c4c | `tools/w12-fix-wave6.workflow.js` | chạy |

Journal workflow: `~/.claude/projects/-Users-longla-coding-tubutree-mini-app/290ef81c-34a8-4ce1-8b2c-51c8d5a19dd7/subagents/workflows/<runId>/journal.jsonl`.

## Tiến trình nền của phiên (dọn cuối đêm)

- Postgres chạy thẳng: cụm 25432 (`~/.cache/tubu-uat/data-25432`), dừng bằng `tools/pg-native.sh stop 25432`. Cụm race 25541/25542 đã dừng 22:02.
- Redis: container `tubu-uat-redis` (26379), xoá bằng `docker rm -f -v tubu-uat-redis`.
- API UAT 3221 (PID trong `~/.cache/tubu-uat/api-3221.pid`), dừng bằng `tools/api-up.sh stop 3221`.

## Gộp nhánh

Worktree `uat` đang chạy UAT (Vite, API dist từ mã 05e6ae97), nên KHÔNG gộp vào đó khi lane còn chạy. Gộp gói vào worktree `.claude/worktrees/uat-int`, nhánh `uat/int` (tách từ `uat/2026-10-20` 65491d96). Khi UAT xong: trong `uat` chạy `git merge --ff-only uat/int` (hoặc `--no-ff` nếu `uat/2026-10-20` có commit tài liệu riêng), build lại `apps/api/dist`, chạy lại các ca FAIL.

| Giờ | Gói | Nhánh/commit | Lệnh kiểm | Kết quả |
|---|---|---|---|---|
| 22:52 | đợt 1 (8 gói) | `uat/int` 4f62442d: voucher-moc, thuong-tra-hang, flash-sale-staff, quyen-admin, trien-khai, race-p3, zns, tin-cong-dong (`--no-ff` từng nhánh) | `git merge --no-ff uat/<gói>` | không xung đột |
| 23:04 | gate tạm 1 | `uat/int` 4f62442d | `tools/gate.sh <uat-int> logs/gate-int-1` (`logs/gate-int-1.out`) | tsc 4 app exit 0; lint:vars, lint:parity exit 0; migrate deploy OK, drift exit 0, partial index 31/31; jest api 431/9438 exit 0; race luồng 2 129/973 exit 0, luồng 1 1 FAIL `ops-health.race-spec.ts:187` (chạy lại vẫn FAIL: kỳ vọng cũ, quyen-admin cố ý thêm `invoicePending` + `payoutsToPay` cho KE_TOAN, D2-03/B18); vitest miniapp 283/4314 VN + UTC, web 358/6183 VN + UTC, app-core 41/489 |
| 23:07 | sửa gate tạm 1 | `uat/int` cd8b1629 | `npx jest -c test/integration-race/jest.config.js --runInBand ops-health.race-spec.ts` (cụm 25543) | Tests: 4 passed, 4 total |
| 23:08 | đợt 2 (5 gói) | `uat/int` 70be1b2f: dai-ly 269aec88, pancake-hoan-cod 9691e503, doi-rac-kho 93b1e221 (migration 20261020010000_waste_item_warehouse_only), miniapp-logic 9dcc431b, admin-web cbeec393 | `git merge --no-ff uat/<gói>` | không xung đột; gate tạm 2 chạy (`logs/gate-int-2.out`) |
| 23:18 | gate tạm 2 | `uat/int` 70be1b2f | `tools/gate.sh <uat-int> logs/gate-int-2` | tsc 4 app, lint:vars, lint:parity exit 0; migrate OK, drift exit 0, partial index 31/31; jest api 432/9511; race luồng 1 132/1043 exit 0, luồng 2 1 FAIL `sellable-product.race-spec.ts:367` (chạy lại vẫn FAIL: đơn đại lý vài trăm nghìn gặp luật tối thiểu 3 triệu mới của dai-ly, spec chưa tắt luật); vitest miniapp 285/4350 VN + UTC, web 358/6193 VN + UTC, app-core 41/489 |
| 23:20 | sửa gate tạm 2 + đợt 3 | `uat/int` 6591afc0 (sellable-product dùng `pinDealerOrderRulesOff`), rồi b419dd9c: ui-miniapp-1 7edb9c02, ui-admin-1 572ca364, perf-api b3c79129 | `git merge --no-ff uat/<gói>` | không xung đột; race sellable-product chạy lại 23:22 (cụm 25543): Tests: 27 passed, 27 total |
| 23:38 | gate tạm 3 | `uat/int` b419dd9c | `tools/gate.sh <uat-int> logs/gate-int-3` | tsc 4 app exit 0; lint:parity exit 0; lint:vars exit 1 (`apps/miniapp/src/test-support/contrast.ts:23` comment có chuỗi var(--x)); migrate OK, drift exit 0, partial index 31/31; jest api 433/9530; race 132/1042 + 132/989 exit 0, không spec chạy lại; vitest miniapp 289/4409 VN + UTC, web 359/6223 VN + UTC, app-core 41/489 |
| 23:40 | sửa gate tạm 3 | `uat/int` bbd6b7d0 | `npm run -s lint:vars`; `cd apps/miniapp && npx tsc --noEmit` | "OK — every var(--x) reference is defined." exit 0; tsc exit 0 |
| 23:42 | eslint sớm | `uat/int` bbd6b7d0 | `npx eslint src --max-warnings=0` (api), `npx eslint 'src/**/*.{ts,tsx}' --max-warnings=0` (miniapp), cùng cờ cho web (`logs/eslint-int-1/`) | api exit 0, miniapp exit 0; web exit 1 chỉ vì 1 warning `@next/next/no-img-element` ở `apps/web/src/components/affiliate/ctv-order-sheet.tsx:587`, có sẵn trên main 05e6ae97 (vùng web, CI chạy `next lint` cho phép warning). gate.sh từ nay: eslint web chỉ đỏ khi có error, in số warning |
| 00:00 | đợt 4b (5 gói) | `uat/int` 755fede9: ui-miniapp-2 4ee6b81d, ui-miniapp-3 e852c807, ui-admin-2 ba95d289, ui-admin-3 1d19aa23, api-p3-hieu-nang 8235a728 (migration 20261020110000_coupons_admin_list_index, partial index không unique) | `git merge --no-ff uat/<gói>` | không xung đột; gate tạm 4 chạy (`logs/gate-int-4.out`) |
| 00:05 | gate tạm 4 | `uat/int` 755fede9 | `tools/gate.sh <uat-int> logs/gate-int-4` | tsc 4 app, lint:vars, lint:parity exit 0; migrate OK (có 20261020110000_coupons_admin_list_index), drift exit 0, partial unique 31/31; jest api 433/9540; race 133/1045 + 132/988 exit 0, không spec chạy lại; vitest miniapp 293/4449 VN + UTC, web 361/6298 VN + UTC, app-core 41/489 |
| 00:08 | đợt 4a (5 gói) | `uat/chu-nho` e2dd7b61 (tách uat/int 755fede9 + 404f4f71 chữ mã chào mừng): don-sau-huy 3582d71c, tai-lieu-deploy ccd1f76b, p3-thuong-tin 2f1c841c, p3-nhan-vien 914dbbd7, mua-chung 29795d4e (rev2 còn P2: chữ trang nhóm) | `git merge --no-ff uat/<gói>` (gộp ở uat-chu-nho vì uat-int đang chạy gate/Playwright) | không xung đột |
| 00:05 | sửa sau đợt 4a | `uat/chu-nho` 05fad4f0 (web admin nối khoá `dealerClaimsToPay`: InboxKey, nhãn thẻ, CLAIM_FILTER, DealerClaimsTab mặc định APPROVED với kế toán), 959bf4f4 (trang mua chung ghi mã giảm theo %), cb27ea6b (runbook 211/25 migration) | `npx vitest run src/components/admin/ops-inbox-tab.spec.tsx src/components/admin/dealer-claims-tab.filter.spec.tsx` (đỏ trước: 1 failed, 3 failed), `npx vitest run src/pages/group-buy.spec.tsx` (đỏ trước 2 failed), tsc web/miniapp | xanh: 6/6 + 3/3; group-buy 26/26; tsc exit 0; reviewer Opus lượt 3 cho mua-chung + các commit điều phối đang chạy |
| 00:06 | Playwright Mini App 1 | `uat/int` 755fede9 | `E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3223 npx playwright test --workers=4` (`logs/pw-miniapp-int-1/run.log`) | 168 passed, 2 failed: `design-system-pilot.miniapp.spec.ts:145` (ảnh dòng giỏ nay aria-hidden, tên là nút) và `:194` (viền thẻ địa chỉ dời ra khung bọc, D6-03): test bám cấu trúc cũ, UI không hỏng |
| 00:09 | sửa Playwright 1 | `uat/int` a6c3ecc6 (ff lên uat/chu-nho cb27ea6b rồi commit: `data-testid="cart-line-thumb"`, test đọc style khung thẻ) | `npx playwright test tests/design-system-pilot.miniapp.spec.ts --workers=2`; `npx vitest run src/pages/cart` | 8 passed; cart 35/35; tsc e2e/miniapp exit 0 |
| 00:12 | review lượt 3 mua-chung + commit điều phối | `uat/chu-nho` cb27ea6b | reviewer Opus: vitest miniapp group-buy + new-customer-gift 39/39, web ops-inbox + dealer-claims 11/11, jest groupbuy + coupons 6 suite/177 test | OK gộp phần mã: không P0/P1; P2 còn ở vùng web (gửi d3 lô 5); P2/P3 mẫu tin GROUP_BUY_SUCCESS "{{discount}}đ" có ca hứa quá mức (đưa đợt 5); P3 runbook "Ba" → "Bốn" migration (sửa 4d71b653) |
| 07:45 | gate 5 | `uat/int` 4d71b653 | `tools/gate.sh <uat-int> logs/gate-int-5` | tsc 4 app, lint:vars, lint:parity, migrate, drift, partial index exit 0; jest api 437/9619; race luồng 1 135/1060 exit 0, luồng 2 1 FAIL lặp lại `pd3-order-reversal.race-spec.ts` B1 (kỳ vọng 470, nhận 500: kỳ vọng cũ, D12-02 nay hoàn điểm thường trong tx huỷ); vitest miniapp 293 file VN+UTC, web 362 VN+UTC, app-core 41 exit 0 |
| 20:43 | sửa gate 5 | `uat/int` 38c1b10d | `tools/race-one.sh <uat-int> 25549 pd3-order-reversal.race-spec.ts` | Tests: 8 passed, 8 total |
| 20:44 | đợt 5 (3 gói) | `uat/int` 30de91c9: uat-tien-mua c1012c39, uat-gio-mini 48474da8, uat-p3-tai-lieu 13a55174 | `git merge --no-ff uat/<gói>` | không xung đột; chưa gate |
