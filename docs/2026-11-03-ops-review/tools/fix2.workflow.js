export const meta = {
  name: 'ops-1103-fix2',
  description:
    'Vòng 2: sửa 9 gói (ctv2, storefront, dealer, gardenapi, gardenui, catalog, orders, recycle2, pancake), tối đa 3 gói cùng lúc; worker Sonnet, review Opus đối kháng',
  phases: [
    { title: 'Build', detail: 'worker Sonnet sửa trong worktree của gói' },
    {
      title: 'Review',
      detail: 'reviewer Opus đối kháng; gói tiền/điểm/quyền cần 2 lượt APPROVE liên tiếp',
    },
  ],
};

const ROOT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees';
const DOCS = `${ROOT}/ops-1103-docs/docs/2026-11-03-ops-review`;
const BRIEF1 = `${DOCS}/tools/worker-brief.md`;
const BRIEF = `${DOCS}/tools/worker-brief-r2.md`;
const FINDINGS = `${DOCS}/10-review-wf2.json`;
const FINDINGS1 = `${DOCS}/10-review-wf1.json`;
const TRIAGE_2A = `${ROOT}/gl-1103-docs/docs/2026-11-03-golive/audit/triage.json`;
const BASE = 'ops/1103-r1';
const LIMIT = 3;

const WORK = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Đã sửa gì, theo từng mã phát hiện' },
    commits: { type: 'array', items: { type: 'string' }, description: 'sha ngắn + tiêu đề' },
    tests: {
      type: 'array',
      items: { type: 'string' },
      description: 'lệnh đã chạy + kết quả (đỏ trước sửa, xanh sau sửa)',
    },
    migration: { type: 'string', description: 'tên migration nếu có, hoặc "không"' },
    deviations: { type: 'string', description: 'chỗ làm khác yêu cầu và lý do' },
    open_questions: { type: 'string' },
  },
  required: ['summary', 'commits', 'tests', 'migration', 'deviations', 'open_questions'],
};

const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'CHANGES'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          file: { type: 'string' },
          issue: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'file', 'issue', 'fix'],
      },
    },
    checked: { type: 'string', description: 'Đã kiểm gì, chạy lệnh gì, kết quả' },
  },
  required: ['verdict', 'findings', 'checked'],
};

