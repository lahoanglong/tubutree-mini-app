export const meta = {
  name: 'review-1028-gd1',
  description: 'GĐ1 review 2026-10-28: dựng lane, chụp màn, đi luồng, đo hiệu năng, quét tĩnh, bản đồ lối vào',
  phases: [
    { title: 'Hạ tầng + tĩnh', detail: 'lane 5/6, build + bundle, quét tĩnh, lối vào và mẫu Shopee/Grab' },
    { title: 'Chụp + luồng', detail: 'chụp Mini App, chụp web/admin, 6 luồng Mini App, 6 luồng web' },
    { title: 'Hiệu năng chạy thật', detail: 'Lighthouse, màn đầu Mini App, p95 API' },
  ],
}

const W = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028'
const R = W + '/docs/2026-10-28-review'
const PRE = `Đọc trước và tuân thủ: ${R}/tools/gd1-brief.md (luật chung: môi trường, cổng, điều cấm). Worktree: ${W}. R/ = ${R}.\n\n`
const OUT = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    files: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string', description: 'tối đa 25 dòng, số thật' },
    blockers: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'files', 'summary', 'blockers'],
}

const S_PROMPT = PRE + `Việc: dựng hạ tầng cho chụp ảnh và đi luồng, rồi mở rộng bộ chụp. Không sửa mã sản phẩm.

1. Build API của worktree: \`pnpm --filter @tubutree/shared-types build\`, rồi build apps/api (xem package.json, ra apps/api/dist). Prisma client đã generate.
2. Postgres nhúng cổng 25432 (\`docs/2026-10-20-uat/tools/pg-native.sh start 25432\`; dữ liệu ở ~/.cache/tubu-uat/data-25432, có DB mẫu \`tubutree_uat_tpl\` dựng 25/10, schema cũ hơn main). Redis 26379: đọc README bộ khung xem cách bật; nếu dùng Docker thì phải \`--rm --tmpfs\`.
3. Bật lane 5 và lane 6 có web từ CHÍNH worktree này (\`docs/2026-10-20-uat/tools/uat-harness/lane-up.sh 5 --web --fresh\`, tương tự 6). DB lane copy từ mẫu cũ nên phải đưa lên schema main: chạy \`npx prisma migrate deploy\` trong apps/api với DATABASE_URL của lane (lấy ở state/lane-N/lane.env), hoặc dựng lại mẫu bằng build-template.sh nếu cách trên không được. Kiểm \`_prisma_migrations\` đủ như thư mục migrations. Bật lại API sau migrate nếu cần.
4. Nạp dữ liệu mẫu cho cả hai lane bằng \`R/tools/seed-data.mjs\` (viết cho lane 4 ngày 25/10; sửa để nhận số lane, chạy được trên schema mới). Bật các cờ đổi rác, chat, tích điểm đơn sàn, nhận tại điểm như đợt trước. Có đủ persona returning, new, guest, ctv, dealer, staff, admin (personas.json của bộ khung). Ghi \`R/tools/params-l5.json\`, \`params-l6.json\`.
5. Dựng lại \`R/tools/routes.json\` cho lane 5 bằng \`R/tools/build-routes.mjs\` (sửa cho đọc params-l5.json). Nguồn đúng là \`packages/app-core/src/route-map.json\` và \`apps/miniapp/src/components/app.tsx\` hiện tại; mọi route Mini App và trang web khách phải có mặt. Thêm danh sách tab admin chủ dùng hằng ngày (đơn hàng, sản phẩm, khách, quầy đổi rác, chat, tổng quan, mã giảm, CTV/đại lý; đọc \`apps/web/src/app/admin\` để lấy đúng tên tab).
6. Mở rộng \`R/tools/capture.mjs\`:
   - \`--lane N\` (mặc định 5), đọc params/routes theo lane.
   - Khổ mới \`mini1280\` (Mini App ở 1280×800).
   - Mỗi khổ/trạng thái ghi \`R/screens/index-<nhãn>.jsonl\` riêng (hai tiến trình chụp chạy song song).
   - Trạng thái: \`ok\`, \`loading\` (API trễ 4 giây, chụp ở 700 ms), \`slow5s\` (mọi /api/ trễ 5 giây; chụp s1 ở 1,5 giây và s2 ở 6,5 giây), \`error500\` (GET /api/ sau đăng nhập trả 500 JSON), \`offline\` (sau đăng nhập mọi /api/ bị abort \`internetdisconnected\`), \`empty\` (GET /api/ trả JSON đã thay mọi mảng thành []), \`longtext\` (thay giá trị chuỗi của khoá name/title/productName/fullName/displayName bằng câu tiếng Việt 120 ký tự). Bỏ \`flagoff\`.
   - Mỗi ô ghi thêm: \`pageErrors\` (lỗi JS không bắt), \`blank\` (thân trang dưới 20 ký tự chữ và không ảnh), \`hasRetry\` (có nút chứa "Thử lại"), \`hasSkeleton\` (có phần tử class chứa skeleton/shimmer/animate-pulse), giữ consoleErrors, apiErrors, axe, smallTargets.
   - \`--keys\` chọn danh sách màn. Đặt hằng KEY_SCREENS: trang chủ, danh mục, tìm kiếm, chi tiết SP, giỏ, thanh toán, danh sách đơn, chi tiết đơn, Điểm Xanh, Ưu đãi, Vườn Xanh, đổi rác, chat, Cá nhân, CTV, đại lý, Ví Tubu (dùng khoá thật trong routes.json).
   - Chạy thử 2 ô mỗi khổ (mini375, mini1280, web375, web1280, admin1280) và 1 ô mỗi trạng thái mới; tự mở xem các ảnh thử bằng Read.
7. Ghi \`R/tools/LANES.md\`: cổng, persona, params, lệnh chụp mẫu, cách bật lại lane, cách tạo đơn/duyệt đổi rác bằng công cụ bộ khung. Để lane 5 và 6 CHẠY khi xong (agent sau dùng).

Trả về: ok=true khi lane 5 và 6 đều lên (API, web, Mini App trả 200), seed xong, chụp thử đạt. summary gồm số route Mini App/web/admin trong routes.json, số migration, persona đã có.`

