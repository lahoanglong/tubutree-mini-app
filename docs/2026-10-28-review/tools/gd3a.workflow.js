export const meta = {
  name: 'review-1028-gd3a',
  description: 'GĐ3 đợt A: 5 gói không chờ chủ (doirac, taikhoan, diemxanh, ctv, quantri): worker Sonnet làm, reviewer Opus review đối kháng',
  phases: [
    { title: 'Làm', detail: 'worker mỗi gói một worktree' },
    { title: 'Review', detail: 'reviewer Opus đối kháng từng gói' },
  ],
}

const ROOT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees'
const R = ROOT + '/review-1028/docs/2026-10-28-review'
const BASE = '1384ff3804ee1ce28cab06f0c2bb0230fb138f9b'

const PKGS = [
  { g: 'doirac', lane: 1, ports: '3710–3719 (e2e API 3711, web 3712, Mini App 3713, gate PG 3714, gate Redis 3715), race Postgres 35710', group: 'DR (và KP cho R-1)',
    items: 'R-1 (chỉ phần mã: kiểm go-live cảnh báo khi chính sách còn bản nháp; nội dung chính sách là việc của chủ, KHÔNG viết chữ pháp lý), R-11, R-46, R-47, R-48, R-49, R-50, R-51, R-52, R-53 (trừ dòng Học viện ở profile.tsx: gói taikhoan làm), R-54, R-55, R-56, R-128, R-129',
    note: 'R-11: chặn bật `waste.enabled` (API quản trị + go-live) khi thể lệ trống; KHÔNG tự viết thể lệ. R-86 (bật cờ PROD) không thuộc gói. Chat CSKH giữ nguyên cơ chế cờ.' },
  { g: 'taikhoan', lane: 3, ports: '3720–3729 (e2e API 3721, web 3722, Mini App 3723, gate PG 3724, gate Redis 3725), race Postgres 35720', group: 'DH',
    items: 'R-9, R-33, R-34, R-35, R-36, R-107, R-108, R-109, R-110, R-111, R-113, R-115, và dòng Học viện ở trang Cá nhân của R-53',
    note: 'R-9: hiện ngày giao dự kiến ở chi tiết đơn tính từ cấu hình `shipping.eta_*` khi có; cấu hình trống thì ẩn dòng (không bịa ngày). KHÔNG làm ô "Định kỳ" của R-30 (thuộc gói muahang). B-151 (giờ Mini App theo giờ Việt Nam) làm nếu nằm trong `utils/format.ts`.' },
  { g: 'diemxanh', lane: 4, ports: '3730–3739 (e2e API 3731, web 3732, Mini App 3733, gate PG 3734, gate Redis 3735), race Postgres 35730', group: 'DX',
    items: 'R-10, R-37 (chỉ phần bỏ nút điểm danh trùng), R-38, R-39, R-40, R-41, R-42 (chỉ phần hiện dòng giữ hạng từ `tierGraceUntil`), R-43, R-44, R-45, R-117, R-118, R-119, R-120, R-123, R-124, R-126, R-127, và phần Điểm Xanh của R-24',
    note: 'KHÔNG gộp hai chuỗi điểm danh, KHÔNG thêm tin Zalo OA, KHÔNG đổi số điểm/giọt/giá quà: chờ chủ. R-10 chỉ sửa chữ hiển thị cho khớp số thật đã cộng (đọc kỹ game-economy.service.ts và daily-check-in.service.ts để biết số nào là thật; có test). R-39: chỉ cảnh báo trong hộp xác nhận khi quà freeship thừa với hạng của khách, không khoá, không đổi giá. R-44: web /hoan-tien làm như Mini App khi cờ hoàn tiền tắt.' },
  { g: 'ctv', lane: 7, ports: '3740–3749 (e2e API 3741, web 3742, Mini App 3743, gate PG 3744, gate Redis 3745), race Postgres 35740', group: 'CT',
    items: 'R-12 (chỉ phần hiển thị), R-57, R-58, R-59, R-60, R-61, R-62, R-63 (chỉ điền sẵn tên và SĐT), R-64, R-65, R-66, R-67, R-137, R-139, R-141, R-142',
    note: 'R-12: số to là "Có thể chuyển vào Ví"; hoa hồng đang chờ là dòng phụ có chữ "đang chờ"; ô "Chuyển vào Ví" mờ phải nói lý do; KHÔNG tự chuyển hoa hồng vào Ví, KHÔNG đổi cách tính. R-63: KHÔNG thêm hay sửa chữ pháp lý về CCCD. R-67: trong Mini App mọi link chia sẻ (sao chép, lời đăng gợi ý, QR) dùng link Mini App, web giữ link web.' },
  { g: 'quantri', lane: 8, ports: '3750–3759 (e2e API 3751, web 3752, Mini App 3753, gate PG 3754, gate Redis 3755), race Postgres 35750', group: 'QT',
    items: 'R-13, R-68, R-69, R-70, R-71, R-72, R-73, R-74, R-75, R-144, R-145, R-146, R-147, R-148, R-149',
    note: 'R-68: số "người dùng" và danh sách mặc định chỉ đếm tài khoản thật; khách vãng lai tách thành số riêng; không xoá dữ liệu. R-74: trang đầu admin "Hôm nay" bản gọn: đơn, doanh thu, khách mới trong ngày và 7 ngày, tỉ lệ khách mua lại 30 ngày, và hộp việc đang chờ; menu thêm nhóm "Hay dùng" có số việc chờ. Giữ quyền theo vai trò như hiện tại. Chỉ chụp admin1280 và admin375 (không có Mini App, trừ màn kiểm duyệt cộng đồng Mini App).' },
]

