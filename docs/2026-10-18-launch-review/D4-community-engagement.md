# D4 — Tương tác, giao lưu, cộng đồng (launch review 2026-10-18)

Phạm vi đọc: api `modules/{feed,reviews,academy,faq,game,loyalty,notifications,lifecycle,groupbuy,flash-sale,wishlist,ai-advisor}`, miniapp `pages/{feed,post-detail,community-*,academy,game,loyalty,notifications,group-buy,ai-advisor}`, web admin, 3 spec (community-qa, vuon-xanh, flash-sale). Chỉ đọc mã, không chạy gì. Đường dẫn tính từ `apps/` trừ khi ghi khác. Đã loại phần đổi rác/Refill/Gomdon và các việc tồn của n5-polish.

## 1. Tóm tắt

1. Mức hoàn thiện nhánh này: khoảng 60%. Mã chạy được cho hầu hết 16 vòng tương tác, có chống gian lận và trần thưởng khá kỹ. Thiếu nằm ở nội dung khởi tạo, vận hành hằng ngày và đường kéo khách quay lại.
2. Lỗ hổng lớn 1: nội dung khởi tạo (chủ đề cộng đồng, 46 câu quiz, loài cây, nhiệm vụ, mục tiêu cộng đồng, 6 mẫu thông báo) chỉ nằm trong `seed.ts`, mà seed bị chặn ở production và runbook nói prod không chạy seed lại. Không có migration nào nạp chúng (D4-001).
3. Lỗ hổng lớn 2: mọi đường kéo khách quay lại đều là in-app. ZNS chỉ có hai mẫu đơn hàng và cả hai chưa có `zaloTemplateId`. Khách không mở app thì không nhận được gì từ quiz, vòng quay, flash sale, mua chung, mời đánh giá (D4-004, D4-005).
4. Lỗ hổng lớn 3: cộng đồng ngày đầu trống và không ai trông. Không bài mẫu, không danh tính shop, kiểm duyệt chỉ ADMIN và chỉ trong miniapp, không có cảnh báo nào cho người trực khi có câu hỏi hoặc bài chờ duyệt (D4-002, D4-003).
5. Vòng giới thiệu bạn gần như không gắn với các nút chia sẻ: chia sẻ sản phẩm và mua chung không kèm `?ref=`, chia sẻ bài cộng đồng không tồn tại (D4-007, D4-011).
6. Vòng game có lỗi thiết kế nhỏ nhưng ảnh hưởng thói quen: quiz lặp đúng 5 câu mỗi ngày, bảng "tuần" thực chất là all-time (D4-009, D4-010).
7. Không phát hiện P0 do lỗi mã trong nhánh này. Chỉ D4-001 là P0 có điều kiện (nếu prod không chạy seed lần đầu).
8. TODO/FIXME trong phạm vi: hai dòng TODO ở tích hợp Zalo OA (mục 2C). Cờ tắt: `SEASON_PASS_ENABLED=false`, `CASHBACK_ENABLED=false`, đều là quyết định đã ghi của chủ dự án.
9. Cần chủ dự án quyết hoặc cung cấp nội dung: 11 trong 22 phát hiện (lịch sự kiện, quà, bài khởi tạo, khóa học, nhóm/kênh ngoài, mẫu ZNS/OA).
10. Đề xuất ưu tiên: (a) nạp nội dung khởi tạo an toàn cho prod, (b) kênh OA/ZNS kéo về, (c) gắn `ref` vào mọi nút chia sẻ, (d) đưa cộng đồng vào hộp việc của CSKH.

## 2. Bảng phát hiện

Quy ước mức: P0 chặn ra mắt, P1 nên có trước ra mắt, P2 sau ra mắt, P3 nhỏ. Công sức: S nhỏ, M vừa, L lớn.

