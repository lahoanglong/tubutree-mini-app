# hieunang đợt D

mergeable=False

## Sửa D1 (head 7f2f927fa)

Nhánh review/1028-hieunang, head 7f2f927fa (3 commit mới trên fe5d62667, chưa push). Lane 3 đã dừng (lane-down 3, không --drop); không còn tiến trình ở cổng 3231–3238/3780–3789. Không chạy run-all.mjs. Lane 9 không dùng.

VIỆC TỪNG MỤC
(1) P3 prune: ĐÃ LÀM, 237e87cdc. writeCache khi file mới không vừa trần gọi prune(true) (xuống 80%) rồi ghi. Test đi qua svc.get: cache 1.048.560 B/1 MB, ảnh mới không vừa -> f0 bị xoá, ảnh ghi, tổng <= trần. Test thấy đỏ trước khi sửa.
(2) P3 ownMissLimited: ĐÃ LÀM, 237e87cdc. Đếm lượt sai ?v= theo IP (controller truyền req.ip; bảng tối đa 5000 IP), chỉ IP quá 30 lần/phút bị 503; IP khác và ảnh hợp lệ không bị chặn, ảnh hợp lệ không tính vào hạn mức. 3 test (đỏ rồi xanh). Giới hạn còn lại: IP đã bị chặn thì ảnh own chưa cache của IP đó cũng 503 trong phút đó (không biết ?v= đúng hay sai nếu không đọc DB).
(3) P3 OPENED_FROM_PARTNER_LINK: ĐÃ LÀM, 3183610a4. Tính ở app.tsx (entry), truyền prop openedFromPartnerLink vào OnboardingGate; thêm ca test onboarding.spec và app-gates.spec.
(4) P3 mỗi gate một SilentBoundary: ĐÃ LÀM, 3183610a4 (+ app-gates.spec kiểm cấu trúc, sửa kiểu ở 7f2f927fa).
(5) P3 nút lùi chi tiết đơn khi khung chờ /tai-khoan: KHÔNG làm (loading.tsx chung nhóm /tai-khoan không biết trang con; sửa cần gợi ý theo pathname hoặc loading riêng cho don-hang/[code], loading riêng có nguy cơ 404 thành 200 như 76dbe6bc5). GHI BACKLOG.
(6) R-82 và R-83: KHÔNG làm, GHI BACKLOG, số đo lane 3 bên dưới.
(7) Ảnh R-5: ĐÃ LÀM. Gán 44 SP lane 3 (chỉ DB lane 3) bằng 75 URL thumbnail pancake đọc từ GET công khai https://api.tubutree.com/api/products. Lane 5 không có ảnh SP (seed trống) nên đo TRƯỚC trên lane 3: chặn /img bằng Playwright route, tải thẳng ảnh gốc u= (đúng cái main tải), đếm byte; SAU = byte thật phản hồi /api/img (webp). Mini App 375x812 DPR2, persona returning, cuộn hết trang:
  home: trước 36 ảnh 20.587 KB -> sau 37 ảnh 1.208 KB (-94%)
  browse-category (cat-cleaning): trước 6 ảnh 3.585 KB -> sau 6 ảnh 162 KB (-95%)
  Ảnh trước/sau (cột "trước" là lane 5 không có ảnh SP, cột "sau" có ảnh): home, browse-category, product-slug, cart (mini375 + web375) ở /Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens-hieunang/ (home__returning__ok__s1.png, browse-category__..., product-slug__..., cart__...). Đã xem từng ảnh: ảnh SP hiện đúng, web 375 giống Mini App.
(8) /cart SQL lane 3 (prisma-query-log, API chạy preload ở 3231): lần 1 = 10, lần 2 = 8 (0 ghi) -> đạt <=8 ở lần 2.
Đo thêm /home/me: 18 lần 1, 17 lần 2 (đích <=12, chưa đạt); /products?sort=best_seller 2/1; /me 2/1.

KIỂM THẬT
- tsc --noEmit: web, miniapp, app-core, e2e, api (pnpm typecheck): sạch. eslint các file đã sửa (miniapp + api): sạch.
- jest api: 486 suite, 11273 test pass (image-resize: 51 pass, gồm 5 test mới).
- vitest: app-core 923/923; miniapp 4876/4876 (cả TZ=UTC); web 7440/7440.
- Playwright Mini App toàn bộ (E2E_SCOPE=miniapp, cổng 3783): 205 passed, 10 skipped, 0 fail.
- lint:parity: xanh (0 mục pending).
- Bundle Mini App (bundle-report --only=miniapp --build-miniapp): entry 701 KB raw / 219 gz (<= 711; trước lượt này 700), tổng raw 1922 KB / gzip 744 (không đổi so với 1922/744 lượt trước; so base vẫn +11 KB như đã giải thích ở lượt trước). `vite build` trần lỗi cấu hình (cần env), nên dùng cờ --build-miniapp của bundle-report.
- Không chạy: web gate và next build (lượt này không đổi mã web; lần trước web gate 354 pass, First Load tăng tối đa +1 KB); race test (không đụng tiền/điểm); docker build Dockerfile API (chưa kiểm). docker-compose PROD không đổi.

