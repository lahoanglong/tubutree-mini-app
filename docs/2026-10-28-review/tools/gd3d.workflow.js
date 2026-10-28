export const meta = {
  name: 'review-1028-gd3d',
  description: 'GĐ3 đợt D: lượt sửa cuối cho 7 gói theo review đợt C và quyết định người giao, rồi review Opus (tối đa 2 lượt sửa)',
  phases: [
    { title: 'Sửa', detail: 'worker Sonnet' },
    { title: 'Review', detail: 'reviewer Opus đối kháng' },
  ],
}

// args: { only?: [<gói>] }. Review cuối đợt C ở reviews/<gói>-c.md.
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
  { g: 'hieunang', lane: 3, ports: '3780–3789 (e2e API 3781, web 3782, Mini App 3783, gate PG 3784, gate Redis 3785), race Postgres 35780', group: 'TL', money: false,
    items: 'R-5 (API đổi cỡ ảnh bằng sharp, cache đĩa, chống SSRF, bề rộng cố định, webp, Cache-Control immutable; client dùng srcset + width/height), R-76…R-85 (loading.tsx/error.tsx web, error boundary Mini App có Thử lại, RouteFallback khung chờ, staleTime và không retry 4xx, Bán chạy không nạp cả catalog, /cart ≤ 8 SQL, giảm /home/me, mất mạng báo đúng)',
    rules: 'BẢO MẬT: endpoint đổi cỡ không được thành proxy mở (host cho phép, chặn IP nội bộ kể cả qua DNS và redirect, giới hạn byte/thời gian/điểm ảnh, chống decompression bomb). Không đổi docker-compose PROD.' },
]

const LEAD = [
  'Bundle Mini: entry KHÔNG tăng (≤ 711 KB raw; hieunang giữ ~699). Tổng Mini chỉ được tăng ở chunk lazy cho tính năng mới, tối đa +5 KB mỗi gói, ghi số từng chunk tăng.',
  'Web First Load trang đã đổi: ≤ +2 KB so với base; vượt thì cắt (next/dynamic phần dưới màn đầu) hoặc ghi số + lý do không cắt được. Số lấy từ bảng của next build (apps/web/.next/bundle-report-next-build.log), không từ manifestGzKB.',
  'Mục ghi "GHI BACKLOG": KHÔNG sửa 20-backlog.md; liệt kê trong báo cáo dưới tiêu đề "GHI BACKLOG", người giao ghi.',
  'CLS/LCP theo run-all.mjs do người giao đo sau; worker chỉ đo bằng cls-probe khi được giao.',
  'DB mẫu tubutree_uat_tpl vừa dựng lại 14:58. Lane 9 là lane dựng mẫu: CẤM dùng.',
].join(' ')

