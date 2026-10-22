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
| 22/10 17:19 | c43718de | Phiên tiếp tục sau 2 ngày; máy đã khởi động lại lần nữa (API 3221, PG 25432, Redis 26379 đều tắt). Chủ trả lời Q2b (tự hoàn thuế giữ dư) và Q8b (chụp bậc quý). PR #24 web đã vào main 2f4dd3f7; phiên web nay là f2 | `uptime`; `lsof` cổng; `ListAgents` | ghi vào `98-cau-hoi.md` mục "Chủ trả lời 2026-10-22" |

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
| 20:55 | gửi 1f (phiên web, trước là d3) | Lô 6 lỗi web khách từ U6: P1 /san-pham tràn ngang 390, P2 Ví Tubu ở /thanh-toan, P2 /doi-rac/quy-dinh 401, P3 /doi-rac/yeu-cau, /hoc-vien, /tai-khoan 404 /brand/owner/me, /tai-khoan/diem-xanh dòng điểm chờ, /brand cache 5 phút; báo trước các đổi chữ/số của đợt 6 |
| 21:00 | nhận 1f | Nhận lô 6, làm mục 1, 3–8 ở lane mv-uat6 (PR nháp #24). Mục 2 cần chủ quyết: ma trận web-parity dòng 5 đã chốt "COD, chuyển khoản, ví (Q4)" |
| 21:05 | nhận 1f | Chủ chốt: U6-B08 giữ Ví Tubu trên web; U6-B06 bỏ dòng điểm chờ ở web. Phiên UAT hỏi chủ cùng câu, chủ chọn giữ ví |
| 21:06 | gửi 1f | Ghi nhận hai quyết định; GET /waste/rules @Public ở uat/u6-api d1e4484b, chờ review |
| 21:20 | nhận 1f | Báo trước sửa apps/e2e/tests/shop.web.spec.ts (660cafca, thêm api.get('/config/public') ở 2 ca chuyển /dang-nhap, chữa lúc đỏ lúc xanh); không đụng mock-api.ts. U6-B06 xong (d0e4bee3, gộp fcf1515b) |
| 21:21 | gửi 1f | Đồng ý; uat/int và mọi nhánh uat/* không đụng shop.web.spec.ts |
| 21:50 | nhận 1f | Lô 6 web đã gộp vào web/mobile-visual 3e3e8970 (lane mv-uat6, gate xanh, 2 lượt Opus). Gợi ý phía UAT: (1) U6-B05 thêm cờ kiểu ownsBrand vào /me để khỏi gọi /brand/owner/me nhận 404 (Mini App cũng gọi rồi nuốt 404); (2) Mini App /hoc-vien còn in lỗi quyền thô cho khách thường, web nay hiện "CTV Academy dành cho cộng tác viên" kèm lối /ctv. U6-B01 chỉ còn ở main; web thêm e2e 390px |
| 21:51 | gửi 1f | U6-B05 để sau đợt 6 (đổi hợp đồng /me, sẽ báo tên trường trước); /hoc-vien Mini App sửa cùng câu với web sau khi gói chu-viet (Q16) chốt tên |
| 22/10 17:22 | gửi f2 | Phiên web mới tên f2 (1f đã tắt). Báo trước: uat/q2-tncn sửa 5 file affiliate-rules.ts, api/affiliate.ts, api/config.ts (app-core), withdraw-sheet.tsx, props WithdrawSheet ở ctv/page.tsx |
| 22/10 17:23 | nhận f2 | Đồng ý, f2 không sửa 5 file đó. PR #24 đã vào main 2f4dd3f7; f2 gợi ý tách nhánh từ main nếu xung đột. Trả lời: main chỉ đổi ctv/page.tsx ở các hunk tới dòng khoảng 453, WithdrawSheet ở dòng 622; sẽ chạy merge-tree với main sau khi gói xong |
| 22/10 17:40 | gửi f2 | Lô 7: `lo7-gui-web.md` (freeship 199k, Q13/Q14/Q16 chữ, Q22 đổi chu kỳ + lastOrderAt, báo trước trường ownsBrand ở /auth/me) |
| 22/10 17:45 | nhận f2 | Lane mv-uat7 (nhánh web/uat7 từ main 2f4dd3f7): freeship dự phòng 199.000, Q13/Q14/Q16 + "Học viện CTV", Q22, q18 minOrder; sửa app-core subscriptions.ts, groupbuy.ts (trường tuỳ chọn); đổi "Đã hủy" ở lib/order-view.ts kèm một dòng kỳ vọng admin/page.spec.tsx (~490) |
| 22/10 17:46 | gửi f2 | Đồng ý dòng admin spec; uat/* không đụng order-view.ts và dòng đó; sẽ báo commit ownsBrand |
| 22/10 17:50 | gửi f2 | Xin thêm 3 chỗ cho q2-tncn: nhãn PIT_REFUND ở app-core wallet-rules.ts và web ledger-labels.ts, PayoutRow ở ctv/page.tsx hiện "đã hoàn X vào Ví" |
| 22/10 17:53 | nhận f2 | Đồng ý cả 3. Lane mv-uat7 chỉ đổi chữ Q16 ở ctv/page.tsx (~171, ~173, khối caption từ ~393), không đụng PayoutRow (~265-290); hunk sát nhau thì giữ cả hai phía |

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
| 20:45 | uat-w11-fix-wave5-round3 (sửa lỗi rev2 của p3-don, admin-chu, ctv-su-kien; review Opus lượt 3, tối đa lượt 4) | wf_8833a695-384 | script trong session | xong 21:10: p3-don rev3 ok (1305c8c4), admin-chu rev4 ok (7c7574fe, ff36eef7), ctv-su-kien rev3 ok (1b81d162); chỉ còn P3 |
| 20:47 | uat-w12-fix-wave6-chu-quyet (10 gói theo quyết định của chủ sáng nay: q1-xet-hang, q8-thuong-quy, q10-goi-that, q2-tncn, q19-dao-don, q12-freeship, q18-mua-chung, q22-chu-ky, q15-fetch, chu-viet; từ uat/int 30de91c9) | wf_cc6633fb-c4c | `tools/w12-fix-wave6.workflow.js` | xong: 9/10 review OK (q8 ok ở lượt 3); q2-tncn chưa ok: P1 web/app-core còn tính thuế từng lần, P2 từ chối lệnh rút không hoàn thuế giữ dư (hỏi chủ: Q2b); P3 Q8 bậc quý không chụp (hỏi chủ: Q8b) |
| 22/10 17:24 | uat-w13-chu-quyet-2 (q2-tncn: màn rút web/app-core dùng withdrawTaxPreview + tự hoàn thuế giữ dư khi từ chối, migration 20261022100000_payout_tax_refunded; q8-thuong-quy: chụp bảng bậc theo quý, migration 20261022110000_dealer_quarter_bonus_tiers) | wf_95dee216-9d3 | `tools/w13-chu-quyet-2.workflow.js` | xong 17:45: 4 agent. q2-tncn 39ff0124, 06caf612; q8-thuong-quy e6c5a4f4. Cả hai rev1 ok, chỉ còn P3; script bỏ lượt 2 khi lượt 1 ok, nên chạy W14 (sửa P3 + review lượt 2 cho gói tiền) |
| 22/10 17:55 | uat-w14-p3-review2-tien (q2-tncn: expectedAmount khi duyệt/chi, ghi Ví trước taxRefunded, nhãn PIT_REFUND app-core + web, PayoutRow web, sổ tay, comment migration; q8: TOCTOU bản chụp, test thu hồi) + review Opus lượt 2 | wf_d9e9d50f-57f | `tools/w14-p3-review2-tien.workflow.js` | chạy |

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
| 21:15 | kiểm lại W11 | uat/uat-p3-don, uat/uat-admin-chu, uat/uat-ctv-su-kien | jest flash-sale/orders/cart; race p3-don-flash-cart staff-flash-sale r13-flash-existing-row-lock (25555); vitest web admin; jest affiliate/feed/groupbuy | 331/331; 19/19; 1178/1178; 877/877 |
| 21:17 | đợt 5 (3 gói còn lại) | `uat/int` 5f77aaf5: uat-p3-don, uat-admin-chu, uat-ctv-su-kien | `git merge --no-ff` | không xung đột; gate 6 chạy |
| 21:05 | gói u6-api (U6-B03 /waste/rules @Public, U6-B07 địa chỉ mặc định) | uat/u6-api d1e4484b, 757040b5 | jest users + waste customer; race address-subscription (25571); review Opus | 79/79; 9/9; ok, 2 P3 (deadlock thứ tự khoá, khe 0 mặc định) đang sửa |
| 21:21 | gate 6 | `uat/int` 5f77aaf5 (đủ 6 gói đợt 5) | `tools/gate.sh <uat-int> logs/gate-int-6` | exit 0: tsc 4 app, lint:vars, lint:parity, migrate, drift, partial index exit 0; jest api 437/9683; race 135/1060 + 135/1005 (270/2065) không spec nào chạy lại; vitest miniapp 293/4467 VN+UTC, web 363/6358 VN+UTC, app-core 41/489 |
| 21:45 | gói u6-api sau review 3 lượt | `uat/int` (gộp uat/u6-api: d1e4484b, 757040b5, 934f5c4f, a1444ff9 khoá advisory `address-book:<userId>`, bỏ Serializable) | jest users+subscriptions+waste 265/265; race address-subscription 14/14 (25571); review Opus lượt 3 ok | Còn 3 P3 khi gộp tài khoản khách vãng lai (auth.service.ts:513-517 không lấy khoá sổ địa chỉ): R3-1 gộp bị huỷ 503 khi khách đang tạo địa chỉ, R3-2 có thể còn 0 địa chỉ mặc định, R3-3 có thể 2 mặc định (có từ trước). Hoãn: chỉ xảy ra một lần mỗi khách lúc đăng nhập Zalo, sửa phải đụng luồng gộp (auth). Cách sửa đã có: lấy `address-book` của khách và đích theo thứ tự id ngay sau GUEST_MERGE_LOCK_KEY |
| 22/10 17:25 | đợt 6 (8 gói, W12 review OK) | `uat/int` 3362c0a0: q1-xet-hang 7c5eb963, q10-goi-that a1c50dd8, q18-mua-chung 627c6967, q19-dao-don 6854156a (migration reversalEffectsAt), q12-freeship e2dffaa4, q22-chu-ky 831f1b89, q15-fetch 15458842, chu-viet 3362c0a0 | `git merge --no-ff uat/<gói>` | 2 lần xung đột, đã gỡ tay: q22 với q10 ở `subscriptions.service.ts` list() (giữ cả floorCount lẫn lastOrders), tsc api exit 0, jest subscriptions 107/107; chu-viet với uat-ctv-su-kien ở dòng link CTV Mini App (giữ ẩn số đơn, đổi "click" thành "lượt bấm") và `admin/page.spec.tsx` (giữ cả hai test), vitest affiliate 41/41, admin page 206/206, tsc miniapp exit 0. q2-tncn và q8-thuong-quy chưa gộp (W13) |
| 22/10 17:32 | gate 7 | `uat/int` 3362c0a0 (8 gói đợt 6) | `tools/gate.sh <uat-int> logs/gate-int-7` | gate exit 0: tsc 4 app, lint:vars, lint:parity, migrate, drift, partial index 31/31 exit 0; jest api 442/9765; race 138/1073 + 137/1019 (luồng 1 lần đầu 1 FAIL `cron-leader.race-spec.ts:61`, chạy lại PASS); vitest miniapp 295/4513 VN+UTC, web 364/6362 VN+UTC, app-core 41/489. cron-leader không bị UAT đổi (git log 05e6ae97..HEAD rỗng): chập chờn có sẵn, có lẽ do `expiresAt` là timestamp(3), nhả lease đặt `now()` bị làm tròn lên tới 0,5ms nên tick ngay sau đó thấy lease chưa hết hạn. Không ảnh hưởng PROD (tick cách nhau nhiều giây). P3: nhả lease nên đặt `now() - 1s` |
| 22/10 18:05 | gói p3-hoc-vien-ownsbrand (U6-B09 Mini App Học viện 403 → khối "Học viện CTV dành cho cộng tác viên"; U6-B05 /auth/me trả ownsBrand) | `uat/int` 35a716c6 (95e13f71, 59325c87) | worker Sonnet TDD; review Opus lượt 1: P2 3 spec e2e Mini App chưa mock /auth/me + 3 P3 (mục nhãn còn hiện khi cờ đổi false, comment cũ, kiểu tay) → sửa 59325c87. Tự chạy lại: vitest profile-brand-owner + profile-hub + academy 42/42, jest auth 126/126, tsc e2e exit 0; worker báo Playwright Mini App toàn bộ 170/0, vitest miniapp 295/4520 VN+UTC | gộp không xung đột; báo f2 tên trường |

## Việc chờ sau đợt 6

- ~~Mini App /hoc-vien~~ xong 35a716c6.
- ~~U6-B05~~ xong 35a716c6 (ownsBrand trên /auth/me), đã báo f2.
- ~~Gửi phiên web mã commit đợt 6~~ lô 7 đã gửi f2 (`lo7-gui-web.md`).
- P3 hoãn: R3-1..R3-3 gộp tài khoản (xem dòng gói u6-api).