| ID | Mức | Vai trò | Hiện trạng + bằng chứng | Đề xuất | Công sức | Cần chủ dự án quyết? |
|---|---|---|---|---|---|---|
| D4-001 | P0 (nếu prod không chạy seed) | khách, admin | Chủ đề cộng đồng (`community-categories-seed.ts`, gọi từ `api/prisma/seed.ts:16,1018`), 46 câu quiz (`seed-game-quiz.ts`, gọi `seed.ts:976`), `MISSIONS` 4 nhiệm vụ (`seed.ts:840-845`), `CommunityGoal` (`seed.ts:981`), `PlantSpecies`, `Season` (`seed.ts:1013`) chỉ có trong seed. Đã dò migration: không có `INSERT INTO` cho `community_categories`, `game_quizzes`, `community_goals`, `missions`, `plant_species`, `seasons`. Sáu mẫu thông báo `COMMUNITY_POST_APPROVED`, `COMMUNITY_NEW_ANSWER`, `COMMUNITY_EXPERT_REPLIED`, `GAME_CHECKIN_REMINDER`, `GAME_TREE_THIRSTY`, `GAME_WATER_GIFT` cũng chỉ ở seed (dò `prisma/migrations`: 0 kết quả). Seed bị chặn khi `NODE_ENV=production` (`api/src/modules/system-config/seed-guard.ts:8-10`); runbook nói prod không nên seed lại (`docs/2026-09-12-deploy-runbook.md:294-296`). Thiếu mẫu thì khách nhận câu chung `MISSING_TEMPLATE_BODY` (`api/src/modules/notifications/notifications.service.ts:13,79`). | Viết một migration idempotent (`ON CONFLICT DO NOTHING`, giống `20261010150000_reference_data_templates_voucher_eta`) nạp chủ đề, quiz, nhiệm vụ, loài cây, mục tiêu và 6 mẫu. Hoặc script `seed:content` an toàn prod. | M | Y: lần lên prod đầu tiên có chạy seed (ALLOW_PROD_SEED=1) trên DB mới không? |
| D4-002 | P1 | khách, marketing | Cộng đồng ngày đầu trống: không seed bài (`seed.ts` không có `feedPost`); empty state chung "Chưa có bài viết nào / Hãy là người đầu tiên..." (`miniapp/src/i18n/vi.ts:676-677`, `pages/feed.tsx:239`). Không có danh tính shop: staff đăng dưới tên cá nhân với huy hiệu "Chuyên gia Tubu" (`api/src/modules/feed/author-badge.ts:3-6`); `CreatePostInput` không có trường đăng thay (`community-feed.service.ts:71-80`). Ghim chỉ ADMIN trong miniapp (`pages/post-detail.tsx:131,254`). Tài khoản khách không có đơn thì bài thành PENDING (`community-feed.service.ts:256,452`), nên 100% bài đầu của khách mới chờ duyệt. | Tài khoản chính thức "Tubu Tree" (huy hiệu OFFICIAL, avatar logo); 8-12 bài khởi tạo (3 hỏi đáp, 3 mẹo, 3 trải nghiệm thật); ghim 2 bài (nội quy, "Hỏi Tubu"); đổi empty state thành lời mời có nút. | M | Y: ai viết 10 bài đầu, có ảnh thật; chấp nhận bài do shop đăng dưới tên Tubu? |
| D4-003 | P1 | CSKH, admin | Kiểm duyệt chỉ ADMIN: controller dùng `@Roles('ADMIN')` ở `community-feed.controller.ts:90,96,113,127,133,139,145,221-239`, không có `@AllowStaff`. Chỉ có giao diện trong miniapp (`pages/community-moderation.tsx`, lối vào `pages/admin.tsx:105`). Web admin không có tab cộng đồng (`web/src/app/admin/page.tsx:225-246`). Hộp việc vận hành không có khóa cộng đồng (`api/src/modules/ops/ops-inbox.service.ts`, dò "community": 0 kết quả). Không có cảnh báo cho câu hỏi chưa trả lời hoặc bài chờ duyệt. | Cho phép `CSKH` duyệt/ẩn/trả lời; thêm vào ops-inbox 3 số (bài chờ duyệt, báo cáo, câu hỏi chưa trả lời quá 12 giờ); tab "Cộng đồng" trên web admin. | M | N (mặc định: CSKH được duyệt, chỉ ADMIN chọn người thắng và ghim) |
| D4-004 | P1 | khách, marketing | Kéo khách về chỉ in-app. Mẫu ZNS duy nhất là ORDER_CONFIRMED/SHIPPING và chưa có `zaloTemplateId` nên khách nhận bản in-app (`api/prisma/seed.ts:694-697`). Nhắc game 11h (`game/game-reminder.service.ts:48`), flash sắp mở (`flash-sale/flash-sale.service.ts:470,543`), mua chung xong/hỏng (`groupbuy/groupbuy.cron.ts:12`), mời đánh giá 10h/19h (`lifecycle/review-invite.service.ts:48`) đều gọi `NotificationsService.notify`, kênh INAPP. Chỗ duy nhất mời theo dõi OA là sau đơn đầu (`miniapp/src/pages/order-detail.tsx:142-149`). | Xin duyệt sớm 2-3 mẫu ZNS giao dịch (mời đánh giá, mua chung thành công/thất bại); dùng OA tin chăm sóc trong cửa sổ 48 giờ cho phần còn lại; đặt lời mời theo dõi OA ở trang chủ và sau đánh giá. Quy định ZNS hiện hành: chưa kiểm. | M (cần duyệt 7-14 ngày) | Y: dùng tên mẫu/nội dung nào để nộp Zalo duyệt; ai nộp? |
| D4-005 | P1 | marketing, admin | Không có công cụ gửi thông báo thủ công hoặc theo nhóm: tab "Mẫu thông báo" chỉ sửa mẫu (`web/src/app/admin/page.tsx:246`), không thấy endpoint broadcast trong `notifications.controller.ts` (chưa kiểm hết các module khác). Marketing không báo được "sự kiện bắt đầu", "có người thắng". | Gửi thông báo in-app/OA theo nhóm (tất cả, đã mua, theo hạng) kèm lịch hẹn, có trần tần suất. | M | Y: ai được gửi, tối đa mấy tin/tuần/khách? |
| D4-006 | P1 | khách | Chỉ bài `QUESTION` báo tác giả khi có bình luận (`community-feed.service.ts:673-689`). Bài SHOWCASE/TIP/MANUAL được thích hoặc bình luận thì tác giả không biết gì; các điểm `notify(` còn lại chỉ ở duyệt, từ chối, câu trả lời hay, người thắng (`:557,577,792,1169`). Người đăng không có lý do quay lại. | Báo tác giả khi có bình luận/thích, gộp theo bài, tối đa 1 tin/bài/ngày. Cần thêm mẫu thông báo. | S | N |
| D4-007 | P1 | khách, marketing | Giới thiệu bạn tách rời các nút chia sẻ. `?ref=` chỉ do người dùng chủ động ở Ví (`pages/wallet.tsx:96-104`); app có đọc `ref` (`components/app.tsx:158-160`). Nhưng chia sẻ sản phẩm không kèm ref (`pages/product-detail.tsx:309-321`), chia sẻ mua chung cũng không (`pages/group-buy.tsx:69-78`), bài cộng đồng không có nút chia sẻ (chưa thấy trong `components/community/post-card.tsx`, chưa kiểm sâu). Người mua mới không biết ai giới thiệu, người chia sẻ không được thưởng. | Chèn `referralCode` của người dùng vào mọi đường dẫn chia sẻ (sản phẩm, mua chung, bài, thu hoạch cây); thêm nút chia sẻ ở bài cộng đồng. | S-M | N |
| D4-008 | P1 | khách, marketing | Sự kiện vận hành thủ công và vô hình sau khi đóng. `listEvents` chỉ trả `OPEN` (`community-feed.service.ts:1036-1040`); không có cron đóng tự động (chỉ có 2 chỗ đóng: `:1133`, `:1159`); mỗi sự kiện đúng 1 người thắng (`:1148`); tạo bằng tay trong miniapp admin. Khách không thấy người thắng nên sự kiện không tạo thêm động lực. Không có lịch. | Trang "Sự kiện đã kết thúc" kèm người thắng, tự đóng khi hết hạn, báo mọi người dự thi, mẫu sự kiện hàng tháng. | M | Y: lịch sự kiện 3 tháng đầu và quà (điểm hay hiện vật)? |
| D4-009 | P1 | khách | Quiz lặp: `getTodayQuiz` không `orderBy` và chỉ loại câu đã làm trong ngày (`api/src/modules/game/game-quiz.service.ts:28-45`), nên thứ tự không xác định theo DB, thực tế thường là cùng vài câu đầu mỗi ngày (chưa kiểm trên DB thật); 46 câu không có cơ chế quay vòng. Hằng số 5 câu/ngày ở `seed.ts:153`. | Sắp xếp theo băm (userId, dayKey) hoặc loại câu đã từng trả lời; thêm câu mới hằng tháng. | S | N (nội dung thêm câu: cần người viết) |
| D4-010 | P2 | khách | Nhãn "Bảng xếp hạng tuần" (`miniapp/src/components/game/weekly-leaderboard.tsx:9`) nhưng dữ liệu xếp theo `longestStreak` all-time (`game/game.service.ts:671-678`). Người mới không thể lên top, bảng không đổi theo tuần. | Đổi nhãn "Chuỗi dài nhất" hoặc tính điểm tuần thật (reset thứ Hai) kèm thưởng top 3. | S | Y: thưởng top tuần là gì? |
| D4-011 | P1 | khách | "Quà bạn bè" chỉ hiện khi đã có bạn (`pages/game.tsx:209-210`); bạn bè là mạng giới thiệu (`game/game-gift.service.ts:76-77`). Đa số khách mới không thấy khối này và không có nút mời. | Khi chưa có bạn, hiện thẻ "Mời bạn, hai người cùng nhận" kèm ref. | S | N |
| D4-012 | P2 | admin, marketing | Không có giao diện admin cho mục tiêu cộng đồng, loài cây, quiz, mùa: tab web chỉ có Nhiệm vụ & quà đổi điểm, Đánh giá, Flash Sale... (`web/src/app/admin/page.tsx:225-246`). Mục tiêu "Cùng Tubu góp quỹ trồng cây" khởi tạo `currentDrops: 0`, mục tiêu 100.000 (`seed.ts:981-989`). Season Pass tắt (`miniapp/src/utils/features.ts:7`), mùa duy nhất hết hạn 31/08 (`seed.ts:1013`): vẫn còn C-044. | Tab web CRUD cho quiz và mục tiêu cộng đồng; mùa chờ quyết định bật lại. | M | Y: có bật lại Chặng Mùa không? (mặc định: không, giữ ẩn) |
| D4-013 | P2 | admin | Nhiệm vụ không tạo được từ giao diện (chỉ sửa) và cả 4 nhiệm vụ mẫu đều không liên quan cộng đồng (`seed.ts:840-845`): thiếu "đăng bài đầu tiên", "trả lời 3 câu hỏi", "chia sẻ sản phẩm". | Thêm 3 nhiệm vụ cộng đồng và nút "Tạo nhiệm vụ". | S-M | N |
| D4-014 | P2 | khách | Đánh giá: thưởng 15/10/5 điểm viết cứng (`api/src/modules/reviews/reviews.service.ts:180-183`), không chỉnh được bằng cấu hình. Bảng `Review` không có cột trả lời của shop (`api/prisma/schema.prisma:2642-2656`). Admin ẩn/hiện được (`reviews.controller.ts:74`, `web/src/components/admin/reviews-tab.tsx`). | Đưa mức thưởng vào SystemConfig; thêm "Tubu trả lời" dưới đánh giá (nhất là đánh giá thấp sao). | M | N |
| D4-015 | P2 | đại lý, khách | Academy chỉ cho CTV/STAFF/ADMIN (`api/src/modules/academy/academy.controller.ts:7`); trống thì hiện "Tubu sẽ sớm thêm khoá học đào tạo cho CTV" (`miniapp/src/i18n/vi.ts:789`). Khách thường không có nội dung học. | Nạp 3-5 bài đầu cho CTV trước ra mắt (sản phẩm, cách bán, quy tắc hoa hồng). | M (nội dung) | Y: ai soạn khóa học đầu, hình thức (video/bài chữ)? |
| D4-016 | P2 | khách | AI tư vấn chạy theo khóa (`ai-advisor.service.ts:61`, `llm.client.ts:13,27-30`), không có khóa thì tắt êm. Không có chuyển người thật, không có liên kết sang cộng đồng/CSKH khi AI không trả lời được. `GO-LIVE-KEYS.md` không có dòng Gemini (DeepSeek: chưa kiểm). `GEMINI_BASE_URL` tùy chỉnh được (`config/env.validation.ts:124`), giá trị prod chưa rõ. | Thêm nút "Hỏi CSKH/đăng lên Hỏi đáp" trong màn tư vấn; ghi rõ khóa AI trong GO-LIVE-KEYS. | S | Y: bật AI lúc ra mắt không, dùng nhà cung cấp nào? |
| D4-017 | P2 | khách, marketing | Không có lối ra kênh cộng đồng ngoài (nhóm Zalo, fanpage, TikTok): màn Giới thiệu chỉ có tên Zalo OA (`miniapp/src/pages/about.tsx:81`); dò `feed.tsx`, `support-contact.tsx` không thấy liên kết. Cộng đồng trong app là kênh duy nhất. | Thêm ô liên kết cấu hình được (SystemConfig) vào Giới thiệu và đầu Cộng đồng. | S | Y: có nhóm Zalo/fanpage nào để dẫn không? |
| D4-018 | P2 | khách | Không có liên kết hai chiều sản phẩm và cộng đồng: bài có nút mua (`pages/post-detail.tsx` khoảng `:395`) nhưng trang sản phẩm chỉ có đánh giá (`web/src/app/san-pham/[slug]/product-reviews.tsx`), không có "hỏi đáp về sản phẩm này" (chưa kiểm sâu `product-detail.tsx`). Không có hồ sơ thành viên, "Bài của tôi" (không có route trong `components/app.tsx`). | Khối "Hỏi đáp sản phẩm" lấy bài theo `productSlugs`; trang "Bài của tôi". | M | N |
| D4-019 | P2 | khách, kế toán | Vòng quay mua lượt: trọng số tổng 100; kỳ vọng điểm/lượt = 0,30×5 + 0,22×10 + 0,12×20 + 0,05×50 = 8,6 điểm, cộng voucher danh nghĩa 0,10×20k + 0,04×50k = 4.000đ và 4,5 💧 (`seed.ts:195-208`); giá mua 10 điểm, tối đa 5 lượt/ngày (`seed.ts:151-152`). Kỳ vọng điểm gần hòa vốn, voucher là phần dư. Voucher có hệ số đơn tối thiểu 6 (`seed.ts:158`). Chưa kiểm chi phí thật khi quy ra đồng. | Chủ dự án xác nhận mức chi cho game mỗi khách/tháng; nếu cần, đổi trọng số. | S | Y: ngân sách thưởng game/tháng là bao nhiêu? |
| D4-020 | P3 | khách | Hai điểm danh mỗi ngày (điểm danh Điểm Xanh `loyalty.service.ts:888-900`, mặc định `[1,1,1,1,1,1,2]` ở `:1378`, và điểm danh Vườn) vẫn còn: C-082. | Giữ nguyên trước ra mắt; gộp sau. | M | N |
| D4-021 | P3 | admin | Khóa `community.rep_*` (`rep_post`, `rep_thresholds`, `daily_rep_cap`: `community-feed.service.ts:152-153,204,518`) không có trong seed, nên admin không thấy ở tab Cấu hình (tab chỉ liệt kê dòng đã có); đang chạy bằng mặc định mã. | Nạp các khóa này trong migration của D4-001. | S | N |
| D4-022 | P3 | khách, admin | Bài được duyệt giữ `createdAt` gốc nên chìm dưới bài mới (`community-feed.service.ts:527-560`, chưa kiểm sắp xếp ở danh sách). Admin ẩn bài không báo tác giả (chỉ có thông báo duyệt/từ chối: `:557,577`). | Báo tác giả khi bài bị ẩn; cân nhắc `publishedAt`. | S | N |