const TODO = {
  doirac: 'Theo "Review 3" trong reviews/doirac-c.md: (1) First Load web trước/sau (bảng next build) cho /, /doi-rac, /doi-rac/tao, /doi-rac/yeu-cau, /doi-rac/diem-nhan, /doi-rac/xong/[id], /cong-dong, /cong-dong/[id], /hoc-vien và phần dùng chung; số trước lấy ở ' + R + '/03-perf-build.md (đo trên máy này ở main = base); route không có ở đó thì ghi số nhánh kèm chữ "không có số trước", không dựng bản base riêng; ghi rõ). (2) P3 lastPreview cho cách giao đang lỗi + test. (3) P3 một spec chạy cùng bộ ca cho provinceKey/sameProvince ở app-core và shared-types (hoặc app-core re-export đúng nguồn). (4) R-54 Mini: báo MỘT PHẦN; chụp lại recycle mini375-slow5s sau commit cuối, ghép, tự xem. Tổng Mini +3 KB lazy: hợp lệ theo quyết định người giao, ghi số từng chunk. Chạy Playwright Mini toàn bộ và web gate các spec doi-rac/cong-dong/hoc-vien.',
  quantri: 'Theo "Review 3" trong reviews/quantri-c.md: (1) P2 trả apps/e2e/tests/shipping-pancake.miniapp.spec.ts:86 về "Xem tất cả đơn" và chạy spec đó. (2) P3 vn-date-input: sau blur, ngày đúng dạng mà không có thật vẫn báo "Ngày không có thật" + test có blur. (3) P3 khoá nút Tạo khi Hết hạn < Bắt đầu + test. (4) P3 chụp admin375 và admin1280 ba trạng thái mới (ô ngày Chưa áp dụng/Ngày không có thật + nút Tạo khoá, dòng giải thích hàng đợi chuyển khoản, nút Bỏ lọc chuyển khoản) và tự xem. (5) R-70, R-75, R-148, R-149: GHI BACKLOG (chuyển gói sau). Lượt trước chưa chạy bộ kiểm: chạy ĐỦ tsc (api, web, miniapp, app-core, e2e), jest API toàn bộ, vitest web toàn bộ, race admin-*/ops-*, Playwright admin (web-gate các spec admin) và Playwright Mini toàn bộ, lint:parity, vite build + bundle-report, First Load /admin.',
  khampha: 'Theo "Review 3" trong reviews/khampha-c.md: (1) P2 hydrate khi HTML ISR cũ trả sau giờ hết suất: luôn vẽ khung span đồng hồ (ẩn bằng invisible khi rỗng, suppressHydrationWarning) hoặc chỉ tính timeLeft sau mount; test hydrateRoot với suất đã hết giờ lúc hydrate (thấy đỏ trước). (2) P2 đo CLS bằng cls-probe ở cổng gói: web khách mới và khách cũ, thêm ca suất còn < 24 giờ; Mini khách mới và khách cũ; mục tiêu < 0,1; ghi số. Chưa đạt thì sửa tới đạt. (3) P2 chụp lại sau commit cuối 7 màn (home, browse, browse-category, browse-search, browse-brand, brand-slug, brand-story) × persona returning, new, guest, cộng home slow5s cho new và guest; browse-search new/guest trống: tìm nguyên nhân, lỗi mã thì sửa; ghép trước/sau, tự xem từng ảnh. (4) P3 dữ liệu dựng sẵn rỗng mà máy nhớ hadFlash thì vẽ FlashSkeleton: làm nếu rẻ. (5) P3 Mini auth offline hiện quà khách mới cho khách cũ: GHI BACKLOG. (6) GHI BACKLOG: new-customer-gift.tsx còn nhắc "định kỳ" trong khi gói muahang tắt Định kỳ (sửa sau khi gộp muahang). Chạy web gate CẢ BỘ, Playwright Mini toàn bộ, First Load /, /san-pham, Mini entry.',
  muahang: 'Theo "Review 3" trong reviews/muahang-c.md: (1) P2 web 375 khi nút Kiểm tra dính đáy: kết quả kiểm (chưa thấy tiền, lỗi mạng, đã nhận) phải thấy được ngay: dùng toast trên đầu như Mini (bank-payment.tsx snackbar top) hoặc hiện trong StickyActionBar; test unpaid và error. (2) P2 ảnh TRƯỚC của order-success: dùng ảnh luồng GĐ1 ' + R + '/screens/flows/mini/2-tim-va-mua/14-man-dat-thanh-cong.png và ' + R + '/screens/flows/web/2-tim-mua/14-man-dat-thanh-cong.png làm cột trước, ghép với ảnh sau (ghép bằng chromium như before-after.mjs hoặc sips), ghi nguồn trong báo cáo; tự xem. (3) P3 web: ô điểm bị khoá dùng đúng nhãn như Mini (checkoutPoints().label), không còn hai câu mâu thuẫn; test. (4) P3 catch khi import download-image hỏng → setQrSaved("failed"); test. (5) /thanh-toan First Load +3 KB: cắt về ≤ +2 KB (next/dynamic phần dưới màn đầu, ví dụ VariationSheet không dùng ở thanh toán, bank panel chỉ khi chọn chuyển khoản) hoặc ghi số từng chunk. (6) GHI BACKLOG: new-customer-gift.tsx (trang chủ, gói khampha) còn nhắc "định kỳ"; R-24 hydrate chưa tái hiện. Chạy web gate CẢ BỘ, Playwright Mini toàn bộ.',
  hieunang: 'LANE ĐỔI: dùng lane 3 (cổng 3231–3238, Redis db 3, DB tubutree_uat_l3; bật bằng lane-up.sh 3 --fresh --web từ worktree r1028-hieunang; lane 9 CẤM). Theo "Review 3" trong reviews/hieunang-c.md: (1) P3 prune: khi file mới không vừa trần thì dọn xuống mức thấp (vd 80%) rồi ghi; test theo đúng đường writeCache. (2) P3 ownMissLimited: chỉ chặn yêu cầu sai ?v= (kiểm phiên bản rẻ trước acquire hoặc đếm theo IP), không chặn yêu cầu hợp lệ; test. (3) P3 OPENED_FROM_PARTNER_LINK tính ở entry như ?claim=, truyền vào OnboardingGate; test. (4) P3 mỗi gate một SilentBoundary. (5) P3 nút quay lại ở chi tiết đơn khi khung chờ /tai-khoan: sửa nếu rẻ, không thì GHI BACKLOG. (6) R-82 /home/me ≤ 12 SQL và R-83 khung chờ san-pham: GHI BACKLOG (kèm số đo trên lane 3). (7) Ảnh R-5 có ảnh thật: đọc vài URL ảnh SP công khai từ https://api.tubutree.com/api/products (chỉ GET công khai), gán vào SP trong DB lane 3 (chỉ DB lane), chụp trước/sau home, browse-category, product-slug, cart (persona returning) và đo tổng byte ảnh tải ở home và browse-category khổ 375 trước (main, lane 5 đang chạy ở 3251/3252/3253 chỉ được ĐỌC/chụp, không ghi DB lane 5) và sau (lane 3). Nếu lane 5 không có ảnh tương ứng thì đo trước bằng cách tắt /img trên lane 3 (biến môi trường) và ghi rõ. (8) Đo lại /cart SQL trên lane 3.',
  ctv: 'Theo review cuối trong reviews/ctv-c.md: (1) P3 số to nhảy lúc tải: chỉ vẽ số to khi dashboard và Ví đều đã về (khung chờ trước đó) ở Mini và web; test. (2) P3 cùng số dư Ví hiện hai lần và aria-label sai: bỏ dòng trùng, aria-label theo nhãn đang hiện; test. (3) P3 race-spec affiliate-auto-wallet:319 assert luôn đúng: dựng commission LOCKED quá hold rồi chạy approveDueCommissions để kiểm thật không gửi tin APPROVED cho CTV đã tự cộng. (4) P3 /nhan-vien First Load +3 KB: cắt về ≤ +2 KB hoặc ghi số từng chunk. Đụng tiền: chạy lại race module affiliate/wallet trên Postgres nhúng cổng 35740 và jest API.',
  diemxanh: 'Theo review cuối trong reviews/diemxanh-c.md: (1) P3 tierKeepGap (số "còn thiếu" trong tin báo hạ hạng và dòng giữ hạng): tính trên khung 12 tháng kết thúc ở ngày hết hạn giữ hạng (đơn giao thành công trong [until−12 tháng, now] được tính), không trên khung trượt từ hôm nay; test có đơn rơi ra khỏi khung. Đây là chữ gửi khách, phải đúng. (2) P3 ZNS lỗi sau khi tin trong app đã lưu: không tính là đã báo; đêm sau thử lại ZNS mà KHÔNG gửi lại tin trong app (đánh dấu riêng cho ZNS hoặc dedupe theo kênh); test. (3) P3 khung chờ web loyalty/game khác Mini: GHI BACKLOG. (4) Ngày chuyển đổi chuỗi (khách N6 cũ, chuỗi nước 1): KHÔNG đổi, ghi trong báo cáo để người giao báo chủ. Đụng điểm/tin khách: chạy race loyalty/game/notification trên Postgres nhúng cổng 35730 và jest API.',
}

