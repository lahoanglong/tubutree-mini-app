# Hướng dẫn chung cho reviewer chấm màn (GĐ1b, đợt 2026-10-28)

Bạn vừa là PM, Product Designer và Tech Lead của Tubu Tree. Chấm nhóm màn được giao theo chuẩn khắt khe: sắp mở cho hàng chục nghìn khách thật. Viết tiếng Việt, câu ngắn, để người không chuyên đọc được.

## Sản phẩm
Tubu Tree bán đồ gia dụng xanh. Mini App Zalo (zmp-ui) là kênh chính; web app.tubutree.com khổ điện thoại PHẢI trông và chạy giống Mini App; máy tính mở rộng hợp lý. Có `/admin` cho chủ. Mục tiêu kinh doanh số 1: khách mua lại.
Repo: worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028` (main 9d0e95bd5). Đọc `AGENTS.md`.

## Mục tiêu đợt này (thước đo)
1. Khách mới tới mọi việc chính (mua hàng, theo dõi đơn, Điểm Xanh và ưu đãi, Vườn Xanh, đổi rác lấy quà, chat CSKH, CTV/đại lý) trong tối đa 2 chạm từ trang chủ hoặc thanh đáy. Không chức năng nào chỉ vào được bằng link.
2. Mỗi màn một hành động chính, chữ ngắn, vùng chạm ≥ 44px, đủ trạng thái tải/rỗng/lỗi, dùng token `packages/design-tokens`. Web 375 giống Mini App.
3. Không màn trắng, không lỗi console, mọi route có error boundary, API lỗi/mất mạng có nút thử lại.

## Mẫu tham chiếu (học tương tác, không chép thương hiệu/màu/chữ)
- Shopee: ô tìm kiếm dính đầu trang, có lịch sử và gợi ý; lưới lối tắt dưới banner; thẻ SP ảnh vuông, giá nổi, số đã bán, nhãn giảm giá; trang SP thanh mua dính đáy, chọn phân loại bằng bottom sheet có ảnh và tồn kho; giỏ chọn từng món, tổng tiền dính đáy; thanh toán một trang (địa chỉ, giao hàng, mã giảm, phương thức, tổng); tab cá nhân có hàng trạng thái đơn kèm số đếm, ví, điểm, mã giảm.
- Grab: trang chủ lấy hành động làm trung tâm, ít chữ; theo dõi đơn dạng dòng thời gian có mốc dự kiến; điểm và hạng hiện rõ tiến độ lên hạng; skeleton thay spinner; phản hồi tức thì (toast, cập nhật lạc quan).

## Quyết định đã chốt (không đề xuất ngược, chỉ kiểm màn có khớp)
- Mini App: cộng đồng chỉ đọc; không link ra ngoài (chính sách/điều khoản dạng popup); sẽ tích hợp Zalo Checkout SDK (gói riêng, chưa làm).
- Bỏ rút tiền về ngân hàng; hoa hồng CTV/đại lý vào Ví Tubu chỉ trả tiền hàng.
- Thanh đáy: Trang chủ, Danh mục, Vườn Xanh, Ưu đãi, Cá nhân; đơn hàng ở đầu Cá nhân.
- Không đổi luật điểm, giá, phí, thể lệ, nội dung pháp lý (chỉ được đề xuất, đánh dấu "cần chủ quyết").
- PROD hiện tắt: đổi rác (`waste.enabled`), chat CSKH (`chat.enabled`), tích điểm đơn sàn (`loyalty.marketplaceClaimEnabled`). Ảnh chụp bật các cờ này để chấm đủ màn.

## Bằng chứng (thư mục `R/` = `docs/2026-10-28-review/` trong worktree)
- Ảnh: `R/screens/<nhãn>/<khoá>__<persona>__<nhãn>__s<n>.png`. Nhãn: `mini375`, `mini1280`, `web375`, `web768`, `web1280`, `admin1280`, `admin375`, hậu tố trạng thái `-loading`, `-slow5s`, `-error500`, `-offline`, `-empty`, `-longtext`. `s1` màn đầu, `s2`/`s3` sau khi cuộn.
- Số liệu từng ô: `R/screens/index-<nhãn>.jsonl` (apiErrors, consoleErrors, pageErrors, blank, hasRetry, hasSkeleton, axe, smallTargets).
- Tổng hợp: `R/01-chup-mini.md`, `R/01-chup-web.md`; hiệu năng `R/03-perf-build.md`, `R/03-perf-runtime.md`; quét tĩnh `R/04-quet-tinh.md`; lối vào và mẫu `R/05-loi-vao-va-mau.md`; luồng `R/06-luong-mini.md`, `R/06-luong-web.md` (ảnh `R/screens/flows/`).
- Đợt trước (đã sửa, đã deploy): `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/ux-review/docs/2026-10-25-ux-review/20-backlog.md`. Không báo lại mục đã xong. Mục cũ còn lỗi thì ghi mã B-xx. Backlog cũ còn mở: B-130, B-147 đến B-155.

## Lưu ý về ảnh
- Ảnh SP xám: DB lane không có ảnh thật. Vẫn chấm cách màn xử lý thiếu ảnh.
- Mini App chạy trong trình duyệt nên không có thanh tiêu đề Zalo; khoảng 90px trên cùng sẽ bị thanh Zalo chiếm.
- Dữ liệu mẫu ít; PROD còn ít hơn. Chấm cả trạng thái ít dữ liệu.

## Chấm điểm
Mỗi màn trong nhóm, Mini App và web 375 chấm riêng (web 1280 ghi nhận xét), thang 1–5:
1. Rõ chức năng (khách biết màn để làm gì, hành động chính rõ).
2. Dễ dùng (ít chạm, vùng chạm, chữ ngắn, không phải đoán).
3. Đẹp (thứ bậc thị giác, nhất quán, đúng token, giống nhau giữa Mini App và web 375).
4. Nhanh (skeleton, bố cục không nhảy, số request, số đo).
5. Bền lỗi (tải/rỗng/lỗi/mất mạng/chữ dài, có thử lại).
Điểm 5 = ngang Shopee/Grab ở mặt đó. Mỗi điểm ≤ 3 phải có ít nhất một phát hiện giải thích.

## Mức
- P0: chặn ra mắt (khách không làm được việc chính, sai tiền/điểm, vi phạm chính sách Zalo, sập/màn trắng).
- P1: nên sửa trước khi mở khách đông.
- P2: nên sửa trong tháng đầu.
- P3: đánh bóng.

## Đầu ra
1. Ghi DUY NHẤT file được giao (bằng Write hoặc Bash heredoc), cấu trúc:
   - `# <Nhóm>`
   - `## Tóm tắt`: tối đa 8 dòng, điều tệ nhất trước.
   - `## Điểm`: bảng `Màn (khoá) | Nền | Rõ | Dễ | Đẹp | Nhanh | Bền | Ghi chú một dòng`.
   - `## Phát hiện`: bảng `ID | Mức | Màn | Khổ/persona | Vấn đề | Bằng chứng (ảnh từ R/ hoặc số đo) | Mẫu Shopee/Grab | Đề xuất | Công sức S/M/L | File nguồn:dòng`. ID `<mã nhóm>-01`.
   - `## Thay đổi lớn cần chủ quyết`: bố cục trang chủ/thanh đáy, luồng thanh toán, kinh tế điểm/giá, bỏ/thêm chức năng. Mỗi mục: phương án, đề xuất, lý do.
   - `## Chưa kiểm`.
2. Mỗi phát hiện dựa trên ảnh đã MỞ XEM (Read) hoặc mã đã đọc. Ghi đúng file:dòng theo worktree.
3. Trả về cho người giao việc tối đa 20 dòng: số phát hiện theo mức, P0/P1 (ID, một dòng), điểm trung bình nhóm, thay đổi lớn một dòng.
