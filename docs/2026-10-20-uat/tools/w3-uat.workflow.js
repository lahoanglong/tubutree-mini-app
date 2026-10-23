export const meta = {
  name: 'uat-w3-e2e',
  description: 'Dựng khung UAT thật (API/DB riêng mỗi lane, giả Zalo login/Pancake/webhook ngân hàng) rồi chạy 6 lane UAT theo vai trò',
  phases: [
    { title: 'Harness', detail: 'một agent dựng công cụ + README' },
    { title: 'UAT', detail: '6 lane song song, mỗi lane một file U*.md' },
  ],
}

const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat'
const BRIEF = `${WT}/docs/2026-10-20-uat/00-brief.md`
const OUT = `${WT}/docs/2026-10-20-uat`
const H = `${OUT}/tools/uat-harness`

const HARNESS = `Đọc ${BRIEF} trước. Nhiệm vụ: dựng BỘ KHUNG UAT ĐẦU-CUỐI THẬT trong ${H}/ (chỉ tạo file ở đó, KHÔNG sửa mã ứng dụng) để 6 agent UAT dùng song song. API thật + Postgres thật + Redis thật; chỉ giả những gì bên ngoài (Zalo, Pancake, ngân hàng).

Có sẵn: ${OUT}/tools/pg-native.sh (cụm Postgres chạy thẳng 25432 đang chạy, DB tubutree_uat đã migrate + seed.ts + seed-reference.ts --with-business-defaults), ${OUT}/tools/api-up.sh <port> <db> <redis-db> [pg-port] (bật API từ apps/api/dist, biến EXTRA_ENV để thêm env, CORS mở; dist đã build ở 05e6ae97), Redis container tubu-uat-redis 26379. API 3221 (DB tubutree_uat) đang được agent khác dùng: không dừng, không ghi vào DB tubutree_uat.

Cần làm (thử từng cái chạy thật, ghi output vào README):
1. lane-up.sh <N> (N=1..6) và lane-down.sh <N>. Cổng lane N: API 32{N}1 tức 3231, 3241, ..., 3281; web 32{N}2; Mini App Vite 32{N}3; giả Pancake 32{N}8. DB tubutree_uat_l{N} trên cụm 25432, tạo từ DB mẫu tubutree_uat_tpl (bạn dựng mẫu một lần: createdb + migrate deploy + seed.ts + seed-reference.ts --with-business-defaults + seed vai trò ở bước 2, rồi lane copy bằng CREATE DATABASE ... TEMPLATE tubutree_uat_tpl; mẫu không được có kết nối mở). Redis db N. Bật API (EXTRA_ENV trỏ PANCAKE_BASE_URL tới giả Pancake, PANCAKE_API_KEY/PANCAKE_SHOP_ID giả, các secret webhook dev), Vite Mini App với VITE_API_BASE_URL=http://localhost:32{N}1/api (kiểm biến tên đúng trong apps/miniapp/src/services/api.ts), web Next (next dev -p 32{N}2, chỉ khi gọi lane-up.sh <N> --web; web cần biến trỏ API, đọc apps/web/next.config.mjs). Ghi PID, dừng sạch cả cây con khi lane-down.
2. Người dùng theo vai trò trong DB mẫu (script TS/MJS dùng Prisma của apps/api): khách mới (chưa đơn nào, có SĐT đã xác minh và một bản không SĐT), khách quay lại hạng Lộc Biếc hoặc Đại Thụ có sẵn điểm và đơn cũ, CTV đã duyệt có gian hàng /s/<slug> (một gian hàng đã duyệt, một chờ duyệt), đại lý đã duyệt có bậc, nhân viên STAFF, kế toán, marketing, CSKH/kiểm duyệt, chủ thương hiệu gắn một brand, ADMIN. Đọc enum Role và các bảng hồ sơ (affiliate/dealer/staff/brand owner) trong apps/api/prisma/schema.prisma để dựng đúng. Một lô thẻ hộp hàng sàn (30.000đ, đơn từ 199.000đ, hạn 60 ngày, chỉ khách mới) tạo bằng đúng service/endpoint admin của app nếu được, và một flash sale đang chạy. Ghi bảng người dùng (id, zaloId, SĐT, vai trò) vào README.
3. mint-token.mjs <lane> <userId|zaloId>: ký JWT access đúng payload API kiểm (đọc apps/api/src/modules/auth, JwtStrategy; tham khảo apps/api/scripts/dev-token.ts và apps/e2e/global-setup.ts), secret từ apps/api/.env.
4. Mini App trong trình duyệt: script Playwright miniapp-session.mjs (export hàm open(lane, user, {browser: 'chromium'|'webkit'})) mở Vite lane ở 390x844, chỉ chặn và trả lời giả các lời gọi đổi token Zalo (POST /auth/zalo-mini-app, /auth/guest, /auth/refresh: trả {accessToken mint thật, refreshToken, user} đúng kiểu LoginResponse trong packages/shared-types) và các lời gọi zmp-sdk không chạy ngoài Zalo; MỌI lời gọi API khác phải đi tới API thật của lane. Xem cách apps/e2e/tests/support/mock-api.ts + spec *.miniapp.spec.ts làm Mini App chạy trong Chromium thường (zmp-sdk ngoài Zalo) và làm y vậy. Chứng minh: mở trang chủ bằng khách quay lại, chụp ảnh, in vài request đã đi tới API thật (status 200).
5. Web: web-session.mjs mở web lane ở 390 hoặc 1440 đã đăng nhập (đọc luồng đăng nhập web: cookie gì, API đặt ở đâu; đặt cookie/token đúng cách thay cho OAuth Zalo). Admin là /admin trên web.
6. Giả bên ngoài: fake-pancake.mjs (HTTP server cổng 32{N}8, trả các endpoint API gọi tới Pancake: tra đơn sàn theo mã vận đơn cho tính năng quét mã đơn sàn, tra đơn theo SĐT cho B9 nếu có, đồng bộ SP nếu cần; dữ liệu đơn sàn đọc từ file JSON lane sửa được) và pancake-webhook.mjs (gửi webhook Pancake có ký đúng PANCAKE_WEBHOOK_SECRET tới API lane để đổi trạng thái đơn: giao xong, hoàn). bank-webhook.mjs <lane> <orderCode> <amount> [nội dung] gửi webhook ngân hàng/chuyển khoản có ký đúng cơ chế API đang dùng (tìm module xác nhận chuyển khoản: grep webhook trong apps/api/src/modules/{integrations,checkout,orders,wallet}).
7. Thời gian: cách chạy job/cron theo yêu cầu (điểm chờ → dùng được sau giao + 14 ngày, hoa hồng giữ 10 ngày, điểm hết hạn 12 tháng, đơn chuyển khoản quá hạn, nhắc hết hạn): tìm trong apps/api/src/jobs và các @Cron; viết run-job.mjs <lane> <jobName> gọi thẳng hàm job qua Nest application context (NestFactory.createApplicationContext từ dist) hoặc endpoint admin có sẵn; kèm cách lùi mốc thời gian bằng UPDATE trên DB lane.
8. db.mjs <lane> "<SQL>": chạy SELECT/UPDATE trên DB lane, in JSON (Prisma $queryRawUnsafe/$executeRawUnsafe). Chặn chạy trên DB không phải tubutree_uat_l*.
9. README.md: cách dùng từng công cụ, bảng cổng, bảng người dùng, ví dụ một ca đầy đủ (khách quay lại đặt đơn COD trên Mini App thật → admin xác nhận → giả Pancake giao xong → chạy job → điểm vào sổ, truy vấn đối chiếu số dư điểm), giới hạn đã biết (cái gì vẫn giả). Chạy lane-up 1, làm ca ví dụ đó tới hết, rồi lane-down 1 để chứng minh bộ khung chạy.

Trả về: đường dẫn README, các giới hạn còn lại, và ca ví dụ PASS hay không kèm output.`

