export const meta = {
  name: 'ops-1103-deep-review',
  description: 'Rà sâu 6 vùng Admin/CTV-Ví/Đổi rác/Vườn Xanh-Điểm/Ops bằng reviewer Opus, rồi verifier đối kháng từng vùng',
  phases: [
    { title: 'Find', detail: '6 reviewer Opus, mỗi vùng một agent, chỉ đọc' },
    { title: 'Verify', detail: 'verifier đối kháng: cố bác bỏ từng phát hiện' },
  ],
}

const WT = args.wt
const SCREENS = args.screens

const FINDINGS = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    coverage: { type: 'string', description: 'Đã rà những file/luồng nào, chưa rà được gì' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'mã ngắn theo vùng, vd QTUI-01' },
          severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          kind: { type: 'string', enum: ['bug', 'security', 'money-points', 'ux-ui', 'a11y', 'copy', 'perf', 'ops', 'test-gap'] },
          title: { type: 'string' },
          files: { type: 'array', items: { type: 'string' }, description: 'path:line' },
          evidence: { type: 'string', description: 'trích mã/lập luận truy vết cụ thể' },
          failure_scenario: { type: 'string', description: 'đầu vào/trạng thái cụ thể → kết quả sai' },
          fix: { type: 'string' },
          effort: { type: 'string', enum: ['S', 'M', 'L'] },
          owner_decision: { type: 'boolean', description: 'cần chủ quyết (đổi luật kinh doanh, chữ hiển thị cho khách)' },
          customer_ui: { type: 'boolean', description: 'sửa phải đụng màn khách apps/miniapp hoặc apps/web ngoài admin' },
        },
        required: ['id', 'severity', 'kind', 'title', 'files', 'evidence', 'failure_scenario', 'fix', 'effort', 'owner_decision', 'customer_ui'],
      },
    },
  },
  required: ['area', 'coverage', 'findings'],
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
          verdict: { type: 'string', enum: ['CONFIRMED', 'REFUTED', 'UNCERTAIN'] },
          severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          reason: { type: 'string' },
        },
        required: ['id', 'verdict', 'severity', 'reason'],
      },
    },
    missed: { type: 'string', description: 'Lỗi nghiêm trọng thấy thêm khi kiểm (nếu có), kèm path:line' },
  },
  required: ['verdicts', 'missed'],
}

const COMMON = `
Bạn là reviewer cấp cao (Tech Lead + Product Designer) rà sâu dự án Tubu Tree: monorepo pnpm, apps/api (NestJS + Prisma + Postgres + BullMQ), apps/web (Next.js; trang Quản trị ở /admin), apps/miniapp (Zalo Mini App), packages/app-core (logic client dùng chung).
PROD đang chạy (Vietnix) từ 25/10, ít khách thật. Đường tiền (Ví, hoa hồng, rút tiền) và Điểm Xanh là quan trọng nhất.

Mã cần rà: worktree ${WT} (= origin/main 52fd5cd65 + 1 commit sửa data-retention). CHỈ ĐỌC: không sửa file, không đổi trạng thái git, không bật server, không ghi DB nào.
Được chạy lệnh đọc (grep, sed, git log/blame). Nếu cần chứng minh một nghi vấn bằng test thì chạy tối đa 1–2 file test riêng lẻ:
  export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH; cd ${WT}/apps/api && npx jest <đường dẫn spec>   (hoặc cd apps/web && npx vitest run <file>)
Không chạy cả bộ test (máy dùng chung, nhiều phiên).

Không báo lại mục đã đóng hoặc chủ đã quyết: xem bảng trạng thái trong ${WT}/docs/2026-10-28-review/20-backlog.md (grep mã R-xxx/B-xxx) và ${WT}/docs/2026-10-28-e2e/21-quyet-dinh.md. Các mục R-109, R-23, R-140, R-132 do phiên khác làm: bỏ qua.
Một phiên khác (2a) giữ màn khách (apps/miniapp, apps/web ngoài admin, packages/app-core). Lỗi thuộc màn khách trong vùng của bạn vẫn báo, đặt customer_ui=true.

Mức độ: P0 = mất/sai tiền hoặc điểm, lộ dữ liệu, vượt quyền, job PROD hỏng; P1 = kết quả nghiệp vụ sai mà khách/admin thấy, hoặc vỡ luồng chính; P2 = lỗi ca biên, thiếu chốt chặn, UX gây nhầm ở việc admin làm hằng ngày; P3 = trau chuốt.
Mỗi phát hiện PHẢI có path:line và kịch bản hỏng cụ thể truy được từ mã (không "có thể" suông). Tối đa khoảng 15 phát hiện, ưu tiên P0–P2; chất lượng hơn số lượng. Kiểm xem đã có chốt chặn ở chỗ khác (guard, transaction, unique index, race spec ở apps/api/test/integration-race) trước khi báo.
Dùng skill phù hợp qua Skill tool nếu có: ecc:security-review (bảo mật), ecc:prisma-patterns / ecc:postgres-patterns (truy vấn, transaction), ui-ux-pro-max:ui-ux-pro-max và design:design-critique, design:accessibility-review (giao diện).
Viết title/evidence/failure_scenario/fix bằng tiếng Việt, ngắn gọn, giữ nguyên tên mã/đường dẫn.
`

