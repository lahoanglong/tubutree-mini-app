export const meta = {
  name: 'uat-w1-review',
  description: 'Review mã sâu 5 góc (tiền/điểm, auth/PII, migration/deploy, race, tin nhắn khách) + soát chéo + viết báo cáo Dx',
  phases: [
    { title: 'Review', detail: 'reviewer Opus mỗi góc' },
    { title: 'Verify', detail: 'reviewer khác góc cố bác bỏ P0/P1' },
    { title: 'Report', detail: 'ghi docs/2026-10-20-uat/Dx-*.md' },
  ],
}

const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat'
const BRIEF = `${WT}/docs/2026-10-20-uat/00-brief.md`

const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    coverage: { type: 'string', description: 'file/module đã đọc, phần chưa đọc kịp' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          group: { type: 'string', enum: ['agent sửa ngay', 'cần chủ quyết', 'chủ tự làm'] },
          title: { type: 'string' },
          location: { type: 'string', description: 'path:line, nhiều chỗ cách nhau bằng ;' },
          scenario: { type: 'string', description: 'đầu vào/trạng thái → kết quả sai' },
          evidence: { type: 'string', description: 'đoạn mã, output lệnh, truy vấn' },
          fix: { type: 'string', description: 'đề xuất sửa + test đỏ nên viết' },
          prior: { type: 'string', description: 'ID cũ trong findings-catalog/launch-review nếu có, hoặc "mới"' },
          zone: { type: 'string', enum: ['uat', 'web', 'chung'] },
        },
        required: ['id', 'severity', 'group', 'title', 'location', 'scenario', 'evidence', 'fix', 'prior', 'zone'],
      },
    },
  },
  required: ['summary', 'coverage', 'findings'],
}

const VERDICTS = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'] },
          severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'], description: 'mức sau khi soát' },
          reason: { type: 'string' },
        },
        required: ['id', 'verdict', 'severity', 'reason'],
      },
    },
    missed: { type: 'array', items: { type: 'string' }, description: 'lỗi thật reviewer gốc bỏ sót (path:line + kịch bản)' },
  },
  required: ['verdicts', 'missed'],
}

const COMMON = `Đọc ${BRIEF} trước (luật cứng, quyết định đã chốt, định dạng). Code ở ${WT} (nhánh uat/2026-10-20). Bạn là reviewer: KHÔNG sửa file. Được chạy test lẻ theo file (npx jest <file>) và đọc DB UAT (postgresql://tubu@127.0.0.1:25432/tubutree_uat, chỉ SELECT). Không chạy jest/race/build toàn bộ. Tra findings-catalog.md và docs/2026-10-18-launch-review/ để không báo lại mục đã sửa. Chỉ báo phát hiện có path:line và kịch bản cụ thể. Mỗi P0/P1 phải có kịch bản tái hiện được. Ưu tiên lỗi thật hơn số lượng; nếu không thấy gì nghiêm trọng thì nói thẳng.`

