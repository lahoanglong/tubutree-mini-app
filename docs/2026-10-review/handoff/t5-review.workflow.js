export const meta = {
  name: 't5-final-review',
  description: 'T5: review độc lập toàn bộ diff cb92dc8..HEAD theo 4 góc (hợp đồng FE-BE, migration/deploy, tấn công tiền/auth trên API thật, copy/FE), mỗi finding có bằng chứng chạy thật',
  phases: [{ title: 'Review', detail: '4 reviewer opus độc lập, tối đa 3 chạy cùng lúc' }, { title: 'Verify', detail: 'phản biện từng finding major/blocker' }],
}

const REPO = args.repo
const HEAD = args.head
const BASE = args.base
const NODE = args.nodebin

const COMMON = `Bạn là reviewer độc lập, đối kháng, cho bản phát hành sắp deploy của Tubu Tree (monorepo pnpm: apps/api NestJS+Prisma+Postgres, apps/web Next.js, apps/miniapp Zalo Mini App, apps/e2e Playwright).
Repo: ${REPO}. Nhánh hardening/2026-10, HEAD ${HEAD}. PROD đang chạy ${BASE}. Diff cần review: git diff ${BASE}..${HEAD} (683 file, ~66k dòng; mỗi gói đã có báo cáo ở docs/2026-10-review/impl/*.md và quyết định chủ dự án Q-01..Q-31 ở docs/2026-10-review/00-ROADMAP.md mục 9).
Mọi lệnh shell phải có tiền tố: export PATH=${NODE}:$PATH
LUẬT CỨNG: KHÔNG git push/stash/reset/checkout/commit, KHÔNG sửa file trong repo, KHÔNG deploy, KHÔNG đụng PROD hay DB dùng chung. Chỉ đọc code và chạy lệnh trên DB/cổng RIÊNG của bạn (ghi rõ ở dưới). Cổng cấm: 3001, 3112, 3113 (dev), 3301 (đo tải đang chạy), DB tubutree_perf*, tubutree_it trên cổng 5550. Máy chỉ có một Docker VM dung lượng hạn chế: nếu cần container Postgres thì chạy \`docker run -d --rm --tmpfs /var/lib/postgresql/data ...\` (không để lại volume), xoá bằng \`docker rm -f -v\` khi xong. Không chạy full test suite (đang có job đo tải khác); chỉ chạy lệnh nhắm đích. Scratch file đặt ở /private/tmp/claude-501/-Users-longla-coding-tubutree-mini-app/44cf5d39-31b2-4fe1-82c3-64f87652528b/scratchpad/<tên-góc-của-bạn>/.
Chuẩn bằng chứng: chỉ báo finding bạn đã tái hiện bằng lệnh/đã chứng minh bằng đọc mã có trích path:line. Không bịa, không suy đoán; chưa chắc thì severity "minor" và nói rõ độ tin cậy. Đừng lặp lại các mục đã ghi MỞ trong báo cáo gói trừ khi bạn tìm được hậu quả nặng hơn họ ghi. Trả về đúng schema.`

const FINDING = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
    area: { type: 'string' },
    title: { type: 'string' },
    file: { type: 'string' },
    line: { type: 'integer' },
    evidence: { type: 'string', description: 'lệnh đã chạy + kết quả cốt lõi, hoặc trích mã path:line' },
    impact: { type: 'string' },
    suggested_fix: { type: 'string' },
    confidence: { type: 'string', enum: ['reproduced', 'proven-by-code', 'suspected'] },
  },
  required: ['severity', 'area', 'title', 'evidence', 'impact', 'confidence'],
}
const SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: FINDING },
    verified_ok: { type: 'array', items: { type: 'string' }, description: 'những thứ đã kiểm và đạt, kèm cách kiểm' },
    not_checked: { type: 'array', items: { type: 'string' }, description: 'những thứ KHÔNG kiểm được và lý do' },
  },
  required: ['findings', 'verified_ok', 'not_checked'],
}