const PKGS = [
  {
    key: 'ctv2',
    need: 2,
    task: `Gói ctv2 (P3 sau vòng 1 của gói ctv: điểm mốc CTV). Worktree ${ROOT}/ops-1103-ctv2, race Postgres 46350.
1. apps/api/test/integration-race/ctv-milestone-revoke.race-spec.ts (~156, ~198) lấy "tháng trước" bằng now - 31 ngày: ngày VN 1/5, 1/7, 1/10, 1/12, 1-3/3 rơi về hai tháng trước và test đỏ giả. Lấy tháng trước từ vnMonthBounds(new Date(), -1) (hoặc truyền now cố định). Chứng minh bằng chạy với đồng hồ giả ở 01/12.
2. Nhãn lịch sử điểm cho reason mới AFFILIATE_MILESTONE_REVOKE:<claimId>:<gen> và AFFILIATE_MILESTONE_DEBT:<claimId>:<gen> (apps/api/src/modules/affiliate/ctv-milestone-ref.ts): thêm vào apps/web/src/lib/ledger-labels.ts, apps/miniapp/src/services/account-api.ts và API_REASONS trong ledger-labels.spec.ts (2a đã biết). Dòng thu hồi: "Thu hồi thưởng mốc doanh số CTV"; dòng nợ là nhãn nợ để pointsDebtAmount đọc được số nợ (xem luật REFERRAL_DEBT), kể cả ngăn kéo admin user-detail-drawer.tsx (~217-225) hiện đúng số nợ thay vì +0. Chữ nhãn của mỗi reason phải giống hệt nhau trên Mini và web.
3. apps/api/src/modules/affiliate/affiliate.service.ts (~1249-1255): khi thu được 0 điểm (số dư 0, toàn bộ thành nợ) tin không được ghi "0 Điểm Xanh thưởng mốc đã được thu lại"; dùng câu riêng cho ca đó (ghi nợ). Test.
4. apps/api/src/modules/wallet/commission-wallet-reversal.ts ~59: docstring nói khoá user khi "hoa hồng đã chốt (APPROVED/PAID…)" không khớp điều kiện ở ~83 (WALLET hoặc APPROVED); sửa comment cho đúng.
Không migration.`,
  },
  {
    key: 'storefront',
    need: 2,
    task: `Gói storefront (quyền, link CTV). Worktree ${ROOT}/ops-1103-storefront, race Postgres 46270.
1. DLSF-01 (P1): CTV chiếm trước subdomain bằng mã giới thiệu của người khác. Chặn ở mọi đường tạo/đổi subdomain gian hàng (storefront.service.ts, merchant.service.ts createStore, chỗ khác grep được): subdomain/slug không được trùng mã giới thiệu (referral code) của user khác, cũng không được trùng slug/subdomain đã có, so không phân biệt hoa thường; kiểm trong transaction có khoá phù hợp để hai yêu cầu song song không cùng lọt. Xem cách /s/<mã> phân giải: đọc phát hiện; sửa để link /s/<mã> của nạn nhân luôn về đúng chủ. Race spec: hai CTV song song, và CTV lấy mã của người khác. Không migration (dữ liệu PROD có thể đã trùng; thêm unique index sẽ làm deploy hỏng). Viết vào open_questions một câu SQL CHỈ ĐỌC để 2a/chủ dò trùng sẵn có trên PROD (không chạy trên PROD).
2. DLSF-07 (P3): cron nhắc SP nổi bật bỏ chủ bị khoá hoặc mất vai trò CTV; không bỏ sót gian hàng vì take 20 (phân trang theo id hoặc lọc đúng ở SQL).`,
  },
  {
    key: 'dealer',
    need: 2,
    task: `Gói dealer (tiền, nợ đại lý). Worktree ${ROOT}/ops-1103-dealer, race Postgres 46280.
1. DLSF-02 (P1): hạ vai trò đại lý còn nợ thì nợ biến khỏi màn admin và không ghi trả nợ được. Sửa để nợ còn hiện và vẫn ghi nhận trả nợ được sau khi hạ vai trò (hoặc chặn hạ vai trò khi còn nợ, kèm câu báo rõ số nợ; chọn cách ít đổi luật hơn, ghi lý do). Race/unit test.
2. DLSF-03 (P2): Mini App đặt đơn đại lý (apps/miniapp/src/pages/dealer.tsx, bank-transfer.service.ts getBankQr): lỗi mạng rồi đổi giỏ hoặc đổi sang Trả trước thì báo sai; sửa khoá idempotency theo nội dung đơn, đúng như phát hiện.
3. DLSF-05 (P2): xác nhận đơn đại lý trả trước phải kiểm trùng mã giao dịch: một khoản chuyển không xác nhận được cho nhiều đơn (kiểm trong transaction có khoá; race spec hai admin xác nhận song song hai đơn cùng mã). Không migration; nếu thấy bắt buộc cần ràng buộc DB thì DỪNG và ghi open_questions.
4. DLSF-06 (P3): trả nợ với mã giao dịch đã dùng cho số tiền khác phải báo câu rõ ràng (đã dùng cho khoản khác), không báo lỗi Idempotency-Key.
DLSF-04: chủ chốt giữ như cũ, KHÔNG sửa.`,
  },
  {
    key: 'gardenapi',
    need: 2,
    task: `Gói gardenapi (điểm, nước Vườn Xanh, API). Worktree ${ROOT}/ops-1103-gardenapi, race Postgres 46290.
1. VX2-01 (P1): duyệt trả cả đơn qua yêu cầu đổi/trả (order-returns.service.ts nhánh isFull) phải thu lại nước theo đơn như đường huỷ/trả khác; đơn đang chờ không được cộng nước sau khi đã trả. Race spec.
2. VX2-02 (P2): hồi sinh chuỗi sau khi đã lỡ thêm một ngày: không trừ 150💧 khi hồi sinh không giữ được chuỗi (hoặc chặn hồi sinh và báo rõ); chuỗi vừa hồi sinh không đứt ở lần điểm danh kế. Race/unit test theo giờ VN.
3. VX2-05 (P3): nhắc 'cây khát' không gửi cho khách vừa tưới lô phụ hoặc cây vừa thu hoạch chưa có tiến độ.
4. VX2-07 (P3): điểm danh sát nửa đêm: phần Điểm Xanh và phần nước phải cùng một ngày VN (lấy một mốc thời gian duy nhất cho cả lượt).
5. Dọn P3 vòng 1 của gói game (đã gộp vào gốc): xoá test lặp ở apps/api/src/modules/game/game-quiz.service.spec.ts (hai test cùng tên 'quizId ngoài bộ câu hôm nay'); race spec game-quiz-cap.race-spec.ts hiện không chứng minh khoá theo user cần thiết (unique + bộ câu hôm nay đã đủ chặn): hoặc viết ca thật sự cần khoá và chứng minh đỏ khi bỏ khoá, hoặc nếu khoá thừa thì giữ khoá và sửa comment cho đúng lý do; bỏ comment kể lại lịch sử ở đầu game-quiz-cap.race-spec.ts và season-pass-premium.race-spec.ts; sửa comment schema.prisma quanh dòng 2358 cho đúng luật VX-01 (gói ACTIVE đã giao ≥1 đơn). Không migration (sửa comment schema không cần migration; kiểm \`npx prisma migrate diff\` không sinh SQL).
VX2-06: chủ chốt giữ như cũ, KHÔNG sửa.`,
  },
  {
    key: 'gardenui',
    need: 1,
    task: `Gói gardenui (màn khách Vườn Xanh, Mini + web). Worktree ${ROOT}/ops-1103-gardenui, race Postgres 46300 (nếu cần). Gọi skill tubu-ui trước khi sửa. Mini và web phải giống nhau ở khổ 375.
1. VX2-03 (P2): chữ mời mở lô đất (apps/miniapp/src/components/game/garden-plots.tsx:40, apps/web/src/components/game/garden-plots.tsx:40) không được hứa mỗi lô một mã giảm giá riêng; mã thu hoạch dùng chung trần ngày/tháng với cây nhà. Chủ chốt: chỉ sửa chữ, không đổi luật. Chữ mới ngắn, đúng.
2. VX2-04 (P3): đầu trang Vườn Xanh (apps/miniapp/src/pages/game.tsx:170, apps/web/src/app/vuon-xanh/page.tsx:186) hiện chuỗi cũ đã đứt; phải khớp thẻ điểm danh bên dưới (dùng cùng một nguồn/hàm, đọc phát hiện).
3. XANH-01 (P2, mục 2a chuyển, tìm trong ${TRIAGE_2A}): hàng "Vé giữ lửa:" bị bóp 2–3 dòng cạnh nút "Giữ chuỗi (cần thêm 80💧)". Sửa bố cục ở apps/miniapp/src/components/game/checkin-streak.tsx:114-127 và apps/web/src/components/game/checkin-streak.tsx:85-98 (nhãn không xuống dòng; nút xuống hàng riêng full width khi hẹp, vùng bấm ≥ 44px), có thể rút chữ ở packages/app-core/src/game-more-copy.ts:11. Test vitest bố cục/chữ nếu có mẫu.
4. Season Pass: gợi ý Cao cấp phải khớp luật mới VX-01 (cần gói định kỳ đã giao ít nhất một đơn): sửa đúng khoá game.seasonPass.premiumHint ở apps/miniapp/src/i18n/vi.ts (~896) và chữ ở apps/web/src/components/game/season-pass.tsx:57. Chữ khớp câu API ở apps/api/src/modules/game/season-pass.service.ts.
5. Câu đố hôm nay: API giờ từ chối câu không thuộc bộ câu hôm nay (qua nửa đêm VN, hoặc admin thêm/xoá câu). Màn quiz (apps/miniapp/src/components/game/quiz-card.tsx, apps/web/src/components/game/quiz-card.tsx và nơi gọi) khi gặp lỗi đó phải tự tải lại bộ câu hôm nay và báo ngắn, không để khách kẹt. Test vitest.
Không migration. Chỉ sửa các file đã nêu (và spec cạnh chúng); file vùng 2a khác thì DỪNG, ghi open_questions.`,
  },
  {
    key: 'catalog',
    need: 2,
    task: `Gói catalog (admin Sản phẩm & Combo, Chiến dịch & Giờ vàng). Worktree ${ROOT}/ops-1103-catalog, race Postgres 46310.
Sửa SPCD-01, SPCD-02, SPCD-03, SPCD-04, SPCD-05, SPCD-06, SPCD-07 theo phát hiện (giá Giờ vàng chồng giờ ở SPCD-03 là đường tiền: luật flashsale.slots phải chặn các mốc chồng nhau ở API, kể cả nút sinh khung; test). SPCD-05: lưu danh mục dùng khoá cây như đường gán khác. SPCD-06: gán hàng loạt tôn trọng trần 10 danh mục/sản phẩm, báo rõ sản phẩm vượt. SPCD-07: kiểm slug đích banner tồn tại khi lưu; xoá danh mục đang làm đích banner thì chặn hoặc báo (chọn cách ít đổi luật, ghi lý do).
Thêm P3 vòng 1: importSoldExternal (apps/api/src/modules/catalog/catalog.service.ts quanh dòng 974) đang cộng cả khi cùng một SKU lặp hai dòng trong một lô; sửa: SKU lặp trong cùng lô thì từ chối lô với lỗi nêu SKU lặp (các SKU KHÁC NHAU cùng sản phẩm vẫn cộng dồn). Tránh vùng textMatchSql/search-text của 2a.
Thêm: trường \`rows\` của DTO POST /admin/products/sold-external và POST /admin/dealer-prices/import(/preview) (admin.controller.ts ~270, ~275) chưa có trần mảng; phiên 2a sắp chặn mọi mảng > 500 phần tử ở tầng parser, nên thêm @ArrayMaxSize(500) để lỗi rõ ràng (client admin chỉ gửi csv). Test DTO.
Không migration.`,
  },
  {
    key: 'orders',
    need: 2,
    task: `Gói orders (admin Đơn hàng + mã giảm giá). Worktree ${ROOT}/ops-1103-orders, race Postgres 46320.
1. Sửa QTDON-02, QTDON-03, QTDON-04 (CORS exposedHeaders Content-Disposition ở apps/api/src/bootstrap.ts, chỉ đúng dòng cors; tránh dòng 119-127 của 2a; và tên file CSV theo giờ VN), QTDON-05, QTDON-06 theo phát hiện. QTDON-01 và QTDON-07 đã bị REFUTED: không sửa.
2. P3 vòng 1 (gói admin): apps/api/src/modules/admin/admin.service.ts updateCoupon (~1692): transaction khoá dòng coupons phải dùng { maxWait: 15_000, timeout: 60_000 } và .catch(throwIfLockBusy) như các transaction khoá dòng khác trong file; comment "Khe còn lại" (~1699) ghi đủ các ca lệch (đặt đơn đọc mã chưa có trần; release đọc mã chưa có trần rồi xoá redemption sau khi admin đếm; hạ trần mã đang có trần), ngắn gọn, nói vì sao chấp nhận. apps/web/src/app/admin/page.spec.tsx ~1715 (QTUI-05): test phải đỏ với mã cũ dù máy chạy ở giờ VN (đặt TZ trong test hoặc cách tương đương có tác dụng thật; chứng minh bằng chạy với TZ=Asia/Ho_Chi_Minh trên mã cũ). apps/web/src/components/admin/notification-templates-tab.spec.tsx ~352: tên test hứa vế "xoá mã đang có thì khoá" mà thân không kiểm: thêm fixture + kiểm, hoặc sửa tên.
Không migration.`,
  },
  {
    key: 'recycle2',
    need: 2,
    task: `Gói recycle2 (Đổi rác, điểm). Worktree ${ROOT}/ops-1103-recycle2, race Postgres 46330. Màn khách: gọi skill tubu-ui trước khi sửa.
1. Sửa DRV2-01 (tin nhắc sắp hết hạn không bảo mang tới điểm đã tạm dừng/mất chủ/hết hạn mức: nêu cách làm đúng, đọc phát hiện), DRV2-02 (form Kho Tubu: ô 'Trao quà tại điểm này' và 'Món điểm nhận' không có tác dụng: ẩn với Kho hoặc làm cho có tác dụng, chọn cách ít đổi luật, ghi lý do), DRV2-03 (quầy nhiều điểm: thẻ hạn mức theo điểm của yêu cầu vừa tra; apps/web/src/components/recycle/recycle-desk.tsx và apps/miniapp/src/pages/recycle-desk.tsx).
2. XANH-02 (mục 2a chuyển, tìm trong ${TRIAGE_2A}): chữ giới thiệu Đổi rác (packages/app-core/src/waste-copy.ts:10,12) dựng theo cờ công khai cfg.waste.dropoff / cfg.waste.mailin; dùng ở apps/miniapp/src/pages/recycle.tsx và apps/web/src/components/recycle/recycle-home.tsx; thêm ca vào spec waste-copy.
3. Hạn giữ chỗ là trọn ngày D (quyết định DR-03): đổi "trước <D>" thành "đến hết <D>" ở apps/web/src/components/recycle/recycle-request.tsx (~258, ~307) và apps/miniapp/src/pages/recycle-request.tsx (~276, ~318); mẫu thông báo WASTE_REQUEST_EXPIRING (apps/api/prisma/seed.ts ~933, gửi ở waste-notifier.service.ts ~89) đổi câu cho đúng "hạn chót là hết ngày D". ĐƯỢC migration dữ liệu: UPDATE notification_templates chỉ khi thân còn đúng chuỗi cũ; cập nhật seed.ts.
4. Khi reversedPoints = 0, màn yêu cầu của khách không ghi "Đã thu hồi 0 Điểm Xanh" (apps/web/src/components/recycle/recycle-labels.ts ~184, apps/miniapp/src/utils/waste-labels.ts ~140): ghi trạng thái thu hồi không kèm số 0.
5. Admin apps/web/src/components/admin/waste-request-detail.tsx ~418: câu sau thu hồi "Còn X điểm không thu được vì khách đã tiêu" sai khi lô đã hết hạn; đổi câu trung tính đúng cả hai ca. Race spec waste-reverse.race-spec.ts ~344-349 ca "lô đã hết hạn": chốt giá trị cụ thể của số trừ.`,
  },
  {
    key: 'pancake',
    need: 2,
    task: `Gói pancake (Pancake, thông báo, ops, chữ hạng, webhook Zalo OA). Worktree ${ROOT}/ops-1103-pancake, race Postgres 46340.
1. Sửa PNK-01 (webhook Hoàn một phần tới trễ cho đơn đã huỷ/trả không ghim lời hoàn tay), PNK-02 (hàng Cần xử lý Pancake không để cờ mới ghi đè lý do COD chờ Kế toán; KHO không xoá được việc của Kế toán), PNK-03 (báo giảm giá cho khách yêu thích chỉ dựa biến thể đang bán), NTF-01 (màn Mẫu thông báo ghi đúng kênh của TIER_DROP_NOTICE khi ZNS bật qua khoá cấu hình riêng) theo phát hiện.
2. XANH-03 (mục 2a chuyển, tìm trong ${TRIAGE_2A}): quyền lợi hạng dùng "Freeship", trái DESIGN.md. Đổi thành "Miễn phí giao hàng ..." ở apps/api/prisma/seed.ts (~380, ~391, ~402) và ĐƯỢC migration dữ liệu cập nhật membership_tiers.perks chỉ khi phần tử còn đúng chuỗi cũ (xem migration 20261011110000_pd1_review_wording). Thêm ca quét chữ cấm cho perks trong seed (spec thuật ngữ có sẵn). Không đổi nội dung cam kết.
3. BAOMAT-06 (tìm trong ${TRIAGE_2A}): webhook Zalo OA (apps/api/src/modules/integrations/zalo-oa/zalo-oa-webhook.controller.ts) kiểm X-ZEvent-Signature như users/zalo-consent-webhook.controller.ts (dùng lại zaloEventSignature), giữ token tĩnh làm lớp phụ, fail-closed khi thiếu secret, so sánh hằng thời gian. Test.
4. P3 vòng 1 (gói ops): apps/web/src/components/admin/ops-inbox-tab.tsx ~103-107 docblock của OpsInboxTab bị đẩy lên trên HealthNotice: trả docblock về đúng hàm. apps/web/src/components/admin/ops-health-tab.tsx ~58 + phía API: dòng cron_runs của job đã đổi tên/gỡ khỏi mã mà lượt cuối lỗi làm banner lỗi không bao giờ tắt: chỉ tính job còn đăng ký trong mã (nếu có danh sách @TrackCron lúc chạy) hoặc bỏ dòng có lastRunAt quá cũ so với lịch của nó; chọn cách đúng, test. apps/api/src/modules/ops/ops-health.service.ts ~268-277: báo động giả "Token Zalo OA chưa từng được làm mới" trong tối đa 6 giờ sau khi mới cấu hình: sửa (vd chạy làm mới token một lần lúc khởi động khi chưa có hạn, hoặc chỉ báo khi đã qua một lượt cron), test.
Chỉ migration dữ liệu ở mục 2.`,
  },
];

