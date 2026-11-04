# Kiểm vùng xanh (gl-1103): Đổi rác lấy quà, Vườn Xanh và Điểm danh, CTV và Gian hàng

Người kiểm: auditor vùng xanh. Chỉ đọc và đo, không sửa mã, không commit, không đọc hay ghi PROD. Lane 5, persona được ghi: `new`, `ctv`, `ctv_pending`, `dealer`.
Ngày: 2026-11-03. Mã: main 52fd5cd65 (= PROD 0aa8af5d1 + tài liệu).

## Tóm tắt

- Không thấy lỗi P0 hay P1 trong phần kiểm được. Có 3 lỗi P2 (XANH-01, XANH-02, XANH-03), không có P3 đủ chắc để báo.
- Mini 375 kiểm đủ các màn trong vùng: Đổi rác (trang chủ, thể lệ, khai món, chọn điểm, tạo yêu cầu, mã QR, sửa món, huỷ, lịch sử, xong), Vườn Xanh (Hôm nay, Vườn), Điểm danh, quà (Kho quà, Quà của tôi), hạng thành viên, CTV (đăng ký, trang CTV, gian hàng, trình dựng, trang khách `/s/:slug`), đại lý.
- Web 375 chỉ kiểm được một phần: máy chủ web lane 5 (cổng 3252) treo gần hết phiên vì tải máy 90 đến 144. Các lệnh vào `/doi-rac`, `/doi-rac/moi`, `/dai-ly` quá hạn chờ 90 s, 280 s. Phần web dựa vào ảnh chụp có sẵn của `capture.mjs` và đọc mã. Chi tiết ở mục "Chưa kiểm được".
- Mã giữ đúng nhiều điểm backlog cũ (R-52 vùng chạm, R-11 chặn ở API, R-67 đường dẫn chia sẻ `zalo.me/s/...`, R-134 SĐT dạng liên kết, R-10 toast đồng bộ, R-121). Không báo lại.

## Cách chạy (lệnh)

Thư mục làm việc tạm: `/private/tmp/claude-501/-Users-longla-coding-tubutree-mini-app/315ed69b-80dc-466e-bece-22ee1ad7bd37/scratchpad/` (script ở `flows/`, ảnh ghép ở `pairs/`).

- Chụp chuẩn, có thể chạy lại: `node docs/2026-10-28-review/tools/capture.mjs --lane 5 --phase mini375,web375,web1280 --keys recycle,recycle-rules,recycle-new,recycle-points,recycle-r-id,recycle-r-id-edit,recycle-requests,recycle-done-id,game,loyalty,rewards,rewards-mine,affiliate,storefront,s-slug,dealer [--state loading,error500,offline,empty,longtext] [--force]`. Ảnh ở `docs/2026-10-28-review/screens/<nhãn>/` (không commit); chỉ số lỗi API, console, axe, vùng chạm nhỏ ở `docs/2026-10-28-review/screens/index-*.jsonl`.
- Đi luồng có thao tác: `flows/recycle-mini*.mjs` (khai món, chọn điểm, đồng ý thể lệ, tạo yêu cầu, xem QR, sửa món, mở hộp thoại huỷ), `flows/game-mini*.mjs` (điểm danh, bấm đúp), `flows/sf-mini.mjs` (chia sẻ gian hàng), `flows/signup-mini*.mjs` (CTV đăng ký, không gửi).
- Đo hàng Vé giữ lửa: `node flows/measure-freeze.mjs` (persona `new`, Mini 375).
- Ảnh của tôi đã chép vào `docs/2026-11-03-golive/audit/xanh-img/`.

## Phát hiện

### XANH-01 (P2, Mini + web 375) Vườn Xanh, tab Hôm nay: nhãn "Vé giữ lửa:" bị bóp thành 2 đến 3 dòng cạnh nút "Giữ chuỗi (cần thêm 80💧)"

