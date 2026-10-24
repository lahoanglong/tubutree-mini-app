# Chat CSKH trong Mini App, nhân viên trả lời từ Zalo cá nhân (Q5)

- **Ngày:** 2026-10-23
- **Trạng thái:** Chủ dự án chốt hướng ở Q5 (`docs/2026-10-20-uat/98-cau-hoi.md:37`): khách chat trong Mini App, tin chuyển tới một tài khoản Zalo cá nhân do chủ đăng nhập (như dự án MSS), nhân viên trả lời từ Zalo cá nhân, tin quay về khách. Ngày 2026-10-23 chủ dặn "làm hết đi", không hỏi thêm. Một người đọc độc lập đã soát tài liệu như người sẽ làm; năm câu họ hỏi đã được trả lời trong tài liệu (trích tin chưa thử thật, ảnh khi chưa có Cloudinary, tin echo, chặn khách, vai được chat). Mọi điểm ghi **(quyết định của agent)** là do agent tự chọn; chủ đổi được.
- **Phạm vi:** app mới `apps/zalo-bridge`; module mới `support-chat` trong `apps/api`; màn chat ở `apps/miniapp` và `apps/web` (khách); tab admin ở `apps/web/src/app/admin`; `packages/shared-types`; `docker-compose.prod.yml`, `docker-compose.vietnix.yml`, `Caddyfile`.
- **Nguồn khảo sát:** MSS ở `~/coding/chodeli-marketing-support-system/.worktrees/fix-group-name-2210` (HEAD 7569ba53, bản đang chạy PROD của MSS), thư mục `zalo-bridge-process/` và `src/lib/zalo/`.

## 1. Ý định và lý do

Hiện khách muốn hỏi Tubu Tree thì bấm nút mở chat Zalo OA, gọi hotline hoặc gửi email (`apps/miniapp/src/components/support-contact.tsx:18-60`). Tin nhắn OA không vào hệ thống Tubu: nhân viên đọc trong OA Manager hoặc Pancake (`docs/launch/so-tay-van-hanh/cskh.md:12`). Webhook tự trả lời của OA kiểm sai kiểu chữ ký nên chưa chạy được trên production (D5-05).

Chủ dự án không muốn đi đường OA. Chủ muốn cách MSS đang làm: một tài khoản Zalo cá nhân đăng nhập vào hệ thống bằng quét QR, nhân viên dùng Zalo trên điện thoại như thường ngày. Lý do (theo agent hiểu): nhân viên đã quen Zalo cá nhân, trả lời nhanh trên điện thoại, không cần mở thêm trang quản trị; OA lại giới hạn tin miễn phí trong 48 giờ (`docs/2026-07-05-retention-ctv-conversion-research.md:15`).

Thành công là: khách hỏi trong Mini App, nhân viên thấy tin trên Zalo trong vòng một phút, trả lời bằng cách bấm "Trả lời" trên tin đó, khách thấy câu trả lời trong Mini App. Không tin nào của khách bị mất im lặng.

## 2. Mục tiêu, không phải mục tiêu, điều phải tránh

**Mục tiêu**
1. Khách (Mini App và web) có một màn chat với Tubu Tree, giữ lịch sử, gửi chữ và ảnh.
2. Mỗi tin của khách được chuyển vào **một nhóm Zalo CSKH** qua tài khoản cầu nối, kèm mã hội thoại và ngữ cảnh (đơn, sản phẩm).
3. Nhân viên trả lời trong nhóm bằng "Trả lời" (trích tin) hoặc gõ mã hội thoại ở đầu câu. Câu trả lời về đúng khách.
4. Khách biết có trả lời mới: chấm đỏ ở lối vào chat và thông báo trong chuông.
5. Admin đăng nhập tài khoản cầu nối bằng QR, chọn nhóm, bật/tắt chat, xem lịch sử, gửi lại tin lỗi, và trả lời từ trang admin khi Zalo hỏng.
6. Có công tắc tắt toàn bộ; mặc định **tắt**.

