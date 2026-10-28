export const meta = {
  name: 'review-1028-gd1b',
  description: 'GĐ1b review 2026-10-28: 8 nhóm chấm màn 1–5 và phát hiện, rồi 1 agent dựng nháp findings + backlog + gói',
  phases: [
    { title: 'Chấm màn', detail: '8 nhóm PM/Design/Tech lead' },
    { title: 'Tổng hợp nháp', detail: '10-findings.md, 20-backlog.md, chia gói' },
  ],
}

const W = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028'
const R = W + '/docs/2026-10-28-review'
const PRE = `Đọc trước và tuân thủ: ${R}/tools/gd1b-review-brief.md (vai, tiêu chí chấm, mức, định dạng đầu ra). R/ = ${R}. Chỉ đọc mã và ảnh; không sửa gì ngoài file được giao; không chạy server, không ghi DB.\n\n`

const GROUPS = [
  { code: 'KP', name: 'Khám phá: trang chủ, thanh đáy, tìm kiếm, danh mục, nhãn hàng, khách mới lần đầu',
    keys: 'home, browse, browse-category, browse-brand, browse-search, brand-slug, brand-story, about, 404, dang-nhap',
    extra: 'Luồng 1 (khách mới) trong R/06-luong-mini.md và R/06-luong-web.md, ảnh R/screens/flows/*/ (thư mục luồng 1). Bản đồ lối vào và mẫu R/05-loi-vao-va-mau.md (mục A, C). Ảnh ghép R/screens/pairs/. Persona returning, new, guest đều chấm. Xét riêng: thanh đáy, bong bóng mẹo nổi, màn chào/khảo sát, trang chủ 1280.' },
  { code: 'MH', name: 'Mua hàng: chi tiết SP, phân loại, giỏ, thanh toán, chuyển khoản, yêu thích, mua chung, gói định kỳ',
    keys: 'product-slug, cart, checkout, bank-payment-code, wishlist, group-buy, group-buy-id, subscriptions',
    extra: 'Luồng 2 (tìm và mua) trong R/06-luong-*.md và ảnh flows. Mẫu Shopee mục B trong R/05-loi-vao-va-mau.md. Backlog cũ B-152 (thanh toán web 375 lệch Mini App), B-154. Hiệu năng thanh toán web (CLS 0,313, LCP 2,9 s) trong R/03-perf-runtime.md.' },
  { code: 'DH', name: 'Đơn hàng và tài khoản: danh sách đơn, chi tiết đơn/theo dõi, mua lại, Cá nhân, hồ sơ, cài đặt, địa chỉ, thông báo, chính sách',
    keys: 'orders, order-code, profile, edit-profile, settings, addresses, notifications, chinh-sach-dieu-khoan, chinh-sach-bao-mat, chinh-sach-doi-tra, chinh-sach-van-chuyen',
    extra: 'Luồng 3 (theo dõi đơn và mua lại) trong R/06-luong-*.md và ảnh flows. Mẫu Grab dòng thời gian đơn có mốc dự kiến; mẫu Shopee tab cá nhân có hàng trạng thái đơn kèm số đếm. Backlog cũ B-148, B-151.' },
  { code: 'DX', name: 'Điểm Xanh, hạng, Ưu đãi, kho quà, mã của tôi, Vườn Xanh, điểm danh, tích điểm đơn sàn, hoàn tiền',
    keys: 'loyalty, offers, rewards, rewards-mine, game, points-scan, cashback',
    extra: 'Luồng 4 trong R/06-luong-*.md và ảnh flows. Mẫu Grab: điểm và hạng hiện rõ tiến độ lên hạng; phản hồi tức thì. Không đổi luật điểm (chỉ đề xuất, ghi cần chủ quyết). Backlog cũ B-150.' },
  { code: 'DR', name: 'Đổi rác lấy quà, chat CSKH, cộng đồng, học viện, trợ lý AI',
    keys: 'recycle, recycle-rules, recycle-new, recycle-points, recycle-r-id, recycle-r-id-edit, recycle-requests, recycle-done-id, chat, feed, feed-leaderboard, feed-events, feed-id, academy, academy-courseid, ai-advisor',
    extra: 'Luồng 5 (đổi rác) trong R/06-luong-*.md và ảnh flows. Trên PROD đổi rác và chat đang TẮT bằng cờ: đánh giá cả việc khách có thấy lối vào hay không khi cờ tắt, và đề xuất (cần chủ quyết) có bật không.' },
  { code: 'CT', name: 'CTV, gian hàng, hoa hồng, Ví Tubu, đại lý, merchant, nhân viên, chủ nhãn',
    keys: 'affiliate, storefront, s-slug, dealer, wallet, merchant, staff, my-payroll, brand-owner',
    extra: 'Luồng 6 trong R/06-luong-*.md và ảnh flows. Persona ctv, ctv_pending, dealer, staff, brand. Backlog cũ B-153.' },
  { code: 'QT', name: 'Quản trị: các màn chủ dùng hằng ngày',
    keys: 'admin1280 và admin375 của: tab-inbox, tab-dashboard, tab-orders, tab-merchantProducts, tab-productCategories, tab-users, tab-waste, tab-supportChat, tab-coupons, tab-dealers, tab-storefronts; thêm admin, admin-community, recycle-desk',
    extra: 'Chủ dùng admin hằng ngày trên máy tính và điện thoại. Tiêu chí: tìm việc cần làm hôm nay nhanh, ít chữ kỹ thuật, ô ngày đúng định dạng Việt Nam, bảng đọc được ở 375. R/01-chup-web.md có phần admin.' },
  { code: 'TL', name: 'Tech lead: hiệu năng và độ bền toàn app',
    keys: 'mọi KEY_SCREENS ở các trạng thái loading, slow5s, error500, offline, empty, longtext (Mini App và web 375); mini1280 và web1280 của trang chủ, danh sách, chi tiết SP',
    extra: 'Đọc R/01-chup-mini.md, R/01-chup-web.md, R/03-perf-build.md, R/03-perf-runtime.md, R/04-quet-tinh.md và R/perf/baseline.json. Ở đây chấm cột Nhanh và Bền cho từng KEY_SCREEN (hai cột còn lại để trống). Phát hiện phải có số đo trước. Xét: CLS trang chủ Mini App 0,46–0,83, web 0,42, thanh toán 0,31; entry Mini App 711 KB (mục tiêu 450); ảnh SP không đổi cỡ (69–777 KB); staleTime; /home/me và /cart 18–26 câu SQL; web không có loading.tsx và error.tsx theo segment; câu offline nói "Máy chủ đang bận"; hydration mismatch product-slug guest web375; 403/404 console (academy, storefront/me, brand/owner/me). Đề xuất gói hiệu năng có mục tiêu số cụ thể và cách đo (lệnh trong R/tools/perf/).' },
]