- Khách mới (ít giọt nước) luôn thấy nút dài này, nên đây là trạng thái đầu tiên của hầu hết khách. Hàng là `display:flex; justify-content:space-between; gap:8` với nút `flexShrink:0`, nhãn không có `white-space:nowrap` và không cho xuống hàng, nên nhãn nhường hết chỗ cho nút.
- Đo Mini 375, persona `new` (`node flows/measure-freeze.mjs`): nhãn rộng 62 px, cao 66 px (3 dòng, mỗi dòng 22 px: "Vé", "giữ", "lửa:"), nút rộng 241 px, cao 48 px. Web 375 xuống 2 dòng ("Vé giữ" / "lửa:"), số `0` nằm lẻ giữa nhãn và nút. Web 375 chỉ xem qua ảnh, không đo.
- Mã: `apps/miniapp/src/components/game/checkin-streak.tsx:114-127` (hàng) và `:126` (nhãn nút); `apps/web/src/components/game/checkin-streak.tsx:85-98`; chữ nút ở `packages/app-core/src/game-more-copy.ts:11` (`freezeShort`). Khi đủ nước, nút chỉ còn "Mua (80💧)" nên nhãn không bị bóp.
- Ảnh: `docs/2026-11-03-golive/audit/xanh-img/XANH-01-game-new-mini-web375.png` (trái Mini, phải web, tab Hôm nay, cuộn tới hàng Vé giữ lửa).
- Tái hiện: `node docs/2026-10-28-review/tools/capture.mjs --lane 5 --phase mini375,web375 --keys game` rồi xem `game__new__*__s2.png`.
- Đề xuất: cho hàng `flexWrap: 'wrap'` hoặc xếp dọc (nhãn và số một dòng, nút full width bên dưới, giống nút "Hứng giọt sương" ngay dưới); thêm `white-space: nowrap` cho nhãn. Có thể rút chữ nút thành "Cần thêm 80💧" vì tên nút đã nằm ngay dưới nhãn "Vé giữ lửa". Sửa cả Mini và web cùng lúc để hai nền tảng khớp.
- Công sức S. Owner 2a. Không cần chủ quyết.

### XANH-02 (P2, Mini + web 375 + web 1280) Đổi rác, khách chưa đăng nhập: chữ cứng nói "gửi về kho Tubu" dù cờ gửi bưu điện có thể tắt

- Màn giới thiệu cho khách chưa đăng nhập (`GuestOverview`) lấy chữ tĩnh từ `wasteGuestCopy`: `intro` "Mang bao bì sạch tới điểm nhận hoặc gửi về kho Tubu" và bước 2 "Mang tới điểm nhận hoặc gửi về kho Tubu". Khi đăng nhập xong, danh sách cách giao lại lọc theo `cfg.waste.{dropoff,mailin,pickup}` và `me.laneFlags` (`apps/miniapp/src/pages/recycle.tsx:322-330`). Bật `waste.enabled` mà để `waste.mailin` tắt (mở từng bước) thì khách đọc lời hứa "gửi về kho" rồi đăng nhập và không thấy cách đó.
- Mã: `packages/app-core/src/waste-copy.ts:10` và `:12`; dùng ở `apps/miniapp/src/pages/recycle.tsx:119,127` và `apps/web/src/components/recycle/recycle-home.tsx:110,115`. Cờ công khai đã có sẵn: `WastePublicFlags { enabled, dropoff, mailin, pickup }` (`packages/shared-types/src/waste.ts:50`), nên màn khách đọc được mà không cần thêm API.
- Ảnh: `docs/2026-11-03-golive/audit/xanh-img/XANH-02-recycle-guest-mini375.png` (guest, Mini 375, màn `recycle`).
- Tái hiện: `node docs/2026-10-28-review/tools/capture.mjs --lane 5 --phase mini375 --keys recycle` rồi xem `recycle__guest__mini375__s1.png`; đặt `waste.mailin` = false trong cấu hình lane rồi chụp lại.
- Đề xuất: dựng `intro` và `steps[1]` từ cờ: chỉ nêu "gửi về kho Tubu" khi `cfg.waste.mailin` bật, chỉ nêu "Mang tới điểm nhận" khi `cfg.waste.dropoff` bật; khi cả hai tắt thì dùng câu trung tính ("Tubu nhận bao bì sạch, đếm xong là cộng Điểm Xanh"). Dùng chung một hàm trong app-core cho Mini và web, thêm một ca vào spec của `waste-copy`.
- Công sức S. Owner 2a. Không cần chủ quyết (không đổi luật điểm, chỉ khớp chữ với cờ).
- Chưa kiểm: không biết cờ `waste.mailin` trên PROD sẽ bật hay tắt lúc mở (không đọc PROD); lỗi chỉ xảy ra khi tắt.