### 2A. Bản đồ các vòng tương tác hiện có

| Vòng | Kích hoạt | Thưởng | Vì sao khách quay lại | Kéo về (OA/ZNS/in-app) | Kiểm duyệt |
|---|---|---|---|---|---|
| Đăng bài (SHOWCASE/TIP/MANUAL) | Nút đăng ở `pages/feed.tsx`, `components/community/post-composer.tsx` | 1 điểm Xanh, trần 1 bài/ngày (`seed.ts:90-91`), cộng danh tiếng (`community-feed.service.ts:518`) | Thấy bài được thích/bình luận: nhưng không có thông báo (D4-006) | In-app khi duyệt/từ chối (`:557,577`) | Lai: khách đã có đơn DELIVERED hoặc staff đăng ngay; còn lại PENDING; bộ lọc từ khóa ép PENDING (`content-filter.ts`, `seed.ts:95`); báo cáo/ẩn; chỉ ADMIN duyệt |
| Hỏi đáp (QUESTION) | Đăng bài loại hỏi | Trả lời 0 điểm mặc định, câu hay nhất 1 điểm (`seed.ts:92-96`) | Có người trả lời, được chọn hay nhất | In-app `COMMUNITY_NEW_ANSWER`/`COMMUNITY_EXPERT_REPLIED`/`COMMUNITY_BEST_ANSWER` (`:673-689,792`) | Như trên; staff trả lời mang huy hiệu Chuyên gia |
| Bình luận, thích | Trên `post-detail.tsx` | Danh tiếng, không điểm | Chưa thấy lý do | Không (trừ QUESTION) | Giới hạn tốc độ (`controller:162,196,211`), lọc từ khóa |
| Sự kiện | Admin tạo trong miniapp | Một người thắng nhận `rewardPoints` | Chờ kết quả | In-app người thắng (`:1169`) | Admin chọn người thắng |
| Bảng xếp hạng | `community-leaderboard.tsx`, khối trong `game.tsx` | Không thưởng | Thứ hạng | Không | Không |
| Vườn cây | Vào app mỗi ngày | 💧 đăng nhập 10, sương 15 (`seed.ts:154,160`), chuỗi 7 ngày thưởng thêm (`seed.ts:150`), thu hoạch ra coupon, trần 3/ngày (`seed.ts:157`) | Chuỗi ngày, vé giữ lửa 80💧 (`seed.ts:161`), cây khát | In-app nhắc 11h (`game-reminder.service.ts:48`, `GAME_TREE_THIRSTY`) | Trần coupon thu hoạch/ngày (`seed.ts:157`) |
| Vòng quay | Lượt miễn phí + mua 10 điểm (≤5/ngày) | Bảng giải `seed.ts:195-208` | Hy vọng trúng | Không riêng | Giới hạn ngày (C-043 đã sửa) |
| Quiz | Mục quiz trong game | 5 câu/ngày (`seed.ts:153`) | Thói quen hằng ngày: nhưng lặp (D4-009) | Không riêng | Unique (user, quiz, ngày) `schema.prisma:2573-2602` |
| Nhiệm vụ | Tab nhiệm vụ | 15-50 điểm (`seed.ts:840-845`) | Mục tiêu một lần | Không | Chưa kiểm cách ghi nhận tiến độ |
| Điểm danh | Trang Loyalty | `[1,1,1,1,1,1,2]` điểm/tuần | Chuỗi 7 ngày | Không | Một lần/ngày |
| Mua chung | Từ trang sản phẩm (`product-detail.tsx:244`) | Giảm 15% khi đủ 3 người trong 48 giờ (`seed.ts:181-183`) | Rủ bạn cho đủ nhóm | In-app khi xong/hỏng (`GROUP_BUY_SUCCESS/FAILED`), cron 15 phút | Trần 3 nhóm mở/người (`seed.ts:184`) |
| Flash sale | Admin đặt lịch | Giá sốc | Nhắc theo wishlist | In-app `FLASH_STARTING` (cron mỗi phút `flash-sale.service.ts:470`) | Admin |
| Đánh giá có ảnh/video | Sau đơn giao, mời lúc 10h/19h | 5/10/15 điểm (`reviews.service.ts:183`) | Điểm thưởng | In-app `REVIEW_REQUEST` | Admin ẩn/hiện (`reviews.controller.ts:74`), unique theo đơn (C-110 đã sửa) |
| Academy | Menu CTV | Không | Kiến thức bán hàng | Không | Admin |
| Giới thiệu bạn | Mã ở Ví | Nhiệm vụ INVITE_3 50 điểm (`seed.ts:844`); thưởng giới thiệu khác: chưa kiểm | Nhiệm vụ INVITE_3 | Không | Chống tự giới thiệu: chưa kiểm |
| Tư vấn AI | Lối tắt ở trang chủ (`home-extras.tsx:43`) | Không | Hỏi đáp nhanh | Không | Gate khóa, fallback offline |