const P1_PROMPT = PRE + `Việc: đo kích thước bản build và quét hiệu năng tĩnh. Không cần lane. Ghi \`R/03-perf-build.md\` và script chạy lại \`R/tools/perf/bundle-report.mjs\` (in JSON số đo, dùng để so trước/sau cho từng gói sửa).

1. Mini App: build production (\`vite build\` theo script trong apps/miniapp/package.json, ra apps/miniapp/www). Chạy \`node scripts/ci/bundle-budget.cjs apps/miniapp/www\`. Ghi entry KB, tổng KB (raw và gzip), 10 file lớn nhất, route nào được lazy-load, route nào nằm trong entry.
2. Web: \`next build\` trong apps/web với \`NEXT_PUBLIC_API_BASE_URL=http://localhost:3251/api\` và \`API_BASE_URL\` cùng giá trị (lane 5 có thể chưa lên; nếu build cần API thì ghi lại và dùng giá trị khác hợp lý). Ghi bảng First Load JS từng route khách (/, /san-pham, /san-pham/[slug], /gio-hang, /thanh-toan, /tai-khoan, /diem-xanh hoặc tương đương, /uu-dai, /vuon-xanh, /doi-rac…), chunk dùng chung lớn nhất. Giữ nguyên thư mục .next (agent sau chạy \`next start\` từ đây).
3. Quét tĩnh, mỗi mục có file:dòng:
   - Ảnh: \`<img>\` không width/height hay aspect-ratio (gây CLS), ảnh sản phẩm không qua biến đổi kích thước (Cloudinary/next/image), thiếu loading="lazy" ở danh sách.
   - N+1 ở API: chạy \`docs/2026-10-20-uat/tools/perf/nplus1-scan.py\` (hoặc nplus1-scan2.py) trên apps/api/src, lọc cho endpoint trang chủ, danh sách, chi tiết sản phẩm, giỏ, thanh toán, đơn hàng; tự đọc mã để xác nhận.
   - Render thừa: provider/context to bọc cả app đổi giá trị mỗi render, list không key ổn định, effect gọi API lặp, React Query refetch thừa ở màn chính. Chỉ ghi chỗ đã đọc mã.
4. So với ngưỡng trong bundle-budget.cjs và mục tiêu entry < 450 KB.

Trả về: ok, files, summary (số entry/tổng Mini App, First Load JS trang chủ/danh sách/chi tiết/thanh toán web, 5 phát hiện tĩnh nặng nhất).`

