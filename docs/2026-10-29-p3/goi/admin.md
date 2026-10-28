# Gói P3 admin: Hộp việc Hôm nay, đơn, đổi trả quản trị

Gốc: main 815fa3c1e. Nguồn: các P3 reviewer Opus nêu ở đợt 28/10 (gói admin-hopviec, admin-don) chưa sửa, mục làm dở, và mục còn lại trong báo cáo cuối.

Với mỗi mục: kiểm còn đúng trên mã hiện tại không (nhiều mục đã sửa ở lượt review sau hoặc gói khác; dòng có thể lệch). Đã hết thì ghi skipped + bằng chứng file:dòng. Mục cần chủ quyết (ghi needs_owner/cần chủ quyết, hoặc phải đổi giá, luật điểm, phí, thể lệ, chữ pháp lý, cờ PROD, thêm tin gửi khách) thì skipped, ghi lựa chọn cho chủ. Mục trùng nhau thì làm một lần, ghi id kia là trùng.

## admin-1 (review lượt 1, gói admin-hopviec)

File: apps/web/src/components/admin/dealer-credit-reports.tsx:116; apps/web/src/components/admin/dealer-credit-panel.tsx:73; apps/api/src/modules/dealer/dealer.service.ts:589

Vấn đề: After 'Ghi nhận', the success message always uses the amount the dealer reported (r.amount), not the amount the accountant actually recorded. If the accountant edits the amount to match the bank statement (for example 150k against a 200k report), the screen says 200k was recorded. The panel showing the real remaining debt disappears, because the report row unmounts after invalidation. Also, if the accountant types a bankRef that matches an earlier PAYMENT with the same amount, the API returns early at line 589 without closing the report. The UI still says 'Báo cáo đã đóng' while the report stays REPORTED in the list.

Cách sửa đề xuất: In DealerCreditPanel, call `onPaid?.(amt)` and use that amount in the ReportRow message. In the API's early-return path, when reportId is present, return a flag such as `reportClosed: false`. Better: if the matching ledger row was written for this same report, close the report in that path too. The web then shows text based on the result, e.g. 'Mã GD này đã được ghi nhận trước đó; báo cáo vẫn mở, đóng bằng Không thấy tiền nếu trùng'.

## admin-2 (review lượt 1, gói admin-hopviec)

File: apps/web/src/app/admin/page.tsx:460-464 (setTab), 697, 719

Vấn đề: deletionSeed and reportsSeed are never reset (only externalSeed is reset in setTab). After one click on the 'Yêu cầu xoá tài khoản' card, every later visit to Người dùng scrolls on its own down to the account-deletion block. That includes opening it from the 'Khách mới hôm nay' number. After one click on 'Đã thu', Báo cáo always opens at 'Hôm nay' instead of the default 30 days, until the page is reloaded.

Cách sửa đề xuất: In setTab, add `setDeletionSeed(0); setReportsSeed(0);`. In openInbox and openStat, call setTab first and set the seed afterwards, as the externalPoints branch already does.

## admin-3 (review lượt 1, gói admin-hopviec)

File: apps/web/src/components/admin/order-extra-filters.tsx:114

Vấn đề: On wide screens, the dealer_transfer_to_confirm queue still shows the text 'Đang xem đơn lẻ chuyển khoản chưa nhận tiền', which is wrong for dealer orders. Only the narrow-screen text in page.tsx was fixed. The file belongs to the admin-don package, and the worker left a note for it.

Cách sửa đề xuất: Confirm the item is in admin-don's package file before that package runs. The text should read 'Đang xem đơn đại lý trả trước chưa nhận tiền, cũ nhất trước' when value.queue === 'dealer_transfer_to_confirm'.

## admin-4 (review lượt 1, gói admin-hopviec)

File: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-e2e-admin-hopviec.txt

Vấn đề: The latest gate file is from 02:01 and matches HEAD 8e1523689 (commit at 00:54), but it still shows FAIL count 2: vitest-miniapp and miniapp-utc (subscribe-sheet, my-payroll). The diff for apps/miniapp and packages/app-core is empty, and load was about 146. I reran those 2 files alone with TZ=UTC: 19/19 pass. So they are flakes, but the brief requires 0 FAIL in one gate run.

Cách sửa đề xuất: Rerun gate.sh when load is lower (`sysctl -n vm.loadavg` < 40) to get 0 FAIL, and attach that file before merge.

## admin-5 (review lượt 2, gói admin-hopviec)

