export const meta = {
  name: 'web-e2e-fix',
  description: 'Make the web Playwright suite (web-gate.sh) green: stabilise the web server, fix shell API calls, then fix spec groups in parallel worktrees, Opus review of app-code changes',
  phases: [
    { title: 'Base', detail: 'one worker: production web server for e2e, shell API calls on every page' },
    { title: 'Base review', detail: 'Opus review of app-code changes in the base step' },
    { title: 'Groups', detail: 'one worker per spec group, own worktree and ports' },
    { title: 'Review', detail: 'Opus review of app-code changes from the groups' },
  ],
}

const A = args
const ROOT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees'
const DOCS = `${ROOT}/web-parity/docs/2026-10-19-web-parity`
const LOGS = `${ROOT}/gate-logs/e2efix`
const ENV = 'export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH'

const RULES = `Luật cứng:
- Không git push, không PR, không merge vào main, không deploy, không ghi DB/Redis dùng chung. Playwright CHỈ chạy qua \`bash apps/e2e/scripts/web-gate.sh\` (Postgres/Redis tạm trong Docker, khoá tích hợp rỗng); không bao giờ \`npx playwright test\` trần.
- Docker chỉ \`docker run --rm --tmpfs\` và \`docker rm -f -v\` (script đã làm). Không \`pkill -f\`; dừng tiến trình chỉ theo cổng của mình: \`lsof -ti tcp:<cổng> -sTCP:LISTEN | xargs kill\`.
- Không sửa test hay code của Mini App. Không đổi endpoint/body API; không sửa \`apps/api\`.
- Sửa SPEC khi spec sai (mock thiếu/sai route, bộ chọn sai, chờ sai). Sửa CODE APP chỉ khi chứng minh được app sai so với Mini App (đọc file Mini App tương ứng, ghi file:dòng hai bên), kèm test vitest đỏ trước; chỗ dính tiền, điểm, mã giảm giá, hoa hồng, xác thực: không tự sửa, ghi vào openIssues kèm bằng chứng.
- Không viết comment kể lại thay đổi; comment chỉ giải thích lý do không hiển nhiên, tiếng Việt như code xung quanh. Mỗi nhóm sửa một commit, thông điệp tiếng Việt nói lý do, trailer \`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\`.
- Nói "xanh" chỉ khi đã chạy và thấy kết quả. Máy dùng chung: ca hết giờ thì chạy lại riêng ca đó trước khi kết luận.`

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    green: { type: 'boolean' },
    summary: { type: 'string', description: 'dòng tổng kết Playwright lần chạy cuối (passed/failed/flaky/skipped) và lệnh đã chạy' },
    commits: { type: 'array', items: { type: 'string' } },
    appChanges: { type: 'array', items: { type: 'string' }, description: 'commit đụng code app (không phải spec/e2e), kèm một dòng lý do' },
    openIssues: { type: 'string' },
  },
  required: ['green', 'summary', 'commits', 'appChanges', 'openIssues'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['BLOCKER', 'MAJOR', 'MINOR'] },
          file: { type: 'string' },
          line: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'file', 'line', 'problem', 'fix'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['findings', 'summary'],
}

const gateCmd = (wt, p, out, files) =>
  `cd ${wt} && ${ENV} && E2E_API_PORT=${p.api} E2E_WEB_PORT=${p.web} E2E_MINIAPP_PORT=${p.mini} GATE_PG_PORT=${p.pg} GATE_REDIS_PORT=${p.redis} bash apps/e2e/scripts/web-gate.sh --reporter=line ${files} > ${out} 2>&1`

