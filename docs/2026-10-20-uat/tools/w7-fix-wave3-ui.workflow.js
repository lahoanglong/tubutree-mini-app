export const meta = {
  name: 'uat-w7-fix-wave3-ui',
  description: 'Sửa đợt 3: UI/UX Mini App, UI/UX admin, hiệu năng + chữ lỗi API (D6–D10), TDD worker Sonnet, review Opus 2 lượt',
  phases: [
    { title: 'Implement', detail: 'worker Sonnet, test đỏ trước rồi sửa' },
    { title: 'Review', detail: 'reviewer Opus lượt 1' },
    { title: 'Fix', detail: 'worker sửa theo review' },
    { title: 'Review2', detail: 'reviewer Opus lượt 2' },
  ],
}

const ROOT = '/Users/longla/coding/tubutree-mini-app'
const UAT = `${ROOT}/.claude/worktrees/uat`
const BRIEF = `${UAT}/docs/2026-10-20-uat/00-brief.md`
const DOCS = `${UAT}/docs/2026-10-20-uat`
const BASE = 'uat/2026-10-20'

const IMPL = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    worktree: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' }, description: 'sha + tiêu đề' },
    red: { type: 'string', description: 'output test đỏ trên mã cũ (rút gọn, có tên test và lý do fail)' },
    green: { type: 'string', description: 'output các lệnh kiểm cuối (dòng Tests:/exit)' },
    files: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: { type: 'string' }, description: 'chỗ phải chọn phương án (an toàn, đảo ngược được) + câu hỏi cho chủ' },
    skipped: { type: 'array', items: { type: 'string' } },
  },
  required: ['branch', 'worktree', 'commits', 'red', 'green', 'files', 'decisions', 'skipped'],
}
const REVIEW = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'true khi không còn lỗi P0/P1/P2 phải sửa trước khi gộp' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          location: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'location', 'problem', 'fix'],
      },
    },
    testsRerun: { type: 'string', description: 'lệnh test reviewer tự chạy lại + kết quả' },
  },
  required: ['ok', 'issues', 'testsRerun'],
}

const SHOTS = (port, app) => `Kiểm bằng ảnh (bắt buộc với gói giao diện): chép công cụ chụp ${UAT}/docs/2026-10-20-uat/tools/uiux/ vào worktree của bạn ở cùng đường dẫn docs/2026-10-20-uat/tools/uiux/ (KHÔNG commit thư mục này và thư mục screens), để ảnh ghi vào worktree của bạn. ${app === 'miniapp' ? `Bật Vite: cd apps/miniapp && VITE_API_BASE_URL=http://127.0.0.1:3221/api npx vite --host 127.0.0.1 --port ${port}; chụp: MINIAPP_BASE=http://localhost:${port} node docs/2026-10-20-uat/tools/uiux/capture.mjs miniapp --vp 390 --only '<regex màn đã sửa>' --force` : `Bật web: cd apps/web && npx next dev -H 0.0.0.0 -p ${port} (mở bằng localhost); chụp: UIUX_API=http://127.0.0.1:3221 UIUX_WEB_BASE=http://localhost:${port} node docs/2026-10-20-uat/tools/uiux/d7/capture.mjs --set admin --only '<regex tab>' --force (đọc đầu file capture.mjs và ${UAT}/docs/2026-10-20-uat/D7-uiux-admin-web.md mục Chạy lại)`}. Chụp TRƯỚC khi sửa (chép sang thư mục before/) và SAU khi sửa, Read từng ảnh để tự kiểm, ghi đường dẫn ảnh trước/sau vào trường green. Xong thì dừng server của bạn (kill PID + cây con). API 3221 dùng chung: chỉ GET, không dừng nó.`

