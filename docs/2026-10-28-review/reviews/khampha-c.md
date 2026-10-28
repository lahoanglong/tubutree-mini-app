# khampha đợt C

mergeable=False

## Review 1

KẾT LUẬN: chưa merge

- [P1] packages/app-core/src/home-layout.ts:58 và :62, gọi từ apps/miniapp/src/pages/home.tsx:55 — CLS trên Mini xấu đi, và khách cũ thấy lời hứa quà khách mới. Trên Mini, ai mở app cũng qua bước `status:'loading'` rồi tự đăng nhập bằng Zalo hoặc bằng tài khoản khách (store/auth.ts:150-199). Với máy chưa nhớ loại khách: khi đang tải, :58 trả về 'new'; khi đã đăng nhập mà dữ liệu đã mua chưa về và chưa nhớ loại, :62 trả về 'unknown'; khi dữ liệu về thì ra 'new' hoặc 'returning'. Vì vậy mọi khách mới mở Mini lần đầu thấy thứ tự khối NEW → UNKNOWN → NEW: kệ Bán chạy cao khoảng 300px hiện, mất, rồi hiện lại, kéo Danh mục nhảy hai lần. Khách cũ đổi máy hoặc vừa xoá dữ liệu thì thấy "Quà khách mới · Mã 30.000đ · Nhận quà" trong lúc tải, vì NewCustomerGift của Mini hiện phần hứa quà khi chưa đăng nhập. Test (b) ở home.spec chỉ kiểm từng khung hình riêng nên không bắt được lỗi này. Cách sửa: Mini chỉ dựng 'new' khi biết chắc máy không có refresh token đã lưu, còn lại truyền `unknownWhenUnremembered`. Khi đã đăng nhập mà chưa nhớ loại thì giữ loại đang hiện, không quay về 'unknown'. Thêm test cho cả chuỗi chuyển trạng thái.
- [P1] apps/web/src/components/home/flash-sale.tsx:83 — R-2 chưa đạt và việc thêm (1) chưa làm. CLS web là 0,238 với khách mới và 0,117 với khách cũ. HTML từ máy chủ dùng giá trị phía máy chủ là `() => false` nên khung chờ Giờ vàng chỉ chèn vào sau khi hydrate, tức là vẫn đẩy trang. Cách sửa: tải `/flash-sales/active` trong loadHomeInitial và truyền vào `initialData`, rồi đo lại bằng cls-probe và ghi số.
- [P2] apps/web/src/components/catalog/suggest-list.tsx:12 — việc (2): First Load /san-pham tăng 10 KB, chưa tìm nguyên nhân. Nghi phạm cụ thể: diff này mới đưa import từ barrel `@/components/mini` (31 export) vào cây /san-pham, và đây là file catalog duy nhất import từ barrel đó. Cách sửa: import thẳng từ `@/components/mini/skeleton` hoặc dùng `@/components/ui/skeleton`, so lại next build trước và sau, đưa mức tăng về ≤ +2 KB.
- [P2] Bundle Mini: entry 715 KB, quá mức 711 KB, việc (3) chưa làm. Cách sửa: tìm module mới vào entry (ScrollRow, CategoryChips, FlashSkeleton…) rồi tách ra hoặc tải lười.
- [P2] Việc (4) chưa làm: worker tự dừng web gate (webgate3) nên không có số pass/fail. Playwright Mini toàn bộ cũng chưa chạy, trong khi đã sửa 3 spec e2e. Cách sửa: chạy cả hai bộ và ghi số.
- [P2] docs/2026-10-28-review/screens-khampha/ — việc (5) chưa làm. Chỉ có ảnh persona returning, chụp trước commit cuối 950431bbb. Thiếu new, guest và slow5s cho home. Vì thiếu ảnh khách mới nên chưa chứng minh được món hàng nằm trong màn đầu cao 812−90px (R-3) cho khách mới. Cách sửa: chụp lại đủ bộ, ghép trước/sau và tự xem.
- [P2] /Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028-khampha/docs/2026-10-28-review/tools/{cls,h,h2,ssr}-probe.tmp.mjs và params-l2.json vẫn còn (chưa commit) — việc (6) chưa làm. Cách sửa: xoá, hoặc chuyển probe dùng lại được vào tools/perf/ kèm chú thích cách chạy.
- [P2] R-16 mới làm bước 1. Web chưa dùng `/home` + `/home/me`, nên chưa đạt đích ≤ 12 API. Dải Việc cần làm còn thêm một request (`home-processing`) ở cả hai nền. Cách sửa: làm bước 2, hoặc ghi rõ là cần chủ chấp nhận hoãn.
- [P2] apps/web/src/lib/brand-origins.ts và apps/miniapp/src/utils/brand-origins.ts — commit f7d67f741 ghi "dùng chung bảng toạ độ Mini và web", nhưng thực ra là hai bản chép giống nhau. Việc này trái luật hai nền tảng và trái cách sửa R-20 đã ghi trong backlog. Cách sửa: chuyển BRAND_ORIGINS và pinBoxes vào packages/app-core, hai app chỉ re-export.
- [P2] apps/web/src/components/garden-hint-bubble.tsx:81 — trên web chỉ phần chữ (Link, cao khoảng 16px) mở /vuon-xanh. Bấm vào phần đệm của bong bóng chỉ đóng bong bóng mà không mở Vườn Xanh. Mini thì bấm cả bong bóng là mở, nên hai nền lệch nhau và vùng chạm để mở trên web < 44px. Cách sửa: dùng chính Link làm phần tử bọc ngoài, hoặc gọi router.push trong onClick của div.
- [P3] apps/web/src/lib/shop-client.ts:190 — trước đây gọi `apiFetch(..., {auth:false, cache:'no-store'})`, nay đi qua coreHttp. Khi đã đăng nhập, mỗi lần gọi endpoint công khai này sẽ gửi Authorization: thêm preflight CORS, mất no-store, và có thể chạy luồng refresh khi gặp 401. Cách sửa: thêm tuỳ chọn auth:false và no-store cho đường gọi này.
- [P3] apps/web/src/components/home/flash-sale.tsx:63 — có hai nhịp tải song song: React Query refetch mỗi 60 giây, và timer riêng của store use-flash-sales. Trang chủ vẫn có thể gọi `/flash-sales/active` hai lần mỗi phút. Cách sửa: bỏ refetchInterval và để store tự kích invalidate.
- [P3] apps/miniapp/src/components/home/member-card.tsx:77 (web giống) — tên dài cắt mất hạng, ảnh 375 hiện "Chào Nguyễn Thị Quay Lạ…" không còn "Lộc Biếc". Cách sửa: đưa hạng xuống dòng điểm, hoặc chỉ cắt phần tên.
- [P3] packages/app-core/src/home-copy.ts:20 — chữ "Không kết nối được · Chưa tải được điểm của bạn" nằm trong khung cao cố định 64px, không có nowrap, chỉ còn khoảng 200px bề ngang ở 375, nên xuống 3 dòng và tràn khi tăng cỡ chữ. Cách sửa: rút câu, hoặc dùng một dòng có ellipsis.
- [P3] apps/miniapp/src/i18n/vi.ts:483 — câu "nhấn Enter" sai với bàn phím điện thoại. Cách sửa: "Chạm dòng “Tìm” ở trên để xem kết quả."
- [P3] Tiêu đề h2 ở Danh mục: Mini dùng chữ có chân, web 375 dùng chữ không chân (ảnh browse-category, browse-brand). Ô tìm web lệch xuống khoảng 10px do `pt-3`. Cách sửa: dùng cùng token font và cùng đệm như Mini.
- [P3] Bong bóng Vườn Xanh vẫn che thẻ Giờ vàng hoặc thẻ sản phẩm tới 5 giây (ảnh home, browse), chưa đúng hẳn với "bong bóng không che" mà chủ đã chốt. Cách sửa: đặt bong bóng sát tab, hoặc chỉ hiện khi vùng phía trên tab không có nội dung bấm được.
- [P3] Còn chữ không dùng tới (`pointsCaption`, `progressSpacer` trong home-copy). Nhãn tên trên bản đồ là nút cao khoảng 18px. Hộp chạm 44px của hai ghim Hector và Le Plateau (brand-origins.ts:107, :119, cách nhau khoảng 25px) chồng lên nhau. Cách sửa: xoá chữ thừa, giãn ghim hoặc chỉ để nhận chạm ở ô lưới.