const SCAN_PROMPT = PRE + `Việc: quét tĩnh, chỉ đọc mã, trả bảng path:line. Ghi \`R/04-quet-tinh.md\`.

1. Chạy \`node scripts/uiux/static-scan.mjs\` (đọc đầu file để biết tham số) cho apps/miniapp và apps/web; tóm tắt số theo loại.
2. Error boundary: Mini App (\`apps/miniapp/src/components/app.tsx\` và bọc quanh router) có ErrorBoundary chung không, từng route có không, nút thử lại có không. Web: liệt kê mọi thư mục có \`page.tsx\` dưới apps/web/src/app (trừ admin), ghi có \`error.tsx\`/\`loading.tsx\` ở chính segment hay tổ tiên gần nhất nào, có \`global-error.tsx\`, \`not-found.tsx\` không.
3. Màu cứng không qua token: đếm mã màu hex/rgb/hsl và lớp Tailwind màu cứng (ví dụ bg-[#...], text-gray-500 nếu dự án có token thay thế; xem packages/design-tokens để biết token) trong apps/miniapp/src và apps/web/src (bỏ test, admin riêng một dòng). Top 20 file.
4. Lời lỗi không có nút thử lại: chỗ hiện trạng thái lỗi (ErrorState, "Không tải được", isError) mà không có hành động thử lại. Top 30 chỗ.
5. Spinner thay vì skeleton ở màn chính (trang chủ, danh mục, chi tiết SP, giỏ, thanh toán, đơn, Điểm Xanh, Ưu đãi, Vườn Xanh, Cá nhân): ghi màn dùng Spinner/Loading toàn trang.
6. Vùng chạm nhỏ trong mã: nút/icon có kích thước < 44px (h-8, w-8, size 32…) ở Mini App và web khách.

Không đề xuất sửa, chỉ ghi số và vị trí. Trả về: ok, files, summary (số theo từng mục).`

const ENTRY_PROMPT = PRE + `Việc: vai PM + Product Designer, chỉ đọc mã. Ghi \`R/05-loi-vao-va-mau.md\`.

A. Bản đồ lối vào. Với mỗi việc chính của khách: mua hàng (tìm, danh mục, giỏ), theo dõi đơn, Điểm Xanh và ưu đãi (hạng, quà, mã giảm), Vườn Xanh, điểm danh, đổi rác lấy quà, chat CSKH, CTV (đăng ký, gian hàng, hoa hồng), đại lý, Ví Tubu; và việc phụ: mua lại, gói định kỳ, flash sale/giờ vàng, mua chung, nhãn hàng, học viện, cộng đồng, quét QR đơn sàn, yêu thích, địa chỉ, thông báo. Ghi cho Mini App và web khổ điện thoại RIÊNG: số chạm ít nhất từ trang chủ, số chạm từ thanh đáy, đường đi (vd "Cá nhân > Đơn hàng"), file:dòng của lối vào. Đánh dấu việc nào > 2 chạm, việc nào CHỈ vào được bằng link (route có trong app.tsx/route-map.json nhưng không có navigate/Link nào trỏ tới từ màn khác), việc nào bị cờ ẩn (ghi cờ). Nguồn: apps/miniapp/src/components/app.tsx, thanh đáy, trang chủ, trang Cá nhân; apps/web/src/app và thanh đáy web; packages/app-core/src/route-map.json.
B. Đối chiếu mẫu tương tác (ghi có / một phần / thiếu, kèm file:dòng, Mini App và web riêng):
   Shopee: ô tìm kiếm dính đầu trang, có lịch sử và gợi ý; lưới lối tắt dưới banner; thẻ sản phẩm ảnh vuông, giá nổi, số đã bán, nhãn giảm giá; trang SP có thanh mua dính đáy, chọn phân loại bằng bottom sheet có ảnh và tồn kho; giỏ chọn từng món, tổng tiền dính đáy; thanh toán một trang (địa chỉ, giao hàng, mã giảm, phương thức, tổng); tab cá nhân có hàng trạng thái đơn kèm số đếm, ví, điểm, mã giảm.
   Grab: trang chủ lấy hành động làm trung tâm, ít chữ; theo dõi đơn dạng dòng thời gian có mốc dự kiến; điểm và hạng hiện rõ tiến độ lên hạng; skeleton thay spinner; phản hồi tức thì (toast, cập nhật lạc quan) sau thao tác (thêm giỏ, yêu thích, điểm danh, áp mã).
C. Trang chủ: liệt kê các khối theo thứ tự hiển thị (Mini App và web), mỗi khối một dòng: tên, điều kiện hiện, hành động chính. Nhận xét ngắn: khối nào chiếm chỗ mà ít giá trị.

Chỉ ghi điều đã đọc mã. Trả về: ok, files, summary (việc > 2 chạm, việc chỉ vào bằng link, mẫu thiếu quan trọng nhất).`

