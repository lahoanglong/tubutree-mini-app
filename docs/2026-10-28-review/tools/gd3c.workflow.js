export const meta = {
  name: 'review-1028-gd3c',
  description: 'GĐ3 đợt C: review Opus đối kháng 8 gói, worker sửa, review lại tới khi merge được (tối đa 3 lượt; gói tiền/điểm ít nhất 2 lượt review)',
  phases: [
    { title: 'Review', detail: 'reviewer Opus đối kháng' },
    { title: 'Sửa', detail: 'worker Sonnet sửa theo review' },
  ],
}

// args: { only?: [<gói>] }. Báo cáo worker đợt B đọc từ reviews/<gói>-b.md.
const ROOT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees'
const R = ROOT + '/review-1028/docs/2026-10-28-review'
const BASE = '1384ff3804ee1ce28cab06f0c2bb0230fb138f9b'
const MAX_FIX = 2

const PKGS = [
  { g: 'doirac', lane: 1, ports: '3710–3719 (e2e API 3711, web 3712, Mini App 3713, gate PG 3714, gate Redis 3715), race Postgres 35710', group: 'DR', money: false,
    items: 'R-1 (chỉ phần mã: go-live cảnh báo chính sách còn bản nháp), R-11 (chặn bật waste.enabled khi thể lệ trống), R-46…R-56 (R-53 trừ dòng Học viện ở profile), R-128, R-129',
    rules: 'Không viết thể lệ hay chữ pháp lý. Lượt 2 phải sửa các P2 trong reviews/doirac-r1.md.' },
  { g: 'taikhoan', lane: 3, ports: '3720–3729 (e2e API 3721, web 3722, Mini App 3723, gate PG 3724, gate Redis 3725), race Postgres 35720', group: 'DH', money: false,
    items: 'R-9 (ngày giao dự kiến từ shipping.eta_*, trống thì ẩn; ẩn khi đã qua, khi có món đặt trước, khi đơn gian hàng đối tác), R-33…R-36, R-107…R-111, R-113, R-115, dòng Học viện ở Cá nhân (R-53)',
    rules: 'Không bịa ngày giao. Lượt 2 phải sửa P1/P2 trong reviews/taikhoan-r1.md (Tailwind order, nhãn đè, First Load).' },
  { g: 'quantri', lane: 8, ports: '3750–3759 (e2e API 3751, web 3752, Mini App 3753, gate PG 3754, gate Redis 3755), race Postgres 35750', group: 'QT', money: true,
    items: 'R-13, R-68…R-75, R-144…R-149 (R-74 trang Hôm nay gọn: số dùng CÙNG định nghĩa trang Báo cáo; R-68 chỉ đếm tài khoản thật)',
    rules: 'Số tiền/đơn/khách mới trên Hôm nay phải khớp Báo cáo (doanh thu trừ hoàn một phần). Giữ quyền theo vai trò. Ảnh admin1280/admin375.' },
  { g: 'ctv', lane: 7, ports: '3740–3749 (e2e API 3741, web 3742, Mini App 3743, gate PG 3744, gate Redis 3745), race Postgres 35740', group: 'CT', money: true,
    items: 'R-12, R-57…R-67, R-137, R-139, R-141, R-142; THÊM: hoa hồng CTV đã duyệt TỰ VÀO VÍ TUBU (chủ duyệt 28/10) qua đúng đường "Chuyển vào Ví" hiện có, cờ affiliate.auto_wallet_transfer_enabled mặc định bật, idempotent, báo CTV trong app, giữ nút tay',
    rules: 'TIỀN: không đường ghi tiền thứ hai; khấu trừ TNCN như tay; cron và bấm tay đồng thời chỉ cộng một lần; không đổi tỉ lệ, hold_days, ngưỡng thuế; migration chỉ thêm. Phải có race test thật trên Postgres.' },
  { g: 'diemxanh', lane: 4, ports: '3730–3739 (e2e API 3731, web 3732, Mini App 3733, gate PG 3734, gate Redis 3735), race Postgres 35730', group: 'DX', money: true,
    items: 'R-10, R-37 (bỏ nút trùng), R-38…R-45 (R-42 dòng giữ hạng), R-117…R-120, R-123, R-124, R-126, R-127, phần Điểm Xanh của R-24; THÊM (chủ duyệt 28/10): gộp hai chuỗi điểm danh thành một streakDay (giữ số điểm/giọt từng ngày, luật lỡ ngày và vé giữ lửa theo chuỗi nước, chuyển đổi không ai mất/nhận đôi trong ngày chuyển); tin báo trước khi hạ hạng (cron, loyalty.tier_drop_notice_days=14, thông báo trong app luôn, ZNS khi có mã mẫu, một lần mỗi kỳ giữ hạng)',
    rules: 'ĐIỂM/GIỌT: không đổi số điểm, giọt, giá quà; không cộng đôi trong ngày chuyển; migration chỉ thêm. Phải có race test thật trên Postgres cho điểm danh.' },
  { g: 'khampha', lane: 2, ports: '3760–3769 (e2e API 3761, web 3762, Mini App 3763, gate PG 3764, gate Redis 3765), race Postgres 35760', group: 'KP', money: false,
    items: 'R-2 (CLS < 0,1), R-3 (chủ chốt: ô tìm dính, thẻ thành viên 1 dòng có Điểm danh, 1 hàng lối tắt cuộn ngang thêm Đơn hàng bỏ ô trùng thanh đáy, món hàng trong màn đầu 812−90px, web 1280 dùng hết bề ngang, thanh đáy giữ), R-4 (tắt khảo sát lúc mở, bong bóng không che), R-14…R-21, R-87…R-91',
    rules: 'Mini App và web 375 giống nhau. Không thêm thư viện UI. Lối tắt có điều kiện cờ (Đổi rác, Tích điểm đơn sàn) vẫn theo cờ.' },
  { g: 'muahang', lane: 6, ports: '3770–3779 (e2e API 3771, web 3772, Mini App 3773, gate PG 3774, gate Redis 3775), race Postgres 35770', group: 'MH', money: true,
    items: 'R-6 (bottom sheet chọn phân loại khi SP ≥ 2 phân loại), R-7, R-8 (lưu mã QR qua PlatformBridge), R-22…R-30 (R-28 chỉ ẩn dòng Ví khi 0đ), R-31 (WELCOME30 newCustomerOnly=true bằng migration dữ liệu UPDATE theo code + seed; KHÔNG đổi FREESHIP, giá trị, ngưỡng), R-96, R-97, R-103…R-105; KHÔNG làm R-32',
    rules: 'GIÁ/ƯU ĐÃI: không đổi giá, phí, giá trị mã, ngưỡng; migration WELCOME30 idempotent, không đụng mã khác; khách đã có đơn không thấy và không áp được WELCOME30 (API là nguồn chân lý). Logic chọn phân loại ở app-core có test.' },
  { g: 'hieunang', lane: 9, ports: '3780–3789 (e2e API 3781, web 3782, Mini App 3783, gate PG 3784, gate Redis 3785), race Postgres 35780', group: 'TL', money: false,
    items: 'R-5 (API đổi cỡ ảnh bằng sharp, cache đĩa, chống SSRF, bề rộng cố định, webp, Cache-Control immutable; client dùng srcset + width/height), R-76…R-85 (loading.tsx/error.tsx web, error boundary Mini App có Thử lại, RouteFallback khung chờ, staleTime và không retry 4xx, Bán chạy không nạp cả catalog, /cart ≤ 8 SQL, giảm /home/me, mất mạng báo đúng)',
    rules: 'BẢO MẬT: endpoint đổi cỡ không được thành proxy mở (host cho phép, chặn IP nội bộ kể cả qua DNS và redirect, giới hạn byte/thời gian/điểm ảnh, chống decompression bomb). Không đổi docker-compose PROD.' },
]

