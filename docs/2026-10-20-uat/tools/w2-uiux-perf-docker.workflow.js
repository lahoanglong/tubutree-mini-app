export const meta = {
  name: 'uat-w2-uiux-perf-docker',
  description: 'Chụp + chấm UI Mini App 390 và admin 1440, a11y/chữ, hiệu năng, build Docker + đối chiếu env',
  phases: [
    { title: 'Discover', detail: '5 nhánh song song, mỗi nhánh một báo cáo Dx' },
  ],
}

const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat'
const BRIEF = `${WT}/docs/2026-10-20-uat/00-brief.md`
const OUT = `${WT}/docs/2026-10-20-uat`

const COMMON = `Đọc ${BRIEF} trước (luật cứng, quyết định đã chốt, định dạng phát hiện). Code ở ${WT}. KHÔNG sửa mã nguồn ứng dụng; chỉ được tạo file trong ${OUT}/ (báo cáo, ảnh, script công cụ trong ${OUT}/tools/). API UAT thật đang chạy ở http://127.0.0.1:3221/api (DB tubutree_uat, có dữ liệu seed). Không dừng API 3221. Cuối việc dừng mọi server/trình duyệt bạn tự bật (kill đúng PID + cây con). Kết thúc bằng một đoạn ngắn: đường dẫn báo cáo, số phát hiện theo mức, việc chưa làm kịp.`

const CAPTURE_NOTE = `Bộ chụp có sẵn: scripts/uiux/capture.mjs + scripts/uiux/lib/*.mjs + routes.mjs (mock API bằng ApiRouter, đọc danh sách SP từ API 3001, ghi ảnh vào docs/2026-10-review/screens và scripts/uiux/results). KHÔNG chạy bản gốc vì nó ghi đè file đã commit và gọi cổng 3001/3112/3113. Chép sang ${OUT}/tools/uiux/ (giữ import tương đối tới lib gốc hoặc chép lib), đổi: API gốc lấy từ biến UIUX_API (mặc định http://127.0.0.1:3221), base Mini App/web lấy từ biến, thư mục ảnh ${OUT}/screens/<app>/, file kết quả ${OUT}/screens/<app>.jsonl. Ghi cách chạy vào đầu file.`