**Không phải mục tiêu (bản đầu)**
- Không gửi tin tiếp thị, tin hàng loạt hay kết bạn qua tài khoản cầu nối.
- Không nhiều tài khoản cầu nối, không nhiều nhóm.
- Không tạo nhóm riêng cho từng khách.
- Không thoại, tệp, sticker, video. Nhân viên gửi sticker hay tệp thì hệ thống bỏ qua.
- Không realtime bằng websocket. Khách nhận tin mới bằng hỏi định kỳ khi đang mở màn chat.
- Không báo trả lời qua ZNS (cần mẫu Zalo duyệt). Có thể thêm sau.
- Không chia việc, giao hội thoại cho từng nhân viên, không bot tự trả lời theo từ khoá.
- Không đụng module tự trả lời OA hiện có (`modules/cskh`, `integrations/zalo-oa`).

**Điều phải tránh**
- Tin khách gửi bị mất mà không ai biết.
- Khách thấy tên thật, số điện thoại hay ảnh Zalo của nhân viên.
- Hệ thống đọc hay lưu các cuộc chat khác của tài khoản cầu nối (chat riêng, nhóm khác).
- Tài khoản Zalo chính của chủ hoặc của nhân viên bị khoá vì chức năng này.
- Hai bản cầu nối cùng chạy một tài khoản.

## 3. Rủi ro phải đọc trước khi bật

1. **Zalo cấm đăng nhập qua bên thứ ba.** Điều khoản Zalo hiệu lực 05/09/2026, điều 4.7, cấm đăng nhập bằng phần mềm bên thứ ba (MSS ghi ở `docs/growth-2026-10-17/02-chien-luoc.md:151-156`). Thư viện `zca-js` không chính thức và tự cảnh báo có thể bị khoá tài khoản. Zalo có thể khoá tài khoản cầu nối bất cứ lúc nào.
   - Cách giảm: dùng **một số điện thoại riêng** chỉ làm cầu nối (SIM công ty), không dùng số chính của chủ hay nhân viên; lưu lượng thấp (chỉ chuyển tin CSKH); giãn cách gửi; không kết bạn, không gửi hàng loạt.
   - Khi bị khoá: khách vẫn gửi được, tin nằm chờ; admin nhận cảnh báo; nhân viên trả lời từ trang admin; khách thấy hotline.
2. **`zca-js` có thể hỏng khi Zalo đổi giao thức.** Ghim đúng bản 2.1.2 như MSS. MSS dùng cùng thư viện nên lỗi ở MSS là tín hiệu cảnh báo sớm.
3. **Một tài khoản chỉ một phiên web.** Khi ai đó mở Zalo PC hay Zalo Web bằng tài khoản cầu nối, `zca-js` bị đóng kết nối (mã 3000, `zca-js/dist/apis/listen.js:349-354`). Nhân viên **không được** mở Zalo PC/Web bằng tài khoản cầu nối. Điện thoại thì được.
4. **Tin đã chuyển vào nhóm Zalo không xoá được** khi khách xoá tài khoản. Văn bản chính sách bảo mật (chủ tự điền, D8-5) cần nói điều này.

## 4. Cách chạy, nhìn từ người dùng

### 4.1 Chuẩn bị (chủ dự án, một lần)
1. Lấy một số điện thoại riêng, tạo tài khoản Zalo "Tubu Tree CSKH".
2. Trên điện thoại, dùng tài khoản đó tạo nhóm Zalo "Tubu CSKH", mời các nhân viên CSKH (tài khoản cá nhân của họ).
3. Vào trang admin, tab **Chat CSKH**, bấm "Đăng nhập Zalo", quét QR bằng Zalo của tài khoản cầu nối.
4. Chọn nhóm "Tubu CSKH" trong danh sách, bấm "Gửi tin thử". Nhóm nhận một tin thử.
5. Bật "Cho khách chat".