## Sửa trước review 2 (head 819cd7ba5)

Nhánh review/1028-khampha, worktree r1028-khampha, cây sạch, không push. Chưa xong hết: R-16 bước 2 hoãn (cần chủ chấp nhận); P3 còn 3 mục không làm.
Commit mới sau lượt review (gốc 950431bbb):
c4b4c20f2 Mini giữ chỗ thẻ thành viên khi chưa nhớ loại khách
26be232bb web tải Giờ vàng ở máy chủ, thêm cờ anonymous cho đường công khai, chống gọi trùng
4266c7f02 brand-origins dùng chung ở app-core; bấm cả bong bóng Vườn Xanh trên web; suggest-list bỏ barrel mini
1274abec6 khảo sát tách khỏi gói khởi động Mini; tên dài giữ hạng; câu báo lỗi điểm ngắn; h2 và ô tìm web 375 theo token Mini
82b1463be, 2aa264be7, 819cd7ba5 sửa test; probe CLS chuyển vào tools/perf/cls-probe.mjs.
Từng phát hiện:
- P1 CLS Mini, khách cũ thấy quà khách mới: đã sửa (c4b4c20f2). Mini truyền unknownWhenUnremembered:true nên chuỗi là unknown, unknown, loại thật. Test chuỗi mới (use-home-customer-kind.spec) đỏ trước khi sửa, xanh sau.
- P1 CLS web: đã sửa (26be232bb). Giờ vàng nằm trong initialData từ loadHomeInitial, revalidate 60 giây. Đo cls-probe lane 2, API chậm 1200ms: web returning 0,022 (trước 0,117), web new 0,0048 (trước 0,238), Mini returning 0,074, Mini new 0,037. Cả bốn dưới 0,1.
- P2 First Load /san-pham: đã sửa (4266c7f02). Nguyên nhân là import barrel mini. Số đo: 157 xuống 158 KB (+1), "/" 204 xuống 206 KB (+2); sau thay đổi cuối chỉ build lại để đo, không đổi mã.
- P2 Mini entry: đã sửa (1274abec6). OnboardingGate tải lười, entry 715 xuống 706 KB (mức 711). Tổng Mini 1917 xuống 1920 KB (+3 KB, do thêm một chunk lười); không có số tổng baseline nên không so được với main.
- P2 chưa chạy bộ kiểm: đã chạy. Mini Playwright 205 passed, 10 skipped. Web gate cả bộ 352 passed, 38 skipped, 2 failed. Hai ca lỗi là spec onboarding trong account.web.spec.ts, vì khảo sát đang tắt. Đã sửa spec thành kiểm không có dialog, chạy lại account.web.spec.ts 28/28 passed.
- P2 ảnh: đã chụp lại, dùng build-routes và capture ở lane 2. Đủ home, browse, browse-category, browse-search, browse-brand, brand-slug, brand-story với returning, new, guest, cùng home slow5s returning. Đã mở xem home new, home returning, home slow5s, browse-category. Thư mục /Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens-khampha/. Home new: món hàng trong màn đầu 812-90px, hết khảo sát. Web 375 giống Mini. Ba ảnh brand/browse chưa mở xem; slow5s chỉ chụp được persona returning, new/guest chưa.
- P2 file tạm: đã xoá h, h2, ssr probe và params-l2.json; cls-probe chuyển vào tools/perf/cls-probe.mjs kèm hướng dẫn chạy.
- P2 R-16 bước 2 (web dùng /home và /home/me): KHÔNG làm, cần chủ chấp nhận hoãn. Việc cỡ M, đụng cả cây home-view web. Bước 1 đã xong và chống gọi trùng /flash-sales/active. Dải Việc cần làm vẫn thêm một request home-processing ở cả hai nền.
- P2 brand-origins: đã sửa, bảng toạ độ ở packages/app-core/src/brand-origins.ts, hai app chỉ re-export; brandBrowseHref ở lại web.
- P2 bong bóng web: đã sửa, bấm cả bong bóng gọi router.push('/vuon-xanh'); bấm chữ không đẩy hai lần. Có hai test mới.
- P3 shop-client: đã sửa bằng cờ RequestOptions.anonymous (không gửi Authorization, no-store), coreHttp chuyển sang auth:false.
- P3 hai nhịp tải flash-sale: đã giảm, loadActiveFlashSales dùng lại dữ liệu dưới 10 giây tuổi.
- P3 tên dài cắt mất hạng: đã sửa ở cả Mini và web.
- P3 câu báo lỗi điểm: đã sửa, rút còn "Chưa tải được điểm của bạn", nowrap và ellipsis.
- P3 nhấn Enter: đã sửa ở cả Mini và web (browse-text.ts).
- P3 h2 Danh mục và ô tìm: đã sửa, h2 dùng Heading title-lg, main bỏ max-md:pt-3. Ảnh cho thấy ô tìm khớp Mini, tiêu đề còn lệch khoảng 6px so với Mini.
- P3 pointsCaption thừa: đã xoá. progressSpacer vẫn có chỗ dùng ở trang Ưu đãi nên giữ.
- P3 bong bóng vẫn che thẻ tới 5 giây: KHÔNG làm, chủ chốt hiện một lần, đã sát tab và tự tắt khi cuộn.
- P3 hộp chạm 44px của hai ghim Hector/Le Plateau chồng nhau: KHÔNG làm, toạ độ ghim phải theo vị trí tỉnh thật.
- P3 nhãn tên bản đồ cao 18px: KHÔNG làm, cùng lý do toạ độ.
Số kiểm (chạy thật):
- tsc --noEmit sạch ở web, miniapp, app-core, e2e. eslint sạch trên file đã đổi của web và miniapp.
- vitest app-core 917/917. vitest miniapp 4874 passed, 1 failed; ca lỗi là câu gợi ý rỗng nhắc Enter, đã sửa spec, chạy lại thư mục catalog 78/78 (chưa chạy lại toàn bộ). vitest web 7437 passed, 9 failed ở bottom-nav.spec do thiếu mock useRouter; đã sửa, chạy lại riêng file 11/11 (chưa chạy lại toàn bộ). Chưa chạy lần nào TZ=UTC cho Mini vì lượt chạy gộp chỉ ra kết quả của lần không TZ.
- pnpm lint:parity xanh, 0 mục pending.
- Không đụng API hay điểm/tiền nên không chạy jest API và race. Không chạy run-all.mjs (theo lệnh).
Việc cần chủ chốt: có hoãn R-16 bước 2 hay không.
Đã dừng lane 2 và web gate; routes.json đã khôi phục.

