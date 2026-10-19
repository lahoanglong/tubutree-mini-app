export const meta = {
  name: 'web-lane-finish',
  description: 'Finish a web-parity lane that ended with a red gate or open BLOCKER/MAJOR: fix, gate, Opus re-review, update the lane report',
  phases: [
    { title: 'Fix', detail: 'worker fixes the named issue and runs the gate' },
    { title: 'Review', detail: 'Opus re-review of the risky area, fix rounds' },
    { title: 'Report', detail: 'append to impl/<lane>.md' },
  ],
}

const A = args
const DOCS = `${A.wt}/docs/2026-10-19-web-parity`
const LANEFILE = `${DOCS}/lanes/${A.lane}.json`
const LOGROOT = `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-logs/${A.lane}`
const GATECMD = (tag) => `bash ${DOCS}/tools/lane-gate.sh ${A.wt} ${LOGROOT}/${tag}`

const COMMON = `Bạn hoàn tất lane \`${A.lane}\` của chương trình đưa toàn bộ chức năng Zalo Mini App lên website (monorepo Tubu Tree).

Làm việc DUY NHẤT trong worktree \`${A.wt}\` (nhánh \`${A.branch}\`). Mọi lệnh shell: \`cd ${A.wt}\` trước, và \`export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH\`.

Đọc: \`${DOCS}/impl/${A.lane}.md\` (báo cáo lane, các vòng review trước), \`${DOCS}/01-thiet-ke.md\`, \`${DOCS}/02-ke-hoach.md\`, \`${DOCS}/PROMPT.md\` (Q1–Q8, luật cứng), \`${LANEFILE}\`.

Luật cứng:
- Không git push, không PR, không merge vào main, không deploy, không ghi DB dùng chung. Không chạy Playwright.
- Không sửa test của Mini App. Test Mini App phải xanh, không dưới ${A.miniappFloor} ca.
- Chỉ sửa file thuộc lane theo 02-ke-hoach.md.
- Không xoá hay revert file mình không tạo. Không \`pkill -f\`; chỉ kill theo cổng.
- Không viết comment kể lại thay đổi; comment chỉ giải thích lý do không hiển nhiên (tiếng Việt như code xung quanh).
- Chỗ dính tiền, điểm, ví, mã giảm giá, hoa hồng, xác thực, SĐT: Mini App là chuẩn. Web gửi cùng endpoint, cùng body, cùng cách dùng Idempotency-Key như Mini App; lệch Mini App chỉ khi chứng minh được web có rủi ro riêng mà Mini App không có, và phải ghi rõ lý do.
- TDD: test đỏ trước, rồi code. Mỗi mục một commit, thông điệp tiếng Việt nói lý do.
- Máy dùng chung tải rất cao: test timeout thì chạy lại riêng file đó trước khi kết luận.
- Nói "xong" chỉ khi đã chạy lệnh kiểm chứng và thấy kết quả.`

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

let gateRun = 0
const gateText = () => {
  gateRun++
  const tag = `${A.gatePrefix}${gateRun}`
  return `Chạy gate: \`${GATECMD(tag)}\` (15–40 phút khi máy tải cao; chạy nền và chờ dòng DONE trong \`${LOGROOT}/${tag}/summary.txt\`). Bước nào rc khác 0: đọc log cùng thư mục, tìm nguyên nhân gốc. Do code của lane: sửa (test đỏ trước), commit, chạy lại riêng bước đó rồi chạy lại toàn bộ gate với thư mục \`${tag}b\`. Do môi trường/tải: chạy lại riêng để chứng minh. Do code ngoài lane: không sửa, ghi vào openIssues kèm dòng lỗi. Trả về nội dung summary.txt của lần chạy cuối.`
}

phase('Fix')
let gate = await agent(
  `${COMMON}\n\n## Việc cần sửa\n\n${A.issue}\n\n${gateText()}`,
  { label: `${A.lane}:finish-fix`, phase: 'Fix', agentType: 'worker', effort: 'medium', schema: GATE_SCHEMA },
)

phase('Review')
const reviews = []
let serious = true
let round = 0
while (round < A.maxRounds && serious) {
  round++
  const prior = reviews.length ? `\n\nLượt review hoàn tất trước (kiểm đã sửa đúng chưa, không lặp lại):\n${JSON.stringify(reviews.map((r) => r && r.findings), null, 1)}` : ''
  const rv = await agent(
    `Review đối kháng phần rủi ro của lane \`${A.lane}\` (lượt hoàn tất ${round}). Chỉ đọc, không sửa file. Worktree \`${A.wt}\`, nhánh \`${A.branch}\`. Diff toàn lane: \`git -C ${A.wt} diff ${A.base}...HEAD\`; log: \`git -C ${A.wt} log ${A.base}..HEAD\`. Báo cáo lane và các vòng review cũ: \`${DOCS}/impl/${A.lane}.md\`. Luật và Q1–Q8: \`${DOCS}/PROMPT.md\`.\n\nTrọng tâm:\n${A.reviewFocus}\n\nMini App là chuẩn: đọc file Mini App tương ứng và so từng nhánh (thành công, lỗi mạng, kết quả chưa rõ, bấm lại, đổi lựa chọn). Tự chạy test/tsc/grep để chứng minh. Chỉ báo lỗi thật, có file:dòng và cách sửa cụ thể. Không khen.${prior}`,
    { label: `${A.lane}:finish-review${round}`, phase: 'Review', agentType: 'reviewer', schema: REVIEW_SCHEMA },
  )
  reviews.push(rv)
  const fs = (rv && rv.findings) || []
  serious = fs.some((f) => f.severity !== 'MINOR')
  log(`${A.lane} finish review ${round}: ${fs.filter((f) => f.severity === 'BLOCKER').length} BLOCKER, ${fs.filter((f) => f.severity === 'MAJOR').length} MAJOR, ${fs.filter((f) => f.severity === 'MINOR').length} MINOR`)
  if (fs.length) {
    gate = await agent(
      `${COMMON}\n\n## Sửa theo review hoàn tất lượt ${round}\n\nBLOCKER và MAJOR bắt buộc sửa (test đỏ trước). MINOR sửa nếu nhỏ, không thì ghi openIssues kèm lý do. Phát hiện chứng minh được là sai thì không sửa, ghi lý do.\n\n${JSON.stringify(fs, null, 1)}\n\n${gateText()}`,
      { label: `${A.lane}:finish-fix${round}`, phase: 'Review', agentType: 'worker', effort: 'medium', schema: GATE_SCHEMA },
    )
  }
}
if (serious) log(`${A.lane}: hết ${A.maxRounds} lượt review hoàn tất mà vẫn còn BLOCKER/MAJOR`)

phase('Report')
const report = await agent(
  `${COMMON}\n\n## Cập nhật báo cáo lane\n\nThêm vào cuối \`${DOCS}/impl/${A.lane}.md\` mục "Hoàn tất sau gate/review" (tiếng Việt, ngắn): việc đã sửa → commit; summary.txt gate cuối; từng phát hiện review hoàn tất → sửa ở commit nào / vì sao không; câu hỏi mới cho chủ dự án kèm mặc định. Commit.\n\nDữ liệu:\nGate cuối: ${JSON.stringify(gate)}\nReview: ${JSON.stringify(reviews)}\n\nTrả về 5–8 dòng tóm tắt.`,
  { label: `${A.lane}:finish-report`, phase: 'Report', agentType: 'worker', effort: 'medium' },
)

return { lane: A.lane, gateGreen: gate && gate.green, gate, openSerious: serious, rounds: round, reviews, report }