GHI BACKLOG
- R-82 /home/me còn 17–18 SQL (đích <=12): cần gộp truy vấn đơn/loyalty/subscriptions trong home.service; đo lane 3 ngày 28/10.
- R-83 khung chờ san-pham và san-pham/[slug] chưa có (loading.tsx làm trang không tồn tại trả 200 thay vì 404, commit 76dbe6bc5): đích "bấm thẻ SP có ngay khung trang" chưa đạt; cần giải pháp khác (ví dụ khung chờ client hoặc streaming giữ 404).
- Nút lùi nổi ở chi tiết đơn khi khung chờ /tai-khoan còn hiện đi về danh sách đơn thay vì /tai-khoan (test e2e web-checkout.web.spec đang đợi data-back-href để né).
- Hạn mức sai ?v= của /img theo IP: IP bị chặn thì ảnh own chưa cache cũng 503 trong phút đó; sau proxy/NAT nhiều khách chung IP có thể bị ảnh hưởng nếu có kẻ spam (cần IP thật từ trust proxy).
- Ngoài mã: tubutree_uat_tpl từng bị lane 9 ghi nhầm (đã dựng lại 14:58 theo người giao); params-l9.json và params-l3.json untracked, không commit (routes.json đã khôi phục).

## Review D1

KẾT LUẬN: chưa merge

[P2] apps/miniapp/src/components/app.tsx:50-51,286-295. The total Mini App bundle is over the assigner's cap. The rule allows "only lazy chunks for new features, at most +5 KB per package". This package adds +11 KB raw against base: 1911 → 1922 KB in the report, and 1920 KB of assets in `www/assets` on disk. The extra is not new-feature code in lazy chunks. It comes from three things. Splitting OnboardingGate and CouponClaimGate (not new features) costs about 4.8 KB of overhead. About 5 KB of new code went into the entry. About 2 KB of lucide icon chunks were split out. This round's report gives no per-chunk numbers. Fix: make both gates eager again. That puts back the 8.5 KB the entry lost, so the entry is about 709.5 KB, still within 711. The split overhead and the icon chunks go away, leaving about +4–6 KB. Then measure each chunk again. Otherwise the owner must grant an exception in writing.

[P3] apps/api/src/modules/catalog/image-resize.service.ts:146-161,165. The limit is now per IP, but once an IP is blocked, valid `/public-image` images from that IP that are not cached yet still get 503 for up to 60 s. Example: under CGNAT (common on Vietnamese mobile networks), many customers share one IP. If someone on it sends 30 wrong `?v=` in a minute, everyone on that IP falls back to the full-size original for a minute. Not every valid request is protected yet. The worker has already listed this under GHI BACKLOG. Fix: before calling `noteOwnMiss`, check the version against an in-memory id→version registry, in the same way as `isRegistered`.

[P3] image-resize.service.ts:116-130,102. The URL registry refreshes every 5 minutes. Images added or replaced on a product within the last ≤5 minutes get 404 from /img, and the client falls back to the original (heavy). That may explain why home shows 37 images "after" against 36 "before", which the report does not explain. Fix: when a URL is not in the registry and the last load was more than about 30 s ago, reload once more (with a gap guard so it does not run per request). Or clear the registry when a product or brand image is saved.

[P3] apps/miniapp/src/components/app-gates.spec.ts:5-21. The test reads `app.tsx` as text and uses a regex. It passes or fails on how the code is formatted, not on behaviour. A harmless reformat breaks it. And if one gate's chunk fails, nothing checks that the other gate still renders. Fix: render MyApp, or a small wrapper, with a mocked lazy import that rejects for OnboardingGate. Then assert that CouponClaimGate still mounts.

[P3] docs/2026-10-28-review/screens-hieunang/{home,browse-category,product-slug,cart}__returning__ok__s1.png. The "before" columns (Mini and Web) come from lane 5 and show only the leaf placeholder. There is still no before/after comparison of R-5 image sharpness with real images on both sides; Review 3 asked for this. The byte numbers are valid (route-block on lane 3), but nothing shows that the 160/320 webp images are not blurrier than the originals. Fix: take the "before" shots on lane 3 with /img blocked, the same way the bytes were measured.

[P3] .env.production.example:78-81 and apps/api/Dockerfile:39-41. By default the cache goes to /tmp in the container's writable layer, up to 512 MB. The Vietnix VPS has run out of disk before (B-155). Fix: set IMAGE_CACHE_MAX_MB lower (for example 200) in the deploy runbook, or add a disk check to the runbook. Do not touch the PROD compose file.

