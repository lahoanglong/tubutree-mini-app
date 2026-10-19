export const meta = {
  name: 'uat-w5-review2',
  description: 'Review lượt 2: đại lý/định kỳ/mua chung, vòng đời đơn, đổi rác/đơn sàn, logic Mini App, admin web/bảo mật + soát chéo + báo cáo D11–D15',
  phases: [
    { title: 'Review', detail: 'reviewer Opus mỗi góc' },
    { title: 'Verify', detail: 'reviewer khác góc cố bác bỏ P0/P1' },
    { title: 'Report', detail: 'ghi docs/2026-10-20-uat/Dx-*.md' },
  ],
}

const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat'
const BRIEF = `${WT}/docs/2026-10-20-uat/00-brief.md`

const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    coverage: { type: 'string', description: 'file/module đã đọc, phần chưa đọc kịp' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          group: { type: 'string', enum: ['agent sửa ngay', 'cần chủ quyết', 'chủ tự làm'] },
          title: { type: 'string' },
          location: { type: 'string', description: 'path:line, nhiều chỗ cách nhau bằng ;' },
          scenario: { type: 'string', description: 'đầu vào/trạng thái → kết quả sai' },
          evidence: { type: 'string', description: 'đoạn mã, output lệnh, truy vấn' },
          fix: { type: 'string', description: 'đề xuất sửa + test đỏ nên viết' },
          prior: { type: 'string', description: 'ID cũ trong findings-catalog/launch-review nếu có, hoặc "mới"' },
          zone: { type: 'string', enum: ['uat', 'web', 'chung'] },
        },
        required: ['id', 'severity', 'group', 'title', 'location', 'scenario', 'evidence', 'fix', 'prior', 'zone'],
      },
    },
  },
  required: ['summary', 'coverage', 'findings'],
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
          verdict: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'] },
          severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'], description: 'mức sau khi soát' },
          reason: { type: 'string' },
        },
        required: ['id', 'verdict', 'severity', 'reason'],
      },
    },
    missed: { type: 'array', items: { type: 'string' }, description: 'lỗi thật reviewer gốc bỏ sót (path:line + kịch bản)' },
  },
  required: ['verdicts', 'missed'],
}

const COMMON = `Đọc ${BRIEF} trước (luật cứng, quyết định đã chốt, định dạng). Code ở ${WT} (nhánh uat/2026-10-20). Bạn là reviewer: KHÔNG sửa file. Được chạy test lẻ theo file (npx jest <file>) và đọc DB UAT (postgresql://tubu@127.0.0.1:25432/tubutree_uat, chỉ SELECT). Không chạy jest/race/build toàn bộ. Tra findings-catalog.md và docs/2026-10-18-launch-review/ để không báo lại mục đã sửa. Chỉ báo phát hiện có path:line và kịch bản cụ thể. Mỗi P0/P1 phải có kịch bản tái hiện được. Ưu tiên lỗi thật hơn số lượng; nếu không thấy gì nghiêm trọng thì nói thẳng.`