const PKGS = [
  {
    key: 'ui-miniapp-1', race: 25571,
    spec: `Nâng UI/UX Mini App theo ${DOCS}/D6-uiux-miniapp.md và ${DOCS}/D8-a11y-chu.md (đọc kỹ mục từng ID, gồm đề xuất sửa). Làm các mục: D6-03 (cảnh báo "địa giới cũ" nằm trong đúng thẻ địa chỉ, components/checkout/address-section.tsx), D6-04 phần recycle.tsx:304 (món "Sắp có" không làm mờ chữ dưới 4,5:1; KHÔNG sửa recycle-new.tsx), D6-05 (feed.tsx: thu gọn phần đầu, nút Xếp hạng/Sự kiện có chữ), D6-06 (loyalty.tsx: "×1,2" dấu phẩy, "Điểm Xanh" viết hoa; sửa formatter utils/format.ts nếu dùng chung, chạy test của nó), D6-07 ("Vườn Cây" → "Vườn Xanh"), D6-08 (danh mục lỗi tải không ghi "0 sản phẩm"), D6-09 (icon riêng/ảnh từng danh mục nếu dữ liệu có, tên 2 dòng không cắt), D6-10 (giỏ: dòng thành tiền nhỏ khi SL > 1), D6-13 (profile.tsx số dùng font sans tabular), D6-14 (storefront-builder.tsx:408 tương phản), D6-15 (bỏ trùng "Cần hỗ trợ?"), D6-16 (ô tìm và bóng gợi ý ≥ 44px, bóng gợi ý không che nội dung), D6-19 (emoji làm icon ở community-leaderboard, group-buy, brand-story → icon lucide), D6-20 (thanh toán hiện dòng "Dự kiến giao" khi cấu hình shippingEta có, ẩn khi null), D8-1 (chữ trên gradient nhãn đạt ≥ 4,5:1 bằng lớp phủ tối/đổ bóng, không đổi màu nhãn), D8-2 (viền ô nhập/checkbox/radio và nền công tắc tắt ≥ 3:1 trong css/zaui-bridge.css), D8-4 (about.tsx:39 số ngày đổi trả đọc từ cấu hình công khai, nói đúng kênh hoàn), D8-6 (season-pass bậc khoá ≥ 4,5:1), D8-7 (sao rỗng ≥ 3:1), D8-9 (ô nhập có aria-label/label, chỉ ở file được phép), D8-13 (chính tả "Đắk Lắk", câu lặp ở recycle-desk.tsx:101), D10-01 (apps/miniapp/vite.config.mts: build production thiếu VITE_API_BASE_URL thì build lỗi với thông báo rõ, dev giữ mặc định localhost; test cho hàm kiểm). KHÔNG sửa các file gói khác đang sửa: apps/miniapp/src/i18n/vi.ts, pages/wallet.tsx, pages/bank-payment.tsx, pages/recycle-new.tsx, pages/recycle-edit.tsx, pages/external-points.tsx, pages/about-data.ts, pages/product-detail.tsx, pages/dealer.tsx, pages/community-moderation.tsx, components/flash-sale.tsx, hooks/use-countdown.ts, store/auth.ts. Mục nào cần sửa chuỗi trong vi.ts thì để lại (skipped, ghi chuỗi cần đổi). Giữ ngôn ngữ thiết kế hiện có (token màu, Card, Button); không thêm thư viện. ${SHOTS(3295, 'miniapp')}`,
    files: 'apps/miniapp/src/** trừ danh sách cấm, apps/miniapp/vite.config.mts (+ spec)',
  },
  {
    key: 'ui-admin-1', race: 25572,
    spec: `Nâng UI/UX admin web 1440 theo ${DOCS}/D7-uiux-admin-web.md và ${DOCS}/D8-a11y-chu.md (đọc kỹ từng ID). Phiên UAT đang giữ apps/web/src/components/admin/** (trừ portal-header.tsx) và apps/web/src/app/admin/**. Làm trong components/admin: D7-01 (nút Duyệt rút tiền hỏi lại, nêu tên CTV, số tiền, ngân hàng, STK, tông danger cho thao tác không đảo được), D7-02 (Đã chuyển/Đã thu ở đối soát đối tác hỏi lại; Enter trong ô mã giao dịch không tự gửi), D7-04 (account-deletion-panel dùng hộp xác nhận chung của admin thay window.confirm), D7-05 (cashback-tab nhãn trạng thái tiếng Việt), D7-06 (return-request-row: kênh hoàn tiền bằng chữ), D7-07 (users-list định dạng điểm 130.000), D7-11 (badge vai trò tiếng Việt: CTV, Đại lý, Nhân viên...), D7-14 (từ chối đổi/trả hỏi lại, "Đã nhận hàng về" hỏi lại), D7-15 (Duyệt tất cả ca, Chốt lương, Huỷ lời mời hỏi lại), D7-16 (hộp "Đã chi" tông danger, nêu tên CTV, ngân hàng, STK), D7-17 (dl đúng chuẩn), D7-18 (badge "Không dùng" tương phản ≥ 4,5:1), D7-20 (link "Bỏ qua tới nội dung" trong admin-nav/layout thuộc components/admin — KHÔNG sửa portal-header.tsx), D7-21 (menu cuộn tới mục đang chọn), D7-24 (bỏ đường dẫn docs/... khỏi giao diện, thay bằng chữ hướng dẫn ngắn), D7-27 (h2 cho tab Đánh giá, Định kỳ; lỗi danh mục không hiện 2 lần), D8-10 phần components/admin/merchant-products-tab.tsx (ô nhập có label). Dùng hộp xác nhận/tone danger sẵn có của admin (tìm hàm confirm chung trong components/admin hoặc app/admin, ví dụ chỗ xoá đợt flash sale page.tsx:2378). KHÔNG sửa apps/web/src/app/admin/page.tsx (gói khác đang sửa), community-moderation-tab.tsx, waste-point-form.tsx, portal-header.tsx; mục nào bắt buộc sửa page.tsx thì để lại (skipped). Test vitest web cho các hộp xác nhận chính (Duyệt rút, Đã chi, Đã chuyển/Đã thu, từ chối đổi trả) và nhãn tiếng Việt. ${SHOTS(3296, 'web')}`,
    files: 'apps/web/src/components/admin/** (trừ portal-header.tsx, community-moderation-tab.tsx, waste-point-form.tsx), apps/web/src/lib/payout-admin.ts nếu cần',
  },
  {
    key: 'perf-api', race: 25573,
    spec: `Hiệu năng + chữ lỗi API theo ${DOCS}/D9-hieu-nang.md và ${DOCS}/D8-a11y-chu.md. (1) D9-01: /admin/reports/sources chuyển sang kế hoạch generic sau 5 lần và chạy bình phương (đọc mục D9-01 có câu SQL, EXPLAIN và đề xuất); sửa câu truy vấn để kế hoạch không phụ thuộc tham số (vd tiền lọc khách mới vào CTE MATERIALIZED, join theo khoá có chỉ mục) hoặc ép custom plan đúng cách; đo lại bằng công cụ ${UAT}/docs/2026-10-20-uat/tools/perf/ trên cụm Postgres riêng cổng 25573 (nạp dữ liệu như báo cáo đã làm) trước/sau, ghi số ms ở 20k khách vào green. (2) D9-02: POST /events (analytics.controller.ts:22) ghi từng sự kiện: gộp createMany một lần (giữ best-effort, giữ lọc whitelist). (3) D9-04: /products/:slug/bought-together cache ngắn (Redis có sẵn hoặc bộ nhớ, TTL vài phút) hoặc giới hạn quét. (4) D9-05: POST /orders/:code/repurchase thêm nhiều dòng vào giỏ bằng một lần dựng giỏ (không gọi cart.addItem từng dòng nếu có đường bulk; nếu không, thêm hàm bulk trong cart service giữ đúng mọi kiểm tra của addItem). (5) D8-3: apps/api/src/common/guards/jwt-auth.guard.ts lỗi 401 trả message tiếng Việt ("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại" hoặc chữ sẵn có trong code), giữ status/code để client cũ vẫn bắt được. Test đỏ trước: analytics N sự kiện → 1 lần createMany; repurchase N dòng → số lần dựng giỏ = 1 (spy); 401 có message tiếng Việt; reports sources trả cùng kết quả như câu cũ trên dữ liệu mẫu (test so sánh).`,
    files: 'apps/api/src/modules/analytics/**, apps/api/src/modules/admin/*report*.ts, apps/api/src/modules/catalog/** (bought-together), apps/api/src/modules/orders/orders.service.ts (repurchase), apps/api/src/modules/cart/** (nếu cần bulk), apps/api/src/common/guards/jwt-auth.guard*.ts',
  },
]

