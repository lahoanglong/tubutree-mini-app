# Gói qd2 ghicong: hạn ghi công CTV tính từ lúc khách bấm link, và dọn dấu chạm

Gốc: `6fae1a289`. Đọc kỹ luật chung `tools/brief-worker.md`. Ghi công quyết định hoa hồng nên phải có race spec. `migration: false` (nếu thật sự cần cột mới thì dừng và ghi lý do vào báo cáo).

Chủ chốt (nguyên văn, `21-quyet-dinh.md` mục E): "Ghi công CTV (muahang-8): hạn tính từ lúc khách bấm link (API nhận thời điểm bấm), không tính từ lúc chạm bù sau đăng nhập."

Bối cảnh mục muahang-8: `docs/2026-10-28-e2e/20-backlog.md` và báo cáo nhóm mua hàng `docs/2026-10-28-e2e/1x-*.md` (grep `muahang-8`).

## Hiện trạng (scout, dòng có thể lệch)
- API `POST /affiliate/touch` (`affiliate.controller.ts` khoảng :70) gọi `recordTouch` (`affiliate.service.ts` khoảng :203). Hạn = `now` + `affiliate.attribution_days` (mặc định 7, min 1, max 365).
- Web:
  - `apps/web/src/components/storefront-tracker.tsx`: `touchAndConfirm` (:23), `touchFromPending` (:31), chạm bù khi đăng nhập (:57-75).
  - `apps/web/src/lib/storefront-context.ts`: `tubu_web_storefront` (sessionStorage), bản chờ `tubu_web_ref_pending` (localStorage, tối đa 3 link, giữ 7 ngày), dấu `tubu_web_ctv_touched` (sessionStorage).
- Mini:
  - `apps/miniapp/src/hooks/use-referral-touch.ts` (upsert làm mới hạn);
  - `apps/miniapp/src/store/storefront-context.ts`: `tubu_sf_ctx`, dấu `tubu_sf_ctv_touched` (sessionStorage);
  - đăng nhập gửi `ref` + `firstTouch` (`store/auth.ts` khoảng :155-169).
- Dấu chạm chỉ xoá khi bấm đăng xuất: web `auth-context.tsx` `logout` (:222-236), Mini `auth.ts` `logout` (:309-313).

## Luật mới
1. **Hạn ghi công tính từ lúc bấm.**
   - Client lưu thời điểm khách bấm link (mở `?ref=` hoặc `/s/<code>`) cùng với mã. Mọi lượt chạm gửi lên API kèm thời điểm này, kể cả chạm bù sau đăng nhập và chạm từ bản chờ.
   - API nhận trường tuỳ chọn, ví dụ `clickedAt` (ISO). Hạn = `clickedAt` + `attribution_days`.
   - Chặn giá trị xấu: `clickedAt` ở tương lai (quá vài phút) thì dùng `now`. Ngày không hợp lệ thì dùng `now`. `clickedAt` + hạn ≤ `now` thì không ghi công mới (trả về như ca hết hạn hiện có, không lỗi 500).
   - Không gửi `clickedAt` (bản Mini cũ): hành vi như cũ, tính từ `now`.
   - Client không thể kéo dài hạn bằng `clickedAt`, vì giá trị chỉ được ≤ `now`.
2. **Không làm ngắn hạn của lượt bấm mới hơn.** Viết ra từng ca trước khi sửa, theo luật ghi công hiện có (last touch hay first touch, tìm trong `recordTouch`). Ví dụ: khách bấm link A lúc 10:00, rồi bấm lại A lúc 15:00, rồi chạm bù lúc 16:00 với `clickedAt` 10:00. Hạn phải giữ theo 15:00.
3. **Dấu chạm theo người dùng.** Lưu dấu kèm người dùng (ví dụ `{userId, code}`), hoặc xoá dấu khi id người dùng đổi.
   - Các chỗ mất phiên còn thiếu: web `handleCallback` (`auth-context.tsx` khoảng :189-210) và nhánh phiên chết (`client-api.ts` khoảng :121-126); Mini `applyBlocked` (`auth.ts` khoảng :84-113) và nhánh refresh bị từ chối (khoảng :238-254, :364-368).
   - Người đăng nhập sau trong cùng tab không được thừa hưởng dấu của người trước.
4. **Dấu đổi theo máy chủ.** Sau mọi lượt chạm thành công của một mã khác mã trong dấu, xoá hoặc cập nhật dấu (`storefront-tracker.tsx` khoảng :73-77, `use-referral-touch.ts` khoảng :34, :42).
   - Ca phải đúng: AN123 (ctv), rồi `/s/doi-tac`, rồi `/?ref=BINH9` (brand, máy chủ ghi BINH9), rồi `/?ref=AN123` (brand). Lần cuối phải gửi lên được, để máy chủ ghi AN123.
5. **Test thiếu ở `useBlockedMessage`** (`apps/miniapp/src/components/ui/auth-gate.tsx` khoảng :35): thêm ca `status: 'error'`. Ca này phải đỏ khi bỏ điều kiện `status === 'idle'`.
6. Hai nền giống nhau. Logic chung (đọc/ghi dấu, chọn `clickedAt`) đặt ở `packages/app-core` nếu hợp.

## Test bắt buộc
- Unit API cho `recordTouch`: có hoặc không có `clickedAt`, tương lai, quá hạn, không hợp lệ, và ca không làm ngắn hạn.
- Race spec ghi công (tìm spec có `touch`, `attribution` hoặc `referral` trong `apps/api/test/integration-race/`; không có thì thêm): hai lượt chạm cùng lúc với `clickedAt` khác nhau, rồi đặt đơn, kiểm hoa hồng ghi đúng CTV.
- Vitest hai nền cho: lưu thời điểm bấm, gửi `clickedAt` ở chạm bù, dấu theo người dùng, dấu đổi theo máy chủ.
- Playwright: Mini toàn bộ; web các spec có `ref`, `ctv`, `storefront`.
