export const meta = {
  name: 'uat-w9-fix-wave4b',
  description: 'Sửa đợt 4b: 5 gói UI Mini App/admin + hiệu năng API còn lại (chuyển khoản/ví, chữ + a11y Mini App, admin page.tsx, admin components, API P3), TDD worker Sonnet, review Opus 2 lượt',
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
    key: 'ui-miniapp-2', race: 25591,
    spec: `Mini App, màn chuyển khoản, ví, tích điểm sàn. Đọc ${DOCS}/D6-uiux-miniapp.md và ${DOCS}/impl/dot2.md (gói miniapp-logic, mục còn lại). Làm: D6-01 (pages/bank-payment.tsx: hàng tiêu đề bị tách đôi, đệm trên chồng nhau), D6-02 (bank-payment: lỗi/offline có hướng dẫn và hotline như các màn lỗi khác, không chỉ chữ trơn), D6-12 (bank-payment: hướng dẫn "Giữ nguyên nội dung" không dùng chữ đỏ nhỏ như báo lỗi, dùng khối lưu ý), D6-11 (pages/wallet.tsx: số Điểm Xanh price-xl không gãy dòng ở 390px). P3 từ dot2.md: wallet.tsx:91-98,181 cờ withdrawUnresolved không tự xoá — xoá khi tải lại lịch sử thấy lệnh đã ghi nhận hoặc khi khách rời màn; external-points.tsx:261 khách bị khoá nhận NOT_ELIGIBLE_USER nhưng nút chia sẻ SĐT không hợp — hiện câu rõ "tài khoản chưa đủ điều kiện, liên hệ CSKH"; bank-payment.tsx:102-105 nút Kiểm tra gặp 401/403 không được báo "mất mạng" — báo phiên hết hạn, mời đăng nhập lại. KHÔNG sửa i18n/vi.ts (gói ui-miniapp-3 giữ): chuỗi mới đặt cạnh mã như cách file đó đang làm, hoặc ghi vào skipped. Test vitest cho từng hành vi. ${SHOTS(3291, 'miniapp')}`,
    files: 'apps/miniapp/src/pages/bank-payment*.tsx, apps/miniapp/src/pages/wallet*.tsx, apps/miniapp/src/pages/external-points*.tsx, apps/miniapp/src/components/** chỉ component riêng của ba màn này (+ spec)',
  },
  {
    key: 'ui-miniapp-3', race: 25592,
    spec: `Mini App, chữ và a11y. Đọc ${DOCS}/D6-uiux-miniapp.md, ${DOCS}/D8-a11y-chu.md, ${DOCS}/D9-hieu-nang.md, ${DOCS}/impl/dot3.md (gói ui-miniapp-1, mục còn lại). Làm: D6-17 (thống nhất một cách ghi "Miễn phí giao hàng" ở ba màn, sửa trong i18n/vi.ts), D8-11 (màn chủ "Voucher chào mừng" và thanh toán "mã giảm giá": thống nhất "mã giảm giá"/"Quà chào mừng" theo cách màn thanh toán đang gọi, ghi decisions), D8-18 (xoá hai chuỗi pointsUse, pointsAvailable không ai dùng, grep chắc chắn), D6-04 phần pages/recycle-new.tsx (món "Sắp có" mờ 0,55 làm chữ dưới 4,5:1, làm như recycle.tsx:304 đã sửa), D8-8 (vùng bấm div/Box/Text có onClick: đổi sang button hoặc thêm role=button + tabIndex + Enter/Space, ở pages/product-detail.tsx, components/flash-sale.tsx và các chỗ D8-8 liệt kê, trừ group-buy*.tsx), D9-08 (logo Trang chủ PNG 1059×384 hiển thị 83×30: thay bằng bản nhỏ 2x (vd 166×60 WebP/PNG) trong assets, giữ bản cũ nếu nơi khác dùng). P3 từ dot3.md: cart.tsx:477-478 dòng Thành tiền ẩn cả lúc PATCH đang chạy (update.isPending cho dòng đó) kèm spec qua 380ms; components/checkout/address-section.tsx:43 dùng editing === null thay editingId === null; loyalty.tsx:443 câu lặp "Vườn Xanh"; recycle-desk.tsx:101 "Không giới hạn mức tháng" → "Không giới hạn theo tháng". KHÔNG đổi Hủy/Huỷ, "6 vùng đất", biệt ngữ tiếng Anh, ngưỡng freeship (chờ chủ: Q12–Q14, Q16). KHÔNG sửa bank-payment, wallet, external-points (gói ui-miniapp-2), group-buy*.tsx (gói khác). ${SHOTS(3292, 'miniapp')}`,
    files: 'apps/miniapp/src/i18n/vi.ts, apps/miniapp/src/pages/recycle-new*.tsx, product-detail*.tsx, cart*.tsx, loyalty*.tsx, recycle-desk*.tsx, home*.tsx (logo), apps/miniapp/src/components/** (trừ component riêng của bank-payment/wallet/external-points), apps/miniapp/src/assets/** (+ spec)',
  },
  {
    key: 'ui-admin-2', race: 25593,
    spec: `Admin web, file apps/web/src/app/admin/page.tsx. Đọc ${DOCS}/D7-uiux-admin-web.md, ${DOCS}/D8-a11y-chu.md, ${DOCS}/impl/dot2.md (gói admin-web, mục còn lại). Làm phần nằm trong app/admin/**: D7-08 (tab Cấu hình 209 khoá: ô tìm theo khoá/mô tả và chia nhóm theo tiền tố khoá, giữ ô sửa JSON hiện có), D7-12 (thông báo đổi vai trò và danh sách thưởng đại lý dùng mã thô → nhãn tiếng Việt), D7-13 phần còn lại (nút "Tắt flash sale đang chạy" page.tsx:~2446 hỏi lại bằng hộp xác nhận chung), D7-22 (tab không có quyền rơi về tab đầu nhưng URL vẫn ?tab=users: sửa URL theo tab thật), D7-23 (kế toán không duyệt nhưng tab tên "Duyệt…"; nhãn nhắc quà đổi điểm cũ: đổi tên theo vai trò/đúng chức năng), D8-10 phần page.tsx (ô nhập có label), D7-19/D7-25/D7-26 chỉ cho các tab định nghĩa trong page.tsx. P3 từ dot2.md: GrantRoleForm (page.tsx:~1890) tra vai trò hiện tại của SĐT trước khi hiện hậu quả nếu API sẵn có (listUsers theo SĐT), không có thì giữ câu điều kiện; DealerRow.askReject (page.tsx:693-702) giữ lý do đã gõ khi API trả lỗi. KHÔNG sửa apps/web/src/components/** (gói ui-admin-3 giữ). Test vitest web. ${SHOTS(3293, 'web')}`,
    files: 'apps/web/src/app/admin/** (+ spec)',
  },
  {
    key: 'ui-admin-3', race: 25594,
    spec: `Admin web, apps/web/src/components/admin/**. Đọc ${DOCS}/D7-uiux-admin-web.md, ${DOCS}/impl/dot3.md (gói ui-admin-1, mục còn lại), ${DOCS}/impl/dot2.md (gói pancake-hoan-cod) và ${DOCS}/impl/dot1.md (gói quyen-admin, mục ops-inbox-tab). Làm: D7-19 (tab trong components/admin chỉ hiện chữ đỏ khi lỗi: thêm nút "Thử lại" gọi refetch, dùng một component chung nếu đã có), D7-25 (ô nhập không nhãn ở components/admin), D7-26 (ở 1440: tên khách và nút không xuống dòng xấu, cột mã đơn hợp lý, bảng Đổi rác không dồn cột). P3: shift-approval-tab.tsx:58,78-79,93-99 hộp xác nhận chụp danh sách id lúc mở và mutation dùng đúng danh sách đó; merchant-fulfilment-tab.tsx:378-392,614 ô mã giao dịch toàn dấu cách bị chặn; cashback-tab.tsx:10-15 PAID là cron cộng vào Ví Tubu → nhãn "Đã cộng vào Ví"; customer-refunds-tab.tsx:181-198 khoản COD chờ đối soát (lý do ATTENTION_COD_RETURN_UNVERIFIED / loại khoản COD mới của gói pancake-hoan-cod) có nhãn nút và câu xác nhận đúng ("Xác nhận đã thu COD, hoàn cho khách"/"Không hoàn"); ops-inbox-tab.tsx:23 + payout-admin-tab.tsx:48 số thẻ "Lệnh rút tiền chờ chi" khớp danh sách khi ADMIN bấm. KHÔNG sửa portal-header.tsx, apps/web/src/app/**. Test vitest web. ${SHOTS(3294, 'web')}`,
    files: 'apps/web/src/components/admin/** trừ portal-header.tsx (+ spec)',
  },
  {
    key: 'api-p3-hieu-nang', race: 25595,
    spec: `API, hiệu năng và P3 còn lại. Đọc ${DOCS}/D9-hieu-nang.md, ${DOCS}/impl/dot3.md (gói perf-api), ${DOCS}/impl/dot2.md (gói doi-rac-kho). Làm: D9-06 (dashboard và báo cáo doanh thu admin quét toàn bảng orders: giới hạn theo khoảng ngày có chỉ mục hoặc tổng hợp, không đổi số liệu), D9-07 (đọc thừa cố định trên đường giỏ → thanh toán: bỏ truy vấn lặp, không đổi kết quả giá), D9-09 (danh sách mã giảm giá admin quét bảng coupons 4 lần mỗi lượt: gộp truy vấn). Đo trước/sau bằng ${UAT}/docs/2026-10-20-uat/tools/perf/ trên cụm Postgres riêng cổng 25595 nếu đo được, ghi số vào green. P3: cart.service.ts:400 addItems upsert theo thứ tự dòng đến → sắp theo variationId để hai lượt mua lại song song không deadlock (race spec); orders.service.ts:504 inCart tăng trước khi addItems xác nhận dòng; catalog.service.ts:345 cache đầy xoá nhầm khi khoá đang làm mới chính là khoá hết hạn; waste-confirm.service.ts:112 từ chối cả yêu cầu khi dòng chỉ-kho có receivedQty=0 (cho qua khi SL 0); waste-admin-points.service.ts:67 nối tên món bằng ', ' trong khi tên có dấu phẩy (dùng '; ' hoặc ngoặc kép); waste-admin-points.service.ts:129 acceptedItemIds của admin còn trả liên kết cũ không lọc như listPoints. KHÔNG sửa coupons/coupons.service.ts, flash-sale/**, admin/coupon-input-rules.ts, orders/order-status*.ts, groupbuy/**, staff/** (gói đợt 4a đang sửa).`,
    files: 'apps/api/src/modules/admin/** (trừ coupon-input-rules*.ts), apps/api/src/modules/cart/**, apps/api/src/modules/checkout/**, apps/api/src/modules/orders/orders.service*.ts, apps/api/src/modules/catalog/**, apps/api/src/modules/waste-exchange/**, apps/api/prisma/migrations (chỉ chỉ mục mới nếu cần), apps/api/test/integration-race/** (spec mới)',
  },
]

const WORKER = (p) => `Đọc ${BRIEF} trước (luật cứng, quyết định đã chốt). Bạn sửa MỘT gói: "${p.key}".

Chuẩn bị (đúng thứ tự):
  export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
  cd ${ROOT} && git worktree add -b uat/${p.key} .claude/worktrees/uat-${p.key} ${BASE}
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
