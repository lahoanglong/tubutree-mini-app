# home-r5-webback: web Back Trang chủ về sai vị trí (CI đỏ)

Kết luận: CÓ SẴN trên main, không phải hồi quy của nhánh.

## Tái hiện (web-gate.sh, bản build prod, khối cổng 397x)
- Nhánh gl/1103-home, spec cũ + CDP CPU x5, không hook: before=8400 after=3104 scrollHeight=12781 (đúng số CI), đỏ cả "Web Customer" và "Web Customer Mobile".
- origin/main 90c3290cb (worktree tạm detach, đã gỡ), cùng spec + làm chậm: before=8400 after=3084 scrollHeight=12761, đỏ cả hai project.
- Spec cũ không làm chậm cũng đỏ trên máy tải cao (diff 5296); xanh khi máy rảnh.

## Nguyên nhân
Back từ trang sản phẩm về `/` là nạp tài liệu mới khi trình duyệt không giữ trang trong bộ nhớ đệm back/forward (CI, máy chậm). Local xanh vì bộ nhớ đệm giữ nguyên trang. Tài liệu mới dựng lưới Gợi ý từ trang 1 (cao 3916px), trình duyệt kẹp cuộn ở 3104. Cuộn vô tận chỉ nạp thêm khi tới đáy nên không bao giờ tự lên 8400.
Hook cũ (73508ccb5) chỉ khôi phục khi có popstate gần đây; tài liệu mới nạp bằng Back không có popstate nên hook không làm gì (thử đưa lại nguyên bản: vẫn 3104). Log định thời: scrollTo(0,8400) lặp, kẹp ở đáy, sentinel chạm, nạp trang, cao 6871 rồi 9826, tới 8400 sau ~740ms (CPU x5).

## Sửa
- `apps/web/src/lib/use-window-scroll-restore.ts` (+ spec vitest): đưa lại hook từ 73508ccb5, thêm điều kiện khôi phục khi `navigation.type === 'back_forward'` ở lần mount đầu của tài liệu (một lần), MAX_MS 1000 -> 4000, dừng thêm khi gõ phím.
- `apps/web/src/components/home/home-view.tsx`: gọi `useWindowScrollRestore('home')` (1 dòng + import).
- `apps/e2e/tests/home-back-scroll.web.spec.ts`: CDP `Emulation.setCPUThrottlingRate` 5 (chỉ Chromium); comment.
- Không đổi Mini App.
- Commit: xem hash ở báo cáo trả về (nhánh gl/1103-home, chưa push).

## Kiểm
- Đỏ không hook (có làm chậm): 3104 (nhánh), 3084 (main). Xanh có hook: 8400 -> 8400.
- web-gate home-back-scroll --repeat-each=3 --workers=1 --retries=0: 6 passed (2 project x 3), mỗi lần before=8400 after=8400.
- web-gate home-back-scroll + home-cls + footer-cls --workers=1: 14 passed.
- vitest web toàn bộ: 565 files, 9621 tests passed (hook spec 7 test, gồm 2 ca mới).
- tsc --noEmit web và e2e: 0 lỗi. eslint 3 file web: 0 lỗi (spec e2e không có eslint riêng, tsc e2e xanh).
- pnpm lint:parity: xanh (px-ratchet 3768/399, max-md 1014/103, không đổi).
- Đã dừng tiến trình cổng 3971-3975, gỡ worktree tạm gl-1103-home-mainchk.
## Lưu ý
- Strict Mode dev chạy effect hai lần: lần hai không còn cờ Back (chỉ ảnh hưởng dev). Prod không bị.
- Cần shared-types build lại trong worktree (API dev báo lỗi TS reversePreview nếu bản dist cũ).

# r6 (sửa theo reviewer Opus, commit nối tiếp dbd76a48d)
Trả lời câu hỏi kiểu điều hướng (đo bằng annotation `nav` trong spec, marker `window.__doc` để biết còn cùng tài liệu):
- Món giả `bs-sp-N` (không có ở API): trước click type=navigate cùngTàiLiệu=true; tại PDP cùngTàiLiệu=FALSE (nạp cứng, RSC của PDP không dựng được); sau goBack type=back_forward, cùngTàiLiệu=false. Đây là ca CI 8400 -> 3104, và đúng là tài liệu mới, không popstate. Vì vậy hook bản cũ (chỉ popstate) vẫn 3104. Nạp cứng là do e2e dùng slug không tồn tại, không phải khách thật.
- Món thật của DB e2e (chuyển mềm): tại PDP cùngTàiLiệu=true, sau goBack type=navigate cùngTàiLiệu=true (popstate trong cùng tài liệu). Spec thêm ca "mềm" (30+ sản phẩm thật, mỗi món một slug).
- Ca mềm lộ hai lỗi thật của hook: (1) Next co chiều cao trang rồi cuộn về 0 trước khi hook gỡ, nên cleanup ghi 0/5938 thay vì 6091 -> nay giữ vị trí lúc bấm (click capture, giữ 1500ms, hết nhịp mà vẫn ở lại thì lấy vị trí hiện tại); (2) sau popstate trình duyệt tự khôi phục vị trí cũ của nó (5938) ~30ms sau scrollTo của hook, đè lên -> nay hook giữ thêm 300ms ổn định, kéo lại nếu bị kéo ngược. Trước sửa: before=6091 after=5938; sau: 6091/6091.
Sửa theo reviewer: P2-1 nav.name phải cùng pathname (test nav.name=/dang-nhap không khôi phục); P3-1 lastY cập nhật ở stop() (test lưu 8400, cao 7000, hết giờ, rời trang -> 7000); P3-2 pointerdown dừng khôi phục (có test); P3-3 expect.poll timeout 6s thay mốc cứng 1500ms.
Kiểm: vitest hook 13 test; vitest web toàn bộ 565 files / 9627 tests passed; tsc web và e2e 0 lỗi; eslint 3 file 0 lỗi; lint:parity xanh (3768/399, 1014/103); web-gate home-back-scroll --repeat-each=3 --workers=1 --retries=0: 12 passed (2 project x 2 chế độ x 3); home-back-scroll + home-cls + footer-cls: 16 passed. Cổng 3971-3975 đã dừng.

# r7 (sửa theo reviewer lượt 2)
- P2-1: `stop()` chỉ lấy `lastY = scrollY` khi đang `restoring`; rời trang không qua bấm giữ vị trí đã ghi nhận (test: 5000, scrollY về 0 trước unmount, lưu 5000).
- P3-1: `clickY = scrollY` mỗi lần bấm (test: bấm 5000, cuộn 6000, bấm tiếp, lưu 6000).
- P3-2: onClick ghi ngay (test: bấm là có giá trị trong sessionStorage).
- P3-3: thêm ca trình duyệt kéo ngược ở 200ms; đột biến SETTLE_MS=50 làm ca này đỏ (1 failed | 16 passed). Comment ghi vì sao 300ms (đè đo được ~30ms).
- P3-4: ca mềm dùng expect (không skip, không catch) cho API và >= 30 sản phẩm.
- Tắt hook (bỏ dòng gọi trong home-view, đã trả lại): ca cứng before=8400 after=3104, ca mềm before=6091 after=5938, cả hai đỏ.
- Kiểm: vitest hook 17; vitest web 565 files / 9631 tests; tsc web+e2e 0 lỗi; eslint 3 file 0; lint:parity xanh (3768/399, 1014/103); web-gate home-back-scroll x3 workers=1 retries=0: 12 passed; + home-cls + footer-cls: 16 passed. Cổng 3971-3975 đã dừng.
