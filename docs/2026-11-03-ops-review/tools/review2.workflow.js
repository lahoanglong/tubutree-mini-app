export const meta = {
  name: 'ops-1103-deep-review-2',
  description: 'Vòng rà 2: 6 vùng chưa rà sâu (đơn hàng, sản phẩm/chiến dịch, điểm nhận đổi rác, đại lý/gian hàng, Vườn Xanh khách, Pancake/mẫu tin)',
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

const SEEN = `Vòng 1 đã tìm và đang sửa các mục sau, KHÔNG báo lại: QTUI-01..07 (banner Sức khoẻ, mẫu ZNS thiếu mã, đổi hạn mã giảm giá, danh sách Giờ vàng, giờ VN Giờ vàng, bảng quà đổi rác 375, thẻ hoa hồng biến mất), QTAPI-01..04 (usedCount mã giảm giá, duyệt đại lý không thu RoleGrant, COD chưa thu, đã bán sàn ngoài theo SKU), CTV-01..03 (thu hồi mốc CTV, hero thuế MST, paidAt), DR-01..03 (tin thu hồi 0 điểm, chữ hộp thu hồi, hạn giữ chỗ), VX-01 (Season Pass Cao cấp), VX-02 (trần câu đố), OPS-01..04 (token Zalo OA, ZNS FAILED, ZNS thử lại giờ yên lặng, nhắc giỏ), data-retention support_recall_tombstones.`

const AREAS = [
  {
    key: 'admin-orders',
    title: 'Quản trị: Đơn hàng, hoàn tiền, trả hàng',
    prompt: `VÙNG: tab Đơn hàng của Quản trị và các thao tác tiền trên đơn.
Web: thân OrdersTab trong ${WT}/apps/web/src/app/admin/page.tsx (khoảng dòng 1236-2160), order-detail-extras.tsx, order-extra-filters.tsx, order-status-actions.tsx, order-payment-summary.tsx, customer-refunds-tab.tsx, customer-refund-paid-dialog.tsx, return-request-row.tsx, invoice-filter-chips.tsx.
API: các endpoint admin đơn trong ${WT}/apps/api/src/modules/admin/** (admin-order-filter.ts, order-actor-transitions.ts, admin-export.ts, admin-order-items-export.ts) và nơi chúng gọi trong orders/** (order-transition.ts, order-reversal.service.ts, customer-refunds-admin.*).
Tìm: chuyển trạng thái vượt máy trạng thái hoặc theo vai trò sai (kho/CSKH làm được việc của kế toán), xác nhận tiền/hoàn tiền bấm hai lần, hoàn tiền vượt số đã thu, trả hàng một phần tính sai hoa hồng/điểm/voucher, bộ lọc/tìm kiếm sai ranh giới ngày VN, xuất CSV thiếu cột/chèn công thức, đơn gian hàng tự giao (MERCHANT) bị xử lý như đơn Tubu, UX 375 (bảng, nút, ngăn kéo lọc), thiếu trạng thái rỗng/lỗi.`,
  },
  {
    key: 'admin-catalog',
    title: 'Quản trị: Sản phẩm & Combo, Chiến dịch',
    prompt: `VÙNG: Sản phẩm & Combo, Chiến dịch (không gồm danh sách Giờ vàng đã rà).
Web: ${WT}/apps/web/src/components/admin/product-edit-drawer.tsx, bundle-form.tsx, bundles-tab.tsx, bundle-addon-picker.tsx, campaign-form.tsx, campaigns-tab.tsx, flash-slot-generator.tsx, flash-item-order.tsx, product-categories-tab.tsx, category-tree-panel.tsx, image-url-field.tsx, ${WT}/apps/web/src/lib/admin-campaign-form.ts.
API: ${WT}/apps/api/src/modules/bundles/*admin*, campaigns/**, catalog/product-admin.service.ts, catalog/category-admin.service.ts, flash-sale/*admin* (chỉ phần admin), pricing/**.
Tìm: giá combo âm/nhỏ hơn giá vốn hoặc rẻ hơn tổng món khi không chủ ý, sửa combo/chiến dịch đang chạy làm giỏ khách đang có giá sai, chiến dịch chồng chéo cho giá thấp bất thường, sinh khung Giờ vàng trùng/chồng giờ, ảnh URL ngoài không được duyệt (SSRF/host lạ), xoá danh mục còn sản phẩm, form mất dữ liệu khi đóng ngăn kéo, kiểm nhập phía client khác phía server, giờ VN.`,
  },
  {
    key: 'recycle-points',
    title: 'Đổi rác: điểm nhận, quầy, cấu hình, màn khách',
    prompt: `VÙNG: Đổi rác phần chưa rà: điểm nhận và quầy, cấu hình, màn khách.
Web admin: ${WT}/apps/web/src/components/admin/waste-point-form.tsx, waste-point-detail.tsx, waste-points-section.tsx, waste-config-card.tsx, waste-requests-section.tsx, waste-items-section.tsx, recycling-panel.tsx, pos-screen.tsx (phần đổi rác), ${WT}/apps/web/src/app/admin/pos/**.
API: ${WT}/apps/api/src/modules/waste-exchange/catalog/waste-admin-points.*, core/waste-access.service.ts, core/waste-config.service.ts, receiving/waste-desk.service.ts, receiving/waste-receive.service.ts, receiving/waste-confirm.service.ts, pickup/**, customer/waste-requests.service.ts, customer/waste-preview.service.ts.
Màn khách: ${WT}/apps/miniapp/src/pages (grep -l "recycle\\|waste"), ${WT}/apps/web/src/app (grep -rl "recycle\\|doi-rac"), ${WT}/apps/web/src/components/recycle/**.
Tìm: nhân viên điểm nhận A thao tác được yêu cầu/quà của điểm B, đại lý nhận vật phẩm chỉ kho HCMC được nhận (hộp sữa, vỏ chai Tubu), hạn mức ngày/tháng tính sai hoặc vượt khi song song, đổi cấu hình (giá điểm vật phẩm) làm yêu cầu đang mở tính lại sai, MAIL_IN/PICKUP kẹt trạng thái, quét QR lộ thông tin khách cho người không có quyền, màn khách sai hạn/điểm dự kiến, UX quầy ở 375.`,
  },
  {
    key: 'dealer-storefront',
    title: 'Đại lý & gian hàng CTV',
    prompt: `VÙNG: Đại lý (dealer) phần tiền và gian hàng CTV phần chưa rà.
API: ${WT}/apps/api/src/modules/dealer/** (tín dụng, thanh toán, giá đại lý, backorder, cron), storefront/**, affiliate/storefront-sales.ts, affiliate/affiliate-access.ts, admin/dealer-price-import.ts. Race spec dealer*.
Web admin: dealer-accounts-tab.tsx, dealer-claims-tab.tsx, dealer-credit-panel.tsx, dealer-credit-reports.tsx, dealer-payment-panel.tsx, dealer-price-history-tab.tsx, dealer-tiers-section.tsx, storefronts-tab.tsx (phần chi tiết), payout-admin-tab.tsx.
Màn khách: ${WT}/apps/web/src/app/s/**, ${WT}/apps/miniapp/src/pages (grep -l "storefront\\|dealer"), ${WT}/apps/web/src/app/dai-ly/** nếu có.
Tìm: hạn mức tín dụng đại lý vượt khi đặt song song, ghi nhận thanh toán đại lý hai lần, giá đại lý áp sai bậc hoặc lọt sang khách lẻ, nhập giá CSV làm giá âm/0, gian hàng /s/:slug lộ dữ liệu (SĐT, doanh số), CTV bị khoá/gian hàng bị ẩn vẫn bán và nhận hoa hồng, slug trùng/đổi slug làm hỏng link đã chia sẻ, thống kê gian hàng đếm sai.`,
  },
  {
    key: 'garden-ui',
    title: 'Vườn Xanh & Điểm: phần game sâu và màn khách',
    prompt: `VÙNG: Vườn Xanh phần chưa rà sâu và màn khách của Vườn Xanh, Điểm danh, Điểm Xanh, hạng.
API: ${WT}/apps/api/src/modules/game/game-garden.service.ts, game-order-water.service.ts, game-gift.service.ts, game-economy.service.ts, game-collection.service.ts, game-community.service.ts, harvest-coupon-count.ts, checkin-streak.ts, game-reminder.service.ts, ${WT}/apps/api/src/modules/daily-check-in/**, loyalty/tier-policy.ts, loyalty/tier-drop-notice.service.ts, loyalty/loyalty-expiry.service.ts, loyalty/points-reconcile.ts, cashback/**.
Màn khách: ${WT}/apps/miniapp/src/pages (grep -l "garden\\|game\\|loyalty\\|points\\|check-in\\|tier"), ${WT}/apps/web/src/app (tương ứng), packages/app-core (game/loyalty).
Tìm: nước/thu hoạch/quà cộng hai lần khi song song, nước từ đơn hàng không bị thu khi đơn huỷ/trả, mã thu hoạch phát vượt trần tháng, chuỗi điểm danh đứt sai do múi giờ, nhắc tưới gửi sai giờ/quá nhiều, hạng tụt sai hoặc báo tụt hạng sai người, cashback tính sai khi đơn trả một phần, màn khách hiện số điểm/hạng/hạn lệch API, thiếu trạng thái chờ/lỗi, chữ gây hiểu nhầm về giá trị điểm.`,
  },
  {
    key: 'pancake-notify',
    title: 'Pancake, mẫu thông báo, cấu hình hệ thống',
    prompt: `VÙNG: Pancake sâu, mẫu thông báo và biến, cấu hình hệ thống.
API: ${WT}/apps/api/src/modules/integrations/pancake/** (đồng bộ sản phẩm/tồn/giá, đẩy đơn, webhook, trạng thái, attention/stuck), notifications/notification-variables.ts, notification-templates-admin.service.ts, notifications.service.ts (render mẫu), system-config/**, admin/admin-config-rules.ts, admin/config-redaction.ts, ops/ops-webhook-events.service.ts.
Web admin: pancake-sync.tsx, pancake-attention.tsx, notification-templates-tab.tsx (phần biến/xem trước), config-item.tsx, feature-flags-card.tsx, loyalty-config-card.tsx, partner-rules-card.tsx, shop-info-card.tsx, gomdon-config-card.tsx.
Log PROD: WARN Pancake biến thể retail_price 0; ALERT pancake.stuck/pancake.attention. PR #39 (thẻ đơn Pancake) đang mở: không báo trùng.
Tìm: biến thể retail_price 0 làm giá 0 hiện cho khách hoặc bán được 0đ, webhook xử lý lại làm tồn sai (stale stock), đơn kẹt không có đường gỡ cho admin, cấu hình nhận giá trị ngoài khoảng làm hỏng tính điểm/giá, cấu hình bí mật lộ qua API admin cho vai trò thấp, biến mẫu thông báo thiếu làm gửi câu "{{x}}" cho khách, xem trước mẫu khác bản gửi thật.`,
  },
]

const results = await pipeline(
  AREAS,
  (a) => agent(`${COMMON}\n${SEEN}\n${a.prompt}`, { label: `find:${a.key}`, phase: 'Find', schema: FINDINGS, agentType: 'reviewer' }),
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