### XANH-03 (P2, Mini + web) Hạng thành viên: quyền lợi ghi "Freeship", trái bảng thuật ngữ của DESIGN.md

- Màn Điểm thưởng/Hạng, mục "Quyền lợi của bạn", hiện nguyên chuỗi từ dữ liệu: "Freeship đơn ≥ 99k" (Lộc Biếc), "Freeship toàn shop" (Đại Thụ), "Freeship + giảm 5% mọi đơn" (Cổ Thụ). `DESIGN.md:179` cấm "Freeship", dùng "Miễn phí giao hàng". Máy quét chữ `terminology.spec.ts` không thấy vì chuỗi nằm trong dữ liệu, không nằm trong mã. Client chỉ đổi dấu nhân (`tierPerkLabel`, `packages/app-core/src/number-format.ts:29`), không đụng chữ "Freeship".
- Nguồn: `apps/api/prisma/seed.ts:380,391,402` và các migration `20261011110000_pd1_review_wording` (đã đặt chuỗi này). Đổi chữ trong seed không đổi dữ liệu PROD đã có: cần migration cập nhật `membership_tiers.perks` hoặc khách sửa trong admin. Không kiểm PROD nên chưa biết PROD còn đúng các chuỗi này không.
- Ảnh: `docs/2026-11-03-golive/audit/xanh-img/XANH-03-loyalty-returning-mini-web375.png` (Mini trái, web phải).
- Tái hiện: `node docs/2026-10-28-review/tools/capture.mjs --lane 5 --phase mini375,web375 --keys loyalty` rồi xem `loyalty__returning__*__s2.png`.
- Đề xuất: đổi thành "Miễn phí giao hàng đơn từ 99k", "Miễn phí giao hàng toàn gian hàng Tubu" (hoặc "mọi đơn"), "Miễn phí giao hàng và giảm 5% mọi đơn". Sửa `seed.ts` và thêm migration cập nhật `perks` đúng khi chuỗi còn là bản cũ (giống kiểu `pd1_review_wording`). Về sau thêm ca quét vào `terminology.spec` cho dữ liệu seed tier.
- Công sức S. Owner db (seed và migration, vùng loyalty). Không cần chủ quyết cho riêng việc đổi chữ; nội dung cam kết quyền lợi vẫn thuộc R-116 (chủ quyết) và tôi không đề xuất đổi.

## Đã kiểm, không có lỗi (để người sau khỏi lặp lại)

