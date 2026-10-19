# Lane mv-loyalty: web điện thoại giống Mini App (Điểm Xanh, ví, kho quà, hoàn tiền, Vườn Xanh, tư vấn AI, cộng đồng, học viện)

Nhánh `web/mv-loyalty`. Chỉ đổi giao diện; không đổi endpoint, body, Idempotency-Key. Không đụng `components/mini`, `apps/miniapp`, `apps/api`, `packages`, `app/admin`, `app/merchant`.

## 1. Cách làm

- File mới `apps/web/src/components/loyalty/mini-surface.tsx` (+ spec): lớp dùng chung của lane (`miniCard`, `miniSurface`, `miniOutline`, `miniBleed`, `miniBtnSecondary`, `miniSectionTitle`, `MiniTitleBar`, `MiniBar`). Mọi lớp chỉ đổi ở `max-md:`; từ `md` giữ giao diện máy tính.
- Tiêu đề trang: thanh trắng tràn ngang + `data-page-bleed` (dùng luật CSS có sẵn của mshell để bỏ đệm 48px của body, tiêu đề cùng hàng với nút lùi nổi). Không sửa `globals.css` hay `components/ui/page-header.tsx` (của lane khác).
- Nút phụ: nền `forest-50`, chữ `forest-700`, không viền như ZaUI secondary; tắt thì `stone-200`/`stone-400`.

## 2. Bảng màn

| Màn | Khác biệt đã sửa | Commit | Còn lại (vì sao) | Ảnh chụp cuối |
|---|---|---|---|---|
| Điểm Xanh `/tai-khoan/diem-xanh` | thẻ hạng giữ màu nền theo hạng (bị `bg-stone-0` đè), thẻ không viền; thanh tiến độ bỏ chữ nhãn (chỉ aria-label), dày 10px; nút QR/Đóng/Mua sắm là nút phụ ZaUI; lịch sử: nhãn ngắn, 20 dòng, bỏ mã đơn, bỏ "Hết hạn" từng dòng, bỏ dòng "Hiển thị tối đa 100"; lối tắt dùng chevron; tiêu đề khối title-sm, emoji 56px, tên hạng 22px | 7dbc2fae, af50fbea | khối dưới màn đầu so bằng mã (ảnh Mini App chỉ cao 844); cỡ chữ điểm danh khác vài px | `mv-loyalty-2/web/tour/loyalty.jpg` |
| Ví Tubu `/tai-khoan/vi-tubu` | thứ tự một cột như Mini App: số dư, Điểm Xanh, Mời bạn, hoa hồng, hoàn tiền, mẹo, lịch sử (dưới md dùng `contents` + `order`; từ md giữ hai cột); nút Rút ngân hàng là nút phụ; thẻ không viền | 8acea641 | nút Rút cao 44 (Mini App 48), icon cạnh chữ | `.../wallet.jpg` |
| Kho quà `/kho-qua` | số điểm chữ serif display-md; dòng Quà của tôi phẳng không thẻ; thẻ quà viền mảnh không bóng; nút Huỷ là nút phụ | 949977d5 | cỡ chữ tên/mô tả quà lớn hơn Mini App 1px | `.../rewards.jpg` |
| Quà của tôi `/kho-qua/cua-toi` | thẻ viền mảnh không bóng | 949977d5 | không | `.../rewards__mine.jpg` |
| Hoàn tiền `/hoan-tien` | thẻ đã duyệt gradient cam đất (`--clay-500`→`--clay-700`); logo sàn không ảnh là vòng tròn gradient xanh không chữ; tên sàn đậm; dòng giao dịch cuối có đường kẻ; ô sàn/thẻ không viền | 39df10f5, commit hex→token | gradient logo xấp xỉ bằng token (`forest-500`→`forest-200`), vì `ds-v2-guest.spec` cấm hex trong trang đã chuyển | `.../cashback.jpg` |
| Vườn Xanh `/vuon-xanh` | nút phụ ZaUI (Góp quỹ, Mua, Hứng giọt sương, Tặng nước, quiz, vòng quay, mùa), thẻ khối không viền, dòng lối vào là thẻ viền mảnh, tiêu đề khối title-sm | f8e75969, af50fbea | nút cao 44 (Mini App 48) | `.../game.jpg` |
| Trợ lý AI `/tu-van` | ô nhập `fixed` dính đáy màn hình, ô cao 9rem như Mini App, thân chừa chỗ; 3 gợi ý thẻ viền mảnh chữ đậm; thông báo lỗi nâng lên trên ô nhập; tiêu đề trên thanh trắng, chừa chỗ nút lùi | 332583fb, af50fbea | chân trang website hiện dưới (việc của mshell) | `.../ai-advisor.jpg` |
| Cộng đồng `/cong-dong` | bài là khối trắng tràn ngang không viền cách nhau dải nền 8px; vùng đầu nằm trên dải trắng; chip chưa chọn nền be không viền (hit area 44 bằng `tubu-hit-44`); nút cúp/pháo hình tròn; ô tìm bo tròn; D7-36: nút cúp/pháo có chữ từ `sm`, vẫn `aria-label` | 4351c552, af50fbea | hàng Facebook/TikTok chỉ có ở web do mock cấu hình | `.../feed.jpg` |
| Xếp hạng, Sự kiện | hàng/thẻ không viền, tiêu đề trên thanh trắng | 4351c552 | lề trang 16 (Mini App 12), chân trang (mshell) | `.../feed__leaderboard.jpg`, `feed__events.jpg` |
| Bài viết `/cong-dong/[id]` | bài và Trả lời là khối trắng tràn ngang; tiêu đề câu hỏi và "Trả lời (n)" title-sm; ô Viết trả lời `fixed` đáy có bóng elevation-3 | 4351c552, af50fbea | chân trang website nằm dưới ô trả lời (mshell) | `.../feed___id.jpg` |
| Học viện, Khoá học | thẻ không viền, tên/mô tả cỡ ListRow, nút "Đã học xong" có dấu tích, link video không gạch chân, "Danh sách khoá học" vẫn hiện ở điện thoại, tên khoá title-md, tiêu đề chừa chỗ nút lùi | 487c4801, af50fbea | nút bài học cao 44 (Mini App 48) | `.../academy.jpg`, `academy___courseId.jpg` |

