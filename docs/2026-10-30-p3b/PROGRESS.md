# Đợt dọn P3b 30/10

Gốc: main 2ca045580. Nhánh gộp: `review/p3b-2026-10-30`. Ba gói, mỗi gói một worktree `.claude/worktrees/p3b-<gói>`, chạy bằng `tools/fix.workflow.js` (worker Sonnet làm, Opus review đối kháng, sửa lại; tối đa 3 lượt review). Bốn mục trùng phiên b4 đã đánh dấu BỎ trong file gói (comment E-43, ctv-1, /home/me, chữ khách ở Vườn Xanh).

## Kết quả theo gói

| Gói | Nhánh, HEAD | Lượt review | Xong | Một phần | Bỏ |
|---|---|---|---|---|---|
| ctv-ref | review/p3b-ctv-ref 81bcf9643 | 2 | muahang-r1, r2, r3, r4 | | e43-comment, ctv-1 (trùng b4) |
| giaodien | review/p3b-giaodien d5de10bd6 | 2 | phien-r2, admin-r3, giaodien-quantri-r1, r2, r3 | phien-r1 (Vườn Xanh để b4) | |
| test-api | review/p3b-test-api 9cda01ea0 | 1 | api-hotro-r1, diem-doirac-r1, flaky-mini | | tin-canhan-25 (trùng b4) |

Lượt review 1 của giaodien có 3 P2, đã sửa ở lượt sửa:
- Câu "Bạn vẫn đang đăng nhập" ở màn 429 sai khi chưa có phiên. Đã bỏ lời thân riêng, dùng lại lời 429 cũ.
- Lời báo "Chủ vừa đổi thêm" ở storefronts-tab bị cũ giữa danh sách và ngăn chi tiết.
- Spec blocked-account chập chờn vì import động trong thân test.

Ghi công CTV (muahang-r1..r3):
- Dấu "đã chạm như CTV" của Mini nằm ở sessionStorage `tubu_sf_ctv_touched`, nên sống qua lần WebView tải lại.
- Đăng xuất xoá dấu ở cả hai nền.
- Chạm brand đợi chạm CTV xong mới kiểm dấu, nhờ hàng đợi một chuỗi promise.

## P3 còn lại sau lượt review cuối (để đợt sau)

- Đăng xuất đúng lúc một lần chạm CTV còn đang chờ máy chủ: khi phản hồi về, dấu được đặt lại cho người đăng nhập kế tiếp. Chỗ sửa: `use-referral-touch.ts:40-41`, `storefront-tracker.tsx:75-76`. Đơn vẫn mang mã từ ngữ cảnh tab. Cách sửa gợi ý: biến epoch tăng khi xoá dấu.
- Entry Mini App tăng khoảng 0,3 KB raw / 0,12 KB gz do storefront-context. Mã phải chạy ở App gốc.
- `clear()` của Mini xoá dấu nhưng chưa có unit test; chuẩn hoá mã ' an123 ' cũng chưa có test ở Mini.
- Màn 429 Mini lặp chữ: tiêu đề và thân cùng "Bạn thao tác quá nhanh".
- `product-detail.tsx`: vài lối mua (confirmVariation, thêm giỏ) còn gọi `login()` trần, nên tài khoản bị khoá bấm vào không thấy lời báo.
- `storefronts-tab.tsx`: `changedAgain` là một state cho cả danh sách. Bấm Đã xem ở dòng khác sẽ xoá lời báo của dòng trước.
- Cấu hình ESLint chung của Mini thiếu eslint-plugin-react-hooks. Lỗi này có từ trước.
- Comment "(Q2)" còn ở `apps/web/src/components/recycle/recycle-home.tsx:261`.
- `addresses.spec.tsx` và `my-payroll.spec.tsx` có thể rớt ca đầu khi máy tải rất cao (cùng loại cold-start đã sửa ở 4 spec khác).
- `subscribe-sheet.spec.tsx`: beforeAll có hai waitFor hạn 8 giây, nhưng hookTimeout mặc định chỉ 10 giây.

Opus review bản gộp thêm 3 P3. Hai mục đầu nên sửa cùng đợt "quyết định 30/10", vì đợt đó đổi luồng ghi công CTV (hạn tính từ lúc bấm link):
- Dấu chạm CTV chỉ xoá khi bấm đăng xuất. Mất phiên kiểu khác thì dấu vẫn còn. Các chỗ thiếu: web `handleCallback` (`auth-context.tsx:189-210`) và nhánh phiên chết (`client-api.ts:122-126`); Mini `applyBlocked` (`auth.ts:108-113`) và nhánh refresh bị từ chối (`auth.ts:364-368`). Người đăng nhập sau trong cùng tab thừa hưởng dấu, nên lần chạm brand của họ bị bỏ. Cách sửa: xoá dấu khi id người dùng đổi, hoặc lưu dấu dạng `{userId, code}`.
- Dấu chỉ có một ô và không đổi khi máy chủ chuyển chạm sang mã khác. Lỗi có từ trước đợt này. Ví dụ: AN123 (ctv), rồi `/s/doi-tac`, rồi `/?ref=BINH9` (brand, máy chủ ghi BINH9), rồi `/?ref=AN123` (brand). Lần cuối bị bỏ vì dấu vẫn là AN123, nên máy chủ giữ BINH9. Sang tab mới hôm sau, đơn ghi công cho BINH9. Cách sửa: sau mọi lượt chạm ok của mã khác dấu, xoá dấu (`storefront-tracker.tsx:73-77`, `use-referral-touch.ts:34,42`).
- `useBlockedMessage` (`apps/miniapp/src/components/ui/auth-gate.tsx:35`): bỏ điều kiện `status === 'idle'` mà test vẫn xanh. Chưa ảnh hưởng gì. Cần thêm một ca `status: 'error'`.

## Kiểm chứng bản gộp

Nhánh `review/p3b-2026-10-30` sau 3 lần gộp (4e83ecd14). Máy tải cao (load 74–82) vì phiên khác chạy song song.

- Gate: 0 FAIL.
  - Jest API: 506 bộ, 11.808 ca.
  - Vitest: Mini 5.297 ca (chạy cả theo giờ UTC), web 8.070 ca, app-core 1.283 ca.
  - tsc 5 gói, eslint 3 app, lint-parity, vite build.
  - Entry Mini 709/222 KB, tổng 1991/769 KB.
- Playwright:
  - Mini: 220 qua.
  - Web: 373 qua, 5 flaky. Cả 5 ca rớt lần đầu vì hết hạn chờ 5 giây ở mức tải 75 (game quiz, recycle 2 ca, shop lọc, wishlist), và qua ở lần chạy lại. Không ca nào chạm mã đổi trong đợt: chỗ recycle chỉ đổi comment.
- Race: không chạy cục bộ. Phía API chỉ đổi chữ log cron Zalo OA và thêm một unit spec. CI vẫn chạy race 3 shard.
- Opus review bản gộp: cho merge, không P1/P2. Đã thử 7 đột biến trên bản chép: 6 làm test đỏ, 1 sống sót (mục P3 thứ ba ở trên).