### 4.2 Khách
- Lối vào khi chat đang bật: thay nút "Chat Zalo OA" ở `support-contact.tsx` (chi tiết đơn, đổi rác), nút "Chat với shop" ở chi tiết sản phẩm, dòng hỗ trợ ở trang Giới thiệu, và thêm dòng "Chat với Tubu Tree" ở trang Cài đặt/Tài khoản. Khi chat tắt, các nút giữ như hôm nay (OA, hotline, email).
- Mở từ chi tiết đơn thì màn chat hiện thẻ ngữ cảnh "Về đơn TT12345" trên ô nhập; gửi tin đầu tiên sẽ kèm ngữ cảnh đó. Tương tự với sản phẩm.
- Ai cũng chat được khi đã đăng nhập: khách, CTV, đại lý, chủ thương hiệu **(quyết định của agent)**. Khách chưa đăng nhập thấy nút như hôm nay (OA, hotline) và lời mời đăng nhập.
- Màn chat: danh sách tin (tin khách bên phải, tin Tubu Tree bên trái ghi "Tubu Tree"), ô nhập tối đa 1.000 ký tự, nút đính ảnh, nút gửi.
- Nút đính ảnh chỉ hiện khi bản build có Cloudinary (`isCloudinaryConfigured()`; Mini App dùng `components/image-upload.tsx`, web dùng thành phần tải ảnh Cloudinary sẵn có). Hiện PROD chưa đặt `VITE_CLOUDINARY_*` (việc của chủ, báo cáo UAT mục 5), nên lúc đầu chỉ có chữ **(quyết định của agent)**.
- Tin của khách có trạng thái nhỏ: "Đang gửi", "Đã gửi". Tin không chuyển được vào Zalo vẫn hiện "Đã gửi" với khách (tin đã nằm trong hệ thống), lỗi chuyển là việc của admin.
- Ngoài giờ (mặc định 8:00–21:00, giờ VN): sau tin đầu tiên ngoài giờ trong ngày, hệ thống thêm một tin "Tubu Tree trả lời từ 8:00 đến 21:00. Tin của bạn đã được ghi lại." (một lần mỗi ngày mỗi khách).
- Khi cầu nối mất kết nối quá 10 phút: đầu màn chat hiện dòng "Nhân viên có thể trả lời chậm. Cần gấp, gọi hotline 1900…" (số lấy từ `support.hotline`).
- Màn đang mở và đang hiển thị: hỏi tin mới mỗi 5 giây (màn mở báo id các tin Tubu Tree đã thực sự hiển thị; tin cũ hơn trang mới nhất 50 tin coi như đã xem khi khách mở chat). Khi có tin Tubu Tree mới: thông báo trong chuông "Tubu Tree đã trả lời bạn", bấm mở màn chat; chuông chỉ được gửi nếu khách chưa xem câu trả lời trong khoảng 20 giây (job trễ; tin đã thu hồi cũng không báo; không đặt được job thì báo ngay); gộp, tối đa một thông báo mỗi 10 phút mỗi khách, trừ khi khách đã đọc kể từ chuông trước (khi đó tin mới vẫn báo).
- Web khổ điện thoại phải giống Mini App (quy tắc của chủ, `project-web-mobile-equals-miniapp`).

### 4.3 Nhân viên trên Zalo
Tin chuyển vào nhóm có dạng:

```
#K7Q2 · Lan · 09•••••234 · Hạng Vàng
Về đơn TT12345
—
Chị ơi đơn em bao giờ giao ạ?
Ảnh: https://res.cloudinary.com/…
(Trả lời tin này, hoặc gõ #K7Q2 ở đầu câu, để gửi cho khách)
```

- Dòng cuối nêu cả hai cách vì cách trích tin chưa thử trên Zalo thật (mục 9) **(quyết định của agent)**.

