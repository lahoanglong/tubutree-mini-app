# Prompt chuẩn cho đợt "hoàn thiện để ra mắt" Tubu Tree mini-app

## Model và effort khuyên dùng

| Việc | Model | Effort | Vì sao |
|---|---|---|---|
| Phiên điều phối (discovery, tổng hợp, lên plan, quyết định merge) | Opus 5.5 | high; nâng xhigh lúc tổng hợp plan | Việc phán đoán trên nhiều file và nhiều mục tiêu kinh doanh. Opus chỉ đắt hơn Sonnet ~1,35 lần vì phần lớn token là cache. |
| Agent discovery cần phán đoán (vận hành, kéo khách sàn, đại lý) | Opus 5.5 | high | Cần hiểu nghiệp vụ, không chỉ tìm mã. |
| Agent discovery quét rộng (UI tĩnh, cộng đồng, hạ tầng) | Sonnet 5.5 | medium | Quét nhiều file, kết luận kiểm được bằng `path:line`. |
| Agent code từng gói (UI, tính năng không chạm tiền) | Sonnet 5.5 | medium | Spec rõ, có test chứng minh. |
| Gói chạm tiền / điểm / ví / auth / migration | Opus 5.5 | high | Lỗi ở đây mất tiền thật. |
| Review trước khi merge | Opus 5.5 (agent `reviewer`) | high, hai lượt nếu chạm tiền | Các đợt trước, review Opus bắt được lỗi mà agent code không thấy. |
| Tìm file, quét log | Haiku 5.5 (agent `scout`) | low | Rẻ, chỉ trả `path:line`. |

Chỉ dùng Fable 5.1 (high) khi Opus xhigh thất bại hai lần ở cùng một việc. Không đổi model giữa phiên: muốn đổi thì `/compact` hoặc mở phiên mới kèm file handoff.

## Prompt (dán vào phiên mới, model Opus 5.5, effort high)

```
Dự án: Tubu Tree mini-app (repo /Users/longla/coding/tubutree-mini-app, nhánh main).
Kênh bán trực tiếp của Tubu Tree: Zalo Mini App + web + gian hàng đại lý /s/<slug> + admin.

MỤC TIÊU KINH DOANH (đo được):
1. Giảm phụ thuộc đơn sàn: khách mua trên sàn (danh sách kênh ở hello.tubutree.com) chuyển sang
   mua trực tiếp. Chỉ số: % đơn trực tiếp, % khách sàn kích hoạt tài khoản mini-app, tỉ lệ mua lại 60 ngày.
2. Cộng đồng: khách tương tác, giao lưu, quay lại không chỉ để mua.
3. Đại lý/CTV có kênh bán riêng: tự đăng ký, có gian hàng, listing, chia sẻ, nhận hoa hồng mà admin không phải làm tay.
4. Nhân sự làm trọn việc hằng ngày trong hệ thống, không phải ra Excel/Zalo/giấy.
5. Ra mắt với tính năng, hiệu năng và UI/UX hoàn chỉnh.

LOẠI TRỪ (phiên khác đang làm): đổi rác lấy quà/Refill/Gomdon; đơn giao ngày cao điểm
(repo chodeli-marketing-support-system); bán trên sàn/social/sỉ/cào data (repo đó, phiên khác);
việc tồn nhánh nightly/n5-polish. Trước khi sửa file nào, kiểm `git worktree list` và các
nhánh đang mở để tránh đụng file của phiên khác.

CÁCH LÀM:
A. Discovery theo nhánh, song song, chỉ đọc mã, mỗi nhánh một báo cáo có bằng chứng path:line:
   D1 vận hành/admin (ma trận vai trò × việc hằng ngày), D2 kéo khách sàn + hành trình đầu-cuối,
   D3 đại lý/CTV/gian hàng, D4 cộng đồng/tương tác, D5 UI/UX từng màn (cả ảnh chụp thật 390px),
   D6 hạ tầng/performance/go-live. Không báo lại mục đã sửa trong docs/2026-10-review/.
B. Tổng hợp: một bảng ưu tiên P0 (chặn ra mắt) → P3, tách "agent làm được ngay" khỏi
   "cần chủ dự án quyết" và "chủ dự án phải tự làm" (DNS, khoá, nội dung, ngân sách ưu đãi).
C. Plan: chia gói không đụng chung file, mỗi gói có tiêu chí xong kiểm bằng lệnh.
D. Thực hiện: mỗi gói một worktree + nhánh, TDD, Sonnet code, Opus review (chạm tiền/điểm/auth: hai lượt),
   merge --no-ff vào một nhánh tích hợp cục bộ, chạy gate đầy đủ (tsc, eslint, jest, race,
   vitest miniapp + web, kể cả TZ=UTC, build, Playwright) trước khi báo xong.
E. Báo cáo sáng: đã xong gì (kèm số test), còn gì, và danh sách câu hỏi cần chốt,
   mỗi câu có phương án mặc định khuyên dùng.

LUẬT CỨNG: không push, không merge vào main, không deploy, không ghi DB PROD hay DB dùng chung
khi chưa có lệnh rõ cho đúng hành động đó. Mỗi khẳng định "xong" phải có output lệnh kiểm chứng.
Chạy job nặng (full test, Playwright, build) từng cái một: máy 15,5 GB RAM, có phiên khác chạy cùng.
```

## Ghi chú về yêu cầu phần marketing-support (sàn, social, sỉ, tài khoản `tubutree`)

Yêu cầu này đã được dán vào phiên `chodeli-marketing-support-system` (phiên bắt đầu 21:50 ngày 2026-10-17), vì mã nằm ở repo đó. Phiên mini-app này chỉ xử lý điểm nối: khách từ sàn/social vào mini-app.
