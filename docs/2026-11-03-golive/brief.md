# Đợt gl-1103: hoàn thiện trước go-live (03/11). Luật cho worker và reviewer

Đọc hết file này trước khi làm. Prompt riêng nói gói nào; file này nói luật chung và việc của từng gói.

## Gốc, nhánh, phạm vi
- Gốc: `origin/main` 52fd5cd65 (= PROD 0aa8af5d1 + 2 PR chỉ tài liệu). PROD Vietnix chạy 0aa8af5d1. Mini App Testing V30 dựng từ 0aa8af5d1.
- Mỗi gói một worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-<gói>`, nhánh `gl/1103-<gói>`. Đã `pnpm install`, `prisma generate` (trong `apps/api`), build `@tubutree/shared-types`. Chỉ sửa trong worktree của gói.
- Phiên khác `tubutree-mini-app-db` đang làm song song: admin (`apps/web/src/app/admin/**`, `apps/web/src/components/admin/**`), API các module admin, affiliate/wallet, waste/recycle, loyalty/garden, cron, ZNS, Pancake, data-retention. KHÔNG sửa các vùng đó. Cần sửa thì dừng và ghi vào báo cáo (phiên điều phối 2a sẽ hỏi db).
- Đọc `AGENTS.md`. Đổi giao diện ở `apps/miniapp` hoặc `apps/web`: gọi skill `tubu-ui` trước, đọc `DESIGN.md`, dùng thành phần trong `docs/design/ds-map.json`. Chữ màn gian hàng chỉ thêm ở `packages/app-core/src/shop-copy.ts`.
- Web khổ điện thoại (375) phải giống Mini App cả giao diện lẫn chữ; máy tính (1280) mở rộng hợp lý.

## Quyết định đã chốt (không làm ngược)
- Không đổi luật điểm, giá, phí, thể lệ, chữ pháp lý. Không thêm migration, không đổi `schema.prisma`. Thấy cần thì dừng, báo lại.
- Giọng chữ đợt 8: không "Vui lòng", không "chúng tôi" (dùng "Tubu"), không "..." ba chấm, "Giờ vàng" viết hoa. Lỗi chung "Đã có lỗi xảy ra. Bạn thử lại nhé."
- Câu lỗi API mà Mini đã phát hành còn so khớp để rẽ nhánh thì giữ nguyên từng chữ (danh sách ở `docs/2026-10-31-shop-redesign/plans/M2-api-copy.md`, mục notes): "đăng nhập Zalo", "không đủ tồn kho", "Hết suất ưu đãi.", "Vượt giới hạn mua ưu đãi.", mệnh đề đầu lỗi hoàn tiền.
- Mini App: cộng đồng chỉ đọc, không link ra ngoài, không rút tiền về ngân hàng, thanh đáy 5 tab như hiện tại.
- Không thêm thư viện UI mới. Entry Mini App không được tăng; tổng Mini tăng ≤ +3 KB gzip mỗi gói (có số); web First Load trang đổi ≤ +2 KB.

## Môi trường (bắt buộc)
- Mọi lệnh shell: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`.
- Bài học môi trường: `/Users/longla/.claude/projects/-Users-longla-coding-tubutree-mini-app/memory/env-lessons-tubutree.md`. Đặc biệt: web dùng `localhost` không dùng `127.0.0.1`; test giờ của Mini chạy thêm `TZ=UTC`; zsh không tách từ biến nhiều file.
- Lane (`docs/2026-10-20-uat/tools/uat-harness/README.md`, `docs/2026-10-28-review/tools/LANES.md`): Postgres 25432 và Redis 26379 dùng chung đã bật, KHÔNG dừng. DB lane copy từ mẫu `tubutree_uat_tpl` rồi `npx prisma migrate deploy` (mẫu thiếu migration mới). Bật lane từ CHÍNH worktree của gói (`lane-up.sh N --web`). Nạp dữ liệu `node docs/2026-10-28-review/tools/seed-data.mjs --lane N all`. Chụp: `build-routes.mjs --lane N`, `capture.mjs --lane N --phase mini375,web375[,web1280] --keys <khoá> --force`, `before-after.mjs`.
- Playwright Mini App: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=<cổng> npx playwright test <file>`. Web: `apps/e2e/scripts/web-gate.sh <file>` với `GATE_PG_PORT`, `GATE_REDIS_PORT`, `E2E_API_PORT`, `E2E_WEB_PORT`, `E2E_MINIAPP_PORT` trong khối cổng của gói. KHÔNG `npx playwright test` trần.
- CẤM: `pkill -f`; kill tiến trình không do mình tạo (chỉ `lsof -ti tcp:<cổng của mình> -sTCP:LISTEN | xargs kill`); Docker không `--rm --tmpfs`; push, PR, merge, deploy, đọc hay ghi PROD; `git stash` trần; `--no-verify`; sửa ngoài worktree của gói; đụng lane hay cổng của gói khác (lane 2, 7, 8, 9 cấm hẳn).
- Máy 12 lõi dùng chung với 5 worker khác và hai phiên khác. Test timeout hàng loạt: `top -l 1 -n 0` trước khi nghi mã; chạy lại riêng ca đó.
- Script bash đang chạy thì không sửa.

## Lane và cổng
| Gói | Lane (API/web/Mini) | Khối cổng e2e (API +1, web +2, Mini +3, PG gate +4, Redis gate +5) |
|---|---|---|
| auth | không cần lane | 3900 |
| chu | 1 (3211/3212/3213) | 3910 |
| pdp | 3 (3231/3232/3233) | 3920 |
| ctv | 4 (3241/3242/3243) | 3930 |
| parity | 1 dùng chung với chu: chỉ bật khi chu không bật (`lsof -iTCP:3211 -sTCP:LISTEN`); nếu bận thì chờ hoặc dùng Playwright khối cổng | 3940 |
| flaky | không cần lane | 3950 |
Lane 5, 6 và khối 3960–3999 dành cho audit của phiên điều phối.

## Cách làm
1. Đọc mục của gói, mã thật, plan cũ liên quan (`docs/2026-10-31-shop-redesign/plans/*.md`, `docs/2026-10-28-review/20-backlog.md`).
2. Logic kiểm được thì viết test trước, thấy đỏ rồi mới sửa. Ghi lại ca nào đỏ với mã cũ.
3. Mini và web sửa cùng nhánh; logic chung ở `packages/app-core`.
4. Sửa ít nhất có thể, theo phong cách mã xung quanh. Comment chỉ giải thích "vì sao" không hiển nhiên; không comment kể lại thay đổi.
5. Commit nhỏ, tiêu đề tiếng Việt kiểu `fix(pdp): ...`, cuối commit dòng `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Không commit ảnh, `routes.json`, `params-l*.json`.

## Kiểm trước khi báo xong (chạy thật, chép số thật)
- tsc mọi app/gói đã sửa; eslint file đã sửa.
- vitest TOÀN BỘ app-core, miniapp (thêm `TZ=UTC`), web nếu đụng chúng; jest API toàn bộ nếu đụng API.
- Playwright: spec của màn đã đổi ở cả Mini và web (web qua `web-gate.sh`).
- `pnpm lint:parity` ở gốc (gồm `ds-ratchet`; giảm số thì hạ baseline bằng `node scripts/uiux/ds-ratchet.mjs --write` và chỉ commit dòng của file mình).
- Đổi Mini: `vite build` rồi `node docs/2026-10-28-review/tools/perf/bundle-report.mjs`, so với cùng phép đo trên gốc 52fd5cd65 (đo gốc trước khi sửa).
- Đổi giao diện: ảnh trước/sau 375 Mini và web (thêm 1280 nếu đổi web) vào `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-03-golive/screens-<gói>/`. Mở xem từng ảnh bằng Read.
- Dừng lane và tiến trình của mình khi xong (`lane-down.sh N`, không `--drop`).

## Báo cáo
Ghi `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-03-golive/reports/<gói>-<lượt>.md` (không commit), tối đa 60 dòng: commit (hash + tiêu đề); từng mục làm/không làm, lý do; lệnh kiểm và số thật; bundle trước/sau; ảnh; việc còn lại, chỗ chọn khác brief.

---

## Gói auth (Mini App, `apps/miniapp/src/store/auth.ts` và nơi gọi). Đường đăng nhập: review 2 lượt APPROVE.
Phần để sau của PR #125, #127 (`gh pr view 127 --json body` đọc được). Ba mục:
1. **Đăng xuất khi refresh đang bay.** `logout()` đọc token, xoá storage, đặt `idle`; nhưng `refreshSession()` (từ `restore()` hoặc handler 401 `setUnauthorizedHandler`) đang chờ máy chủ sẽ trả về sau đó, rồi `setAccessToken` + `persistRefresh(token mới)` + `authenticated`. Kết quả: máy dùng chung tự đăng nhập lại người vừa đăng xuất và lưu refresh token mới trên máy. Cùng loại: `login()`/`silentLogin`, `ensurePhoneOrThrow`, `upgradeGuestSilently` trả về sau `logout()`.
   Yêu cầu: mọi đường tạo phiên trả về sau một lần `logout()` bắt đầu thì không đặt token, không lưu refresh, không đổi `user/status`; refresh token mới nhận được thì gửi `/auth/logout` để thu hồi (không chờ). Một lần đăng nhập BẮT ĐẦU sau `logout()` vẫn chạy bình thường. Test cho từng đường (restore, handler 401, login, ensurePhone, upgradeGuest), mỗi ca đỏ với mã cũ.
2. **ZMP storage ném lỗi (không phải hết giờ) hoặc chậm quá 3 s ở đường đăng nhập.** Hiện: hết giờ là lỗi tạm (`StorageTimeoutError`), báo "mất kết nối" dù mạng ổn; ném lỗi khác thì rơi sang nhánh cũ (vd `tryZaloLogin` đã `setAccessToken` rồi `persistRefresh` ném → trả 'guest' → `getDeviceId` ném → 'error'; hoặc `refreshSession` ném lỗi không phải HTTP → `restore` rơi xuống `silentLogin`). Yêu cầu: (a) storage lỗi hay hết giờ không bao giờ đổi khách sang tài khoản khác hoặc Khách; (b) đăng nhập Zalo đã thành công mà chỉ lưu refresh hỏng thì vẫn vào được phiên (token giữ trong bộ nhớ cho refresh của phiên này), không bị đá ra; (c) chữ báo cho khách khi lỗi do storage là lỗi máy, không phải "mất kết nối mạng"; câu ngắn ở `vi.ts` theo giọng đợt 8; (d) `useSessionRecovery` vẫn thử lại được. Test từng nhánh (ném lỗi, treo > 3 s bằng đồng hồ giả).
3. **Tim (Yêu thích) và PDP gọi `login()` lúc `status === 'loading'`.** PR #125 đã cho `login()` chờ `restore()`. Rà mọi nơi gọi `login()` ở Mini (`grep -rn "login()" apps/miniapp/src`), xác nhận bằng test cấp component (bấm tim / bấm mua lúc 'loading' → không đăng nhập song song, không hai lần xoay refresh; sau khi restore ra phiên thì hành động chạy tiếp hoặc nút báo rõ). Nếu đã đúng thì chỉ thêm test và ghi "đã đúng từ #125".
Không đổi API. Vitest miniapp toàn bộ hai múi giờ. Playwright Mini các spec đăng nhập (`grep -l "login\|auth" apps/e2e/tests/*.miniapp.spec.ts`).

## Gói chu (chữ client khớp câu API đợt 8 + lưới chữ cấm)
1. `apps/miniapp/src/utils/checkout-rules.ts`, `apps/web/src/lib/checkout-rules.ts`, `apps/web/src/app/tai-khoan/don-hang/[code]/order-actions.tsx` (và nơi Mini dựng cùng câu) có câu lặp lại câu lỗi API. Sau M2 (đợt 8) API đổi chữ; client chưa khớp từng chữ. Làm cho từng câu client lặp câu API khớp đúng câu API hiện tại (nguồn: `apps/api/src`, kể cả `flash-sale-notice.ts`); tốt hơn: một nguồn chung và test ghim hai bên bằng nhau. Câu nào client dùng để so khớp rẽ nhánh (`includes(...)`) thì giữ hành vi với cả câu cũ lẫn mới.
2. Siết `terminology.spec` (Mini `apps/miniapp/src/i18n/terminology.spec.ts`, web `apps/web/src/app/admin/terminology.spec.ts` (file spec này nằm dưới admin nhưng là bộ quét chữ: được sửa)): thêm luật ghim "câu client lặp câu API phải bằng câu API"; bắt thêm "nhãn" nghĩa thương hiệu đứng một mình ở chữ khách đọc nếu bắt được mà không bắt nhầm (giới hạn ở `docs/2026-10-31-shop-redesign/plans/handoff-wave8.md` §4). Không mở rộng sang chữ pháp lý.
3. Test: vitest app-core, miniapp, web; jest API nếu đụng API (chỉ được đổi chỗ đặt hằng chữ, không đổi câu API mà Mini cũ so khớp).

## Gói pdp (PDP hai app, web 375 và 1280)
1. **CLS ghi chú hết suất Giờ vàng trên PDP ngoài sheet.** `GET /flash-sales/me/allowance` về muộn thì ghi chú "Bạn không còn suất Giờ vàng…" / "Bạn còn {n} suất…" chèn vào và đẩy phần dưới ô Số lượng (handoff-wave8 §4, plan `M4-flash-allowance.md`). Đích: allowance về muộn (giả chậm 1–3 s) không gây layout shift trên PDP Mini và web 375 (đo bằng PerformanceObserver layout-shift trong Playwright, phần do ghi chú bằng 0); không để dòng trống cố định ở PDP không có Giờ vàng hoặc khách chưa đăng nhập. Gợi ý: đặt ghi chú vào chỗ có chiều cao cố định sẵn (thay chữ trong dòng có sẵn của khối Giờ vàng, hay thanh mua dính đáy), hoặc chỉ giữ chỗ khi SP đang trong Giờ vàng có giới hạn mỗi khách và khách đã đăng nhập. Ghi lý do chọn. Nút và tổng tiền vẫn theo số của khách như đợt 8.
2. **Nợ `ds-ratchet` của PDP web (`max-md:` từ F10c).** `apps/web/src/app/san-pham/[slug]/**`, `apps/web/src/components/add-to-cart.tsx`, `pdp-*`: giảm số `max-md:` và px viết tay bằng lớp/thành phần dùng chung (vd lớp tiện ích ở `order-mobile/mobile-ui.ts` hay token) mà KHÔNG đổi hình: ảnh 375 và 1280 trước/sau giống nhau (so pixel, ghi số px lệch). Hạ baseline đúng các file đã giảm.
3. **E2E chiều cao phiếu mã web 375.** Viết `apps/e2e/tests/voucher-ticket-height.web.spec.ts` tương đương `voucher-ticket-height.miniapp.spec.ts` (88/138/98/88px cùng bộ mock), chạy qua `web-gate.sh`.
Phạm vi: PDP, `add-to-cart`, sheet chọn phân loại, file e2e mới. Không sửa trang chủ, giỏ, thanh toán.

## Gói ctv (màn khách CTV: trình dựng gian hàng, trang CTV, gian hàng `/s/:slug`, Mini + web)
1. **Hàng huy hiệu bậc CTV ~30px ở trình dựng gian hàng khi vào thẳng bằng liên kết** (chưa có cache bậc từ trang CTV): CTV bậc thấp nhất chưa duyệt thì hàng huy hiệu thu lại một lần (handoff-wave8 §4, plan `M3-ui-minors.md`, `K6-ctv-tier.md`). Đích: CLS 0 do hàng huy hiệu cho mọi persona (`ctv` đã duyệt, `ctv_pending`) và mọi trạng thái (/affiliate/tiers về chậm, lỗi, hết hạn chờ), vào thẳng bằng URL, Mini và web 375. Không để khoảng trống vô nghĩa lâu dài: nếu giữ chỗ thì chỗ đó phải có nội dung, chốt theo `tubu-ui`. Playwright đo layout-shift.
2. **R-140 phần còn lại** (`docs/2026-10-28-review/20-backlog.md`): kiểu chữ mã giới thiệu và chấm/gạch đầu dòng web 375 khác Mini ở trang CTV, gian hàng, đại lý. Soát lại toàn bộ danh sách R-140 bằng ảnh 375 hai nền (`ctv`, `ctv_pending`, `dealer`, `guest` ở `/s/<slug>`) và sửa phần còn lệch theo Mini.
Không sửa API affiliate/wallet và admin (phiên db). Chỉ màn khách.

## Gói parity (R-109, R-23, R-132)
1. **R-109 (B-151):** Mini hiện giờ theo múi giờ máy (`apps/miniapp/src/utils/format.ts` và mọi nơi định dạng giờ/ngày cho khách: dòng thời gian đơn, hạn, "Giao lúc", Giờ vàng, thông báo, điểm danh). Cố định `Asia/Ho_Chi_Minh` như web, dùng chung hàm ở app-core nếu có (`vn-time`, `formatVnDate`). Test với `TZ=UTC` và `TZ=America/New_York`: ra giờ VN.
2. **R-23 (B-152):** Thanh toán web 375 lệch Mini: ô ghi chú khác chữ và có bộ đếm, ô VAT nằm bên trái, câu điều khoản nằm ở thanh đáy, câu Điểm Xanh khác chữ. Làm theo Mini (chữ, vị trí), riêng câu đồng ý giữ sát nút Đặt hàng như web. Soát lại cả trang thanh toán 375 hai nền sau đợt 7–8 (có thể một phần đã khớp); 1280 giữ bố cục hai cột hiện có. Ảnh trước/sau `checkout` persona `returning` và `new`, Mini và web 375 + web 1280.
3. **R-132 (phiên điều phối chốt thay chủ: bỏ trên web cho giống Mini):** trang "Xếp hạng" cộng đồng trên web → chuyển hướng 308 về trang cộng đồng tương ứng; bỏ mọi liên kết tới nó; cập nhật `packages/app-core/src/route-map.json`; `pnpm lint:parity` xanh. Không xoá API leaderboard (Mini bản cũ có thể gọi).
Không sửa `checkout-rules.ts` (gói chu), PDP (gói pdp).

## Gói flaky (chỉ test, trừ khi chứng minh được lỗi app)
1. `apps/e2e/tests/bundles-cls.miniapp.spec.ts`: đỏ khi máy tải nặng, cả ở base 173de56b3, mỗi lần một ca. Tìm gốc bằng CPU chậm (CDP `Emulation.setCPUThrottlingRate` 6) chạy nhiều lần; xác định lỗi test (đo sớm, chờ sai mốc) hay CLS thật của app. Lỗi test: sửa chờ đúng mốc. CLS thật: báo lại, sửa nếu nằm trong phạm vi Combo & Mua kèm và nhỏ. Đích: 10/10 xanh ở CPU chậm 6 lần; trước sửa ghi số đỏ.
2. `apps/web/src/components/add-to-cart.spec.tsx` quanh dòng 953 (bảng phân loại nạp lười `next/dynamic`, `sheetReady` chờ 40 nhịp `flush()`): đỏ một lần trên CI #129. Tìm gốc (nạp động chậm hơn số nhịp; timer rò giữa các ca), sửa bằng nạp sẵn mô-đun trong `beforeAll` hoặc `findBy…` có timeout, như các lần sửa trước (`docs/2026-10-28-review/PROGRESS.md` mốc 21:45, 23:07, 01:47). Chứng minh: làm chậm import giả (300 ms) thì bản cũ đỏ, bản mới xanh 20/20.
3. Test chập chờn khác trong CI 7 ngày gần đây: `gh run list --branch main --limit 40 --json conclusion,databaseId,headSha,name` rồi `gh run view <id> --log-failed` cho lượt đỏ; ca chập chờn (đỏ rồi xanh khi chạy lại cùng SHA) ở test Mini/web khách thì sửa theo cùng cách. Ghi danh sách.

---

# Đợt 2 (từ audit 03/11 17:55)

Luật chung ở trên vẫn áp dụng (gốc 52fd5cd65, môi trường, kiểm, báo cáo). Chi tiết từng phát hiện (bằng chứng, đề xuất, ghi chú người xác minh): `docs/2026-11-03-golive/audit/triage.json` (tìm theo `id`) và báo cáo vùng `docs/2026-11-03-golive/audit/<vùng>.md`. Đọc ghi chú `note` của người xác minh: nó sửa lại phạm vi hoặc mức khi auditor nói quá hay nói thiếu.

Máy đang chạy khoảng 10 worker cùng lúc (tải 60–170). Chạy bộ test nặng (jest API toàn bộ, vitest Mini, next build, Playwright) lần lượt, không song song trong gói. Test timeout thì `top -l 1 -n 0` rồi chạy lại riêng ca đó trước khi nghi mã.

Vùng khác đang sửa song song (không đụng):
- Đợt 1: `gl/1103-{auth,chu,pdp,ctv,parity,flaky}` (Mini auth, wishlist-heart, PDP hai app, checkout và chữ checkout, `order-actions`, trình dựng gian hàng CTV, trang thanh toán web, test chập chờn).
- Phiên db, đợt sửa 2: `order-returns.service.ts`, `merchant.service.ts` + module storefront API, `apps/miniapp/src/pages/dealer.tsx`, `bank-transfer.service.ts`, `flash-slots.ts`, `product-admin.service.ts`, `product-category-admin.service.ts`, `campaign-admin-rules.ts`, `apps/miniapp/src/pages/game.tsx`, `apps/web/src/components/recycle/recycle-desk.tsx`, CORS ở `bootstrap.ts`, `catalog.service.ts` hàm `setSoldExternal`, `notifications.processor.ts`, `notifications.service.ts`, `remarketing.service.ts`, `ctv-dashboard.ts`.
Trùng file thì chỉ sửa đúng chỗ của mình, giữ diff nhỏ để gộp dễ.

| Gói | Lane (API/web/Mini) | Khối cổng e2e |
|---|---|---|
| sec | không cần lane | 3960 |
| search | 5 (3251/3252/3253), đang chạy mã main: tắt rồi bật lại từ worktree gói (`lane-down.sh 5`, `lane-up.sh 5 --web`), DB `tubutree_uat_l5` giữ nguyên | 3970 |
| home | 6 (3261/3262/3263), như trên với lane 6 | 3980 |
| webperf | không cần lane | 3990 |

## Gói sec (API: chống sập và gia cố đầu vào). Đường bảo mật: review 2 lượt APPROVE.
- BAOMAT-01 (P0): một request ẩn danh khoảng 1 MB nhiều khoá làm đứng event loop (`bootstrap.ts:123` json 10mb cho mọi route; `validation-pipe.ts` transform chạy `plainToInstance` trước mọi trần mảng). Sửa: (1) hạ giới hạn thân JSON/urlencoded mặc định (đề xuất 100–256 KB, chọn theo số liệu), chỉ nới cho route nhận ảnh base64. Kiểm kê đủ route nhận ảnh hay thân lớn bằng grep (`uploaded-image`, data URL, `PUBLIC_CONTENT_MAX_DATA_URL_LENGTH`, `@Body` có mảng ảnh, webhook Pancake/Zalo/ngân hàng, `/api/events`, route admin upload, đổi rác có ảnh), ghi bảng route → giới hạn vào báo cáo; không làm hỏng route nào (kể cả admin và webhook của vùng db). (2) Chặn thân quá nhiều khoá/phần tử/tầng lồng bằng bước O(n) trước ValidationPipe. Ngưỡng chọn trên mức hợp lệ lớn nhất (đọc `@ArrayMaxSize` của DTO, payload webhook mẫu trong test). Trả 413 hoặc 400 với câu lỗi chung theo giọng đợt 8. (3) Nếu repo có cấu hình vhost Apache (`ops/`, `docs/launch/`), thêm `LimitRequestBody` hợp lý cho `/api` và ghi vào runbook. Bằng chứng: jest đỏ với mã cũ; đo lại bằng `docs/2026-11-03-golive/audit/baomat-probes/dos*.mjs` hay `bench.cjs` trước/sau (thời gian một request xấu, `/health` vẫn trả nhanh).
- BAOMAT-03 + KHAMPHA-03 (P2): ký tự NUL (`%00` ở URL/query, `\u0000` trong body) gây 500. Sửa một chỗ chung (middleware/pipe) trả 400, kèm jest cho query, param, body.
- BAOMAT-08 (P3): phản hồi có dữ liệu cá nhân (`/me`, `/orders`, `/me/addresses`, `/cart`, `/me/wallet`, `/group-buy`, `/products/for-you`) thiếu `Cache-Control: private, no-store`. Gắn chung cho request có xác thực (interceptor), không phá route công khai đang có cache (`/home`, `/flash-sales/upcoming`, catalog công khai).
- BAOMAT-02 (P1): guest đăng bài cộng đồng kèm 6 ảnh 600 KB, tạo nhiều guest để vượt throttle; ghi đầy DB và đĩa. Sửa KHÔNG đổi luật ai được đăng: kiểm chữ ký tệp PNG/JPEG/WebP khi nhận (giải mã base64 phần đầu); trần số bài đang chờ duyệt có ảnh cho mỗi khách; trần tổng dung lượng ảnh bài chờ duyệt của toàn bộ khách guest (vượt thì từ chối bài kèm ảnh của guest với câu lịch sự, bài chữ vẫn đăng được). Chọn số theo dữ liệu, ghi lý do. Việc "chỉ khách đăng nhập Zalo/SĐT mới được đăng ảnh" là luật sản phẩm: không làm, ghi vào báo cáo.
- BAOMAT-05 (P3): `PATCH /me` `avatarUrl` nhận mọi host; giới hạn theo spec (Cloudinary, Zalo), kiểm ảnh hiện có không bị chặn khi đọc.
- BAOMAT-07 (P3): `POST /me/addresses` không trần số địa chỉ; đặt trần (vd 20) với câu lỗi rõ, Mini/web hiện câu đó.
- BAOMAT-09 (P3): `fullName` nhận `<` `>`; từ chối như tên người nhận ở địa chỉ (dùng chung validator).
- BAOMAT-10 (P3): `SaveTemplateDto` thiếu `MaxLength` cho `name` và `ArrayMaxSize` cho `items`.
- GIOHANG-10 (P3): `InvoiceRequestDto` không kiểm định dạng mã số thuế (10 hoặc 10-3 số) và độ dài các trường; client Mini/web hiện lỗi gần ô nhập như hiện có.

## Gói search (Tìm kiếm: API catalog + màn tìm Mini/web)
- KHAMPHA-02 (P1): từ khoá nhiều từ phải liền và đúng thứ tự mới ra kết quả ('nước chén', 'Fuwa3e nước' ra 0). Sửa `search-text.ts` + `textMatchSql` ở `catalog.service.ts` (chỉ vùng ~71-78, phiên db sửa `setSoldExternal` cùng file): mỗi từ một điều kiện `LIKE %từ%` nối AND (trần số từ), xếp hạng: khớp cả cụm hay khớp đầu tên trước, rồi nổi bật, rồi bán chạy; nhãn 'Liên quan' phải đúng nghĩa. Gợi ý `/search/suggest` theo cùng luật. Giữ trần 100 ký tự, thoát `%`/`_`, giữ không dấu như hiện tại. Kiểm chỉ số đang dùng (`EXPLAIN` trên lane) và số câu SQL không tăng. Jest đỏ trước.
- KHAMPHA-05 (P3): từ khoá dài không khoảng trắng tràn tiêu đề "Không tìm thấy" (Mini, kiểm web).
- KHAMPHA-07 (P3): cắt từ khoá theo điểm mã (không cắt đôi emoji), `maxLength` 100 cho ô tìm (Mini, kiểm web).
- KHAMPHA-14 (P3): `minPrice > maxPrice` qua URL: chuẩn hoá (đổi chỗ hoặc bỏ) ở Mini và web cho khớp nhau.
- KHAMPHA-15 (P3): lịch sử tìm gần đây dùng chung khoá cho mọi tài khoản trên máy: tách theo người dùng hoặc xoá khi đăng xuất/đổi tài khoản (Mini, kiểm web). Không đụng `apps/miniapp/src/store/auth.ts` (gói auth đang sửa); dùng hook dọn khi đăng xuất có sẵn nếu có, không có thì tách khoá theo user.

## Gói home (Trang chủ, khung chung; Mini + web 375/1280)
- KHAMPHA-01 (P1): Trang chủ Mini mất vị trí cuộn khi vào PDP/danh mục rồi quay lại; dùng `useScrollRestoration` như `browse.tsx`. Kiểm và sửa cả web 375 nếu cũng mất.
- KHAMPHA-04 (P2): lưới lối tắt đổi chỗ khi `/config/public` về; dựng khung giữ chỗ tới khi `isLoaded` hoặc dựng đúng ngay từ khung đầu. Kiểm web.
- HIEUNANG-03 (P2): dải "Việc cần làm" chèn vào Trang chủ không giữ chỗ khi máy chưa nhớ số dòng (Mini + web).
- HIEUNANG-04 (P2): web 375, chân trang gọn hiện dưới khung chờ rồi bị đẩy đi (CLS 0,2–0,34 ở `/vuon-xanh`, `/doi-rac`, `/tai-khoan/diem-xanh`, `/uu-dai`, `/tai-khoan/thong-bao`, `/tai-khoan`). Chỉ đổi khung/chân trang dùng chung, không đổi nội dung màn của vùng db. Đo CLS trước/sau.
- KHAMPHA-06 (P3): khối Quà khách mới cắt câu lợi ích; đổi bố cục cho đọc trọn câu (không đổi chữ luật giá).
- KHAMPHA-08 (P3): placeholder ô tìm thanh đầu bị cắt giữa câu; rút chữ cho vừa (Mini + web, chữ ở chỗ khai chữ hiện có).
- KHAMPHA-09 (P3): tên bậc dài tràn thẻ thành viên dưới nút Điểm danh.
- KHAMPHA-10 (P3): Trang chủ lỗi 500 có ba nút Thử lại cùng việc; giữ một, hàng chào không cắt chữ.
- KHAMPHA-13 (P3): link logo web 375 vùng chạm 20×30 px; nâng lên ≥ 44 px không đổi hình.
- KHAMPHA-16 (UNCERTAIN): axe `landmark-unique` ở `/san-pham` web; tái hiện, có thật thì sửa (tên riêng cho từng `role=search`).

## Gói webperf (web: tải trang)
- HIEUNANG-01 (P2): thêm `"sideEffects": ["*.css", "**/*.css"]` vào `apps/web/package.json` (hoặc cách tương đương có số). Grep chứng minh không có module chạy hiệu ứng khi import (dayjs.extend, đăng ký i18n, polyfill, `import './x'` không lấy tên). So bảng `next build` trước/sau (First Load từng trang) ghi vào báo cáo. Chạy vitest web toàn bộ và Playwright web các màn chính (`web-gate.sh`).
- HIEUNANG-02 (P2): route `[slug]` khai `revalidate` nhưng không ISR (dựng mỗi lượt, `no-store`). Thêm `generateStaticParams` trả `[]` cho `san-pham/[slug]`, `brand/[slug]`, `chinh-sach/[loai]`, `s/[slug]`, `mua-chung/[id]`, `chien-dich/[slug]`, `hoc-vien/[courseId]`, chỉ trang nào cây SSR không đọc cookies/headers/searchParams (chứng minh bằng `next build` đánh ● và header `s-maxage` khi `next start`). Ghi rõ 404 của slug lạ cũng bị cache bao lâu; nếu giới hạn được (độ dài slug, `dynamicParams`) thì làm. Không làm hỏng dữ liệu cá nhân hoá trên PDP (giá Giờ vàng, suất, tim, giỏ phải lấy ở client như hiện tại).
- HIEUNANG-10 (P3): web gọi `/config/public` hai lần ở `/tai-khoan`, `/ho-tro/chat`, `/tai-khoan/diem-xanh`; dùng chung một query.
- Không đổi Mini.