Thư mục ảnh chụp cuối: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-logs/visual/mv-loyalty-2/` (`index.html`, `pairs.json`). Lần 1: `mv-loyalty-1`. Ảnh chụp trước commit đổi hex sang token (chỉ khác màu vòng tròn logo sàn).

## 3. Lỗi UAT lô 1

- D7-36 `/cong-dong` nút cúp/pháo chỉ icon: Mini App cũng chỉ icon, nên dưới `sm` giữ icon tròn, từ `sm` thêm chữ "Bảng xếp hạng"/"Sự kiện"; vẫn `aria-label`. Có test. (File thực nằm ở `app/cong-dong/feed-view.tsx`, không phải `components/community/feed-view.tsx` như báo cáo UAT.)

## 4. Kiểm chứng

```
web vitest        Test Files 367 passed (367)  Tests 6349 passed (6349)
web vitest TZ=UTC Test Files 367 passed (367)  Tests 6349 passed (6349)
web tsc --noEmit  exit 0
web next lint     exit 0 (chỉ cảnh báo <img> có sẵn)
web next build    exit 0
miniapp vitest    Test Files 283 passed (283)  Tests 4313 passed (4313)
visual-tour       51 passed, 51/51 cặp ảnh (mv-loyalty-2)
```

Playwright chỉ chạy spec tham quan. Spec `loyalty.web.spec.ts` sửa 1 dòng (lịch sử Điểm Xanh không còn mã đơn "· TB0"); chưa chạy lại spec này.

## 5. Câu hỏi và điều để lại

1. Lịch sử Điểm Xanh nay giống Mini App ở mọi khổ (nhãn ngắn, 20 dòng, không mã đơn, không hạn từng dòng). Máy tính mất thông tin mã đơn và hạn dùng từng lô. Nếu muốn giữ chi tiết cho khổ máy tính, báo để làm `md:` riêng.
2. Thanh tiêu đề trắng và nút lùi nằm cùng hàng hiện do từng trang tự bọc (`MiniBar`/`MiniTitleBar`) vì `components/ui/page-header.tsx` và `globals.css` thuộc lane khác. Nên đưa vào PageHeader dùng chung để các lane khác không lặp.
3. Ô nhập Trợ lý AI cao 9rem như Mini App (ZaUI TextArea) chiếm ~17% màn; muốn gọn hơn thì giảm `max-md:min-h-[9rem]`.
4. Khác biệt cỡ nút 44 so với 48 ở Mini App, cỡ chữ vài px ở thẻ quà/điểm danh: chưa chỉnh.
5. Chân trang website gọn (hotline, chính sách) còn hiện ở các màn này, Mini App không có: thuộc mshell.
