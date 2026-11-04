# home-r3-2: sửa phát hiện reviewer Opus lượt 2 (khoá home)

Nhánh gl/1103-home, commit mới sau d4d0f395b (chưa push). Node 22.23.3, vitest `--minWorkers=1 --maxWorkers=2`, Playwright `--workers=1`. Lane không bật; stub API 3982 + next dev 3981 + Vite 3983 đã tắt.

## Phát hiện
- P2 HIEUNANG-04 nửa vời: SỬA 2/3 route chưa có dấu. `aria-busy="true"` đặt ở div bọc khung chờ của /tai-khoan/thong-bao và /tai-khoan/diem-xanh (không đụng nội dung màn). Test đơn vị đỏ với mã cũ (2 fail), xanh sau sửa. `/doi-rac` (recycle-home.tsx, vùng waste của db): KHÔNG sửa; cần db bọc 3 Skeleton của nhánh `meQ.isPending` trong `<div aria-busy="true">`. Spec đo có `test.fixme` cho /doi-rac, bỏ fixme khi db xong (số đo hiện tại: footer vẫn hiện lúc chờ).
  Đo CLS (Playwright web 375, mock, API chính giữ 1,5s rồi nhả; spec mới footer-cls.web.spec.ts):
  | route | trước | sau |
  | /tai-khoan/thong-bao | 0,0692, chân trang hiện lúc chờ | 0,0158, chân trang ẩn |
  | /tai-khoan/diem-xanh | 0,1773, chân trang hiện lúc chờ | 0,0283, chân trang ẩn |
  | /doi-rac | 0,0113 (nội dung mock ngắn), chân trang hiện lúc chờ | chờ db |
  /vuon-xanh, /uu-dai, /tai-khoan đã có aria-busy từ lượt 1, KHÔNG đo trong lượt này (chưa viết mock). Ghi trung thực: số mock thấp hơn audit (0,2) vì nội dung mock ngắn hơn thật; điều chứng minh được là chân trang bị ẩn lúc chờ.
- P2 KHAMPHA-01 thiếu e2e Mini: ĐÃ THÊM apps/e2e/tests/home-back-scroll.miniapp.spec.ts (2 ca: cuộn sâu > 1500, chạm món Gợi ý, Back, scrollTop ±2px sau 1,2s; mở lại bằng thanh đáy (PUSH) về 0). 2/2 xanh. LƯU Ý: thử đột biến (ready={false}; bỏ resetScroll={false}) spec vẫn xanh trên Chromium thường, nên nó bảo vệ kết quả nhìn thấy được chứ không chứng minh riêng hook; trong Zalo WebView có thể khác. Không tìm được đột biến làm đỏ trong thời hạn.
- P3 thẻ thành viên 84px: KHÔNG SỬA, vẫn cần chủ duyệt trước khi merge (phương án nếu không duyệt: thẻ 64px, chỉ dải quà 84px).
- P3 import hook vào /thanh-toan: ĐÃ SỬA. `syncHomeHintCookie` + `readLastStoredHomeKind` chuyển sang apps/web/src/lib/home-hint-cookie.ts (không React/context); hook cũ re-export nên mã khác không đổi. First Load /thanh-toan: gốc 245 kB, lượt 1 247 kB, nay 246 kB (page 20,7 kB; shared 104 kB). `/` 260 kB.

## Số test thật
- web vitest (thong-bao, diem-xanh, thanh-toan, components/home, lib): 186 file / 2202 test xanh
- tsc --noEmit web, e2e sạch; eslint 5 file đổi sạch
- Playwright web footer-cls.web.spec: 2 xanh, 1 fixme (doi-rac); miniapp home-back-scroll: 2/2 xanh
