# Gói P3 tin-canhan: Thông báo, Cá nhân, Trang chủ

Gốc: main 815fa3c1e. Nguồn: các P3 reviewer Opus nêu ở đợt 28/10 (gói thongbao, canhan) chưa sửa, mục làm dở, và mục còn lại trong báo cáo cuối.

Với mỗi mục: kiểm còn đúng trên mã hiện tại không (nhiều mục đã sửa ở lượt review sau hoặc gói khác; dòng có thể lệch). Đã hết thì ghi skipped + bằng chứng file:dòng. Mục cần chủ quyết (ghi needs_owner/cần chủ quyết, hoặc phải đổi giá, luật điểm, phí, thể lệ, chữ pháp lý, cờ PROD, thêm tin gửi khách) thì skipped, ghi lựa chọn cho chủ. Mục trùng nhau thì làm một lần, ghi id kia là trùng.

## tin-canhan-1 (review lượt 1, gói thongbao)

File: apps/miniapp/src/pages/notifications.tsx:325; apps/web/src/app/tai-khoan/thong-bao/page.tsx:202

Vấn đề: Bấm 'Xem thêm' mà lỗi (mạng hoặc 5xx) thì không báo gì: isError && !data là false vì đã có dữ liệu, nút quay về như cũ, khách không biết đã hỏng. Các trang phân trang khác đã có mẫu báo lỗi (web don-hang/page.tsx:117, vi-tubu/page.tsx:262, Mini browse.tsx:300).

Cách sửa đề xuất: Dưới danh sách, khi notifQ.isFetchNextPageError thì hiện dòng role=alert 'Không tải thêm được thông báo. Vui lòng thử lại.' (Mini dùng Text tone danger, web dùng ui.error như don-hang/page.tsx:117). Nút 'Xem thêm' vẫn giữ để thử lại.

## tin-canhan-2 (review lượt 1, gói thongbao)

File: apps/miniapp/src/pages/orders.tsx:39-41

Vấn đề: Khách huỷ gói định kỳ cuối cùng ngay trong tab 'Định kỳ' của Mini: SubscriptionsPanel invalidate ['subscriptions'] → hasLiveSubscription thành false → tab 'Định kỳ' biến mất và màn nhảy sang 'Tất cả'. statusMut lúc thành công không có snackbar, nên khách không thấy xác nhận đã huỷ và mất chỗ đang xem.

Cách sửa đề xuất: Giữ tab khi khách đang đứng ở đó, ví dụ dùng ref sticky const everHadSub = useRef(false); if (hasSubscription) everHadSub.current = true; ordersTabs(hasSubscription || everHadSub.current). Như vậy tab chỉ ẩn ở lần mở trang sau. Hoặc báo gói sở hữu SubscriptionsPanel thêm snackbar khi huỷ thành công.

## tin-canhan-3 (review lượt 1, gói thongbao)

File: apps/api/src/modules/notifications/notifications.controller.ts:21; apps/api/src/modules/notifications/dto/notification-list-query.dto.ts:5

Vấn đề: Comment so với bản cũ ('Trả MẢNG như bản cũ', 'như trước'), trái luật brief: comment không kể lại thay đổi.

Cách sửa đề xuất: Viết lại theo lý do, ví dụ 'Trả mảng (không bọc trang) vì home feed và client đã phát hành đọc thẳng mảng; không tham số thì 50 tin mới nhất.'

## tin-canhan-4 (review lượt 1, gói thongbao)

File: apps/e2e/tests/buy-flow-4a.miniapp.spec.ts:151,181,239