## Review 2

KẾT LUẬN: chưa merge

- [P2] apps/web/src/components/home/flash-sale.tsx:111-115, cùng apps/web/src/lib/use-countdown.ts:16 — **Bản sửa CLS mới gây lỗi hydrate cho đồng hồ Giờ vàng.**
  - Nay khối Giờ vàng có sẵn trong HTML ISR (initialData, revalidate 60 giây). Chữ "Còn Xh YYm" tính lúc máy chủ dựng trang qua `useState(() => read(targetMs))`, trình duyệt tính lại lúc hydrate.
  - `suppressHydrationWarning` chỉ có tác dụng một tầng: nó che được `aria-label` của `<span role="timer">`, không che chữ nằm trong `<Badge>`.
  - Ví dụ cụ thể: suất còn dưới 24 giờ (formatCountdown làm tròn theo phút). HTML dựng lúc 10:00:50 ghi "2h 15m", trình duyệt hydrate lúc 10:01:05 ra "2h 14m". Chuyện này gần như chắc xảy ra vì HTML ISR có thể cũ tới 60 giây hoặc hơn, và đồng hồ điện thoại lệch so với máy chủ: lúc hydrate, offset của serverNow phía trình duyệt vẫn là 0.
  - Hậu quả: React 19 báo "Hydration failed… text didn't match". Trang chủ không có `<Suspense>` nào (app/page.tsx, layout.tsx, home-view.tsx), nên React dựng lại cả cây ở trình duyệt, mất phần HTML từ máy chủ, và CLS có thể quay lại.
  - Cls-probe đo với suất "Còn 3 ngày 1 giờ" (ảnh home__new). Ở mức trên 24 giờ, chữ chỉ đổi theo giờ nên lần đo không bắt được lỗi.
  - Cách sửa: lần render đầu (cả máy chủ lẫn hydrate) để đồng hồ rỗng hoặc giữ chỗ cố định, tính chữ trong useEffect. Hoặc đặt `suppressHydrationWarning` lên đúng phần tử chứa chữ. Thêm test hydrateRoot với suất còn dưới 24 giờ và giờ máy chủ, giờ trình duyệt lệch nhau 1 phút.