const C1_PROMPT = PRE + `Việc: chụp toàn bộ Mini App trên lane 5 bằng \`R/tools/capture.mjs\` (đã được mở rộng; đọc \`R/tools/LANES.md\` trước). Không sửa mã sản phẩm. Chỉ sửa capture.mjs khi gặp lỗi của công cụ, và chỉ phần Mini App (một agent khác đang chạy capture.mjs cho web; sửa xong phải chạy lại được cho cả hai).

1. \`--phase mini375 --state ok\`: mọi route × persona trong routes.json.
2. \`--phase mini1280 --state ok\`: mọi route, persona returning và guest.
3. Trạng thái trên KEY_SCREENS, persona returning, khổ mini375: loading, slow5s, error500, offline, empty, longtext.
4. Lỗi một ô thì chạy lại ô đó một lần; vẫn lỗi thì ghi lại, đi tiếp.
5. Tổng hợp từ \`R/screens/index-mini*.jsonl\` vào \`R/01-chup-mini.md\`: số ô, số ảnh; màn trắng (blank); pageErrors; consoleErrors (gom theo câu, đếm); apiErrors; axe (gom theo rule, mức serious/critical, đếm màn); smallTargets (top 15 màn); trạng thái lỗi/mất mạng KHÔNG có nút thử lại (danh sách màn); trạng thái tải KHÔNG có skeleton; longtext tràn chữ (mở ảnh để xem).
6. Tự mở xem bằng Read ít nhất: s1 của mọi KEY_SCREENS ở ok và error500 và offline, mini1280 của trang chủ và chi tiết SP. Ghi điều thấy được (vỡ bố cục, chữ tràn, nút mất, ô trống).

Trả về: ok, files, summary (số ô, số màn trắng, số màn lỗi không thử lại, top 5 lỗi console, top 5 axe).`

const C2_PROMPT = PRE + `Việc: chụp web khách và admin trên lane 5 bằng \`R/tools/capture.mjs\` (đã được mở rộng; đọc \`R/tools/LANES.md\` trước). Không sửa mã sản phẩm. Chỉ sửa capture.mjs khi gặp lỗi của công cụ, và chỉ phần web/admin (một agent khác đang chạy capture.mjs cho Mini App; sửa xong phải chạy lại được cho cả hai).

1. \`--phase web375 --state ok\` và \`--phase web1280 --state ok\`: mọi route × persona trong routes.json.
2. \`--phase web768 --state ok\`: chỉ KEY_SCREENS, persona returning.
3. Trạng thái trên KEY_SCREENS, persona returning, khổ web375: loading, slow5s, error500, offline, empty, longtext.
4. Admin: \`--phase admin1280\` và \`admin375\`, các tab chủ dùng hằng ngày, persona admin (và staff cho quầy đổi rác).
5. Lỗi một ô thì chạy lại ô đó một lần; vẫn lỗi thì ghi lại, đi tiếp.
6. Tổng hợp từ \`R/screens/index-web*.jsonl\` và \`index-admin*.jsonl\` vào \`R/01-chup-web.md\`: như mẫu: số ô, màn trắng, pageErrors, consoleErrors (gom, đếm), apiErrors, axe (rule serious/critical), smallTargets top 15, trạng thái lỗi/mất mạng không có nút thử lại, tải không skeleton, longtext tràn.
7. Tự mở xem bằng Read ít nhất: s1 của mọi KEY_SCREENS ở web375 ok, error500, offline; web1280 trang chủ, danh sách, chi tiết SP, giỏ, thanh toán, Cá nhân; admin1280 mọi tab đã chụp. Ghi điều thấy được.

Trả về: ok, files, summary (số ô, số màn trắng, số màn lỗi không thử lại, top 5 lỗi console, top 5 axe, điều thấy ở admin).`

