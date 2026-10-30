export const meta = {
  name: 'e2e-p3-1029',
  description:
    'Đợt P3 29/10, sửa theo gói: worker Sonnet làm → review Opus đối kháng → sửa lại (tối đa 3 lượt review, gói tiền ít nhất 2)',
  phases: [
    { title: 'Làm', detail: 'worker Sonnet, mỗi gói một worktree' },
    { title: 'Review', detail: 'Opus đối kháng, chạy lại test chính' },
    { title: 'Sửa lại', detail: 'worker sửa theo review' },
  ],
};

// args: { base: '<sha>', packages: [{ key, title, brief_file, money, migration, migration_ts, depends_on, slot }] }
// Lượt review dùng agent ECC (ecc:code-reviewer, lượt 2 ecc:security-reviewer cho gói tiền, ecc:react-reviewer cho gói khác).
// slot cố định khối cổng của gói: B = 3800 + 5*slot, cổng race = 45800 + 10*slot.
const ROOT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees';
const D = ROOT + '/e2e/docs/2026-10-29-p3';
const BASE = args.base;
const PKGS = args.packages;

const REPORT = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    head: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' } },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['done', 'partial', 'skipped'] },
          note: { type: 'string' },
        },
        required: ['id', 'status', 'note'],
      },
    },
    checks: { type: 'array', items: { type: 'string' } },
    gate_fail_count: { type: 'integer' },
    summary: { type: 'string' },
  },
  required: ['branch', 'head', 'items', 'checks', 'gate_fail_count', 'summary'],
};

const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['merge', 'fix'] },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sev: { type: 'string', enum: ['P1', 'P2', 'P3'] },
          file: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['sev', 'file', 'problem', 'fix'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['verdict', 'issues', 'summary'],
};

const env = (p) => {
  const B = 3800 + 5 * p.slot;
  return `Gói: ${p.key} (${p.title}). File gói: ${p.brief_file}.
Worktree: ${ROOT}/p3-${p.key}, nhánh review/p3-${p.key} (đã tạo, đã pnpm install + prisma generate). Gốc so sánh: ${BASE}.
Khối cổng B=${B} (chỉ dùng ${B + 1}..${B + 5}). Cổng Postgres race: ${45800 + 10 * p.slot}.
Gói đụng tiền/điểm: ${p.money ? 'CÓ' : 'không'}. Được thêm migration: ${p.migration ? 'CÓ, thư mục bắt đầu bằng ' + p.migration_ts + ' (tăng giây nếu cần nhiều)' : 'KHÔNG'}.`;
};

const depNote = (p) =>
  p.depends_on && p.depends_on.length
    ? `Trước khi làm: gói này phụ thuộc ${p.depends_on.join(', ')} (đã xong). Trong worktree chạy \`git merge --no-edit review/p3-<gói phụ thuộc>\` cho từng gói, rồi \`pnpm install --frozen-lockfile --offline\` và \`npx prisma generate\` trong apps/api nếu schema đổi.\n`
    : '';

const workerPrompt = (p) => `Đọc trước, bắt buộc: ${D}/tools/brief-worker.md (luật chung).
${env(p)}
${depNote(p)}Làm hết các mục trong file gói theo luật chung, kiểm, commit. Trả báo cáo theo schema (head = \`git rev-parse --short HEAD\`; gate_fail_count = dòng "FAIL count" của gate.sh, ghi đường dẫn file kết quả gate vào checks).${p.resume_note_lam ? '\n' + p.resume_note_lam : ''}`;