- Tin khách gửi liên tiếp trong 15 giây được gộp thành một tin nhóm, để ít lần gửi hơn **(quyết định của agent)**.
- Số điện thoại che giữa, chỉ để nhân viên nhận ra khách **(quyết định của agent)**. Cần tra đủ thì dùng trang admin.
- Nhân viên trả lời bằng cách giữ tin, chọn "Trả lời", gõ câu trả lời. Câu đó về đúng khách của tin được trích.
- Cách dự phòng: gõ mã ở đầu câu, ví dụ `#K7Q2 Dạ đơn giao chiều nay ạ`. Mã không phân biệt hoa thường; hệ thống bỏ mã trước khi gửi cho khách.
- Câu không trích tin chuyển và không có mã: hệ thống bỏ qua (nhân viên trao đổi với nhau trong nhóm được).
- Câu bắt đầu bằng mã không tồn tại (gõ nhầm `#K7Q3`): cầu nối gửi vào nhóm một dòng "Không tìm thấy mã #K7Q3, tin chưa tới khách." để nhân viên biết mình chưa trả lời được **(quyết định của agent)**. Chỉ báo với mã sai, không báo với câu trao đổi thường, để ít tin gửi.
- Ảnh nhân viên gửi kèm trả lời (trích tin): khách thấy ảnh. Sticker, tệp, thoại: bỏ qua.
- Nhân viên thu hồi tin trả lời trong Zalo: tin đó biến khỏi màn chat của khách.
- Khách chỉ thấy "Tubu Tree", không thấy tên Zalo của nhân viên. Tên Zalo nhân viên lưu trong DB để admin biết ai trả lời.
- Nhân viên có thể là chính tài khoản cầu nối (dùng trên điện thoại) hoặc tài khoản riêng của từng người trong nhóm. Cả hai đều chạy.

### 4.4 Admin
Tab mới **Chat CSKH** trong trang admin (ADMIN và STAFF nhóm CSKH):
- **Kết nối Zalo:** trạng thái (Đang kết nối / Mất kết nối từ HH:MM / Cần quét QR / Đăng nhập nơi khác), tên và ảnh tài khoản cầu nối, nút "Đăng nhập Zalo" (mở QR, hỏi trạng thái mỗi 2 giây như MSS), nút "Đăng xuất" (xoá phiên đã lưu ở cầu nối). Đăng nhập và đăng xuất chỉ ADMIN.
- **Nhóm nhận tin:** chọn trong danh sách nhóm của tài khoản cầu nối; nút "Gửi tin thử". Chỉ ADMIN.
- **Cho khách chat:** công tắc `chat.enabled`, có hộp xác nhận. Chỉ ADMIN.
- **Hội thoại:** danh sách sắp theo tin mới nhất, tìm theo số điện thoại hoặc mã `#K7Q2`; lọc "Có tin chưa chuyển được"; mở một hội thoại xem toàn bộ tin, ai trả lời, trạng thái chuyển.
- **Gửi lại:** với tin chuyển lỗi hoặc không rõ kết quả.
- **Chặn chat:** chặn hoặc bỏ chặn một khách quấy rối. Khách bị chặn vẫn đọc được lịch sử nhưng không gửi được, thấy câu "Bạn tạm thời không gửi được tin. Cần hỗ trợ, gọi hotline …". Tin của họ không vào nhóm Zalo **(quyết định của agent)**.
- **Trả lời từ admin:** ô nhập ở cuối hội thoại. Dùng khi Zalo hỏng hoặc khi tiện. Khách thấy như tin Tubu Tree thường. Tin này không gửi vào nhóm Zalo **(quyết định của agent)**; lịch sử trong admin ghi người trả lời.
- Thẻ "Việc cần xử lý" (ops inbox) thêm mục "Chat CSKH: N tin chưa chuyển được vào Zalo" và "Cầu nối Zalo mất kết nối".

## 5. Kiến trúc

```
Mini App / web ──HTTPS──> API (NestJS) ──HTTP nội bộ──> zalo-bridge ──zca-js──> Zalo
                            ^                              │
                            └───── webhook nội bộ ─────────┘
```

