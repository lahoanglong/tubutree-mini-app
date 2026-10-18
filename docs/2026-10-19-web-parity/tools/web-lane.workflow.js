export const meta = {
  name: 'web-lane-v2',
  description: 'Implement one web-parity lane from its lanes/<lane>.json, gate it, review with Opus, fix, and write the lane report',
  phases: [
    { title: 'Implement', detail: 'worker agents, one per task, sequential in the lane worktree' },
    { title: 'Gate', detail: 'run lane-gate.sh, fix in-scope failures' },
    { title: 'Review', detail: 'Opus reviewer rounds with fixes in between' },
    { title: 'Report', detail: 'write impl/<lane>.md' },
  ],
}

const A = args
const DOCS = `${A.wt}/docs/2026-10-19-web-parity`
const LANEFILE = `${DOCS}/lanes/${A.lane}.json`
const LOGROOT = `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-logs/${A.lane}`
const GATECMD = (tag) => `bash ${DOCS}/tools/lane-gate.sh ${A.wt} ${LOGROOT}/${tag}`

const COMMON = `Bạn làm lane \`${A.lane}\` của chương trình đưa toàn bộ chức năng Zalo Mini App lên website (monorepo Tubu Tree).

Làm việc DUY NHẤT trong worktree \`${A.wt}\` (nhánh \`${A.branch}\`). Mọi lệnh shell: \`cd ${A.wt}\` trước, và \`export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH\`.

Tài liệu bắt buộc đọc phần liên quan: \`${DOCS}/01-thiet-ke.md\` (thiết kế), \`${DOCS}/02-ke-hoach.md\` (phạm vi lane, chủ file), \`${DOCS}/00-ma-tran.md\` (ma trận). Cấu hình lane (việc, trọng tâm review): \`${LANEFILE}\`. Báo cáo lane đã gộp trước ở \`${DOCS}/impl/\` (đọc để biết app-core, adapter, primitive, route map đã có gì). Quyết định chủ dự án Q1–Q8 và luật cứng ở \`${DOCS}/PROMPT.md\`.

Luật cứng:
- Không git push, không PR, không merge vào main, không deploy, không ghi DB dùng chung. Không chạy Playwright (chỉ viết spec), trừ khi việc của bạn nói rõ.
- Không đổi hành vi API đang có; chỉ thêm khi thật cần, có test.
- Không sửa test của Mini App để cho xanh. Test Mini App phải xanh, tổng số test vitest Mini App không giảm so với lúc lane bắt đầu (và không dưới 4243). \`profile-hub.spec.tsx\` của Mini App đôi khi chập chờn do tải: chạy riêng lại trước khi kết luận.
- Chỉ sửa file thuộc lane này theo 02-ke-hoach.md. Cần sửa file của lane khác thì ghi lại, không sửa.
- Không xoá hay revert file mình không tạo. Không \`pkill -f\`; chỉ kill theo cổng: \`lsof -ti tcp:<port> -sTCP:LISTEN | xargs kill\`. Docker chỉ \`docker run --rm --tmpfs\` và \`docker rm -f -v\`.
- Không viết comment kể lại thay đổi; comment chỉ giải thích lý do không hiển nhiên, theo idiom và mật độ comment của code xung quanh (tiếng Việt như code hiện có).
- Chỗ dính tiền, điểm, ví, mã giảm giá, hoa hồng, xác thực, SĐT: web gửi cùng endpoint, cùng body, cùng Idempotency-Key như Mini App; không tự quyết thêm, chọn phương án an toàn nhất và ghi câu hỏi.
- TDD: viết test đỏ trước, rồi code. Mỗi mục một commit, thông điệp tiếng Việt nói lý do.
- Nói "xong" chỉ khi đã chạy lệnh kiểm chứng và thấy kết quả; chưa chạy thì nói "chưa kiểm chứng".
- Máy dùng chung đang tải cao; test chậm hoặc timeout do tải thì chạy lại riêng file đó trước khi kết luận là lỗi.`

