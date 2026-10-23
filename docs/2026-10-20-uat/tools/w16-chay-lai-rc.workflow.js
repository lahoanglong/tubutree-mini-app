export const meta = {
  name: 'uat-w16-chay-lai-rc',
  description: 'Chạy lại UAT 6 làn (U1–U6) trên bản ứng viên uat/rc (nhánh UAT + main), tập trung ca FAIL cũ và hồi quy các script của làn; không sửa mã ứng dụng',
  phases: [{ title: 'Rerun', detail: 'một agent mỗi làn, lane riêng của bộ khung' }],
}

const ROOT = '/Users/longla/coding/tubutree-mini-app'
const RC = `${ROOT}/.claude/worktrees/uat-rc`
const UATDOCS = `${ROOT}/.claude/worktrees/uat/docs/2026-10-20-uat`
const H = `${RC}/docs/2026-10-20-uat/tools/uat-harness`

const OUT = {
  type: 'object',
  properties: {
    lane: { type: 'string' },
    commit: { type: 'string' },
    totals: { type: 'string', description: 'vd "35 lượt: 34 PASS, 1 FAIL, 0 BLOCKED" sau khi chạy lại' },
    cases: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, before: { type: 'string' }, after: { type: 'string', enum: ['PASS', 'FAIL', 'BLOCKED', 'KHÔNG CHẠY'] }, note: { type: 'string' } },
        required: ['id', 'before', 'after', 'note'],
      },
      description: 'MỌI ca FAIL/BLOCKED cũ, cộng mọi ca đổi kết quả so với lần đầu',
    },
    newBugs: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] }, problem: { type: 'string' }, evidence: { type: 'string' } }, required: ['id', 'severity', 'problem', 'evidence'] },
    },
    scriptChanges: { type: 'array', items: { type: 'string' }, description: 'file script đã sửa và vì sao (giao diện/luật đổi có chủ đích)' },
    report: { type: 'string', description: 'đường dẫn file báo cáo chạy lại đã ghi' },
  },
  required: ['lane', 'commit', 'totals', 'cases', 'newBugs', 'scriptChanges', 'report'],
}

const COMMON = `Bạn chạy lại một làn UAT trên BẢN ỨNG VIÊN PHÁT HÀNH: worktree ${RC}, nhánh cục bộ uat/rc (= nhánh UAT uat/2026-10-20 đã gộp mọi bản sửa đợt 1–6 và quyết định của chủ, cộng main 2f4dd3f7 có web giống Mini App). API dist đã build sẵn ở ${RC}/apps/api/dist. DB mẫu tubutree_uat_tpl (cụm Postgres 25432) vừa dựng lại với mọi migration mới.

Đọc trước: ${UATDOCS}/00-brief.md (luật cứng), ${H}/README.md (bộ khung lane), báo cáo lần đầu của làn bạn (đường dẫn dưới), và ${UATDOCS}/98-cau-hoi.md các mục "Chủ trả lời sáng 2026-10-20" và "Chủ trả lời 2026-10-22" (luật mới thay kỳ vọng cũ).

Luật:
- export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH. Chỉ dùng lane của bạn (cổng, DB tubutree_uat_lN, Redis db N). Bật: cd ${H} && ./lane-up.sh N --fresh [--web nếu làn cần web] (DB lane cũ copy từ mẫu cũ nên BẮT BUỘC --fresh). Script của làn nằm ở ${RC}/docs/2026-10-20-uat/uat/scripts/<thư mục làn>, chạy từ thư mục đó như mục "Chạy lại" của báo cáo lần đầu.
- KHÔNG sửa mã ứng dụng (apps/**, packages/**). Chỉ được sửa script UAT của làn bạn trong ${RC}/docs/2026-10-20-uat/uat/scripts/<làn>/ khi giao diện/luật đổi CÓ CHỦ ĐÍCH (Việt hoá, Huỷ/Xoá/Khoá, quyết định của chủ, bản sửa lỗi) làm bộ chọn hay kỳ vọng cũ sai; ghi từng sửa vào scriptChanges. Không sửa để che lỗi thật.
- Chạy lại TẤT CẢ script của làn (hồi quy), không chỉ ca FAIL. Ca BLOCKED cũ cần dịch vụ thật (Zalo thật, ZNS, Gomdon, Pancake thật, ngân hàng thật, vị trí) thì giữ BLOCKED, không cố chạy.
- Kết quả khác lần đầu: PASS → FAIL là hồi quy, phải điều tra (chạy lại 1 lần nữa loại lỗi chập chờn, xem log API ở ${H}/state/lane-N/logs, xem ảnh), ghi newBugs với bằng chứng (request/response, SQL, ảnh). FAIL cũ nay PASS: ghi ngắn bản sửa nào làm nó qua nếu biết.
- Máy dùng chung: trước bước nặng xem uptime, load > 40 thì chờ. Chỉ kill PID của mình (lane-down.sh lo việc này). Không dùng pkill.
- Xong: ./lane-down.sh N --drop. Ghi báo cáo chạy lại vào ${UATDOCS}/uat/rerun/<Ux>.md (tạo thư mục nếu chưa có): đầu file ghi commit uat/rc (git -C ${RC} rev-parse --short HEAD), lane, lệnh đã chạy, tổng ca, bảng mọi ca FAIL/BLOCKED cũ (trước → sau, ghi chú), bảng ca đổi kết quả, lỗi mới, script đã sửa. Tiếng Việt, ngắn gọn, mỗi kết luận kèm bằng chứng. Không commit gì.`

