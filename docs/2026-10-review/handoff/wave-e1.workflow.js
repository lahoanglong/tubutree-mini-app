export const meta = {
  name: 'tubutree-2026-10-wave-e1',
  description: 'Gói PE-1a/PE-1b/PE-2 sau duyệt chủ dự án: chống bấm đôi góp quỹ cây, hạn điểm hoàn, busyRef/key trùng, gỡ /beta, nhãn CO2; mỗi gói một worktree, review opus độc lập',
  phases: [
    { title: 'Implement', detail: 'mỗi gói một agent trong worktree hz13-<gói>, TDD, commit từng mục' },
    { title: 'Review', detail: 'reviewer opus độc lập chỉ đọc diff (PE-1a hai lượt vì đụng điểm/tiền)' },
    { title: 'Fix', detail: 'sửa theo review rồi review lượt 2' },
  ],
}

const ROOT = '/Users/longla/coding/tubutree-mini-app'
const BASE = '6739ca0a'
const WT = (id) => ROOT + '/.claude/worktrees/hz13-' + id
const BR = (id) => 'hz13/' + id

const COMMON = `Quy tắc bất biến:
- Chỉ làm việc trong worktree của gói (đường dẫn ở trên), nhánh riêng. KHÔNG push, KHÔNG deploy, KHÔNG ghi PROD hay DB dùng chung. KHÔNG git stash/reset/checkout file không phải của mình, không đụng worktree khác hay thư mục gốc repo.
- Mọi lệnh shell bắt đầu bằng: export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
- Việc đầu tiên: cd vào worktree, chạy pnpm install --frozen-lockfile, rồi (cd apps/api && npx prisma generate) nếu gói đụng API. Không có timeout trên macOS: dùng until-loop hoặc chạy nền.
- TDD: viết test đỏ trước, thấy đỏ đúng lý do, rồi sửa cho xanh. Từng mục một commit riêng. Commit message tiếng Việt văn xuôi thường, kết thúc bằng dòng: Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
- Comment trong code chỉ giải thích "vì sao" không hiển nhiên, không tả thay đổi vừa làm. Không ghi "chủ dự án nói" vào file.
- Docker (nếu cần Postgres cho race spec): docker run -d --rm --name <tên> --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p <cổng>:5432 postgres:16-alpine ; DB phải tên tubutree_it; kết thúc phải docker rm -f -v <tên>. Không dùng pkill rộng.
- Chạy kiểm CHỈ phạm vi gói: tsc --noEmit của package đã sửa, ESLint các file đã sửa (--max-warnings=0; miniapp có luật tubu-ds), test của file/module đã sửa (jest/vitest), race spec của phần đã sửa nếu có. KHÔNG chạy Playwright hay full suite (điều phối viên chạy sau). Phần chưa chạy ghi rõ "unverified".
- Viết báo cáo docs/2026-10-review/impl/<GÓI>.md trong worktree (văn xuôi tiếng Việt, ngắn: việc đã làm, quyết định thiết kế, lệnh kiểm và kết quả thật, việc chưa verify, rủi ro còn lại) và commit.
- Quyết định chủ dự án đã chốt (docs/2026-10-review/00-ROADMAP.md cuối file): không đổi luật nghiệp vụ ngoài mục tiêu gói. Thuật ngữ Q-26: "Mã giảm giá", "Điểm Xanh", "Ví Tubu", "giọt nước".
- Kết quả cuối: trả đúng schema, kể cả các lệnh đã chạy và exit code thật. Không báo "xong" nếu chưa chạy lại lệnh.`