const reviewPrompt = (
  p,
  rep,
  round,
) => `Bạn là reviewer đối kháng (Tech Lead + PM + Product Designer). Lượt review ${round} của gói dưới đây. Mục tiêu: tìm lỗi thật trước khi merge vào main cho hàng chục nghìn khách.
Luật và bối cảnh: ${D}/tools/brief-worker.md. ${env(p)}
Đọc file gói, rồi \`git -C ${ROOT}/p3-${p.key} log --oneline ${BASE}..HEAD\` và \`git -C ${ROOT}/p3-${p.key} diff ${BASE}..HEAD\`.
Kiểm:
1. Từng mục của gói: đã làm đúng và đủ chưa; mục báo skipped (đã hết trên mã hiện tại, trùng, cần chủ quyết) có bằng chứng file:dòng đúng không. Sửa P3 không được làm hỏng thứ đang chạy.
2. Lỗi mới: logic, tiền/điểm/Ví (idempotent, transaction, khoá, hoàn tiền), quyền và IDOR, cache TanStack Query không invalidate, trạng thái tải/rỗng/lỗi/Thử lại, web 375 khác Mini, chữ khó hiểu, route-map, cờ tính năng, múi giờ, comment kể chuyện thay đổi.
3. Test có thật chứng minh mục không: tự chạy lại test chính của gói (vitest/jest file liên quan; race spec qua race-one.sh với cổng race của gói nếu gói đụng tiền/điểm). KHÔNG sửa file nào, KHÔNG commit.
4. Kết quả gate của worker (file trong checks) có đúng HEAD hiện tại không (so giờ file với \`git log -1 --format=%cd\`). Bundle có vượt luật không.
Báo cáo worker (không tin, tự kiểm): ${JSON.stringify(rep)}
verdict = merge chỉ khi không còn P1/P2. P1 = sai tiền/điểm/quyền, mất dữ liệu, ngõ cụt việc chính, gate đỏ. P2 = lỗi thật nhưng hẹp. P3 = đánh bóng. Mỗi issue có file:dòng và cách sửa cụ thể.`;

const fixPrompt = (p, rev, round) => `Đọc trước, bắt buộc: ${D}/tools/brief-worker.md (luật chung).
${env(p)}
Review lượt ${round} của gói đã trả về các vấn đề dưới đây. Sửa hết P1, P2; sửa P3 nếu rẻ và trong phạm vi gói. Vấn đề nào bạn chứng minh được là sai thì không sửa, ghi lý do có file:dòng. Viết test chứng minh khi sửa logic. Chạy lại gate.sh và Playwright/race liên quan, commit. Trả báo cáo theo schema (items = từng vấn đề review: id = "R${round}-<số thứ tự>").
Vấn đề: ${JSON.stringify(rev.issues)}${p.resume_note_sua ? '\n' + p.resume_note_sua : ''}`;

async function runPkg(p) {
  let rep = await agent(workerPrompt(p), {
    label: 'lam:' + p.key,
    phase: 'Làm',
    schema: REPORT,
    model: 'sonnet',
  });
  if (!rep) return { key: p.key, error: 'worker không trả kết quả' };
  const firstItems = rep.items;
  const minReviews = p.money ? 2 : 1;
  const reviews = [];
  for (let r = 1; r <= 3; r++) {
    const agentType =
      r === 2 ? (p.money ? 'ecc:security-reviewer' : 'ecc:react-reviewer') : 'ecc:code-reviewer';
    const rev = await agent(reviewPrompt(p, rep, r), {
      label: 'review' + r + ':' + p.key,
      phase: 'Review',
      schema: REVIEW,
      model: 'opus',
      agentType,
    });
    if (!rev) {
      reviews.push({ round: r, error: 'review không trả kết quả' });
      break;
    }
    reviews.push({ round: r, verdict: rev.verdict, issues: rev.issues, summary: rev.summary });
    const blocking = rev.issues.filter((x) => x.sev !== 'P3');
    if (rev.verdict === 'merge' && !blocking.length && r >= minReviews) break;
    if (r === 3) break;
    if (!rev.issues.length) continue;
    const fixed = await agent(fixPrompt(p, rev, r), {
      label: 'sua' + r + ':' + p.key,
      phase: 'Sửa lại',
      schema: REPORT,
      model: 'sonnet',
    });
    if (fixed) rep = fixed;
  }
  const last = reviews[reviews.length - 1] || {};
  log(p.key + ': ' + (last.verdict || 'lỗi') + ' sau ' + reviews.length + ' lượt review');
  return {
    key: p.key,
    report: Object.assign({}, rep, { items: firstItems }),
    reviews,
    mergeable: last.verdict === 'merge' && !(last.issues || []).some((x) => x.sev !== 'P3'),
  };
}

const started = {};
const visiting = {};
function run(p) {
  if (started[p.key]) return started[p.key];
  visiting[p.key] = true;
  const deps = (p.depends_on || [])
    .map((k) => PKGS.find((q) => q.key === k))
    .filter((q) => q && !visiting[q.key])
    .map((q) => run(q));
  started[p.key] = Promise.all(deps).then(() => runPkg(p));
  return started[p.key];
}

const out = await parallel(PKGS.map((p) => () => run(p)));
return out.filter(Boolean).map((x) => ({
  key: x.key,
  mergeable: x.mergeable,
  head: x.report && x.report.head,
  gate_fail_count: x.report && x.report.gate_fail_count,
  items: x.report && x.report.items,
  reviews: x.reviews,
  error: x.error,
}));