File: apps/web/src/components/admin/dealer-payment-panel.tsx:50-56

Vấn đề: Thẻ mới 'Đơn đại lý trả trước chờ xác nhận tiền' (E-1) được xử lý bằng nút 'Đã nhận tiền' ở DealerPaymentPanel. confirmMut.onSuccess chỉ invalidate 'admin-orders' và 'admin-dashboard-stats', không gọi invalidateInbox. Vì vậy sau khi kế toán xác nhận, số trên thẻ và huy hiệu menu vẫn giữ số cũ tới 60 giây, trái mục tiêu 'số trên thẻ cập nhật ngay' của gói (E-52 chỉ phủ order-status-actions, không phủ panel này).

Cách sửa đề xuất: Trong confirmMut.onSuccess thêm `void invalidateInbox(qc);` (import từ '@/lib/admin-client'), và thêm một ca trong spec cạnh file kiểm có invalidate khoá ['admin-ops-inbox']. File không có trong bảng chủ file, nên sửa tối thiểu (1 dòng) theo luật 'file không có trong bảng' và ghi vào báo cáo.

## admin-6 (review lượt 2, gói admin-hopviec)

File: apps/web/src/components/admin/account-deletion-panel.tsx:66-71

Vấn đề: Seed chỉ cuộn một lần, lúc panel vừa mount. Lúc đó UsersTab phía trên đang chờ listUsers (users = []), nên panel còn nằm gần đầu trang. Khi 20 dòng người dùng tải xong, panel bị đẩy xuống dưới màn hình. Trình duyệt không tự giữ vị trí neo khi scrollTop = 0, nên thẻ 'Yêu cầu xoá tài khoản' mở tab Người dùng mà không thấy khối cần xử lý. Test đơn vị chỉ kiểm scrollIntoView có được gọi. Chưa kiểm trên trình duyệt thật. external-claims-tab.tsx:72-75 cuộn tới khối 'Lần gửi mã chưa ghép' cũng có cùng kiểu lỗi, vì danh sách claim phía trên tải sau.

Cách sửa đề xuất: Cuộn lại sau khi dữ liệu phía trên đã ổn định. Cách 1: page.tsx khi deletionSeed>0 thì render AccountDeletionPanel TRƯỚC UsersTab. Cách 2: trong panel, chạy effect cuộn theo [seed, q.isSuccess] và trong page truyền thêm cờ usersLoaded (hoặc dùng qc.isFetching({queryKey:['admin-users']})===0). Thêm ca Playwright web: bấm thẻ, chờ danh sách người dùng tải, rồi kiểm #account-deletions nằm trong viewport.

## admin-7 (review lượt 2, gói admin-hopviec)

File: apps/api/src/modules/dealer/dealer.service.ts:613-617,661 và apps/web/src/components/admin/dealer-credit-reports.tsx:65,110-115

Vấn đề: Đường 'replay' trong transaction xảy ra khi báo cáo đã RECORDED bởi một lần ghi khác, với mã GD khác hoặc không có mã: API không ghi sổ nhưng vẫn trả reportClosed: true. Web vì vậy báo 'Đã ghi nhận {số vừa nhập} của X. Báo cáo đã đóng', dù lần bấm này không ghi đồng nào và kế toán kia có thể đã ghi số khác. Tương tự, dismiss trả alreadyProcessed: true khi báo cáo đã được người khác Ghi nhận, nhưng onSuccess bỏ qua cờ này và vẫn báo 'Đã đóng báo cáo… không thấy tiền'. Số dư hiển thị vẫn đúng và không trừ nợ hai lần (race spec xanh). Lỗi chỉ ở câu báo khi hai kế toán xử lý cùng một báo cáo.

Cách sửa đề xuất: Ở nhánh replay, trả `{ ...ledger, reportClosed: true, alreadyRecorded: true }`. RecordDealerCreditPaymentResult thêm alreadyRecorded?; onPaid/flash: alreadyRecorded thì báo 'Báo cáo này đã được ghi nhận trước đó, lần này sổ công nợ không đổi. Dư nợ hiện tại …'. Dismiss: alreadyProcessed thì báo 'Báo cáo đã được xử lý trước đó' thay vì 'không thấy tiền'. Thêm ca jest cho cả hai nhánh.

## admin-8 (review lượt 2, gói admin-hopviec)

File: apps/api/src/modules/dealer/dealer.controller.ts:18-21

