export const meta = {
  name: 'uat-w12-fix-wave6-chu-quyet',
  description: 'Đợt 6: làm theo quyết định của chủ sáng 2026-10-20 (Q1 xét hạng, Q8 trả bù thưởng quý, Q10 gói thật, Q2 TNCN cộng dồn, Q19 cron đảo đơn, Q12 freeship 199k, Q18 mua chung, Q22 đổi chu kỳ, Q15 fetch, chữ Q13/14/16/24), worker Sonnet TDD, review Opus tới 3 lượt',
  phases: [
    { title: 'Implement', detail: 'worker Sonnet, test đỏ trước rồi sửa' },
    { title: 'Review', detail: 'reviewer Opus lượt 1' },
    { title: 'Fix', detail: 'worker sửa theo review' },
    { title: 'Review2', detail: 'reviewer Opus lượt 2' },
    { title: 'Review3', detail: 'sửa tiếp + reviewer Opus lượt 3 khi lượt 2 còn lỗi chặn' },
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

const DECIDE = `Đây là quyết định mới của chủ sáng 2026-10-20 (đọc ${DOCS}/98-cau-hoi.md mục "Chủ trả lời sáng 2026-10-20" và dòng câu hỏi gốc).`

const PKGS = [
  {
    key: 'q1-xet-hang', race: 25561,
    spec: `${DECIDE} Q1 (nguồn ${DOCS}/D1-tien-diem.md mục D1-03): chi tiêu 12 tháng xét hạng thành viên CHỈ tính đơn khách tự mua lẻ cho chính mình. Không tính đơn nhập sỉ của đại lý (đơn DEALER). Không tính đơn CTV lên hộ khách, cho cả CTV lẫn khách nhận. Vị trí: apps/api/src/modules/loyalty/loyalty.service.ts:352-359 (spending12m / order.aggregate), cách nhận diện đơn đại lý và đơn lên hộ xem dealer/dealer.service.ts:298-310, affiliate/affiliate.service.ts:748-765, và cách gói voucher-moc đã loại hai loại đơn này ở vouchers/vouchers.service.ts (dùng lại cùng điều kiện, tốt nhất là một hàm chung). Đồng bộ mọi nơi dùng chi tiêu xét hạng: tiến độ "còn X đ để lên hạng" (getOverview), cron xét hạng/hạ hạng, màn admin nếu có. Giữ cách tính phí giao như cũ (Q23: vẫn tính cả ship). Test: jest cho spending12m với 3 loại đơn (lẻ, DEALER, lên hộ) và race spec Postgres nếu hàm chạy SQL thật.`,
    files: 'apps/api/src/modules/loyalty/**, apps/api/src/modules/vouchers/vouchers.service.ts (chỉ khi gom hàm chung), apps/api/src/modules/orders/** chỉ helper nhận diện loại đơn, apps/api/test/integration-race/** (+ spec)',
  },
  {
    key: 'q8-thuong-quy', race: 25562,
    spec: `${DECIDE} Q8 (nguồn ${DOCS}/D11-tien-don-si-dinh-ky.md mục D11-03): thưởng quý đại lý chốt ngày 10 tháng sau quý. Đơn thuộc quý nhưng chốt muộn hơn (đặt trước chờ hàng, tiền về muộn) hiện mất thưởng vĩnh viễn. Chủ chọn: trả bù khi đơn trễ chốt, trong vòng 60 ngày sau ngày cuối quý. Vị trí: apps/api/src/modules/dealer/dealer.service.ts:1222-1228, :1256-1264; dealer.cron.ts:268; dealer-config.ts. Yêu cầu: (1) Sau lần chốt ngày 10, một bước chạy lại (cron hằng ngày hoặc ngay khi đơn của quý đó chốt) tính lại doanh số quý gồm các đơn chốt muộn, chỉ trong cửa sổ 60 ngày sau cuối quý. Nếu mức thưởng mới cao hơn phần đã trả thì tạo khoản trả bù đúng phần chênh. (2) Idempotent: chạy nhiều lần hoặc song song không trả bù hai lần. Dùng khoá duy nhất hoặc advisory lock, có race spec Postgres chạy song song. (3) Khớp với luật thu hồi thưởng (D11-02 đã sửa: thu hồi chỉ trên doanh số lúc trả thưởng): doanh số lúc trả của khoản bù phải được ghi để thu hồi về sau tính đúng. (4) Đại lý và kế toán thấy được khoản trả bù: dòng sổ hoặc yêu cầu thưởng có ghi chú "trả bù quý X". Nếu thưởng là quà, tour… mà không có số tiền thì ghi decisions cách làm, chọn phương án an toàn (tạo yêu cầu chờ ADMIN duyệt thay vì tự trả). (5) Có khoá cấu hình số ngày cửa sổ (mặc định 60) theo quy ước SystemConfig đang có. Cần migration thì đặt tên theo quy ước và ghi vào HEAVY_MIGRATIONS nếu khoá bảng lớn.`,
    files: 'apps/api/src/modules/dealer/**, apps/api/prisma/schema.prisma + migration mới nếu cần, apps/api/prisma/reference-data/** nếu thêm khoá cấu hình, apps/api/src/config/go-live/** chỉ khi thêm migration, apps/api/test/integration-race/** (+ spec)',
  },
  {
    key: 'q10-goi-that', race: 25563,
    spec: `${DECIDE} Q10 (nguồn ${DOCS}/D11-tien-don-si-dinh-ky.md mục D11-04): bậc giảm giá của đặt mua định kỳ đang đếm cả gói hẹn ngày rất xa chưa ra đơn nào. Khách tạo 4 gói ảo là lên mức 15%. Chủ chọn: chỉ đếm gói đang chạy mà đã ra ít nhất một đơn, HOẶC có kỳ giao kế tiếp (nextRunAt) trong vòng 35 ngày tới. Vị trí: apps/api/src/modules/subscriptions/subscriptions.service.ts, chỗ đếm số gói để chọn bậc giảm. Đồng bộ mọi chỗ hiện bậc giảm cho khách (API trả về cho Mini App/web) để khách không thấy bậc cao hơn bậc được áp thật. Test jest: 4 gói nextRunAt +200 ngày chưa ra đơn → bậc thấp nhất; 1 gói đã ra đơn + 1 gói kỳ kế +20 ngày → đếm 2. Có race spec cho subscriptions thì cập nhật.`,
    files: 'apps/api/src/modules/subscriptions/** (+ spec), apps/api/test/integration-race/** liên quan subscriptions',
  },
  {
    key: 'q2-tncn', race: 25564,
    spec: `${DECIDE} Q2 (nguồn ${DOCS}/D1-tien-diem.md mục D1-04): thuế TNCN 10% với ngưỡng 2.000.000đ hiện xét theo TỪNG lần rút hoa hồng. Chủ chọn: cộng dồn các lần rút trong cùng tháng (theo giờ Việt Nam), khấu trừ khi tổng vượt ngưỡng. Vị trí: apps/api/src/modules/affiliate/affiliate.service.ts:546-553, 1078-1150, 1216-1245 (mọi đường rút: về ngân hàng, vào Ví WALLET_BALANCE). Cách tính: khi tổng gộp các lần rút trong tháng (kể cả lần này) lớn hơn hoặc bằng ngưỡng, khấu trừ 10% trên tổng gộp của tháng trừ số đã khấu trừ trước đó trong tháng (truy thu phần các lần nhỏ trước). Nếu phần khấu trừ lớn hơn số tiền lần này thì chỉ khấu trừ tối đa bằng số tiền lần này, phần còn lại dồn sang lần sau trong tháng. Ghi rõ cách đã chọn vào decisions và ghi chú cho kế toán. Lệnh rút bị huỷ hoặc từ chối thì không tính vào tổng tháng. Đồng thời: hai lệnh rút cùng lúc của một CTV không được cùng thoát khấu trừ. Khoá theo user-tháng (advisory lock hoặc FOR UPDATE), có race spec Postgres song song. Chữ cho CTV (Mini App, màn rút) nói đúng cách tính mới, nếu có câu cũ "mỗi lần rút từ 2 triệu". Không đổi mức 10% và ngưỡng 2 triệu.`,
    files: 'apps/api/src/modules/affiliate/** (+ spec), apps/api/src/modules/wallet/** chỉ đường rút hoa hồng vào Ví, apps/miniapp/src/pages/affiliate*/** chỉ câu giải thích thuế, apps/api/test/integration-race/** (+ spec)',
  },
  {
    key: 'q19-dao-don', race: 25565,
    spec: `${DECIDE} Q19 (nguồn ${DOCS}/D12-vong-doi-don.md mục D12-02, ${DOCS}/impl/dot4a.md gói don-sau-huy): huỷ hoặc trả đơn đã hoàn điểm thường trong cùng giao dịch, còn các bước sau commit (đảo điểm tích, đảo hoa hồng, lệnh huỷ Pancake, tin báo) chạy lại khi gọi lại. Kẽ hở: tiến trình chết đúng giữa commit và các bước sau (SIGTERM khi deploy) thì không ai gọi lại. Chủ chọn làm ngay: thêm cột đánh dấu (ví dụ orders.reversalEffectsAt, null = chưa xong) và cron quét các đơn CANCELLED/RETURNED/REFUNDED có cột null quá vài phút để chạy lại phần đảo sau commit, giống DeliveredEffectsResyncCron (apps/api/src/modules/orders/delivered-effects-resync.cron.ts, đọc làm mẫu). Yêu cầu: (1) mọi bước chạy lại phải idempotent (đã có khoá chống hoàn 2 lần, kiểm lại); (2) set cột khi mọi bước xong; (3) đơn huỷ trước khi có migration không bị quét tràn: backfill cột = now() cho đơn đã ở trạng thái cuối trong migration, hoặc cron chỉ quét đơn cập nhật sau mốc triển khai; (4) cron có khoá chạy một nơi (theo cách các cron khác đang làm), giới hạn số đơn mỗi lượt; (5) partial index cho truy vấn quét (WHERE reversalEffectsAt IS NULL AND status IN …) nếu cần; ghi migration vào HEAVY_MIGRATIONS / runbook nếu khoá bảng orders (đọc apps/api/src/config/go-live/db-checks.ts và spec). Race spec: tiến trình "chết" sau commit (mock bước sau ném) → cron chạy → điểm, hoa hồng đảo đúng một lần; cron chạy song song 2 lần → không đảo hai lần.`,
    files: 'apps/api/src/modules/orders/**, apps/api/src/modules/integrations/pancake/** chỉ phần gọi lại huỷ, apps/api/prisma/schema.prisma + migration mới, apps/api/src/config/go-live/** (+ spec), docs/launch/deploy-rollback-runbook.md (mục migration), apps/api/test/integration-race/** (+ spec)',
  },
  {
    key: 'q12-freeship', race: 25566,
    spec: `${DECIDE} Q12 (nguồn ${DOCS}/D6-uiux-miniapp.md mục D6-18): ngưỡng miễn phí giao thường đang là 200.000đ, còn ngưỡng đơn đầu (newCustomer.firstOrderFreeShip.minSubtotal) là 199.000đ. Chủ chọn: đưa ngưỡng thường về 199.000đ cho khớp. Tìm MỌI nơi giữ 200.000 làm ngưỡng freeship: khoá cấu hình (freeshipThreshold, shipping.*) trong seed và reference-data business defaults, giá trị mặc định trong code API (tính phí giao ở checkout/cart), hằng dự phòng ở Mini App (apps/miniapp/src/pages/product-detail.tsx:290-291,487; cart; thanh tiến độ), tài liệu thể lệ hoặc FAQ trong repo. Đổi về 199.000 sao cho checkout API và mọi câu hiện cho khách cùng một số. Ở đâu số này đọc từ cấu hình thì chỉ đổi mặc định và seed. Web khách (apps/web/src ngoài admin) là vùng phiên web: KHÔNG sửa; grep 200000/200.000 trong apps/web/src và ghi danh sách file:line vào decisions để báo phiên web. Test: jest phí giao ở 199.000 → 0đ, 198.999 → có phí; vitest Mini App câu "Miễn phí giao từ 199.000đ"; jest prisma/reference-data nếu đổi seed.`,
    files: 'apps/api/src/modules/shipping/**, apps/api/src/modules/checkout/** chỉ ngưỡng, apps/api/prisma/seed.ts, apps/api/prisma/reference-data/**, apps/miniapp/src/** (chỗ ngưỡng freeship), docs/** thể lệ/FAQ (trừ docs/2026-10-19-web-parity/** và docs/2026-10-20-uat/**)',
  },
  {
    key: 'q18-mua-chung', race: 25567,
    spec: `${DECIDE} Q18 (nguồn ${DOCS}/98-cau-hoi.md dòng Q18, ${DOCS}/impl/dot4a.md gói mua-chung): đơn tối thiểu (minOrder) của mã mua chung đang bằng giá nhóm của biến thể ĐẦU TIÊN Pancake trả về. Nếu biến thể đó là loại đắt thì khách mua một đơn vị loại rẻ bị từ chối "Đơn tối thiểu …". Chủ chọn: minOrder theo giá nhóm của biến thể RẺ NHẤT đang bán (còn active, có giá) của sản phẩm nhóm. Vị trí: apps/api/src/modules/groupbuy/groupbuy.service.ts (chỗ tạo mã khi đủ nhóm). Giữ trần giảm = 15% giá biến thể đắt nhất (Q17 đã chốt). Test jest: sản phẩm 2 biến thể (đắt trước, rẻ sau) → minOrder = giá nhóm biến thể rẻ; khách mua 1 đơn vị biến thể rẻ áp được mã. Mini App và chữ tin nhóm nếu có nêu đơn tối thiểu thì phải khớp số mới.`,
    files: 'apps/api/src/modules/groupbuy/** (+ spec), apps/api/src/modules/coupons/** chỉ nếu cần, apps/miniapp/src/pages/group-buy*.tsx chỉ nếu chữ nêu đơn tối thiểu',
  },
  {
    key: 'q22-chu-ky', race: 25568,
    spec: `${DECIDE} Q22 (nguồn ${DOCS}/uat/U2-diem-xanh-sau-mua.md mục U2-B01): khách không đổi được chu kỳ giao (4/6/8/10 tuần) của gói định kỳ đang chạy. Chủ chọn: cho đổi chu kỳ, và tính lại ngày giao kế tiếp từ đơn kỳ gần nhất. Yêu cầu: (1) API: thêm intervalWeeks vào UpdateSubDto (apps/api/src/modules/subscriptions/subscriptions.controller.ts:23-27), chỉ nhận 4/6/8/10 (dùng cùng nguồn giá trị như lúc tạo gói). (2) Service: nextRunAt mới = ngày đơn kỳ gần nhất của gói + chu kỳ mới. Gói chưa ra đơn nào thì tính từ mốc bắt đầu của gói. Nếu kết quả rơi vào quá khứ hoặc gần hơn mức báo trước tối thiểu đang dùng khi tạo gói thì đặt bằng mốc sớm nhất hợp lệ. Gói PAUSED/CANCELLED thì không cho đổi, hoặc theo luật đang có của PATCH. Đổi chu kỳ không làm đổi bậc giảm. (3) Mini App: thêm chọn chu kỳ vào màn Sửa gói (apps/miniapp/src/components/subscription-edit-sheet.tsx), dùng lại lựa chọn ở subscription-options.tsx, có hiện ngày giao kế mới trước khi lưu nếu tính được. Web khách là vùng phiên web: không sửa, ghi file web cần theo vào decisions. Test: jest PATCH intervalWeeks 6 → 200, DB 6, nextRunAt đúng luật; PATCH 5 → 400. Vitest sheet: có 4 lựa chọn, lưu gửi đúng intervalWeeks. ${SHOTS(3297, 'miniapp')}`,
    files: 'apps/api/src/modules/subscriptions/** (+ spec), apps/miniapp/src/components/subscription-edit-sheet*.tsx, apps/miniapp/src/components/subscription-options*.tsx, apps/miniapp/src/services/** chỉ kiểu PATCH gói, packages/shared-types chỉ kiểu DTO nếu bắt buộc',
  },
  {
    key: 'q15-fetch', race: 25569,
    spec: `${DECIDE} Q15 (nguồn ${DOCS}/D9-hieu-nang.md mục D9-03): gói tải đầu Mini App 685 KB. Chủ chọn: thay axios bằng fetch trong Mini App, giảm khoảng 44 KB raw / 17 KB gzip. axios dùng ở apps/miniapp/src/services/api.ts và khoảng 10 file khác (isAxiosError, kiểu AxiosError…). Yêu cầu: (1) Viết lớp HTTP mỏng trên fetch, giữ ĐÚNG hành vi đang có của services/api.ts: baseURL, header auth và token, interceptor làm mới token khi 401 (một lần làm mới cho nhiều request đồng thời), timeout (AbortController), lỗi mạng, parse JSON, thông điệp lỗi tiếng Việt từ body.message, query params, upload multipart nếu có. (2) Thay mọi chỗ dùng isAxiosError hay kiểu Axios bằng lớp lỗi riêng có cùng thông tin (status, data). (3) Gỡ axios khỏi apps/miniapp/package.json, chỉ khi không còn import nào trong apps/miniapp. KHÔNG sửa packages/app-core (vùng phải hỏi phiên web). Nếu app-core kéo axios vào bundle Mini App thì ghi decisions, không sửa. (4) Đo trước và sau: cd apps/miniapp && VITE_API_BASE_URL=https://api.example.vn/api npx vite build, ghi cỡ entry index.*.js raw và gzip vào green. (5) Test: toàn bộ vitest miniapp (VN và TZ=UTC) phải xanh. Thêm spec cho lớp HTTP mới: 401 → làm mới token một lần cho 2 request song song, timeout, lỗi mạng, thông điệp lỗi. tsc miniapp, eslint file sửa. Playwright Mini App sẽ chạy ở gate cuối, ghi rủi ro vào decisions.`,
    files: 'apps/miniapp/src/** (+ spec), apps/miniapp/package.json, pnpm-lock.yaml (chỉ phần apps/miniapp)',
  },
  {
    key: 'chu-viet', race: 25570,
    spec: `${DECIDE} Các quyết định về chữ: (1) Q13: thống nhất kiểu đặt dấu mới "Huỷ, Xoá, Khoá" (và các từ cùng kiểu: thuỷ, tuỳ, hoà, loà… theo kiểu tài liệu và admin đang dùng) trong chữ hiện cho người dùng ở apps/miniapp/src, apps/web/src/app/admin + apps/web/src/components/admin (trừ portal-header.tsx), và thông điệp lỗi hay tin của API hiện cho khách (apps/api/src: chuỗi trong BadRequest/Conflict…, mẫu tin trong prisma/seed.ts và reference-data). KHÔNG đổi tên khoá, enum, tên mã, slug, URL hay chuỗi so khớp dữ liệu. (2) Q14: trang chủ Mini App ghi "6 vùng đất": bỏ con số, ghi "từ nhiều vùng đất Việt Nam" (grep "vùng đất" trong apps/miniapp/src). (3) Q16: Việt hoá chữ tiếng Anh hoặc biệt ngữ ở màn trò chơi, nhân viên, CTV (Mini App) và thanh điều hướng, tab admin. Ví dụ "Season pass", "KPI", "Dashboard", "Check-in". Giữ "CTV", tên riêng (Zalo, Pancake, VietQR, ZaloPay), mã đơn. Đọc ${DOCS}/D8-a11y-chu.md và ${DOCS}/D6-uiux-miniapp.md tìm danh sách đã ghi. (4) Q24: chủ giữ cách hiện tại (hạ CTV về khách chỉ là tạm ngừng, người đó tự đăng ký lại được). Thêm câu giải thích ngay chỗ ADMIN hạ vai trò trên web admin: "Hạ vai trò chỉ tạm ngừng: người này có thể tự đăng ký CTV lại." Web khách (apps/web/src ngoài admin) là vùng phiên web: KHÔNG sửa, ghi danh sách file:line cần đổi vào decisions để báo phiên web. Sửa test đang khớp chuỗi cũ. Chạy: vitest miniapp và web admin (file đụng tới, rồi toàn bộ miniapp), jest các module API đụng chuỗi, npm run -s lint:parity và lint:vars ở gốc worktree. lint:parity lỗi vì web khách khác Mini App thì ghi vào decisions, không sửa web khách.`,
    files: 'apps/miniapp/src/** (chữ), apps/web/src/app/admin/**, apps/web/src/components/admin/** trừ portal-header.tsx, apps/api/src/** (chỉ chuỗi hiện cho người dùng), apps/api/prisma/seed.ts, apps/api/prisma/reference-data/** (+ spec liên quan)',
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
  (s, p) => {
    if (!s) return null
    if (s.rev2 && s.rev2.ok && !s.rev2.issues.some((i) => i.severity !== 'P3')) return s
    const last = s.fix ?? s.impl
    return agent(FIXER(p, last, s.rev2), { label: `fix2:${p.key}`, phase: 'Review3', agentType: 'worker', effort: 'high', schema: IMPL })
      .then((fix2) => agent(REVIEWER(p, fix2 ?? last, 3), { label: `rev3:${p.key}`, phase: 'Review3', agentType: 'reviewer', schema: REVIEW })
        .then((rev3) => ({ ...s, fix2, rev3 })))
  },
)

return results.filter(Boolean).map((r) => ({
  key: r.key,
  branch: r.impl.branch,
  commits: [...(r.impl.commits ?? []), ...((r.fix?.commits) ?? []), ...((r.fix2?.commits) ?? [])],
  rev1ok: r.rev1?.ok, rev1issues: r.rev1?.issues?.length,
  fixed: !!r.fix,
  rev2ok: r.rev2?.ok, rev2issues: r.rev2?.issues,
  fix2commits: r.fix2?.commits, rev3ok: r.rev3?.ok, rev3issues: r.rev3?.issues,
  decisions: [...(r.impl.decisions ?? []), ...((r.fix?.decisions) ?? []), ...((r.fix2?.decisions) ?? [])],
  skipped: [...(r.impl.skipped ?? []), ...((r.fix?.skipped) ?? [])],
}))