// ---------- Base ----------
phase('Base')
const baseWt = `${ROOT}/web-e2efix`
const basePorts = { api: 3131, web: 3132, mini: 3133, pg: 15532, redis: 16479 }
let base = await agent(
  `Bạn sửa bộ e2e web (Playwright) của Tubu Tree cho xanh, bước nền. Làm DUY NHẤT trong worktree \`${baseWt}\` (nhánh \`web/e2efix\`, đã có sẵn, đã \`pnpm install\` và build shared-types). Mọi lệnh: \`cd ${baseWt} && ${ENV}\`.

${RULES}

Bối cảnh: lần chạy \`web-gate.sh\` đầy đủ trên web/integration (log \`${ROOT}/gate-logs/integration/e2e-5/web-gate.log\`) ra 274 failed / 11 passed / 1 flaky / 6 skipped trong 32 phút. Hai nhóm lỗi:
(a) Từ khoảng ca 182 mọi \`page.goto\` báo \`net::ERR_CONNECTION_REFUSED\`: máy chủ web e2e là \`next dev\` (\`apps/e2e/playwright.config.ts\` WEB_COMMAND), dịch từng trang lúc chạy với nhiều worker song song rồi chết giữa chừng, không có log.
(b) 135 lỗi "Có lời gọi API chưa mock" (helper \`apps/e2e/tests/support/mock-api.ts\`), chủ yếu \`GET /cart\` (72), \`GET /me\` (57), \`GET /orders/active-count\` (36), gặp cả ở spec Web Admin (admin*.spec.ts, trước đây xanh ở nhánh đổi rác) lẫn spec khách *.web.spec.ts. Đây là lời gọi toàn cục mới của vỏ web và các gate toàn cục (ví dụ \`apps/web/src/components/coupon-claim-gate.tsx\` luôn \`useQuery(getCart)\` khi đã đăng nhập dù không có mã chờ nhận; badge đơn ở header; khôi phục phiên).

Việc:
1. Máy chủ web e2e ổn định: khi chạy qua web-gate (thêm một biến môi trường, ví dụ \`E2E_WEB_PROD=1\` do \`web-gate.sh\` export), dùng bản build (\`next build\` rồi \`next start -p <cổng>\`) thay \`next dev\`; giữ nguyên hành vi khi không có biến đó (phiên khác dùng scope miniapp/web-admin). Ghi stdout/stderr máy chủ web và API ra file (ví dụ \`apps/e2e/test-results/webserver-*.log\` hoặc thư mục log do biến môi trường chỉ định) để lần sau có log khi chết. Biến \`NEXT_PUBLIC_*\` phải có lúc build.
2. Lời gọi toàn cục: với từng lời gọi \`GET /cart\`, \`GET /me\`, \`GET /orders/active-count\` (và lời gọi chưa mock khác lặp ở nhiều spec): tìm nơi gọi trên web, so với Mini App (\`apps/miniapp/src/components/app.tsx\` và gate tương ứng). Lời gọi thừa so với Mini App (ví dụ gate nhận mã gọi giỏ khi không có mã chờ; vỏ khách gọi trên trang \`/admin\`) thì sửa app, kèm vitest đỏ trước. Lời gọi đúng và cần thì thêm mock mặc định trong helper e2e chung (ví dụ \`mock-api.ts\` có sẵn phản hồi mặc định cho các lời gọi vỏ, spec ghi đè được) để mọi spec không phải tự mock.
3. Chạy toàn bộ: \`${gateCmd(baseWt, basePorts, `${LOGS}/base-1.log`, '')}\` (25–40 phút). Đọc kết quả, sửa tiếp lỗi chung (nhiều spec cùng lỗi) nếu còn, chạy lại với \`base-2.log\`... Không sửa lỗi riêng của từng spec ở bước này (bước sau làm theo nhóm). Chạy thêm \`pnpm --filter @tubutree/web typecheck && pnpm --filter @tubutree/web lint && pnpm --filter @tubutree/web test\` nếu đụng code web.
4. Trả về: dòng tổng kết lần chạy cuối, commit, commit đụng code app, và trong openIssues: danh sách spec file còn đỏ kèm số ca đỏ và lỗi đại diện của mỗi file.`,
  { label: 'e2e:base', phase: 'Base', agentType: 'worker', effort: 'medium', schema: RESULT_SCHEMA },
)