const sel = (args && args.only) ? PKGS.filter((p) => args.only.includes(p.g)) : PKGS
const MIG = 'Ba nhánh đang có migration cùng mốc 20261028110000. Theo thứ tự gộp, giữ: muahang 20261028110000_welcome30_new_customer_only; diemxanh đổi tên thư mục thành 20261028120000_tier_drop_notice; ctv đổi thành 20261028130000_affiliate_auto_wallet_transfer (git mv, sửa mọi chỗ nhắc tên, chạy lại migrate deploy trên DB race).'
const EXTRA = {
  doirac: 'Việc thêm: đo web First Load các trang đã đổi (next build qua bundle-report --build-web --only=web) và ghi trước/sau.',
  taikhoan: 'Việc thêm: /tai-khoan/don-hang/[code] First Load đang +3 KB (vượt +2 KB): cắt về ≤ +2 KB (tải trễ phần dưới màn đầu). Chạy web gate cả bộ (không chỉ order/account).',
  quantri: 'Việc thêm: ghép ảnh trước/sau admin375 và admin1280 bằng before-after.mjs (ảnh TRƯỚC ở screens/admin*) vào screens-quantri/.',
  ctv: 'Việc thêm: ' + MIG + ' Hero trang CTV hiện "Đang chờ: 0đ" lúc đang tải: thay bằng khung chờ. Đo web First Load các trang đã đổi.',
  diemxanh: 'Việc thêm: ' + MIG + ' Tin báo trước hạ hạng là tin dịch vụ về tài khoản, không phải khuyến mãi: xếp vào nhóm tin tài khoản/đơn hàng (khách tắt Khuyến mãi vẫn nhận; vẫn tôn trọng cờ tắt mọi thông báo nếu có). Chụp trạng thái slow5s và error500 cho game, offers, loyalty.',
  khampha: 'Việc thêm (bắt buộc, lượt đợt B còn dở): (1) CLS web < 0,1 cho khách mới và khách cũ: tải /flash-sales/active ở loadHomeInitial phía máy chủ và đưa vào initialData của FlashSale (hoặc giữ chỗ cố định đúng chiều cao); đo lại bằng cls-probe ở cổng của gói và ghi số. (2) /san-pham First Load +10 KB: tìm nguyên nhân (so next build trước/sau, chunk nào vào First Load) và đưa về ≤ +2 KB. (3) Mini entry 715 KB: đưa về ≤ 711. (4) Chạy web gate CẢ BỘ và Playwright Mini toàn bộ, ghi số. (5) Chụp lại ảnh sau commit cuối (home, browse, browse-category, browse-search, browse-brand, brand-slug, brand-story; persona returning, new, guest; thêm slow5s cho home) và ghép trước/sau; tự xem. (6) Xoá các file *.tmp.mjs trong tools hoặc đưa probe dùng lại được vào tools/perf/ có chú thích cách chạy.',
  muahang: 'Việc thêm (bắt buộc, đợt B chưa làm): (1) Bật lane 6 từ worktree gói, nạp dữ liệu, chụp trước/sau mini375+web375 cho product-slug (có cảnh bảng chọn phân loại đang mở: SP có ≥ 2 phân loại), cart, checkout, bank-payment-code, group-buy, order-success; ghép bằng before-after.mjs vào screens-muahang/ và tự xem từng ảnh. (2) Chạy web gate CẢ BỘ. (3) Đo web First Load trước/sau (bundle-report --build-web --only=web ở gốc base 1384ff380 bằng cách đọc số trước trong ' + R + '/03-perf-build.md, và ở nhánh) cho /san-pham/[slug], /thanh-toan, /gio-hang, /mua-chung. (4) Mini entry 712 KB: đưa về ≤ 711 (saveImage để ở chunk lazy). (5) Web có test cho bridge.saveImage.',
  hieunang: 'Việc thêm: (1) Tổng Mini App tăng ~10 KB: brief cấm tăng; giảm về ≤ baseline hoặc giải thích từng KB và đổi được gì (entry giảm 12 KB). (2) Đo web First Load các trang đã đổi (next build) và ghi trước/sau. (3) Thêm IMAGE_CACHE_DIR, IMAGE_CACHE_MAX_MB, IMAGE_RESIZE_EXTRA_HOSTS vào env validation và .env.production.example (không đổi docker-compose PROD). (4) Kiểm Dockerfile API build được sharp trên alpine (đọc Dockerfile; nếu dùng pnpm fetch/install --prod thì binary linuxmusl có trong lock); ghi kết luận. (5) Flaky web-checkout.web.spec:133: chạy 5 lần trên base 1384ff380 và trên nhánh để biết có sẵn hay do gói. (6) /home/me SQL: giảm nếu rẻ, ghi số trước/sau bằng prisma-query-log.',
}

