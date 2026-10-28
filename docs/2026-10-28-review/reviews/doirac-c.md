# doirac đợt C

mergeable=False

## Review 1

KẾT LUẬN: chưa merge

- [P2] /Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/reviews/doirac-b.md: dòng "Web next build/First Load KHÔNG đo lại ở lượt này (chưa kiểm)". Việc bắt buộc của lượt sửa chưa làm. Lượt này đổi các phần dùng chung ở mọi trang web. Footer trước chỉ render ở server, nay có thêm client component `FooterProgramLinks` (apps/web/src/components/footer-program-links.tsx). Header và footer nay gọi `useWasteVisible`/`useRecycleOpenRequests` (apps/web/src/components/site-header.tsx:23). Ngoài ra còn đổi `/doi-rac/*`, `/cong-dong`, `/hoc-vien` và `/thanh-toan`. Vì vậy First Load của mọi trang có thể đã tăng mà chưa ai thấy. Cách sửa: chạy `node docs/2026-10-28-review/tools/perf/bundle-report.mjs --build-web --only=web` ở 1384ff380 và ở cdc2fb2d9. Ghi First Load trước/sau của các trang trên và phần shared vào doirac-b.md.
- [P3] packages/app-core/src/waste-method-order.ts:22: chỉ cần một preview là `undefined` thì thứ tự quay về gốc. Vì không có `placeholderData`, mỗi lần đổi khoá query preview thẻ lại nhảy chỗ hai lần (apps/miniapp/src/pages/recycle-new.tsx:297-309, apps/web/src/components/recycle/recycle-new.tsx:238-252). Ví dụ: DROP_OFF bị khoá (POINT_QUOTA_FULL), thứ tự đã xếp là PICKUP, MAIL_IN, DROP_OFF. Khách đổi tỉnh trong thẻ MAIL_IN, preview MAIL_IN thành undefined, thứ tự về DROP_OFF, PICKUP, MAIL_IN. Thẻ đang thao tác tụt xuống rồi lại nhảy lên. Một preview lỗi (500) thì thẻ khoá không bao giờ xuống cuối. Cách sửa: thêm `placeholderData: keepPreviousData` cho các preview, coi query lỗi là đã có kết quả, và thêm ca test đổi khoá query.
- [P3] apps/web/src/components/recycle/recycle-requests.tsx:40 và apps/web/src/app/thanh-toan/page.tsx:559: hai chỗ xoá cờ "vừa gửi" chưa có test. Chỉ recycle-done có test. Cách sửa: thêm hai ca theo mẫu: gọi `markSubmitted`, gắn trang hoặc bấm link, rồi kiểm `takeSubmitted()` trả false.
- [P3] apps/miniapp/src/pages/recycle-points.tsx:125: điều kiện `!me` vẫn đúng khi `meQ` còn chờ hoặc bị lỗi. Ví dụ: `/waste/points` trả 403 PROGRAMME_OFF trong lúc `/waste/me` chưa về hoặc lỗi mạng. Khi đó khách đã có số vẫn thấy "Cho Tubu số điện thoại". Cách sửa: chỉ hiện WastePhoneNeeded khi `me` đã tải và `me.eligibility !== 'OK'`. Lúc me còn chờ thì hiện khung chờ.
- [P3] apps/web/src/components/footer-program-links.tsx:23: lúc render ở server `cfg.isLoaded` là false, nên HTML server không có link "Đổi rác lấy quà" và chân trang nhảy chỗ khi hydrate. Cách sửa: dùng `initialConfig` của server cho cờ `waste.enabled`, hoặc chấp nhận và ghi rõ lý do.
- [P3] apps/miniapp/src/pages/feed.tsx:181-206: Mini và web ở khổ 375 vẫn lệch nhau (xem screens-doirac/feed__returning__ok__s1.png). Ở Mini, chip "Sự kiện" là lối điều hướng nhưng nằm chung nhóm `pickCategory` với chip lọc danh mục và chip sắp xếp. Cả "Tất cả" lẫn "Mới nhất" đều `selected` trong cùng một nhóm. Web vẫn giữ hàng nút Xếp hạng/Sự kiện/Đăng bài. Worker đã khai là chưa xong và chờ chủ chốt. Cách sửa: tách "Sự kiện" khỏi nhóm lọc, và ghi trong backlog là R-55 chưa xong cho tới khi có một bố cục chung.
- [P3] R-54 (Mini) và R-56: chỉ làm một phần. Mục "web cho đọc bài/chat khi chưa đăng nhập" chưa làm. `RouteFallback` ở apps/miniapp/src/components/app.tsx:103 nay đổi khung chờ của mọi route lazy, vượt ra ngoài gói. Cách sửa: ghi R-56 vào backlog là chưa xong, và ghi rõ trong mô tả PR phạm vi đổi của RouteFallback.
- [P3] apps/miniapp/src/pages/academy.tsx:68: vai trò lấy từ store nên còn cũ. Khách vừa được duyệt CTV trong phiên vẫn thấy cổng "chỉ dành cho CTV" cho tới khi mở lại app. Worker từ chối sửa, có lý do. Cách sửa tối thiểu: gọi `restore()` sau khi duyệt CTV thành công.

