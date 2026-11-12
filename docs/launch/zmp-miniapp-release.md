# Phát hành bản Mini App (ZMP): kiểm bản build trước khi đưa lên Zalo

Tài liệu này gom các bước KIỂM bản Mini App trước khi phát hành, kèm số đo thật của lần kiểm 2026-11-13 (nhánh `feat/w128-w129-story-crop-checkout-polish`, Wave 128 + 129). Phần nào chưa chạy được thì ghi rõ là chưa chạy.

Đọc cùng với:
- [DEPLOY_ZALO.md](../../DEPLOY_ZALO.md): cài `zmp`, đăng nhập, kiểm nhanh sau deploy (nhiều mục trong file này là bản chụp cũ, đọc lời cảnh báo ở đầu file).
- [deploy-rollback-runbook.md](deploy-rollback-runbook.md), mục "Ràng buộc 1" và bảng cờ `zmp deploy`: thứ tự API trước, Mini App sau.

## 1. Việc Wave 128 + 129 có đổi Mini App

Wave 128 (B) đổi cách hiển thị tên phân loại để trống (86 trong 154 phân loại trên PROD có `variation.name === ""`): giỏ, chi tiết đơn, yêu cầu đổi/trả của Mini App dùng `apps/miniapp/src/utils/variation-label.ts`. Phần còn lại của Wave 128 (khung cắt ROI trong Story Studio) và Wave 129 chỉ nằm ở web admin và web thanh toán, không vào gói Mini App.

Hệ quả khi phát hành: Mini App bản cũ vẫn chạy bình thường với API hiện tại (API không đổi trong wave này, không có migration). Bản cũ chỉ tiếp tục hiện `()` hoặc ngoặc trống ở dòng phân loại để trống cho tới khi bản ZMP mới lên.

## 2. Kiểm bản build (chạy được trên máy dev, không cần đăng nhập Zalo)

Chạy từ gốc repo, Node 22:

```bash
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
pnpm --filter @tubutree/shared-types build
pnpm --filter @tubutree/miniapp typecheck
pnpm --filter @tubutree/miniapp test            # vitest của Mini App
VITE_API_BASE_URL=https://api.tubutree.com/api pnpm --filter @tubutree/miniapp build
node scripts/ci/bundle-budget.cjs apps/miniapp/www
```

`VITE_API_BASE_URL` là bắt buộc: bản build production không có địa chỉ API https thì `apps/miniapp/src/build-env.ts` chặn build. Thư mục `apps/miniapp/www` nằm trong `.gitignore`, không commit.

Kết quả lần kiểm 2026-11-13 (đã chạy thật):

| Bước | Kết quả |
| --- | --- |
| `typecheck` Mini App | xanh |
| `vite build` | xanh, 6,5 giây |
| File JS lớn nhất (entry) | `assets/index.D-fJGZ6m.module.js` 409 KB raw / 134 KB gzip (vite báo 401,79 kB; mốc Wave 125 là 401,65 kB) |
| Tổng bản build | 230 file, 2354 KB raw / 906 KB gzip |
| Ngưỡng cảnh báo của dự án | entry 700 KB, tổng 2560 KB: không vượt |

Ngưỡng 700 KB và 2560 KB là ngưỡng cảnh báo của dự án, KHÔNG phải giới hạn của Zalo. Giới hạn dung lượng gói hiện hành của Zalo: chưa kiểm.

## 3. Phát hành lên Zalo: CHƯA chạy, cần người có tài khoản Zalo dev

Các lệnh dưới đây KHÔNG được chạy trong lần kiểm này: máy kiểm không cài `zmp` CLI, không có phiên đăng nhập (`~/.zmp` không tồn tại), và đưa bản lên Zalo là thao tác ra bên ngoài nên cần người phát hành quyết định. Vì vậy chưa có bằng chứng nào cho việc deploy chạy được; chỉ có bản build ở mục 2.

Thứ tự bắt buộc (theo runbook deploy):
1. API đã chạy ổn 30 đến 60 phút (màn Sức khoẻ hệ thống không đỏ).
2. Build lại như mục 2, rồi lên kênh test:
   ```bash
   cd apps/miniapp
   zmp login                                   # một lần mỗi máy
   zmp deploy -t -e -m "W128 tên phân loại để trống"
   ```
3. Quét QR kiểm trên Zalo thật, đủ bốn ca ở mục 4.
4. Gửi duyệt và phát hành production làm tay trên trang quản lý Mini App của Zalo. Không có lệnh `zmp` nào làm việc này. `zmp deploy -M production` (script `pnpm --filter @tubutree/miniapp deploy`) chỉ chọn mode môi trường khi build, không phải "nộp production".

Chưa kiểm: `zmp deploy -e` có tự build lại hay chỉ đẩy thư mục `www` đã có. Cứ build lại trước cho chắc.

## 4. Kiểm bằng mắt trên Zalo thật (chưa làm, cần máy thật)

Chưa ai xem các màn này trên Zalo thật hay trên Safari; mọi kiểm tra mới ở mức test tự động và build:
1. Giỏ hàng: sản phẩm chỉ có một phân loại và tên trống: dòng không hiện `()`.
2. Giỏ hàng: sản phẩm có từ hai phân loại, một cái tên trống: chip hiện "Mặc định" (chỗ biết số phân loại anh em).
3. Chi tiết đơn và yêu cầu đổi/trả: dòng phân loại tên trống bị ẩn, không có dấu phẩy thừa.
4. Mua lại từ đơn cũ: món có tên phân loại trống vẫn vào giỏ đúng.

## 5. Việc còn treo

- `variation-label.ts` của web (`apps/web/src/lib/`) và của Mini App (`apps/miniapp/src/utils/`) là hai bản giống hệt, vì `packages/app-core` nằm ngoài phạm vi wave này. Nên chuyển về `app-core` ở wave sau để hết rủi ro lệch.
- Hai phân loại trở lên cùng tên trống đều hiện "Mặc định" và chưa phân biệt được. Cần đếm trên dữ liệu PROD xem có sản phẩm nào như vậy trước khi quyết định đánh số.
- Màn thương nhân và đại lý (`merchant/product-form.tsx`, `merchant-returns.tsx`, `settlement-table.tsx`, `dealer/price-tab.tsx`) và chip Giờ vàng/ưu đãi còn dạng `({variationName})`, chưa sửa.