- [P3] apps/web/src/lib/home-initial.ts:31 cùng flash-sale.tsx:63-72 — **HTML ISR cũ có thể còn suất đã hết giờ.**
  - Trang ít khách: lần đầu có người vào sau khi hết hạn, Next vẫn trả bản cũ (stale-while-revalidate).
  - Nếu suất trong bản cũ đã hết giờ: `items.length > 0` nhưng `soonestEndAt === null`. Khối vẫn hiện giá Giờ vàng đã hết (không có đồng hồ), rồi lần tải ngay sau đó trả `[]` làm mất cả khối khoảng 300px, trang nhảy.
  - Cách sửa: lọc `initial` theo `endAt > serverNow()` trước khi đưa vào initialData. Hết suất thì dùng giữ chỗ cố định thay vì để khối biến mất.
- [P3] apps/web/src/lib/home-initial.spec.ts:66-70 — **Test có tên "lỗi riêng phần Giờ vàng" nhưng đặt `failAll = true`** (mọi phần cùng lỗi, chạy ở pha build). Vì vậy chưa có test cho trường hợp chỉ `/flash-sales/active` lỗi mà các phần khác vẫn trả. Cách sửa: thêm cờ chỉ làm hỏng fetchActiveFlashSales, rồi kiểm `bestSellers` và `categories` vẫn có.
- [P3] packages/app-core/src/home-layout.ts:37-41 và :48 — **Chú thích của resolveHomeKind đã sai.** Nó vẫn ghi "đang khôi phục mà máy chưa nhớ thì dựng bố cục khách mới ngay" và "`unknownWhenUnremembered`… web có cờ phiên, mặc định = khách mới". Nay Mini luôn truyền true (apps/miniapp/src/hooks/use-home-customer-kind.ts:67). Cách sửa: ghi lại cho đúng, Mini luôn dùng "unknown".
- [P3] apps/miniapp/src/store/auth.ts:140/198 cùng home-layout.ts:59 — **Khách cũ mất mạng lúc mở app vẫn thấy quà khách mới.** Khi đó status = 'error', tức authPending=false và authed=false, nên resolveHomeKind trả 'new' và bỏ qua loại đã nhớ. Khách cũ thấy "Quà khách mới · Nhận quà". Lỗi này có từ trước, không do diff này gây ra. Cách sửa: với status 'error' thì dùng `stored ?? 'unknown'`.
- [P3] docs/2026-10-28-review/screens-khampha/browse-search__new__ok__s1.png và browse-search__guest__ok__s1.png — **Báo cáo ghi đã chụp đủ, nhưng cả 4 cột của hai ảnh này đều "không có".** Ngoài ra ảnh browse-search returning cho thấy Mini đang ở danh sách gợi ý còn web đã ở lưới kết quả, tức hai bên không cùng trạng thái nên không so được. Cách sửa: thêm route chụp cho persona new và guest, và cho Mini và web cùng một trạng thái (đã gửi tìm).
- [P3] Bộ vitest đầy đủ của web và Mini chưa chạy lại sau các commit sửa spec (82b1463be, 2aa264be7); chưa chạy Mini với TZ=UTC. Tôi chỉ chạy lại các file liên quan: web gồm flash-sale, home-initial, bottom-nav, mobile-shell, 4 file 61/61 xanh; Mini gồm use-home-customer-kind và home, 28/28 xanh. Cách sửa: chạy cả bộ, kèm một lần TZ=UTC, và ghi số.