Vấn đề: CreditPaymentDto.note không có @MaxLength. Trước gói này note chỉ đi vào tin báo. Nay reportCreditPayment lưu note vào dealer_credit_payment_reports.note và hiện ở màn kế toán, nên đại lý gửi được chuỗi rất dài vào DB và vào màn quản trị. Khi so, DismissCreditReportDto.reason đã chặn ở 500.

Cách sửa đề xuất: Thêm `@MaxLength(500)` cho note trong CreditPaymentDto. Trong reportCreditPayment cắt `note?.trim().slice(0, 500)` trước khi create. Thêm ca DTO trong dealer-credit-payment.spec.

## admin-9 (review lượt 2, gói admin-hopviec)

File: apps/web/src/components/admin/order-extra-filters.tsx:114

Vấn đề: R1-4 bỏ qua với lý do hợp lệ: file thuộc admin-don theo bảng chủ file. Tuy vậy, trên máy tính, hàng đợi dealer_transfer_to_confirm vẫn hiện câu 'Đang xem đơn lẻ chuyển khoản chưa nhận tiền', sai loại đơn. Mục E-54 của admin-don chưa nêu chữ cần đổi, nên dễ bị sót.

Cách sửa đề xuất: Ghi vào goi/admin-don.md (E-54): khi value.queue === 'dealer_transfer_to_confirm' thì hiện 'Đang xem đơn đại lý trả trước chưa nhận tiền, cũ nhất trước. Bấm Xoá bộ lọc để xem tất cả.' Bản khổ hẹp ở page.tsx:1569 đã đúng.

## admin-10 (review lượt 2, gói admin-hopviec)

File: apps/web/src/app/admin/page.tsx (First Load /admin)

Vấn đề: Brief yêu cầu web First Load của trang đổi tăng ≤ 2 KB hoặc ghi lý do. Gói thêm dealer-credit-reports.tsx, chip phần việc và nhiều import mới vào /admin, nhưng báo cáo worker chỉ có bundle Mini App; gate.sh không đo web. Chưa kiểm.

Cách sửa đề xuất: Chạy `next build` cho apps/web ở 376ad7055 và ở HEAD, chép số First Load của /admin trước/sau vào báo cáo; vượt 2 KB thì ghi lý do.

## admin-11 (review lượt 1, gói admin-don)

File: apps/web/src/app/admin/page.tsx:1

Vấn đề: Luật bundle web: First Load của trang đổi chỉ được tăng tối đa 2 KB, vượt thì phải ghi lý do có số. Worker không đo bản gốc. Hai worktree cùng gốc 376ad7055 không đụng file admin (e2e-muachung, e2e-doirac) cho /admin 326 kB (trang 165 kB); HEAD gói này 331 kB (trang 170 kB), tức +5 kB, gồm cả phần của admin-hopviec và api-tin đã gộp. Chưa tách được phần của admin-don nên chưa có lý do hợp lệ.

Cách sửa đề xuất: Dựng next build ở tip review/e2e-admin-hopviec (đã gộp api-tin) để tách phần tăng của admin-don. Nếu phần của gói vượt 2 KB thì nạp lười thêm (ví dụ UserDetailDrawer trong OrdersTab, VnDateTimeInput chỉ dùng ở tab Giờ vàng) hoặc ghi lý do kèm số trước/sau vào báo cáo.

## admin-12 (review lượt 1, gói admin-don)

File: apps/web/src/components/admin/game-quiz-tab.tsx:87

Vấn đề: Thêm câu đố xong thì form đóng, danh sách về trang 1, và không có câu báo thành công. Id mới là `nq_<hex ngẫu nhiên>` (game-quiz.service.ts:187), danh sách lại sắp theo id, nên câu mới rơi vào trang bất kỳ trong khoảng 3 trang của 43 câu seed. Admin không thấy câu vừa thêm dễ tưởng lỗi rồi thêm lại, tạo câu trùng vào vòng xoay của khách.

Cách sửa đề xuất: Sau khi tạo, hiện dòng role=status 'Đã thêm câu đố: <câu hỏi>', hoặc dùng `meta`/vị trí trả về để chuyển tới đúng trang có câu mới và tô nổi dòng đó. Không đổi cách sắp theo id vì getTodayQuiz dùng cùng thứ tự.

## admin-13 (review lượt 1, gói admin-don)

File: apps/web/src/components/admin/customer-refunds-tab.tsx:313