const LENSES = [
  {
    key: 'contract',
    prompt: `${COMMON}

GÓC CỦA BẠN: HỢP ĐỒNG FE↔BE sau khi gộp toàn bộ gói (đặc biệt PD-2 gỡ endpoint/đổi helper, PD-3 đổi shared-types và ngữ nghĩa điểm, PD-1 ẩn tính năng).
Việc cần làm:
1. Liệt kê MỌI đường API mà apps/miniapp/src/services/**, apps/miniapp/src/** (gọi trực tiếp), apps/web/src/lib/** và apps/web/src/app/** (cả SSR/server component) gọi. Với từng đường: tồn tại controller tương ứng ở HEAD với đúng method + path + guard (không bị gỡ ở PD-2, không trả 410 ngoài ý muốn), body/response khớp DTO và kiểu trong packages/shared-types. Viết script (node/ts) quét tự động thay vì kiểm tay; đã có scripts/uiux/extract-endpoints.mjs và scripts/uiux/generated/*.json có thể tham khảo (có thể đã cũ: dữ liệu miniapp-endpoints.json còn /beta/*).
2. Endpoint đã gỡ/410 ở PD-2, PD-3: còn caller nào không (cả e2e mock, web admin, miniapp, tài liệu)? Client cũ trên PROD (web cb92dc8, miniapp bản test) gọi endpoint nào mà BE mới đổi/gỡ (tương thích ngược trong cửa sổ deploy BE→web→miniapp)? Liệt kê từng cặp (client cũ, endpoint, hậu quả với khách).
3. Trường dữ liệu bị bỏ/đổi tên (coinsBalance, xuConvertMultiplier, pointsConvertedBalance, redeemableConvertedPoints, rewardPoints, ...): còn nơi nào đọc trường cũ (miniapp, web, admin, e2e, seed, mẫu thông báo)?
4. Thứ tự deploy BE→web→miniapp: với từng hợp đồng thay đổi, mô tả điều khách thấy ở từng bước trung gian.`,
  },
  {
    key: 'deploy',
    prompt: `${COMMON}

GÓC CỦA BẠN: AN TOÀN MIGRATION + DEPLOY. Có 17 migration mới từ ${BASE} đến HEAD (liệt kê bằng git diff --name-only ${BASE}..${HEAD} -- apps/api/prisma/migrations). Dockerfile apps/api/Dockerfile chạy prisma migrate deploy lúc container khởi động. PROD có dữ liệu thật (ít người dùng, miniapp chưa lên Zalo), không chạy seed.
Việc cần làm:
1. Đọc từng migration SQL. Với mỗi cái: idempotent/chạy lại được không; khoá bảng nào bao lâu (đã đo: 29 migration trên DB 200k đơn tổng 3 giây); có thể FAIL trên dữ liệu PROD "bẩn" không (unique/partial unique index trên dữ liệu trùng, CHECK constraint với dòng sẵn có, NOT NULL, ép kiểu, RAISE chủ ý). Với mỗi unique index/CHECK mới: nêu truy vấn SQL chủ dự án chạy được trên bản sao PROD để biết trước nó có fail không.
2. Mọi khoá SystemConfig mà code ở HEAD ĐỌC (grep configService/systemConfig.get...) và mà PROD có thể chưa có (PROD không chạy seed): mã có giá trị mặc định an toàn khi thiếu không, hay ném lỗi/đổi hành vi (đặc biệt cấu hình PC-9 N=3/M=15, loyalty.vnd_per_point_redeem, các khoá *_points, retention.*, liên hệ hotline/email)? Lập bảng khoá → có migration chèn / có mặc định trong code / THIẾU.
3. Dựng DB Postgres tạm (container --rm + tmpfs, cổng 5601 trở đi riêng của bạn): áp migration của ${BASE} (git archive ${BASE} thư mục apps/api/prisma ra scratch), chèn dữ liệu mẫu "bẩn nhưng hợp lệ" nhắm vào các migration mới (duplicate gần-unique, user có xu 0/1/999/1000/1001/giá trị lớn, đơn XU PENDING_PAYMENT, config vnd_per_point_redeem khác 1000, user bị xoá mềm, v.v.), rồi áp migration HEAD bằng prisma migrate deploy và báo kết quả thật từng kịch bản (kể cả phục hồi sau khi migration dừng giữa chừng: migrate resolve có đủ không, container có crash-loop không).
4. Rollback: xác minh kịch bản rollback trong docs/2026-10-review/impl/PD-3.md và PD-3-SPEC.md mục 10 chạy được thật trên DB tạm (không chỉ đọc).`,
  },
  {
    key: 'adversarial',
    prompt: `${COMMON}

GÓC CỦA BẠN: TẤN CÔNG TIỀN/AUTH TRÊN API THẬT. Dựng API HEAD riêng: tạo DB "tubutree_adv" trong container tubu_pg (cổng 5434, user/pass tubu/tubu; chỉ DB này của bạn): docker exec tubu_pg createdb -U tubu tubutree_adv; áp migration bằng prisma migrate deploy (cd apps/api; DATABASE_URL=postgresql://tubu:tubu@localhost:5434/tubutree_adv?schema=public); seed bằng npx tsx prisma/seed.ts với DATABASE_URL đó (có thể cần 'set -a; . apps/api/.env; set +a' rồi ghi đè DATABASE_URL). Chạy API từ bản build sẵn: cd apps/api && PORT=3401 REDIS_URL=redis://localhost:6381/7 DATABASE_URL=... node dist/main.js (dist/ là CHỈ ĐỌC, đừng build lại, đang được tiến trình khác dùng). Token test: ký JWT bằng JWT_ACCESS_SECRET trong apps/api/.env (xem scripts/loadtest/lib.cjs hàm tokenFor làm mẫu). Biến THROTTLE_BYPASS_TOKEN để rỗng trừ khi bạn thử đúng cơ chế đó.
Việc cần làm — cố PHÁ bằng HTTP thật + đối chiếu DB sau mỗi thử, theo từng nhóm (mỗi nhóm nêu rõ bất biến tiền bị vi phạm hay giữ):
1. Điểm Xanh hai lô (PD-3): checkout song song cùng user với pointsToUse lớn hơn số dư/lớn hơn trần 20% của lô STANDARD; pointsToUse âm/số lẻ/chuỗi; dùng đồng thời điểm cho 2 đơn; hủy/trả đơn hai lần song song; đơn 0đ ép COD (có phí ship thì sao, có đường nào đặt đơn 0đ để lấy hàng không trả tiền ngoài ý muốn không); đổi voucher bằng điểm song song; góp quỹ cây (50 điểm) song song với checkout; gộp phiên khách vào tài khoản (cả hai chiều) có cộng đôi lô quy đổi không.
2. Hoàn tiền thủ công khách (/admin/customer-refunds, mark-paid): người không phải admin có gọi được không; mark-paid hai lần song song; IDOR giữa admin các vai trò.
3. Auth/throttle: refresh token tái sử dụng sau xoay vòng; THROTTLE_BYPASS_TOKEN rỗng thì header x-throttle-bypass bất kỳ có bypass được không (phải KHÔNG); đếm theo userId vs IP, kẻ tấn công có né được giới hạn đăng nhập bằng đổi X-Forwarded-For không.
4. Giới thiệu/thưởng (PA-7, PD-3 RewardPointsService): thưởng cùng người mời lặp lại, thu hồi khi trả hàng, vượt trần 2000 điểm/lần, idempotency đọc cả hai sổ.
5. Mass-assignment/IDOR trên các endpoint mới hoặc đổi trong diff (git diff ${BASE}..${HEAD} --stat -- apps/api/src '*.controller.ts' ), DTO thiếu whitelist.
Với mỗi tấn công: ghi lệnh/ script, kết quả HTTP, trạng thái DB trước/sau. Khi dựng xong dọn: dừng API của bạn (kill đúng PID bạn đã khởi chạy), docker exec tubu_pg dropdb -U tubu tubutree_adv.`,
  },
  {
    key: 'frontend',
    prompt: `${COMMON}

GÓC CỦA BẠN: FRONTEND + COPY + TRẢI NGHIỆM trên toàn bộ diff của apps/miniapp, apps/web, packages/shared-types.
Việc cần làm:
1. Quét nội dung khách thấy: còn chữ "xu"/"TubuXu"/"PanNature"/"cây thật"/emoji (Q-26 chốt dùng "giọt nước" cho điểm game và "Điểm Xanh"); sai chính tả/ngữ pháp tiếng Việt ở chuỗi mới (đọc kỹ các chuỗi trong i18n/vi.ts và component PD-1/PD-3/PC-12); số liệu/đơn vị sai (1 Điểm Xanh = 1.000đ; hiển thị lô quy đổi "không hết hạn"); hotline 0899 149 229 và email tubutree@gmail.com (Q-17) có ở đúng nơi (footer web, miniapp hỗ trợ) lấy từ cấu hình công khai chứ không hardcode lệch.
2. Nút gây tiền/điểm (thanh toán, đổi điểm, góp quỹ cây, quay thưởng, hoàn tiền admin): bấm đúp có gọi API hai lần không (busyRef/disabled/pending state), trạng thái lỗi 4xx/5xx/429/mạng hiển thị gì, có kẹt spinner không. Đọc mã + chạy vitest nhắm đích (npx vitest run <file>) để chứng minh.
3. Trạng thái rỗng/lỗi/tải của màn hình đụng PD-3 (hub Điểm Xanh 3 số dư, Ví, thanh toán 2 lô, trang Điểm Xanh, lời chào Trang chủ) và PC-12 (admin hoàn tiền): người dùng cũ có phiên cũ thiếu trường mới (pointsConvertedBalance undefined) có crash/NaN/"undefined đ" không. Viết test/ script jsdom nhắm đích nếu cần để chứng minh.
4. Khả năng tiếp cận + layout 390px ở các màn hình mới: h1, tên nút, tap target >=44px, tràn ngang (so với lỗi đã sửa: thanh tab admin tràn 267px do sr-only trong vùng cuộn không positioned — tìm cùng mẫu lỗi ở nơi khác: grep sr-only trong container overflow-x-auto không relative).
5. Dữ liệu tĩnh/tài liệu: README.md:54, DEMO_SCRIPT.md còn nói PanNature; bất kỳ tài liệu/mã nào còn mô tả tính năng đã gỡ.`,
  },
]