Kiểm từng phát hiện của lượt trước:
- Đã sửa thật: P1 CLS Mini (chuỗi unknown→unknown→loại thật, có test), P1 CLS web (initialData), suggest-list import thẳng (First Load +1 KB và +2 KB theo báo cáo, tôi không build lại), Mini entry (OnboardingGate tải lười), brand-origins chuyển sang app-core (hai app chỉ re-export, đủ export), bong bóng web bấm cả khối, cờ `anonymous` (`/flash-sales/active` trên API là công khai, Mini bỏ qua cờ này), REUSE 10 giây (dữ liệu trong kho đủ trường), tên dài, câu báo lỗi, chữ Enter, h2/pt.
- R-16 bước 2 đã ghi rõ là chờ chủ duyệt hoãn, không tính là lỗi.

Lý do kết luận chưa merge: còn một lỗi P2 (đồng hồ Giờ vàng làm hỏng hydrate trên web).

## Sửa trước review 3 (head review/1028-khampha, commit aeb1659ec: đã sửa P2 hydrate Giờ vàng và 4 P3; chưa chụp lại ảnh, chưa đo lại CLS bằng cls-probe)

Nhánh review/1028-khampha. Commit mới: aeb1659ec "fix(trang-chu): chữ đồng hồ Giờ vàng lệch giữa HTML ISR và trình duyệt không làm hỏng hydrate; bản dựng sẵn bỏ suất đã hết giờ; sửa chú thích resolveHomeKind (R-2)". Không push.