const LANES = [
  {
    n: 1, key: 'U1-mua-hang', web: false, model: undefined,
    prompt: `Vai trò: KHÁCH MỚI quét QR thẻ hộp hàng sàn và KHÁCH QUAY LẠI. Hành trình (Mini App 390x844, Chromium; lặp lại luồng mua lõi trên WebKit): mở link có ?claim=<mã thẻ>&src=shopee khi chưa đăng nhập → đăng nhập → nhận mã → trang chủ khách mới (home.new_customer_layout) → duyệt, tìm kiếm, lọc, chi tiết SP → giỏ (sửa số lượng, xoá, hết hàng) → voucher (mã thẻ 30k đơn từ 199k chỉ khách mới; WELCOME30; FREESHIP; XANH10; voucher chào mừng; freeship đơn đầu từ 199k; chồng mã đúng luật đã chốt; mã hết hạn/hết lượt/sai điều kiện báo đúng chữ) → thanh toán COD → đơn thành công; thanh toán chuyển khoản QR (đúng tài khoản 8386790906 Techcombank CONG TY TNHH TUBU TREE) → giả webhook ngân hàng: đủ tiền, thiếu tiền, thừa tiền, gửi trùng 2 lần, sai nội dung, quá hạn → trạng thái đơn và chữ hiển thị; flash sale (giá, giới hạn mỗi người, hết suất); dùng Điểm Xanh khi thanh toán (trần 20%, 1 điểm = 1đ). Khách quay lại: mua lại, địa chỉ cũ, voucher sinh nhật/quay lại nếu có. Mỗi ca tiền/điểm: truy vấn DB lane đối chiếu tổng đơn, giảm giá từng nguồn, phí ship, lượt dùng mã, tồn kho, sổ điểm (bảng ledger) và số dư.`,
  },
  {
    n: 2, key: 'U2-diem-xanh-sau-mua', web: false, model: undefined,
    prompt: `Vai trò: KHÁCH QUAY LẠI các hạng. Hành trình Điểm Xanh và sau mua (Mini App 390x844): đơn app giao xong → điểm chờ → sau hạn chạy job → dùng được; đúng 2% tiền hàng sau giảm, không tính ship, × hệ số hạng (thử Mầm Xanh, Lộc Biếc, Đại Thụ: 199.000đ Mầm Xanh = 3.980 điểm); lên hạng theo ngưỡng (×1.000); điểm hết hạn 12 tháng (lùi mốc + job) và tin nhắc trước 7 ngày; trần điểm; đơn sàn: quét/nhập mã vận đơn khớp giả Pancake → 1%, không hệ số, không tính hạng, mỗi mã một lần (thử nhập lại, mã của người khác, mã không có), chờ giao + 14 ngày, đơn hoàn thì huỷ; B9: đơn CSKH lên trên Pancake theo SĐT → tự cộng điểm, SĐT chưa vào Mini App giữ 30 ngày rồi khách đăng nhập bằng SĐT đó nhận; đặt định kỳ (tạo, sửa kỳ, bỏ qua, huỷ, giảm giá định kỳ, job tạo đơn kỳ); huỷ đơn trước giao (hoàn điểm đã tiêu, voucher, tồn kho), trả hàng/hoàn tiền một phần sau giao (thu hồi điểm đã cộng theo tỉ lệ, hoàn tiền vào đâu), ví Tubu. Đối chiếu sổ điểm và số dư DB mỗi bước; chạy apps/api/scripts/reconcile-points.ts và reconcile-wallet.ts trên DB lane ở cuối.`,
  },
  {
    n: 3, key: 'U3-ctv-dai-ly-nhan', web: true, model: undefined,
    prompt: `Vai trò: CTV, ĐẠI LÝ, CHỦ THƯƠNG HIỆU. CTV (Mini App): trang CTV, mã/link giới thiệu, chia sẻ, khách mới mua qua link (dùng người dùng khách mới) → hoa hồng 8%, không trả cho hàng gian hàng đối tác, giữ 10 ngày sau giao (job), trừ TNCN 10% theo luật, rút tiền (số dư đủ/thiếu, rút 2 lần cùng lúc), admin duyệt rút (ADMIN) và kế toán bấm Đã chi; gian hàng /s/<slug>: tạo/sửa, chờ duyệt lần đầu (storefront.require_approval), sau duyệt hiện công khai trên Mini App và web (SSR web lane --web, cổng 3232), ẩn khi CTV bị hạ vai trò, hoa hồng đơn cũ vẫn giữ. Đại lý: kênh /dealer, giá sỉ theo bậc, đơn sỉ tối thiểu 3 triệu, miễn phí giao từ 5 triệu, công nợ/khoá mua chịu khi quá hạn, thưởng đại lý, quầy đổi rác chỉ nhận carton và nilon (không hộp sữa/vỏ chai). Chủ thương hiệu: /brand/<slug> trên Mini App và web, màn chủ nhãn (doanh số, khuyến mãi), khối chương trình đại lý hiện cho mọi người (đã chốt 2026-10-19). Đối chiếu DB: bảng hoa hồng, ví CTV, yêu cầu rút, công nợ.`,
  },
  {
    n: 4, key: 'U4-doi-rac-cong-dong-game', web: false, model: undefined,
    prompt: `Vai trò: KHÁCH, NHÂN VIÊN quầy, KIỂM DUYỆT. Đổi rác (Mini App): thể lệ, tạo yêu cầu thu kèm đơn và gửi kiện (MAIL_IN), chọn loại: hộp sữa và vỏ chai Tubu chỉ kho HCMC nhận, đại lý chỉ carton và nilon (thử chọn sai điểm nhận), sửa/huỷ yêu cầu, nhân viên quầy nhận hàng (recycle-desk) cân/ghi nhận → cộng điểm theo bảng (đã ×1.000), trần/ngày nếu có, chữ "khoảng ngày", thông báo cho khách. Cộng đồng: khách đăng bài (ảnh, gắn SP), bình luận, thích; CSKH duyệt/gỡ bài; chỉ ADMIN ghim và chọn người thắng sự kiện, quà 20.000–50.000 điểm; xem trước khi chưa đăng nhập (community.public_preview); bảng xếp hạng không lộ PII. Game Vườn Xanh: điểm danh (×1.000), vòng quay, nhiệm vụ, quà đổi điểm, giới hạn lượt/ngày, gợi ý lần đầu "Vườn Xanh". Thông báo: danh sách, đã đọc, tắt nhận theo nhóm. Đối chiếu sổ điểm DB mỗi lần cộng/trừ.`,
  },
  {
    n: 5, key: 'U5-admin-noi-bo', web: true, model: undefined,
    prompt: `Vai trò: ADMIN, KẾ TOÁN, MARKETING, CSKH, NHÂN VIÊN trên web admin 1440x900 (web lane --web cổng 3252) và màn nội bộ Mini App (staff, my-payroll, admin, community-moderation). Việc hằng ngày của admin: xem bảng điều khiển, lọc/tìm đơn, xác nhận "Đã nhận tiền" đơn chuyển khoản (ADMIN và kế toán), huỷ đơn, hoàn tiền (một phần, toàn phần), duyệt rút tiền (chỉ ADMIN; kế toán bị chặn) và Đã chi (kế toán được), duyệt hoàn tiền mua trên sàn, hoá đơn VAT, công nợ đại lý, cấu hình SystemConfig (thử đổi một khoá rồi đổi lại), tạo lô thẻ hộp hàng sàn, tạo mã giảm giá bằng marketing vượt trần (30%/100.000đ, 10 triệu/ngày, 1.000 lượt) phải bị chặn, marketing không thấy tab bị cấm, sửa mẫu thông báo có dãy 8 chữ số/link ngoài phải bị chặn, xuất CSV đơn che SĐT với kế toán, báo cáo doanh thu, khoá/mở user, đổi vai trò, "Cần xử lý Pancake", "Việc cần xử lý". Mỗi vai trò: thử gọi thẳng API của tab không được phép (mint token vai trò đó) → phải 403. Ghi rõ ma trận vai trò × tab × kết quả.`,
  },
  {
    n: 6, key: 'U6-web-khach', web: true, model: 'sonnet',
    prompt: `Vai trò: KHÁCH trên WEB (390x844 và 1440x900, web lane --web cổng 3262, API thật). Hành trình: chưa đăng nhập duyệt/tìm/chi tiết SP/gian hàng /s/<slug>/brand/<slug> (SSR), đăng nhập (giả OAuth Zalo bằng web-session.mjs), giỏ, thanh toán COD và chuyển khoản QR (chỉ 2 phương thức theo Q4) + giả webhook ngân hàng, voucher, Điểm Xanh dùng khi thanh toán, đơn hàng và chi tiết đơn, huỷ đơn, tài khoản, cộng đồng, game, đổi rác, tính năng cần SĐT đã xác minh phải hiện lời dặn mở Mini App (Q2). So từng màn với Mini App cùng dữ liệu (mở Mini App lane 6 cổng 3263 song song): chức năng phải giống. KHÔNG sửa apps/web/src. Mỗi lỗi web ghi: route, khổ (390/1440), mô tả, đường dẫn ảnh, mức, có gây mất tiền/chặn mua không (nếu có ghi "KHẨN"). Đối chiếu DB cho ca tiền/điểm.`,
  },
]