phase('Base review')
if (base && base.appChanges && base.appChanges.length) {
  const rv = await agent(
    `Review đối kháng các commit đụng code APP (không phải spec e2e) ở nhánh \`web/e2efix\`, worktree \`${baseWt}\`: \`git -C ${baseWt} log ${A.base}..HEAD\`, \`git -C ${baseWt} diff ${A.base}...HEAD -- apps/web packages\`. Danh sách lane khai: ${JSON.stringify(base.appChanges)}. Chỉ đọc, không sửa.

Mini App là chuẩn: mỗi thay đổi hành vi phải có căn cứ ở file Mini App tương ứng (đọc và so). Kiểm: thay đổi không làm mất chức năng (ví dụ gate nhận mã vẫn nhận mã đúng một lần sau đăng nhập; badge đơn vẫn đúng trên trang khách), không đổi endpoint/body API, có test. Tự chạy vitest/tsc để chứng minh. Chỉ báo lỗi thật có file:dòng và cách sửa. Không khen.`,
    { label: 'e2e:base-review', phase: 'Base review', agentType: 'reviewer', schema: REVIEW_SCHEMA },
  )
  const serious = (rv && rv.findings || []).filter((f) => f.severity !== 'MINOR')
  log(`e2e base review: ${serious.length} BLOCKER/MAJOR, ${(rv && rv.findings || []).length - serious.length} MINOR`)
  if (rv && rv.findings && rv.findings.length) {
    base = await agent(
      `Làm trong worktree \`${baseWt}\` (nhánh \`web/e2efix\`). Mọi lệnh: \`cd ${baseWt} && ${ENV}\`.\n\n${RULES}\n\nSửa theo review (BLOCKER/MAJOR bắt buộc, test đỏ trước; MINOR sửa nếu nhỏ; phát hiện chứng minh được là sai thì ghi lý do):\n${JSON.stringify(rv.findings, null, 1)}\n\nSau khi sửa chạy \`pnpm --filter @tubutree/web typecheck && pnpm --filter @tubutree/web lint && pnpm --filter @tubutree/web test\`. Không cần chạy lại Playwright đầy đủ trừ khi sửa đụng hành vi mà spec e2e kiểm; nếu chạy, dùng \`${gateCmd(baseWt, basePorts, `${LOGS}/base-fix.log`, '')}\`. Trả về theo schema; openIssues giữ nguyên danh sách spec còn đỏ của bước trước (cập nhật nếu đã chạy lại): ${JSON.stringify(base.openIssues)}`,
      { label: 'e2e:base-fix', phase: 'Base review', agentType: 'worker', effort: 'medium', schema: RESULT_SCHEMA },
    )
  }
}