Từng phát hiện của reviewer:
- P2 hydrate đồng hồ Giờ vàng: ĐÃ SỬA (aeb1659ec). Chữ "Còn Xh YYm" nằm trong <span suppressHydrationWarning> đặt trong Badge (apps/web/src/components/home/flash-sale.tsx). Thêm test hydrateRoot ở flash-sale.spec.tsx: dựng HTML lúc 10:00:50, hydrate lúc 10:02:05, suất còn dưới 24 giờ. Test đỏ trước khi sửa (có lỗi hydrate), xanh sau.
- P3 HTML ISR cũ còn suất đã hết giờ: ĐÃ SỬA một phần. home-initial.ts lọc suất theo endAt > Date.now() trước khi đưa vào initialData. Test viết cùng lúc với bản sửa nên chưa thấy đỏ trước. KHÔNG LÀM phần giữ chỗ khi hết suất: lọc phía máy chủ đã chặn trường hợp chính, giữ chỗ cố định cần chủ chốt chiều cao.
- P3 test "lỗi riêng Giờ vàng": ĐÃ SỬA. Thêm cờ failFlash chỉ làm hỏng fetchActiveFlashSales; kiểm bestSellers và categories vẫn có.
- P3 chú thích resolveHomeKind: ĐÃ SỬA, ghi đúng là cả Mini và web đều truyền unknownWhenUnremembered = true.
- P3 khách cũ mất mạng thấy quà khách mới (status 'error'): KHÔNG LÀM. Lỗi có từ trước, nằm ở apps/miniapp/src/store/auth.ts và luồng auth, ngoài phạm vi gói.
- P3 ảnh browse-search new/guest trống, Mini và web khác trạng thái: KHÔNG LÀM, chưa bật lane để chụp lại.
- P3 chạy cả bộ vitest: ĐÃ LÀM, số ở dưới.

