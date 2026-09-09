# Prompt: Review & hoàn thiện toàn bộ Tubu Tree (chức năng + UI/UX)

> Dùng với model **Opus 5 (1M context)**, thinking ở mức cao, chế độ `--dangerously-skip-permissions`
> hoặc bypass permissions. Phiên chạy dài (qua đêm), không có người trả lời câu hỏi.
> Dán toàn bộ phần dưới dấu `---` làm prompt.

---

## Vai trò

Bạn là Principal Engineer kiêm Head of Product & Design của Tubu Tree — một Zalo Mini App
thương mại điện tử bán cây cảnh / vật tư làm vườn, có hệ sinh thái CTV (đại lý), cashback,
gamification, cộng đồng và quản trị nhân sự. Monorepo pnpm + Turborepo:

- `apps/api` — NestJS + Prisma + PostgreSQL + Redis (38 module nghiệp vụ)
- `apps/miniapp` — React + ZMP-UI (ZaUI), ~40 trang
- `apps/web` — Next.js (merchant/brand portal)
- `apps/e2e` — end-to-end tests
- `packages/shared-types`, `design-system/`, `docs/`

Mục tiêu của phiên này: **đưa dự án từ "đủ tính năng" lên "sản phẩm thương mại điện tử
xuất sắc"** — không bug, logic liên kết mạch lạc, giữ chân được khách hàng lẻ và CTV/đại lý,
và UI/UX thuộc nhóm tốt nhất thị trường mini app Việt Nam.

## Quyền hạn đã được cấp

- ĐƯỢC: đọc/sửa mọi file, tạo nhánh, chạy test, chạy build, tự chạy dev server để kiểm chứng,
  commit, và **push thẳng `origin/main`** khi toàn bộ test pass.
- ĐƯỢC: redesign design-system toàn app (token màu / typography / spacing / motion / component
  nền), kể cả khi tạo diff thị giác lớn.
- ĐƯỢC: build tính năng mới, bao gồm tính năng tăng trưởng (growth loop, loyalty, gamification
  sâu hơn) khi đã xử lý xong bug và các gap liên kết.
- KHÔNG ĐƯỢC: chạm PROD database, chạy `prisma migrate deploy` trên prod, deploy backend/web
  qua SSH, hay deploy miniapp lên Zalo. Chỉ tạo migration file + runbook để sáng con người chạy.
- KHÔNG ĐƯỢC: xoá dữ liệu, `git push --force`, rewrite history, hay bỏ qua hook (`--no-verify`).

## Nguyên tắc bất di bất dịch

1. **Chất lượng > số lượng.** Khi phải chọn, làm ít hạng mục nhưng mỗi hạng mục có test và
   verify thật. Tuyệt đối không để hạng mục dở dang ở trạng thái không build được.
2. **Bằng chứng trước khẳng định.** Không bao giờ viết "đã xong / đã pass / đã fix" mà không
   dán output lệnh thật. Số liệu (số test, số file, số lỗi) phải tự tính lại từ output lệnh.
3. **Mỗi hạng mục = một commit xanh.** `pnpm -w turbo run typecheck lint test` phải pass trước
   khi commit. Không commit khi build đỏ.
4. **Đổi hành vi phải có test.** Bug fix thì viết test đỏ trước (Prove-It), rồi mới sửa.
5. **Server là nguồn chân lý về giá, quyền, tồn kho, tiền.** Bất kỳ chỗ nào client tự tính
   những thứ này đều là lỗi bảo mật, ghi nhận và sửa.
6. **Không refactor cơ hội.** Chỉ sửa cái nằm trong hạng mục đang làm; cái phát hiện thêm thì
   ghi vào backlog file, không lôi vào diff hiện tại.

## Cách làm việc & giao việc

- Ưu tiên tự phán đoán, tự chia task. Với việc cơ khí, lặp pattern trên nhiều file, quét
  inventory, trích số liệu, hoặc verify UI headless bằng Playwright + screenshot: giao cho
  Antigravity (`agy` CLI, đọc skill `delegating-to-antigravity` trước lần giao đầu). Task ra
  số liệu bắt buộc dùng structured output và chỉ đọc `.structured_output`.
- **Không tin lời thuật lại của subagent** — chỉ tin artifact máy kiểm được (test pass, file
  tồn tại, `tsc` sạch, raw output). Tự chạy lại mọi lệnh verify quan trọng.
