export const meta = {
  name: 'review-1028-gd3b',
  description: 'GĐ3 đợt B: 8 worker Sonnet (sửa lượt 2 cho 5 gói đợt A kèm quyết định của chủ; làm mới khampha, muahang, hieunang)',
  phases: [{ title: 'Làm', detail: '8 worker, mỗi gói một worktree' }],
}

const ROOT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees'
const R = ROOT + '/review-1028/docs/2026-10-28-review'
const BASE = '1384ff3804ee1ce28cab06f0c2bb0230fb138f9b'
const OUT = {
  type: 'object',
  properties: { branch: { type: 'string' }, head: { type: 'string' }, report: { type: 'string', description: 'mẫu "Báo cáo trả về" của brief, tối đa 50 dòng' } },
  required: ['branch', 'head', 'report'],
}
const PRE = (g, lane, ports) => `Đọc trước và tuân thủ: ${R}/tools/gd3-worker-brief.md (luật chung, bộ kiểm, cách chụp ảnh trước/sau).
Gói: ${g}. Worktree: ${ROOT}/r1028-${g} (đã cài thư viện, prisma generate xong). Nhánh: review/1028-${g} (gốc ${BASE}).
Lane chụp ảnh: lane ${lane} (cổng 32${lane}1–32${lane}8${lane === 9 ? ', Redis db 15, DB tubutree_uat_l9; KHÔNG chạy build-template.sh' : `, Redis db ${lane}, DB tubutree_uat_l${lane}`}). Cổng khác: ${ports}.
Thư mục ảnh của gói: ${R}/screens-${g}/.
KHÔNG chạy \`tools/perf/run-all.mjs\` (cổng 3601/3603/3611 dùng chung; người giao việc tự đo trước/sau sau khi bạn xong). Vẫn chạy bundle-report.mjs và ghi số.
`
const ROUND2 = (g) => `Đây là LƯỢT 2. Đọc ${R}/reviews/${g}-r1.md (báo cáo lượt 1 và review Opus). Sửa MỌI phát hiện P1, P2; P3 sửa nếu rẻ, còn lại ghi rõ "không làm" kèm lý do. Mục báo "đã làm" mà review nói thiếu thì làm cho đủ hoặc ghi lại là MỘT PHẦN. Chạy lại đủ bộ kiểm (kể cả phần lượt 1 chưa chạy), chụp lại ảnh các màn đã đổi ở lượt này.
`

