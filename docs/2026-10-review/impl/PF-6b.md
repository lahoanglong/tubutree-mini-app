# PF-6b: Kiểu createReview và câu gợi ý điểm đánh giá của miniapp

Nhánh `hz18/PF-6b`, base `63cfb5d6`. Chỉ đụng `apps/miniapp/src/services/shop-api.ts` và spec cạnh nó, `apps/miniapp/src/components/reviews-section.tsx` và spec cạnh nó. Không đụng `apps/api`, `apps/web`; `apps/e2e` không có chuỗi nào bị đổi (grep "Thêm video", "Bạn sẽ nhận", "Tuyệt! Đánh giá", "chỉ chữ", "đánh giá đầu tiên" trong `apps/e2e` không ra kết quả). Không push, không deploy, không ghi DB (gói không cần Postgres, cổng 5802 không dùng).

Đã đọc `PF-3.md` (thưởng đánh giá chỉ một lần cho mỗi (khách, sản phẩm); xoá mà khách còn giữ phần thưởng rồi tạo lại thì dòng Review mới có `pointsEarned = 0`) và `PF-5b.md` mục 4 trước khi làm.

Commit theo từng mục: `9386f814` (mục 1), `8bc650a7` (mục 2), cùng commit báo cáo này.

## Mục 1: kiểu trả về của createReview

Có lỗi (kiểu thiếu), không phải lỗi hành vi. Response thật của `POST /products/:slug/reviews` (`reviews.service.ts`, `create`) là `{ ...dòng Review, updated: !!existing }`. `pointsEarned` là cột `Int @default(0)` của dòng Review: 5/10/15 khi `createFirst` được thưởng, 0 khi `rewardAlreadyKept` thấy khách còn giữ phần thưởng cũ, và ở nhánh `updateOwn` (`updated: true`) là phần thưởng của lần tạo gốc chứ không phải của lần gọi này. Kiểu cũ `ReviewItem & { updated?: boolean }` không có `pointsEarned`, và còn khai `author`/`avatar` bắt buộc mà response không có.

Đã làm: `shop-api.ts` xuất `CreatedReview = Pick<ReviewItem, 'id' | 'rating' | 'comment' | 'images' | 'videoUrl' | 'createdAt'> & { pointsEarned?: number; updated?: boolean }` và `createReview` trả `api.post<CreatedReview>`. Cả hai trường là optional (theo đúng yêu cầu của gói, và `updated?` vốn đã optional để chịu API cũ chưa trả). Bỏ kiểu cục bộ `CreatedReview` và chú thích bù tạm ở `reviews-section.tsx`; `onSuccess: (res) => ...` nhận kiểu suy ra từ `mutationFn`. Chỉ `reviews-section.tsx` dùng `createReview` (grep toàn `apps`, `packages`, `scripts`).

Test và đối chứng đỏ:

- `shop-api.spec.ts` thêm `describe('shop-api — createReview')` hai ca. Ca kiểu dùng `expectTypeOf<Created['pointsEarned']>().toEqualTypeOf<number | undefined>()` và `updated` tương tự; ca chạy thật kiểm URL `/products/nuoc-rua-chen/reviews` và `pointsEarned = 0` đi qua nguyên vẹn (không bị biến thành thiếu).
- vitest không kiểm kiểu nên ca kiểu chỉ có nghĩa dưới `tsc`. Đỏ trước khi sửa (`tsc --noEmit` thoát 2): `shop-api.spec.ts(133,26)` và `(142,14)` báo `Property 'pointsEarned' does not exist on type 'ReviewItem & { updated?: boolean | undefined; }'`. Xanh sau khi sửa.
- Chứng minh component không còn ép kiểu: đặt tạm `shop-api.ts` cũ (`git show HEAD:...`) cạnh `reviews-section.tsx` đã bỏ kiểu cục bộ thì `tsc` báo `reviews-section.tsx(300,45): Property 'pointsEarned' does not exist`; đã đặt lại bản mới, `git diff` đúng 3 file của mục.

## Mục 2: câu gợi ý điểm trước khi gửi

Có lỗi (câu chữ hứa sai). Form viết mới (`!isEdit`) hứa "+5/+10/+15 Điểm Xanh" vô điều kiện, trong khi sau PF-3 khách đã nhận thưởng sản phẩm đó rồi xoá đánh giá và viết lại sẽ nhận `pointsEarned = 0`. `canReviewProduct` không trả cờ "đã nhận thưởng" nên form không thể biết; theo yêu cầu không đổi API, nên sửa câu chữ để không bao giờ hứa sai.

Câu mới (hằng `FIRST_REVIEW_ONLY = 'Lần đầu đánh giá sản phẩm này'` dùng chung cho ba nhánh, nên điều kiện không bị lệch giữa các câu):