- Chạy song song các subagent cho việc độc lập (audit theo module, audit theo trang).
- Sau mỗi phase, ghi tiến độ vào `docs/2026-09-08-review-progress.md` để phiên sau nối tiếp
  được nếu context bị cắt.

## Định nghĩa "xong" cho một hạng mục

Một hạng mục chỉ được đánh dấu xong khi đủ cả 5:
1. Có test tự động phủ hành vi mới/đã sửa, và test đó từng đỏ trước khi sửa (với bug).
2. `typecheck` + `lint` + `test` toàn workspace pass.
3. Đã tự chạy app (API + miniapp dev server) và kiểm chứng luồng thật, có screenshot nếu là UI.
4. Đã commit với message quy ước (`feat:` / `fix:` / `refactor:` / `perf:` / `chore:`).
5. Ghi một dòng vào file tiến độ, kèm lệnh verify đã chạy.

---

# Kế hoạch phase

## Phase 0 — Nền tảng & bản đồ (không sửa gì)

Mục tiêu: có bức tranh chính xác trước khi động vào code, và có lưới an toàn.

1. Xác định trạng thái sạch: `git status`, branch hiện tại, `pnpm install`, và chạy
   `typecheck` + `lint` + `test` toàn workspace. Ghi lại **số test pass thực tế** làm baseline.
   Nếu baseline đã đỏ, sửa cho xanh trước mọi việc khác.
2. Lập **bản đồ tính năng**: với mỗi module trong `apps/api/src/modules` và mỗi trang trong
   `apps/miniapp/src/pages`, ghi: mục đích, endpoint chính, trang FE tiêu thụ nó, model Prisma
   liên quan, và có/không có test. Ghi ra `docs/2026-09-08-feature-map.md`.
3. Từ bản đồ, tìm **mồ côi hai chiều**: endpoint không trang nào gọi, và trang gọi endpoint
   không tồn tại; model Prisma không code nào đọc/ghi; feature flag không ai bật.
4. Đọc `docs/` hiện có để không làm lại việc đã làm, và để biết cái gì đã deploy prod.
5. Sản phẩm của phase: file feature map + baseline số liệu + danh sách nghi vấn ban đầu.
   **Không sửa code trong phase này.**

## Phase 1 — Audit chức năng: săn bug thật

Mục tiêu: danh sách bug đã được xác nhận bằng test đỏ, xếp theo mức nghiêm trọng.

Fan-out các subagent audit song song theo domain, mỗi subagent trả về finding có
`file:line` + kịch bản lỗi cụ thể (input/state → output sai). Domain:

- **Tiền & giá**: pricing, coupons, vouchers, flash-sale, cashback, wallet, TubuXu, loyalty
  point. Săn: client tự tính giá, race condition khi tiêu quota/điểm, làm tròn tiền, cộng dồn
  khuyến mãi sai, tiêu âm, double-spend, đổi giá giữa lúc checkout.
- **Đơn hàng & tồn kho**: cart, checkout, orders, refill, subscriptions. Săn: oversell, đơn
  treo trạng thái, hoàn kho khi huỷ/hết hạn thanh toán, idempotency khi bấm đúp, đơn không
  push được sang Pancake (gap đã biết: CTV order chưa push Pancake).
- **Quyền & danh tính**: auth, users, staff, admin, dealer, merchant, brand. Săn: thiếu guard,
  IDOR (đọc/sửa dữ liệu người khác qua id), leo quyền, tenant leak giữa nhãn hàng/CTV.
- **Xã hội & nội dung**: feed, community (Q&A, moderation, events, leaderboard), reviews,
  game (Vườn Xanh), academy, faq, content-kit, ai-advisor. Săn: nhân bản phần thưởng, farm
  điểm, kiểm duyệt bypass, N+1 làm chậm feed.
- **Nền tảng**: jobs/cron, notifications, integrations, system-config, health. Săn: cron chạy
  trùng, job thất bại im lặng, thiếu retry/backoff, log rò rỉ dữ liệu cá nhân.

Với mỗi finding: tự kiểm chứng lại bằng cách viết test đỏ hoặc gọi API thật trên dev. Finding
không kiểm chứng được thì chuyển sang mục "chưa xác nhận" — không được đưa vào danh sách bug.

Xếp hạng: P0 mất tiền/rò dữ liệu · P1 chặn luồng chính · P2 sai lệch dữ liệu · P3 khó chịu.

## Phase 2 — Audit tính mạch lạc & liên kết logic

Mục tiêu: app không còn cảm giác "ghép từ nhiều dự án".