### 5.1 `apps/zalo-bridge` (app mới)
- Tiến trình Node riêng, **một bản duy nhất**, chạy thành service `zalo-bridge` trong docker compose, chỉ trong mạng nội bộ `tubu`, không mở cổng ra ngoài. Lý do tách khỏi API: API có thể chạy nhiều bản và khởi động lại khi deploy; mỗi bản mở một kết nối Zalo sẽ đá nhau (mã 3000). MSS cũng tách như vậy.
- `zca-js` ghim `2.1.2`. HTTP server nhỏ; thư viện HTTP để người làm chọn.
- Bí mật dùng chung `ZALO_BRIDGE_SECRET` (≥32 ký tự) cho cả hai chiều, header `Authorization: Bearer`, so bằng `timingSafeEqual`. Thiếu hoặc ngắn thì cầu nối **không khởi động** (bài học MSS, `docs/2026-09-12-mss-saas-readiness-audit.md:50`).
- Phiên đăng nhập `{cookie, imei, userAgent}` lưu ở tệp mã hoá AES-256-GCM (dạng `v1:iv:tag:ct` như `MSS zalo-bridge-process/src/crypto.ts`), khoá `ZALO_BRIDGE_CREDENTIALS_KEY` (32 byte, base64), đường dẫn `ZALO_BRIDGE_DATA_DIR` (volume docker). Không lưu phiên vào DB.
- Khởi động: có phiên thì `login({cookie, imei, userAgent})`, chờ tối đa 60 giây; lỗi thì trạng thái `NEED_QR`. `selfListen: true` để thấy tin nhân viên gõ bằng chính tài khoản cầu nối trên điện thoại.
- Kết nối lại: nghe cả `error`, `closed`, `disconnected` (MSS bỏ sót `closed`/`disconnected`, báo cáo khảo sát mục 1). Lùi 5 giây nhân đôi tới 5 phút. Đóng với mã 3000 thì trạng thái `KICKED` (đăng nhập nơi khác) và **không** tự kết nối lại, chờ admin bấm "Kết nối lại" hoặc quét QR, để không giành phiên với người đang dùng Zalo PC.
- **Chỉ chuyển sự kiện của nhóm đã chọn.** API báo nhóm qua `PUT /config {groupId}`; cầu nối lưu vào tệp trong thư mục dữ liệu. Tin từ mọi cuộc chat khác bị bỏ ngay trong cầu nối, không ghi log nội dung.
- Gửi: hàng đợi một luồng, cách nhau 1,5 giây cộng ngẫu nhiên 0–1 giây; tối đa 300 tin mỗi giờ, vượt thì chờ. Mỗi lệnh gửi có `idempotencyKey`; cầu nối nhớ khoá đã gửi 24 giờ và trả lại `msgId` cũ thay vì gửi lần hai.
- **Bỏ tin tự gửi quay lại (echo).** Với `selfListen`, tin cầu nối vừa gửi có thể quay về trước khi lệnh gửi trả `msgId`. Cầu nối tự lọc, không chuyển về API: (a) `msgId` nằm trong danh sách đã gửi 24 giờ; (b) tin `isSelf` có nội dung trùng đúng một tin đang gửi hoặc đã gửi trong 60 giây. API lọc thêm lớp thứ hai: tin `isSelf` khớp mẫu đầu tin chuyển (`^#[A-Z2-9]{4} · `) hoặc mẫu tin hệ thống của cầu nối thì bỏ.
- Webhook về API: mỗi sự kiện ghi vào hộp thư đi trên đĩa (JSONL trong thư mục dữ liệu) trước khi gửi, xoá khi API trả 2xx, thử lại lùi dần tới 10 phút, giữ tối đa 24 giờ. MSS chỉ thử 4 lần rồi mất sự kiện; ở đây mất sự kiện là mất câu trả lời của nhân viên.
- Điểm cuối (đều cần Bearer):
  - `GET /health` → `{state, zaloUid, displayName, avatar, since, lastError, queueSize, outboxSize, groupId}`; `state` ∈ `CONNECTED | CONNECTING | NEED_QR | KICKED | ERROR`.
  - `POST /qr/start`, `GET /qr/status` → ảnh QR (base64) và trạng thái `WAITING_SCAN | SCANNED | SUCCESS | EXPIRED | FAILED`.
  - `POST /logout` → xoá tệp phiên, ngắt kết nối (thư viện không có lệnh đăng xuất thật, MSS khảo sát mục 1).
  - `POST /reconnect`.
  - `GET /groups` → `[{id, name, memberCount}]`.
  - `PUT /config` → `{groupId}`.
  - `POST /send` → `{idempotencyKey, text, quote?}` vào nhóm đã chọn, trả `{msgId}`; lỗi thì 4xx/5xx kèm mã.