### 2B. Ngày đầu rỗng: người dùng thấy gì

- Mở Cộng đồng: danh sách chủ đề rỗng nếu D4-001 chưa được xử lý (bài vẫn đăng được vì `categoryId` tùy chọn: `community-feed.service.ts:73`), feed hiện "Chưa có bài viết nào" (`vi.ts:676`).
- Bảng xếp hạng cộng đồng rỗng; khối game "Quà bạn bè" biến mất (D4-011); khối mục tiêu cộng đồng ở 0/100.000💧.
- Không có bài ghim, không có bài của shop, không có sự kiện đang mở (cần admin tạo).
- Staff đăng thay mặt shop: không có cơ chế. Staff đăng bằng tài khoản cá nhân, hiện huy hiệu Chuyên gia (`author-badge.ts:5`), được duyệt thẳng nhờ vai trò.

### 2C. Kết quả grep TODO/FIXME/placeholder/flag

- `api/src/modules/integrations/zalo-oa/zalo-oa-message.client.ts:10`: TODO xác nhận endpoint/format Send API của Zalo OA. Ảnh hưởng D4-004 (tin OA chưa được xác nhận với tài liệu chính thức).
- `api/src/modules/integrations/zalo-oa/zalo-oa-webhook.controller.ts:36`: TODO xác nhận cách verify webhook chính thức (HMAC). Cần kiểm trước khi bật OA.
- `miniapp/src/utils/features.ts:7`: `SEASON_PASS_ENABLED = false` (Q-16). `:10`: `CASHBACK_ENABLED = false` (Q-15). Cả hai là quyết định đã ghi, không báo lại.
- Hai TODO còn lại (`merchant.service.ts:1022`, `analytics-aggregation.service.ts:27`) ngoài phạm vi nhánh này.
- "sắp ra mắt/coming soon/mock" trong mã giao diện cộng đồng và game: không thấy chỗ giữ chỗ nào chạm khách (chưa quét toàn bộ web).