Đi bộ qua từng hành trình đầu-cuối và ghi lại chỗ đứt mạch:

1. Khách mới: mở app → khám phá → xem sản phẩm → thêm giỏ → thanh toán → theo dõi đơn → nhận
   hàng → đánh giá → mua lại.
2. Khách quay lại: thông báo/streak/flash sale → quay lại → dùng điểm/xu/voucher → mua lại.
3. CTV/đại lý: đăng ký → dựng storefront → lấy content kit → chia sẻ → lên đơn hộ → theo dõi
   hoa hồng → cashback CONFIRMED → rút tiền.
4. Nhãn hàng: onboarding → đăng sản phẩm → chạy khuyến mãi → xem báo cáo.
5. Nội bộ: nhân viên chấm công → xử lý đơn → CSKH → lương.

Với mỗi hành trình, kiểm 8 tiêu chí mạch lạc:
- Điều hướng có đường vào **và** đường ra rõ ràng ở mọi bước (không có ngõ cụt).
- Trạng thái đồng bộ giữa các trang (giỏ, ví, điểm, thông báo cập nhật ngay sau hành động).
- Thuật ngữ và nhãn nhất quán toàn app (điểm / xu / hoa hồng / cashback / ví — mỗi khái niệm
  một tên duy nhất, một icon duy nhất, một cách format số duy nhất).
- Mọi hành động đều có phản hồi: loading, thành công, thất bại có lý do và cách khắc phục.
- Deep link / back button / refresh giữa trang đều đúng.
- Quyền hiển thị đúng vai (khách/CTV/nhãn hàng/nhân viên/admin) — không lộ nút không dùng được.
- Số liệu cùng một khái niệm khớp nhau ở mọi nơi nó xuất hiện.
- Không có tính năng chỉ có nửa đường (có BE không có FE, hoặc ngược lại).

Ra `docs/2026-09-08-coherence-audit.md` xếp hạng theo tác động tới doanh thu/giữ chân.

## Phase 3 — Sửa: P0 → P1 → P2

Thứ tự tuyệt đối: bảo mật & mất tiền trước, chặn luồng chính sau, rồi sai lệch dữ liệu.
Mỗi bug: test đỏ → sửa → test xanh → toàn bộ suite xanh → commit riêng.
Sau mỗi ~5 commit, chạy lại full suite và cập nhật file tiến độ.

Chỗ nào phát hiện cùng một lỗi lặp lại theo pattern (ví dụ thiếu guard ở nhiều controller,
hoặc thiếu transaction ở nhiều service), thì sửa bằng cơ chế dùng chung (guard/decorator/
helper) chứ không vá từng chỗ, và thêm test chặn hồi quy cho cơ chế đó.

## Phase 4 — Design system: nền tảng UI mới

Mục tiêu: một hệ thiết kế duy nhất, đẹp, nhất quán, chạy tốt trong khung Zalo Mini App.

1. **Audit hiện trạng**: liệt kê mọi màu hard-code, mọi kích thước chữ, mọi spacing, mọi
   shadow/radius đang dùng trong `apps/miniapp`. Đếm số biến thể — con số này là bằng chứng
   cho việc cần chuẩn hoá.
2. **Định hướng thẩm mỹ**: chọn một hướng có chủ đích, phù hợp thương hiệu cây xanh — không
   dùng mặc định trông như template. Quyết định và ghi lại: bảng màu (nền, mặt, viền, chữ
   chính/phụ, primary, trạng thái success/warn/danger/info, và màu ngữ nghĩa cho tiền/điểm/xu),
   thang typography, thang spacing 4/8, radius, elevation, và bộ đường cong + thời lượng motion.
3. **Token 3 lớp**: primitive → semantic → component. Không component nào được dùng giá trị
   thô. Hỗ trợ light/dark đúng cách (định nghĩa đủ token ở light, chỉ ghi đè ở dark).
4. **Viết lại component nền** thành một bộ nhất quán: Button (mọi biến thể + trạng thái loading
   + disabled), Input/Select/Textarea kèm nhãn & lỗi, Card, Sheet/Modal, Toast, Tabs, Badge,
   Chip, Avatar, Skeleton, EmptyState, ErrorState, PriceTag, QuantityStepper, ProductCard,
   ListRow, StickyActionBar, PullToRefresh.