const review = (p, round, workerReport, prev) => `Bạn là reviewer đối kháng (PM + Tech Lead) cho gói ${p.g} của đợt review Tubu Tree 2026-10-28. Lượt review ${round}. Chỉ đọc, không sửa file, không commit, không bật server.
Worktree: ${ROOT}/r1028-${p.g}, nhánh review/1028-${p.g}. Diff: \`git -C ${ROOT}/r1028-${p.g} diff ${BASE}..HEAD\`, lịch sử \`git -C ${ROOT}/r1028-${p.g} log --oneline ${BASE}..HEAD\`.
Mục gói: ${p.items}.
Luật riêng: ${p.rules}
Mô tả mục và bằng chứng: ${R}/20-backlog.md, ${R}/10-review-${p.group}.md. Luật chung worker: ${R}/tools/gd3-worker-brief.md. Review lượt trước của đợt A (nếu có): ${R}/reviews/${p.g}-r1.md.
Báo cáo mới nhất của worker: ${workerReport ? '\n---\n' + workerReport + '\n---' : `đọc ${R}/reviews/${p.g}-b.md`}
Việc bắt buộc người giao thêm cho lượt sửa (thiếu thì là P2): ${EXTRA[p.g]}
${prev ? `Review lượt trước (kiểm từng phát hiện đã sửa thật chưa, rồi tìm lỗi mới):\n---\n${prev}\n---\n` : ''}Ảnh trước/sau: ${R}/screens-${p.g}/ (mở bằng Read; mỗi ảnh 4 cột: Mini trước | Mini sau | Web trước | Web sau).

Tìm lỗi thật, ưu tiên: sai tiền/điểm/giọt/hoa hồng, cộng đôi, race; đổi luật điểm/giá/phí/thể lệ/chữ pháp lý khi chưa được phép; bảo mật (SSRF, quyền, lộ dữ liệu); hồi quy chức năng; Mini App và web 375 lệch nhau (so ảnh); thiếu trạng thái tải/rỗng/lỗi; vùng chạm < 44px; chữ khó hiểu hoặc sai sự thật; test giả (assert lỏng, mock che lỗi); mục báo "đã làm" mà diff không có; vi phạm luật hai nền tảng (logic không ở app-core, thiếu route-map, gọi zmp-sdk/window trong app-core); migration không chỉ-thêm. Được chạy test đơn lẻ (vitest/jest một file) để chứng minh.

Trả về (tối đa 40 dòng): dòng đầu đúng một trong hai: "KẾT LUẬN: merge được" hoặc "KẾT LUẬN: chưa merge" (còn P0/P1/P2 nào thì là chưa merge). Rồi danh sách "[P0|P1|P2|P3] file:dòng — vấn đề — cách sửa". Không khen.`