phase('Review')
const results = []
const sem = { n: 0 }
const MAX = args.maxAgents || 3
const queue = [...LENSES]
async function worker() {
  while (queue.length) {
    const lens = queue.shift()
    const r = await agent(lens.prompt, { label: `review:${lens.key}`, phase: 'Review', schema: SCHEMA, agentType: 'reviewer' })
    results.push({ key: lens.key, r })
  }
}
await parallel(Array.from({ length: MAX }, () => () => worker()))

const all = []
for (const { key, r } of results) {
  if (!r) { log(`[${key}] reviewer trả null (lỗi/giới hạn phiên)`); continue }
  for (const f of r.findings) all.push({ lens: key, ...f })
}
log(`Tổng finding: ${all.length} (blocker ${all.filter((f) => f.severity === 'blocker').length}, major ${all.filter((f) => f.severity === 'major').length})`)

phase('Verify')
const toVerify = all.filter((f) => f.severity === 'blocker' || f.severity === 'major')
const verdicts = await parallel(
  toVerify.map((f) => () =>
    agent(
      `${COMMON}

Một reviewer khác báo finding dưới đây. Việc của bạn: CỐ BÁC BỎ nó bằng cách tự chạy lại/đọc lại mã. Mặc định refuted=true nếu bạn không tái hiện/chứng minh được. Trả về verdict cuối.
FINDING (${f.lens}, ${f.severity}, ${f.confidence}): ${f.title}
file: ${f.file || '?'}:${f.line || '?'}
bằng chứng của họ: ${f.evidence}
tác động họ nêu: ${f.impact}`,
      {
        label: `verify:${f.lens}:${(f.title || '').slice(0, 28)}`,
        phase: 'Verify',
        agentType: 'reviewer',
        schema: {
          type: 'object',
          properties: {
            refuted: { type: 'boolean' },
            real_severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'not-an-issue'] },
            reasoning: { type: 'string' },
            evidence: { type: 'string' },
          },
          required: ['refuted', 'real_severity', 'reasoning', 'evidence'],
        },
      },
    ).then((v) => ({ f, v })),
  ),
)

return {
  coverage: results.map(({ key, r }) => ({ key, ok: !!r, verified_ok: r?.verified_ok, not_checked: r?.not_checked })),
  findings: all,
  verdicts: verdicts.filter(Boolean),
}