GHI BACKLOG: the five items the worker listed are accepted (R-82 /home/me at 17–18 SQL, R-83 loading skeleton for san-pham, the back button on order detail, the per-IP/NAT limit, and the template DB).

What I checked:
- The prune(true) fix in writeCache is correct. The test goes through `get`, and the numbers work out: 1,048,560 B already in the cache, cut down to 80% so f0 is removed, then the new file is written.
- `trust proxy` is 1 (apps/api/src/bootstrap.ts:120), so `req.ip` is the client's real IP.
- `OPENED_FROM_PARTNER_LINK` is computed in the entry. The onboarding test would fail if the prop were ignored, so it is not a fake test.
- I ran jest image-resize: 51/51 pass. I ran vitest for onboarding.spec and app-gates.spec on Node 22: 18/18 pass.
- The entry file `index.fqs2p8vx.module.js` is 717,780 B, which is 701 KB, within 711.
- No docker-compose file or migration changed.

## Sửa D2 (head review/1028-hieunang, 1723b1377: P2 bundle sửa một phần (entry 709 KB trong trần, tổng +7 KB vẫn quá +5), 3/5 P3 sửa, chưa chạy Playwright/ảnh)

Nhánh review/1028-hieunang, commit mới 1723b1377 (trên 7f2f927fa), không push, không bật lane.

[P2 bundle] Làm khác đề xuất reviewer vì làm đúng đề xuất thì vượt trần entry.
- OnboardingGate nạp thẳng ở entry. CouponClaimGate vẫn lazy.
- Lý do: cả hai nạp thẳng cho entry 730512 B = 713 KB, vượt 711. Chỉ CouponClaimGate lazy thì entry 709 KB (index.BvK_DihN). Ước tính 709,5 của reviewer lệch 3,5 KB.
- Mã ?claim= đã lưu ở entry nên chunk cổng nhận mã lỗi cũng không mất mã. Mỗi cổng vẫn một SilentBoundary.
- Số đo (build bằng bundle-report, tổng raw KB), chunk-diff với www của review-1028 build lúc 15:07:
  - Base: entry 711, tổng 1911,3.
  - Bản cũ (hai cổng lazy): tổng 1922.
  - Bản mới: tổng 1918,6 (+7,3). Cả bản hai cổng nạp thẳng cũng +7 (1918).
  - Chunk mới coupon-claim-gate +4,8 KB; entry +1,3 KB (index.module.js 741,6 -> 742,9, tên chunk đã bỏ mã băm); còn khoảng 1,2 KB ở chunk khác, không tách ra.
- Tổng vẫn +7,3 > trần +5. Phần tăng chủ yếu là mã mới nằm ở entry (RouteShell, skeleton, image-src, prefetch), không lazy được. CẦN CHỦ QUYẾT: chấp nhận ngoại lệ ~+2,3 KB, hoặc cắt tính năng.
- Chưa chạy lại bảng bundle web (không đổi web).

[P3 sửa]
- Registry /img: URL chưa có trong danh sách và lần nạp cuối cách >= 30 s thì nạp lại một lần (image-resize.service.ts, hằng REGISTRY_MISS_RELOAD_MS). Test viết trước, thấy đỏ rồi xanh. Ca 1.200 URL lạ vẫn đúng một truy vấn.
- app-gates.spec.ts đọc app.tsx bằng regex: đã xoá. SilentBoundary đã có test hành vi ở route-shell.spec.tsx; cờ OPENED_FROM_PARTNER_LINK có onboarding.spec.tsx. Không viết test "chunk reject, cổng kia vẫn mount" vì cổng chào không còn lazy.
- .env.production.example: ví dụ IMAGE_CACHE_MAX_MB=200 kèm dòng nhắc kiểm df -h. Không đụng compose PROD hay Dockerfile.

[P3 không sửa]
- Ảnh trước/sau R-5 có ảnh thật hai phía (chặn /img): cần bật lane và chụp lại, chưa làm.
- Nhánh /img theo IP trả 503 cho ảnh hợp lệ chưa cache khi IP bị chặn (CGNAT): cần registry id->version trong bộ nhớ hoặc đọc DB mỗi request. Bỏ vì không rẻ.

GHI BACKLOG
- R-82: /home/me còn 17-18 truy vấn SQL.
- R-83: skeleton loading cho san-pham.
- Nút Quay lại ở chi tiết đơn.
- Hạn mức sai ?v= theo IP/NAT: chỉ chặn IP gửi sai, nhưng ảnh hợp lệ chưa cache của IP đó vẫn 503 tối đa 60 s (cần registry id->version).
- DB mẫu tubutree_uat_tpl.
- Home hiện 37 ảnh sau so với 36 trước: chưa giải thích (có thể liên quan registry 5 phút, đã sửa một phần).