function workerPrompt(p) {
  return `Bạn là worker sửa mã cho dự án Tubu Tree. Đọc luật chung ở ${BRIEF1} và phần khác của vòng 2 ở ${BRIEF} trước (bắt buộc), rồi đọc các mục phát hiện của gói trong ${FINDINGS} (vòng 2; mục vòng 1 ở ${FINDINGS1} nếu gói nhắc).
Gốc của gói là nhánh ${BASE}; diff của gói: git diff ${BASE}...HEAD.
${p.task}
Làm hết các mục, commit trong worktree của gói. Trả về theo schema: tóm tắt từng mã, commit, lệnh test đã chạy (đỏ trước, xanh sau), migration, chỗ làm khác yêu cầu, câu hỏi còn mở.`;
}

function reviewPrompt(p, round, prevApproved) {
  return `Bạn là reviewer Opus ĐỐI KHÁNG cho gói "${p.key}" của dự án Tubu Tree (đường tiền/điểm/quyền thì soi kỹ nhất). Luật: ${BRIEF1} và ${BRIEF} (gồm quyết định của chủ). Phát hiện gốc: ${FINDINGS}; mục 2a chuyển: ${TRIAGE_2A}.
Yêu cầu của gói:
${p.task}
Xem diff: cd ${ROOT}/ops-1103-${p.key} && git log --oneline ${BASE}..HEAD && git diff ${BASE}...HEAD
${prevApproved ? 'Một reviewer trước đã APPROVE lượt trước. Bạn review ĐỘC LẬP, không tin kết luận đó; tìm cái họ bỏ sót.' : ''}
Tìm lỗi thật: sai nghiệp vụ so với yêu cầu/quyết định, race (chạy song song, nhiều instance), idempotency, transaction thiếu hoặc khoá sai, số âm/làm tròn, múi giờ VN, quyền, lộ dữ liệu, hồi quy ở chỗ gọi khác (grep), migration không an toàn trên dữ liệu PROD đã có, test không thật sự đỏ với mã cũ hoặc chập chờn, comment kể lại thay đổi, chữ hiển thị sai/không nhất quán hoặc lệch giữa Mini và web, vùng bấm < 44px, vi phạm ranh giới file vùng 2a.
Được chạy test riêng lẻ của gói (jest/vitest file liên quan; race spec trên Postgres cổng của gói với --runInBand). Không sửa file, không đổi git.
verdict = APPROVE chỉ khi không còn P0/P1/P2. P3 vẫn liệt kê. Lượt review thứ ${round}.`;
}