const OUT = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    counts: { type: 'object', properties: { P0: { type: 'number' }, P1: { type: 'number' }, P2: { type: 'number' }, P3: { type: 'number' } }, required: ['P0', 'P1', 'P2', 'P3'] },
    summary: { type: 'string', description: 'tối đa 20 dòng' },
  },
  required: ['file', 'counts', 'summary'],
}

phase('Chấm màn')
const reviews = await parallel(GROUPS.map((g) => () =>
  agent(PRE + `Nhóm ${g.code}: ${g.name}.\nMàn (khoá trong R/tools/routes.json): ${g.keys}.\n${g.extra}\n\nGhi DUY NHẤT \`R/10-review-${g.code}.md\`. Xem ảnh mini375 và web375 (s1, s2 nếu có) của từng màn với persona phù hợp, web1280 và mini1280 khi có, và các ảnh trạng thái nếu màn thuộc KEY_SCREENS. Đọc mã để chỉ đúng file:dòng. Trả về theo schema.`,
    { label: `cham-${g.code}`, phase: 'Chấm màn', schema: OUT, model: 'opus' })
))
const done = reviews.filter(Boolean)
log(`${done.length}/${GROUPS.length} nhóm xong`)

phase('Tổng hợp nháp')
const SYN = `Bạn là PM + Tech Lead tổng hợp. R/ = ${R}. Đọc ${R}/tools/gd1b-review-brief.md (mục tiêu, mức). Đọc các báo cáo nhóm R/10-review-*.md (${done.map((d) => d.file).join(', ')}), cùng R/05-loi-vao-va-mau.md, R/06-luong-mini.md, R/06-luong-web.md, R/03-perf-build.md, R/03-perf-runtime.md, R/04-quet-tinh.md. Backlog cũ: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/ux-review/docs/2026-10-25-ux-review/20-backlog.md (mục còn mở B-130, B-147 đến B-155; B-155 là việc deploy, chỉ ghi nhận).

Ghi ba file (Write hoặc Bash heredoc), không sửa file khác:

1. \`R/10-findings.md\`: tóm tắt cho chủ (≤ 12 dòng, điều tệ nhất trước), bảng điểm trung bình 1–5 theo màn chính (Mini App và web 375, năm tiêu chí, lấy từ báo cáo nhóm), đối chiếu ba mục tiêu (2 chạm; mỗi màn một hành động, 44px, trạng thái, token, web=Mini App; không màn trắng/console/boundary/thử lại), bảng mẫu Shopee/Grab: màn nào thiếu mẫu nào.
2. \`R/20-backlog.md\`: gộp trùng giữa các nhóm thành mục R-1, R-2… Mỗi mục: Mức P0–P3, Màn, Vấn đề, Bằng chứng (ảnh từ R/ hoặc số đo, giữ đường dẫn của báo cáo nhóm), Mẫu Shopee/Grab, Đề xuất, Công sức S/M/L, Nguồn (ID nhóm, vd KP-03), Gói. Mục cũ còn mở thì ghi kèm mã B-xx. Đánh dấu rõ mục "CẦN CHỦ QUYẾT" (bố cục trang chủ hoặc thanh đáy, đổi luồng thanh toán, kinh tế game/điểm/giá, bỏ hay thêm chức năng, bật cờ PROD). Kiểm lại mức: P0 chỉ khi đúng định nghĩa.
3. Trong \`R/20-backlog.md\` thêm mục \`## Gói\`: gom tối đa 8 gói, mỗi gói: mã ngắn (chữ thường, không dấu, dùng làm tên nhánh \`review/1028-<mã>\`), mục R-x, mức cao nhất, công sức, phạm vi FILE/THƯ MỤC (để các gói chạy song song không đụng nhau: hai gói không sửa cùng file; nếu buộc chung thì ghi thứ tự), có đụng hiệu năng không (cần số đo trước/sau), có migration không, phụ thuộc. Ghi thứ tự gộp đề xuất. Mục P3 chỉ đưa vào gói khi rẻ (S) và cùng file với mục khác; còn lại để "Sau". Mục cần chủ quyết để ở gói riêng hoặc đánh dấu chờ.

Trả về (≤ 30 dòng): số mục theo mức, danh sách P0/P1 (mã, một dòng), danh sách gói (mã, số mục, mức cao nhất), danh sách mục cần chủ quyết (mã, một dòng, phương án đề xuất).`
const syn = await agent(SYN, { label: 'tong-hop', phase: 'Tổng hợp nháp', model: 'opus' })
return { reviews: done, syn }