- Đổi rác, luồng ghi dữ liệu (Mini 375, persona `new`, lane 5): chọn món ("Thêm 5"), bước 2 chọn "Mang tới điểm nhận", chọn điểm, đồng ý thể lệ, "Tạo yêu cầu" ra mã `TR-...`, "Xem mã QR" mở tờ QR có mã, hạn giữ chỗ, "Sửa món", "Lưu", mở hộp thoại "Huỷ yêu cầu". Không có pageError, không lỗi console trong các luồng này. Tôi mở hộp thoại huỷ nhưng không xác nhận huỷ.
- Điểm danh và Vườn (persona `new`, `returning`): bấm đúp nút nhận chỉ gửi 1 yêu cầu POST (khoá `busyRef`, `isSameVNDay`); tab Hôm nay và Vườn khớp giữa Mini và web 375 (trừ XANH-01).
- Chia sẻ gian hàng CTV (persona `ctv`): tờ chia sẻ ra liên kết `zalo.me/s/...` đúng (R-67 đã xong).
- CTV chưa đăng ký (persona `new`, Mini): `/storefront` dừng ở bước 1 "Điều kiện" với ba điều kiện "Chưa đạt" và nút "Đăng ký làm Cộng tác viên"; nút dẫn tới `/affiliate` có điều khoản hoa hồng và thuế, nút đăng ký tắt cho tới khi tick đồng ý ("Chọn ô đồng ý điều khoản để đăng ký"). Chưa bấm gửi đăng ký. Ảnh: `xanh-img/ctv-signup-landing-new-mini375.png`.
- Bảo mật, thăm dò API bằng token persona trên lane 5 (đọc): `GET /waste/requests/:id` của người khác trả 404 (không lộ tồn tại); gian hàng chờ duyệt hoặc không tồn tại trả 404 ở `/s/:slug`; không token trả 401; `/storefront/me` của `new` trả 200 thân rỗng; `/affiliate/me` và `/dealer/me` của người chưa là thành viên chỉ trả cờ `false`, không lộ dữ liệu.
- Web 1280 Đổi rác (persona `returning`): trang chủ và bước khai món bố cục hợp lý, nội dung căn giữa, khai món chia lưới 2 cột; ảnh `xanh-img/recycle-home-new-web1280.png`.
- Chỉ số chụp (lời gọi API lỗi, console, axe, vùng chạm nhỏ) của các khoá vùng này: không có pageError. Các lỗi 429 ở `/auth/refresh` và `/auth/zalo-mini-app` là do lane bị dồn tải, không phải lỗi sản phẩm; tôi chụp lại `game` và `dealer` với `--force` để bỏ ô hỏng.
- Đã xét, không báo: `GET /waste/points` trả 403 khi khách vãng lai (token `/auth/guest`) mở thẳng `/recycle/points` không có state (`recycle-points__guest__mini375`: `apiErrors` có 403, một dòng console). Gốc: `enabled: phase === 'authenticated'` (`apps/miniapp/src/pages/recycle-points.tsx:57-62`) coi token khách vãng lai là đã đăng nhập; trang sau đó tự chuyển đi (`:51-55`). Không có đường bấm tới màn này khi thiếu state nên khách không gặp, không báo.
- Đã xét, không báo: khoảng trắng nhỏ trước dấu ")" và "," sau biểu tượng giọt nước ("+60💧 , các ngày sau", "(cần thêm 80💧 )") là do glyph emoji của trình duyệt, chữ nguồn không có khoảng trắng (`game-more-copy.ts:2`); chưa chắc tái hiện trên máy thật.

## Chưa kiểm được (nói rõ)

- Web 375 của Đổi rác (`recycle`, `recycle-rules`, `recycle-new`, `recycle-points`, `recycle-r-id`, `recycle-r-id-edit`, `recycle-requests`, `recycle-done-id`) và `dealer`: chưa có ảnh web 375, máy chủ web lane 5 không trả lời (xem trên). Chỉ đối chiếu bằng mã: web dùng chung `waste-copy.ts` với Mini nên XANH-02 áp cả hai. Khuyến nghị chụp lại khi tải máy xuống: `node docs/2026-10-28-review/tools/capture.mjs --lane 5 --phase web375 --keys recycle,recycle-rules,recycle-new,recycle-points,recycle-r-id,recycle-r-id-edit,recycle-requests,recycle-done-id,dealer`.
- Web 375 và web 1280 cho persona khác `returning` (`guest`, `ctv`, `ctv_pending`, `dealer`, `new`): chưa kiểm, chỉ có ảnh persona `returning` và `new` ở một số màn.
- Trạng thái chờ (loading) của các màn vùng xanh: ảnh có chụp nhưng tôi chỉ xem đại diện ca lỗi 500, ngoại tuyến, rỗng, chữ dài ở Mini; không kết luận về loading.
- Luồng ghi chưa đi: gửi đăng ký CTV (chỉ xem tới màn điều khoản), trình dựng gian hàng (thêm ảnh bìa, bộ sưu tập, đăng), xác nhận huỷ yêu cầu đổi rác, đổi quà thật ở Kho quà, đặt hàng sỉ và công nợ của đại lý (chỉ xem màn đại lý trên Mini).
- Thiết bị thật trong Zalo (ZMP): mọi thứ chạy trên Chromium giả lập 375 px; không kiểm vùng chạm thật, cuộn trong webview, bàn phím ảo, xin vị trí.
- PROD: không đọc, nên không biết cờ `waste.*` và nội dung `membership_tiers.perks` trên PROD.