const AREAS = [
  {
    key: 'admin-ui',
    title: 'Giao diện Quản trị /admin',
    prompt: `VÙNG: giao diện trang Quản trị (UX/UI + đúng đắn phía client).
File: ${WT}/apps/web/src/app/admin/**, ${WT}/apps/web/src/components/admin/** (danh sách tab ở admin-nav.tsx, page.tsx), query client ${WT}/apps/web/src/lib/query-client.ts.
Tập trung các tab: Tổng quan Hôm nay (dashboard), Đơn hàng (orders + order-detail-extras, order-status-actions, order-payment-summary), Sản phẩm & Combo (product-edit-drawer, bundles-tab, bundle-form), Chiến dịch & Giờ vàng (campaigns-tab, campaign-form, flash-slot-generator, flash-item-order), Mã giảm giá (coupon-list, coupon-listing), Đổi rác (waste-tab và waste-*), CTV & Duyệt rút tiền (payout-admin-tab, commission-rates-tab, storefronts-tab), Mẫu thông báo (notification-templates-tab), Sức khoẻ hệ thống (ops-health-tab, ops-inbox-tab, pancake-attention).
Ảnh chụp ngày 28/10 (có thể cũ tới 1 tuần, đối chiếu với mã): ${SCREENS}/admin1280/*.png và ${SCREENS}/admin375/*.png — xem bằng Read các tab trên ở cả hai khổ.
Tìm: thao tác phá huỷ/tiền không có hộp xác nhận hoặc bấm hai lần gửi hai lần; dữ liệu cũ sau mutation (invalidate sai khoá); thiếu trạng thái chờ/rỗng/lỗi; tràn ngang ở 375px; vùng bấm < 44px; ô nhập không nhãn; định dạng tiền/ngày giờ sai múi giờ VN; nhãn trạng thái gây hiểu nhầm; màn Sức khoẻ không làm nổi bật việc cần xử lý; chữ tiếng Việt không nhất quán; hiệu năng (bảng lớn không phân trang, lời gọi thừa).`,
  },
  {
    key: 'admin-api',
    title: 'API Quản trị',
    prompt: `VÙNG: API quản trị (đúng đắn + bảo mật).
File: ${WT}/apps/api/src/modules/admin/**, campaigns/**, coupons/** (phần admin), flash-sale/*admin*, bundles/*admin*, notifications/notification-templates-admin.*, users (admin), ops/ops.controller.ts, system-config/**, ${WT}/apps/api/src/common/guards/**, decorators/roles*.
Tìm: endpoint admin thiếu @Roles/guard hoặc vai trò quá rộng (nhân viên kho/CSKH/marketing đọc được dữ liệu tiền, SĐT); IDOR; DTO thiếu kiểm (số âm, quá lớn, chuỗi dài, enum); báo cáo doanh thu/hoàn tiền sai ranh giới ngày VN hoặc đếm trùng; xuất CSV bị chèn công thức (=,+,-,@); mẫu thông báo cho admin chèn biến/HTML gây lỗi gửi ZNS; cấu hình hệ thống lộ secret (config-redaction); giới hạn phân trang; thao tác đổi trạng thái đơn bỏ qua máy trạng thái; chỉnh coupon/flash sale đang chạy làm sai giá đơn đã đặt.`,
  },
  {
    key: 'ctv-wallet',
    title: 'Đại lý/CTV & Ví hoa hồng',
    prompt: `VÙNG: CTV (affiliate), gian hàng CTV /s/:slug, hoa hồng tự vào Ví, rút tiền, Ví Tubu; đại lý (dealer) phần tiền.
API: ${WT}/apps/api/src/modules/affiliate/**, wallet/**, storefront/**, dealer/** (tín dụng, thanh toán, giá đại lý), staff payout nếu liên quan. Race spec có sẵn: ${WT}/apps/api/test/integration-race/{affiliate*,wallet*,payout*,dealer*,commission*}.race-spec.ts.
Màn: admin payout-admin-tab.tsx, commission-rates-tab.tsx, storefronts-tab.tsx, dealer-*.tsx; khách ${WT}/apps/miniapp/src/pages/affiliate*.tsx, ${WT}/apps/web/src/app/ctv/**, ${WT}/apps/web/src/app/s/**, packages/app-core (dịch vụ affiliate/wallet).
Tìm: cộng hoa hồng hai lần (cron tự chuyển chạy chồng, nhiều instance), hoa hồng không bị thu hồi khi đơn huỷ/trả/hoàn một phần, rút tiền duyệt/từ chối không idempotent hoặc race với chuyển vào Ví, số dư âm, làm tròn, khấu trừ thuế TNCN (MST) sai, CTV tự mua để ăn hoa hồng, sửa link gán ghi nhận (attribution) sau khi đặt, /s/:slug lộ SĐT/địa chỉ, CTV bị khoá vẫn nhận hoa hồng, admin duyệt rút tiền thiếu thông tin ngân hàng/đối soát. UX: CTV hiểu được số "chờ duyệt/đã vào Ví/có thể rút".`,
  },
  {
    key: 'recycle',
    title: 'Đổi rác lấy quà',
    prompt: `VÙNG: Đổi rác lấy quà (điểm nhận, gửi bưu điện MAIL_IN, lấy tận nơi, quà đổi, học viện).
API: ${WT}/apps/api/src/modules/waste-exchange/** (catalog, core, customer, pickup, receiving), academy/**. Race spec: ${WT}/apps/api/test/integration-race/{waste*,recycle*,academy*}.race-spec.ts.
Màn: admin waste-tab.tsx và waste-*.tsx, recycling-panel.tsx; quầy nhận (desk/POS nếu có); khách ${WT}/apps/miniapp/src/pages (grep recycle|waste|doi-rac), ${WT}/apps/web/src/app (grep doi-rac|recycle).
Luật đã chốt: hộp sữa + vỏ chai Tubu chỉ kho HCMC nhận; đại lý chỉ nhận carton + nilon; hạn mức ngày/tháng; giữ chữ "khoảng ngày".
Tìm: cộng điểm khi xác nhận nhiều hơn một lần, xác nhận vượt hạn mức, đảo (reverse) không trừ đúng điểm, nhân viên điểm nhận A xác nhận yêu cầu của điểm B (vượt quyền), vật phẩm không thuộc điểm nhận vẫn được nhận, đổi quà race làm âm tồn kho quà, quiz học viện cày điểm, trạng thái MAIL_IN kẹt, ngày tính hạn mức theo UTC thay vì giờ VN, thông báo cho khách sai.`,
  },
  {
    key: 'garden-points',
    title: 'Vườn Xanh & Điểm danh & Giữ hạng',
    prompt: `VÙNG: Vườn Xanh (game: cây, tưới nước, thu hoạch, mùa, quiz, quà), Điểm danh hằng ngày, Điểm Xanh (sổ điểm, tỷ lệ tích, hết hạn, đối soát), hạng thành viên và Giữ hạng, tích điểm đơn sàn (external-points).
API: ${WT}/apps/api/src/modules/game/**, daily-check-in/**, loyalty/**, external-points/**. Race spec: ${WT}/apps/api/test/integration-race/{game*,garden*,loyalty*,points*,attendance*,checkin*,tier*,external*}.race-spec.ts.
Màn khách: ${WT}/apps/miniapp/src/pages (grep garden|game|loyalty|points|check-in|tier), ${WT}/apps/web/src/app (tương ứng); admin loyalty-config-card.tsx, season-admin.tsx, game-quiz-tab.tsx, engagement-tab.tsx, external-claims-tab.tsx.
Tìm: cộng điểm/nước hai lần khi bấm nhanh hoặc hai thiết bị, ranh giới ngày theo UTC thay vì Asia/Ho_Chi_Minh (điểm danh, chuỗi, hạn), hết hạn điểm không theo FIFO hoặc trừ hai lần, tính hạng sai cửa sổ thời gian, Giữ hạng cho sai người/sai số lần, đối soát sổ điểm lệch số dư, quà/coupon thu hoạch phát vượt số lượng, claim đơn sàn ghép nhầm SĐT người khác, chữ hiển thị điểm/hạng gây hiểu nhầm.`,
  },
  {
    key: 'ops',
    title: 'Vận hành: Cron/ZNS/Pancake/Sức khoẻ',
    prompt: `VÙNG: vận hành nền: mọi @Cron (grep -rn "@Cron(" ${WT}/apps/api/src), @TrackCron và khoá chạy (advisory lock, leader), hàng đợi BullMQ (attempts, backoff, removeOnComplete/Fail), ZNS (${WT}/apps/api/src/modules/integrations/zns/**, notifications/notifications.processor.ts, notifications.service.ts; giờ yên lặng; R-181 phần còn lại), Pancake (${WT}/apps/api/src/modules/integrations/pancake/**: đẩy đơn, webhook, đồng bộ tồn/giá, đơn kẹt, danh sách cần xử lý; PR #39 tags đang mở — không báo trùng), Zalo OA (integrations/zalo-oa: làm mới token), Gomdon, ops module (${WT}/apps/api/src/modules/ops/**: health, inbox, cảnh báo, email, ledger drift), data-retention (vừa sửa ở commit 133866c67 — rà lại bản sửa một cách đối kháng), lifecycle/remarketing.
Log PROD 72 giờ (03/11) chỉ có: lỗi data-retention (đã sửa); WARN Pancake biến thể retail_price 0; WARN ZaloOa refresh thiếu refresh_token; OpsHealth ALERT pancake.stuck/pancake.attention.
Tìm: cron chạy sai múi giờ, chạy chồng ở nhiều instance, nuốt lỗi không ghi lên Sức khoẻ (thiếu @TrackCron hoặc catch không log error), job lặp vô hạn/không giới hạn lô, retry gửi ZNS hai lần cho khách, thông báo gửi trong giờ yên lặng, cảnh báo ops báo động giả hoặc không bao giờ báo, Pancake webhook không xác thực/không idempotent, đồng bộ tồn đè tồn mới, retail_price 0 làm giá 0 hiển thị cho khách, token OA hết hạn không ai biết. Kiểm thêm R-180 (track-cron.spec.ts) đã hết phụ thuộc thời gian thật chưa.`,
  },
]