const ANGLES = [
  {
    key: 'D11-tien-don-si-dinh-ky',
    title: 'Tiền: đại lý, định kỳ, mua chung, cashback, đối soát đối tác',
    lens: 'đúng tiền và đúng sổ',
    prompt: `Góc TIỀN lượt 2 (các module lượt 1 chưa đọc; đọc ${WT}/docs/2026-10-20-uat/D1-tien-diem.md mục "Chưa đọc kịp" để không trùng). Đọc sâu apps/api/src/modules/dealer/** (giá sỉ theo bậc, đơn sỉ tối thiểu 3 triệu, miễn phí giao từ 5 triệu, công nợ, khoá mua chịu khi quá hạn, thưởng đại lý/quý, điều kiện thanh toán bậc chỉ hiển thị), subscriptions/** (giảm giá định kỳ, job tạo đơn kỳ, đổi giá giữa kỳ, hết hàng, huỷ, voucher/điểm trên đơn kỳ), groupbuy/** (giảm 15%, coupon nhóm, hoàn khi thất bại), cashback/** (sàn ngoài, AccessTrade, chốt/đảo), merchant/** (phiếu đối soát, hoa hồng đối tác 15%, hàng ký gửi), flash-sale.service consume/restore suất, referral-reward. Kiểm cộng/trừ hai lần, làm tròn, đảo khi huỷ/hoàn, số âm, quyền.`,
  },
  {
    key: 'D12-vong-doi-don',
    title: 'Vòng đời đơn, hoàn tiền, giao hàng',
    lens: 'trạng thái đơn và tiền hoàn',
    prompt: `Góc VÒNG ĐỜI ĐƠN. Đọc apps/api/src/modules/orders/** (order-status.service, delivered-effects, order-returns, order-reversal, customer refunds, cancel), integrations/pancake/** (processor ánh xạ trạng thái, đối soát tổng, "Cần xử lý Pancake"), integrations/gomdon/**, integrations/payment/** (zalopay, chuyển khoản quá hạn), admin xác nhận thanh toán, refund admin (tài khoản nhận hoàn, Đã chi), lifecycle. Kiểm: chuyển trạng thái không hợp lệ (DELIVERED → CANCELLED, PAID hai lần), hiệu ứng khi giao (điểm, hoa hồng, voucher, nhiệm vụ) chạy hai lần hoặc không chạy khi trạng thái nhảy cóc, hoàn tiền vượt số đã trả, hoàn cho đơn COD chưa thu, trả một phần tính lại phí ship/giảm giá/điểm sai, webhook Pancake tới sai thứ tự, đơn chuyển khoản quá hạn rồi tiền mới về.`,
  },
  {
    key: 'D13-doi-rac-don-san',
    title: 'Đổi rác, đơn sàn, giới thiệu',
    lens: 'luật đổi rác và đơn sàn đã chốt',
    prompt: `Góc ĐỔI RÁC + ĐƠN SÀN. Đọc apps/api/src/modules/waste-exchange/** (yêu cầu, giữ chỗ, nhận ở quầy, cân, xác nhận, đảo, hạn mức, điểm nhận theo loại), external-points/** (quét/nhập mã vận đơn, khớp Pancake, mỗi mã một lần, chờ giao + 14 ngày, huỷ khi hoàn, duyệt tay external-claims-admin, B9 đơn CSKH theo SĐT giữ 30 ngày, tự nhận khi đăng nhập), referral (mời bạn). Luật đã chốt: hộp sữa và vỏ chai Tubu chỉ kho HCMC nhận; đại lý chỉ carton và nilon; thu kèm đơn và gửi kiện (MAIL_IN); điểm đổi rác ×1.000; chữ "khoảng ngày"; docs/launch/recycle-rewards-launch-checklist.md. Kiểm quyền quầy (nhân viên/đại lý nhận loại không được phép), cộng điểm hai lần, mã vận đơn của người khác, SĐT đổi chủ, đơn sàn 1% không hệ số không tính hạng.`,
  },
  {
    key: 'D14-miniapp-logic',
    title: 'Logic phía Mini App',
    lens: 'trải nghiệm khách khi mạng/thiết bị thật',
    prompt: `Góc LOGIC MINI APP (apps/miniapp/src). Đọc services/*, hooks, pages checkout/cart/bank-payment/order-detail/orders/loyalty/wallet/affiliate/recycle-*, components dùng chung, app.tsx (route, deep link ?claim= ?src= ?ref=, khôi phục phiên), xử lý token (refresh, 401, đăng xuất), ensure-phone. Kiểm: bấm đặt đơn hai lần / mạng chập chờn tạo 2 đơn (idempotency key đổi khi nào), số tiền hiển thị tự tính lệch server (tổng, giảm, điểm, phí ship), lỗi 409/422/429 hiện chữ đúng và có lối thoát, trạng thái treo (spinner vô hạn), dữ liệu cũ sau khi quay lại màn, lưu PII trong storage, deep link mất tham số sau đăng nhập, quét mã vận đơn (camera bị từ chối), đếm ngược flash sale lệch giờ máy, định dạng tiền/điểm/ngày, chữ "xu". Chỉ báo lỗi khách thật gặp; có path:line.`,
  },
  {
    key: 'D15-admin-web-bao-mat',
    title: 'Admin web, merchant portal, trang SSR công khai',
    lens: 'an toàn và thao tác nhân viên',
    prompt: `Góc ADMIN WEB + BẢO MẬT WEB. Đọc apps/web/src/app/admin/**, apps/web/src/components/admin/**, apps/web/src/app/merchant/** (nếu có), middleware.ts, các trang SSR công khai /s/[slug], /brand/[slug], trang pháp lý (legal.*), trang cộng đồng công khai, next.config (CSP, headers). Kiểm: thao tác nguy hiểm thiếu xác nhận/hiển thị tiền sai, client ẩn/hiện tab lệch quyền API, XSS (dangerouslySetInnerHTML với nội dung admin/khách: legal, mẫu thông báo, bài cộng đồng, mô tả SP, giới thiệu gian hàng), open redirect (?next=, ?redirect=), lộ token/PII trong HTML SSR hoặc log, CSP thiếu, cache SSR lộ dữ liệu người đăng nhập cho người khác, CSV injection khi xuất (ô bắt đầu =,+,-,@). File ngoài app/admin và components/admin thuộc phiên web: chỉ báo, ghi zone=web.`,
  },
]