const OUT = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    head: { type: 'string', description: 'hash commit cuối' },
    report: { type: 'string', description: 'báo cáo theo mẫu trong brief, tối đa 40 dòng' },
  },
  required: ['branch', 'head', 'report'],
}

const work = (p) => `Đọc trước và tuân thủ: ${R}/tools/gd3-worker-brief.md (luật chung, cách kiểm, cách chụp ảnh trước/sau).

Gói: ${p.g}. Worktree: ${ROOT}/r1028-${p.g} (đã cài thư viện, prisma generate xong). Nhánh: review/1028-${p.g} (dựng từ ${BASE}).
Lane chụp ảnh: lane ${p.lane} (cổng 32${p.lane}1–32${p.lane}8, Redis db ${p.lane}, DB tubutree_uat_l${p.lane}). Cổng khác: ${p.ports}.
Thư mục ảnh của gói: ${R}/../2026-10-28-review/screens-${p.g}/ (tức ${ROOT}/review-1028/docs/2026-10-28-review/screens-${p.g}/).

Mục phải làm (xem bảng và mục "## Gói" trong ${R}/20-backlog.md; bằng chứng ở ${R}/10-review-${p.group.split(' ')[0]}.md): ${p.items}.
Ràng buộc riêng: ${p.note}

Làm xong, chạy đủ bộ kiểm trong brief, chụp ảnh trước/sau và tự xem. Trả về theo schema; report theo mẫu "Báo cáo trả về" của brief.`

const review = (p, w) => `Bạn là reviewer đối kháng (PM + Tech Lead) cho gói ${p.g} của đợt review Tubu Tree 2026-10-28. Chỉ đọc, không sửa file, không commit.
Worktree: ${ROOT}/r1028-${p.g}, nhánh review/1028-${p.g}. Diff cần xem: \`git -C ${ROOT}/r1028-${p.g} diff ${BASE}..HEAD\` (và \`git log ${BASE}..HEAD\`).
Mục gói phải làm: ${p.items}. Ràng buộc: ${p.note}
Mô tả mục và bằng chứng: ${R}/20-backlog.md, ${R}/10-review-${p.group.split(' ')[0]}.md. Luật chung worker: ${R}/tools/gd3-worker-brief.md.
Báo cáo của worker:
---
${w ? w.report : '(worker không trả báo cáo)'}
---
Ảnh trước/sau của gói: ${ROOT}/review-1028/docs/2026-10-28-review/screens-${p.g}/ (mở xem bằng Read).

Tìm lỗi thật, ưu tiên: sai tiền/điểm/giọt/hoa hồng; đổi luật điểm/giá/phí/thể lệ/chữ pháp lý khi chưa được phép; hồi quy chức năng; quyền truy cập; Mini App và web 375 lệch nhau (so ảnh); thiếu trạng thái tải/rỗng/lỗi; vùng chạm < 44px; chữ khó hiểu; test giả (không thấy đỏ trước khi sửa, assert lỏng); mục báo "đã làm" mà diff không có; vi phạm luật hai nền tảng (logic không ở app-core, thiếu route-map, gọi zmp-sdk/window trong app-core). Có thể chạy test đơn lẻ để chứng minh (vitest/jest một file), không chạy cả bộ, không bật server.

Trả về (tối đa 40 dòng): dòng đầu "KẾT LUẬN: merge được" hoặc "KẾT LUẬN: chưa merge"; rồi danh sách phát hiện dạng "[P0|P1|P2|P3] file:dòng — vấn đề — cách sửa". Không khen.`

phase('Làm')
const results = await pipeline(
  PKGS,
  (p) => agent(work(p), { label: `lam-${p.g}`, phase: 'Làm', schema: OUT, agentType: 'worker' }),
  (w, p) => agent(review(p, w), { label: `review-${p.g}`, phase: 'Review', agentType: 'reviewer' }).then((r) => ({ g: p.g, worker: w, review: r })),
)
return results