const WORKER = (p) => `Đọc ${BRIEF} trước (luật cứng, quyết định đã chốt). Bạn sửa MỘT gói: "${p.key}".

Chuẩn bị (đúng thứ tự):
  export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
  cd ${ROOT} && git worktree add -b uat/${p.key} .claude/worktrees/uat-${p.key} ${BASE}
  cd ${ROOT}/.claude/worktrees/uat-${p.key} && pnpm install --prefer-offline && pnpm --filter @tubutree/shared-types build && (cd apps/api && npx prisma generate)
Chỉ làm việc trong ${ROOT}/.claude/worktrees/uat-${p.key}. Không đụng worktree khác, không đụng ${UAT} (đang chạy UAT).

Việc cần sửa:
${p.spec}

Vùng file được sửa: ${p.files}. Sửa ngoài vùng này chỉ khi bắt buộc, và ghi lý do trong decisions. Không sửa apps/web/src ngoài components/admin và app/admin (trừ components/admin/portal-header.tsx).

Cách làm (TDD, bắt buộc):
1. Đọc mã và báo cáo nguồn. Viết test đỏ TRƯỚC trên mã cũ, chạy, chép output fail (tên test + lý do fail đúng lỗi, không phải lỗi biên dịch) vào trường red.
2. Sửa mã tối thiểu cho xanh. Comment chỉ giải thích "vì sao", không kể lại thay đổi. Không làm rộng phạm vi.
3. Kiểm: cd apps/api && npx tsc --noEmit; npx jest <thư mục module đã đụng> (không chạy jest toàn bộ); npx eslint <file đã sửa> --max-warnings=0. Đụng web: cd apps/web && npx tsc --noEmit && npx vitest run <file>. Đụng miniapp: cd apps/miniapp && npx tsc --noEmit && npx vitest run <file> (và TZ=UTC nếu có ngày giờ). Thêm khoá SystemConfig: cd apps/api && npx jest prisma/reference-data src/modules/system-config. Race spec: dựng cụm riêng ${UAT}/docs/2026-10-20-uat/tools/pg-native.sh start ${p.race} && ${UAT}/docs/2026-10-20-uat/tools/pg-native.sh createdb ${p.race} tubutree_it, DATABASE_URL=postgresql://tubu@127.0.0.1:${p.race}/tubutree_it?schema=public npx prisma migrate deploy, rồi npx jest -c test/integration-race/jest.config.js --runInBand <file>; xong thì pg-native.sh stop ${p.race}. Đổi schema Prisma thì tạo migration đúng quy ước repo (prisma migrate dev --create-only trên cụm riêng) và chạy prisma generate.
4. Commit trong nhánh uat/${p.key} (có thể nhiều commit), message tiếng Việt theo lịch sử repo (vd "fix(vouchers): ..."), cuối message: Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>. Không push.
5. Gặp chỗ phải quyết mà luật chưa chốt: chọn phương án an toàn, đảo ngược được (ít mất tiền nhất, dễ tắt bằng cấu hình), ghi vào decisions dạng "chọn X vì Y; câu hỏi cho chủ: ...; phương án khác: ...".
Máy dùng chung: trước lệnh nặng xem uptime, load > 40 thì chờ. Kill chỉ PID mình.`