---

# Quyết định điều phối 03/11 23:40 (lượt sửa thứ 3, áp cho worker và reviewer)
- Ngoại lệ entry Mini App: gói auth được tăng tối đa +0,5 KB gzip (mã giữ đời phiên đăng nhập phải ở store auth trong entry; đúng của đường đăng nhập quan trọng hơn). Gói home được tăng tối đa +0,2 KB gzip. Vượt mức này vẫn là P2. Các gói khác: entry không được tăng.
- Ảnh trước/sau 375/1280 và `before-after.mjs`: phiên điều phối chụp tập trung trên một lane sau khi merge. Thiếu ảnh KHÔNG còn là P2 chặn gói. Vẫn bắt buộc: test (vitest, jest, Playwright spec liên quan dùng mock), đo bundle khi đổi Mini, số First Load web khi đổi web.
- HIEUNANG-03, ca máy mới chưa nhớ số dòng và `/me/summary` còn đang chờ: hoãn vào backlog. Giữ chỗ trống 64px cho mọi khách làm hỏng Trang chủ của đa số khách không có việc. Gói home chỉ cần giữ chỗ đúng khi máy đã nhớ số dòng, và không làm xấu ca chưa nhớ.
- Lệch Mini/web 375 vẫn là P2 (luật của chủ: web khổ điện thoại phải giống Mini cả giao diện).