const flowPrompt = (app) => PRE + `Việc: đi trọn 6 luồng như khách thật trên ${app === 'mini' ? 'Mini App (khổ 375)' : 'web khổ 375 (thêm thanh toán và Cá nhân ở 1280)'}, lane 6 (đọc \`R/tools/LANES.md\`). Không sửa mã sản phẩm. Viết script Playwright chạy lại được ở \`R/tools/flows/${app}-<số>.mjs\` (dùng ${app === 'mini' ? 'open() trong docs/2026-10-20-uat/tools/uat-harness/miniapp-session.mjs' : 'openWeb() trong docs/2026-10-20-uat/tools/uat-harness/web-session.mjs'}), bấm như người dùng (theo chữ hiển thị/vai trò, không gõ URL trừ khi khách thật cũng phải gõ). Mỗi bước chụp \`R/screens/flows/${app}/<luồng>/<nn>-<bước>.png\`.

Đếm "chạm" = mỗi lần bấm/chạm/chọn (gõ một ô chữ tính 1). Ghi thời gian chờ mỗi bước > 1 giây.

Luồng:
1. Khách mới vào lần đầu (persona new, rồi guest): thấy gì ở màn đầu; từ trang chủ tìm lối vào cho 7 việc chính: mua hàng, theo dõi đơn, Điểm Xanh và ưu đãi, Vườn Xanh, đổi rác lấy quà, chat CSKH, CTV/đại lý. Ghi số chạm ít nhất cho mỗi việc, việc nào > 2 chạm hoặc không tìm thấy.
2. Tìm và mua (returning): tìm theo từ khoá, xem kết quả, mở SP, chọn phân loại, thêm giỏ, vào giỏ, áp mã giảm, thanh toán COD tới màn đặt thành công.
3. Theo dõi đơn và mua lại: tìm đơn vừa đặt, xem chi tiết (có dòng thời gian/mốc dự kiến không), bấm mua lại tới giỏ.
4. Điểm Xanh, hạng, Vườn Xanh, điểm danh: xem điểm, tiến độ lên hạng, đổi quà/nhận mã, vào Vườn Xanh tưới cây, điểm danh hôm nay.
5. Đổi rác lấy quà: đăng ký gửi rác, xem trạng thái; nhân viên xác nhận (dùng công cụ bộ khung hoặc persona staff ở quầy); khách thấy điểm cộng.
6. CTV/đại lý: khách đăng ký CTV; persona ctv xem gian hàng, chia sẻ, hoa hồng, Ví Tubu; persona dealer xem trang đại lý.

Ghi \`R/06-luong-${app}.md\`: mỗi luồng một bảng (bước, chạm cộng dồn, màn, chờ, ghi chú khựng), tổng số chạm, chỗ khách bị khựng (CTA không rõ, phải đoán, ngõ cụt, lỗi, chữ khó hiểu, nút bị che), so với mẫu Shopee/Grab tương ứng (chỉ điều chắc). Tự mở xem ảnh các bước khựng. Luồng nào không đi hết được thì ghi rõ dừng ở đâu và vì sao.

Trả về: ok, files, summary (tổng chạm từng luồng, 8 chỗ khựng nặng nhất).`

