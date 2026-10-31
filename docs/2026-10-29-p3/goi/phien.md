# Gói P3 phien: Phiên đăng nhập, liên kết Zalo

Gốc: main 815fa3c1e. Nguồn: các P3 reviewer Opus nêu ở đợt 28/10 (gói phien) chưa sửa, mục làm dở, và mục còn lại trong báo cáo cuối.

Với mỗi mục: kiểm còn đúng trên mã hiện tại không (nhiều mục đã sửa ở lượt review sau hoặc gói khác; dòng có thể lệch). Đã hết thì ghi skipped + bằng chứng file:dòng. Mục cần chủ quyết (ghi needs_owner/cần chủ quyết, hoặc phải đổi giá, luật điểm, phí, thể lệ, chữ pháp lý, cờ PROD, thêm tin gửi khách) thì skipped, ghi lựa chọn cho chủ. Mục trùng nhau thì làm một lần, ghi id kia là trùng.

## phien-1 (review lượt 1, gói phien)

File: apps/miniapp/src/store/auth.ts

Vấn đề: Entry của Mini App tăng từ 706 lên 707 KB raw (+1075 B raw, +366 B gz; gz vẫn 220 KB), trong khi brief yêu cầu entry KHÔNG tăng. Bước bundle-mini của gate.sh chỉ in số, không chặn, nên gate vẫn 0 FAIL. Nguyên nhân là store/auth.ts nằm trong entry, nên logic mới (tryZaloLogin, applyBlocked, ensurePhoneOrThrow, subscribe invalidate) nằm trọn trong đó.

Cách sửa đề xuất: Orchestrator quyết: chấp nhận và ghi lý do vào báo cáo đợt (sửa phiên buộc phải ở entry; tổng gz +502 B, dưới 3 KB). Nếu không chấp nhận thì gộp applyBlocked vào tryZaloLogin và bỏ nhánh trùng ở login()/restore() để gỡ vài trăm byte. Không có cách đưa phần này sang chunk lazy.

## phien-2 (review lượt 1, gói phien)

File: apps/api/src/modules/auth/auth.service.ts:133

Vấn đề: adoptLegacyGuest chỉ đổi khoá khi thiết bị gọi /auth/guest. Khách cũ còn refresh token (token xoay mỗi lần mở app) không bao giờ đi qua loginAsGuest, nên users.zaloId của họ vẫn là guest_<deviceId> thô mãi, CSKH vẫn đọc được qua GET /admin/users. Dòng đã gộp guest_<deviceId>_merged_<ts> cũng giữ deviceId thô. Như vậy E-14 chỉ đạt cho khách mới và khách đăng nhập lại.

Cách sửa đề xuất: Không sửa mã trong gói (gói không được thêm migration). Ghi vào backlog một lần backfill dữ liệu sau deploy, chủ hoặc orchestrator quyết. Khoá băm suy ra được từ chính chuỗi đã lưu: UPDATE "User" SET "zaloId" = 'guest_h_' || encode(sha256(convert_to(substr("zaloId",7),'UTF8')),'hex') WHERE "zaloId" LIKE 'guest\_%' AND "zaloId" NOT LIKE 'guest\_h\_%' AND "zaloId" NOT LIKE '%\_merged\_%'. Với dòng _merged_ thì băm phần nằm giữa 'guest_' và '_merged_'. Sau backfill, adoptLegacyGuest chỉ còn là lưới an toàn.

## phien-3 (review lượt 1, gói phien)

File: apps/miniapp/src/store/auth.ts:292

Vấn đề: ensurePhoneOrThrow ném luôn lỗi SDK của getZaloAccessToken (Error thường, không phải HttpError). Khi đó guest-link-card, new-customer-gift, guest-banner và coupon-claim-gate hiện getErrorMessage(err) = 'Có chút trục trặc, thử lại nhé' thay cho câu theo ngữ cảnh 'Chưa liên kết được Zalo. Bạn thử lại sau nhé.'. Brief chỉ cho ném lỗi API, còn Zalo không khả dụng thì phải trả null như khi khách từ chối sheet.

Cách sửa đề xuất: Bọc riêng bước lấy access token: `let creds; try { creds = await getZaloAccessToken(); } catch { return null; }` rồi gọi ensurePhoneApi(creds.code, creds.accessToken, phoneToken). Thêm ca test trong auth.spec.ts: getZaloAccessToken ném -1401 thì ensurePhoneOrThrow trả null.

## phien-4 (review lượt 1, gói phien)

File: apps/miniapp/src/store/auth.ts:125