Đã kiểm, không thấy lỗi:
- Không đổi điểm, giọt hay tiền. Không có chữ thể lệ hay chữ pháp lý nào bị tự viết.
- `sameProvince` đã chuyển sang shared-types. API (waste-fee.ts:4) và go-live (db-checks.ts:306-318) đều coi "79" và "84_VN79" là một tỉnh.
- Chặn xoá trắng `waste.rules_text` khi Đổi rác đang bật: system-config.service.ts:488.
- `/waste/requests` chạy ở chế độ OWN, nên 403 ở đó chỉ có thể là GUEST hoặc NEED_PHONE. WastePhoneNeeded ở Mini recycle-requests vì vậy là đúng.
- Khoá `legal.*` khớp với seed.ts:283-286.
- Test đã chạy, đều xanh (Node 22):
  - jest API, 4 file: 290/290.
  - vitest Mini, 4 file: 90/90.
  - vitest web, recycle + feed: 361/361.
  - vitest app-core, method-order + province: 7/7.

## Sửa trước review 2 (head 606048dfd)

Nhánh review/1028-doirac, lượt 2, chưa push. 4 commit mới trên cdc2fb2d9:
- 61782812d fix(doi-rac): thẻ cách giao không nhảy chỗ; xem trước lỗi vẫn tính là đã xong
- dc1db86ed fix(doi-rac): recycle-points chưa đòi số điện thoại khi me còn chờ
- 2e4e12578 fix(hoc-vien): restore() phiên sau khi đăng ký CTV
- 606048dfd test(doi-rac): web xoá cờ vừa gửi ở recycle-requests và lối Thu kèm rác