const P2_PROMPT = PRE + `Việc: đo hiệu năng chạy thật làm số TRƯỚC (baseline) cho các gói sửa. Lane 5 đang chạy (đọc \`R/tools/LANES.md\`). Bản build Mini App ở apps/miniapp/www và web ở apps/web/.next đã có (từ agent build; đọc \`R/03-perf-build.md\`). Chỉ dùng cổng 3600–3619. Ghi \`R/03-perf-runtime.md\` và \`R/perf/baseline.json\`; script chạy lại ở \`R/tools/perf/\` (một lệnh \`node R/tools/perf/run-all.mjs --out <file>\` ra JSON, để mỗi gói đo sau).

Ghi \`top -l 1 -n 0\` (load) trước mỗi phép đo. Mỗi số đo chạy 3 lần, lấy trung vị.

1. Web: \`next start\` cổng 3601 với API lane 5 (có thể cần build lại nếu biến NEXT_PUBLIC_API_BASE_URL lúc build không trỏ lane 5; nếu build lại thì ghi). Lighthouse mobile (thử \`npx lighthouse\`; nếu không chạy được thì Playwright + CDP giả lập Moto G4/4G chậm, CPU ×4, và web-vitals) cho: trang chủ, danh sách SP, chi tiết SP, thanh toán (đăng nhập persona returning qua web-session, giỏ có hàng). Số: LCP, CLS, TBT, INP (đo bằng một thao tác bấm thật, vd thêm giỏ), FCP, điểm Performance nếu có.
2. Mini App: phục vụ apps/miniapp/www tĩnh (vite preview cổng 3603, API lane 5; xem cách bộ khung đặt VITE_API_BASE_URL; nếu bản build trỏ api.tubutree.com thì build lại với biến lane, KHÔNG gọi PROD). Playwright 375 mobile, CPU ×4, 4G chậm: thời gian tới FCP, LCP, tới khi trang chủ có thẻ sản phẩm đầu tiên; với persona returning và guest.
3. API: p50/p95/p99 bằng autocannon (\`npx autocannon\`, 20 giây, 10 kết nối, header bypass throttle theo lane.env) cho GET trang chủ (endpoint Mini App gọi khi mở trang chủ, xem tab Network trong index-mini375.jsonl hoặc mã), danh sách SP, chi tiết SP, config công khai; thêm \`/home/me\` hoặc tương đương có token returning. Đếm số câu SQL mỗi request: chạy một API phụ cổng 3611 trỏ DB lane 5 với log query Prisma bật (xem apps/api cách bật), gọi mỗi endpoint một lần, đếm. Ghi rõ dữ liệu lane ít nên p95 chỉ để so tương đối.
4. Ghi bảng số + nhận xét ngắn: màn nào chậm nhất, nguyên nhân nghi (bundle, ảnh, API, waterfall request). Dừng mọi tiến trình mình mở khi xong (kill đúng cổng 3600–3619).

Trả về: ok, files, summary (bảng số trung vị chính).`

phase('Hạ tầng + tĩnh')
const sP = agent(S_PROMPT, { label: 'ha-tang-lane', phase: 'Hạ tầng + tĩnh', schema: OUT, agentType: 'worker' })
const p1P = agent(P1_PROMPT, { label: 'perf-build', phase: 'Hạ tầng + tĩnh', schema: OUT, agentType: 'worker' })
const scanP = agent(SCAN_PROMPT, { label: 'quet-tinh', phase: 'Hạ tầng + tĩnh', schema: OUT, agentType: 'scout' })
const entryP = agent(ENTRY_PROMPT, { label: 'loi-vao-mau', phase: 'Hạ tầng + tĩnh', schema: OUT, model: 'sonnet' })

const s = await sP
log(`Hạ tầng: ok=${s && s.ok}`)
let caps = []
if (s && s.ok) {
  caps = await parallel([
    () => agent(C1_PROMPT, { label: 'chup-mini', phase: 'Chụp + luồng', schema: OUT, agentType: 'worker' }),
    () => agent(C2_PROMPT, { label: 'chup-web-admin', phase: 'Chụp + luồng', schema: OUT, agentType: 'worker' }),
    () => agent(flowPrompt('mini'), { label: 'luong-mini', phase: 'Chụp + luồng', schema: OUT, agentType: 'worker' }),
    () => agent(flowPrompt('web'), { label: 'luong-web', phase: 'Chụp + luồng', schema: OUT, agentType: 'worker' }),
  ])
} else {
  log('Hạ tầng lỗi: bỏ qua chụp và luồng')
}
const [p1, scan, entry] = await Promise.all([p1P, scanP, entryP])
let p2 = null
if (s && s.ok && p1 && p1.ok) {
  phase('Hiệu năng chạy thật')
  p2 = await agent(P2_PROMPT, { label: 'perf-runtime', phase: 'Hiệu năng chạy thật', schema: OUT, agentType: 'worker' })
}
return { s, p1, scan, entry, caps, p2 }