Vấn đề: Tài khoản bị khoá trong lúc app đang mở mà restore() chạy với keepSession (ví dụ làm mới sau khi đặt hàng): refresh 401 ACCOUNT_BLOCKED đã xoá refresh token, rồi tryZaloLogin gặp ACCOUNT_BLOCKED nhưng chỉ trả 'stop' mà không gọi applyBlocked (dòng 125-126). Nhánh guest ở dòng 263 cũng return trước khi kiểm isAccountBlocked. Kết quả: store vẫn 'authenticated' với user bị khoá, mọi lệnh sau trả 401 và trang hiện lỗi rời rạc thay vì lời báo khoá. Brief không miễn trừ keepSession cho ca khoá.

Cách sửa đề xuất: Khoá là kết luận chắc chắn, không phải lỗi tạm, nên bỏ điều kiện keepSession cho riêng ca này. Dòng 125-129 thành `if (isAccountBlocked(err)) { await applyBlocked(err); return { kind: 'stop' }; }`. Dòng 263-265 kiểm isAccountBlocked trước `if (keepSession) return;`. Thêm test: đang authenticated, refresh và zalo-mini-app đều trả ACCOUNT_BLOCKED thì status là 'idle' và error chứa 'bị khoá'.

## phien-5 (review lượt 1, gói phien)

File: apps/miniapp/src/hooks/use-recycle-login.ts:14

Vấn đề: Khách bị khoá bấm 'Đăng nhập' trên màn Đổi rác: login() đặt idle kèm lời khoá, rồi ensurePhoneOrThrow trả null vì chưa có user, hook không báo gì. Màn guest của recycle không dùng GuestPrompt nên khách không bao giờ thấy lời khoá. Thêm nữa, lời máy chủ 'Tài khoản đã bị khoá.' (auth.service.ts:981, strategies/jwt.strategy.ts:34) không nói khách cần làm gì, trái luật 'Lời lỗi nói rõ khách cần làm gì'.