phase('Review')
const results = await pipeline(
  ANGLES,
  (a) => agent(`${COMMON}\n\n${a.prompt}\n\nID phát hiện dạng ${a.key.split('-')[0]}-01, -02...`, {
    label: `review:${a.key}`, phase: 'Review', agentType: 'reviewer', schema: FINDINGS,
  }),
  (rev, a) => {
    if (!rev) return null
    const hi = rev.findings.filter((f) => f.severity === 'P0' || f.severity === 'P1')
    if (!hi.length) return { rev, ver: { verdicts: [], missed: [] } }
    return agent(`${COMMON}\n\nBạn soát chéo góc "${a.title}" bằng con mắt "${a.lens}" của một người KHÁC. Với từng phát hiện dưới đây, mở đúng path:line, dựng lại kịch bản, cố BÁC BỎ (đã có chặn ở tầng khác? đã sửa ở commit sau? luật đã chốt cho phép?). Không chắc thì PLAUSIBLE. Hạ hoặc nâng mức nếu cần. Ghi thêm lỗi thật mà reviewer gốc bỏ sót (nếu gặp khi đọc).\n\nPhát hiện:\n${JSON.stringify(hi, null, 1)}`, {
      label: `verify:${a.key}`, phase: 'Verify', agentType: 'reviewer', schema: VERDICTS,
    }).then((ver) => ({ rev, ver }))
  },
  (pair, a) => {
    if (!pair) return null
    return agent(`Ghi báo cáo Markdown tiếng Việt vào ${WT}/docs/2026-10-20-uat/${a.key}.md (tạo mới, chỉ file này). Đọc ${BRIEF} mục "Định dạng phát hiện". Nội dung: tiêu đề "# ${a.key} — ${a.title}", mục Tóm tắt (summary), Phạm vi đã đọc (coverage), bảng phát hiện xếp P0→P3 với cột ID | Mức (sau soát) | Soát chéo (CONFIRMED/PLAUSIBLE/REFUTED/chưa soát) | Nhóm | Vùng | Vị trí | Mô tả + kịch bản | Đề xuất sửa + test. Sau bảng: mục chi tiết từng P0/P1 (bằng chứng đầy đủ, lý do soát chéo). Phát hiện REFUTED để ở mục cuối "Đã bác bỏ" kèm lý do. Mục "Bỏ sót do soát chéo phát hiện" (missed). Không thêm nhận định của bạn. Chữ rõ, câu ngắn. Trả về đúng một dòng: số phát hiện theo mức sau soát, ví dụ "P0=1 P1=3 P2=5 P3=2 REFUTED=1".\n\nDữ liệu review:\n${JSON.stringify(pair.rev)}\n\nDữ liệu soát chéo:\n${JSON.stringify(pair.ver)}`, {
      label: `report:${a.key}`, phase: 'Report', model: 'sonnet', effort: 'low',
    }).then((line) => ({ key: a.key, line, rev: pair.rev, ver: pair.ver }))
  },
)

return results.filter(Boolean).map((r) => ({ key: r.key, line: r.line, n: r.rev.findings.length, missed: r.ver.missed.length }))