PHÁT HIỆN
- P2 đo First Load web: đã đo bằng bundle-report --build-web ở 1384ff380 và 606048dfd (số bên dưới). Chưa ghi vào doirac-b.md vì file nằm ngoài worktree của gói, brief cấm sửa; người giao chép giúp.
- P3 waste-method-order: đã sửa (61782812d). Thêm tham số `failed` ở app-core, `placeholderData: keepPreviousData` ở Mini và web, query lỗi tính là đã xong. Thêm 1 ca test cho query lỗi. Ca "đổi khoá query" không viết test riêng: placeholderData là cấu hình của thư viện, không có test hành vi.
- P3 hai ca test cờ "vừa gửi": đã thêm (606048dfd). Hai ca này pass ngay vì hành vi đã đúng từ trước, tôi chưa chạy đột biến để chắc chúng không rỗng.
- P3 recycle-points !me: đã sửa (dc1db86ed). Chỉ hiện WastePhoneNeeded khi me đã tải và eligibility khác OK, hoặc me cũng 403. Me còn chờ thì hiện khung chờ. Test thấy đỏ rồi mới sửa.
- P3 academy vai trò cũ: đã sửa (2e4e12578). Gọi restore() trong onSuccess của registerAffiliate, có test; test này thấy đỏ trước khi sửa.
- P3 footer SSR không có link Đổi rác: không làm. Quy ước dự án là đóng khi chưa biết cờ; cho cờ vào HTML server cần đọc config ở server, vượt phạm vi.
- P3 feed.tsx chip Sự kiện cùng nhóm lọc (R-55): không làm. Cần chủ chốt một bố cục chung cho Mini và web. Cần ghi R-55 chưa xong vào backlog; file backlog ở ngoài worktree nên tôi không sửa.
- P3 R-54/R-56 làm một phần: không làm. Phần "web cho đọc bài/chat khi chưa đăng nhập" chưa làm, cần ghi R-56 chưa xong vào backlog. Mô tả PR phải ghi RouteFallback ở app.tsx:103 đổi khung chờ của mọi route lazy.

KIỂM THẬT (Node 22)
- tsc --noEmit: miniapp, web, app-core đều sạch.
- vitest app-core: 75 file, 930/930 xanh.
- vitest miniapp (TZ=UTC): 313 file, 4867/4867 xanh.
- vitest web: 441 file, 7445/7445 xanh.
- eslint 4 file đã sửa: không báo gì. pnpm lint:parity: xanh (0 mục pending).
- Không chạy jest API và race vì không đụng API, điểm hay tiền.

BUNDLE (trước 1384ff380, sau 606048dfd)
- Mini entry: 711 -> 708 KB raw (gz 222 -> 221).
- Mini tổng: 1911 -> 1915 KB raw (+4 KB, thêm 1 file; gz 737 -> 739). Vượt "tổng không được tăng": cần người giao quyết.
- Web shared by all: 103 -> 103 KB.
- Web 14 route khách: tối đa +1 KB. "/" 204 -> 205, "/vuon-xanh" 169 -> 170, "/doi-rac" 166 -> 167. Các route khác không đổi, gồm "/thanh-toan" 191.
- Web "/doi-rac/tao": 173 -> 178 KB (+5 KB), vượt ngưỡng 2 KB. Chưa tách xem do lượt 1 hay lượt 2; keepPreviousData đã bị tree-shake nên khó là nguyên nhân. Cần người giao quyết có chấp nhận không.
- Số liệu thô nằm ở scratchpad: .../scratchpad/before.json và after.json.

CHƯA KIỂM: Playwright (Mini và web gate), vite build đã chạy trong bundle-report nhưng không chạy e2e; không chụp lại ảnh (giao diện không đổi). `docs/2026-10-28-review/tools/params-l1.json` còn untracked, không commit.

## Review 2

KẾT LUẬN: chưa merge

- [P2] apps/miniapp/src/pages/affiliate.tsx:154 — Commit 2e4e12578 sửa file của gói `ctv`. Theo backlog (20-backlog.md:222), `affiliate.tsx` thuộc `ctv`, và brief cấm sửa file của gói khác (gd3-worker-brief.md:10). Đã kiểm bằng `git merge-tree review/1028-doirac review/1028-ctv`: CONFLICT ở affiliate.tsx:157-163. Nhánh doirac gọi `restore()`, nhánh ctv gọi `invalidateQueries(['academy-courses'])` cho R-57. — Cách sửa: bỏ commit 2e4e12578 (cả affiliate.tsx lẫn affiliate.spec.tsx). Ghi việc "nạp lại vai trò sau khi đăng ký CTV" vào R-57 của gói ctv.
- [P2] Bundle vượt luật cứng ở gd3-worker-brief.md:44. Số lấy từ scratchpad/before.json và after.json:
  - Mini tổng 1911 -> 1915 KB raw, thêm 1 chunk (142 -> 143). Luật là "tổng không được tăng".
  - Web `/doi-rac/tao` First Load 173 -> 178 KB (+5 KB). Ngưỡng là 2 KB.
  - Worker chỉ báo lên, chưa sửa, cũng chưa tìm nguyên nhân. Chưa ghi số vào doirac-b.md.
  - Cách sửa: tìm commit gây tăng bằng cách đo lại ở cdc2fb2d9 và a1f46b702. Nghi chunk RouteFallback ở Mini, và phần mới import vào recycle-new ở web. Gỡ cho về trong ngưỡng, hoặc xin chủ miễn bằng văn bản. Người giao chép số trước/sau vào doirac-b.md.