const review = (p, round, workerReport, prev) => `Bạn là reviewer đối kháng (PM + Tech Lead) cho gói ${p.g} của đợt review Tubu Tree 2026-10-28. Lượt review ${round}. Chỉ đọc, không sửa file, không commit, không bật server.
Worktree: ${ROOT}/r1028-${p.g}, nhánh review/1028-${p.g}. Diff: \`git -C ${ROOT}/r1028-${p.g} diff ${BASE}..HEAD\`, lịch sử \`git -C ${ROOT}/r1028-${p.g} log --oneline ${BASE}..HEAD\`.
Mục gói: ${p.items}.
Luật riêng: ${p.rules}
Mô tả mục và bằng chứng: ${R}/20-backlog.md, ${R}/10-review-${p.group}.md. Luật chung worker: ${R}/tools/gd3-worker-brief.md. Review lượt trước của đợt A (nếu có): ${R}/reviews/${p.g}-r1.md.
Lịch sử: báo cáo worker đợt B ở ${R}/reviews/${p.g}-b.md; các lượt sửa/review đợt C ở ${R}/reviews/${p.g}-c.md.
Quyết định của người giao (không coi là lỗi): ${LEAD}
Việc người giao giao cho lượt sửa này (thiếu thì là P2, trừ mục ghi GHI BACKLOG): ${TODO[p.g]}
Báo cáo lượt sửa mới nhất:
---
${workerReport || '(không có)'}
---
${prev ? `Review lượt trước (kiểm từng phát hiện đã sửa thật chưa, rồi tìm lỗi mới):\n---\n${prev}\n---\n` : ''}Ảnh trước/sau: ${R}/screens-${p.g}/ (mở bằng Read; mỗi ảnh 4 cột: Mini trước | Mini sau | Web trước | Web sau).

Tìm lỗi thật, ưu tiên: sai tiền/điểm/giọt/hoa hồng, cộng đôi, race; đổi luật điểm/giá/phí/thể lệ/chữ pháp lý khi chưa được phép; bảo mật (SSRF, quyền, lộ dữ liệu); hồi quy chức năng; Mini App và web 375 lệch nhau (so ảnh); thiếu trạng thái tải/rỗng/lỗi; vùng chạm < 44px; chữ khó hiểu hoặc sai sự thật; test giả (assert lỏng, mock che lỗi); mục báo "đã làm" mà diff không có; vi phạm luật hai nền tảng (logic không ở app-core, thiếu route-map, gọi zmp-sdk/window trong app-core); migration không chỉ-thêm. Được chạy test đơn lẻ (vitest/jest một file) để chứng minh.

Trả về (tối đa 40 dòng): dòng đầu đúng một trong hai: "KẾT LUẬN: merge được" hoặc "KẾT LUẬN: chưa merge" (còn P0/P1/P2 nào thì là chưa merge). Rồi danh sách "[P0|P1|P2|P3] file:dòng — vấn đề — cách sửa". Không khen.`