## 3. Đề xuất tính năng mới (tối đa 10, theo giá trị/công sức)

Mục tiêu liên quan: 1 giảm phụ thuộc sàn, 3 cộng đồng, 4 đại lý/CTV, 5 việc làm ngoài hệ thống. Cột "Cần chủ dự án" là nội dung hoặc vận hành phải có.

| # | Đề xuất | Tác động mua lại/giới thiệu | Mục tiêu | Công sức | Cần chủ dự án |
|---|---|---|---|---|---|
| 1 | Nạp nội dung khởi tạo an toàn cho prod (D4-001, D4-021) | Mở khóa quiz, nhiệm vụ, cộng đồng: không có thì mọi thứ dưới trống | 3 | M | Quyết cách chạy seed lần đầu |
| 2 | Gắn `ref` vào mọi chia sẻ + thẻ "Mời bạn" khi chưa có bạn + chia sẻ bài (D4-007, D4-011) | Cao nhất cho giới thiệu: hiện hầu như chưa có nguồn ref | 1, 3 | S-M | Không |
| 3 | Kéo về qua OA/ZNS: xin mẫu ZNS, mời theo dõi OA sớm, tin OA trong 48 giờ (D4-004, D4-005) | Cao cho mua lại: nhắc quiz/flash/mua chung đến được người không mở app | 1, 3 | M | Nộp mẫu Zalo, nội dung tin, giới hạn tần suất |
| 4 | Cộng đồng vào hộp việc CSKH: quyền CSKH, 3 số cảnh báo, tab web (D4-003) | Giữ câu hỏi được trả lời nhanh: yếu tố sống còn của hỏi đáp | 3, 5 | M | Không (mặc định đề xuất ở mục 4) |
| 5 | Danh tính "Tubu Tree" + 10 bài khởi tạo + 2 bài ghim (D4-002) | Cộng đồng không trống ngày đầu | 3 | M | Viết bài, ảnh thật |
| 6 | Lịch sự kiện hằng tháng, trang người thắng, tự đóng sự kiện (D4-008) | Lý do quay lại theo nhịp tháng; chia sẻ kết quả | 3 | M | Lịch 3 tháng, quà |
| 7 | Báo tác giả khi có bình luận/thích (D4-006) | Khóa vòng "đăng bài, có người phản hồi, quay lại" | 3 | S | Không |
| 8 | Quiz xoay vòng + thêm câu mỗi tháng + nhiệm vụ cộng đồng (D4-009, D4-013) | Thói quen hằng ngày không còn lặp | 3 | S | Người viết câu hỏi |
| 9 | "Tubu trả lời" dưới đánh giá + hỏi đáp trên trang sản phẩm (D4-014, D4-018) | Tăng tin cậy cho khách đến từ sàn: họ quen xem review | 1 | M | Người trả lời đánh giá |
| 10 | Lối ra nhóm Zalo/fanpage ở Giới thiệu và đầu Cộng đồng (D4-017) | Giữ khách ở kênh Tubu kiểm soát được | 1, 3 | S | Có nhóm/kênh nào để dẫn |