const results = await pipeline(
  AREAS,
  (a) => agent(`${COMMON}\n${a.prompt}`, { label: `find:${a.key}`, phase: 'Find', schema: FINDINGS, agentType: 'reviewer' }),
  (found, a) => {
    if (!found || !found.findings || found.findings.length === 0) return { area: a.key, found, verdicts: { verdicts: [], missed: '' } }
    const list = JSON.stringify(found.findings, null, 1)
    return agent(
      `${COMMON}\nVAI TRÒ: verifier ĐỐI KHÁNG cho vùng "${a.title}". Một reviewer khác đưa ra các phát hiện dưới đây. Với TỪNG phát hiện: tự đọc lại mã ở path:line, tìm chốt chặn ở chỗ khác (guard, transaction, unique index, kiểm ở tầng service/DB, race spec), xem có phải quyết định của chủ (21-quyet-dinh.md, 20-backlog.md) hay không, và kịch bản có xảy ra được trên PROD không. Cố BÁC BỎ. Không chứng minh lại được từ mã thì REFUTED. Chấm lại mức độ. Nếu trong lúc kiểm thấy lỗi nghiêm trọng khác (P0/P1) thì ghi vào "missed" kèm path:line.\n\nPHÁT HIỆN:\n${list}`,
      { label: `verify:${a.key}`, phase: 'Verify', schema: VERDICTS, agentType: 'reviewer' },
    ).then((v) => ({ area: a.key, found, verdicts: v }))
  },
)

const out = results.filter(Boolean).map((r) => {
  const vs = new Map(((r.verdicts && r.verdicts.verdicts) || []).map((v) => [v.id, v]))
  const findings = ((r.found && r.found.findings) || []).map((f) => ({ ...f, verify: vs.get(f.id) || null }))
  return { area: r.area, coverage: r.found ? r.found.coverage : 'agent lỗi', missed: r.verdicts ? r.verdicts.missed : '', findings }
})
const tally = out.map((o) => `${o.area}: ${o.findings.length} phát hiện, ${o.findings.filter((f) => f.verify && f.verify.verdict === 'CONFIRMED').length} CONFIRMED`)
log(tally.join(' | '))
return out
