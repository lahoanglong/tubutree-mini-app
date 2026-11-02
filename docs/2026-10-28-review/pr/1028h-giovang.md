TITLE: fix(trang-chu): kệ Giờ vàng web không vẽ rồi biến mất khi HTML ISR được phát sau giờ hết suất (R-164)

## Vấn đề
R-164 (P3, backlog review 28/10): kệ Giờ vàng còn hai ca nhảy bố cục một lần.
1. Trang chủ web cache 300 s (ISR). Nếu HTML được phát sau giờ hết suất, kệ vẫn được vẽ (trước hydrate mọi suất coi là còn giờ), rồi hydrate gỡ kệ, cả trang nhảy lên. CLS đo được 0,24.
2. Lần đầu tải kệ rỗng thì máy nhớ "không có suất". Suất mới tới sau đó đẩy trang xuống. CLS khoảng 0,25.

## Có gì trong PR
Chỉ sửa ca 1, chỉ ở web:
- `apps/web/src/lib/flash-boot-script.ts` (mới) sinh một đoạn script nhỏ. Script nằm cuối khối kệ trong HTML máy chủ và chạy khi trình duyệt đọc tới nó, trước lần vẽ đầu.
  - Nếu theo đồng hồ máy, số suất còn giờ dưới mức tối thiểu của kệ (3) thì script ẩn khối.
  - Cùng phép tính với `FlashSale` lúc hydrate, nên kệ không hiện rồi biến mất.
  - Script đếm trên danh sách suất gốc (`guardEndAts`, trước chống trùng và cắt 8). Số suất còn giờ của danh sách gốc luôn lớn hơn hoặc bằng số món của kệ sau hydrate, nên script không bao giờ ẩn một kệ mà hydrate vẫn hiện.
  - `endAt` được nhúng bằng `JSON.stringify` có thoát `<`. CSP hiện chỉ ở chế độ report-only và cho phép inline script. Nếu sau này CSP chặn, script không chạy và kệ quay về hành vi cũ.
- `apps/web/src/components/home/flash-sale.tsx`:
  - Chỉ vẽ script trước hydrate.
  - Effect trả lại `display` khi hydrate vẫn thấy kệ hiện, ví dụ máy nhanh hơn giờ máy chủ, để không mất suất đang bán.
  - Khối có `suppressHydrationWarning` vì script đổi `style` trước hydrate.
- Ca 2 để mở. Bản đầu có giữ chỗ 276px theo dấu nhớ giờ suất kế. Review Opus chỉ ra phần này tự sinh cú nhảy 0,25 ở ca trước đây không nhảy (suất kế dưới 3 món, suất ngắn hơn 2 giờ, admin huỷ suất), nên đã bỏ hẳn. `packages/app-core` không đổi.
- Mini không đổi: lần mở đầu không nhảy, vì Trang chủ Mini giữ khung chờ chung tới khi biết suất.
- Suất mới về giữa phiên (tải lại nền 60 s) vẫn đẩy trang ở cả hai nền. Giữ nguyên: giấu suất mới tới lần mở sau thì mất doanh thu.

Không đổi API, không có migration. HTML Trang chủ khi có kệ thêm khoảng 300 byte script.

## Cách kiểm
- **CLS web 375×812 (lane 3, đo trên bản trước khi dời script vào cuối khối; cơ chế giống):**

  | Ca | Trước | Sau |
  |---|---|---|
  | mở đầu bình thường | 0,0035 | 0,0035 |
  | HTML ISR quá giờ (dựng thật, JS chậm 2,5 s) | 0,2411 | 0,0035 |

- **Test (`flash-sale.spec.tsx`, `flash-boot-script.spec.ts`)** chạy script thật trên DOM thật, SSR thật rồi `hydrateRoot`:
  - còn giờ thì giữ kệ;
  - quá giờ thì ẩn trước khi React chạy;
  - hydrate không remount kệ;
  - máy nhanh hơn máy chủ thì kệ hiện lại;
  - quá 8 suất thì không ẩn nhầm.
  - Kiểm đột biến: bỏ effect hiện lại, hoặc đếm trên kệ đã cắt, thì ca tương ứng đỏ.
- **Review Opus hai lượt:**
  - Lượt 1: "merge được", có P2 ở phần ca 2, nên đã bỏ phần đó.
  - Lượt 2: "merge được", không có P0, P1, P2. Đã sửa P3 về đếm trên danh sách gốc.
  - P3 còn lại, theo thiết kế: script dùng đồng hồ máy, hydrate dùng giờ máy chủ. Máy chậm hơn máy chủ thì vẫn là hành vi cũ (kệ hiện rồi biến mất), không tệ hơn.
- **Gate (`tools/gate.sh --no-jest`): 0 FAIL.**
  - PASS: tsc 6 gói, eslint (API, Mini App, web), lint:parity, lint-vars, vite build.
  - vitest: app-core 2325, Mini App 6308 (cả giờ UTC), web 9337.
  - bundle Mini: entry 651/203 KB, không đổi.
  - Sau commit cuối: vitest web 9337/9337.
- **Web gate:** `home-merged`, `home-banner-lg`, `flash-slots`: 20 pass, 2 bỏ qua theo khổ.