const REVIEWER = (p, impl, round) => `Đọc ${BRIEF} trước. Review lượt ${round} gói "${p.key}" trước khi gộp vào ${BASE}. Worktree ${impl.worktree}, nhánh ${impl.branch}. Xem diff: cd ${impl.worktree} && git diff ${BASE}...HEAD. Yêu cầu gốc của gói:\n${p.spec}\n\nBáo cáo của worker:\n${JSON.stringify(impl)}\n\nCố chứng minh bản sửa SAI hoặc THIẾU: lỗi gốc còn đường khác lọt qua? test đỏ có thật sự đỏ trên mã cũ (tự kiểm: git stash không được dùng; thay vào đó checkout file mã cũ sang thư mục tạm hoặc đọc lý luận)? bản sửa làm hỏng luồng khác (gọi các nơi dùng hàm đã đổi)? trái luật đã chốt? đồng thời/idempotency? migration/khoá cấu hình đúng quy ước? chữ hiển thị tiếng Việt đúng thuật ngữ? comment kể lại thay đổi (cấm)? Tự chạy lại test của gói (npx jest <file spec của gói>, tsc) và ghi output vào testsRerun. Không sửa file. ok=true chỉ khi không còn lỗi P0/P1/P2.`

const FIXER = (p, impl, rev) => `Đọc ${BRIEF} trước. Gói "${p.key}", worktree ${impl.worktree}, nhánh ${impl.branch}. Reviewer Opus báo các lỗi sau, sửa hết lỗi P0/P1/P2 (P3 sửa nếu rẻ), theo TDD (test đỏ trước cho lỗi hành vi), chạy lại kiểm như lần đầu (tsc, jest module, eslint file sửa, race spec nếu có, cụm Postgres cổng ${p.race}), commit thêm (không amend, không push), cuối message Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>. Lỗi nào không đồng ý thì ghi lý do trong decisions thay vì sửa.\n\nYêu cầu gốc:\n${p.spec}\n\nReview:\n${JSON.stringify(rev)}`