const fix = (p) => `Đọc trước và tuân thủ: ${R}/tools/gd3-worker-brief.md.
Gói: ${p.g}. Worktree: ${ROOT}/r1028-${p.g}. Nhánh: review/1028-${p.g} (gốc ${BASE}). Lane ${p.lane}. Cổng: ${p.ports}. Thư mục ảnh: ${R}/screens-${p.g}/.
KHÔNG chạy tools/perf/run-all.mjs. Không push.
Mục gói: ${p.items}. Luật riêng: ${p.rules}
Quyết định của người giao: ${LEAD}

VIỆC LƯỢT NÀY: ${TODO[p.g]}

Ngoài ra sửa mọi P0/P1/P2 còn lại trong review cuối của ${R}/reviews/${p.g}-c.md (đọc phần "## Review" cuối cùng). Viết test trước cho lỗi logic (thấy đỏ rồi sửa). Chạy lại bộ kiểm của brief cho phần đã đổi (tsc, eslint, vitest toàn bộ app đã đổi, jest API nếu đụng API, race nếu đụng tiền/điểm, Playwright như việc giao, lint:parity, vite build + bundle-report). Commit nhỏ. Dừng lane khi xong.
Trả về theo schema; report (tối đa 45 dòng): từng việc → đã làm (commit) / không làm (lý do); số kiểm thật; mục GHI BACKLOG.`

const refix = (p, rv) => `Đọc trước và tuân thủ: ${R}/tools/gd3-worker-brief.md.
Gói: ${p.g}. Worktree: ${ROOT}/r1028-${p.g}. Lane ${p.lane}. Cổng: ${p.ports}. Thư mục ảnh: ${R}/screens-${p.g}/. KHÔNG chạy run-all.mjs. Không push.
Quyết định của người giao: ${LEAD}
Reviewer Opus vừa trả:
---
${rv}
---
Sửa MỌI P0, P1, P2; P3 sửa nếu rẻ, không thì ghi "GHI BACKLOG" kèm lý do. Test trước cho lỗi logic. Chạy lại bộ kiểm cho phần đã đổi. Commit nhỏ. Dừng lane khi xong.
Trả về theo schema; report tối đa 40 dòng.`

const OUT = {
  type: 'object',
  properties: { head: { type: 'string' }, report: { type: 'string' } },
  required: ['head', 'report'],
}
const ok = (t) => typeof t === 'string' && /KẾT LUẬN:\s*merge được/i.test(t.split('\n').slice(0, 3).join(' '))
const ORDER = ['doirac', 'quantri', 'khampha', 'muahang', 'hieunang', 'ctv', 'diemxanh']
const sel = PKGS.filter((p) => ORDER.includes(p.g) && (!(args && args.only) || args.only.includes(p.g)))

const results = await pipeline(sel, async (p) => {
  const rounds = []
  let w = await agent(fix(p), { label: `d-fix1-${p.g}`, phase: 'Sửa', schema: OUT, agentType: 'worker' })
  let rv = await agent(review(p, 'D1', w ? w.report : null, null), { label: `d-rv1-${p.g}`, phase: 'Review', agentType: 'reviewer' })
  rounds.push({ fix: w, review: rv })
  let n = 1
  while (!ok(rv) && n < MAX_FIX) {
    n++
    w = await agent(refix(p, rv), { label: `d-fix${n}-${p.g}`, phase: 'Sửa', schema: OUT, agentType: 'worker' })
    rv = await agent(review(p, 'D' + n, w ? w.report : null, rv), { label: `d-rv${n}-${p.g}`, phase: 'Review', agentType: 'reviewer' })
    rounds.push({ fix: w, review: rv })
  }
  return { g: p.g, mergeable: ok(rv), rounds }
})
return results