const JOBS = [
  { g: 'doirac', lane: 1, ports: '3710–3719 (e2e API 3711, web 3712, Mini App 3713, gate PG 3714, gate Redis 3715), race Postgres 35710', body: ROUND2('doirac') + `Mục gói: R-1 (phần mã), R-11, R-46…R-56, R-128, R-129 (xem lượt 1). R-54 khung chờ Mini làm theo cách không tăng entry (vd skeleton nằm trong chunk lazy của trang). Mã tỉnh 84_VN79 và 79: chuẩn hoá ở API (waste-fee) bằng cùng hàm của app-core, go-live kiểm có vùng chứa tỉnh của kho đang hoạt động.` },
  { g: 'taikhoan', lane: 3, ports: '3720–3729 (e2e API 3721, web 3722, Mini App 3723, gate PG 3724, gate Redis 3725), race Postgres 35720', body: ROUND2('taikhoan') + `Ngày giao dự kiến: ẩn khi ngày max đã qua theo ngày VN và khi đơn có món đặt trước; tính mốc từ cùng gốc với màn thanh toán (createdAt) cho khớp. Đơn của gian hàng đối tác (fulfilment MERCHANT): ẩn dòng dự kiến giao. Có Playwright 375 kiểm thứ tự khối chi tiết đơn web.` },
  { g: 'quantri', lane: 8, ports: '3750–3759 (e2e API 3751, web 3752, Mini App 3753, gate PG 3754, gate Redis 3755), race Postgres 35750', body: ROUND2('quantri') + `Số trên trang Hôm nay phải dùng CÙNG định nghĩa với trang Báo cáo (doanh thu trừ hoàn một phần, cách đếm đơn, khách mới theo NEW_CUSTOMER_SQL); có integration/race test chạy SQL đó trên Postgres thật. Chạy Playwright admin (web-gate các spec admin) và jest API toàn bộ sau sửa.` },
  { g: 'ctv', lane: 7, ports: '3740–3749 (e2e API 3741, web 3742, Mini App 3743, gate PG 3744, gate Redis 3745), race Postgres 35740', body: ROUND2('ctv') + `THÊM (chủ đã duyệt 28/10): HOA HỒNG CTV ĐÃ DUYỆT TỰ VÀO VÍ TUBU. Đây là tiền: làm cực kỳ cẩn thận.
- Tìm chỗ hoa hồng chuyển LOCKED → APPROVED (sau hold_days) và hàm "Chuyển vào Ví" hiện có (affiliate.service.ts quanh dòng 1140–1260: idempotency, kiểm available, khấu trừ TNCN nếu có, ghi sổ Ví).
- Tự chuyển phải đi qua ĐÚNG đường đó (cùng khấu trừ, cùng bút toán, cùng giới hạn), không viết đường ghi tiền thứ hai. Chạy theo cron sau bước duyệt (hoặc ngay sau khi duyệt), mỗi CTV có available > 0 thì chuyển toàn bộ; khoá idempotency xác định theo tập commission (chạy lại không cộng hai lần); CTV bấm tay cùng lúc với cron thì chỉ cộng một lần.
- Cấu hình bật/tắt \`affiliate.auto_wallet_transfer_enabled\` mặc định bật (theo cách các khoá cấu hình khác được khai báo và nạp), tắt thì giữ hành vi cũ (bấm tay).
- Báo CTV bằng thông báo trong app "Đã cộng …đ hoa hồng vào Ví Tubu" (dùng hệ thống thông báo sẵn có).
- Nút "Chuyển vào Ví" giữ lại cho phần còn sót (cờ tắt hoặc lỗi). Chữ trên trang CTV và Ví nói đúng hành vi mới.
- Test trước: unit (chạy lại không cộng đôi, khấu trừ giống tay, cờ tắt không chuyển) và RACE test trên Postgres nhúng (cron và bấm tay đồng thời; hai lần cron đồng thời). Chạy race toàn bộ module affiliate/wallet.
- Không đổi tỉ lệ hoa hồng, hold_days, ngưỡng thuế. Nếu thấy cần migration thì chỉ được thêm (cột/bảng mới, nullable), ghi rõ trong báo cáo.
R-67: chuyển nốt ba chỗ còn link web trong Mini App (content-kit-sheet, product-detail link giới thiệu, profile) sang link Mini App; sửa spec tương ứng.` },
  { g: 'diemxanh', lane: 4, ports: '3730–3739 (e2e API 3731, web 3732, Mini App 3733, gate PG 3734, gate Redis 3735), race Postgres 35730', body: ROUND2('diemxanh') + `THÊM (chủ đã duyệt 28/10), đụng điểm và nước nên test kỹ và chạy race:
1. GỘP HAI CHUỖI ĐIỂM DANH: chu kỳ Điểm Xanh N1–N7 (Ưu đãi, Hạng) và chuỗi nước 1–7 (Vườn) thành MỘT chuỗi ngày duy nhất. Giữ nguyên số điểm và số giọt của từng ngày theo cấu hình hiện có; quà mốc của chuỗi nước giữ nguyên. Luật lỡ ngày và vé giữ lửa: theo luật của chuỗi nước hiện tại, áp cho cả chuỗi chung. Chuyển đổi: ngày hiện tại của mỗi khách = ngày của chuỗi nước; không ai mất phần đã nhận hôm nay, không ai được nhận hai lần trong ngày chuyển. API trả một \`streakDay\` dùng chung; Ưu đãi, Hạng, Vườn hiện một lịch 7 ngày như nhau (Mini App và web). Migration chỉ được thêm (cột/bảng nullable) nếu thật cần. Báo cáo phải có bảng "trước/sau" cho khách: ngày nào nhận gì, lỡ ngày thì sao, để chủ đọc.
2. TIN BÁO TRƯỚC KHI HẠ HẠNG: cron hằng ngày tìm khách có \`tierGraceUntil\` còn ≤ N ngày (cấu hình \`loyalty.tier_drop_notice_days\`, mặc định 14), chưa được báo trong kỳ giữ hạng này; gửi thông báo trong app (luôn) và ZNS qua \`apps/api/src/modules/integrations/zns\` khi cấu hình mã mẫu ZNS (khoá mới, trống thì bỏ qua ZNS). Nội dung: hạng hiện tại, ngày hết hạn giữ hạng, số tiền đơn giao thành công còn thiếu. Không gửi hai lần cho một kỳ (đánh dấu đã gửi; migration chỉ thêm). Tôn trọng khách đã tắt thông báo nếu hệ thống có cờ đó. Test cron (không gửi trùng, đúng ngưỡng ngày VN).` },
  { g: 'khampha', lane: 2, ports: '3760–3769 (e2e API 3761, web 3762, Mini App 3763, gate PG 3764, gate Redis 3765), race Postgres 35760', body: `Đây là LƯỢT 1. Mục gói (bảng và mục "## Gói" trong ${R}/20-backlog.md; bằng chứng ${R}/10-review-KP.md, ${R}/10-review-TL.md): R-2, R-3, R-4, R-14, R-15, R-16, R-17, R-18, R-19, R-20, R-21, R-87, R-88, R-89, R-90, R-91.
CHỦ ĐÃ CHỐT R-3/R-4 (28/10): màn đầu Trang chủ gọn, món hàng lên đầu, Mini App và web như nhau:
- ô tìm kiếm dính đầu trang khi cuộn (Trang chủ và Danh mục), giữ lịch sử và gợi ý;
- thẻ thành viên gọn một dòng (lời chào + hạng + điểm, nút Điểm danh), bấm mở Điểm Xanh;
- khối việc cần làm (đơn chờ thanh toán, đơn đang giao/đang chuẩn bị) giữ, gọn;
- MỘT hàng lối tắt cuộn ngang: thêm "Đơn hàng", bỏ ô trùng thanh đáy (Vườn Xanh, Ưu đãi nếu trùng), giữ Đổi quà, Đổi rác (khi cờ bật), Mua chung, Mã của tôi, Kiếm tiền, Tích điểm đơn sàn (khi cờ bật), Cộng đồng;
- món hàng (Mua lại cho khách cũ, Giờ vàng hoặc Bán chạy cho khách mới) phải nằm trong màn đầu 812px (trừ 90px thanh Zalo);
- TẮT khảo sát lúc mở app (không phủ màn chào); bong bóng "Trồng cây mỗi ngày" không che nội dung (hiện một lần, tự tắt, không đè thanh đáy hay lưới);
- thanh đáy giữ nguyên;
- web 1280 dùng hết bề ngang (không bỏ trống nửa phải).
R-2 (CLS): mọi khối giữ chỗ khi đang tải, không đổi thứ tự khối sau khi biết loại khách; mục tiêu CLS < 0,1. Người giao việc sẽ tự đo trước/sau bằng run-all; bạn kiểm bằng ảnh slow5s/loading và một phép đo đơn giản (PerformanceObserver layout-shift trong Playwright) nếu làm được ở cổng của gói.
File chung: \`packages/app-core/src/home-layout.ts\` thuộc gói này. Không sửa file của gói khác (xem mục Gói).` },
  { g: 'muahang', lane: 6, ports: '3770–3779 (e2e API 3771, web 3772, Mini App 3773, gate PG 3774, gate Redis 3775), race Postgres 35770', body: `Đây là LƯỢT 1. Mục gói (bảng và "## Gói" trong ${R}/20-backlog.md; bằng chứng ${R}/10-review-MH.md, ${R}/10-review-TL.md): R-6, R-7, R-8, R-22, R-23, R-24, R-25, R-26, R-27, R-28, R-29, R-30, R-31, R-96, R-97, R-103, R-104, R-105. KHÔNG làm R-32 (chữ chính sách, chờ chủ).
CHỦ ĐÃ CHỐT (28/10):
- R-6: SP có từ 2 phân loại: bấm Thêm vào giỏ hoặc Mua ngay mở bottom sheet chọn phân loại (ảnh nếu có, tên, giá, tồn kho, số lượng, nút xác nhận) như Shopee; SP 1 phân loại thêm thẳng như hiện tại. Mini App dùng Sheet của zmp-ui, web dùng sheet có sẵn trong \`apps/web/src/components/mini/**\` (chỉ dùng, không sửa). Logic chọn (phân loại còn hàng, giá Giờ vàng, tồn kho) ở app-core, có test.
- R-31: WELCOME30 chỉ cho khách chưa có đơn: bảng Coupon đã có cột \`newCustomerOnly\` (schema.prisma ~1377, kiểm ở common/first-order.ts). Đặt \`newCustomerOnly = true\` cho WELCOME30 bằng migration dữ liệu nhỏ (chỉ UPDATE theo code, idempotent) và trong seed; khách đã có đơn không thấy mã này ở trang SP và thanh toán. KHÔNG đổi FREESHIP, giá trị mã hay ngưỡng.
- R-28: ẩn dòng Ví Tubu khi số dư 0đ; KHÔNG làm trả một phần bằng Ví (gói Zalo Checkout sau).
- R-8: Mini App có nút lưu mã QR vào máy (qua PlatformBridge, không gọi zmp-sdk trong app-core), web hiện lại nút "Lưu mã QR" ở khổ điện thoại; câu hướng dẫn nói rõ "lưu ảnh rồi mở app ngân hàng chọn ảnh QR".
\`packages/app-core/src/features.ts\` thuộc gói này. Không tạo loading.tsx/error.tsx (gói hieunang làm).` },
  { g: 'hieunang', lane: 9, ports: '3780–3789 (e2e API 3781, web 3782, Mini App 3783, gate PG 3784, gate Redis 3785), race Postgres 35780', body: `Đây là LƯỢT 1. Mục gói (bảng và "## Gói" trong ${R}/20-backlog.md; bằng chứng và mục tiêu số ở ${R}/10-review-TL.md, ${R}/03-perf-*.md, ${R}/perf/baseline.json): R-5, R-76, R-77, R-78, R-79, R-80, R-81, R-82, R-83, R-84, R-85. BỎ bước cuối lazy 3 khối ở home.tsx và tách vi.ts (làm sau khi các gói khác gộp).
CHỦ ĐÃ CHỐT R-5 (28/10): API tự đổi cỡ ảnh sản phẩm bằng sharp (sharp 0.35.5 đã có trong pnpm-lock, thêm vào dependencies của apps/api đúng phiên bản đó), lưu bản nhỏ trên đĩa:
- Endpoint đổi cỡ: chỉ nhận ảnh từ danh sách host cho phép (Pancake CDN, Cloudinary, ảnh của chính API; đọc cấu hình hiện có) để chống SSRF; chặn IP nội bộ và chuyển hướng; giới hạn kích thước tải về, thời gian, độ phân giải; chỉ các bề rộng cố định (vd 160, 320, 640, 960); ra webp (giữ jpeg nếu client không nhận webp); Cache-Control dài (immutable) và ETag.
- Thư mục cache cấu hình bằng biến môi trường (mặc định thư mục tạm trong container), có giới hạn dung lượng hoặc dọn theo tuổi; ghi rõ trong báo cáo việc deploy cần làm (volume hay không). Không đổi file docker-compose PROD.
- Mini App và web: thẻ SP, thumbnail, ảnh chi tiết dùng URL đổi cỡ đúng bề rộng hiển thị (srcset 1x/2x), có width/height hoặc aspect-ratio để không nhảy bố cục; ảnh lỗi rơi về hình lá như hiện tại.
- Test: unit cho chọn URL, chống SSRF (host lạ, IP nội bộ, redirect), giới hạn kích thước; e2e một ảnh mẫu.
Các mục còn lại: web loading.tsx/error.tsx theo segment chính (san-pham, san-pham/[slug], thanh-toan, tai-khoan) với khung chờ đúng hình màn; Mini App error boundary theo route có nút Thử lại; RouteFallback là khung chờ thay spinner; tải trước route hay dùng; staleTime hợp lý và không retry lỗi 4xx; Bán chạy không nạp cả catalog (R-81; nếu cần cột mới thì migration chỉ thêm); \`/cart\` ≤ 8 câu SQL và giảm \`/home/me\` (đếm bằng \`tools/perf/prisma-query-log.cjs\` như agent đo đã làm, ghi số trước/sau); mất mạng báo "Mất kết nối mạng" thay "Máy chủ đang bận" (R-85); entry Mini App giảm về ≤ 600 KB nếu làm được mà không đụng vi.ts.` },
]

phase('Làm')
const res = await parallel(JOBS.map((j) => () =>
  agent(PRE(j.g, j.lane, j.ports) + '\n' + j.body + '\n\nTrả về theo schema.', { label: `b-${j.g}`, phase: 'Làm', schema: OUT, agentType: 'worker' })
    .then((w) => ({ g: j.g, worker: w }))
))
return res
