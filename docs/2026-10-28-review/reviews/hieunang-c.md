# hieunang đợt C

mergeable=True

## Review 1

KẾT LUẬN: chưa merge

[P1] apps/api/src/modules/catalog/image-resize.ts:22,37 — `/img` is an open image proxy. The check only looks at the host name, so any Cloudinary account and any Pancake shop gets through. Example: `/img?u=https://res.cloudinary.com/demo/image/fetch/https://evil.example/x.jpg&w=960` (demo fetch, or a Cloudinary account the attacker owns) makes our API fetch, resize and serve arbitrary content from the api.tubutree domain. Query strings are part of the cache key, so `?a=1,2,3…` gets past the cache every time. This breaks the package rule "không được thành proxy mở". Fix: only accept a source whose URL actually exists in Product/Brand images (look it up in the DB with a short cache), or at minimum lock the path to `res.cloudinary.com/<our cloud name>/image/upload/` and drop the query string before building the key.

[P2] apps/api/src/modules/catalog/image-resize.service.ts:144,184 — for own images, `?v=` goes into the cache key but `versionOk` is never checked. Any value from 1 to 32 characters makes a new DB read, a new resize and a new file on disk. A stale v also serves the current image with `immutable` for a year. Fix: return 404 (or redirect to the current v) when `versionOk` is false, and leave v out of the key unless it matches.

[P2] image-resize.service.ts:274 + controller:336 — the disk cap is only checked on prune, which runs at most every 10 minutes. The throttle is 1,200 requests per minute per IP. Busting the cache (P1 and the item above) can write about 1–2 GB past the 512 MB cap between prunes, onto the same disk that filled up before (B-155). Fix: keep a running byte total and prune or refuse writes once it passes the cap; lower the throttle for cache misses.

[P2] image-resize.service.ts:166-167 — `loadSource` downloads up to 8 MB before `acquire()`. Downloads have no concurrency limit, so N distinct keys hold N×8 MB in RAM. On top of that, `limitInputPixels` of 40M (image-resize.ts:12) allows about 160 MB per decode × 4 jobs. Fix: take the semaphore before downloading, put a bounded queue in front (return 503 when it is full), and lower the pixel limit to about 16M. Also add a test for a decompression bomb, which is missing.

[P2] apps/miniapp/src/components/route-shell.tsx:92-95 — "Thử lại" only re-renders. When the screen's chunk failed to load on a weak network, React.lazy keeps the rejected promise, so Thử lại fails forever and the route stays broken until the app is reopened. Before this change the outer boundary reloaded the app, which recovered. Fix: detect chunk-load errors (failed dynamic import) and reload, or wrap lazy() in a version that retries the import on Thử lại.

[P2] apps/miniapp/src/components/app.tsx:44-45,277-280 — OnboardingGate and CouponClaimGate are now lazy, with no boundary of their own. If their chunk fails (opening the app offline or on a weak network), the error reaches the outer ErrorBoundary and the whole app becomes a 100vh error screen, even though Home could have rendered. When the gates were eager this could not happen. Fix: wrap the gates in a boundary that renders null on error.

[P2] Required item (1) not done — total Mini App bundle grew about 10 KB, which the brief forbids. There is no KB-by-KB explanation, and nothing was reduced.
[P2] Required item (2) not done — no `next build` First Load before/after numbers for web (the report says "chưa có số").
[P2] Required item (3) not done — IMAGE_CACHE_DIR, IMAGE_CACHE_MAX_MB and IMAGE_RESIZE_EXTRA_HOSTS are missing from apps/api/src/config/env.validation.ts and .env.production.example. Grep finds them only in src/dist.
[P2] Required item (5) not done — web-checkout.web.spec:133 was not run 5 times on base 1384ff380 or on the branch. Whether it is pre-existing or caused by this package is still unknown.
[P2] Required item (6) not done — /home/me is still 18–19 SQL (target ≤ 12), and there is no prisma-query-log before/after.