const PKGS = [
  { id: 'PE-1a', port: 5591, twoPass: true,
    spec: `GÓI PE-1a — API: chống bấm đôi góp quỹ trồng cây + hạn của điểm hoàn khi huỷ đơn (đụng điểm = tiền trả trước, sẽ bị review opus hai lượt).

Mục 1 (OQ-5): POST /game/tree/buy (apps/api/src/modules/game/game.controller.ts, game.service.ts buyTree) hiện mỗi lần gọi sinh certificateCode ngẫu nhiên nên bấm đôi = hai lượt góp = trừ 100 điểm. Thêm header tuỳ chọn Idempotency-Key (cùng tên header với checkout.controller.ts). Có key: gọi lại cùng (user, key) trả lại ĐÚNG kết quả lượt đầu (certificateCode, cost, pointsUsed, pointsUsedConverted) và KHÔNG trừ thêm; hai request song song cùng key chỉ trừ một lần (khoá dòng user đã có; kiểm tra tồn tại BÊN TRONG transaction sau khi khoá). Không có key: hành vi như cũ. Key hợp lệ: chuỗi 8–128 ký tự [A-Za-z0-9_-], sai thì 400 tiếng Việt. Key của user A không được chạm tới bản ghi của user B (khoá phải gắn userId). Ưu tiên thiết kế KHÔNG cần migration (ví dụ certificateCode suy ra tất định từ sha256(userId + ':' + key) rồi tra PlantedTree/PointsTransaction theo mã + reason GAME_BUY_TREE:<mã>; chú ý độ dài/va chạm của mã và ràng buộc unique hiện có trong schema.prisma). Nếu bắt buộc cần cột mới thì chỉ migration additive + giải thích trong báo cáo. Race spec Postgres thật (apps/api/test/integration-race, theo mẫu các spec game/pd3 có sẵn): N request song song cùng key → đúng 1 lượt góp, số dư giảm đúng price một lần, mọi request trả cùng mã; key khác nhau → nhiều lượt; thiếu điểm → 400 không để lại bản ghi; user khác dùng cùng key → lượt độc lập. Unit test cho validate key và replay.

Mục 2 (OQ-15): apps/api/src/modules/loyalty/loyalty.service.ts reverseOrderPoints ghi dòng hoàn ORDER_REFUND_POINTS (lot STANDARD) với expiresAt NULL nên điểm hoàn không bao giờ hết hạn. Đổi: expiresAt = now + loyalty.point_expire_months tháng (cùng cách tính với điểm danh/thưởng STANDARD khác trong file này, tái dùng helper có sẵn). Kiểm cron hết hạn và đối soát (reconcile-points) vẫn nhất quán với dòng hoàn có hạn (tổng dòng STANDARD còn hạn không lệch pointsBalance; cron không trừ trùng). Test đỏ→xanh (unit + race nếu đụng DB). Dòng hoàn cũ có expiresAt NULL (nếu có) KHÔNG backfill: chưa có dữ liệu thật; ghi rõ trong báo cáo. Grep mọi nơi ghi dòng điểm dương lot STANDARD không có expiresAt (pointsTransaction.create / applyPointsDelta) và LIỆT KÊ trong báo cáo (không sửa ngoài ORDER_REFUND_POINTS trừ khi rõ là cùng lỗi và test chứng minh).

Nhóm file: apps/api/src/modules/{game,loyalty}/**, apps/api/test/integration-race/** (spec mới), apps/api/prisma chỉ khi bắt buộc. KHÔNG sửa checkout, order-reversal (chỉ đọc), wallet. Cổng Postgres race của gói: 5591, container tên tubu_it_pe1a.` },
  { id: 'PE-1b', port: 5592, twoPass: false,
    spec: `GÓI PE-1b — Miniapp: chống bấm đôi ở trang Vườn + gửi Idempotency-Key khi góp quỹ cây + cảnh báo React key trùng.

Mục 1: apps/miniapp/src/pages/game.tsx: vòng quay có khoá busyRef, các nút còn lại thì không nên bấm đôi gọi API hai lần. Thêm khoá (busyRef hoặc cơ chế tương đương đã dùng ở vòng quay) cho MỌI nút thực hiện thao tác ghi: tưới/thu hoạch/điểm danh/làm quiz/mở lô/nhận nhiệm vụ/góp quỹ cây... (đọc file để liệt kê đủ); nhả khoá trong finally. Test vitest: bấm đôi nhanh → đúng 1 lần gọi API; lỗi → nhả khoá, bấm lại được.

Mục 2: góp quỹ cây (hộp xác nhận ở tree-actions và service client gọi POST /game/tree/buy): tạo một Idempotency-Key (crypto.randomUUID hoặc fallback an toàn khi WebView không có) MỖI LẦN mở hộp xác nhận, gửi header 'Idempotency-Key' trên request; giữ nguyên key khi cùng hộp xác nhận bị bấm lại/thử lại sau lỗi mạng, tạo key mới sau khi thành công hoặc hộp đóng rồi mở lại. Hợp đồng BE (gói PE-1a làm song song): header tuỳ chọn Idempotency-Key, chuỗi 8–128 ký tự [A-Za-z0-9_-] (UUID bỏ dấu gạch cũng hợp lệ; dùng UUID v4 nguyên dạng có dấu gạch), replay trả cùng body. Test vitest cho key được gửi, giữ khi thử lại, đổi khi mở lại.

Mục 3: cảnh báo React "Encountered two children with the same key" ở miniapp game, loyalty và web apps/web admin-config. Tái hiện bằng vitest/jsdom (render với dữ liệu thật của component, bắt console.error) hoặc đọc mã tìm .map có key không duy nhất (index/code trùng). Phân loại từng nơi: do mã (sửa, kèm test bắt console.error) hay do dữ liệu giả của bộ chụp scripts/uiux (ghi rõ trong báo cáo, không sửa dữ liệu thật). KHÔNG đổi hành vi hiển thị.

Nhóm file: apps/miniapp/src/pages/{game,loyalty}*, apps/miniapp/src/components/game/**, apps/miniapp/src/services/** (client game), apps/web/src/app/admin/** chỉ phần admin-config nếu lỗi key nằm ở đó. KHÔNG sửa apps/api, KHÔNG đổi chữ ngoài mục tiêu.` },
  { id: 'PE-2', port: 5593, twoPass: false,
    spec: `GÓI PE-2 — Gỡ /beta/* và sửa nhãn CO₂ (không đụng tiền).

Mục 1 (PD-2 / Q-19): gỡ 4 route /beta/* khỏi API: module apps/api/src/modules/beta (controller, service, spec, module), import trong app.module.ts, mọi nơi khác tham chiếu (grep BetaService/BetaModule/'/beta'). GIỮ model BetaFeedback và bảng (không DROP, không migration xoá); nếu schema.prisma chưa có chú thích /// @deprecated cho model này thì thêm. Kiểm apps/miniapp (có beta-removed.spec.ts: đảm bảo vẫn đúng), script seed/audit tham chiếu BetaFeedback, apps/e2e, tài liệu endpoint. Tạo lại scripts/uiux/generated/miniapp-endpoints.json bằng node scripts/uiux/extract-endpoints.mjs miniapp (và web nếu script có chế độ web) rồi kiểm không còn /beta. Test: jest của các module bị ảnh hưởng, e2e/spec tham chiếu cập nhật; thêm test (hoặc kiểm tra route) chứng minh GET/POST /beta/* trả 404.

Mục 2 (PD-1): thẻ Tác động xanh ở miniapp (tìm "CO₂"/"CO2" trong apps/miniapp/src, nhất là eco-impact.tsx) ghi số CO₂ hấp thụ như đã xảy ra trong khi chưa trồng cây thật. Đổi chữ thành ước tính có điều kiện (ví dụ "Ước tính" + "khi cây được trồng"), không hứa đã hấp thụ; không đổi công thức hay số. Cập nhật test/snapshot liên quan; thêm guard vitest bắt cụm "CO₂ hấp thụ" không kèm chữ ước tính nếu hợp lý. Kiểm cả apps/web nếu có thẻ tương tự.

Nhóm file: apps/api/src/modules/beta/**, apps/api/src/app.module.ts, apps/api/prisma/schema.prisma (chỉ chú thích), scripts/uiux/generated/**, apps/miniapp/src/components/**/eco-impact*, apps/miniapp/src/beta-removed.spec.ts, apps/web nếu có thẻ CO₂. KHÔNG sửa game/loyalty/checkout.` },
]