const LANE_COMMON = (l, harness) => `Đọc ${BRIEF} trước. Bạn là agent UAT lane ${l.n}. KHÔNG sửa mã ứng dụng; chỉ tạo file trong ${OUT}/uat/ (báo cáo, ảnh ${OUT}/uat/shots/${l.key}/, script ca test ${OUT}/uat/scripts/${l.key}/). Dùng bộ khung ${H}/README.md (đọc kỹ). Kết quả dựng bộ khung:\n${harness}\n\nBật lane: bash ${H}/lane-up.sh ${l.n}${l.web ? ' --web' : ''}. Cổng lane: API 32${l.n}1, web 32${l.n}2, Mini App 32${l.n}3, giả Pancake 32${l.n}8. Chỉ dùng DB tubutree_uat_l${l.n} và Redis db ${l.n}. Cuối việc: bash ${H}/lane-down.sh ${l.n}. Viết ca test thành script Playwright/Node chạy lại được (để sau khi sửa lỗi chạy lại).

Mỗi ca ghi vào ${OUT}/uat/${l.key}.md một dòng bảng: ID (${l.key.split('-')[0]}-01…) | Vai trò | Hành trình | Bước | Kỳ vọng (theo luật đã chốt) | Thực tế | Bằng chứng (ảnh, response rút gọn, truy vấn DB + kết quả) | PASS/FAIL/BLOCKED. Ca tiền/điểm PHẢI có truy vấn DB đối chiếu số dư và sổ, không chỉ nhìn màn hình. Sau bảng: mục "Lỗi tìm thấy" theo định dạng phát hiện của brief (ID ${l.key.split('-')[0]}-Bxx, mức, path:line nghi ngờ nếu tra được, kịch bản tái hiện, script tái hiện). Lỗi do bộ khung giả (không phải app) ghi riêng mục "Hạn chế bộ khung", không tính FAIL. Ca không làm được vì thiếu tích hợp ngoài thì BLOCKED kèm lý do.

Phạm vi lane:\n${l.prompt}\n\nTrả về: số ca PASS/FAIL/BLOCKED, danh sách ID FAIL kèm một dòng mô tả, đường dẫn báo cáo.`

phase('Harness')
const harness = await agent(HARNESS, { label: 'harness', phase: 'Harness' })
if (!harness) return { error: 'harness agent không trả kết quả' }

phase('UAT')
const lanes = await parallel(LANES.map((l) => () =>
  agent(LANE_COMMON(l, harness), { label: l.key, phase: 'UAT', ...(l.model ? { model: l.model } : {}) })
    .then((text) => ({ key: l.key, text }))))
return { harness, lanes: lanes.filter(Boolean) }