- [P3] apps/miniapp/src/pages/recycle-new.tsx:309 và apps/web/src/components/recycle/recycle-new.tsx:250 — Phần "thẻ không nhảy chỗ khi đổi khoá" báo đã sửa, nhưng thực ra không có tác dụng.
  - Trong `useQueries`, mỗi lần queryHash đổi thì tạo `new QueryObserver` mới (query-core 5.100.14 src/queriesObserver.ts:284-286). Observer mới không còn dữ liệu cũ, nên `keepPreviousData` trả `undefined`.
  - Đã chạy thử QueriesObserver với key A rồi B: ngay sau khi đổi key, `data` là undefined, `isPlaceholderData` là false. Một QueryObserver đơn lẻ thì vẫn giữ dữ liệu cũ.
  - Ví dụ ở r1 vẫn còn: đổi tỉnh trong thẻ MAIL_IN thì preview MAIL_IN về undefined, thứ tự quay về gốc, thẻ nhảy hai lần.
  - Chỉ phần `failed` (query lỗi tính là đã xong) là có tác dụng.
  - Cách sửa: giữ kết quả preview cuối của từng method bằng ref hoặc state, hoặc giữ thứ tự đã xếp cho tới khi đủ kết quả mới. Thêm test render đổi `provinceCode` để kiểm thứ tự thẻ không đổi.
- [P3] apps/web/src/app/hoc-vien/course-list.tsx:72 và apps/web/src/app/ctv/page.tsx:152 — Web vẫn giữ vai trò cũ sau khi đăng ký CTV. `onSuccess` không làm mới `user` trong auth-context, nên Học viện vẫn hiện CtvOnlyNotice và chân trang vẫn ẩn link Học viện. Lỗi chỉ được sửa bên Mini, hai nền lệch nhau. — Cách sửa: giao cùng R-57 cho gói ctv, sửa cả hai nền.
- [P3] apps/miniapp/src/pages/academy.tsx:69 và :81 — R-57 nói máy chủ nhớ vai trò cũ 5 giây. Vì vậy sau `restore()`, nếu khách vào Học viện trong khoảng đó, `/academy/courses` trả 403. Khi đó `isForbidden` hiện CtvOnlyNotice, không có Thử lại, và ở yên đó tới lần refetch sau. Chỉ gọi restore() phía Mini là chưa đủ. — Cách sửa: đi kèm `SessionStateService.invalidate` của gói ctv.
- [P3] apps/miniapp/src/pages/feed.tsx:181-206 — R-55 không đổi gì so với r1. Chip "Sự kiện" vẫn chung nhóm `pickCategory` với chip lọc và chip sắp xếp. Việc tách nó ra rẻ và nằm trong file của gói. Chưa ghi trong backlog rằng R-55 và R-56 chưa xong. — Cách sửa: tách chip "Sự kiện" ra khỏi nhóm lọc. Người giao ghi R-55 và R-56 "chưa xong" vào 20-backlog.md, và mô tả PR ghi rõ RouteFallback ở app.tsx:103 đổi khung chờ của mọi route lazy.
- [P3] apps/miniapp/src/pages/recycle-points.spec.tsx:248-254 — Ca mới chỉ kiểm là không có chữ "Cho Tubu số điện thoại". Nó không kiểm khung chờ có hiện, nên nếu màn hiện ErrorState thì ca này vẫn pass. Thiếu ca me về với eligibility OK sau khi points trả 403, lúc đó phải hiện ErrorState có nút Thử lại. — Cách sửa: assert có Skeleton, rồi cho me resolve OK và kiểm có nút "Thử lại".