- Sự kiện gửi về API (`POST {API}/api/internal/zalo-bridge/events`): `message` (tin trong nhóm: `msgId, cliMsgId, uidFrom, dName, isSelf, ts, text?, imageUrl?, quote?: {globalMsgId, cliMsgId}`), `undo` (`msgId`), `state` (đổi trạng thái kết nối).

### 5.2 Module `support-chat` trong API
- Khách: `GET /me/support-chat` (hội thoại + 50 tin mới nhất), `GET /me/support-chat/messages?after=<id>` (hỏi định kỳ), `GET /me/support-chat/messages?before=<id>` (tải cũ hơn), `POST /me/support-chat/messages {clientMsgId, body?, imageUrl?, context?}`, `POST /me/support-chat/read`. Lối vào hiện chấm đỏ dựa vào `unreadCount` trong `GET /me/support-chat/summary`.
- Ảnh khách chỉ nhận URL `res.cloudinary.com` (đúng kiểm tra ở `common/uploaded-image.ts:5-8`), không nhận base64.
- Giới hạn: 10 tin mỗi phút, 200 tin mỗi ngày mỗi khách; `clientMsgId` chống gửi trùng khi mạng chập chờn (unique theo hội thoại). Chat tắt thì `POST` trả 409 với câu tiếng Việt, `GET` vẫn đọc được lịch sử.
- Chuyển tin: lưu tin khách xong, đặt job BullMQ hàng đợi mới `support-chat-forward` với `jobId = conv:<id>` và trễ 15 giây (gộp tin). Job lấy mọi tin khách chưa có `forwardId`, tạo một `SupportForward`, gọi `POST /send` với `idempotencyKey = forward.id`, ghi `zaloMsgId`. Lỗi mạng hay 5xx: thử lại theo mặc định hàng đợi (5 lần, lùi dần). Hết giờ chờ mà không rõ kết quả: trạng thái `UNKNOWN`, **không** tự gửi lại (tránh trùng), admin bấm "Gửi lại" (vẫn dùng cùng khoá nên cầu nối không gửi đôi nếu lần trước đã tới).
- Nhận sự kiện: `POST /internal/zalo-bridge/events`, `@Public`, `@SkipThrottle`, kiểm Bearer. Với `message`:
  1. Bỏ nếu `msgId` là một `SupportForward.zaloMsgId` (tin do cầu nối tự gửi, quay lại vì `selfListen`).
  2. Tìm hội thoại: `quote.globalMsgId` khớp `SupportForward.zaloMsgId`; không có thì mã `#XXXX` ở đầu câu khớp `SupportConversation.code`; không có thì bỏ (trả 2xx).
     - Ngoại lệ chống mất tin: tin có `quote` mà chưa khớp, trong khi còn `SupportForward` tạo trong 5 phút qua đang `PENDING` chưa có `zaloMsgId`, thì API trả 503 để hộp thư đi của cầu nối gửi lại sau **(quyết định của agent)**. Quá 5 phút thì bỏ.
     - Mã đầu câu không tồn tại: API trả `{unknownCode: "K7Q3"}`, cầu nối gửi dòng báo ở mục 4.3.
  3. Lưu `SupportMessage` người gửi STAFF, `zaloMsgId` unique (trùng thì bỏ êm), bỏ mã ở đầu câu, `staffName = dName`.
  4. Tạo thông báo trong chuông (gộp 10 phút, `dedupeKey`).
  - Với `undo`: đặt `recalledAt` cho tin STAFF có `zaloMsgId` đó.
  - Với `state`: lưu vào bảng `SupportBridgeStatus` (một dòng), dùng cho dòng cảnh báo phía khách và ops inbox. Không dùng `system_configs` vì cron ghi mỗi phút sẽ làm đầy `SystemConfigHistory`.
