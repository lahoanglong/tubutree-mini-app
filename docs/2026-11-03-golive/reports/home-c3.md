# home-c3: sửa phát hiện reviewer Opus lượt 2 (nhánh gl/1103-home, tip 224a20883, chưa push)

Commit: 23f3d0af8 (sửa mã + spec), 56f27ba8c (e2e Back cuộn web), 224a20883 (e2e đo CLS web). Node 22.23.3, vitest `--minWorkers=1 --maxWorkers=2`, Playwright `--workers=1`, không bật lane (dùng web-gate với khối cổng 3980).

## Từng phát hiện
- P1 member-card.spec web: ĐÃ SỬA. Hai assert đổi sang `${HOME_HERO_HEIGHT}px`, ca đổi tên. Tìm thêm: 11 ca `home-requests.spec.tsx` của Mini cũng đỏ ở HEAD e5bf2d534 (SuggestFeed gọi `useNavigationType` không có Router); đã mock hook trong spec.
- P2 suggest-feed chip PUSH rồi POP: ĐÃ SỬA. Test mới "mở mới bằng PUSH rồi Back" đỏ với mã cũ (chip Sữa sống lại), xanh sau khi `saveChip('all')` ở initializer khi không phải POP. Kiểm cache `near` theo `categoryId` của chip khôi phục.
- P2 entry Mini +148 B gz: KHÔNG SỬA, ghi nhận tường minh: +646 B raw / +148 B gz so với gốc (675205/210327 -> 675851/210475 theo reviewer). Không đo lại vì máy tải 11-17. Mã trong entry thêm cho: context HomeBlockErrorSuppressed, khung chờ ShortcutGrid, nhánh TodoStrip, wrapper HomeScrollRestoration. Cần phiên điều phối chấp nhận hoặc đòi cắt (cắt thêm sẽ phải bỏ một chức năng đã sửa).
- P2 HIEUNANG-03: ĐO, CHƯA ĐẠT. `apps/e2e/tests/home-cls.web.spec.ts` (persona returning, /me/summary giữ 500ms rồi về active=2, có đơn đang giao): CLS web375 = 0,0793 (máy mới) và 0,0796 (máy đã nhớ loại khách + số dòng), web1280 = 0,0067 / 0,0067. Một cú dịch +80px của khối từ y172 trở xuống ở khoảng 650ms cho cả hai ca, nên bộ nhớ số dòng không giúp trong kịch bản summary chậm: khung chờ chung (HomeSettlingSkeleton) không có dòng Việc cần làm. Chưa sửa (cần đổi khung chờ chung ở cả Mini và web, ngoài ngân sách lượt này). Chưa đo "trước" trên gốc 52fd5cd65 (cần một web-gate nữa trên worktree gốc). Mini: `home-p6-cls.miniapp.spec` + `home-merged.miniapp.spec` xanh (CLS ≤ 0,02).
- P2 bằng chứng: LÀM MỘT PHẦN.
  - home-back-scroll.web.spec: chạy qua web-gate, xanh: `BACK-SCROLL before=8400 after=8400 scrollHeight=12781`, đã commit. KHAMPHA-01 web 375 đạt.
  - axe: `a11y-shop.web.spec.ts` (gồm /san-pham, /san-pham?all=1) 24 ca xanh cùng lượt với home-cls (2 trang + 8 ca CLS) nên KHAMPHA-16 không tái hiện.
  - Ảnh: docs/2026-11-03-golive/screens-home/ có 4 ảnh web (375/1280, máy mới/đã nhớ), xem web375-nho.png: thẻ 84px, dải Việc cần làm, lối tắt đúng. Thiếu: ảnh Mini 375, ảnh before, persona new/guest/error500/longtext (cần lane), đo CLS HIEUNANG-04 (aria-busy) trước/sau.
  - Báo cáo cho e5bf2d534: gộp vào file này.
- P3 web suggest-feed không nhớ chip: KHÔNG SỬA. Web dựng "Tất cả" từ HTML server (initialData); khôi phục chip khi Back gây lệch hydrate, và trình duyệt tự khôi phục cuộn nên sai lệch chỉ khi khách đã đổi chip. Ghi nhận lệch Mini/web.
- P3 member-card maxWidth 60%: ĐÃ SỬA ở Mini và web (chỉ kẹp khi có tên bậc). Chưa có test riêng.
- P3 shortcut-grid ca waste tắt + open-count: KHÔNG SỬA, chấp nhận (hiếm: waste tắt mà còn yêu cầu mở; cần giữ khung chờ thêm một query).

## Kiểm (số thật)
- web vitest: 562 file / 9581 test xanh
- miniapp vitest TZ=UTC: 416 file / 6546 test xanh
- tsc --noEmit miniapp và web: sạch
- Playwright web (web-gate): home-back-scroll 2 xanh; home-cls + a11y-shop 24 xanh; Mini: home-p6-cls + home-merged 2 xanh
- eslint: chưa chạy (npx eslint không có trong PATH gốc worktree)
- app-core vitest: không chạy lại (không đổi mã app-core ở lượt này)