const BRANCHES = [
  {
    key: 'D6-uiux-miniapp',
    model: undefined,
    prompt: `Nhánh UI/UX MINI APP 390px. ${CAPTURE_NOTE} Bật Vite Mini App: cd ${WT}/apps/miniapp && npx vite --host 127.0.0.1 --port 3223 (giữ server tới khi xong). Chụp MỌI route Mini App trong routes.mjs (và mọi <Route> trong apps/miniapp/src/components/app.tsx mà routes.mjs thiếu: thêm vào bản chép) ở 390x844, các trạng thái normal, empty, error, loading, offline nếu bộ chụp có; Chromium là chính, chụp thêm WebKit cho 8 màn luồng mua lõi (trang chủ, danh mục, chi tiết SP, giỏ, thanh toán, chuyển khoản, đơn hàng, chi tiết đơn). Xem từng ảnh (Read file png). Chấm từng màn theo thang 1–5 của docs/2026-10-18-launch-review/D7-uiux-visual.md, so với điểm cũ trong D7 (tăng/giảm, mục D7 nào đã sửa, mục nào còn). Kiểm: trạng thái rỗng/lỗi/đang tải/offline có chữ và lối thoát; vùng chạm < 44px (đo bằng pageMetrics/bounding box); kết quả axe (runAxe) vi phạm mức serious/critical; chữ Việt sai, thuật ngữ lẫn ("xu", "Điểm xanh" viết thường, emoji lẫn icon); số tiền/điểm định dạng sai; luồng mua lõi: đếm số chạm từ trang chủ tới đặt đơn COD thành công. Bỏ qua chỗ lạ do dữ liệu giả (D7 mục 2). Báo cáo ${OUT}/D6-uiux-miniapp.md: bảng điểm từng màn (cũ → mới), phát hiện theo định dạng brief kèm đường dẫn ảnh, top 10 việc nâng điểm nhiều nhất cho ít công nhất (file:line cần sửa, đều trong apps/miniapp).`,
  },
  {
    key: 'D7-uiux-admin-web',
    model: undefined,
    prompt: `Nhánh UI/UX ADMIN 1440px (+ web khách 1440 tham khảo). ${CAPTURE_NOTE} Bật web: cd ${WT}/apps/web && npx next dev -H 0.0.0.0 -p 3222 (dùng host localhost khi mở trình duyệt, không 127.0.0.1). Admin ở /admin (apps/web/src/app/admin/**, có tab theo vai trò). Chụp mọi tab/màn admin ở 1440x900 với persona ADMIN, và các vai trò nhân viên có màn admin (kế toán ACCOUNTANT, marketing, CSKH) nếu sessions.mjs có hoặc thêm được, các trạng thái normal/empty/error. Xem từng ảnh. Chấm thang 1–5 như D7. Kiểm: bảng dài có lọc/tìm/phân trang; hành động nguy hiểm (huỷ đơn, hoàn tiền, duyệt rút, Đã chi, khoá user) có xác nhận và màu danger; số tiền định dạng; nhãn trạng thái tiếng Việt (không lộ enum ACTIVE/PENDING); vai trò thấy đúng tab theo ma trận đã chốt; trạng thái rỗng/lỗi; bàn phím/tiêu điểm; axe serious/critical. Sau đó chụp nhanh 10 trang web khách chính ở 1440 (trang chủ, danh mục, chi tiết SP, giỏ, thanh toán, đơn hàng, tài khoản, /s/<slug>, /brand/<slug>, cộng đồng) để ghi lỗi gửi phiên web (KHÔNG sửa apps/web/src ngoài admin). Báo cáo ${OUT}/D7-uiux-admin-web.md: phần Admin (vùng UAT, sửa được) và phần "Lỗi web khách gửi phiên web" (route, khổ 1440, mô tả, đường dẫn ảnh, mức).`,
  },
  {
    key: 'D8-a11y-chu',
    model: 'sonnet',
    prompt: `Nhánh A11Y + CHỮ (tĩnh). Chạy node scripts/uiux/static-scan.mjs nếu không ghi đè file đã commit (đọc mã trước; nếu nó ghi vào scripts/uiux/results thì chép sang ${OUT}/tools/ và đổi đường ra ${OUT}/static/). Quét apps/miniapp/src và apps/web/src/app/admin: (1) thuật ngữ: grep "xu\\b", "Xu ", "điểm xanh" sai hoa, "Điểm Xanh" đúng; tiền định dạng thủ công thay formatVnd; "100%"; email/hotline cứng; (2) nút chỉ có icon thiếu aria-label/title; ảnh thiếu alt; input thiếu label; (3) vùng chạm: phần tử bấm được có height/minHeight < 44 hoặc padding nhỏ (IconButton size), (4) tương phản: tính tỉ lệ WCAG cho các cặp màu chữ/nền trong packages/design-tokens và tailwind config của miniapp (viết script node nhỏ trong ${OUT}/tools/), báo cặp < 4.5:1 (chữ thường) hoặc < 3:1 (chữ lớn/icon) kèm nơi dùng; (5) chữ Việt: lỗi chính tả, dấu, câu cụt, chữ Anh lộ ra khách (Loading, Error, Submit, enum), giọng văn không nhất quán (bạn/quý khách). Chỉ báo chỗ khách hoặc nhân viên thật thấy. Báo cáo ${OUT}/D8-a11y-chu.md theo định dạng brief, gom theo file, có path:line.`,
  },
  {
    key: 'D9-hieu-nang',
    model: 'sonnet',
    prompt: `Nhánh HIỆU NĂNG. (1) Bundle: đọc scripts/ci/bundle-budget.cjs; build Mini App một lần (cd ${WT}/apps/miniapp && npm run -s build, xem uptime trước, load > 40 thì chờ) rồi chạy budget; ghi kích thước chunk đầu vào, chunk lớn nhất, so ngân sách; chunk nào kéo thư viện nặng (đọc stats/rollup output). Không next build. (2) Thời gian tải màn chính: bật API riêng có log truy vấn Prisma nếu code hỗ trợ (grep PRISMA_LOG / log: [ 'query' ] trong apps/api/src; nếu không hỗ trợ bằng biến môi trường thì không sửa mã, dùng pg_stat_statements: bật bằng cách tạo cụm Postgres riêng 25434 với ${WT}/docs/2026-10-20-uat/tools/pg-native.sh, nạp DB bằng CREATE DATABASE tubutree_perf TEMPLATE? không được vì khác cụm, nên migrate deploy + seed.ts + seed-reference.ts --with-business-defaults vào cụm 25434, khởi động lại cụm với -c shared_preload_libraries=pg_stat_statements nếu bản embedded có, nếu không có thì dùng log_min_duration_statement=0 + log_statement và đếm trong log). Bật API thứ hai bằng ${WT}/docs/2026-10-20-uat/tools/api-up.sh 3229 tubutree_perf 9 25434. Đo các endpoint màn chính (trang chủ /home hoặc tương đương, /products, /products/:slug, /cart, /checkout/quote, /orders, /me/loyalty, /feed, /storefront/:slug, các endpoint admin dashboard/orders list) với token dev (apps/api/scripts/dev-token.ts, truyền DATABASE_URL và JWT_ACCESS_SECRET từ apps/api/.env): số truy vấn SQL mỗi request, thời gian p50 qua 20 lần gọi. Báo N+1 (số truy vấn tăng theo số dòng) kèm path:line vòng lặp gây ra. (3) Đọc mã tìm N+1 rõ ràng ở service danh sách (findMany rồi await trong vòng for/map). Cuối việc: api-up.sh stop 3229, pg-native.sh stop 25434. Báo cáo ${OUT}/D9-hieu-nang.md theo định dạng brief, có số đo.`,
  },
  {
    key: 'D10-docker-env',
    model: 'sonnet',
    prompt: `Nhánh DOCKER + BIẾN MÔI TRƯỜNG (KHÔNG SSH, KHÔNG deploy, KHÔNG push image). (1) Đối chiếu biến môi trường: liệt kê mọi biến code đọc (grep process.env và config.get/getOrThrow trong apps/api/src, env.validation.ts; NEXT_PUBLIC_* và process.env trong apps/web; import.meta.env trong apps/miniapp), so với apps/api/.env.example, .env.production.example (nếu có), docker-compose.prod.yml, docker-compose.vietnix.yml, docs/GO-LIVE-KEYS.md, docs/launch/deploy-rollback-runbook.md mục 1.3. Bảng: biến | code đọc ở path:line | có trong example? | compose? | GO-LIVE-KEYS? | runbook 1.3? | bắt buộc ở prod? (env.validation). Báo biến thiếu/thừa/lệch tên. (2) docker compose -f docker-compose.prod.yml config với file env mẫu (tạo file env giả trong ${OUT}/tools/, không có bí mật thật) để kiểm cú pháp, image, healthcheck, giới hạn CPU (API_CPUS), volume. (3) Build image cục bộ, lần lượt (không song song), chỉ khi uptime load < 30 (chờ nếu cao, tối đa 30 phút rồi ghi "chưa kiểm chứng"): docker build -f <Dockerfile api> -t tubu-uat-api:local . và tương tự web, theo đúng lệnh trong runbook/deploy script. Ghi thời gian, kích thước image, lỗi. Chạy thử container api: docker run --rm với env trỏ Postgres UAT (host.docker.internal:25432 có thể không tới được vì Postgres chỉ nghe 127.0.0.1; nếu không tới được thì chỉ kiểm container khởi động tới bước validate env và ghi lại). Xong thì docker rmi -f hai image tạm. (4) Runbook khớp mã: từng lệnh trong runbook mục 0.1, 1.0, 1.3, 3.4 có tồn tại script/file/tên service đúng không. Báo cáo ${OUT}/D10-docker-env.md theo định dạng brief.`,
  },
]

phase('Discover')
const res = await parallel(BRANCHES.map((b) => () =>
  agent(`${COMMON}\n\n${b.prompt}`, { label: b.key, phase: 'Discover', ...(b.model ? { model: b.model } : {}) })
    .then((text) => ({ key: b.key, text }))))
return res.filter(Boolean)
