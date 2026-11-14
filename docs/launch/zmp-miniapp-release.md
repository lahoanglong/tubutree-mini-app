# Phát hành bản Mini App (ZMP): kiểm bản build trước khi đưa lên Zalo

Tài liệu này gom các bước KIỂM bản Mini App trước khi phát hành, kèm số đo thật của lần kiểm 2026-11-14 (nhánh `feat/w162-vps-prune-zmp-and-dns01-ssl`, cắt từ main `d7d821aee`, không có commit nào đổi `apps/miniapp` kể từ W155) và so với lần kiểm 2026-11-13 (W128 + W129). Phần nào chưa chạy được thì ghi rõ là chưa chạy.

Đọc cùng với:
- [DEPLOY_ZALO.md](../../DEPLOY_ZALO.md): cài `zmp`, đăng nhập, kiểm nhanh sau deploy (nhiều mục trong file này là bản chụp cũ, đọc lời cảnh báo ở đầu file).
- [deploy-rollback-runbook.md](deploy-rollback-runbook.md), mục "Ràng buộc 1" và bảng cờ `zmp deploy`: thứ tự API trước, Mini App sau.

## 1. Mini App đã đổi gì từ W128 đến W157

Danh sách này lấy từ `git diff <merge>^1 <merge> -- apps/miniapp packages/app-core` của từng lần gộp vào main (không dựa vào tên wave), nên chỉ liệt kê thứ thật sự nằm trong gói Mini. Chưa có bản ZMP nào lên Zalo sau các thay đổi này (xem "Việc của chủ còn mở" trong bộ nhớ dự án), nên mọi dòng dưới đây chưa tới người dùng.