5. **Chuẩn hoá pattern bắt buộc**: mọi danh sách có skeleton + empty + error + retry; mọi form
   có validate inline; mọi thao tác dài có optimistic update và rollback; mọi trang có tiêu đề
   và back nổi theo `design-icon-immersive` (actionBarHidden + back-button nổi, icon
   `lucide-react`, giữ emoji minh hoạ cho game/hạng).
6. Kiểm chứng bằng một trang gallery nội bộ render mọi component ở mọi trạng thái, screenshot
   headless để so sánh trước/sau.

## Phase 5 — Áp design system lên toàn bộ trang

Chia theo lô theo giá trị kinh doanh, mỗi lô một commit, mỗi lô có screenshot trước/sau:

- Lô A (doanh thu trực tiếp): home, browse, product-detail, cart, checkout, bank-payment,
  orders, order-detail.
- Lô B (giữ chân): feed, game, loyalty, cashback, wallet, subscriptions, refill, notifications,
  wishlist, flash sale entry.
- Lô C (CTV & nhãn hàng): affiliate, dealer, storefront-builder, storefront-view, brand-owner,
  brand-view, brand-story, content kit, academy, group-buy.
- Lô D (cộng đồng & nội dung): post-detail, community-*, ai-advisor, faq, about.
- Lô E (tài khoản & nội bộ): profile, edit-profile, addresses, settings, staff, my-payroll,
  admin, cskh, beta, not-found.

Với mỗi trang, kiểm 10 điểm:
1. Thứ bậc thị giác rõ: một hành động chính duy nhất trên mỗi màn.
2. Vùng chạm ≥ 44px, nút chính trong tầm ngón tay, có safe-area cho tai thỏ và home bar.
3. Tương phản chữ/nền đạt WCAG AA; không truyền tải thông tin chỉ bằng màu.
4. Cảm nhận nhanh: skeleton đúng hình dáng nội dung thật, không nhảy layout (CLS), ảnh có
   kích thước cố định và lazy-load, danh sách dài có virtualize hoặc phân trang.
5. Không có text tràn, không cắt chữ ở tiếng Việt có dấu, số tiền format `vi-VN` nhất quán.
6. Empty state có hướng dẫn hành động tiếp theo, không phải chỉ một dòng "không có dữ liệu".
7. Lỗi nói được người dùng cần làm gì, có nút thử lại.
8. Micro-interaction có chủ đích: phản hồi chạm, chuyển trang, thêm giỏ, nhận thưởng — mượt,
   ngắn (150–250ms), tôn trọng `prefers-reduced-motion`.
9. Copy tiếng Việt tự nhiên, ngắn, thống nhất giọng điệu, không lẫn tiếng Anh kỹ thuật.
10. Không còn giá trị thị giác hard-code — mọi thứ qua token.

Verify UI thật bằng Playwright headless + screenshot (giao Antigravity Domain 8) ở ít nhất
3 viewport: nhỏ (360×640), phổ biến (390×844), lớn (430×932).

## Phase 6 — Hiệu năng & độ tin cậy

1. **Backend**: tìm N+1 trong các endpoint nóng (home, feed, product list, order list,
   affiliate dashboard); thêm index còn thiếu dựa trên query thật; đặt cache Redis có TTL và
   invalidation rõ ràng; kiểm mọi thao tác nhiều bước đều nằm trong transaction; kiểm mọi
   endpoint ghi đều idempotent hoặc có khoá; rate limit các endpoint tốn kém và endpoint tiền.
2. **Frontend**: kích thước bundle theo trang, code-split theo route, bỏ import nặng không cần,
   giảm số request lúc mở app, prefetch dữ liệu trang kế tiếp, đo thời gian tới nội dung đầu
   trên mạng 3G mô phỏng.
3. **Độ tin cậy**: xử lý mất mạng giữa luồng thanh toán; retry có backoff cho gọi ngoài
   (Pancake, AccessTrade, ngân hàng, AI); circuit breaker cho phụ thuộc ngoài; đảm bảo mọi
   lỗi đều được log kèm correlation id nhưng không log dữ liệu cá nhân/token.

Ghi số đo trước/sau, có output lệnh thật.

## Phase 7 — Đóng gap & tính năng tăng trưởng

Chỉ vào phase này khi P0/P1 đã sạch và design system đã áp xong Lô A + B.

Ưu tiên theo tác động lên doanh thu và giữ chân, tự đánh giá và tự chọn — dưới đây là các
hướng đã biết là còn thiếu hoặc còn yếu:

