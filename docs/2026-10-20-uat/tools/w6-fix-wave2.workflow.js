export const meta = {
  name: 'uat-w6-fix-wave2',
  description: 'Sửa đợt 2 từ review D11–D15: 5 gói (đại lý, Pancake hoàn COD, đổi rác kho, logic Mini App, admin web), TDD worker Sonnet, review Opus 2 lượt',
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
const BASE = 'uat/2026-10-20'

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

const PKGS = [
  {
    key: 'dai-ly', race: 25561,
    spec: `Đại lý (đọc ${DOCS}/D11-tien-don-si-dinh-ky.md). (1) D11-01 (P1): luật đã chốt nhóm C "Đơn sỉ tối thiểu 3 triệu. Miễn phí giao từ 5 triệu. Khoá mua chịu khi quá hạn." chưa có trong dealer.service.ts placeOrder (:207, :237-307). Làm: khoá cấu hình dealer.min_order_value_vnd = 3000000 (chặn 400 với chữ tiếng Việt rõ), dealer.free_ship_threshold_vnd = 5000000; đơn dưới ngưỡng thu phí giao: dùng lại đúng cách tính phí giao của đơn lẻ nếu có hàm tính theo địa chỉ dùng được ở đây, nếu không thì khoá dealer.shipping_fee_below_threshold_vnd với mặc định bằng phí giao phẳng của đơn lẻ trong cấu hình hiện có (ghi rõ trong decisions con số và nguồn); total = subtotal + phí. Khoá mua chịu: đơn CREDIT bị chặn khi đại lý có khoản nợ đơn (ORDER) chưa trả đủ quá hạn theo paymentTerms của bậc (NET n ngày), sau khoá dealer.block_credit_when_overdue mặc định true; PREPAID vẫn đặt được. Thêm khoá vào seed.ts SYSTEM_CONFIGS theo quy ước + chạy npx jest prisma/reference-data src/modules/system-config. Màn đại lý Mini App (apps/miniapp/src/pages/dealer.tsx) và web admin hiển thị đúng phí giao/tối thiểu nếu đang hiện "miễn phí giao" cứng (kiểm, sửa chữ nếu cần). (2) D11-02 (P1) + bỏ sót 2: thu hồi thưởng quý (dealer.service.ts:1367-1422, 1262-1267) lấy cả đơn không nằm trong lần trả thưởng và dùng dealerVolume hiện tại nên thu thừa khi có đơn chốt muộn. Sửa: số thu hồi tính trên tập đơn đã được tính lúc trả thưởng (lưu/đọc lại ảnh chụp doanh số lúc payout; nếu chưa có chỗ lưu thì suy ra từ thời điểm chốt <= paidAt của payout), thu hồi = thưởng(đã tính) − thưởng(đã tính − đơn bị trả), không âm, idempotent. KHÔNG sửa apps/api/src/modules/orders/order-reversal.service.ts (gói khác đang sửa): nếu cần đổi chữ ký hàm thì giữ tương thích. Test đỏ trước: đơn 2.999.999đ → 400; 4.000.000đ → shippingFee > 0; 5.000.000đ → 0; nợ NET 15 quá 16 ngày → CREDIT 400, PREPAID được; hai ca số liệu trong báo cáo D11-02 (thu 0 thay vì 3,6 tr; thu 1,8 tr thay vì 3,9 tr).`,
    files: 'apps/api/src/modules/dealer/**, apps/api/prisma/seed.ts (chỉ SYSTEM_CONFIGS), reference-data, apps/miniapp/src/pages/dealer*.tsx (chỉ chữ phí giao/tối thiểu)',
  },
  {
    key: 'pancake-hoan-cod', race: 25562,
    spec: `D12-01 (P1, đọc ${DOCS}/D12-vong-doi-don.md): Pancake gửi trạng thái "Đã hoàn" (5) cho đơn COD đang DELIVERED thì Tubu tự hoàn toàn bộ tổng vào Ví dù COD có thể chưa thu (kho bấm "Đã nhận" (3) hàng loạt/nhầm, giao hỏng, về kho). Phương án an toàn đã chọn: với đơn COD chưa có bằng chứng đã thu tiền (paymentStatus khác PAID, không có mốc thu COD từ Pancake trạng thái 16 "Đã thu tiền" nếu code đang lưu được), tín hiệu 5 từ Pancake KHÔNG tự hoàn tiền Ví: vẫn ghi nhận đơn bị hoàn về theo đường đang có NHƯNG không gọi refundToWallet tự động; đưa đơn vào hàng "Cần xử lý Pancake" (đọc cơ chế needs-attention hiện có ở pancake.processor/ops inbox) với lý do rõ để ADMIN/kế toán kiểm và hoàn tay bằng đường hoàn tiền admin có sẵn. Đơn đã chuyển khoản (PAID) giữ nguyên hành vi tự hoàn. Ưu tiên sửa trong apps/api/src/modules/integrations/pancake/** và order-status.service.ts; KHÔNG sửa apps/api/src/modules/orders/order-reversal.service.ts (gói khác đang sửa) — nếu thật sự bắt buộc thì dừng và ghi trong decisions. Điểm/hoa hồng của đơn vẫn phải đảo như đơn hoàn bình thường. Test đỏ trước: processor + status service thật (theo cách repro trong báo cáo) đơn COD UNPAID DELIVERED 300.000đ nhận status 5 → không có refundToWallet, có mục cần xử lý; đơn PAID chuyển khoản nhận 5 → vẫn hoàn 300.000đ; điểm đơn bị đảo trong cả hai ca.`,
    files: 'apps/api/src/modules/integrations/pancake/**, apps/api/src/modules/orders/order-status.service*.ts, apps/api/src/modules/ops/** chỉ nếu cần hiện lý do mới',
  },
  {
    key: 'doi-rac-kho', race: 25563,
    spec: `D13-01 (đọc ${DOCS}/D13-doi-rac-don-san.md): luật đã chốt "hộp sữa và vỏ chai Tubu chỉ kho HCMC nhận; đại lý chỉ nhận carton và nilon" chưa được API ép: admin tick được hai món đó ở điểm PARTNER (waste-admin-points.service.ts:172-257), khách tạo yêu cầu DROP_OFF giữ chỗ (core/waste-hold.service.ts:234-243), nhân viên đại lý xác nhận cộng điểm (receiving/waste-confirm.service.ts:376-451). Sửa ở API, ba lớp: lưu cấu hình điểm (chặn 400 khi điểm không phải kho HCMC mà nhận món chỉ-kho; xác định "kho HCMC" và "món chỉ-kho" từ dữ liệu/khóa có sẵn — đọc docs/launch/recycle-rewards-launch-checklist.md, seed waste_items, enum loại điểm; nếu chưa có cờ thì thêm cờ dữ liệu tối thiểu, có migration và seed), tạo yêu cầu/giữ chỗ (chặn chọn món không được nhận ở điểm đó), xác nhận ở quầy (chặn, không cộng điểm). Web admin form apps/web/src/components/admin/waste-point-form.tsx:381-383 (phiên UAT đang giữ components/admin) tắt hai ô đó với điểm không phải kho HCMC kèm chữ giải thích; Mini App màn tạo yêu cầu (apps/miniapp/src/pages/recycle-new.tsx, recycle-edit.tsx) không cho chọn món đó với điểm đại lý nếu đang cho. Test đỏ trước cho cả ba lớp API + vitest web form + vitest miniapp nếu đổi. Đây là điểm thưởng: viết test đối chiếu sổ điểm không đổi khi bị chặn.`,
    files: 'apps/api/src/modules/waste-exchange/**, apps/api/prisma (migration/seed nếu cần cờ), apps/web/src/components/admin/waste-point-form*.tsx, apps/miniapp/src/pages/recycle-new*.tsx, recycle-edit*.tsx',
  },
  {
    key: 'miniapp-logic', race: 25564,
    spec: `Logic Mini App (đọc ${DOCS}/D14-miniapp-logic.md). (1) D14-01 (P1): /points/scan (apps/miniapp/src/pages/external-points.tsx:177-212) khách chưa có SĐT nhận 403 NOT_ELIGIBLE_USER mà không có nút chia sẻ SĐT: xin SĐT ngay tại màn này như recycle.tsx:136-155 (ensurePhone), trước khi gửi và khi nhận NOT_ELIGIBLE_USER; không dựa vào cổng thẻ hộp hàng. (2) D14-02: bank-payment.tsx: đơn bị huỷ/quá hạn khi đang ở màn QR thì ẩn QR/STK/số tiền, dừng poll, hiện trạng thái đúng + lối thoát về chi tiết đơn; nút Kiểm tra không báo nhầm lỗi mạng khi máy chủ trả 400 nghiệp vụ. (3) D14-03 (tiền): wallet.tsx rút Ví: lỗi hết thời gian/mạng/5xx GIỮ Idempotency-Key cũ (chỉ đổi key sau khi thành công hoặc lỗi 4xx nghiệp vụ rõ ràng), tải lại số dư, báo khách kiểm lịch sử trước khi thử lại; rà cùng lỗi ở các màn tiền khác dùng Idempotency-Key (rút hoa hồng affiliate, đặt đơn đã có xử lý riêng — chỉ báo nếu lệch). (4) D14-04: store/auth.ts:250-263 refresh lỗi mạng đặt status "error" (như restore() :196) chứ không "idle", để useSessionRecovery tự thử lại. (5) D14-05: đếm ngược flash sale bù lệch giờ máy chủ (dùng header Date hoặc trường thời gian máy chủ có sẵn trong response flash sale; không có thì thêm serverNow vào response API flash sale — sửa API tối thiểu). (6) D14-06: about-data.ts:49-52 + i18n/vi.ts:448 bỏ câu "xu cũ" ... "trừ được tới 100%" khỏi FAQ dự phòng (chưa có khách thật nên không có điểm quy đổi từ xu). Test đỏ trước (vitest) cho từng mục; chạy cả TZ=UTC cho mục giờ. Ghi danh sách màn Mini App đổi giao diện vào decisions (để báo phiên web).`,
    files: 'apps/miniapp/src/** (external-points, bank-payment, wallet, affiliate nếu cần, store/auth.ts, hooks, flash-sale, use-countdown, product-detail chỉ phần đếm ngược, about-data, i18n/vi.ts), apps/api/src/modules/flash-sale/** CHỈ nếu phải thêm serverNow (gói flash-sale-staff đang sửa cùng module: chỉ thêm trường vào response, không đụng service logic)',
  },
  {
    key: 'admin-web', race: 25565,
    spec: `Admin web (đọc ${DOCS}/D15-admin-web-bao-mat.md). (1) D15-01: chủ nhãn chèn CSS tuỳ ý qua themeColor khuyến mãi (apps/api/src/modules/brand/dto/brand.dto.ts:63,75 chỉ @IsString). API chỉ nhận màu hex #RGB/#RRGGBB (hoặc danh sách màu cho phép nếu code có), từ chối khác; các nơi render style từ themeColor ở Mini App (grep themeColor apps/miniapp/src) lọc lại qua hàm kiểm màu trước khi dùng; trang web /brand/[slug] thuộc phiên web: chỉ ghi vào decisions để báo. (2) D15-02: apps/web/src/app/admin/page.tsx:1819-1874 form "Cấp / đổi vai trò theo SĐT" mặc định CUSTOMER, hạ vai trò không xác nhận: bỏ mặc định (bắt chọn), hỏi xác nhận mọi lần đổi vai trò, nêu rõ hậu quả khi hạ STAFF/đại lý/MERCHANT (mất nhóm việc, gian hàng tắt đối tác). (3) D15-03: page.tsx:677-708 nút "Từ chối" hồ sơ đại lý chạy ngay, lý do cứng: mở hộp nhập lý do (bắt buộc, gửi lên API đã nhận reason ở admin.service.ts:341-347 — kiểm), xác nhận trước khi gửi. (4) D15-04: các nút xoá chạy ngay (page.tsx:3186, 3307, 2670, 2846, 2503, 2259, 2148, 2135): thêm xác nhận giống nút xoá đợt flash sale (:2378). Giữ diff gọn từng chỗ (gói quyen-admin có thể sửa chỗ khác trong page.tsx). Test vitest web cho (2)(3)(4) (ít nhất các nút chính), jest API cho (1).`,
    files: 'apps/api/src/modules/brand/**, apps/miniapp/src chỗ dùng themeColor, apps/web/src/app/admin/page.tsx (+ spec)',
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