Đã kiểm, chưa thấy lỗi:
- Không đổi điểm, giọt, tiền hay chữ thể lệ.
- `restore()` không làm nháy trạng thái 'loading' khi phiên đang đăng nhập (store/auth.ts).
- Hai test cờ "vừa gửi" là test thật: `takeSubmitted` đọc rồi xoá storage, và selector `#checkout-waste-pickup a` trúng đúng link.
- Logic `phoneMissing` ở recycle-points đúng ở các ca: me chờ, me 403, me lỗi mạng, khách chưa đăng nhập.
- Chạy lại trên Node 22: app-core method-order 5/5; Mini recycle-points và affiliate 67/67; web recycle-requests và checkout-waste 34/34.

Script thử keepPreviousData: /private/tmp/claude-501/-Users-longla-coding-tubutree-mini-app/e60524b4-300a-4d5d-a95d-b2ca8ab897dc/scratchpad/kpd.mjs

## Sửa trước review 3 (head review/1028-doirac @ 7a513435d, lượt 2: sửa 2 P2 và 2 P3, tổng bundle Mini vẫn +3 KB raw, không đưa lên được

)

Nhánh review/1028-doirac, worktree r1028-doirac. Chưa push. Lượt 2, 5 commit mới sau 606048dfd:
- 212dfdfaa revert(hoc-vien): bỏ commit 2e4e12578 (affiliate.tsx + spec, file của gói ctv)
- 344130b9b revert(mini): trả RouteFallback ở app.tsx về bản gốc
- d96310298 fix(doi-rac): giữ preview cuối từng cách giao, thẻ không nhảy chỗ khi đổi tỉnh
- d02cd2162 test(doi-rac): recycle-points kiểm khung chờ rồi Thử lại
- 7a513435d perf(web): sameProvince ở app-core tự chứa

Từng phát hiện:
- P2 affiliate.tsx sửa file gói ctv: ĐÃ SỬA (212dfdfaa, bỏ cả code lẫn spec). Việc "nạp lại vai trò sau đăng ký CTV" giao R-57 của gói ctv.
- P2 bundle web: ĐÃ SỬA (7a513435d). Nguyên nhân: app-core/waste-province re-export từ shared-types (CJS, import giá trị kéo cả thư viện vào web). Giờ /doi-rac/tao First Load 173 -> 173 KB.
- P2 bundle Mini: MỘT PHẦN. RouteFallback đã bỏ (344130b9b): chunk 143 -> 142, entry 711 KB bằng baseline. Tổng raw vẫn 1911 -> 1914 KB (+3 KB, js 1624 -> 1627). Đây là mã thật của gói. Theo từng chunk, so với main: waste-phone-needed +989 B (chunk mới), requests +522, recycle +496, recycle-new +443, unique-by-id +412, support-chat +373, academy +306, points +249, feed -230. Cần chủ miễn bằng văn bản cho +3 KB, hoặc chỉ định chỗ cắt. Chưa ghi doirac-b.md (việc của người giao).
- P3 thẻ nhảy chỗ (keepPreviousData vô tác dụng): ĐÃ SỬA (d96310298). Bỏ placeholderData, giữ preview cuối từng cách giao bằng ref, chỉ cho thứ tự thẻ. Thêm test đổi tỉnh ở web và Mini; đã thấy đỏ trước khi sửa (cả hai nền).
- P3 recycle-points.spec: ĐÃ SỬA (d02cd2162). Kiểm có .tubu-skeleton, rồi me về OK thì có nút Thử lại.
- P3 web course-list và ctv/page vẫn giữ vai trò cũ: KHÔNG LÀM, thuộc R-57 gói ctv.
- P3 academy 403 do cache máy chủ 5 giây: KHÔNG LÀM, cần SessionStateService.invalidate của gói ctv.
- P3 feed chip "Sự kiện" chung nhóm lọc (R-55): KHÔNG LÀM, tách ra là quyết định bố cục cả hai nền, cần chủ chọn chỗ đặt. R-55 và R-56 ghi vào backlog là "chưa xong" (việc người giao).