Gợi ý ngoài 10 mục: Academy cho khách thường (không chỉ CTV) có thể làm sau ra mắt, khi đã có nội dung (D4-015).

## 4. Câu hỏi cho chủ dự án (kèm phương án mặc định)

1. Lần lên prod đầu tiên có chạy seed trên DB mới (ALLOW_PROD_SEED=1) không? Mặc định khuyên: không chạy seed; viết migration nạp chủ đề, quiz, nhiệm vụ, loài cây, mục tiêu và 6 mẫu thông báo (D4-001).
2. CSKH có được duyệt/ẩn bài cộng đồng không? Mặc định khuyên: có; chỉ ADMIN được ghim và chọn người thắng (D4-003).
3. Ai viết 10 bài khởi tạo và đăng dưới tên nào? Mặc định khuyên: tài khoản "Tubu Tree" chính thức, nhân sự marketing soạn, chủ dự án duyệt, đăng trước ngày ra mắt (D4-002).
4. Lịch sự kiện 3 tháng đầu và quà là gì? Mặc định khuyên: 1 sự kiện/tháng (ảnh góc sống xanh, chủ đề theo mùa), quà 20-50 điểm Xanh cho 3 người thắng, vì điểm đã có kho và 1 điểm = 1.000đ nên quà không phát sinh vận chuyển (D4-008, D4-010).
5. Xin duyệt ZNS cho những mẫu nào, ai nộp? Mặc định khuyên: nộp ngay 3 mẫu giao dịch (mời đánh giá, mua chung thành công, mua chung thất bại); phần khuyến mãi gửi qua tin OA cho người đã theo dõi (D4-004).
6. Ngân sách thưởng game mỗi khách mỗi tháng? Mặc định khuyên: giữ bảng giải hiện tại (kỳ vọng gần hòa vốn trên điểm) và theo dõi chi tiêu thực 30 ngày đầu rồi chỉnh (D4-019).
7. Có nhóm Zalo/fanpage/TikTok nào để dẫn khách vào? Mặc định khuyên: một nhóm Zalo khách hàng, nhân sự CSKH quản trị, liên kết đặt trong Giới thiệu và đầu Cộng đồng (D4-017).
8. Bật AI tư vấn lúc ra mắt không, nhà cung cấp nào? Mặc định khuyên: bật nếu đã có khóa và đã thử 20 câu hỏi thực tế; thêm lối chuyển CSKH (D4-016).
9. Có bật lại Chặng Mùa không? Mặc định khuyên: không, giữ ẩn như Q-16; ưu tiên lịch sự kiện thủ công (D4-012).
10. Ai soạn khóa học Academy đầu cho CTV, hình thức nào? Mặc định khuyên: 3 bài chữ ngắn kèm ảnh (sản phẩm, cách chốt đơn, hoa hồng), soạn trước khi mời CTV đầu tiên (D4-015).

## 5. Ghi chú kiểm chứng

- Chỉ đọc mã và migration; không chạy test, build hay truy vấn DB. Những chỗ ghi "chưa kiểm" là chưa đọc hết mã tương ứng.
- Mục D4-001 dựa trên dò chuỗi `INSERT INTO` trong `apps/api/prisma/migrations` cho từng bảng; nếu có đường nạp khác ngoài migration và seed (script ngoài repo) thì mục này hạ xuống P1.
- Các mục đã sửa, không báo lại: C-085 (nút thông báo), C-110 (unique đánh giá), C-043 (giới hạn quay mỗi ngày), C-073 (chữ chủ đề cộng đồng). Mục cũ vẫn còn: C-044 (D4-012), C-082 (D4-020).