- Chỉ chữ: "Lần đầu đánh giá sản phẩm này: thêm video +15 / ảnh +10 Điểm Xanh (chỉ chữ +5). Chỉ đánh giá SP đã mua & nhận."
- Có ảnh: "Lần đầu đánh giá sản phẩm này, bạn nhận +10 Điểm Xanh cho đánh giá có ảnh! Thêm video để được +15."
- Có video: "Tuyệt! Lần đầu đánh giá sản phẩm này, đánh giá có video nhận +15 Điểm Xanh!"
- Sửa đánh giá (cập nhật cho nhất quán, không lặp câu của ba nhánh trên): "Chỉ lần đánh giá đầu tiên của mỗi sản phẩm được cộng Điểm Xanh, sửa đánh giá không cộng thêm."

Giữ thuật ngữ Q-26 ("Điểm Xanh"), giữ nguyên `Text` của tubu-ds, `tone`/`fontWeight` theo `bonus` không đổi, không đụng vùng chạm nào. Câu báo sau khi gửi (snackbar theo `pointsEarned`) đã đúng từ PF-5b, không đổi.

Test (`reviews-section.spec.tsx`): mock `VideoUpload` từ `() => null` thành một nút đặt được giá trị video (để nhánh có video chạy được); `describe('câu gợi ý điểm trước khi gửi (chỉ lần đầu)')` năm ca: ba nhánh chỉ chữ, có ảnh, có video khớp chuỗi đầy đủ; một ca bất biến đi qua cả ba trạng thái và kiểm "Lần đầu đánh giá sản phẩm này" đứng trước con số `+N` đầu tiên; một ca nhánh sửa đánh giá (có điều kiện "đánh giá đầu tiên của mỗi sản phẩm", không có `+N`, không chứa câu của form viết mới, chỉ một đoạn nhắc Điểm Xanh). Ca cũ của nhánh sửa đổi sang khớp câu mới. Sáu ca đỏ trước khi sửa (năm ca mới và ca cũ đã đổi kỳ vọng), đúng lý do: không tìm thấy chuỗi mới, hay vị trí của điều kiện "lần đầu" bằng -1; xanh sau khi sửa.

## Quyết định thiết kế và đề xuất (không làm)

Đề xuất tốt hơn, chỉ ghi, không làm vì đụng API: `GET /products/:slug/reviews/can-review` (`canReviewProduct`) trả thêm cờ kiểu `rewardAlreadyKept: boolean` (tính bằng đúng `rewardAlreadyKept` của `reviews.service.ts`). Khi cờ bật, miniapp ẩn hẳn câu gợi ý điểm thay vì chỉ rào điều kiện, nên khách đã nhận thưởng không thấy lời nhắc điểm nào. Việc đó cần đổi API, `MyReview`/kiểu trả của `canReviewProduct` ở `shop-api.ts`, và câu gợi ý; để gói khác quyết.

Điều kiện "lần đầu" vẫn có thể gây hiểu nhầm nhỏ cho khách đã xoá đánh giá và viết lại nhưng đã được thu hồi đủ điểm (được thưởng lại, đúng ý PF-3): câu vẫn đúng với họ. Với khách còn giữ thưởng (không được thưởng lại), câu nói "lần đầu đánh giá sản phẩm này" là điều kiện, không phải lời hứa, nên không sai.

## Lệnh kiểm và kết quả thật

Trong worktree `hz18-PF-6b`, PATH node 22.23.3, thư mục `apps/miniapp`. `pnpm install --frozen-lockfile` và `pnpm --filter @tubutree/shared-types build` thoát 0 (không đụng API nên không chạy `prisma generate`).

- `npx tsc --noEmit`: thoát 0 (trước mục 1: thoát 0 ở base; sau khi thêm test và trước khi sửa: thoát 2 như trên).
- `npx eslint --max-warnings=0 src/services/shop-api.ts src/services/shop-api.spec.ts src/components/reviews-section.tsx src/components/reviews-section.spec.tsx`: thoát 0.
- `npx vitest run src/components/reviews-section.spec.tsx src/services/shop-api.spec.ts`: 2 file, 43 test xanh, thoát 0 (base: 36 test; thêm 2 ở `shop-api.spec.ts`, 5 ở `reviews-section.spec.tsx`).

## Chưa verify

- Không chạy Playwright e2e, capture/axe, hay full suite vitest của miniapp (điều phối viên chạy).
- Chưa xem giao diện thật: câu gợi ý dài hơn câu cũ (thêm "Lần đầu đánh giá sản phẩm này") nên có thể xuống thêm một dòng ở màn hẹp; `Text variant="caption"` tự xuống dòng, không cắt chữ, nhưng chưa chụp.
- Chưa kiểm với API thật: kiểu dựa vào đọc `reviews.service.ts` ở base, không gọi endpoint.

## Rủi ro và việc ngoài nhóm file

- Khách chưa từng được thưởng vẫn thấy một điều kiện ("Lần đầu...") mà với họ luôn đúng; chỉ cờ từ API (đề xuất trên) mới bỏ hẳn được nhiễu này.
- Không thấy lỗi ở file ngoài nhóm trong lúc làm; grep toàn `apps/miniapp/src` không còn chỗ nào khác hứa điểm đánh giá.