- Cron (qua `cron-leader`): mỗi phút gọi `GET /health`, đồng bộ `PUT /config` nếu cầu nối chưa có nhóm; mất kết nối quá 10 phút thì `notify-admins` (tối đa một lần mỗi giờ).
- Admin: `GET/POST` dưới `admin/support-chat/*` cho bridge status, QR, logout, reconnect, groups, test message, danh sách hội thoại, chi tiết, gửi lại, trả lời. Đăng ký vào `common/staff-permissions.matrix.spec.ts` và `endpoint-inventory.spec.ts`. Thao tác đổi cấu hình ghi `SystemConfigHistory` như các khoá khác; đăng nhập, đăng xuất ghi một dòng sự kiện (bảng riêng hoặc dạng `UserAdminEvent`, người làm chọn).
- Chặn `/api/internal/*` ở `Caddyfile` để chỉ gọi được trong mạng nội bộ, ngoài lớp kiểm Bearer **(quyết định của agent)**.

### 5.3 Dữ liệu (Prisma, một migration)
- `SupportConversation`: `id`, `userId` unique (mỗi khách một hội thoại), `code` unique (4 ký tự, bỏ `0 O 1 I`), `lastMessageAt`, `customerReadAt`, `lastOffHoursNoticeOn` (ngày VN), `blockedAt?`, `blockedByUserId?`, `createdAt`, `updatedAt`.
- Đầu tin chuyển: tên hiển thị của khách, số điện thoại che giữa nếu có (không có thì bỏ phần này), hạng nếu có.
- `SupportMessage`: `id`, `conversationId`, `sender` (`CUSTOMER | STAFF | SYSTEM`), `source` (`MINIAPP | WEB | ZALO | ADMIN | SYSTEM`), `body` (≤2.000 ký tự), `imageUrl?`, `context?` (JSON `{orderCode?, productSlug?}`), `clientMsgId?` (unique cùng `conversationId`), `zaloMsgId?` unique, `staffName?`, `adminUserId?`, `forwardId?`, `recalledAt?`, `seenAt?` (khách đã thấy tin STAFF/SYSTEM này; chấm đỏ và chuông dựa vào đây), `createdAt`. Chỉ mục `(conversationId, createdAt)`.
- `SupportForward`: `id`, `conversationId`, `status` (`PENDING | SENT | FAILED | UNKNOWN`), `zaloMsgId?` unique, `attempts`, `lastError?`, `groupId`, `sentAt?`, `createdAt`.
- Khoá cấu hình (seed `createOnly`): `chat.enabled` (`false`), `chat.zalo_group_id` (`""`), `chat.hours` (JSON `{"start":"08:00","end":"21:00"}`, có luật kiểm trong `JSON_RULES`), `chat.off_hours_text` (chuỗi). Public config thêm `chat.enabled`, `chat.hours`. Cờ "cầu nối đang chậm" trả trong `GET /me/support-chat` (không qua public config vì public config được cache lâu).
- `SupportBridgeStatus`: `id` (`'main'`), `state`, `since`, `lastError?`, `zaloUid?`, `displayName?`, `avatar?`, `checkedAt`, `downAlertedAt?`.
- Mẫu thông báo mới `SUPPORT_CHAT_REPLY` kênh INAPP (migration thêm dòng `notification_templates` như các migration mẫu trước).
- Giữ dữ liệu: thêm lớp `support_chat` vào `data-retention.service.ts`, mặc định 365 ngày **(quyết định của agent)**; xoá tài khoản (`account-deletion.service.ts`) xoá hội thoại và tin.