const TASK_SCHEMA = {
  type: 'object',
  properties: {
    done: { type: 'boolean' },
    commits: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    verification: { type: 'string', description: 'lệnh đã chạy và dòng kết quả quyết định' },
    openIssues: { type: 'string' },
  },
  required: ['done', 'commits', 'summary', 'verification', 'openIssues'],
}
const GATE_SCHEMA = {
  type: 'object',
  properties: {
    green: { type: 'boolean' },
    results: { type: 'string', description: 'nội dung summary.txt của lần gate cuối' },
    commits: { type: 'array', items: { type: 'string' } },
    openIssues: { type: 'string' },
  },
  required: ['green', 'results', 'commits', 'openIssues'],
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

phase('Implement')
const taskResults = []
for (let i = 0; i < A.taskTitles.length; i++) {
  const r = await agent(
    `${COMMON}\n\n## Việc ${i + 1}/${A.taskTitles.length}: ${A.taskTitles[i]}\n\nNội dung chi tiết: đọc phần tử \`tasks[${i}]\` (trường \`prompt\`) trong \`${LANEFILE}\` và làm đúng như vậy.\n\nKhi xong: chạy test của phần vừa làm (và typecheck app bị đụng), commit, trả về theo schema. Không làm việc của các mục sau.`,
    { label: `${A.lane}:task${i + 1}`, phase: 'Implement', agentType: 'worker', effort: A.effort, schema: TASK_SCHEMA },
  )
  taskResults.push({ title: A.taskTitles[i], result: r })
  if (!r) log(`${A.lane}: task ${i + 1} trả null`)
}

phase('Gate')
let gateRun = 0
const gatePrompt = (extra) => {
  gateRun++
  return `${COMMON}\n\n## Gate của lane\n\n${extra}\n\nChạy gate: \`${GATECMD(`run${gateRun}`)}\` (mất 15–30 phút khi máy tải cao; chạy nền và chờ dòng DONE trong summary.txt). Kết quả tóm tắt ở \`${LOGROOT}/run${gateRun}/summary.txt\`, log từng bước cùng thư mục. Bước nào rc khác 0: đọc log, tìm nguyên nhân gốc. Do code của lane này thì sửa (test đỏ trước nếu là lỗi hành vi), commit, chạy lại riêng bước đó rồi chạy lại toàn bộ gate (đổi tên thư mục ra, ví dụ \`run${gateRun}b\`). Do môi trường/tải máy thì chạy lại riêng để chứng minh. Do code ngoài lane thì KHÔNG sửa, ghi vào openIssues kèm dòng lỗi. Trả về nội dung summary.txt của lần chạy cuối.`
}
let gate = await agent(gatePrompt(''), { label: `${A.lane}:gate`, phase: 'Gate', agentType: 'worker', effort: A.effort, schema: GATE_SCHEMA })

phase('Review')
const reviews = []
let round = 0
let serious = true
while (round < A.maxRounds && (round < A.reviewRounds || serious)) {
  round++
  const prior = reviews.length
    ? `\n\nCác lượt review trước (kiểm lại đã sửa đúng chưa, đừng lặp lại phát hiện đã sửa):\n${JSON.stringify(reviews.map((r) => r && r.findings), null, 1)}`
    : ''
  const rv = await agent(
    `Review đối kháng lane \`${A.lane}\` (lượt ${round}). Chỉ đọc, không sửa file. Worktree \`${A.wt}\`, nhánh \`${A.branch}\`. Diff: \`git -C ${A.wt} diff ${A.base}...HEAD\` (và \`git -C ${A.wt} log ${A.base}..HEAD\`).\n\nPhạm vi và thiết kế: \`${DOCS}/01-thiet-ke.md\`, \`${DOCS}/02-ke-hoach.md\`, \`${DOCS}/00-ma-tran.md\`, luật cứng và Q1–Q8 ở \`${DOCS}/PROMPT.md\`. Việc của lane và trọng tâm review: trường \`tasks\` và \`reviewFocus\` trong \`${LANEFILE}\`.\n\nKiểm:\n1. Hành vi web so với Mini App (đọc file Mini App tương ứng): chữ, trạng thái, quyền, luồng lỗi; có bỏ sót chức năng con nào trong việc của lane.\n2. Tiền/điểm/mã/hoa hồng/xác thực: endpoint, body, Idempotency-Key giống hệt Mini App; không có đường làm lệch số tiền hay gửi hai lần.\n3. Mini App không bị đổi hành vi; test Mini App không bị sửa để cho xanh.\n4. Test kiểm hành vi thật (không chỉ render); có test cho nhánh lỗi.\n5. Lane có sửa file ngoài phạm vi không.\n6. Bảo mật: XSS, open redirect, lộ token, CSP. SEO trang công khai.\nTự chạy lệnh để chứng minh khi cần (test, tsc, grep). Chỉ báo lỗi thật, có file:dòng và cách sửa cụ thể. Không khen.${prior}`,
    { label: `${A.lane}:review${round}`, phase: 'Review', agentType: 'reviewer', schema: REVIEW_SCHEMA },
  )
  reviews.push(rv)
  const fs = (rv && rv.findings) || []
  serious = fs.some((f) => f.severity !== 'MINOR')
  log(`${A.lane} review ${round}: ${fs.filter((f) => f.severity === 'BLOCKER').length} BLOCKER, ${fs.filter((f) => f.severity === 'MAJOR').length} MAJOR, ${fs.filter((f) => f.severity === 'MINOR').length} MINOR`)
  if (fs.length) {
    gate = await agent(
      gatePrompt(`Trước khi chạy gate: sửa các phát hiện review lượt ${round} dưới đây. BLOCKER và MAJOR bắt buộc sửa (test đỏ trước). MINOR sửa nếu nhỏ, không thì ghi vào openIssues kèm lý do. Phát hiện bạn chứng minh được là sai thì không sửa, ghi lý do vào openIssues.\n\n${JSON.stringify(fs, null, 1)}`),
      { label: `${A.lane}:fix${round}`, phase: 'Review', agentType: 'worker', effort: A.effort, schema: GATE_SCHEMA },
    )
  }
}
if (serious) log(`${A.lane}: hết ${A.maxRounds} lượt review mà vẫn còn BLOCKER/MAJOR`)

phase('Report')
const report = await agent(
  `${COMMON}\n\n## Viết báo cáo lane\n\nViết \`${DOCS}/impl/${A.lane}.md\` (tiếng Việt, ngắn, rõ) rồi commit:\n1. Đã làm: bảng mục → commit → file chính; route web nào đã xong (đã bỏ pending).\n2. Kiểm chứng: dán nội dung summary.txt của gate cuối (đường dẫn trong dữ liệu dưới).\n3. Review: mỗi lượt, mỗi phát hiện → đã sửa ở commit nào / không sửa vì sao.\n4. Chưa làm, cố ý để lại, chưa kiểm chứng.\n5. Câu hỏi cho chủ dự án, mỗi câu kèm mặc định đã dùng.\n\nDữ liệu các bước trước:\nTask: ${JSON.stringify(taskResults)}\nGate cuối: ${JSON.stringify(gate)}\nReview: ${JSON.stringify(reviews)}\n\nTrả về: một đoạn tóm tắt 5–10 dòng (gate xanh hay không, số test thêm, phát hiện còn mở, câu hỏi).`,
  { label: `${A.lane}:report`, phase: 'Report', agentType: 'worker', effort: 'medium' },
)

return { lane: A.lane, gateGreen: gate && gate.green, gate, openSerious: serious, reviewRounds: round, report }