const LANES = [
  { u: 'U1', n: 1, web: false, report: 'U1-mua-hang.md', dir: 'U1-mua-hang', focus: 'FAIL cũ: U1-07 (sắp xếp theo giá dùng giá gốc; sửa c1012c39 dùng giá bán), U1-10 (giỏ có hàng hết; gói uat-gio-mini), U1-20 (chuyển bù vẫn hiện số tiền cả đơn, U1-B04; sửa c1012c39 QR đòi phần còn thiếu), U1-24 (quá hạn chuyển khoản vẫn hiện QR; 9dcc431b). Luật đổi: ngưỡng miễn phí giao thường nay 199.000đ (Q12), ảnh hưởng ca FREESHIP/phí giao. Ghi nhận U1-B03, U1-B05 từ ca PASS: xem đã sửa chưa.' },
  { u: 'U2', n: 2, web: false, report: 'U2-diem-xanh-sau-mua.md', dir: 'U2-diem-xanh-sau-mua', focus: 'FAIL cũ: U2-19b (không đổi được chu kỳ gói định kỳ): chủ chọn Q22 cho đổi chu kỳ 4/6/8/10 tuần, ngày giao kế tính lại từ đơn kỳ gần nhất (0h VN + chu kỳ, sớm nhất ngày mai); Mini App có màn Sửa gói. Luật đổi: Q1 hạng chỉ tính đơn tự mua lẻ; Q10 bậc giảm định kỳ chỉ đếm gói đã ra đơn hoặc kỳ kế trong 35 ngày; Q23 giữ tính ship khi xét hạng. Lane 2 dùng cổng 3221–3223: API UAT 3221 hiện KHÔNG chạy, nên dùng được; nếu lane-up báo cổng bận thì dùng lane 7 (3271–3278, DB tubutree_uat_l7, Redis db 7) và ghi lại.' },
  { u: 'U3', n: 3, web: false, report: 'U3-ctv-dai-ly-nhan.md', dir: 'U3-ctv-dai-ly-nhan', focus: 'FAIL cũ: U3-25 (đơn sỉ không có tối thiểu 3 triệu), U3-26 (luôn miễn ship; nay đơn đại lý dưới 5 triệu thu phí giao 19.000đ theo dealer.shipping_fee_below_threshold_vnd), U3-30 (không khoá mua chịu khi quá hạn), U3-37 (link CTV không đếm chuyển đổi: nay số chuyển đổi = số đơn đã ghi công; Mini App chỉ ghi số lượt bấm, không ghi "0 đơn"), U3-38 (đại lý nhận hộp sữa, vỏ chai: nay chỉ kho HCMC nhận). BLOCKED cũ U3-45 (ZNS thật). Luật mới: Q2 thuế TNCN cộng dồn tháng VN (ngưỡng 2 triệu, 10%), từ chối lệnh rút tự hoàn thuế giữ dư (lệnh còn Yêu cầu: tăng số thực nhận; lệnh đã duyệt/chi hoặc rút về Ví: cộng Ví dòng "Hoàn thuế TNCN giữ dư"); Q8 trả bù thưởng quý đại lý trong 60 ngày, bậc chụp theo quý. Nếu script có ca rút hoa hồng, kiểm thêm ví dụ của chủ: A 1.500.000đ (Yêu cầu) + B 1.000.000đ cùng tháng → B giữ 250.000đ; admin từ chối A → 250.000đ tự hoàn (đường Ví nếu B rút về Ví). Có thể thêm ca mới vào script (đặt id U3-46…) và ghi rõ.' },
  { u: 'U4', n: 4, web: false, report: 'U4-doi-rac-cong-dong-game.md', dir: 'U4-doi-rac-cong-dong-game', focus: 'FAIL cũ: U4-04 (đại lý nhận hộp sữa, vỏ chai; nay chỉ kho HCMC), U4-26 (CSKH ghim được bài cộng đồng; gói quyen-admin chặn), U4-29 (quà sự kiện ngoài 20.000–50.000 điểm vẫn nhận; gói uat-ctv-su-kien). BLOCKED cũ U4-19 (Gomdon thật). Luật đổi: Q13 chữ Huỷ/Xoá/Khoá, Q16 Việt hoá màn trò chơi (Season Pass, Quiz… đổi tên), Q14 bỏ "6 vùng đất".' },
  { u: 'U5', n: 5, web: true, report: 'U5-admin-noi-bo.md', dir: 'U5-admin-noi-bo', focus: 'FAIL cũ: U5-35 (marketing tạo flash sale giảm 90%), U5-46 ("Việc cần xử lý" lệch số theo vai trò), U5-48 (khoá tiền affiliate.*, coupon.* lưu không hỏi lại), U5-54 (CSKH ghim bài cộng đồng). BLOCKED cũ U5-55 (vị trí Zalo). Luật đổi: Q20 tab "Yêu cầu rút tiền"; Q24 câu "Hạ vai trò chỉ tạm ngừng: người này có thể tự đăng ký CTV lại." khi hạ CTV về khách; Q13/Q16 chữ admin; duyệt/đã chi lệnh rút trên admin nay gửi expectedAmount, số thực nhận đổi thì báo 409 "tải lại"; cột "Thuế đã hoàn" trên màn lệnh rút. Làn cần web admin: lane-up 5 --web.' },
  { u: 'U6', n: 6, web: true, report: 'U6-web-khach.md', dir: 'U6-web-khach', focus: 'FAIL cũ: U6-02, U6-09, U6-37, U6-68, U6-73, U6-74, U6-75, U6-80 (lỗi web khách; phiên web đã sửa ở lô 6 trên main, nay nằm trong uat/rc). BLOCKED cũ U6-95..U6-98 (Zalo thật, chuyển khoản thật, Pancake thật, Gomdon/OA/ZaloPay) giữ BLOCKED. Ghi chú U6-90 (hệ số hạng lấy lúc đặt đơn, cặp đơn do script đặt): xem lại. Luật đổi: web giờ giống Mini App ở khổ điện thoại (PR #24); web được trả bằng Ví Tubu (Web Q4); bỏ dòng "điểm đang chờ, mở khoá ngày" (U6-B06); Học viện CTV với khách thường hiện khối "dành cho cộng tác viên" (403); /tai-khoan không gọi /brand/owner/me khi /auth/me trả ownsBrand false (nếu web đã làm; phần này có thể chưa có trong main: ghi rõ). Làn cần web: lane-up 6 --web.' },
]

const results = await parallel(LANES.map((l) => () =>
  agent(`${COMMON}\n\nLàn của bạn: ${l.u}, lane ${l.n}${l.web ? ' (cần --web)' : ''}. Báo cáo lần đầu: ${UATDOCS}/uat/${l.report}. Script: ${RC}/docs/2026-10-20-uat/uat/scripts/${l.dir}/. File báo cáo chạy lại: ${UATDOCS}/uat/rerun/${l.u}.md.\n\nTrọng tâm: ${l.focus}`,
    { label: `rerun:${l.u}`, phase: 'Rerun', agentType: 'worker', effort: 'high', schema: OUT })))

return results.filter(Boolean)