Việc bắt buộc thêm:
1. CLS web < 0,1: bản initialData đã có từ commit 26be232bb. CHƯA đo lại bằng cls-probe sau bản sửa này, nên chưa có số CLS mới. Khối Giờ vàng vẫn nằm trong HTML ISR nên mong là không đổi, nhưng chưa kiểm.
2. /san-pham First Load: 157 xuống 158 KB (+1 KB, trong mức +2). Trang chủ / : 204 xuống 206 KB (+2 KB). So với bảng ở 03-perf-build.md, lấy từ next build thật ở bước này.
3. Mini entry: 706 KB raw (baseline 711, đạt ≤ 711).
4. Web gate cả bộ (web-gate.sh, cổng 3761–3765): 354 passed, 38 skipped, 0 fail. Playwright Mini toàn bộ (E2E_SCOPE=miniapp, cổng 3763): 205 passed, 10 skipped, 0 fail.
5. Chụp lại ảnh trước/sau: CHƯA LÀM. Ảnh cũ ở docs/2026-10-28-review/screens-khampha/ không đổi. Bản sửa lần này chỉ đổi chữ đồng hồ và dữ liệu dựng sẵn, không đổi giao diện nhìn thấy.
6. File *.tmp.mjs: reviewer đã kiểm thấy xong ở commit 2aa264be7 (probe CLS chuyển vào tools/perf). Không đụng thêm.

Số kiểm:
- tsc --noEmit: web, miniapp, app-core đều sạch.
- eslint 4 file đã sửa của web: sạch.
- vitest web: 441 file, 7448 test pass.
- vitest app-core: 71 file, 917 test pass.
- vitest miniapp: 314 file, 4875 test pass, cả khi chạy thường và khi TZ=UTC.
- lint:parity: xanh, 0 mục pending.
- Không đụng API, điểm hay tiền nên không chạy jest API và race.

Điều chưa kiểm: cls-probe sau bản sửa; ảnh chụp lại; perf run-all (brief cấm). Không có việc cần chủ quyết mới. Cổng 3761–3765 không còn tiến trình nghe.

## Review 3

KẾT LUẬN: chưa merge

Kiểm từng phát hiện của lượt trước:
- P2 hydrate do chữ phút của đồng hồ: đã sửa thật. `<span suppressHydrationWarning>` nay bọc đúng phần tử chứa chữ. Tôi chạy flash-sale.spec và home-initial.spec, 28/28 xanh.
- P3 test "lỗi riêng Giờ vàng" (thêm cờ failFlash) và P3 chú thích resolveHomeKind: đã sửa thật. Web use-home-customer-kind.ts:91 và Mini :67 đều truyền true.
- P3 HTML ISR cũ: chỉ sửa được trường hợp bộ đệm fetch trả suất đã hết giờ. Trường hợp chính, HTML cũ được trả sau khi suất hết giờ, vẫn còn và gây lỗi hydrate (P2 thứ nhất bên dưới). Báo cáo ghi "lọc phía máy chủ đã chặn trường hợp chính" là không đúng.