### 5.4 Mini App và web
- Route Mini App `/chat`, web `/ho-tro/chat`, `private: true`, thêm vào `packages/app-core/src/route-map.json` **(quyết định của agent)**.
- Lối vào theo mục 4.2. `zmp-bridge.openOAChat` và `platform-bridge` giữ nguyên cho khi chat tắt.
- Hỏi tin mới: react-query `refetchInterval: 5000` khi màn đang hiện (dừng khi ẩn), lấy `after=<id cuối>`.
- Tin gửi đi hiện ngay (lạc quan) rồi khớp bằng `clientMsgId`.

## 6. Kiểm thử
- `apps/zalo-bridge`: vitest với API Zalo giả tiêm vào (như `__setApiForTesting` của MSS): lọc nhóm, gộp hàng đợi và giãn cách (đồng hồ giả), chống gửi trùng theo khoá, hộp thư đi sống sót khi khởi động lại, trạng thái `KICKED` khi đóng mã 3000, từ chối khởi động khi thiếu bí mật, mã hoá tệp phiên.
- API jest: khớp trả lời theo trích tin, theo mã, bỏ tin không khớp, bỏ tin tự gửi quay lại, thu hồi, giờ ngoài, giới hạn gửi, chat tắt, quyền admin/STAFF.
- Race spec (Postgres thật): khách gửi dồn dập trong 15 giây ra đúng một `SupportForward`; cùng một sự kiện webhook tới hai lần chỉ ra một tin; trả lời tới trước khi job chuyển ghi xong `zaloMsgId` (503, lần sau khớp, không mất); tin echo của cầu nối tới trước khi ghi `zaloMsgId` không thành tin STAFF.
- Mini App vitest và web vitest cho màn chat, lối vào, chấm đỏ; Playwright (mock API) cho luồng gửi và nhận ở Mini App và web khổ 390.
- Không test nào gọi Zalo thật. Thử thật làm tay trên bản gần production (mục 7).

## 7. Ra mắt
1. Gộp với `chat.enabled = false`. Deploy thêm service `zalo-bridge` (biến `ZALO_BRIDGE_SECRET`, `ZALO_BRIDGE_CREDENTIALS_KEY`, volume dữ liệu), API thêm `ZALO_BRIDGE_URL`.
2. Chủ làm mục 4.1. Thử tay: khách gửi chữ, ảnh, ngoài giờ; nhân viên trả lời bằng trích tin, bằng mã, gửi ảnh, thu hồi; tắt mạng cầu nối rồi bật lại; mở Zalo PC bằng tài khoản cầu nối để thấy trạng thái "Đăng nhập nơi khác".
3. Bật cho khách. Hai tuần đầu xem tab Chat CSKH mỗi ngày.

## 8. Việc để người làm tự quyết
- Thư viện HTTP của cầu nối, cấu trúc thư mục, cách đóng gói Docker.
- Chi tiết giao diện màn chat trong khuôn khổ Mini App hiện có (component, màu, khoảng cách theo `design tokens` sẵn có).
- Bảng ghi sự kiện đăng nhập/đăng xuất cầu nối.
- Câu chữ cụ thể của thông báo lỗi, miễn tiếng Việt rõ ràng như phần còn lại của app.

## 9. Chưa kiểm chứng
- `quote.globalMsgId` trong tin nhóm của `zca-js` 2.1.2 bằng `msgId` mà `sendMessage` trả về cho tin được trích. Kiểu dữ liệu (`TQuote.globalMsgId: number`, `SendMessageResult.msgId: number`) cho thấy vậy, nhưng chưa thử trên Zalo thật. Agent không đăng nhập tài khoản Zalo thật nào khi làm (việc ra ngoài, có rủi ro khoá); thử ở bước 2 mục 7. Nếu sai, cách dự phòng bằng mã `#XXXX` vẫn chạy và dòng cuối tin chuyển đã nêu cách đó.
- Ảnh nhân viên gửi qua Zalo dùng link CDN của Zalo; link này có thể hết hạn. Bản đầu lưu link như nhận được.
- Zalo có cho tạo nhóm chỉ hai người (tài khoản cầu nối và một nhân viên) không: chưa thử.