Vấn đề: Người dùng chính của tab Hoàn tiền khách là KE_TOAN, bị che SĐT nên API chỉ khớp khi gõ đủ số (exactPhoneOnly). Gõ một phần SĐT thì nhận câu 'Không có khoản hoàn nào khớp "0912"' (dòng 413), không biết phải gõ đủ 10 số. Tương tự ở cả hai tab: chuỗi quá chung (khớp hơn 1000 khách, ví dụ 'Nguyễn') thì bỏ hẳn nhánh tìm theo khách và trả rỗng, câu rỗng gây hiểu nhầm là không có dữ liệu.

Cách sửa đề xuất: Khi !isAdmin, đổi placeholder hoặc thêm gợi ý thành 'Mã đơn hoặc đủ 10 số SĐT'. Khi search là dãy số chưa đủ 10 số, câu rỗng nói rõ 'Gõ đủ 10 số SĐT để tìm theo khách.'

## admin-14 (review lượt 1, gói admin-don)

File: apps/api/src/modules/admin/admin-order-filter.ts:248

Vấn đề: findSearchUserIds mới chép nguyên văn AdminService.findSearchUserIds (admin.service.ts:910). Worker đã ghi nhận việc này. Hai bản sẽ lệch nhau khi một bên sửa luật tìm, ví dụ luật che SĐT.

Cách sửa đề xuất: Ở bước tích hợp (admin.service.ts thuộc admin-hopviec): cho AdminService.findSearchUserIds gọi hàm chung `findSearchUserIds(this.prisma, search, exactPhoneOnly)` rồi xoá bản private.

## admin-15 (review lượt 2, gói admin-don)

File: apps/web/src/components/admin/vn-date-input.tsx:188-190

Vấn đề: Effect mới của R1-1 có deps là `[parsed?.hh, parsed?.mm]` nhưng thân effect đọc thẳng `parsed`. Chạy `cd apps/web && npx eslint src/components/admin/vn-date-input.tsx` ra cảnh báo react-hooks/exhaustive-deps: "missing dependency: 'parsed'". Đây là cảnh báo duy nhất trong mọi file web gói đã đổi. Gate không bắt được vì bước eslint-web chạy `next lint --quiet` (gate.sh:57), mà --quiet ẩn mọi cảnh báo. Hành vi hiện tại vẫn đúng, nhưng thêm cảnh báo mới vào luật hooks là nợ kỹ thuật.

Cách sửa đề xuất: Rút giá trị ra trước effect: `const ph = parsed?.hh; const pm = parsed?.mm; useEffect(() => { if (ph === undefined || pm === undefined) return; setHeld((h) => (h.hh === ph && h.mm === pm ? h : { hh: ph, mm: pm })); }, [ph, pm]);`. Kiểm bằng `npx eslint src/components/admin/vn-date-input.tsx` (phải 0 cảnh báo) và vn-date-input.spec.tsx (16/16).

## admin-16 (review lượt 2, gói admin-don)

File: apps/web/src/app/admin/page.tsx:1419-1423, 2081; apps/web/src/components/admin/order-status-actions.tsx:198

Vấn đề: OrderStatusActions gọi `onPaid?.(r.message)`, nhưng OrderDetailBody bỏ mất câu đó (`onPaid={onPaid ? () => onPaid() : undefined}`). Vì vậy paidNote luôn hiện 'Đã ghi nhận đơn X.', kể cả khi máy chủ trả `alreadyPaid: true` (người khác đã xác nhận trước). Kế toán sẽ tưởng chính mình vừa ghi nhận.

Cách sửa đề xuất: Truyền câu của máy chủ đi suốt: đổi prop `onPaid` của OrderDetailBody thành `(message: string) => void`, nối thẳng vào OrderStatusActions, đổi `onPaid(o: AdminOrder, message: string)` trong OrdersTab và lưu `message` vào paidNote. Khi `alreadyPaid` thì hiện `message` thay cho 'Đã ghi nhận đơn X.' (cần thêm `r.alreadyPaid` vào lệnh gọi onPaid ở order-status-actions.tsx:198). Test page.spec.tsx: mock /confirm-payment trả `alreadyPaid: true` kèm câu riêng, rồi kiểm dòng báo hiện đúng câu đó.

## admin-17 (review lượt 2, gói admin-don)

File: apps/web/src/components/admin/customer-refunds-tab.tsx:314, 414; apps/web/src/app/admin/page.tsx:704