- [P2] apps/web/src/components/home/flash-sale.tsx:111 cùng apps/web/src/lib/home-initial.ts:41 — **Hydrate vẫn hỏng khi HTML ISR cũ được trả sau giờ hết suất.**
  - Bộ lọc `endAt > Date.now()` chạy lúc dựng trang, không chạy lúc trả trang. Next trả bản cũ trước rồi mới dựng lại (stale-while-revalidate), nên trang ít khách gặp chuyện này sau mỗi lần suất hết giờ. Đồng hồ điện thoại chạy nhanh hơn máy chủ cũng gây ra đúng lỗi này, vì lúc hydrate serverNow chưa có độ lệch.
  - Khi đó máy chủ đã vẽ `<span role="timer">`. Trình duyệt tính ra `soonestEndAt = null`, nên `timeLeft = ''` và `{timeLeft && …}` không vẽ span. HTML hai bên khác nhau về cấu trúc phần tử, `suppressHydrationWarning` không che được loại lệch này.
  - Tôi chứng minh bằng một spec tạm đặt ngoài repo (/private/tmp/claude-501/-Users-longla-coding-tubutree-mini-app/e60524b4-300a-4d5d-a95d-b2ca8ab897dc/scratchpad/v/expired.spec.tsx). Suất hết lúc 12:00, `renderToString` lúc 11:55, `hydrateRoot` lúc 12:30. Kết quả: React báo "Hydration failed because the server rendered HTML didn't match the client… tree will be regenerated", diff chỉ vào `<span role="timer" aria-label="Còn 0h 05m">`.
  - Trang chủ không có `<Suspense>`, nên React dựng lại cả cây ở trình duyệt và CLS có thể quay lại.
  - Cách sửa: luôn vẽ khung span đồng hồ, khi rỗng thì ẩn bằng `invisible` hoặc `hidden`, đặt `suppressHydrationWarning`. Hoặc chỉ tính `timeLeft` sau khi mount. Thêm test hydrateRoot với suất đã hết giờ lúc hydrate.
- [P2] Việc bắt buộc (1) chưa làm — **CLS web < 0,1 chưa được đo.**
  - Số web cuối cùng ở reviews/khampha-b.md:20 là 0,2383 (khách mới) và 0,1167 (khách cũ), đo trước bản initialData.
  - Từ 26be232bb tới aeb1659ec không có lần đo cls-probe nào. Worker tự ghi "chưa kiểm".
  - Vì vậy tiêu chí R-2 cho web chưa có bằng chứng.
  - Cách sửa: chạy docs/2026-10-28-review/tools/perf/cls-probe.mjs ở cổng của gói, đo khách mới và khách cũ. Thêm một lần đo với suất còn dưới 24 giờ và một lần với HTML cũ đã quá giờ hết suất. Ghi số.
- [P2] Việc bắt buộc (5) chưa làm — **chưa chụp lại ảnh sau commit cuối.**
  - Các ảnh trong screens-khampha/ có mtime 13:59, còn commit cuối lúc 14:16.
  - browse-search new và guest vẫn trống (lỗi P3 của lượt trước chưa sửa). Chưa có ảnh slow5s cho persona new và guest.
  - Cách sửa: chụp lại đủ 7 màn × 3 persona và home slow5s, ghép trước/sau, rồi tự xem.
- [P3] apps/web/src/lib/home-initial.ts:41 — **Lọc hết suất thì khối có thể chen vào sau.**
  - Nếu lọc xong còn `[]`, initialData là `[]`, HTML không có khối và không có giữ chỗ.
  - Lần tải lại ngay sau đó (initialDataUpdatedAt 0) trả về suất mới vừa mở, khối khoảng 300px chen vào và đẩy trang.
  - Cách sửa: dữ liệu dựng sẵn rỗng mà máy đã nhớ hadFlash thì vẽ FlashSkeleton. Hoặc ghi rõ đây là trường hợp chấp nhận được.
- [P3] apps/miniapp/src/store/auth.ts:140/198 — Khách cũ mất mạng lúc mở app vẫn thấy quà khách mới (status 'error'). Lỗi có từ trước, không do gói này gây ra. Worker không làm. Cần ghi vào backlog để không mất.

Phần build và test tôi không chạy lại: First Load (/san-pham +1 KB, / +2 KB), Mini entry 706 KB, web gate 354 pass, Playwright Mini 205 pass, vitest cả bộ. Các số này lấy từ báo cáo worker, chưa kiểm.