Vấn đề: Theo bảng chủ file, apps/e2e/** thuộc gói dondep; gói khác chỉ được thêm spec mới. Worker chèn 3 dòng api.get('/me/subscriptions', []) vào file của dondep. Thay đổi này cần thiết (fixture mockOrdersTab có sẵn gói ACTIVE) và đã ghi trong báo cáo, nhưng sẽ dễ xung đột khi gộp với dondep.

Cách sửa đề xuất: Ghi vào kế hoạch gộp: dondep giữ 3 dòng này (hoặc thongbao gộp sau dondep và tự giải xung đột). Cách khác: chuyển 3 ca đó sang spec mới orders-subscription-tab.miniapp.spec.ts và trả buy-flow-4a về nguyên trạng, nếu dondep đồng ý.

## tin-canhan-5 (review lượt 2, gói thongbao)

File: apps/miniapp/src/pages/community-events.tsx:52-55

Vấn đề: Dòng chính 'Tham gia trên web Tubu Tree' (chữ đậm, màu brand) vẫn hiện với sự kiện đã kết thúc, ngay cạnh huy hiệu 'Đã kết thúc'. Hai thông tin mâu thuẫn nhau: khách được mời tham gia một sự kiện đã đóng.

Cách sửa đề xuất: Chỉ dựng dòng vi.community.eventJoinOnWeb khi `!isEventEnded(event)`. Thêm một ca vào community-events.spec.tsx: sự kiện đã kết thúc thì không có câu cách tham gia.

## tin-canhan-6 (review lượt 2, gói thongbao)

File: apps/api/src/common/notify-admins.ts:48

Vấn đề: Nhóm 'admins+cskh' lấy `take: MAX_ADMINS` (20) mà không có orderBy. Nếu số ADMIN cộng nhân viên CSKH vượt 20, Postgres có thể cắt mất ADMIN, trong khi ADMIN là người duy nhất kết nối lại được cầu nối. gomdon-alert.service.ts:83 đã dùng `orderBy: { role: 'asc' }` cho đúng tình huống này.

Cách sửa đề xuất: Thêm `orderBy: { role: 'asc' }` vào findMany cho mọi audience, giống gomdon-alert. Kết quả của 'admins' không đổi. Thêm một ca vào notify-admins.spec kiểm có orderBy.

## tin-canhan-7 (review lượt 2, gói thongbao)

File: apps/miniapp/src/pages/notifications.tsx:220-223

Vấn đề: E-83 mới xử lý nhánh điều hướng. Ở nhánh mở sheet mua lại, overlay được đóng bằng setSelectedNotif(null) nhưng mục lịch sử {notifDetail:true} vẫn còn. Đóng sheet xong, khách bấm lùi một lần mà màn không đổi gì, rồi phải bấm thêm lần nữa mới rời trang Thông báo. Đây đúng loại lỗi CSKH-09.

Cách sửa đề xuất: Ở nhánh `action.kind === 'sheet'`: nếu `window.history.state?.notifDetail` thì gọi `window.history.back()` (handler popstate tự đóng overlay), sau đó mới setReorderTarget. Thêm một ca vào notifications-page.spec.tsx: mở chi tiết, bấm 'Mua lại ngay', ra sheet, rồi kiểm history.back đã được gọi.

## tin-canhan-8 (review lượt 2, gói thongbao)

File: apps/api/prisma/seed.ts:856 (gói doirac giữ) / apps/api/src/modules/support-chat/support-chat-admin.controller.ts:20-38

Vấn đề: Cảnh báo OPS_ZALO_BRIDGE_DOWN giờ gửi tới cả nhân viên CSKH. Thân tin bảo 'Vào tab Chat CSKH để kết nối lại', nhưng QR, reconnect và logout của cầu nối chỉ ADMIN dùng được (@Roles('ADMIN'), chỉ GET bridge có @AllowStaff('CSKH')). Nhân viên mở tab theo lời dặn và không làm được gì.

Cách sửa đề xuất: Gói này không sửa seed. Ghi vào báo cáo cho gói doirac (hoặc admin sửa mẫu trên PROD vì mẫu là createOnly): đổi thân tin thành câu đúng cho cả hai nhóm, ví dụ 'Tin nhắn Zalo của khách tạm không vào chat CSKH. Admin vào tab Chat CSKH để kết nối lại.'

## tin-canhan-9 (review lượt 2, gói thongbao)

File: apps/e2e/tests/buy-flow-4a.miniapp.spec.ts:151,181,239,313; apps/e2e/tests/account.web.spec.ts:155

Vấn đề: Gói đã sửa file e2e thuộc gói dondep (luật: gói khác chỉ thêm spec mới của chính mình). Worker đã ghi rõ trong R1-5, và lý do là thật: fixture coi lời gọi chưa mock là lỗi.

Cách sửa đề xuất: Giữ kế hoạch gộp: thongbao gộp sau dondep và tự giải xung đột 5 dòng này. Ghi vào PROGRESS để người gộp biết.

## tin-canhan-10 (review lượt 3, gói thongbao)

File: apps/api/prisma/seed.ts:856 (và migrations/20261023100000_support_chat/migration.sql:126)

Vấn đề: Gói này gửi thêm OPS_ZALO_BRIDGE_DOWN cho nhân viên CSKH (bridge-health.cron.ts:147, audience 'admins+cskh'). Nhưng thân mẫu tin vẫn ghi 'Vào tab Chat CSKH để kết nối lại', trong khi chỉ ADMIN được quét QR hay kết nối lại (support-chat-admin.controller.ts có @Roles('ADMIN')). Không phải ngõ cụt: vào tab, CSKH thấy câu 'Nhờ quản trị viên nối lại cầu nối' (bridge-card.tsx:62). Tuy vậy, lời trong tin vẫn hứa một việc nhân viên không làm được. File seed thuộc gói doirac nên worker đúng khi không tự sửa (R2-5 partial hợp lệ). Việc này chưa có trong PROGRESS.md.

Cách sửa đề xuất: Orchestrator ghi vào PROGRESS.md và giao doirac đổi bodyTemplate của 'nt-ops-zalo-bridge-down' trong seed.ts:856 thành 'Cầu nối Zalo của chat CSKH mất kết nối từ {{since}} ({{state}}). Tin nhắn Zalo của khách tạm không vào chat CSKH. Admin vào tab Chat CSKH để kết nối lại.' Mẫu này là createOnly nên seed không ghi đè được bản trên PROD: Admin sửa tay ở tab Mẫu thông báo sau khi deploy. Không cần đổi mã trong nhánh thongbao.

## tin-canhan-11 (review lượt 3, gói thongbao)

File: apps/e2e/tests/buy-flow-4a.miniapp.spec.ts:313, apps/e2e/tests/account.web.spec.ts:155

Vấn đề: Nhánh này sửa hai spec e2e có sẵn thuộc gói dondep, để mock thêm GET /me/notifications/unread-count (fixture coi lời gọi chưa mock là lỗi). Gộp sau dondep sẽ xung đột ở các dòng này (R2-6). Kế hoạch gộp đã có nhưng chưa ghi vào PROGRESS.md.

Cách sửa đề xuất: Orchestrator ghi vào PROGRESS.md: gộp thongbao SAU dondep. Khi giải xung đột, giữ hai dòng api.get('/me/notifications/unread-count', ...) trong mockReminder (buy-flow-4a) và trong ca 'thông báo: chạm tin chưa đọc...' (account.web). Sau khi gộp, chạy lại E2E_SCOPE=miniapp tests/buy-flow-4a.miniapp.spec.ts và web-gate tests/account.web.spec.ts.

## tin-canhan-12 (mục E-91 làm dở ở gói canhan)

Ghi chú của worker: Xong phần đếm đơn: GET /orders/status-counts (API orders, service + controller + spec, route đặt trước :code) thay 3 lời gọi GET /orders?status=..&limit=1 ở Cá nhân Mini và web (3 xuống 1). CHƯA làm phần đếm tin chưa đọc: nhánh review/e2e-thongbao không có commit nào (còn ở 376ad7055, việc chưa commit nằm trong worktree e2e-thongbao), getUnreadNotificationCount chưa tồn tại; không merge nhánh trống và không đụng worktree của gói khác.

Làm nốt phần còn lại nếu không cần chủ quyết.

## tin-canhan-13 (review lượt 1, gói canhan)

File: apps/miniapp/src/pages/profile.tsx:101, apps/miniapp/src/pages/home.tsx:54, apps/web/src/app/tai-khoan/page.tsx:100, apps/web/src/components/home/home-view.tsx:89, apps/web/src/components/header-bell.tsx:30

Vấn đề: E-91 mới làm một phần: Cá nhân, Trang chủ và chuông vẫn tải cả danh sách ['notifications'] chỉ để đếm tin chưa đọc. Lúc worker làm, nhánh thongbao còn trống nên lý do hoãn khi đó là hợp lệ. Nay review/e2e-thongbao đã có 62f32b0b1, gồm getUnreadNotificationCount và unreadNotificationCountQuery với khoá ['notifications','unread'] trong packages/app-core/src/queries/account.ts. Danh sách phân trang của thongbao dùng khoá riêng ['notifications','list'], nên không lệch dạng cache. Đã thử git merge-tree: hai nhánh gộp không xung đột.

Cách sửa đề xuất: git merge review/e2e-thongbao. Đổi 5 chỗ trên sang useQuery({...unreadNotificationCountQuery(coreHttp), enabled: authed}).data?.count ?? 0 (Mini dùng service tương ứng). Thêm spec kiểm từng nơi dùng khoá unread và không gọi /me/notifications. Ghi số API của Cá nhân trước và sau.

## tin-canhan-14 (review lượt 1, gói canhan)

File: apps/miniapp/src/pages/profile.tsx:144, apps/web/src/app/tai-khoan/page.tsx:124

Vấn đề: E-39 chưa phủ hết người vận hành quầy. waste-admin-points.service.ts (addStaff, khoảng :323-352) cho thêm nhân viên điểm đối tác (WastePointStaff role STAFF) là bất kỳ người dùng thật nào, kể cả vai CUSTOMER. Chỉ OWNER mới phải là chủ gian hàng đối tác. Bộ lọc mayHaveDesk (STAFF, ADMIN, hoặc DEALER khi đổi rác bật) bỏ sót nhóm này, nên nhân viên quán vai CUSTOMER không thấy hàng 'Nhận hàng tại điểm' ở Cá nhân. Họ vẫn vào được qua Đổi rác (recycle.tsx:277), nên không bị ngõ cụt. Ghi chú của worker rằng hàng chỉ hiện cho 'vai trò gọi được /waste/desk/points' cũng không đúng: mọi vai đều gọi được endpoint này.

Cách sửa đề xuất: Không đổi mã trong gói này (tiêu chí xong là không thêm lời gọi API cho khách thường). Ghi giới hạn này vào báo cáo và backlog cho chủ quyết. Hướng tương lai: API trả cờ nhẹ (ví dụ hasDeskPoint trong /auth/me), việc này của gói phien hoặc doirac.

## tin-canhan-15 (review lượt 1, gói canhan)

File: báo cáo worker (items E-39, E-66, E-77, E-79)

Vấn đề: Ghi chú của bốn mục bị gán nhầm mã. E-39 mô tả việc sửa câu mô tả khoá cấu hình (thực ra là E-77). E-66 mô tả việc sửa comment cờ Chặng Mùa (cũng là E-77). E-77 mô tả việc đổi đường Quản trị nhân sự (thực ra là E-79). E-79 mô tả lối vào quầy (thực ra là E-39). Việc ẩn tab Cộng đồng (E-66 thật, commit 9e57019f5) không được ghi dưới mã nào. Mã nguồn đã làm đủ cả bốn mục; chỉ báo cáo sai nên dễ đóng nhầm backlog.

Cách sửa đề xuất: Sửa ánh xạ trong báo cáo: E-39 = 3f0fe156e (lối vào quầy), E-66 = 9e57019f5 (ẩn tab Cộng đồng bằng GAME_SOCIAL_ON_WEB), E-77 = 96cdbc5be (comment features.ts và mô tả home.new_customer_layout), E-79 = f9449ef72 (/admin?tab=staffRoster).

## tin-canhan-16 (review lượt 1, gói canhan)

File: apps/miniapp/src/pages/offers.tsx:154, apps/web/src/app/uu-dai/page.tsx:190

Vấn đề: Khi khách đang trong hạn giữ hạng, dòng dưới thanh tiến độ đổi thành 'Giữ hạng Lộc Biếc: ... trước 07/11/2026'. Nhưng thanh vẫn vẽ progressPct tiến tới hạng kế, và aria-label vẫn là 'Tiến độ lên hạng kế'. Khách dễ đọc phần trăm đó thành tiến độ giữ hạng.

Cách sửa đề xuất: Khi overview.tierGrace có giá trị, bỏ thanh hoặc đổi aria-label (ví dụ 'Tiến độ lên hạng kế, đang trong hạn giữ hạng'). Gọn nhất là memberCardView trả thêm cờ inGrace để hai trang dùng chung.

## tin-canhan-17 (review lượt 1, gói canhan)

File: apps/e2e/tests/support/mock-api.ts:437-439, :493-496; apps/e2e/tests/game.web.spec.ts; apps/e2e/tests/account.web.spec.ts:73

Vấn đề: Theo bản đồ chủ file, apps/e2e/** thuộc gói dondep (gói khác chỉ được thêm spec mới). Gói này đã sửa ba file của dondep. Worker có khai trong báo cáo, và git merge-tree với review/e2e-dondep hiện không xung đột, nhưng thứ tự gộp vẫn phải để ý.

Cách sửa đề xuất: Ghi vào kế hoạch gộp: gộp canhan sau dondep, hoặc báo dondep biết hai mock mặc định mới (/orders/status-counts, /waste/desk/points) và nhánh GAME_SOCIAL_ON_WEB trong game.web.spec.ts.

## tin-canhan-18 (review lượt 2, gói canhan)

File: apps/miniapp/src/pages/home.tsx:53-54

Vấn đề: Mục E-91/R1-2 mới làm một phần. Huy hiệu chuông Trang chủ Mini vẫn đếm tin chưa đọc trong danh sách /me/notifications, tối đa 50 tin. Cá nhân Mini (profile.tsx:104), Trang chủ web (home-view.tsx:89) và chuông web thì đếm cả hộp thư. Khách có hơn 50 tin chưa đọc sẽ thấy Trang chủ Mini báo 50 nhưng Cá nhân báo 73, và Mini khác web. Ngoài ra, chỉ khối gộp /home/me lần đầu là không tốn lời gọi: lần đầu xong, mỗi lần làm mới ['notifications'] lại tải trọn 50 tin chỉ để đếm.

Cách sửa đề xuất: Đổi home.tsx sang useQuery({ ...unreadNotificationCountQuery(coreHttp), enabled: authed }).data?.count ?? 0 (một lời gọi đếm nhỏ). Cập nhật home.spec theo hướng một lời gọi unread-count, không gọi /me/notifications. Nếu muốn giữ 0 request thêm thì ghi backlog cho api-tin: khối /home/me trả thêm unreadCount, Mini nạp sẵn vào ['notifications','unread'] qua takeMeBlock.

## tin-canhan-19 (review lượt 2, gói canhan)

File: apps/web/src/components/home/home-view.tsx:160 và apps/web/src/components/home/use-home-settling.ts:26-29

Vấn đề: Lỗi sót của E-122 khi mạng chậm. Ở chế độ giữ nội dung (startedNew), nếu tới 4,5 giây mà loại khách vẫn là 'unknown' thì hẹn giờ nhả khung chờ. Lúc đó settling = false nên thứ tự khối chuyển sang homeRenderOrder('unknown') = UNKNOWN, bỏ mất kệ Bán chạy và dải quà. Khi sau đó biết là khách mới, NEW dựng lại hai khối này. Kết quả là nội dung đã dựng biến mất rồi hiện lại, đúng lỗi E-122 muốn bỏ.

Cách sửa đề xuất: Đổi thành: const order = startedNew && (settling || kind === 'unknown') ? homeKeptOrder(kind) : homeRenderOrder(kind, settling);. Thêm ca vào home-view.spec.tsx: khung hình đầu là khách mới, khôi phục phiên treo quá HOME_SETTLE_MAX_MS (giờ giả). Ca này kiểm sau 4,5 giây khối data-home-block="bestSellers" vẫn còn, và tới khi kind = 'new' cũng không mất.

## tin-canhan-20 (review lượt 2, gói canhan)

File: apps/miniapp/src/pages/profile.tsx:144-148, apps/web/src/app/tai-khoan/page.tsx:124-127

Vấn đề: E-39 thực chất mới làm một phần, dù R1-3 báo 'done'. Nhân viên điểm đối tác mang vai CUSTOMER (addStaff, waste-access.service.ts:132-139 trả điểm của họ) không thấy hàng 'Nhận hàng tại điểm' ở Cá nhân/menu tài khoản. Họ lại là nhóm vận hành quầy chính ngoài kho. Worker nói việc này cần chủ quyết nhưng không ghi vào backlog, nên dễ thất lạc sau khi gộp.

Cách sửa đề xuất: Đổi trạng thái E-39 thành partial trong báo cáo gộp. Thêm một mục backlog vào docs/2026-10-28-e2e/20-backlog.md (lúc gộp, ở nhánh tài liệu) cho gói phien hoặc doirac: /auth/me trả cờ nhẹ hasDeskPoint (đếm wastePointStaff isActive), client bật deskQ khi cờ true. Mục ghi 'cần chủ chốt có gọi API cho mọi khách hay không'.

## tin-canhan-21 (review lượt 2, gói canhan)

File: apps/miniapp/src/pages/profile.tsx, apps/web/src/app/tai-khoan/page.tsx, apps/web/src/components/home/home-view.tsx

Vấn đề: Còn tiêu chí xong chưa đo. E-91 đòi đo lại số API ở Cá nhân (trước/sau), worker chỉ suy ra từ mã. E-122 đòi đo lại CLS = 0, chưa có số. Ba trang web đã đổi (/tai-khoan, /uu-dai, /vuon-xanh) cũng chưa báo First Load (luật: tăng ≤ 2 KB hoặc ghi lý do). /tai-khoan nay bọc Suspense.

Cách sửa đề xuất: Chạy Playwright Mini /profile và web /tai-khoan với khách CUSTOMER, đếm api.calls theo kiểu log WEB_GAME_CALLS_TABS ở game.web.spec.ts, rồi ghi số trước (gốc 376ad7055) và sau. Đo layout-shift bằng PerformanceObserver trên / web khổ 375, ở ca khung hình đầu là khách vãng lai rồi mới có phiên. Chạy next build và ghi First Load ba trang đổi so với gốc.

## tin-canhan-22 (review lượt 2, gói canhan)

File: apps/e2e/tests/support/mock-api.ts:368,439-441,495; apps/e2e/tests/account.web.spec.ts:73; apps/e2e/tests/game.web.spec.ts; apps/e2e/tests/shop.web.spec.ts:189; apps/web/src/components/game/use-game-data.ts

Vấn đề: Gói sửa file do dondep giữ (apps/e2e/**) và file ngoài bản đồ (use-game-data.ts). Các sửa này cần để e2e xanh và đã ghi trong R1-6. Lúc này git merge-tree với review/e2e-dondep sạch, nhưng mock mặc định mới (/orders/status-counts, /waste/desk/points, /me/notifications/unread-count) sẽ đổi hành vi spec của dondep.

Cách sửa đề xuất: Giữ thứ tự gộp: dondep trước, canhan sau. Sau khi dondep vào nhánh tích hợp, chạy lại git merge-tree và web gate cả bộ (bash scripts/web-gate.sh) trên nhánh đã gộp. Ghi use-game-data.ts vào báo cáo gộp như file ngoài bản đồ đã sửa có lý do.

## tin-canhan-23 (review lượt 3, gói canhan)

File: apps/miniapp/src/pages/home.tsx:54 (và packages/app-core/src/home-layout.ts:454-463, apps/miniapp/src/components/home/use-home-settling.ts:12-19)

Vấn đề: File entry của Mini App vẫn lớn hơn gốc, trái luật 'entry KHÔNG tăng'. Tôi đo lại file www/assets/index.Ccy8FSou.module.js: 722.949 B raw / 225.136 B gz. Gốc theo đo của worker là 722.536 B; riêng gói thongbao là 722.591 B (tôi đọc từ bản build ở worktree e2e-thongbao). Vậy gói này thêm +358 B so với thongbao, tổng +413 B raw / +515 B gz so với gốc. Gate bundle-mini làm tròn theo KB nên vẫn báo 706/220 KB và PASS, nên mức tăng không lộ ra. Phần tăng đến từ các mục bắt buộc phải đụng file entry: đếm tin chưa đọc qua unread-count (+186 B), tham số sessionFailed và HOME_SETTLING_HEIGHTS (+96 B). Đây không phải lỗi chức năng.

Cách sửa đề xuất: Chủ chọn một trong hai. (1) Chấp nhận +413 B và ghi vào báo cáo gộp. (2) Đưa vào backlog api-tin: /home/me trả thêm unreadCount; home.tsx đọc số này qua takeMeBlock trong services/home-feed.ts thay vì import unreadNotificationCountQuery và coreHttp. Cách này bỏ được cả lời gọi thêm lẫn khoảng 186 B. Sau khi sửa, đo lại byte (không chỉ KB) của file index.*.module.js lớn nhất.

## tin-canhan-24 (review lượt 3, gói canhan)

File: apps/web/src/components/home/home-view.tsx:162

Vấn đề: Mục E-122 chưa đạt tiêu chí xong 'CLS vẫn 0' cho khách cũ mở web lần đầu trên máy mới. Tôi tự chạy lại web-gate với profile-calls.web.spec.ts: CLS = 0.0657, trong khi gốc là 0.0002. Trang dịch một lần lúc khoảng 1,32 giây (categories y632→490): khi hết chờ, thứ tự khối chuyển từ homeKeptOrder (bố cục khách mới) sang bố cục khách cũ (RETURNING), kệ Bán chạy nhường chỗ cho Mua lại. Khách mới có phiên thì CLS = 0.0000. Mức 0.0657 vẫn dưới ngưỡng 0,1 và chỉ xảy ra ở lần mở đầu trên mỗi máy, vì lần sau đã có cookie gợi ý. Bản thân yêu cầu của mục tự mâu thuẫn ('giữ nội dung khách mới' và 'không đổi thứ tự khối', trong khi khách cũ có bố cục riêng).

Cách sửa đề xuất: Chủ quyết một trong hai. (a) Chấp nhận 0.0657: không còn cảnh nội dung biến mất rồi hiện lại, và nới tiêu chí của E-122 thành '< 0,1'. (b) Nếu khung hình đầu là khách mới thì giữ homeKeptOrder(kind) suốt lần mở đó, tức sửa dòng 162 thành `const order = startedNew ? homeKeptOrder(kind) : homeRenderOrder(kind, settling)`. CLS sẽ về 0, nhưng khách cũ trên máy mới không thấy kệ Mua lại ở lần mở đầu. Chọn (b) thì phải sửa ca 'phiên khôi phục xong là khách cũ' trong home-view.spec.tsx và hạ ngưỡng ở profile-calls.web.spec.ts xuống < 0.01.

## tin-canhan-25 (review lượt 3, gói canhan)

File: apps/miniapp/src/services/home-feed.ts:37

Vấn đề: Trang chủ Mini không còn đọc khối notifications của GET /home/me (nay đếm bằng /me/notifications/unread-count). Máy chủ vẫn tải tới 50 tin cho mỗi lần mở Trang chủ của mọi khách đã đăng nhập, mà không ai dùng. Trang chủ cũng thêm đúng một lời gọi API. Phần sửa thuộc gói khác (home.service phía API).

Cách sửa đề xuất: Ghi backlog api-tin: /home/me bỏ khối notifications và trả unreadCount (gộp với cách (2) của mục bundle ở trên). Đổi đồng thời HomeMeDTO.notifications ở home-feed.ts và cập nhật home-requests.spec.tsx về 0 lời gọi thêm.

## tin-canhan-26 (review lượt 3, gói canhan)

File: apps/e2e/tests/support/mock-api.ts:439-441,495-498 (và account.web.spec.ts:73, game.web.spec.ts:1-8, shop.web.spec.ts:189)

Vấn đề: Gói này sửa các file e2e mà bản đồ chủ file giao cho dondep (gói khác chỉ được thêm spec mới của mình). Các sửa nằm ngoài dòng 616–680 của shop.web.spec.ts. Tôi đã chạy git merge-tree với mọi nhánh review/e2e-* (dondep 1bdb7978b, thongbao 834608f9d và 13 nhánh còn lại): không nhánh nào xung đột. Rủi ro còn lại là về hành vi: mặc định mới cho /orders/status-counts và /waste/desk/points đăng ký trong mockSession sẽ bị '/orders/:code' che mất nếu spec nào đăng ký mock đó sau (giống bẫy của active-count đã có comment cảnh báo).

Cách sửa đề xuất: Ghi vào báo cáo gộp. Sau khi gộp dondep rồi tới canhan, chạy lại bash scripts/web-gate.sh cả bộ và Playwright Mini toàn bộ trên nhánh tích hợp. Spec mới cần số đơn ở Cá nhân thì đăng ký '/orders/status-counts' SAU mọi mock '/orders/:code'.