function fixPrompt(p, review) {
  return `Bạn là worker sửa tiếp gói "${p.key}" của dự án Tubu Tree. Luật: ${BRIEF1} và ${BRIEF}. Worktree ${ROOT}/ops-1103-${p.key}, gốc ${BASE}.
Yêu cầu gốc của gói:
${p.task}
Reviewer Opus vừa trả CHANGES với các điểm sau (sửa hết P0/P1/P2; P3 sửa nếu rẻ và đúng, còn lại ghi lý do):
${JSON.stringify(review.findings, null, 1)}
Mỗi lỗi thật cần test đỏ trước rồi xanh. Commit. Trả theo schema.`;
}

async function runPkg(p) {
  let work = await agent(workerPrompt(p), {
    label: `worker:${p.key}`,
    phase: 'Build',
    agentType: 'worker',
    schema: WORK,
  });
  const history = [{ kind: 'work', work }];
  let approvals = 0;
  let last = null;
  for (let round = 1; round <= 5; round++) {
    const r = await agent(reviewPrompt(p, round, approvals > 0), {
      label: `review${round}:${p.key}`,
      phase: 'Review',
      agentType: 'reviewer',
      schema: REVIEW,
    });
    last = r;
    history.push({ kind: 'review', round, review: r });
    if (!r) break;
    if (r.verdict === 'APPROVE') {
      approvals++;
      log(`${p.key}: lượt ${round} APPROVE (${approvals}/${p.need})`);
      if (approvals >= p.need) break;
      continue;
    }
    approvals = 0;
    log(
      `${p.key}: lượt ${round} CHANGES (${r.findings.filter((f) => f.severity !== 'P3').length} P0–P2)`,
    );
    work = await agent(fixPrompt(p, r), {
      label: `fix${round}:${p.key}`,
      phase: 'Build',
      agentType: 'worker',
      schema: WORK,
    });
    history.push({ kind: 'work', round, work });
  }
  return { key: p.key, need: p.need, approvals, done: approvals >= p.need, last, history };
}

const queue = PKGS.slice();
const results = [];
async function lane() {
  while (queue.length) {
    const p = queue.shift();
    const r = await runPkg(p);
    results.push(r);
    log(`${r.key}: ${r.done ? 'đủ APPROVE' : 'CHƯA đủ'} (${r.approvals}/${r.need})`);
  }
}
await Promise.all(Array.from({ length: LIMIT }, () => lane()));
return results;