const ANGLES = [
  {
    key: 'D1-tien-diem',
    title: 'Tiền, điểm, ví, hoa hồng',
    lens: 'đúng tiền và đúng sổ',
    prompt: `Góc TIỀN/ĐIỂM/VÍ/HOA HỒNG. Đọc sâu apps/api/src/modules/{checkout,orders,cart,pricing,coupons,vouchers,loyalty,wallet,affiliate,dealer,cashback,external-points,flash-sale,groupbuy,subscriptions,game,waste-exchange,integrations,merchant}. Kiểm: công thức điểm theo luật đã chốt (2% × hệ số hạng, sau giảm, không ship; đơn sàn 1% không hệ số không tính hạng; B9 đơn CSKH Pancake theo SĐT giữ 30 ngày; ×1.000 các số điểm khác; trần 20% đơn trừ điểm; hết hạn 12 tháng; trần điểm), làm tròn, cộng/trừ hai lần, hoàn/huỷ/trả một phần trả lại điểm/voucher/tồn kho/hoa hồng đúng, hoa hồng 8% chỉ CTV+đại lý, không trả hàng đối tác, giữ 10 ngày, TNCN 10%, rút tiền (số dư âm, rút trùng), voucher chồng (WELCOME30 + chào mừng là chấp nhận), thẻ hộp hàng sàn 30k/199k/60 ngày/chỉ khách mới, freeship đơn đầu 199k, flash sale tồn kho/giá, webhook ngân hàng (khớp số tiền, nội dung, trùng lặp, thiếu tiền/thừa tiền), Pancake webhook, sổ điểm/ví khớp số dư (reconcile scripts). So migration số tiền với quyết định A6/A7/A12.`,
  },
  {
    key: 'D2-auth-pii',
    title: 'Auth, quyền, PII',
    lens: 'bảo mật và phân quyền',
    prompt: `Góc AUTH/QUYỀN/PII. Đọc apps/api/src/modules/{auth,users,admin,staff,cskh,analytics,data-retention,storefront,ops,content-kit,academy,feed,brand,merchant} + guards/decorators chung (grep Roles, UseGuards, Public), apps/web/src/app/admin/**, phân quyền màn nội bộ Mini App. Kiểm: endpoint thiếu guard hoặc @Public sai; IDOR (đọc/sửa đơn, địa chỉ, ví, hoàn tiền của người khác qua id/code); vai trò MARKETING/ACCOUNTANT/CSKH/BRAND_OWNER/DEALER/CTV đúng ma trận đã chốt (kế toán: Đã chi, công nợ, Đã nhận tiền, VAT, chi thưởng đại lý, duyệt hoàn sàn, tab Đơn hàng; duyệt rút chỉ ADMIN; CSKH duyệt bài, chỉ ADMIN ghim/chọn thắng; marketing trần mã); JWT/refresh/cookie (SameSite, domain), đăng nhập Zalo web vs Mini App, gộp tài khoản theo SĐT, ensure-phone; PII trong log, trong response công khai (gian hàng /s/, /brand/, bảng xếp hạng, cộng đồng), CSV che SĐT; rate limit/OTP/brute force; SSRF ảnh xem trước; CORS; webhook ký HMAC (Pancake, ngân hàng, Zalo OA, AccessTrade) so sánh hằng thời gian; secret mặc định yếu khi NODE_ENV=production.`,
  },
  {
    key: 'D3-migration-deploy',
    title: 'Migration và deploy',
    lens: 'triển khai và dữ liệu thật',
    prompt: `Góc MIGRATION/DEPLOY (đọc mã + diễn tập nhẹ). Đọc apps/api/prisma/schema.prisma, các migration mới từ 2026-10-01 (ls apps/api/prisma/migrations | tail -60), seed-reference.ts, cleanup-demo-data.ts, scripts/go-live-check.ts, reconcile-*.ts, Dockerfile của api/web, docker-compose.prod.yml, docker-compose.vietnix.yml, deploy.sh nếu có, docs/launch/deploy-rollback-runbook.md (mục 0.1, 1.0, 1.3, 1.6, 3.4), docs/GO-LIVE-KEYS.md, apps/api/.env.example, .env.production.example. Diễn tập trên DB tạm: dựng cụm Postgres chạy thẳng cổng 25433 bằng ${WT}/docs/2026-10-20-uat/tools/pg-native.sh start 25433 rồi createdb 25433 tubutree_rehearsal; chạy migrate deploy, migrate status, prisma migrate diff --from-url ... --to-schema-datamodel prisma/schema.prisma --exit-code, npx tsx prisma/check-partial-indexes.ts, seed-reference.ts (có và không --with-business-defaults, chạy 2 lần để thử idempotent), cleanup-demo-data.ts theo runbook, go-live-check.ts; ghi output. Kiểm: migration không đảo ngược được hoặc khoá bảng lâu, migration dữ liệu sai đơn vị (points_1d ×1000), thứ tự seed/migrate, khoá SystemConfig thiếu ở seed-reference so với code đọc (grep getConfig/get<...>('key')), biến môi trường code đọc mà .env.production.example/GO-LIVE-KEYS/runbook 1.3 thiếu hoặc ngược lại, healthcheck, backup/rollback trong runbook khớp script thật (tools/backup), cron chạy trùng khi API_CPUS=2 (nhiều tiến trình). Cuối việc: pg-native.sh stop 25433. KHÔNG docker build (agent khác làm).`,
  },
  {
    key: 'D4-race',
    title: 'Đồng thời (race)',
    lens: 'đồng thời và idempotency',
    prompt: `Góc ĐỒNG THỜI. Tìm chỗ hai yêu cầu/hai tiến trình chạy cùng lúc làm sai tiền, điểm, tồn kho, lượt mã, trạng thái: đọc-rồi-ghi không khoá ($transaction thiếu FOR UPDATE / điều kiện trong WHERE / unique), idempotency key (checkout, webhook ngân hàng, Pancake, đổi điểm, rút tiền, quay thưởng, điểm danh, nhận thưởng mốc, claim thẻ hộp hàng, quét mã vận đơn, đổi rác), cron chạy trùng khi API chạy 2 tiến trình (API_CPUS=2, kiểm có khoá Redis/advisory lock không), BullMQ job retry gây gửi lặp/cộng lặp, cache Redis lệch DB. Đối chiếu bộ race spec có sẵn apps/api/test/integration-race/*.race-spec.ts để biết chỗ nào đã có test; báo chỗ CHƯA có test và có lỗi thật. Có thể chạy lẻ race spec trên cụm tạm: ${WT}/docs/2026-10-20-uat/tools/pg-native.sh start 25545 && createdb 25545 tubutree_it, migrate deploy với DATABASE_URL=postgresql://tubu@127.0.0.1:25545/tubutree_it, rồi npx jest -c test/integration-race/jest.config.js --runInBand <file>; cuối việc pg-native.sh stop 25545.`,
  },
  {
    key: 'D5-tin-nhan-khach',
    title: 'Tin nhắn gửi khách (ZNS, Zalo OA, thư)',
    lens: 'nội dung và đối tượng nhận tin',
    prompt: `Góc TIN NHẮN GỬI KHÁCH. Đọc apps/api/src/modules/notifications/**, integrations (Zalo OA, ZNS, mail), lifecycle, mọi nơi gọi gửi tin (grep notify/sendZns/sendOa/enqueue). Đọc NOTIFICATION_TEMPLATES ở prisma/seed.ts và bảng notification_templates trong DB UAT. Kiểm: gửi nhầm người (tin đơn của A tới B, tin admin tới khách), gửi lặp (retry, cron trùng, webhook trùng), gửi giờ khuya/vượt trần 2 tin hậu mãi/khách/tháng, tin khi khách đã tắt nhận, biến mẫu thiếu/sai ({{points}} còn đơn vị cũ, số điểm chưa ×1.000, tiền định dạng sai, "xu" thay "Điểm Xanh"), link trong tin sai miền/thiếu, PII trong tin, mẫu ZNS khớp 3 mẫu chủ sẽ nộp, lỗi nhà cung cấp làm hỏng giao dịch chính (gửi tin trong transaction), không có khoá thì im lặng hay ném lỗi, tin chữ tiếng Việt sai chính tả/thuật ngữ. Đọc thêm chữ thư/tin trong docs/launch/*.md và bản nháp thể lệ đổi rác.`,
  },
]

