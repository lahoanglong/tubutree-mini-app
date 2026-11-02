TITLE: fix(ctv,ho-so,web): khoá Chuyển vào Ví tới khi dashboard làm mới xong; ngày sinh ghi tháng bằng chữ; thanh kéo sheet web (R-185, R-190, R-193)

## Vấn đề
Ba mục P3 trong backlog review 28/10:
- **R-185:** sau khi CTV chuyển hoa hồng vào Ví, nút "Chuyển vào Ví" khoá theo `transferredStamp === dashQ.dataUpdatedAt`. Còn hai khe:
  - Một lần tải dashboard bắt đầu trước khi chuyển xong nhưng trả về sau đó thì mở nút trong khi số dư còn cũ.
  - Rời trang rồi quay lại thì mất mốc.
  - Máy chủ đã chặn chuyển thừa (`affiliate.service.ts`: `amount === available`, khoá dòng hoa hồng trong giao dịch). Nên đây là lỗi trải nghiệm: khách mở form với số cũ rồi nhận báo lỗi, không mất tiền.
- **R-190:** khách dán hoặc trình duyệt tự điền ngày kiểu Mỹ "03/05/1990" thì ô đọc thành 3 tháng 5. Ngày sinh chỉ đặt được một lần.
- **R-193:** sheet web ở khổ điện thoại không có thanh kéo trên đầu như sheet Mini.

## Có gì trong PR
- **R-185:**
  - `packages/app-core/src/ctv-dashboard.ts` có một store nhỏ ở cấp module: `lockTransferUntil`, `isTransferRefreshing`, `subscribeTransferRefreshing`.
  - Khi chuyển xong, hai app gọi `lockTransferUntil`. Hàm này khoá nút tới khi Ví rồi dashboard làm mới xong. Dashboard làm mới bằng `invalidateQueries({ refetchType: 'all' })`: lần tải cũ đang bay bị huỷ, và dashboard vẫn tải lại khi trang đã rời đi.
  - Không so `dataUpdatedAt` hay giờ máy, nên lần tải cũ trả về muộn hoặc đồng hồ máy lùi đều không mở nhầm nút.
  - Hai app đọc cờ bằng `useSyncExternalStore`, nên gỡ rồi gắn lại trang vẫn giữ khoá.
  - Store đếm số lần làm mới đang chạy, nên hai lần chuyển chồng nhau không mở nút sớm.
  - Làm mới lỗi thì nút vẫn mở. Khi đó form không biết số tối đa, và máy chủ tự kiểm.
- **R-190:**
  - `profileCopy.dobConfirm` (app-core, hai app dùng chung) ghi tháng bằng chữ, ví dụ "Ngày sinh 3 tháng 5 năm 1990 chỉ đặt được một lần. Xác nhận?", để khách thấy ngay nếu ngày bị đảo.
  - Không tự đảo ngày và tháng: khách Việt dán dd/mm sẽ bị đảo sai.
- **R-193:**
  - `apps/web/src/components/ui/sheet.tsx` có hàng thanh kéo 48×6 px, `aria-hidden`, chỉ hiện ở khổ điện thoại (`md:hidden`), giống sheet zmp-ui.
  - Khổ máy tính không đổi.
  - Phần liên kết "Gửi đơn sàn" chưa làm: web chưa có trang gửi đơn sàn.

Không đổi API, không có migration, không đổi luật tiền hay điểm. Phần Mini chỉ tới khách khi đẩy bản Mini App mới.

## Cách kiểm
- **Test viết trước, thấy đỏ rồi mới sửa:**
  - app-core `ctv-dashboard.spec.ts`: khoá trong lúc làm mới, mở khi xong, mở khi lỗi, hai lần chồng nhau. Ca chồng nhau đỏ với bản cờ boolean.
  - `account-copy.spec.ts`: "03/05/1990" thành "3 tháng 5 năm 1990".
  - `sheet.spec.tsx`.
- **Ca tích hợp ở Mini `affiliate.spec.tsx` và web `ctv/page.spec.tsx`:**
  - (a) dữ liệu dashboard cũ về giữa lúc làm mới thì nút vẫn khoá;
  - (b) gỡ rồi gắn lại trang thì nút vẫn khoá;
  - (c) làm mới xong thì nút mở.
  - Kiểm đột biến bằng `disabled: false` thì các ca này đỏ.
- **Review Opus hai lượt:**
  - Lượt 1: "merge được", có một P2. Khe tải cũ trả muộn mới hẹp lại chứ chưa đóng, nên đã làm lại theo cờ làm mới.
  - Lượt 2: "merge được", không có P0, P1, P2. Đã sửa P3 về hai lần gọi chồng nhau (dùng bộ đếm).
  - P3 còn lại, giữ vì không có rủi ro tiền:
    - Web mất mạng ngay sau khi chuyển thì truy vấn tạm dừng và nút mở sớm. Gửi form sẽ lỗi mạng, hoặc bị máy chủ chặn.
    - Ca (b) và (a) ghi dữ liệu cũ thẳng vào cache, chưa chạy một lần tải cũ thật trả về muộn.
- **Gate (`tools/gate.sh --no-jest`): 0 FAIL.**
  - tsc 6 gói, eslint (API, Mini App, web), lint:parity, lint-vars, vite build.
  - vitest: app-core 2331, Mini App 6311 (cả giờ UTC), web 9333.
  - bundle Mini: entry 651/203 KB.
  - Sau commit bộ đếm: `ctv-dashboard.spec` 28/28, Mini `affiliate.spec` 73/73, web `ctv/page.spec` 59/59.
- **Playwright:**
  - Mini toàn bộ: 413 pass, 1 đỏ một lần ở `bundles-cls.miniapp.spec.ts:41` (CLS trang sản phẩm, phần shop). Chạy riêng file 6/6 xanh.
  - Sau khi làm lại R-185: Mini `affiliate-ctv` 4 pass; web gate `affiliate.web`, `ctv-375.web` 28 pass, 4 bỏ qua theo khổ.
- **Ảnh web 375 trước/sau** (popup "Cách tính Điểm Xanh", sheet chọn phân loại, đối chiếu Mini) ở `docs/2026-10-28-review/screens-1028h-khach/`, không commit.