function implPrompt(p) {
  return `Bạn là kỹ sư thực hiện gói ${p.id} của dự án Tubu Tree (hardening 2026-10).
Worktree của gói: ${WT(p.id)} (nhánh ${BR(p.id)}, base ${BASE}). Làm CHỈ trong đó.
Cổng Postgres riêng cho race spec của gói: ${p.port}.

${p.spec}

${COMMON}`
}

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    commits: { type: 'array', items: { type: 'string' } },
    reportPath: { type: 'string' },
    verification: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, exitCode: { type: 'number' }, summary: { type: 'string' } }, required: ['command', 'exitCode', 'summary'] } },
    unverified: { type: 'array', items: { type: 'string' } },
    designNotes: { type: 'string' },
  },
  required: ['commits', 'verification', 'unverified'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'CHANGES'] },
    findings: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
      file: { type: 'string' }, line: { type: 'number' },
      issue: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' },
    }, required: ['severity', 'file', 'issue', 'fix'] } },
    ranCommands: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'findings'],
}

function reviewPrompt(p, round, prior) {
  const money = p.id === 'PE-1a'
  return `Bạn là reviewer độc lập, chỉ đọc (không sửa file trong worktree, không commit). Review lượt ${round} gói ${p.id}.
Worktree: ${WT(p.id)} (nhánh ${BR(p.id)}). Diff: git -C ${WT(p.id)} diff ${BASE}..HEAD. Đọc cả file đầy đủ quanh các chỗ đổi, không chỉ hunk.
Export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH trước mọi lệnh. Bạn được chạy test của phạm vi gói; nếu cần Postgres: docker run -d --rm --name tubu_rv_${p.id.toLowerCase().replace('-', '')}_${round} --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p ${p.port + 10 + round}:5432 postgres:16-alpine rồi docker rm -f -v khi xong. Không push, không đụng worktree khác, không pkill rộng.
Mục tiêu gói:
${p.spec}
${money ? `Đây là gói đụng điểm (tiền trả trước của khách): tấn công nó. Tìm: race/bấm đôi vẫn trừ hai lần, replay trả sai body, key của user này chạm bản ghi user khác, va chạm mã chứng nhận/unique P2002 thành 500, số dư âm, lô STANDARD/CONVERTED lệch, khoá dòng user bị bỏ sót, dòng hoàn có hạn làm cron hết hạn hoặc reconcile-points lệch pointsBalance, trừ trùng khi hết hạn, đường vào không qua controller. Dựng test/lệnh thật để chứng minh khi có thể; finding nào chỉ "có vẻ" thì ghi rõ là chưa chứng minh.` : `Tìm: hồi quy hành vi ngoài mục tiêu, test yếu (xanh dù mã sai), sót chỗ tham chiếu, vi phạm luật tubu-ds/thuật ngữ Q-26, chữ hứa quá.`}
${prior ? `Lượt trước có các finding sau; kiểm từng cái đã sửa thật chưa (chạy lại test chứng minh) và tìm thêm vấn đề mới do bản sửa:\n${JSON.stringify(prior)}` : ''}
Mặc định nghi ngờ: nếu không chạy được lệnh kiểm, ghi vào ranCommands cái đã chạy và nêu cái không chạy được. Chỉ gắn blocker/major khi có bằng chứng cụ thể (file:line hoặc lệnh).`
}