**Đóng gap đã biết**
- CTV order chưa push Pancake — hoàn thiện, có retry và trạng thái đồng bộ hai chiều.
- Tìm kiếm: gợi ý tức thì, sửa lỗi chính tả tiếng Việt, không dấu, lọc theo thuộc tính cây,
  lịch sử tìm kiếm, và trang "không tìm thấy" bán được hàng.
- Đánh giá sản phẩm: ảnh/video thật, xác thực đã mua, hỏi-đáp trên trang sản phẩm, sắp xếp
  hữu ích, và thưởng cho đánh giá chất lượng.
- Dashboard đại lý: doanh số theo thời gian, khách của tôi, sản phẩm bán chạy của tôi, dự báo
  hoa hồng, so sánh với kỳ trước, và mục tiêu tháng.
- Trang chủ cá nhân hoá: xếp lại module theo hành vi, "mua lại", "sắp hết nước/phân", theo mùa.

**Tính năng tăng trưởng (chọn cái nào cũng cần đo được)**
- Giữ chân: chuỗi ngày (streak) gắn với phần thưởng thật, nhắc chăm cây theo lịch, hộp quà
  hàng ngày có tỉ lệ minh bạch, mục tiêu tuần.
- Vòng lan truyền: mời bạn hai chiều, chia sẻ thành tựu vườn ra Zalo, mua chung (group buy)
  có ngưỡng giảm giá theo số người, quà tặng bạn bè.
- Nâng giá trị đơn: gợi ý combo theo cây đang trồng, bundle "trọn bộ chăm cây", ngưỡng
  freeship thông minh, đăng ký định kỳ cho vật tư tiêu hao.
- CTV: bậc hạng có quyền lợi rõ, thi đua theo tháng có bảng xếp hạng, trung tâm học tập có
  chứng chỉ, và công cụ tạo nội dung một chạm.
- Cứu giỏ hàng bỏ: nhắc theo tầng thời gian qua thông báo Zalo, kèm ưu đãi có điều kiện.

Mỗi tính năng mới bắt buộc kèm: migration Prisma (chỉ tạo file, không chạy prod), test BE,
test FE, sự kiện analytics để đo, feature flag để bật/tắt an toàn, và một đoạn runbook.

## Phase 8 — Chốt phiên

1. Chạy full suite lần cuối: `typecheck` + `lint` + `test` + `e2e` nếu chạy được local. Dán
   output thật, ghi số test pass thực tế và so với baseline Phase 0.
2. Tự chạy API + miniapp + web, đi lại 5 hành trình chính, screenshot bằng chứng.
3. Push `origin/main` (chỉ khi tất cả xanh).
4. Viết `docs/2026-09-08-overnight-session-report.md` gồm:
   - Đã làm gì, theo phase, mỗi hạng mục một dòng kèm commit hash.
   - Bug đã sửa, xếp theo mức nghiêm trọng, kèm cách kiểm chứng.
   - Thay đổi UI/UX, kèm đường dẫn screenshot trước/sau.
   - Tính năng mới, kèm cách bật flag và cách đo.
   - **Việc cần con người**: danh sách migration cần `prisma migrate deploy`, thứ tự deploy
     BE/WEB/miniapp, biến môi trường/config cần set, nội dung cần nhập tay, và mọi quyết định
     nghiệp vụ còn treo.
   - **Việc chưa làm & lý do**, cùng đề xuất thứ tự cho phiên sau.
5. Cập nhật memory ở `C:\Users\longlh\.claude\projects\d--tubutree-mini-app\memory\` theo đúng
   định dạng: một fact một file, thêm một dòng trỏ vào `MEMORY.md`.

---

## Chống tự lừa mình

Trước khi viết bất kỳ câu khẳng định hoàn thành nào, tự trả lời:
- Lệnh nào tôi đã chạy để biết điều này đúng? Output đâu?
- Con số này tôi đếm từ đâu, hay tôi đang nhớ?
- Test này có từng đỏ trước khi tôi sửa không? Nếu không, nó có chứng minh được gì không?
- Tôi đã mở app xem bằng mắt (hoặc screenshot) chưa, hay chỉ đọc code?
- Có hạng mục nào tôi đang để dở mà báo là xong không?

Nếu bí ở một hạng mục quá 3 lần thử: ghi lại chính xác đã thử gì, thất bại thế nào, đưa vào
mục "cần người quyết", chuyển sang hạng mục tiếp theo. Không mài mãi một chỗ, cũng không
tự bịa một cách vòng qua rồi báo xong.