const fix = (p, rv) => `Đọc trước và tuân thủ: ${R}/tools/gd3-worker-brief.md.
Gói: ${p.g}. Worktree: ${ROOT}/r1028-${p.g}. Nhánh: review/1028-${p.g} (gốc ${BASE}). Lane ${p.lane}${p.lane === 9 ? ' (Redis db 15, DB tubutree_uat_l9; không chạy build-template.sh)' : ''}. Cổng: ${p.ports}. Thư mục ảnh: ${R}/screens-${p.g}/.
KHÔNG chạy tools/perf/run-all.mjs. Không push.
Mục gói: ${p.items}. Luật riêng: ${p.rules}

Reviewer Opus vừa trả:
---
${rv}
---
Việc bắt buộc người giao thêm (làm cả khi reviewer không nhắc): ${EXTRA[p.g]}
Sửa MỌI P0, P1, P2. P3: sửa nếu rẻ; không sửa thì ghi "không làm" kèm lý do một dòng. Viết test trước cho lỗi logic (thấy đỏ rồi sửa). Chạy lại bộ kiểm của brief cho phần đã đổi (tsc, eslint, vitest toàn bộ app đã đổi, jest API nếu đụng API, race nếu đụng tiền/điểm, Playwright cho màn đã đổi, lint:parity, vite build + bundle-report). Đổi giao diện thì chụp lại ảnh trước/sau và tự xem. Commit nhỏ.
Trả về theo schema; report: từng phát hiện → đã sửa (commit) / không làm (lý do); số kiểm thật.`

const OUT = {
  type: 'object',
  properties: { head: { type: 'string' }, report: { type: 'string', description: 'tối đa 40 dòng' } },
  required: ['head', 'report'],
}
const ok = (t) => typeof t === 'string' && /KẾT LUẬN:\s*merge được/i.test(t.split('\n').slice(0, 3).join(' '))

const results = await pipeline(sel, async (p) => {
  const rounds = []
  let wr = null
  let rv = await agent(review(p, 1, wr, null), { label: `rv1-${p.g}`, phase: 'Review', agentType: 'reviewer' })
  rounds.push({ review: rv })
  let n = 1
  while (n <= MAX_FIX && (!ok(rv) || (p.money && n === 1))) {
    if (ok(rv)) {
      n++
      rv = await agent(review(p, n, wr, rv) + '\nĐây là lượt kiểm thứ hai bắt buộc cho gói đụng tiền/điểm: đọc lại diff từ đầu với con mắt mới, tập trung race, cộng đôi, làm tròn, múi giờ VN, quyền.', { label: `rv${n}-${p.g}`, phase: 'Review', agentType: 'reviewer' })
      rounds.push({ review: rv })
      continue
    }
    const w = await agent(fix(p, rv), { label: `fix${n}-${p.g}`, phase: 'Sửa', schema: OUT, agentType: 'worker' })
    wr = w ? w.report : '(worker sửa không trả báo cáo)'
    n++
    rv = await agent(review(p, n, wr, rv), { label: `rv${n}-${p.g}`, phase: 'Review', agentType: 'reviewer' })
    rounds.push({ fix: w, review: rv })
  }
  return { g: p.g, mergeable: ok(rv), rounds }
})
return results
