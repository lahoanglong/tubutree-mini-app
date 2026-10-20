export const meta = {
  name: 'uat-w10-fix-wave5',
  description: 'Sửa đợt 5: lỗi mới từ UAT U1–U5 và P3 còn lại sau review đợt 4 (tiền chuyển khoản thiếu, giỏ Mini App, CTV/sự kiện/thẻ hộp, admin, đảo đơn/flash, tài liệu), TDD worker Sonnet, review Opus 2 lượt',
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
const BASE = 'uat/int'

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
    key: 'uat-tien-mua', race: 25551,
    spec: `Tiền, đọc ${DOCS}/uat/U1-mua-hang.md mục U1-B04 và U1-B01. (1) U1-B04 (P2): đơn chuyển khoản đã nhận một phần (orders.pancakePaidReported > 0, còn PENDING_PAYMENT) mà /payments/bank-qr vẫn trả amount = total, QR VietQR (trường 54) đòi đủ tổng đơn → khách quét lại chuyển đủ → chuyển thừa (OVERPAYMENT UNVERIFIED). Sửa apps/api/src/modules/integrations/payment/bank-transfer.service.ts:61-72: amount = total − pancakePaidReported (không âm), trả thêm paidSoFar để Mini App hiện "Đã nhận X, còn thiếu Y" ở apps/miniapp/src/pages/bank-payment.tsx (cạnh số tiền, chữ đặt cạnh mã như file đang làm); nội dung chuyển khoản giữ nguyên mã đơn. Kiểm luôn tin ORDER_UNDERPAID nói số còn thiếu khớp số trên QR. Test jest cho bank-transfer.service (đỏ trước) và vitest cho bank-payment (paidSoFar). (2) U1-B01 (P2): sắp "Giá tăng/Giá giảm" ở apps/api/src/modules/catalog/catalog.service.ts:474-480 dùng basePrice trong khi lọc giá và thẻ SP dùng giá đang bán (salePrice ?? basePrice, :207-209): sắp theo giá đang bán (orderBy COALESCE bằng raw hoặc cột tính sẵn; không thêm migration nếu không cần), test 'SP có sale rẻ hơn base của SP khác đứng trước'. Script tái hiện của lane: ${DOCS}/uat/scripts/U1-mua-hang/u1-d-bank.mjs U1-20, u1-b-browse-cart.mjs U1-07 (chỉ đọc để hiểu, không chạy được ngoài lane).`,
    files: 'apps/api/src/modules/integrations/payment/** , apps/api/src/modules/catalog/catalog.service*.ts, apps/miniapp/src/pages/bank-payment*.tsx, apps/miniapp/src/services/payment-api*.ts, apps/api/src/modules/notifications/** chỉ nếu tin ORDER_UNDERPAID lệch số (+ spec)',
  },
  {
    key: 'uat-gio-mini', race: 25552,
    spec: `Mini App giỏ/giá, đọc ${DOCS}/uat/U1-mua-hang.md mục U1-B02, U1-B03, U1-B05 và ${DOCS}/impl/dot4b.md (gói ui-miniapp-3, mục còn lại). (1) U1-B02: giỏ có dòng hết hàng (tồn 0) vẫn được cộng vào Tạm tính (cart.tsx:189 selectedSubtotal) và thanh tiến độ báo miễn phí giao: không cộng dòng không mua được, thanh tiến độ tính trên phần mua được; câu ở thanh dưới nói rõ dòng nào hết hàng. (2) U1-B03: đơn đầu đã được miễn phí giao (freeship đơn đầu) mà khách chọn mã FREESHIP: voucher-sheet hiện "Đã áp dụng mã FREESHIP" rồi checkout báo mã không áp → sửa để hai màn nói cùng một điều, kèm lý do "Đơn đầu đã được miễn phí giao, mã FREESHIP được giữ cho đơn sau" (voucher-sheet.tsx:85-89; nếu cần lý do riêng thì sửa apps/api/src/modules/coupons/coupon-notice.ts:8-9). (3) U1-B05: cùng SP giờ vàng, dải trang chủ (components/flash-sale.tsx:49-53, gạch salePrice ?? retailPrice) và PDP/thẻ SP (components/catalog/catalog-pricing.ts:16-23, % trên basePrice) gạch hai giá và hai % khác nhau: chọn một mốc so sánh cho mọi nơi (khuyên: giá đang bán trước giờ vàng = salePrice ?? basePrice), test cho tilePricing và flashDisplay cùng dữ liệu. (4) P3 dot4b: cart-rules.ts:8 recompute() đổi total của MỌI dòng khi optimistic → chỉ tính lại dòng đang sửa, dòng khác giữ line.total của server; kèm spec 2 dòng. (5) P3 dot4b: thẻ flash sale role='link' dùng rowKeyboardProps nên Space cũng điều hướng — link chỉ kích hoạt bằng Enter. ${SHOTS(3291, 'miniapp')}`,
    files: 'apps/miniapp/src/pages/cart*.tsx, apps/miniapp/src/utils/cart-rules*.ts, apps/miniapp/src/components/checkout/voucher-sheet*.tsx, apps/miniapp/src/components/flash-sale*.tsx, apps/miniapp/src/components/catalog/**, apps/miniapp/src/components/ui/row-keyboard*.ts, apps/miniapp/src/i18n/vi.ts, apps/api/src/modules/coupons/coupon-notice*.ts (+ spec)',
  },
  {
    key: 'uat-ctv-su-kien', race: 25553,
    spec: `Đọc ${DOCS}/uat/U3-ctv-dai-ly-nhan.md (U3-B01), ${DOCS}/uat/U4-doi-rac-cong-dong-game.md (ca U4-29), ${DOCS}/uat/U5-admin-noi-bo.md (U5-B05), ${DOCS}/98-cau-hoi.md (Q21) và 00-brief.md (luật đã chốt: thẻ hộp 30k/199k/60 ngày). (1) U3-B01 (P2): AffiliateLink.conversions không bao giờ tăng (apps/api/src/modules/affiliate/affiliate.service.ts:270-279 chỉ tăng clicks; dashboard :315, :334 cộng conversions = 0 dù CTV có đơn ghi công) → tăng conversions khi đơn được ghi công cho link (idempotent theo đơn, không đếm đôi khi webhook lặp), hoặc dashboard đếm từ bảng hoa hồng; chọn cách không cần migration; test. (2) U4-29: quà sự kiện cộng đồng nhận mọi mức (5.000, 1.000.000) và cho chọn người thắng không dự thi — đọc luật trong mã/cấu hình (tìm khoá community.event_* hoặc RANGES) và tài liệu; chặn ngoài khoảng cho phép bằng 4xx chữ tiếng Việt, chặn người thắng không có bài dự thi; nếu luật chưa có số thì đặt khoá cấu hình có RANGES (giá trị mặc định an toàn) và ghi decisions. (3) U5-B05 (P2): lô thẻ hộp hàng sàn để trống ngày hết hạn thì hạn 30 ngày, luật đã chốt 60 ngày → mặc định 60 ngày (đọc từ cấu hình nếu có), test. (4) Q21: mẫu tin GROUP_BUY_SUCCESS "Bạn nhận mã giảm {{discount}}đ" (apps/api/prisma/seed.ts:815; apps/api/src/modules/groupbuy/groupbuy.service.ts:209,230-231) hứa số tiền cố định trong khi mã nay là % có trần → đổi thành "mã giảm {{discount}}" với discount = "<pct>%"; sửa seed và thêm migration cập nhật đúng dòng notification_templates (chỉ khi nội dung còn là bản cũ, để không đè bản admin đã sửa); tin khách: giữ giọng văn các mẫu khác. Thêm khoá SystemConfig thì chạy npx jest prisma/reference-data src/modules/system-config.`,
    files: 'apps/api/src/modules/affiliate/**, apps/api/src/modules/feed/** hoặc module sự kiện cộng đồng (chỉ phần quà sự kiện), apps/api/src/modules/marketplace-box*/ hoặc module thẻ hộp (chỉ hạn lô), apps/api/src/modules/groupbuy/**, apps/api/prisma/seed.ts, apps/api/prisma/migrations (migration mới), apps/api/prisma/reference-data/**, apps/api/src/modules/system-config/** (chỉ RANGES), apps/web/src/components/admin/** chỉ nếu form quà sự kiện cần giới hạn (+ spec)',
  },
  {
    key: 'uat-admin-chu', race: 25554,
    spec: `Admin web. Đọc ${DOCS}/uat/U5-admin-noi-bo.md (U5-B04, ca U5-48), ${DOCS}/impl/dot4b.md (gói ui-admin-2 và ui-admin-3, mục còn lại), ${DOCS}/98-cau-hoi.md Q20. (1) U5-B04: tab Cấu hình (apps/web/src/app/admin/page.tsx) lưu thẳng khoá tiền/điểm (affiliate.*, coupon.*, loyalty.*, dealer.*, groupbuy.*, cashback.*, waste.* có điểm/tiền …) không có hộp "Xác nhận đổi cấu hình tiền/điểm" như các khoá tiền khác đã có — tìm cơ chế hỏi lại đã có cho một số khoá, mở rộng theo tiền tố/danh sách khoá ảnh hưởng tiền/điểm, hộp nêu giá trị cũ → mới; test vitest. (2) Q20: đổi tên tab "Rút tiền CTV" thành "Yêu cầu rút tiền" (hàng đợi gồm cả lệnh rút Ví Tubu), sửa nhãn liên quan trong components/admin và test. (3) P3 ui-admin-2: page.tsx:~1906 phoneKey chuẩn hoá SĐT khác server (server đổi 912345678 và 840912345678 thành 0912345678 — xem apps/api/src/modules/admin/admin-order-filter*.ts) → dùng cùng quy tắc; page.tsx:403-410 effect sửa URL tab cấm không chạy khi getOpsAccess lỗi → vẫn sửa URL về tab thật. (4) P3 ui-admin-3: customer-refunds-tab.tsx chữ COD chỉ đúng khi UNVERIFIED (:52, :462) → áp cho các trạng thái khác của khoản COD; câu "liên hệ khách chọn Ví/ngân hàng" khi r.userId === null (đơn khách vãng lai) → câu khác phù hợp; nhãn hiện và aria-label lệch (account-deletion-panel.tsx:186, pancake-attention.tsx:77, recycling-pa…) → bỏ aria-label thừa để tên truy cập = nhãn hiện; D7-19 còn sót ở panel con/ngăn kéo (waste-request-detail.tsx:79, :557; dealer-tiers-section.tsx:247; external-…) → thêm LoadError có Thử lại. KHÔNG sửa portal-header.tsx. ${SHOTS(3293, 'web')}`,
    files: 'apps/web/src/app/admin/** , apps/web/src/components/admin/** trừ portal-header.tsx (+ spec)',
  },
  {
    key: 'uat-p3-don', race: 25555,
    spec: `Tiền/điểm, P3 còn lại sau review đợt 4a (đọc ${DOCS}/impl/dot4a.md, mục còn lại của gói don-sau-huy, p3-nhan-vien, api-p3-hieu-nang ở ${DOCS}/impl/dot4b.md). (1) apps/api/src/modules/orders/orders.service.ts:415-416 (khách tự huỷ) và apps/api/src/modules/orders/order-returns.service.ts:455-456 (duyệt trả cả đơn): reverseOrderPoints/reverseCommissionsForOrder ném lỗi sau commit làm bỏ qua các bước sau (refundReportedUnderpayment, huỷ vận đơn Gomdon, tin khách, flagPancakeReturn, announceBankRefund, báo merchant) → làm như setStatus đã làm ở gói don-sau-huy: mỗi bước đảo try/catch riêng, ghi logger.error, chạy hết các bước sau rồi mới ném lỗi đầu tiên; test jest 'reverseOrderPoints reject thì refundReportedUnderpayment và notify vẫn được gọi đúng một lần'. (2) apps/api/src/modules/loyalty/loyalty.service.ts:203-214 và docblock :183: comment lệch sau gói don-sau-huy → chuyển/sửa comment cho đúng. (3) apps/api/src/modules/flash-sale/flash-sale.service.ts:357-366 updateSale kiểm trần 100.000đ mỗi đơn chỉ theo tổng sau PATCH — chỉ chặn khi PATCH làm tăng mức giảm (không chặn PATCH giảm giá trị/không đổi trên sale đã vượt từ trước), và :461-465/:388-395 addItem kiểm trùng biến thể dưới khoá như kiểm trần. (4) apps/api/src/modules/orders/orders.service.ts:530-538 mua lại (repurchase) gọi addItems lần hai cho topUps ngoài transaction đầu: lỗi hạ tầng ở lần hai để lại giỏ nửa vời và ghi add_to_cart hai lần — gộp vào một lần addItems hoặc cùng transaction, không ghi sự kiện đôi. Race spec trên cụm riêng nếu đụng transaction.`,
    files: 'apps/api/src/modules/orders/orders.service*.ts, apps/api/src/modules/orders/order-returns.service*.ts, apps/api/src/modules/loyalty/loyalty.service.ts (chỉ comment), apps/api/src/modules/flash-sale/** , apps/api/src/modules/cart/cart.service*.ts chỉ nếu cần cho (4), apps/api/test/integration-race/** (spec mới)',
  },
  {
    key: 'uat-p3-tai-lieu', race: 25556,
    spec: `Tài liệu và go-live, P3 còn lại sau review gói tai-lieu-deploy (đọc ${DOCS}/impl/dot4a.md, gói tai-lieu-deploy). (1) docs/launch/deploy-rollback-runbook.md:96-104, :434, :537: go-live nay coi r11, lr_reports_source_indexes, lr_orders_filter_indexes là migration nặng (db.pending_scope) nhưng bảng mục 1.0 và các chỗ đối chiếu chưa liệt kê → thêm. (2) apps/api/src/config/go-live/db-checks.ts:34-44: còn migration khác đụng bảng orders chưa có trong HEAVY_MIGRATIONS → rà toàn bộ migration có ALTER/UPDATE/CREATE INDEX (không CONCURRENTLY) trên orders, order_items, users, points_transactions và thêm, kèm test liệt kê. (3) .github/workflows/ops.yml:186 hành động gin truyền COMPOSE_FILE nhưng không POSTGRES_USER/POSTGRES_DB như backup (:179) và cron (:336) → truyền đủ. (4) docs/DEPLOY-GCP.md:54 câu 'khoảng 4 trên 10 chuỗi có / hoặc +' sai số và lẫn nguyên nhân → viết lại đúng (base64 24 byte gần như luôn có / hoặc +, ký tự đó làm hỏng URL), không nêu tỉ lệ nếu không đo. (5) docs/launch/pilot-order-playbook.md:216 dòng 'Bằng chứng' còn chờ ZNS trong 1-2 phút trong khi dòng 'Đúng là' đã nói giờ yên tĩnh 21:00-08:00 → sửa cho khớp. (6) docs/launch/deploy-rollback-runbook.md: rà lại mọi con số migration theo ls apps/api/prisma/migrations (hiện 211 thư mục, 25 ngoài sáu cái của đợt, bốn migration đêm UAT).`,
    files: 'docs/** (trừ docs/2026-10-19-web-parity/** và docs/2026-10-20-uat/**), apps/api/src/config/go-live/** (+ spec), .github/workflows/ops.yml',
  },
]

const WORKER = (p) => `Đọc ${BRIEF} trước (luật cứng, quyết định đã chốt). Bạn sửa MỘT gói: "${p.key}".

Chuẩn bị (đúng thứ tự):
  export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
  cd ${ROOT} && (test -d .claude/worktrees/uat-${p.key} || git worktree add -b uat/${p.key} .claude/worktrees/uat-${p.key} ${BASE})
  Worktree có thể đã có từ lượt trước bị ngắt giữa chừng (chưa commit). Chạy git status, git diff: giữ test đỏ đã viết nếu đúng việc của gói, làm tiếp từ đó; không commit thay đổi trong docs/2026-10-20-uat/tools/** (file sinh ra khi chụp ảnh).
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