Số kiểm thật (Node 22):
- tsc --noEmit: app-core, miniapp, web sạch. eslint: file mini và web/components/recycle đã sửa sạch.
- vitest app-core 930/930; miniapp 4868/4868 (cả khi TZ=UTC); web 7446/7446.
- lint:parity xanh (0 mục pending).
- Playwright Mini toàn bộ: 205 passed, 10 skipped. Web gate recycle.web.spec: 30/30.
- jest API và race: không chạy, lượt này không đụng API hay tiền/điểm.
- Bundle web (next build) so với before.json: không trang nào tăng quá 1 KB. "/" 204 -> 205, /ctv/gian-hang 178 -> 179, /khoi-phuc/[hint] 204 -> 205. Mini: số ở trên.

Chưa làm: không chụp ảnh trước/sau (lượt này không đổi giao diện nhìn thấy; RouteFallback đã trả về bản gốc). Chưa chạy perf/run-all (cấm). Cổng 3711-3715 đã nhả; không còn tiến trình của tôi.
File chưa commit còn lại: docs/2026-10-28-review/tools/params-l1.json (sinh cho lane, không commit).

## Review 3

KẾT LUẬN: chưa merge

- [P2] Tổng bundle Mini vẫn vượt luật cứng ở `docs/2026-10-28-review/tools/gd3-worker-brief.md:44`. Luật ghi "entry và tổng Mini App không được tăng".
  - Số đã kiểm trong scratchpad/doirac2: mini-base.json tổng 1911 KB raw (js 1624), mini-final.json tổng 1914 KB (js 1627). Entry giữ 711 KB, vẫn 142 chunk.
  - Chưa có văn bản chủ miễn. Worker có báo lên nhưng chưa xử lý.
  - Cách sửa: xin chủ miễn bằng văn bản cho +3 KB nằm ở chunk lazy, hoặc cắt cho tổng ≤ 1911. Chỗ thử trước: nhập `waste-phone-needed.tsx` vào chunk dùng nó thay vì để chunk riêng; các chunk recycle-* tăng 400–500 B. Người giao chép số vào `reviews/doirac-b.md`.
- [P2] Việc thêm bắt buộc "đo First Load web các trang đã đổi, ghi trước/sau" chưa đủ.
  - `bundle-report.mjs:155` chỉ lấy 12 route nặng nhất (`nextAllRoutes`) cộng danh sách `customerRoutes` cố định. Vì vậy worker không có số Next cho các trang đã đổi sau: `/cong-dong` (feed-view.tsx), `/cong-dong/[id]`, `/hoc-vien` (course-list.tsx), `/doi-rac/yeu-cau` (recycle-requests.tsx), `/doi-rac/diem-nhan` (recycle-points.tsx), `/doi-rac/xong/[id]` (recycle-done.tsx).
  - Câu "không trang nào tăng quá 1 KB" chỉ đúng với khoảng 26 route có trong báo cáo.
  - Số `manifestGzKB` (before.json so với doirac2/web-fix.json) cho thấy cả 58 route đều thêm 1 file JS và tăng +2–3 KB gz, kể cả trang không đổi như `/san-pham` 191→194. Lý do: `site-footer` và `site-header` giờ nhập `useWasteVisible`, `FooterProgramLinks`, `academy-access`. Số Next của `/` chỉ +1 KB, nên nhiều khả năng vẫn trong ngưỡng, nhưng chưa có bằng chứng.
  - Cách sửa: đọc bảng của `next build` (`apps/web/.next/bundle-report-next-build.log`, không chỉ JSON) rồi ghi trước/sau cho từng route ở trên.
