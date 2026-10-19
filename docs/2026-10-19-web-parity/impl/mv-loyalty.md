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

Gate cuối `gate-logs/mv-loyalty/run3/summary.txt`:

```
install rc=0 
shared-types rc=0 
app-core-typecheck rc=0 
app-core-test rc=0  Test Files  41 passed (41)       Tests  489 passed (489) 
web-typecheck rc=0 
web-lint rc=0 
web-test rc=0  Test Files  367 passed (367)       Tests  6352 passed (6352) 
web-test-utc rc=0  Test Files  367 passed (367)       Tests  6352 passed (6352) 
miniapp-typecheck rc=0 
miniapp-lint rc=0 
miniapp-test rc=1  Test Files  1 failed | 282 passed (283)       Tests  1 failed | 4312 passed (4313)  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @tubutree/miniapp@0.0.0 test: `vitest run` 
lint-vars rc=0 OK — every var(--x) reference is defined. 
lint-parity rc=0 > tubutree@0.0.0 lint:parity /Users/longla/coding/tubutree-mini-app/.claude/worktrees/web-mv-loyalty lint:parity xanh (0 mục pending) 
web-build rc=0  ✓ Compiled successfully 
miniapp-build rc=0 - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit. 
DONE
```

Bước duy nhất đỏ: `miniapp-test` (rc=1) do `subscribe-sheet.spec.tsx` "mặc định giao ngay, COD..." quá hạn 1294ms khi máy tải; chạy riêng lại toàn bộ miniapp vitest: 283 file, 4313/4313 xanh. Không sửa test Mini App. Chưa chạy lại cả gate (run3b).

Ảnh chụp: visual-tour 51/51 cặp (`gate-logs/visual/mv-loyalty-2`, trước commit đổi hex sang token). Cặp Quà của tôi chưa xem ảnh, chỉ có test; Điểm Xanh, Vườn Xanh, Xếp hạng chỉ xem ở lần chụp 1.

Playwright chỉ chạy spec tham quan. Spec e2e mới/sửa CHƯA CHẠY (chỉ qua tsc): `loyalty.web.spec.ts` (1 dòng), `community.web.spec.ts` (+11 dòng, scrollWidth `/cong-dong`), `game.web.spec.ts` (+23 dòng, Trợ lý AI 390x844; file thuộc lane khác theo 02-ke-hoach.md, cần xác nhận chủ file).

## 4b. Review

Lượt 1 (e6031cc8..70ffedbb), sửa ở 247af92b:
- MAJOR `/tu-van` và `/cong-dong/[id]`: thanh nhập `fixed` che chân trang điện thoại. Đã sửa: hook `use-sticky-bar-offset` gắn `has-sticky-bar` và `--sticky-bar-h`, bỏ đệm cứng, có test mount/unmount.
- MAJOR `/cong-dong` tràn ngang 4px do hàng chip `-mx-4`. Đã sửa: `-mx-3 px-3`, thêm e2e scrollWidth.
- MINOR hàng chip tự cuộn dọc 4px (`tubu-hit-44` ::after). Đã sửa: `max-md:py-1`.

Lượt 2 (247af92b), sửa ở d1857da7:
- MAJOR `/tu-van` tin mới cuộn xuống nằm dưới ô nhập fixed ~161px. Đã sửa: `max-md:scroll-mb-[var(--sticky-bar-h)]` trên `endRef` (test đỏ trước, rồi xanh) + e2e 390x844 chưa chạy; vị trí scroll-margin chưa đo lại trong trình duyệt ngoài lần reviewer dựng thử.
- Lượt 2 xác nhận 3 lỗi lượt 1 đã sửa đúng; không phát hiện MINOR.

Không có lỗi về tiền, điểm, mã: diff trang điểm/ví chỉ đổi className, endpoint/body/Idempotency-Key giữ nguyên.

## 5. Câu hỏi và điều để lại

1. Lịch sử Điểm Xanh nay giống Mini App ở mọi khổ (nhãn ngắn, 20 dòng, không mã đơn, không hạn từng dòng). Máy tính mất thông tin mã đơn và hạn dùng từng lô. Nếu muốn giữ chi tiết cho khổ máy tính, báo để làm `md:` riêng.
2. Thanh tiêu đề trắng và nút lùi nằm cùng hàng hiện do từng trang tự bọc (`MiniBar`/`MiniTitleBar`) vì `components/ui/page-header.tsx` và `globals.css` thuộc lane khác. Nên đưa vào PageHeader dùng chung để các lane khác không lặp.
3. Ô nhập Trợ lý AI cao 9rem như Mini App (ZaUI TextArea) chiếm ~17% màn; muốn gọn hơn thì giảm `max-md:min-h-[9rem]`.
4. Khác biệt cỡ nút 44 so với 48 ở Mini App, cỡ chữ vài px ở thẻ quà/điểm danh: chưa chỉnh.
5. Chân trang website gọn (hotline, chính sách) còn hiện ở các màn này, Mini App không có: thuộc mshell.
6. Spec e2e `game.web.spec.ts` (thuộc lane khác) được thêm 1 case Trợ lý AI; cần chủ file xác nhận, và chạy cả 3 spec e2e ở trên khi được phép chạy Playwright.
7. Logo sàn Hoàn tiền dùng token `forest-500`→`forest-200` thay hex ZaUI (mặc định: token, vì ds-v2-guest cấm hex).
8. Chưa thêm test đỏ-trước cho cỡ chữ số dư ví và tên quà (chưa chỉnh nên không có commit).