function fixPrompt(p, findings) {
  return `Bạn đang sửa gói ${p.id} theo review độc lập. Worktree: ${WT(p.id)} (nhánh ${BR(p.id)}). Làm CHỈ trong đó.
Các finding (blocker/major bắt buộc sửa; minor sửa nếu rẻ và an toàn, còn lại ghi lý do bỏ trong báo cáo gói):
${JSON.stringify(findings, null, 2)}
Với mỗi finding: xác minh trên mã trước (reviewer có thể sai; nếu sai thì ghi bằng chứng, không sửa), viết test đỏ nếu là lỗi hành vi, sửa, commit riêng. Cập nhật docs/2026-10-review/impl/${p.id}.md (mục "Sau review") và commit.
${COMMON}`
}

phase('Implement')
const results = await parallel(PKGS.map(p => async () => {
  const impl = await agent(implPrompt(p), { label: 'impl:' + p.id, phase: 'Implement', schema: IMPL_SCHEMA, model: 'sonnet' })
  if (!impl) return { id: p.id, error: 'implement agent trả null' }
  let r1 = await agent(reviewPrompt(p, 1, null), { label: 'review1:' + p.id, phase: 'Review', schema: REVIEW_SCHEMA, model: 'opus', effort: 'high' })
  let fix = null, r2 = null
  const blocking = r1 ? r1.findings.filter(f => f.severity !== 'minor') : []
  const needFix = r1 && r1.findings.length > 0 && (blocking.length > 0 || p.twoPass)
  if (needFix) {
    fix = await agent(fixPrompt(p, r1.findings), { label: 'fix:' + p.id, phase: 'Fix', schema: IMPL_SCHEMA, model: 'sonnet' })
  }
  if (p.twoPass || blocking.length > 0) {
    r2 = await agent(reviewPrompt(p, 2, r1 ? r1.findings : null), { label: 'review2:' + p.id, phase: 'Review', schema: REVIEW_SCHEMA, model: 'opus', effort: 'high' })
  }
  return { id: p.id, branch: BR(p.id), worktree: WT(p.id), impl, review1: r1, fix, review2: r2 }
}))
return results.filter(Boolean)