| Wave (commit trên main) | Người dùng Mini App thấy gì | Tệp chính |
| --- | --- | --- |
| W128 (`de065a0ed`, #353) | Tên phân loại để trống (86/154 phân loại trên PROD) không còn hiện `()` hay ngoặc trống ở giỏ, chi tiết đơn, đổi/trả, mua lại, đăng ký định kỳ, chip phân loại, chi tiết sản phẩm; sản phẩm nhiều phân loại có một cái trống hiện "Mặc định" | `utils/variation-label.ts`, `components/product/variation-chip.tsx`, `pages/cart.tsx`, `pages/order-detail.tsx`, `components/orders/return-request-sheet.tsx`, `components/reorder/*` |
| W126–127, W129 (cùng #353) | Chỉ ở Admin: màn chất lượng catalog (`pages/admin-catalog-quality.tsx`) và ba tệp app-core cho bộ kiểm catalog; khung cắt ROI Story và thanh toán web không vào gói Mini | `pages/admin-catalog-quality.tsx`, `packages/app-core/src/commerce/catalog-*.ts`, `copy-claims-guard.ts` |
| W130 + W131 (`b1b9147d6`, #354) | Ô số điện thoại ở địa chỉ nhận hàng chuẩn hoá khi rời ô và khi dán cả số; ô tìm đơn chuẩn hoá chuỗi tìm; quy tắc nhãn phân loại trống áp thêm cho Giờ vàng, ưu đãi chớp nhoáng và danh sách đại lý; `variation-label` chuyển về `app-core` dùng chung với web | `components/address-form.tsx`, `pages/orders.tsx`, `components/flash-sale.tsx`, `components/offers/offers-flash.tsx`, `pages/dealer.tsx`, `packages/app-core/src/phone-input.ts`, `variation-label.ts` |
| W132–W145 (`4b20d72f4`, #355) | Đợt chỉnh giao diện lớn (111 tệp): thẻ Story hai cột gọn một màn trên chi tiết sản phẩm, giỏ và thanh toán responsive, Mini chừa viên thuốc Zalo và safe-area (W135), bản đồ xuất xứ thương hiệu bằng SVG, chữ kịch bản story viết lại, ghi rõ trạng thái đăng ký định kỳ đang tạm dừng, thiết kế token và chữ | `components/ui/product-story-showcase.tsx`, `pages/product-detail.tsx`, `pages/home.tsx`, `pages/brand-*.tsx`, `css/brand-map.css`, `css/tokens.css`, `components/subscriptions-panel.tsx`, `packages/app-core/src/commerce/story-*.ts` |
| W146B (`4d6aaca78`, `dc466d31e`, `d9b7a83eb`, `e152be99a`) | Lời chia sẻ nêu ưu đãi cho khách mới, Vườn Xanh gắn `?ref=`, khối "Mời bạn sống xanh" ở Cá nhân (không hứa Điểm Xanh khi Admin tắt thưởng) | `components/share-sheet.tsx`, `pages/profile.tsx`, `pages/game.tsx`, `pages/group-buy.tsx`, `packages/app-core/src/commerce/share-offer.ts`, `invite-card.ts` |
| W153 (`d2fd5f409`) | Dán số điện thoại vào ô địa chỉ: bôi một PHẦN ô rồi dán chỉ thay đúng đoạn bôi, không xoá phần còn lại | `components/address-form.tsx` |
| W155 (`0efcc543d`) | Vùng chạm tối thiểu 44px: ô Số lượng (dùng ở Đổi rác), nút Chia sẻ và dòng Điểm Xanh ở chi tiết sản phẩm | `components/ui/quantity-selector.tsx`, `css/tokens.css`, `pages/product-detail.tsx` |
| W148A, W152, W154, W156, W157, W158–W159 | KHÔNG có tệp nào của `apps/miniapp` hay `packages/app-core` đổi (W148A và W152 chỉ đổi dữ liệu SKU hoặc spec test; W154, W156, W157 là API/Admin; W158–W159 là `ops/`) | không có |

Không có thay đổi Mini nào cho các việc sau trong khoảng W128–W157: đồng bộ giỏ hàng, hoàn điểm/voucher khi huỷ đơn, cảnh báo khi huỷ đơn, hiển thị sản phẩm giá 0đ. Mô tả của kế hoạch W162 gộp chúng vào "W153–W157" nhưng git không cho thấy tệp nào trong gói Mini; nếu đã làm thì chúng nằm ở API, Admin hoặc web nên KHÔNG cần bản ZMP mới. Khi gõ mô tả phiên bản `zmp deploy -m`, dùng mô tả khớp bảng này (ví dụ "W128-W157: nhãn phân loại trống, dán SĐT, chia sẻ khách mới, vùng chạm 44px, chỉnh giao diện") chứ không dùng chuỗi mẫu 0đ/huỷ đơn.

Hệ quả khi phát hành: chưa kiểm chéo bản Mini cũ với API hiện tại ngoài ca W128 (API không đổi trong wave đó). Ghi nhận ở W146B: API `/me/referral` trả `referrerRewardPoints` cho khối "Mời bạn sống xanh"; chưa kiểm bản Mini cũ có chịu được phản hồi đó hay không.

## 2. Kiểm bản build (chạy được trên máy dev, không cần đăng nhập Zalo)

Một lệnh làm cả chuỗi (và cả bước kiểm API, zmp CLI): `bash scripts/ops/publish-zmp-release.sh` (xem mục 3). Chạy tay từng bước từ gốc repo, Node 22:

```bash
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
pnpm --filter @tubutree/shared-types build
pnpm --filter @tubutree/miniapp typecheck
pnpm --filter @tubutree/miniapp test            # vitest của Mini App
VITE_API_BASE_URL=https://api.tubutree.com/api pnpm --filter @tubutree/miniapp build
node scripts/ci/bundle-budget.cjs apps/miniapp/www
```

`VITE_API_BASE_URL` là bắt buộc: bản build production không có địa chỉ API https thì `apps/miniapp/src/build-env.ts` chặn build. Thư mục `apps/miniapp/www` nằm trong `.gitignore`, không commit.

Kết quả lần kiểm 2026-11-14 (đã chạy thật, một chuỗi liền, thoát 0), đặt cạnh lần 2026-11-13:

| Bước | 2026-11-14 | 2026-11-13 (W128 + W129) |
| --- | --- | --- |
| `typecheck` Mini App | xanh | xanh |
| `vitest` Mini App | 501 tệp, 10756 test, xanh | chưa ghi |
| `vite build` | xanh, 3,61 giây | xanh, 6,5 giây |
| File JS lớn nhất (entry) | `assets/index.CubBH98e.module.js` 422 KB raw / 138 KB gzip (vite báo 412,72 kB / 141,08 kB gzip) | `assets/index.D-fJGZ6m.module.js` 409 KB raw / 134 KB gzip (vite báo 401,79 kB) |
| Tổng bản build | 234 tệp, 2379 KB raw / 916 KB gzip (JS 219 tệp 2056 KB, CSS 6 tệp 163 KB, ảnh và font 7 tệp 158 KB) | 230 tệp, 2354 KB raw / 906 KB gzip |
| Ngưỡng cảnh báo của dự án | entry 700 KB, tổng 2560 KB: không vượt (entry 60% ngưỡng, tổng 93%) | không vượt |

So với 2026-11-13: thêm 4 tệp, tổng +25 KB raw (+1,1%) và +10 KB gzip, entry +13 KB raw (+3,2%) và +4 KB gzip. Mục tiêu entry của đợt hiệu năng là dưới 450 KB (`docs/2026-10-review/03-perf.md` A3-013): vẫn đạt.

Ngưỡng 700 KB và 2560 KB là ngưỡng cảnh báo của dự án, KHÔNG phải giới hạn của Zalo. Giới hạn dung lượng gói hiện hành của Zalo: chưa kiểm. Script phát hành chạy `bundle-budget.cjs` ở chế độ `BUNDLE_BUDGET_STRICT=1`: vượt ngưỡng thì dừng, trừ khi chủ chấp nhận và đặt `MINIAPP_ENTRY_WARN_KB` / `MINIAPP_TOTAL_WARN_KB` lớn hơn.

## 3. Phát hành lên Zalo: script 1 lệnh, CHƯA chạy thật, cần người có tài khoản Zalo dev

```bash
bash scripts/ops/publish-zmp-release.sh                       # chỉ kiểm, không đẩy gì lên Zalo
bash scripts/ops/publish-zmp-release.sh --testing "<mô tả>"   # kiểm rồi `zmp deploy -t -e -m "<mô tả>"` ở apps/miniapp (kênh test)
```

Script dừng ở bước đầu tiên lỗi:
1. `GET https://api.tubutree.com/api/health` phải trả 200 và có `"db":"up"` + `"redis":"up"`.
2. Chỉ với `--testing`: kiểm `zmp` CLI (`command -v zmp`, hoặc `npx --no-install zmp`) và phiên đăng nhập (`~/.zmp` hoặc `ZMP_TOKEN`) TRƯỚC khi build, để khỏi build xong mới biết thiếu. Chưa đăng nhập thì in hướng dẫn: chạy `zmp login`, rồi chạy lại lệnh `--testing`; thoát mã 3.
3. Node >= 22, rồi cả chuỗi ở mục 2 với `VITE_API_BASE_URL=https://api.tubutree.com/api`, bundle-budget strict.
4. Chỉ cờ `--testing` mới gọi `zmp deploy`; không có cờ này script không bao giờ đẩy gì lên Zalo.

Script không đọc, không in giá trị `ZMP_TOKEN` hay nội dung `~/.zmp`, và không bao giờ nộp bản production.

Trạng thái kiểm 2026-11-14 trên máy dev này: không cài `zmp` CLI (`command -v zmp` rỗng) và không có `~/.zmp`, nên CHƯA có bằng chứng `zmp deploy` chạy được; script mới được chạy thử với `curl`, `pnpm`, `zmp` giả ở 11 ca (chỉ kiểm, `--testing` đủ điều kiện, thiếu `zmp`, thiếu mô tả, tham số sai, health 500, health thiếu redis, test lỗi, `--help`) và phần build/bundle thật ở mục 2. Đưa bản lên Zalo là thao tác ra bên ngoài nên cần người phát hành quyết định.

Thứ tự bắt buộc (theo runbook deploy):
1. API đã chạy ổn 30 đến 60 phút (màn Sức khoẻ hệ thống không đỏ).
2. Chạy `bash scripts/ops/publish-zmp-release.sh --testing "<mô tả>"` (lần đầu trên máy: `zmp login` trước).
3. Quét QR kiểm trên Zalo thật, đủ các ca ở mục 4.
4. Gửi duyệt và phát hành production làm tay trên trang quản lý Mini App của Zalo. Không có lệnh `zmp` nào làm việc này. `zmp deploy -M production` (script `pnpm --filter @tubutree/miniapp deploy`) chỉ chọn mode môi trường khi build, không phải "nộp production".

Chưa kiểm: `zmp deploy -e` có tự build lại hay chỉ đẩy thư mục `www` đã có. Script luôn build lại trước cho chắc.

## 4. Kiểm bằng mắt trên Zalo thật (chưa làm, cần máy thật)

Chưa ai xem các màn này trên Zalo thật hay trên Safari; mọi kiểm tra mới ở mức test tự động và build:
1. Giỏ hàng: sản phẩm chỉ có một phân loại và tên trống: dòng không hiện `()`.
2. Giỏ hàng: sản phẩm có từ hai phân loại, một cái tên trống: chip hiện "Mặc định" (chỗ biết số phân loại anh em).
3. Chi tiết đơn và yêu cầu đổi/trả: dòng phân loại tên trống bị ẩn, không có dấu phẩy thừa.
4. Mua lại từ đơn cũ: món có tên phân loại trống vẫn vào giỏ đúng.
5. Địa chỉ nhận hàng: dán cả số điện thoại (có khoảng trắng hoặc `+84`) rồi rời ô: số được chuẩn hoá; bôi một phần ô rồi dán: chỉ thay đúng đoạn bôi.
6. Danh sách đơn: ô tìm chuẩn hoá chuỗi tìm (dán số điện thoại có khoảng trắng vẫn tìm ra).
7. Giờ vàng và danh sách đại lý: dòng phân loại tên trống không hiện ngoặc trống.
8. Chi tiết sản phẩm: nút Chia sẻ, dòng Điểm Xanh và ô Số lượng chạm được dễ (cao tối thiểu 44px); Đổi rác: ô Số lượng cũng vậy.
9. Chia sẻ sản phẩm và Cá nhân: lời chia sẻ nêu ưu đãi cho khách mới; khối "Mời bạn sống xanh" không hứa Điểm Xanh khi Admin tắt thưởng.
10. Mọi màn có header: nội dung không bị viên thuốc Zalo che, chừa safe-area trên máy tai thỏ.

## 5. Việc còn treo

- Đã xong ở W131: `variation-label` của web và Mini App không còn là hai bản; `apps/miniapp/src/utils/variation-label.ts` chỉ còn re-export từ `@tubutree/app-core/variation-label`.
- Hai phân loại trở lên cùng tên trống đều hiện "Mặc định" và chưa phân biệt được. Cần đếm trên dữ liệu PROD xem có sản phẩm nào như vậy trước khi quyết định đánh số.
- Màn thương nhân (`merchant/product-form.tsx`, `merchant-returns.tsx`, `settlement-table.tsx`, `dealer/price-tab.tsx`): lần kiểm 2026-11-14 không còn thấy mẫu `({variationName})` trong `apps/miniapp/src` bằng `grep`, nhưng chưa xem từng màn; coi như chưa kiểm bằng mắt.
- Mô tả mẫu trong hướng dẫn của script (`W153-W157 sync cart, cancel refund, zero-price & variation labels`) lấy nguyên văn từ kế hoạch W162 và lệch với bảng ở mục 1; đổi cho đúng khi gõ lệnh `--testing` thật.