Kiểm đã chạy (Node 22)
- jest image-resize: 2 suite, 52/52 pass (51 cũ + 1 mới).
- apps/api pnpm typecheck: sạch.
- apps/miniapp tsc --noEmit: sạch. eslint app.tsx: sạch.
- vitest miniapp toàn bộ: 314 file, 4874/4874 pass. Chạy lại với TZ=UTC khi còn bản nạp thẳng cả hai cổng: 4874/4874 (không chạy lại TZ=UTC sau khi CouponClaimGate trở lại lazy).
- pnpm lint:parity: xanh, 0 mục pending.

Chưa chạy
- Playwright Mini App toàn bộ, vitest app-core và web, jest API toàn bộ (chỉ image-resize), race test. Không có e2e riêng cho cổng chào/nhận mã.
- Ảnh trước/sau, perf run-all (người giao đo).

File chính: apps/miniapp/src/components/app.tsx, apps/api/src/modules/catalog/image-resize.service.ts (và .spec.ts), .env.production.example, apps/miniapp/src/components/app-gates.spec.ts (xoá). Cả ba nằm trong /Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028-hieunang/.

## Review D2

KẾT LUẬN: chưa merge

[P2] apps/miniapp/src/components/app.tsx:51-52,286-295. The Mini App total is still over the cap, so this needs the owner's decision. Bytes on disk in `www/assets`: base (review-1028, 15:07) is 1,955,819 B and this branch (15:29) is 1,963,318 B, so +7.3 KB against the +5 KB cap. The rule only allows growth in lazy chunks for new features, but most of this growth is new code in the entry (RouteShell, skeleton, image-src).
- Entry index.BvK_DihN is 726,228 B (709.2 KB), within 711. Base was 728,226 B, so the entry actually went down 2.0 KB.
- The new chunks are coupon-claim-gate (4,891 B), index.DZVZfvkW (3,308 B, zmp-ui Box split out of the entry), card-gift-note (242 B), plus ai-advisor +418 B and product-detail +165 B.
- Fix: the owner grants a written exception of about +2.3 KB, or the entry code is cut back. Without one of these, the package cannot merge.

[P3] Worker report, bundle section. The per-chunk numbers are wrong or missing.
- "Entry +1.3 KB" is the sum of all `index.*` chunks. The real entry fell 2.0 KB.
- The 3.3 KB index.DZVZfvkW chunk, card-gift-note, ai-advisor +418 B and product-detail +165 B are not listed.
- The rule says to record every chunk that grew. Fix: add these numbers to the report so the owner decides on correct figures.

[P3] apps/api/src/modules/catalog/image-resize.service.ts:120-121. Any unknown URL can trigger a full registry reload: 7 UNION queries over all of products, brands and waste_*.
- Random URLs can force this at most once every 30 s, about 2,880 reloads a day. The cost is bounded but it scales with catalog size.
- Fix (optional): rate-limit the reloads per IP, or rely on invalidating the registry when a product or brand image is saved instead of reloading on a miss.

[P3] docs/2026-10-28-review/screens-hieunang/*.png. Item (7) is still not done: the "before" shots (lane 5) show only the leaf placeholder.
- I looked at product-slug: the 1x/2x "after" image is sharp.
- There is still no before/after shot with real images on both sides (lane 3 with /img blocked) for home or browse-category.
- Fix: retake the "before" shots on lane 3 with /img turned off.

GHI BACKLOG (accepted as the worker listed them): R-82 /home/me at 17–18 SQL; R-83 loading skeleton for san-pham; the back button on order detail; 503 for valid uncached images from an IP blocked for wrong `?v=` (CGNAT); the template DB; home showing 37 vs 36 images.

What I checked:
- Previous P3 on the registry: fixed. `isRegistered` reloads once when the URL is unknown and the last load was ≥30 s ago. The new test goes through `get` and checks the query count at 10 s (1) and 31 s (2). jest image-resize: 52/52 pass (Node 20).
- Previous P3 on `app-gates.spec`: the file is deleted. vitest onboarding, route-shell and coupon-claim-gate: 39/39 pass on Node 22.23.3.
- Previous P3 on the cache size: .env.production.example:80-81 now sets 200 MB and reminds to run `df -h`. No compose file, Dockerfile, migration or Prisma schema changed in 1384ff38..HEAD.
- OnboardingGate is loaded eagerly as in base, and each gate has its own SilentBoundary. `?claim=` is saved in the entry (app.tsx:18). CouponClaimGate does not depend on OnboardingGate's state.

Not run: Playwright, the full jest API suite, vitest for app-core and web, and anything on lane 3. I also could not check the /cart SQL count on lane 3: it is in neither this report nor hieunang-c.md.