phase('Review')
const results = await pipeline(
  ANGLES,
  (a) => agent(`${COMMON}\n\n${a.prompt}\n\nID phát hiện dạng ${a.key.split('-')[0]}-01, -02...`, {
    label: `review:${a.key}`, phase: 'Review', agentType: 'reviewer', schema: FINDINGS,
  }),
  (rev, a) => {
    if (!rev) return null
    const hi = rev.findings.filter((f) => f.severity === 'P0' || f.severity === 'P1')
    if (!hi.length) return { rev, ver: { verdicts: [], missed: [] } }
    return agent(`${COMMON}\n\nBạn soát chéo góc "${a.title}" bằng con mắt "${a.lens}" của một người KHÁC. Với từng phát hiện dưới đây, mở đúng path:line, dựng lại kịch bản, cố BÁC BỎ (đã có chặn ở tầng khác? đã sửa ở commit sau? luật đã chốt cho phép?). Không chắc thì PLAUSIBLE. Hạ hoặc nâng mức nếu cần. Ghi thêm lỗi thật mà reviewer gốc bỏ sót (nếu gặp khi đọc).\n\nPhát hiện:\n${JSON.stringify(hi, null, 1)}`, {
      label: `verify:${a.key}`, phase: 'Verify', agentType: 'reviewer', schema: VERDICTS,
    }).then((ver) => ({ rev, ver }))
  },
  (pair, a) => {
    if (!pair) return null
    return agent(`Ghi báo cáo Markdown tiếng Việt vào ${WT}/docs/2026-10-20-uat/${a.key}.md (tạo mới, chỉ file này). Đọc ${BRIEF} mục "Định dạng phát hiện". Nội dung: tiêu đề "# ${a.key} — ${a.title}", mục Tóm tắt (summary), Phạm vi đã đọc (coverage), bảng phát hiện xếp P0→P3 với cột ID | Mức (sau soát) | Soát chéo (CONFIRMED/PLAUSIBLE/REFUTED/chưa soát) | Nhóm | Vùng | Vị trí | Mô tả + kịch bản | Đề xuất sửa + test. Sau bảng: mục chi tiết từng P0/P1 (bằng chứng đầy đủ, lý do soát chéo). Phát hiện REFUTED để ở mục cuối "Đã bác bỏ" kèm lý do. Mục "Bỏ sót do soát chéo phát hiện" (missed). Không thêm nhận định của bạn. Chữ rõ, câu ngắn. Trả về đúng một dòng: số phát hiện theo mức sau soát, ví dụ "P0=1 P1=3 P2=5 P3=2 REFUTED=1".\n\nDữ liệu review:\n${JSON.stringify(pair.rev)}\n\nDữ liệu soát chéo:\n${JSON.stringify(pair.ver)}`, {
      label: `report:${a.key}`, phase: 'Report', model: 'sonnet', effort: 'low',
    }).then((line) => ({ key: a.key, line, rev: pair.rev, ver: pair.ver }))
  },
)

return results.filter(Boolean).map((r) => ({ key: r.key, line: r.line, n: r.rev.findings.length, missed: r.ver.missed.length }))