// ---------- Groups ----------
phase('Groups')
const GROUPS = [
  { key: 'g1', files: 'tests/admin.spec.ts tests/admin-analytics.spec.ts tests/admin-customer-refunds.spec.ts tests/admin-external-claims.spec.ts tests/admin-waste.spec.ts tests/account.web.spec.ts tests/community.web.spec.ts', ports: { api: 3141, web: 3142, mini: 3143, pg: 15542, redis: 16489 } },
  { key: 'g2', files: 'tests/affiliate.web.spec.ts tests/game.web.spec.ts tests/loyalty.web.spec.ts tests/order.web.spec.ts', ports: { api: 3151, web: 3152, mini: 3153, pg: 15552, redis: 16499 } },
  { key: 'g3', files: 'tests/pro.web.spec.ts tests/recycle.web.spec.ts tests/shop.web.spec.ts tests/web-checkout.web.spec.ts tests/web-customer.web.spec.ts', ports: { api: 3161, web: 3162, mini: 3163, pg: 15562, redis: 16509 } },
]
const groupResults = await parallel(GROUPS.map((g) => () => {
  const wt = `${ROOT}/web-e2efix-${g.key}`
  return agent(
    `Bạn sửa một nhóm spec e2e web (Playwright) của Tubu Tree cho xanh. Nhóm \`${g.key}\`: ${g.files}.

Chuẩn bị (tự làm): \`cd /Users/longla/coding/tubutree-mini-app/.claude/worktrees/web-parity && git worktree add -b web/e2efix-${g.key} ${wt} web/e2efix\` (nếu worktree đã có thì dùng lại), rồi \`cd ${wt} && ${ENV} && pnpm install --prefer-offline && pnpm --filter @tubutree/shared-types build\`. Làm DUY NHẤT trong \`${wt}\`. Cổng của nhóm này là cố định (các nhóm khác chạy song song trên cổng khác), luôn chạy đúng lệnh:
\`${gateCmd(wt, g.ports, `${LOGS}/${g.key}-<lần>.log`, '<các file spec>')}\`

${RULES}
- Chỉ sửa spec của nhóm mình. Không sửa \`apps/e2e/tests/support/*\`, \`apps/e2e/playwright.config.ts\`, \`apps/e2e/scripts/*\` (nhóm khác chạy song song; cần thì ghi openIssues). Sửa code app chỉ theo luật trên và ghi vào appChanges.

Bối cảnh: bước nền đã cho máy chủ web e2e chạy bản build và thêm mock mặc định cho lời gọi vỏ. Kết quả bước nền: ${JSON.stringify(base && { summary: base.summary, openIssues: base.openIssues })}.

Việc: chạy nhóm, đọc từng ca đỏ (log, \`apps/e2e/test-results/*/error-context.md\`), tìm nguyên nhân gốc, sửa, chạy lại riêng file đó, lặp tới khi cả nhóm xanh (cả project "Web Customer" và "Web Customer Mobile" với spec khách; "Web Admin" với spec admin). Ca chỉ đỏ vì hết giờ khi máy tải: chạy lại riêng để chứng minh. Ca đỏ vì app sai mà thuộc vùng tiền/điểm/xác thực: để \`test.fixme\` KHÔNG được; giữ ca đỏ, ghi openIssues kèm bằng chứng. Cuối cùng chạy cả nhóm một lần nữa và trả về dòng tổng kết của lần đó.`,
    { label: `e2e:${g.key}`, phase: 'Groups', agentType: 'worker', effort: 'medium', schema: RESULT_SCHEMA },
  )
}))

phase('Review')
const appChanges = groupResults.filter(Boolean).flatMap((r, i) => (r.appChanges || []).map((c) => `${GROUPS[i].key} (web/e2efix-${GROUPS[i].key}): ${c}`))
let groupReview = null
if (appChanges.length) {
  groupReview = await agent(
    `Review đối kháng các commit đụng code APP (không phải spec e2e) của các nhánh sửa e2e theo nhóm. Chỉ đọc, không sửa. Danh sách: ${JSON.stringify(appChanges)}. Diff mỗi nhánh: \`git -C ${ROOT}/web-parity diff web/e2efix...web/e2efix-<nhóm> -- apps/web packages\`.

Mini App là chuẩn: mỗi thay đổi hành vi phải có căn cứ ở file Mini App tương ứng. Kiểm không đổi endpoint/body API, không mất chức năng, có test vitest. Tự chạy test để chứng minh (trong worktree \`${ROOT}/web-e2efix-<nhóm>\`). Chỉ báo lỗi thật có file:dòng và cách sửa. Không khen.`,
    { label: 'e2e:groups-review', phase: 'Review', agentType: 'reviewer', schema: REVIEW_SCHEMA },
  )
  log(`e2e groups review: ${(groupReview && groupReview.findings || []).length} phát hiện`)
}

return { base, groups: groupResults.map((r, i) => ({ group: GROUPS[i].key, files: GROUPS[i].files, result: r })), groupReview }