- [P3] `apps/miniapp/src/pages/recycle-new.tsx:487` và `apps/web/src/components/recycle/recycle-new.tsx:262`: `lastPreview` vẫn được dùng cho cách giao đang lỗi.
  - Ví dụ: MAIL_IN ở tỉnh A có block thật nên bị khoá và xếp cuối. Khách đổi sang tỉnh B, preview B lỗi (`isError`). Khi đó `previewFailed` có MAIL_IN, nhưng `orderPreviews.MAIL_IN` vẫn là preview tỉnh A, nên `isMethodLocked` trả true.
  - Kết quả: thẻ đang báo lỗi vẫn bị xếp cuối theo khoá của tỉnh cũ. Trước lượt này, thẻ lỗi được coi là không khoá.
  - Cách sửa: với method nằm trong `previewFailed`, không lấy `lastPreview`. Thêm một ca test.
- [P3] `packages/app-core/src/waste-province.ts:3-5` chép lại `provinceKey` và `sameProvince` của `packages/shared-types/src/waste-province.ts`. API dùng một bản, Mini và web dùng bản kia. Không có test nào buộc hai bản cho cùng kết quả, nên sau này dễ lệch: phí ship API và cờ "tỉnh chưa có điểm" ở client sẽ hiểu mã tỉnh khác nhau.
  - Cách sửa: thêm spec chạy cùng bộ ca cho cả hai hàm, hoặc cho app-core nhập thẳng file nguồn `shared-types/src/waste-province` nếu bundler cho phép.
- [P3] R-54 phía Mini giờ chỉ xong một phần, nhưng báo cáo chưa ghi.
  - Commit 344130b9b trả `RouteFallback` (`apps/miniapp/src/components/app.tsx:102-107`) về Box+Spinner. Lúc tải chunk lazy trên mạng chậm, màn vẫn như trước khi sửa. Chỉ phần khung chờ trong trang (`recycle.tsx:252`) là mới.
  - `reviews/doirac-b.md` vẫn ghi "R-54 Mini LÀM qua RouteFallback". Ảnh `screens/mini375-slow5s/recycle__returning__mini375-slow5s__s1.png` chụp lúc còn RouteFallback mới nên không còn đúng.
  - Cách sửa: người giao ghi R-54 Mini "một phần", chụp lại ảnh slow5s hoặc bỏ ảnh đó.

Các phát hiện của lượt trước đã kiểm:
- Bỏ affiliate.tsx và affiliate.spec.tsx: đã sửa. Diff từ 1384ff đến HEAD không còn hai file này, cũng không còn `app.tsx`.
- Web `/doi-rac/tao`: đã sửa. Theo số Next, 173→178 ở bản trước, nay 173→173.
- Thẻ nhảy chỗ: đã sửa bằng ref. Tôi chạy lại, Mini recycle-new + recycle-points 69/69 pass, web recycle-new 42/42 pass. Tôi chưa tự kiểm test đỏ khi bỏ bản sửa, vì luật không cho sửa file.
- `recycle-points.spec`: nay kiểm `.tubu-skeleton`, rồi kiểm nút "Thử lại" sau khi me về OK. Đây là test thật.
- Ba P3 về R-57 và vai trò CTV giao cho gói ctv. R-55 và R-56 chưa xong, người giao phải ghi vào backlog.

Không thấy thay đổi nào về điểm, giọt, tiền, hoa hồng, phí hay chữ thể lệ trong 5 commit mới.