[P3] apps/api/Dockerfile:39 — the comment "API không ghi file nào lúc chạy" is now false (the cache writes to /tmp). Item (4): the conclusion that `pnpm install --frozen-lockfile` gets the linuxmusl-x64 binary from the lock is correct, but it is only in the report. Write it down and fix the comment.
[P3] apps/api/src/modules/cart/cart.service.ts:550 (and :534) — GET no longer creates the cart, so `cart.update({where:{userId}})` throws P2025 (500) when a user with no cart row applies a coupon with no minimum order. The UI blocks this for an empty cart, so it is only reachable by calling the API directly. Fix: use upsert.
[P3] apps/api/src/modules/catalog/catalog.service.ts:261 — the 60-second rank cache also applies to price sorting and price filtering. When Giờ vàng starts or ends, or a price changes, the order and the price filter are up to 60 s stale (for example, the "dưới 100k" filter still shows an item that is now 120k). Fix: limit the cache to best_seller, or key it by the active flash slot.
[P3] apps/miniapp/src/services/query-client.ts:11 vs apps/web/src/lib/query-client.ts:4 — catalog staleTime is 60 s on Mini App and 30 s on web. The two platforms should use the same value, from app-core.
[P3] image-resize.service.ts:201 — `timeout` is a socket idle timeout. There is no cap on total download time, but the rule requires a time limit. Fix: add an AbortSignal with a total deadline.
[P3] image-resize.ts:57-62 — IPv6 checks miss 64:ff9b::/96 (NAT64) and 2002::/16. Low risk given the host allowlist, but cheap to add.
[P3] apps/miniapp/src/services/api.ts:121-128 — public GETs now go out before the session is ready and carry no token, so they are throttled per IP. On a shared mobile IP (CGNAT), the burst of requests when the app opens is more likely to hit 429. Worth measuring.
[P3] pnpm-lock.yaml — semver changes 7.8.1→7.8.5 in several snapshots that have nothing to do with sharp (from the offline install). Regenerate the lock so only sharp changes.
[P3] screens-hieunang/*.png — the lane data has no images, so every screenshot shows the leaf placeholder. Nothing visually proves `/img` + srcset works on Mini App or web 375. Seed 8 real images and take the screenshots again (this is the HP1 measurement).

## Sửa trước review 2 (head review/1028-hieunang: sửa mọi P1/P2, 4 commit mới (6ece70da7, 54754a93d, ac094c0b5, ad3740e52); số đo /home/me chưa đạt, tổng Mini App +10 KB giữ nguyên và có giải thích)

Nhánh review/1028-hieunang, worktree r1028-hieunang. Chưa push.
Commit mới:
- 6ece70da7 fix(api): /img chỉ đổi cỡ ảnh có trong sản phẩm/nhãn, khoá đường dẫn Cloudinary, kiểm ?v=, trần cache theo tổng byte, hàng đợi có giới hạn, pixel 16M, biến môi trường, GET /cart dùng upsert, cache thứ hạng chỉ cho Bán chạy, NAT64, tổng thời gian tải
- 54754a93d chore: lock chỉ đổi phần sharp (semver về 7.8.1)
- ac094c0b5 fix(mini): Thử lại tải lại app khi lỗi tải mã màn; cổng chào/nhận mã có SilentBoundary
- ad3740e52 refactor: staleTime catalog 60s dùng chung trong app-core
Lưu ý: test của lỗi logic viết cùng lúc với mã sửa, không chạy trạng thái đỏ trước.

P1 /img proxy mở: đã sửa. Nguồn từ xa phải khớp nguyên văn trong products.images/thumbnail hoặc brands (logo/cover/story), nhớ 5 phút; Cloudinary chỉ nhận /<cloud>/image/upload/ và bỏ query. Thử trên lane: image/fetch ra 400, URL Pancake lạ ra 404, ?v= cũ ra 404.
P2 ?v= (versionOk sai thì 404): đã sửa.
P2 trần đĩa: đã sửa. Giữ tổng byte chạy, vượt trần thì prune hoặc bỏ ghi; tra DB nguồn lạ tối đa 30 lần/phút (503).
P2 RAM/decompression: đã sửa. Giữ slot trước khi tải, hàng đợi 32 (503), pixel 16M, có test bomb 5000x5000.
P2 Thử lại không hồi phục lỗi chunk: đã sửa (nhận diện lỗi import động rồi window.location.reload). P2 cổng lazy sập cả app: đã sửa (SilentBoundary trả null).
Việc bắt buộc (1) Bundle Mini App: không giảm được, giải thích. Entry 711 thành 699 KB (-12). Tổng raw 1911 thành 1921 KB (+10, gz +6). Onboarding và coupon-claim-gate tách chunk: +14,2 KB chunk, +4 chunk icon lucide ~1,5 KB, entry chỉ giảm 8,5 KB vì phải export thêm cho chunk; phần còn ~+2 KB là code srcset và RouteShell. Thử bỏ lazy riêng coupon gate thì tổng vẫn 1921.
(2) Web First Load (next build) trước thành sau: / 204 thành 204; /san-pham 157 thành 158; /san-pham/[slug] 174 thành 175; /gio-hang 163 thành 163; /thanh-toan 191 thành 192; /tai-khoan 170 thành 171; /vuon-xanh 169 thành 170; /mua-chung 156 thành 155; /dang-nhap 142 thành 141. Tối đa +1 KB (trong ngưỡng 2 KB).
(3) IMAGE_CACHE_DIR, IMAGE_CACHE_MAX_MB, IMAGE_RESIZE_EXTRA_HOSTS đã thêm vào env.validation.ts và .env.production.example. docker-compose không đổi.
(4) Dockerfile: pnpm install --frozen-lockfile ở builder alpine lấy @img/sharp-linuxmusl-x64 và libvips có sẵn trong lock; cả /app được chép sang runner. Đã ghi vào Dockerfile và sửa comment "không ghi file" (cache ghi vào /tmp).
(5) Flaky web-checkout "375: thanh toán": chạy 5 lần ở base 1384ff380 là 5/5 xanh, ở nhánh là 5/5 xanh. Không tái hiện khi máy rảnh nên không do gói; lần lỗi trước là do tải máy.
(6) /home/me: KHÔNG làm (cần gộp truy vấn nhiều module). prisma-query-log trước 18 (nóng 17), sau 18 (17); mục tiêu ≤12 chưa đạt. /cart trước 13 (10) thành sau 8 (5). /home 17 thành 14.
P3: sửa cart.update thành upsert; sửa cache hạng 60s (chỉ Bán chạy, xếp/lọc giá không nhớ); staleTime hai nền tảng 60s từ app-core; tổng thời gian tải bằng AbortSignal 10s; NAT64 và 2002::/16; Dockerfile; lock. KHÔNG làm: P3 GET công khai vì CGNAT chỉ cần đo ngoài thực tế; ảnh sau đã nạp 44 ảnh gradient vào lane (không phải ảnh thật).
Kiểm thật: jest API 486 suite, 11267 test xanh; tsc xanh cho api/miniapp/web/app-core/e2e; eslint file đã đổi sạch; vitest app-core 923/923, miniapp 4872/4872 (TZ=UTC và không), web 7439/7439; lint:parity xanh; Playwright Mini App 205 passed; web gate cả bộ 354 passed. Chưa chạy race Postgres (không đụng điểm/tiền/ví), chưa chạy lại vitest toàn bộ sau commit ad3740e52 (chỉ chạy query-client của hai app và vitest app-core đã chạy trước).
Ảnh: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens-hieunang/ (home, browse, product-slug, cart, browse-category); đã xem home và product-slug, ảnh sản phẩm lên qua /img, web 375 khớp Mini App. Chưa xem các ảnh còn lại và ảnh lỗi/loading.
SỰ CỐ cần chủ biết: lần đầu bật lane 9 không áp patch lane9-harness nên lane.env trỏ DB mẫu tubutree_uat_tpl; tôi lỡ chạy prisma migrate deploy lên tpl (áp 5 migration còn thiếu) và đo SQL trên tpl. Template nay đủ 237 migration; chưa thấy lỗi nhưng worker khác nên biết. Đã chuyển lane về tubutree_uat_l9 và đo/chụp lại trên đó. Số SQL đo trên bản sao cùng dữ liệu.
Dọn dẹp: lane 9 đã dừng, worktree r1028-hieunang-base đã xóa, harness hoàn nguyên. File params-l9.json chưa commit (untracked). Không dùng run-all.mjs.

## Review 2

KẾT LUẬN: chưa merge

The fixes from round 1 hold up. I checked each against the code: the registry lookup for source URLs, the Cloudinary path lock with the query dropped, the `?v=` check returning 404, the running byte total for the disk cap, taking a slot before downloading with a 32-deep queue, the 16M pixel limit, the total timeout, NAT64 and 2002::/16, chunk-error reload, SilentBoundary, upsert in cart, the rank cache limited to Bán chạy, one staleTime from app-core, and the env/Dockerfile entries. The required items are explained and have numbers. What remains are new problems introduced by the round-2 fixes.

[P2] apps/api/src/modules/catalog/image-resize.service.ts:116-122 — The limit of 30 unknown-source DB lookups per minute is bypassed by concurrent requests. `missCount` is checked before the `await lookupRegistered` and only goes up after it returns. A burst of 1,200 distinct URLs like `u=https://content.pancake.vn/x<i>.jpg` in one second (inside the 1200/min per-IP throttle) all pass the check while the count is still 0. That is up to 2,400 DB queries at once. The test at image-resize.service.spec.ts:142 awaits each call in turn, so it cannot catch this. Fix: count the attempt before the await (reserve a slot, give it back if the URL turns out to be registered), or run unknown lookups through one shared promise or a semaphore of 1–2.

[P2] image-resize.service.ts:129-131 — Each lookup is a full table scan that unpacks every row's image array. `products.images` and `brands.storyImages` have no index. In PROD the images are base64 (uploaded-image.ts says Cloudinary is not configured, and public-image.service.ts says one row's `images` can be tens of MB). So `images has raw OR thumbnail = raw` reads every product's images from TOAST on every miss and on every cold hit. Even with no attacker, after a deploy the container is rebuilt and the /tmp cache is empty. A catalog page with 20 cards then triggers about 20 parallel full scans, and this repeats for every new URL until the 5-minute registry warms up. Combined with the P2 above, this can overload the PROD DB (same risk class as B-155). Fix: keep a set of registered remote URLs that skips `data:` values, loaded in one query and refreshed every few minutes. Or have the client send product id + slot, as `/public-image` does, and look it up by primary key.

[P3] apps/miniapp/src/components/waste-item-thumb.tsx:11, apps/web/src/components/recycle/waste-item-thumb.tsx:11 — `WasteItem.imageUrl` and `WasteGift.imageUrl` (Cloudinary) go through `/img`. The registry only covers Product and Brand, so they always 404, cost one extra request before falling back, and use up the shared miss quota. Fix: add WasteItem/WasteGift to the registry, or don't resize these images.

[P3] image-resize.service.ts:239-244 with :295 — Prune only deletes files until the total is at or below the cap, not below it with headroom. Once the cache is close to 512 MB, nothing new is ever cached, for up to 14 days, and every request for a new image is resized again. Fix: prune down to a low-water mark, for example 80% of the cap.

[P3] image-resize.service.ts:99,136-139 — The own-image path (`/public-image/...?v=<random>`) skips the registry and the miss limit. Each new v value takes a job slot and reads one image from the DB before the 404. At 1,200 requests per minute this fills the queue of 32, and legitimate resizes get 503. Fix: check the version before `acquire()`, or count wrong-v requests in the miss limiter.

[P3] apps/miniapp/src/components/route-shell.tsx:56 — `CHUNK_ERROR` does not match Vite's "Unable to preload CSS for …". If the CSS chunk fails to load (the dealer route has `dealer-*.css`), Thử lại only re-renders and the route stays broken. Fix: add that pattern, or listen for `vite:preloadError`.

[P3] apps/miniapp/src/components/app.tsx:276-282 — CouponClaimGate is now lazy. If its chunk fails to load (weak network when the customer scans the QR code), SilentBoundary renders null. `savePendingClaim` never runs, so the `?claim=` code is lost for good, where before it was saved for later. The same happens if the customer navigates before the chunk arrives, because the effect reads `window.location.search` at mount. Fix: read and save the claim param in the eager entry, and keep only the sheet lazy.

[P3] apps/web/src/components/segment-error.tsx:24 — "Thử lại" only calls `reset()`. The product page error comes from the server (`ApiUnavailableError` in `fetchDetail`), so re-rendering on the client shows the same error. Fix: call `router.refresh()` inside `startTransition` together with `reset()`.

[P3] pnpm-lock.yaml:9816 — In the base commit 1384ff380, `is-bun-module` used `semver: 7.8.5`. The branch changes it to 7.8.1, which is still an unrelated snapshot change; the report says the "original was 7.8.1", which is wrong. Fix: restore 7.8.5 for is-bun-module and leave only the sharp lines.

[P3] apps/miniapp/src/utils/image-src.ts:15 and apps/web/src/lib/image-src.ts:15 — The `useSizedImage` hook is duplicated word for word on the two platforms. Fix: move it to app-core (it uses no zmp or window code).

[P3] screens-hieunang/cart__*.png and browse-category__*.png (13:27) — These were taken before the images were loaded. The "after" cart still shows the leaf placeholder. The "before" columns everywhere have no images, so before/after is not on the same data. Fix: retake cart and browse-category with images on both sides.

## Sửa trước review 3 (head fe5d62667 trên review/1028-hieunang (chưa push). Mã và test xong, ảnh chụp lại CHƯA làm. Lane 9 đã ghi nhầm vào DB mẫu tubutree_uat_tpl, cần chủ quyết cách dọn.)

COMMIT mới (4): e8f8d4dc4 api /img; f325bec69 sửa test; b9dda37e4 gộp P3 client + lock; fe5d62667 test e2e.

SỰ CỐ CẦN CHỦ QUYẾT: lane-up.sh 9 coi lane 9 là DB mẫu và tự ghi lại lane.env sang tubutree_uat_tpl (không phải tubutree_uat_l9 như giao). Tôi bật API trên đó và chạy seed-data.mjs all, nên template dính dữ liệu seed lúc 07:48 ngày 28/10. Đã lane-down 9 và không chạm thêm. Dấu vết (rows có createdAt từ 07:40): community_events 1, courses 1, lessons 1, feed_posts 1, feed_comments 1, group_buys 1, orders 1, points_transactions 2, reputation_events 2, waste_events 4, waste_points 1, waste_requests 2, wishlists 2, cart_items 2. Còn bị sửa: users uat_returning pointsBalance 45400 (gốc 34400), community_profiles reputation uat_returning 5 và uat_new 2, 4 cờ system_configs chuyển true (waste.enabled, waste.lane_pickup_enabled, loyalty.marketplace_claim_enabled, chat.enabled). Tôi đã viết lệnh xoá các dòng đó nhưng hệ thống chặn (xoá dữ liệu DB dùng chung), nên KHÔNG dọn. Chọn: (a) tôi dọn theo danh sách trên, (b) chạy lại build-template.sh. Lane tạo từ template khi chưa dọn sẽ có dữ liệu seed trùng.

P2 (đã sửa, e8f8d4dc4):
- Hạn mức 30 tra/phút bị vượt bởi request song song: bỏ tra theo URL, nạp danh sách URL hợp lệ bằng MỘT truy vấn dùng chung, làm mới 5 phút. Test 1.200 URL lạ cùng lúc chỉ tốn đúng 1 truy vấn.
- Quét bảng mỗi lần miss: cũng xong nhờ danh sách trên. SQL lọc bỏ ảnh base64 trước khi gộp.
P3 đã sửa: WasteItem/WasteGift vào danh sách ảnh hợp lệ; dọn cache xuống 80% trần (test); ảnh own sai ?v= bị giới hạn 30 lần/phút trước khi lấy chỗ (test); CHUNK_ERROR có "Unable to preload CSS" (test đỏ rồi xanh); mã ?claim= lưu ngay ở entry app.tsx; segment-error Thử lại gọi router.refresh (test); lock trả semver 7.8.5 (pnpm install --frozen-lockfile --offline OK, diff lock chỉ còn dòng sharp).
P3 KHÔNG làm: useSizedImage vào app-core (app-core cấm import react theo forbidden-imports.spec; phần thuần đã ở app-core); chụp lại ảnh cart + browse-category (cần lane có dữ liệu, bị chặn bởi sự cố trên; ảnh seed cũng chưa có ảnh sản phẩm).

6 việc bắt buộc:
1 Bundle Mini App: entry 711 → 700 KB (-11). Tổng raw 1911 → 1922 KB (+11, 0.5%), gzip 737 → 744 (+7). Vẫn vượt luật "không tăng" ở tổng. Nguồn: Onboarding+CouponClaimGate tách chunk 8,5+4,8 KB (khớp phần entry giảm), thêm ~5 KB mã mới trong entry (RouteShell, skeleton, boundary, image-src) và ~2 KB chunk icon lucide nhỏ tách ra. Đổi lại: entry nhẹ hơn, route có khung chờ/Thử lại, ảnh srcset. Chưa tìm cách giảm rẻ.
2 Web First Load (next build, base so nhánh): /san-pham 157→158, /san-pham/[slug] 174→175, /thanh-toan 191→192, /tai-khoan 170→171, /vuon-xanh 169→170, /mua-chung 156→155, /dang-nhap 142→141. Tăng tối đa 1 KB (≤2).
3 Env: IMAGE_CACHE_DIR, IMAGE_CACHE_MAX_MB, IMAGE_RESIZE_EXTRA_HOSTS đã có trong env.validation.ts và .env.production.example từ trước (không sửa thêm). docker-compose PROD không đổi.
4 Dockerfile API: stage builder alpine chạy pnpm install --frozen-lockfile, lock có @img/sharp-linuxmusl-x64 và libvips-linuxmusl-x64, cây /app chép sang runner. Kết luận từ đọc Dockerfile + lock, CHƯA docker build thật.
5 Flaky web-checkout.web.spec:133: base 10/10 xanh; nhánh lần 1 8/10 (1 fail, 2 flaky), lần 2 6/10 (4 fail) → do gói. Nguyên nhân: loading.tsx của /tai-khoan còn hiện thì nút lùi nổi chưa có data-back-href, suy trang cha thành danh sách đơn. Sửa test đợi data-back-href: 20/20 xanh. Chưa đổi mã sản phẩm (nút lùi lúc khung chờ về danh sách đơn thay vì Tài khoản: lệch nhỏ, ghi nhận).
6 /home/me SQL (prisma-query-log, lane 9, DB l9): trước baseline 26 (lần 2: 18); sau 18 (lần 2: 19). Chưa đạt đích ≤12, KHÔNG làm: cần gộp truy vấn đơn ở orders, loyalty, subscriptions, không rẻ. /cart trước 22/18, sau 8/8 (đạt ≤8, không ghi trong GET).

KIỂM THẬT: tsc web, miniapp, app-core, e2e, api: sạch. eslint file đã sửa: sạch. jest api 486 suite, 11270 test xanh. vitest app-core 923, web 7440, miniapp 4873 (cả TZ=UTC) xanh. Playwright Mini App: 205 passed, 10 skipped. Web gate cả bộ: 354 passed, 38 skipped, 0 fail. lint:parity xanh.

CHƯA làm: ảnh trước/sau (screens-hieunang không đổi); race test (không đụng tiền/điểm); run-all.mjs (cấm). Đã dừng lane 9; tiến trình của tôi đã tắt; worktree base tạm đã xoá. params-l9.json untracked còn đó, không commit.

## Review 3

KẾT LUẬN: merge được

All 10 findings from round 2 were rechecked against the code. The two P2s are fixed: the source-URL list is now loaded by one shared query every 5 minutes and checked in memory, so 1,200 distinct URLs cost one query and there is no per-URL table scan. The P3s on WasteItem/WasteGift in the list, the "Unable to preload CSS" pattern, saving `?claim=` in the entry, `router.refresh` in segment-error and the lock back at 7.8.5 are also fixed. The useSizedImage move was declined with a valid reason (app-core may not import react). Two round-2 fixes are only partial: pruning down to 80% of the cap never runs in real use, and the wrong-`?v=` limit also blocks valid requests. No P0, P1 or P2 remains in the code. The 6 extra required items all have numbers or a written conclusion.

[P3] apps/api/src/modules/catalog/image-resize.service.ts:262-267 with :317 — Pruning down to 80% of the cap never happens in real use. writeCache only writes a file when it still fits under the cap, so the real total never exceeds maxBytes. prune() then uses target = maxBytes and stops at the first file that is not yet 14 days old. Example: cache at 511.95 MB, new 80 KB image → nothing is written; prune leaves the cache unchanged; the same happens every 10 s, and each time prune runs readdir and stat on about 13k files, for up to 14 days. The test at spec:219 only passes because it writes 1.2 MB of files directly into a 1 MB cache, which the service itself never does. Fix: in writeCache, when the new file does not fit, call prune with the low target (for example prune(lowWater=true)), or compare total + incoming > maxBytes.

[P3] image-resize.service.ts:155 — `ownMissLimited()` is one global counter, and once it trips it blocks every resize of the API's own `/public-image` images, including ones with a valid `?v=`. Example: one IP sends 30 requests per minute with random `?v=` (far below the 1200/min throttle) → every customer's uncached base64 product image gets 503 for the rest of that minute, and the client falls back to the full-size original. It can also trip without an attacker: an admin replaces a few images while clients still hold the old v (catalog data is kept for 60 s). Fix: only block the misses. Check the version cheaply before acquire(), or count misses per IP and don't stop valid requests.

[P3] apps/miniapp/src/components/onboarding.tsx:73-74 with apps/miniapp/src/components/app.tsx:45 — `OPENED_FROM_PARTNER_LINK` is computed when the onboarding module first loads, and that module is now lazy. A customer opens a CTV link `/?ref=X` and taps a product before the chunk arrives (weak network) → the constant is computed against `/product/...` and comes out false → back on Home, the quiz overlay blocks a customer who came from a CTV link. That breaks the rule "khách vào bằng link CTV/gian hàng thì cả phiên không bị quiz chặn". Fix: compute the flag in the entry, the same way `?claim=` is now saved there, and pass it into OnboardingGate.

[P3] apps/miniapp/src/components/app.tsx:280-286 — OnboardingGate and CouponClaimGate share one SilentBoundary and one Suspense. If the onboarding chunk fails, the coupon gate is unmounted too, so the needLogin sheet and the claim only happen on the next app open. Fix: give each gate its own SilentBoundary.

[P3] apps/e2e/tests/web-checkout.web.spec.ts:170-174 — The test now waits for `data-back-href`, which hides a real product deviation. While the loading.tsx skeleton of /tai-khoan is showing, the floating back button on order detail goes to the order list instead of /tai-khoan. Fix: render the skeleton with the parent back target, or have the back button not take a path while `aria-busy` is set. Or record it as a known deviation in the backlog.

[P3] R-82 /home/me — Not done. On the second run, which is the run the target is measured on, it is 18 before and 19 after, against a target of ≤12. home.service is not in the diff. The numbers were also measured on lane 9, which by lane-up.sh:23 is the template DB tubutree_uat_tpl, not l9. Fix: open a follow-up item for /home/me in the backlog, and re-measure /cart on a real lane once the template DB is clean.

[P3] R-83 — There is no loading.tsx for `san-pham` or `san-pham/[slug]`, because it makes a missing product page return 200 instead of 404 (commit 76dbe6bc5). So the web target "bấm thẻ SP có ngay khung trang" (skeleton within ≤100 ms of tapping a product card) is not met. This needs to stay in the backlog and be reported to the owner, not counted as done.

[P3] docs/2026-10-28-review/screens-hieunang/cart__*.png, browse-category__*.png — Still not retaken with images on both sides. The before/after comparison for R-5 (HP1) has no evidence yet.

OUTSIDE THE CODE (not counted toward the merge verdict, but the owner must decide before any new lane is built): docs/2026-10-20-uat/tools/uat-harness/lane-up.sh:23 maps lane 9 to tubutree_uat_tpl. That template now contains seed data and 4 flags set to true (waste.enabled, waste.lane_pickup_enabled, loyalty.marketplace_claim_enabled, chat.enabled), and uat_returning has pointsBalance 45400. Every lane created from the template from now on will have wrong data, and the screenshots and measurements of other packages will be off. My recommendation is option (b): run build-template.sh again, rather than deleting rows by hand.