Cách sửa đề xuất: Trong hook, sau `await login();` thêm `const s = useAuthStore.getState(); if (s.status !== 'authenticated') { if (s.error) openSnackbar({ text: s.error, type: 'error' }); return; }`. Đổi lời ở cả hai chỗ phía API (thuộc auth/** của gói) thành 'Tài khoản đã bị khoá. Bạn liên hệ CSKH Tubu Tree để được hỗ trợ.' rồi cập nhật spec liên quan.

## phien-6 (review lượt 1, gói phien)

File: apps/miniapp/src/services/api.ts:27

Vấn đề: Comment của authReady vẫn ghi 'Mọi request (trừ chính /auth/*) chờ nó xong'. Sau khi đổi sang isAnonAuthCall, /auth/ensure-phone và /auth/me đã phải chờ phiên. Comment sai ở đúng chỗ dễ gây deadlock, dễ làm người sửa sau thêm lại includes('/auth/').

Cách sửa đề xuất: Sửa thành 'Mọi request (trừ lệnh đăng nhập/refresh công khai, xem isAnonAuthCall) chờ nó xong rồi mới gửi'.

## phien-7 (review lượt 2, gói phien)

File: apps/api/src/modules/auth/auth.service.ts:133-145

Vấn đề: adoptLegacyGuest accepts any deviceId that passes the DTO regex, and `_` is allowed. A crafted deviceId like `d_abc_merged_1700000000000` (or `h_<hash>_merged_<ts>`) makes legacyKey equal the zaloId of an already-merged guest row. updateMany then renames that row to a new hashed key and strips the `_merged_` marker. Login is still refused because issueTokens checks mergedIntoId, but the merged row's data has been changed. Only someone who knows a merged row's zaloId can do this, and CSKH can see it. The test at auth.service.spec.ts:873 only covers the legitimate deviceId.

Cách sửa đề xuất: In adoptLegacyGuest, return null immediately when `deviceId.includes('_merged_')`, or add `mergedIntoId: null` to both the findUnique (switch to findFirst) and the updateMany where clause. Add a jest test where the crafted deviceId equals the merged row's suffix and assert the merged row's zaloId is unchanged.

## phien-8 (review lượt 2, gói phien)

File: apps/api/src/modules/auth/auth.service.ts:499

Vấn đề: The merge concurrency check `g.zaloId !== guest.zaloId` was written for 'a parallel request already merged or upgraded this row'. It now also fires when a concurrent /auth/guest from the same device adopts the legacy row (guest_<raw> renamed to guest_h_<hash>). In that case mergeGuestInto skips the merge, returns the target, and tokens are issued for the target, while the guest's cart and points stay on the guest row. The window is narrow: it needs an unmigrated legacy row plus /auth/guest and ensure-phone running at the same moment.

Cách sửa đề xuất: Replace the exact comparison with a check on whether the row is still a guest: `if (!g || !g.zaloId?.startsWith('guest_') || g.zaloId.includes('_merged_'))`. Alternatively, run the R1-2 backfill before opening to customers so no legacy rows remain.

## phien-9 (review lượt 2, gói phien)

File: apps/miniapp/src/store/auth.ts:99-103,368

Vấn đề: applyBlocked (account blocked) and the 401 handler set user=null without clearing the React Query cache. Queries with `enabled: authed` keep returning the blocked account's cached data (points, wallet). The next login on the device has prev.user=null, so the E-61 subscribe does not invalidate. Same person and device, so not a leak, but the screen shows stale numbers.

Cách sửa đề xuất: In applyBlocked, call `onLogoutCleanup?.()` after setState, the same as logout(). Add a test in auth.spec.ts that the cleanup is called when the account is blocked.

## phien-10 (review lượt 2, gói phien)

File: apps/miniapp/src/pages/profile.tsx:186-193 (+ game.tsx:146, offers.tsx:101, group-buy.tsx:94, loyalty/guest-tiers.tsx:21, support-contact.tsx:68)

Vấn đề: The lock message only appears on pages that use AuthGate/GuestPrompt, plus Đổi rác (R1-5). On the Cá nhân tab, a blocked account sees 'Đã đăng xuất / Đăng nhập để xem...', and tapping 'Đăng nhập ngay' runs login(), gets blocked again, and shows nothing. The other login CTAs listed behave the same way. The package goal 'Tài khoản bị khoá thấy lời báo' is only partly met. These files belong to other packages (canhan, diem, muachung).

Cách sửa đề xuất: Write to the orchestrator: 'cần gói canhan/diem/muachung' read `useAuthStore((s) => s.error)` and use it in place of the body text of the guest EmptyState (as GuestPrompt does), or move these places onto GuestPrompt/AuthPhaseView.

## phien-11 (review lượt 2, gói phien)

File: apps/miniapp (entry bundle)

Vấn đề: Entry grew from 706 to 707 KB raw (gz unchanged at 220; vite reports index 713.01 kB / gz 225.50 kB). This breaks the brief's rule 'entry Mini App KHÔNG tăng'. The worker skipped it (R1-1) because store/auth.ts is in the entry, and the logic it adds is required by the package.

Cách sửa đề xuất: Accept it, and the orchestrator records the reason in the batch report (as R1-1 says). If it must be cut: tryZaloLogin/applyBlocked/isTransientSessionError are small, so no meaningful lazy split is possible.

## phien-12 (review lượt 2, gói phien)

File: apps/api/src/modules/auth/auth.service.ts:105-108 (R1-2)

Vấn đề: Guest rows created before deploy keep the raw key guest_<deviceId> until that device logs in again. Rows with _merged_ also carry the raw deviceId, which is the key to a newer live guest row on the same device. Old analytics_events rows still hold the raw deviceId in anonymousId, and the proposed SQL does not cover them. I checked the SQL: substr from 7, sha256 hex lowercase matches Node's createHash.

Cách sửa đề xuất: The orchestrator/owner schedules the backfill SQL (guest_ rows, then _merged_ rows hashing the middle part) before opening to customers. Add an UPDATE for analytics_events.anonymousId (left(encode(sha256(...)),32)) where the value starts with 'd_'.

## phien-13 (review lượt 2, gói phien)

File: apps/e2e/tests/recycle.miniapp.spec.ts:214-260

Vấn đề: The test 'Home, Vườn Xanh và Cá nhân không gọi /waste/*' is flaky (failed once, passed on retry): profile.tsx calls GET /auth/me (getOwnsBrand), which is not mocked, and the test ends right after the Cá nhân heading appears, so it is a timing race. This gap already exists on base, not caused by the package (5/5 passed on rerun with --repeat-each=5).

Cách sửa đề xuất: For the dondep package: add `api.allowUnmocked('GET /auth/me')` or `api.get('/auth/me', { ownsBrand: false })` in that test (or in mockSession).

## phien-14 (review lượt 2, gói phien)

File: apps/miniapp/src/store/auth.spec.ts (describe '... (E-13)', '... (E-61)'), apps/miniapp/src/services/api.spec.ts (describe '401 ở lệnh /auth/* (E-13)')

Vấn đề: New test titles include item codes, against the brief's rule of not citing item codes (E-x, R-x).

Cách sửa đề xuất: Remove '(E-13)' and '(E-61)' from the describe names and keep the descriptive text.

## phien-15 (còn lại trong báo cáo cuối 29/10)

Mini: khi đăng nhập bị giới hạn tốc độ (HTTP 429) thì báo "Mất kết nối". Phải báo đúng lý do (ví dụ "Bạn thao tác quá nhanh, thử lại sau ít phút") và có Thử lại. Web làm giống nếu cùng lỗi. Có test.