const results = await pipeline(
  PKGS,
  (p) => agent(WORKER(p), { label: `impl:${p.key}`, phase: 'Implement', agentType: 'worker', effort: 'high', schema: IMPL }),
  (impl, p) => impl && agent(REVIEWER(p, impl, 1), { label: `rev1:${p.key}`, phase: 'Review', agentType: 'reviewer', schema: REVIEW })
    .then((rev1) => ({ impl, rev1 })),
  (s, p) => {
    if (!s) return null
    if (s.rev1 && s.rev1.ok && !s.rev1.issues.some((i) => i.severity !== 'P3')) return { ...s, fix: null }
    return agent(FIXER(p, s.impl, s.rev1), { label: `fix:${p.key}`, phase: 'Fix', agentType: 'worker', effort: 'high', schema: IMPL })
      .then((fix) => ({ ...s, fix }))
  },
  (s, p) => {
    if (!s) return null
    const last = s.fix ?? s.impl
    return agent(REVIEWER(p, last, 2), { label: `rev2:${p.key}`, phase: 'Review2', agentType: 'reviewer', schema: REVIEW })
      .then((rev2) => ({ key: p.key, ...s, rev2 }))
  },
)

return results.filter(Boolean).map((r) => ({
  key: r.key,
  branch: r.impl.branch,
  commits: (r.fix ?? r.impl).commits,
  rev1ok: r.rev1?.ok, rev1issues: r.rev1?.issues?.length,
  fixed: !!r.fix,
  rev2ok: r.rev2?.ok, rev2issues: r.rev2?.issues,
  decisions: [...(r.impl.decisions ?? []), ...((r.fix?.decisions) ?? [])],
  skipped: [...(r.impl.skipped ?? []), ...((r.fix?.skipped) ?? [])],
}))