Vấn đề: Ô tìm đang suy ra 'bị che SĐT' từ `!isAdmin`. Máy chủ thì dùng `seesFullOrderPhones` (apps/api/src/modules/admin/order-actor-transitions.ts:27-31): nhân viên có KE_TOAN kèm CSKH hoặc KHO vẫn thấy đủ SĐT và tìm được theo một phần số. Với nhân viên kiêm nhiệm này, placeholder 'Mã đơn hoặc đủ 10 số SĐT' và câu 'Gõ đủ 10 số SĐT để tìm theo khách.' là sai.

Cách sửa đề xuất: Thêm prop `phoneMasked` cho CustomerRefundsTab. Ở page.tsx:704 truyền `phoneMasked={!(isAdmin || perms.includes('CSKH') || perms.includes('KHO'))}`, với `perms = accessQ.data?.staffPermissions ?? []`. Dùng prop này thay cho `!isAdmin` ở dòng 314 và 414. Thêm một ca cho nhân viên KE_TOAN+CSKH trong customer-refunds-tab.spec.tsx.

## admin-18 (review lượt 2, gói admin-don)

File: apps/api/src/modules/admin/admin.service.ts:910-928

Vấn đề: R1-6 bị bỏ qua là hợp lệ (bản đồ chủ file giao admin.service.ts cho admin-hopviec). Nhưng hiện có hai bản `findSearchUserIds` giống hệt nhau: bản private ở đây và bản export ở admin-order-filter.ts:248. Sau này sửa một bản thì ô tìm đơn và ô tìm đổi/trả, hoàn tiền sẽ lệch nhau.

Cách sửa đề xuất: Làm ở bước tích hợp, sau khi gộp các gói: cho `AdminService.adminOrderWhere` (admin.service.ts:954) gọi `findSearchUserIds(this.prisma, f.search, exactPhoneOnly)` import từ admin-order-filter.ts, rồi xoá bản private ở 910-928. Chạy lại jest admin.service.spec.ts, admin-order-list-filters.spec.ts và race admin-order-list-filters.

## admin-19 (review lượt 3, gói admin-don)

File: apps/web/src/components/admin/customer-refunds-tab.tsx:103-112

Vấn đề: Lượt này thêm một khối JSDoc thứ hai (dòng 111, về `phoneMasked`) ngay dưới khối JSDoc cũ (dòng 103-110) mô tả hàng đợi hoàn tiền. TypeScript và IDE chỉ gắn khối cuối vào hàm, nên khi rê chuột vào `CustomerRefundsTab` chỉ còn thấy một dòng về `phoneMasked`, phần mô tả quy trình chuyển khoản bị tách khỏi hàm.

Cách sửa đề xuất: Gộp làm một khối: chuyển câu về `phoneMasked` vào cuối khối JSDoc ở dòng 103-110 (ví dụ một dòng `@param` hoặc một câu cuối), rồi xoá khối một dòng ở dòng 111. Hành vi không đổi, không cần thêm test.

## admin-20 (review lượt 3, gói admin-don)

File: apps/api/src/modules/admin/admin.service.ts:910-927

Vấn đề: Mục R2-5 bị bỏ qua, và lý do là đúng: theo bản đồ chủ file, admin.service.ts thuộc gói admin-hopviec. Kết quả là `findSearchUserIds` bản private trong admin.service.ts vẫn trùng từng dòng với bản export ở admin-order-filter.ts:248. Ô tìm đơn, ô tìm đổi/trả và ô tìm hoàn tiền vì thế đang chạy hai bản mã riêng của cùng một luật tìm. Sau này sửa một bản mà quên bản kia thì ba ô tìm sẽ trả kết quả khác nhau.

Cách sửa đề xuất: Làm ở bước tích hợp, sau khi gộp admin-hopviec: trong `adminOrderWhere` (admin.service.ts:954) đổi `this.findSearchUserIds(f.search, exactPhoneOnly)` thành `findSearchUserIds(this.prisma, f.search, exactPhoneOnly)` import từ admin-order-filter.ts, rồi xoá bản private ở dòng 910-927. Sau đó chạy jest admin.service.spec và admin-order-list-filters.spec, cùng race admin-order-list-filters và admin-returns-refunds-search.

## admin-21 (còn lại trong báo cáo cuối 29/10)

Admin: mục Đơn hàng sáng (active) ở hai nhóm menu cùng lúc; chỉ một mục sáng theo route hiện tại.

## admin-22 (còn lại trong báo cáo cuối 29/10)

Admin: dòng "7 ngày: 7 khách mới" hiện màu đỏ như cảnh báo; số khách mới là tin tốt hoặc trung tính, không dùng màu nguy hiểm.
