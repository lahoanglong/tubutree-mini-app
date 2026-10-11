# PC-10a — Di cư game + loyalty sang DS v2 (C-076 lô 1), C-082, C-113

Nhánh `hz7/PC-10a` (tách từ `hardening/2026-10` @ afb1592). Quyết định áp dụng: Q-26 (thuật ngữ), Q-09/Q-11 (giữ hai điểm danh ở tầng dữ liệu), Q-02 (không thêm lại mua giọt nước bằng xu).

## Mục 1/4 — Guard spec `ds-c076-pc10a` + di cư `pages/loyalty.tsx` (C-076, C-114)

Trạng thái: XONG. Các mục còn lại của gói (game.tsx, wheel.tsx, rank-badge.tsx, C-082) thuộc lượt khác.

### Số đo trước → sau (`pages/loyalty.tsx`)

| Chỉ số | Trước | Sau |
|---|---|---|
| static-scan legacy | 151 | 0 |
| static-scan hex | 0 | 0 |
| static-scan emoji | 15 | 8 (đều là nội dung: 4 emoji hạng, 🎉 x2, 🔥 chuỗi ngày, 🌿 lời chúc) |
| ESLint (`npx eslint src/pages/loyalty.tsx`) | 5 lỗi (1 `no-restricted-imports` Button ZaUI, 4 `no-raw-color`) | exit 0, không cảnh báo |
| import ZaUI | `Box, Page, Text, Button, useNavigate, useSnackbar` | `Page, useNavigate, useSnackbar` |
| `<h1>` | 0 | 1 (`PageHeader` "Hạng thành viên & Điểm Xanh", render cả khi đang tải) |

### Đã làm

- Guard `apps/miniapp/src/ds-c076-pc10a.spec.ts` (19 test): cùng họ regex alias legacy với `ds-legacy-vars-4b.spec.ts`, hex/rgb thô theo `static-scan.mjs`, chỉ cho phép `Page/useNavigate/useLocation/useSnackbar` từ zmp-ui trong trang, và danh sách emoji được giữ theo từng file (`ALLOWED_EMOJI`) để emoji chức năng (✓ 🎁 🔒 💡) không quay lại. Mảng `FILES_PC10A` hiện chỉ có `loyalty.tsx`; các lượt sau thêm game.tsx, wheel.tsx, rank-badge.tsx, components/game/** TRƯỚC khi sửa.
- `pages/loyalty.tsx` (vẫn một file, hành vi không đổi): `Box/Text` ZaUI → `div` + `Text/Heading/Card/Badge/Icon/ListRow/KeyValueRow` của `components/ui`; `Button` ZaUI → `ui/button`; loading/error/empty → `Skeleton`/`ErrorState`/`EmptyState` (variant inline); icon chức năng (✓ 🎁 🔒 💡 và 🌱 ở ô ngày điểm danh) → Lucide qua `Icon`; vùng chạm ≥44px nhờ `Button`/`ListRow`; tiêu đề mục là `h2` thật.
- Màu hạng (4 hạng): `var(--sage-*)`/`var(--forest-*)`/`var(--clay-50)` — cùng giá trị mà alias cũ resolve ra, nên không đổi màu. Không tạo `css/loyalty.css`: `scripts/check-undefined-css-vars.mjs` chỉ đọc 3 file định nghĩa cố định nên token riêng của trang bị báo "chưa định nghĩa" (đã thử, 8 lỗi), xem "Đề xuất".
- Ba hộp thoại tự dựng (`position: fixed` + `rgba(26,26,23,.6)` + `tubu-pop`: thẻ thành viên, xác nhận đổi quà, chúc mừng lên hạng) → `BottomSheet` của DS (là `Dialog` theo `bottom-sheet.tsx`). `useLastNonNull` giữ nội dung trong 200ms hoạt ảnh đóng để sheet không trống đi lúc trượt xuống.
- Hai ô lối tắt 2 cột (Vườn Cây / Trạm Refill, `Box onClick`) → hai `ListRow` xếp dọc trong một `Card` (có role=button, Tab + Enter/Space, hàng ≥44px).
- Thanh tiến độ giữ bản tự vẽ (cần màu theo hạng, `ProgressBar` DS chỉ có brand/flash), dùng token, thêm `role="progressbar"` + `aria-valuenow`.

### Giữ nguyên (đã chứng minh bằng test)

Mọi `useQuery`/`useMutation`, khoá `busyRef` chống chạm đúp, điều kiện `disabled` của nút điểm danh (`!canCheckIn || isPending`) và nút đổi quà (`!canRedeem || isPending`), `loading` đi kèm `disabled` như cũ (nên spinner vẫn không hiện khi đang gửi, đúng hành vi cũ), số liệu (`formatPoints/formatNumber`), điều hướng `/game`, `/refill`, `/browse`, logic chúc mừng lên hạng (`tubu_last_tier_min`), thuật ngữ Q-26 (Mã giảm giá / Điểm Xanh / giọt nước), không có "TubuXu" mới.

### Test (đỏ → xanh)

- `pages/loyalty-behavior.spec.tsx` (MỚI, 20 test đặc tả): viết và chạy XANH trên bản cũ trước khi di cư (commit `f31c81d`), rồi vẫn 20/20 xanh trên bản mới: điểm danh (bật/tắt đúng lúc, chạm đúp gọi API 1 lần, lỗi → báo + tải lại), đổi quà (nút khoá khi thiếu điểm, hộp xác nhận hiện điểm trừ/còn lại đúng, Huỷ không gọi API, chạm đúp chỉ gọi 1 lần với đúng id, lỗi vẫn tải lại điểm), thẻ thành viên (QR mã hoá đúng memberCode, chép thành công/thất bại, lỗi tải → Thử lại, Đóng), chúc mừng lên hạng (lần đầu không bật, mốc thấp hơn thì bật, bằng nhau thì không), lối tắt điều hướng, thanh tiến độ 50%.
- `ds-c076-pc10a.spec.ts` (MỚI): trước khi di cư 4 test của `loyalty.tsx` ĐỎ (alias legacy, rgba thô, import `Box/Text/Button`, emoji `['✓','🎁','🔒','💡']`); sau di cư 19/19 xanh.
- `pages/loyalty-layout.spec.tsx`: thêm mock `useLocation` (PageHeader gắn `BackButton` cần vị trí) + 2 test C-114 (đúng một `h1`, đang tải vẫn có `h1`): ĐỎ trước, XANH sau. 6 test cũ giữ nguyên, xanh.
- `pages/loyalty.spec.ts` (quét mã nguồn, 7 test): xanh, không phải sửa.

### Lệnh kiểm chứng (output thật)

```
$ npx eslint src/pages/loyalty.tsx src/pages/loyalty-layout.spec.tsx src/ds-c076-pc10a.spec.ts
exit 0, không output
$ npx tsc --noEmit
exit 0, không output
$ node scripts/uiux/static-scan.mjs ... (legacy hex emoji file)
0 0 8 apps/miniapp/src/pages/loyalty.tsx
$ node scripts/check-undefined-css-vars.mjs
OK — every var(--x) reference is defined.
$ npx vitest run src/ds-c076-pc10a.spec.ts src/pages/loyalty-layout.spec.tsx src/pages/loyalty-behavior.spec.tsx \
    src/pages/loyalty.spec.ts src/components/ui/button-guard.spec.ts src/components/ui/hit-target-guard.spec.tsx \
    src/ds-legacy-vars-4a.spec.ts src/ds-legacy-vars-4b.spec.ts
 Test Files  8 passed (8)
      Tests  147 passed (147)
```

### Giả định

1. Trang trước đó không có tiêu đề nào; C-114 cần đúng một `h1` nên dùng `PageHeader` với "Hạng thành viên & Điểm Xanh" (trùng nhãn dòng menu ở `profile.tsx`).
2. Hộp thoại giữa màn hình → bottom sheet là thay đổi trình bày, không đổi luồng. DS không có modal giữa màn hình; `Dialog = BottomSheet` là quyết định đã ghi trong `ui/bottom-sheet.tsx`.
3. `EmptyState`/`ErrorState` chỉ nhận chuỗi nên câu trống cũ tách thành tiêu đề + mô tả ("Chưa có mã giảm giá khả dụng" / "Đổi Điểm Xanh ở mục bên dưới để nhận mã."; "Hiện chưa có ưu đãi nào để đổi"; "Chưa có giao dịch điểm nào"). Câu lỗi giữ nguyên chữ "Chưa tải được ...: <lỗi>".
4. Nút trong ô ngày điểm danh: ✓ → `Check`, 🎁 (ngày 7) → `Gift`, 🌱 → `Sprout` (đều là chỉ báo chức năng, không phải nội dung hạng).

### Việc còn lại / ghi chú

- CHƯA kiểm bằng mắt trên trình duyệt/Zalo (không chạy dev server/Playwright theo quy định máy): bố cục 390x844 của thẻ hạng, hàng ô 7 ngày (mỗi ô ~42px) và nút "Điểm danh +N" cao 44px cạnh tiêu đề dài cần xem lại. Ghi "unverified" cho phần hình ảnh.
- `components/qr-code.tsx` (ngoài nhóm file của gói) còn `var(--neutral-100)` ở khung chờ QR và hex `#1a1a17/#ffffff` làm màu mã QR (màu QR phải đen/trắng, giữ). Chỉ cần đổi `--neutral-100` → token v2 ở lô "phần còn lại".

### Đề xuất cho điều phối viên

1. `apps/e2e/tests/loyalty.miniapp.spec.ts` (dòng ~125, ~176, ~193) chọn hộp thoại bằng `.tubu-pop` rồi `filter({ hasText })`; sau di cư các hộp là bottom sheet của ZaUI nên selector này không còn khớp. Đổi sang chọn theo tiêu đề sheet (`getByRole('heading', { name: 'Xác nhận đổi ưu đãi' })` và nút trong sheet đó). Cùng file có `modal.getByText('-50 Xanh')` đã lệch từ trước (UI in "-50 điểm Xanh" từ khi thêm đơn vị ở C-083) nên e2e này cần được sửa tay, tôi không chạy được Playwright.
2. `scripts/check-undefined-css-vars.mjs`: nếu muốn cho phép token riêng theo trang (`css/<tên>.css`, như quy ước của lô C3), cần thêm các file đó vào `DEFINITION_FILES` (hoặc quét `apps/miniapp/src/css/*.css`). Tôi không sửa vì ngoài nhóm file và nhiều gói song song sẽ sửa cùng dòng.
3. Hai nút điểm danh (Điểm Xanh ở đây, giọt nước ở Vườn) vẫn tách ở hai trang: dòng chú thích trong thẻ điểm danh đã nói rõ "giọt nước Vườn Xanh điểm danh riêng trong Vườn Cây". Phần gộp trình bày thuộc C-082 trên `game.tsx` (lượt khác).

## Mục 2/4 — C-082 bước 1: test đặc tả + chia khối `pages/game.tsx` (refactor thuần)

Trạng thái: XONG phần "bước 1". CHƯA làm: điều hướng nội bộ (SegmentedTabs/neo), di cư DS v2 cho `game.tsx` và `components/game/**`, `wheel.tsx`, `rank-badge.tsx` (các bước sau của gói).

### Số đo trước → sau

| Chỉ số | Trước | Sau |
|---|---|---|
| `pages/game.tsx` số dòng | 1.266 | 416 (còn: truy vấn, mutation, trạng thái quiz/thu hoạch, ghép khối) |
| `components/game/*` | không có | 22 file, 1.240 dòng |
| ESLint `pages/game.tsx` | 3 lỗi (Button ZaUI, 2 rgba thô) | exit 0 (do nút đăng nhập và lớp phủ rgba đã chuyển vào `components/game/`) |
| static-scan `pages/game.tsx` legacy/hex/emoji | 163 / 0 / 90 | 5 / 0 / 7 |
| static-scan `components/game/**` legacy/hex/emoji | - | 152 / 0 / 83 (mã chuyển nguyên văn, chưa di cư; tổng 157 thay vì 163 vì hai lối tắt và hai bảng xếp hạng dùng chung một component) |

Số legacy/emoji chưa giảm là đúng yêu cầu bước này ("chưa đổi giao diện"); di cư DS v2 ở bước sau phải thêm `game.tsx` và `components/game/**` vào `FILES_PC10A` của `ds-c076-pc10a.spec.ts` TRƯỚC khi sửa.

### Test đặc tả (`pages/game-behavior.spec.tsx`, 71 test)

Viết và chạy XANH trên bản cũ trước khi tách (commit `2301440`), vẫn 71/71 xanh sau từng commit tách. Chỉ truy vấn theo role/chữ. Phủ: trạng thái trang (đang khôi phục phiên, chưa đăng nhập, lỗi hồ sơ + Thử lại), thẻ vườn + giai đoạn cây, lối tắt `/feed` `/refill`, banner mùa; điểm danh (bật/tắt theo ngày giờ VN, hôm kia vẫn bật, lỗi, 7 ô ngày với chu kỳ `streakDays % 7`), hứng sương, vé giữ lửa (giá mặc định 80), hồi sinh chuỗi (chỉ làm mới hồ sơ), cảnh báo héo/chết; tưới cây (`waterTree(20)`, khoá khi đang gửi, làm mới đủ khoá), hộp thu hoạch (mã, chứng nhận, loài, chép mã thành công/thất bại, "Dùng mã giảm giá ngay" → `/browse`), mua cây thật (giá xu, làm mới rừng + ví); lô đất (loại lô nhà, tưới đúng id, chỉ khoá lô đang tưới, mở lô SEEDS/XU cùng khoá, đủ lô); Chặng Mùa (nút free/premium/khoá, `claimSeasonPass(tier, track)`); cộng đồng, sổ tay, tặng nước (chỉ khoá đúng người), tác động xanh + rừng (tối đa 5); vòng quay (`cost=10`, `spin`, lỗi ném lại); quiz (đánh số câu, reveal, khoá đáp án, Hoàn thành); nhiệm vụ (nút nhận chỉ khi đạt và chưa nhận, `CHECKIN_7` theo chuỗi, mục tiêu mặc định); hai bảng xếp hạng (bục 2-1-3). Kiểm tra mọi `queryKey` được làm mới sau từng mutation.

Kiểm tra spec có răng: đổi thử 6 điều kiện trong `game.tsx` cũ (bỏ `checkedInToday` khỏi `disabled` nút điểm danh, bỏ `dewCollectedToday`, bỏ `premiumEligible` khỏi nút Premium, `waterTree(20)` → `10`, `canClaim = isDone`, bỏ `giftedToday`) — cả 6 đều làm đúng 1 test ĐỎ; đã khôi phục file nguyên trạng.

### Bằng chứng không đổi hành vi

Ngoài test: dựng tạm bản `game.tsx` cũ (`git show 2301440:...`) cạnh bản mới, cùng dữ liệu giả đầy đủ mọi khối (lô đất, Chặng Mùa, sổ tay, bạn bè, rừng 7 cây, quiz 2 câu, 3 nhiệm vụ, hai bảng xếp hạng, hồ sơ héo + hồi sinh), so `container.innerHTML` ở 3 thời điểm (lúc tải xong; sau khi trả lời quiz; sau khi thu hoạch mở hộp chúc mừng): GIỐNG HỆT từng byte (33.992 / 34.826 / 37.128 ký tự). File tạm đã xoá, không commit.

### Cấu trúc `components/game/`

`game-utils.ts` (isSameVNDay, nhãn quiz/hiếm), `game-card.tsx` (GameCard, thay `Card` cục bộ), `garden-hero`, `game-link-row` (dùng cho Bảng tin + Đổi vỏ chai), `season-banner`, `tree-health-alert`, `checkin-streak` (điểm danh + 7 ô + vé giữ lửa + hứng sương), `streak-repair`, `tree-actions` (tưới + mua cây), `garden-plots`, `season-pass`, `community-goal`, `species-codex`, `friend-gifts`, `eco-impact` (+EcoStat), `lucky-wheel-card`, `quiz-card` (+QuizBlock), `missions-card`, `season-leaderboard`, `weekly-leaderboard`, `harvest-celebration`, `game-states` (skeleton + cổng đăng nhập).

Nguyên tắc: mọi `useQuery`/`useMutation`, trạng thái quiz (`answeredIds`, `reveal`) và trạng thái thu hoạch ở lại trang; khối chỉ nhận props (dữ liệu + `xxxPending` + `xxxVariables` + callback) và giữ nguyên biểu thức `disabled`/`loading` cũ. Việc này để bước sau (tab/neo) có thể ẩn-hiện khối mà không mất trạng thái.

### Commit (mỗi nhóm khối một commit, test xanh sau từng commit)

`2301440` test đặc tả → `fa36274` đầu trang (thẻ vườn, 2 lối tắt, banner mùa, cảnh báo cây) → `5b301fe` điểm danh/hồi sinh/tưới-mua cây → `bc84c88` lô đất/Chặng Mùa/cộng đồng/sổ tay → `c32046a` tặng nước/tác động xanh/vòng quay/quiz/nhiệm vụ → `44b8eac` hai bảng xếp hạng + hộp thu hoạch → `063f4e8` skeleton/cổng đăng nhập + khối điểm danh tự suy cờ ngày từ hồ sơ.

### Lệnh kiểm chứng (output thật)

```
$ npx tsc --noEmit                     -> exit 0
$ npx eslint src/pages/game.tsx src/pages/game-behavior.spec.tsx src/components/game  -> exit 0, không output
$ npx vitest run src/pages/game-behavior.spec.tsx src/pages/game-numbers.spec.tsx src/pages/format-guard.spec.ts \
    src/components/ui/button-guard.spec.ts src/components/ui/hit-target-guard.spec.tsx src/i18n/terminology.spec.ts \
    src/ds-c076-pc10a.spec.ts src/ds-legacy-vars-4a.spec.ts src/ds-legacy-vars-4b.spec.ts src/pages/loyalty-behavior.spec.tsx
 Test Files  10 passed (10)
      Tests  210 passed (210)
$ node scripts/check-undefined-css-vars.mjs  -> OK — every var(--x) reference is defined.
```

### Giả định

1. "Chưa đổi giao diện" nên `components/game/**` giữ nguyên `Box/Text/Button` ZaUI, alias legacy và emoji; ESLint chỉ chặn ZaUI `Button` và rgba thô trong `pages/`, nên các file này qua ESLint nhưng sẽ không qua guard di cư. `game.tsx` đạt ESLint 0 chỉ vì hai thứ đó đã chuyển vào component.
2. `CheckInStreak` nhận cả `profile` và tự suy `checkedInToday`/`dewCollectedToday` (cùng biểu thức `isSameVNDay(profile?.lastXxxAt ?? null)` như cũ) để trang ngắn hơn; test đặc tả xác nhận không đổi.
3. `game.tsx` còn 416 dòng, hơi trên mốc "~400": phần còn lại là 11 truy vấn + 12 mutation + trạng thái quiz/thu hoạch. Nếu cần thấp hơn, bước sau có thể gom truy vấn/mutation vào hook (đã có test đặc tả che chắn).
4. Không có hai nút điểm danh trong `game.tsx`: trang Vườn chỉ có điểm danh giọt nước (`checkIn`); điểm danh Điểm Xanh nằm ở `loyalty.tsx`. Khi làm điều hướng nội bộ (bước 2) chỉ cần giữ nhãn rõ "Điểm danh nhận giọt nước" cạnh hành động chính; không cần gộp API.

### Ghi nhận, không sửa (không thuộc commit di cư)

- Trang Vườn không có `busyRef` như `loyalty.tsx`: hai lần chạm đồng bộ trong cùng một tick gọi API hai lần vì `isPending` của react-query tới React chậm một nhịp (đã thử bằng `fireEvent.click` hai lần liên tiếp: `checkIn`, `collectDew`, `buyStreakFreeze`, `repairStreak`, `waterTree`, `buyTree`, `claimSeasonPass`, `answerQuiz`, `claimMission` đều bị gọi 2 lần). Người dùng thật khó chạm hai lần trong < 1 frame, và nút khoá ngay sau đó (đã có test "chạm lần 2 khi đang gửi không gọi lại"), nhưng các thao tác tiêu xu (`buyTree`, `unlockPlot('XU')`) nên được server chặn trùng; nếu chưa, nên thêm khoá `useRef` ở trang giống `loyalty.tsx`. Thuộc quyết định của điều phối viên vì đụng nhánh tiền/giọt nước (cần review opus).

### Đề xuất cho điều phối viên

1. Bước sau của gói (điều hướng nội bộ + di cư DS v2) nên mở bằng việc thêm `pages/game.tsx` và `components/game/**` vào `FILES_PC10A`, chạy ĐỎ, rồi di cư từng file; test `game-behavior.spec.tsx` truy vấn chữ emoji (🚿 Tưới cây (20💧), 💦 Hứng giọt sương, ✅ Đã điểm danh...) nên khi đổi emoji chức năng sang `Icon` cần cập nhật các tên nút trong spec cùng commit (đây là thay đổi trình bày có chủ đích, không phải đổi hành vi).
2. Phần gốc e2e (`apps/e2e`) chọn trang Vườn theo chữ; DOM không đổi nên không cần sửa ở bước này.

## Mục 3/4 — C-082 bước 2 + C-076: di cư `pages/game.tsx` và `components/game/**` sang DS v2, tab nội bộ, bố cục hai màn đầu

Trạng thái: XONG phần game. CHƯA làm (lượt khác, mục 4/4): `components/wheel.tsx` (vòng quay vẫn legacy 13) và `components/community/rank-badge.tsx` (legacy 1).

### Số đo trước → sau

| Chỉ số | Trước (sau mục 2/4) | Sau |
|---|---|---|
| static-scan `pages/game.tsx` legacy / hex / emoji | 5 / 0 / 7 | 0 / 0 / 1 (💧 trong gợi ý "nhận 💧 tưới vườn") |
| static-scan `components/game/**` legacy / hex / emoji | 152 / 0 / 83 | 0 / 0 / 54 (25 file, mọi file legacy 0, hex 0) |
| ESLint `pages/game.tsx` + `components/game` + spec | exit 0 | exit 0, không cảnh báo |
| import ZaUI trong `components/game/**` | `Box, Text, Button` ở phần lớn file | chỉ `useSnackbar` (hộp thu hoạch) |
| `pages/game.tsx` số dòng | 416 | 237 (truy vấn và lệnh ghi chuyển vào `use-game-data.ts` 37 dòng + `use-game-actions.ts` 207 dòng) |
| `<h1>` | 0 | 1 (`PageHeader` "Vườn Xanh", cả khi đang tải / chưa đăng nhập / lỗi hồ sơ) |

Emoji còn lại đều là NỘI DUNG game (giai đoạn cây 🌱🌿🌳, đơn vị giọt nước 💧, chuỗi ngày 🔥, huy chương, phần thưởng 🎁, nhãn phân loại quiz, tình trạng héo/chết 🥀🍂 trong dòng tiến độ, lời chúc trong thông báo/snackbar). Danh sách cho phép theo từng file nằm ở `ALLOWED_EMOJI` của `ds-c076-pc10a.spec.ts`; emoji làm icon chức năng đã đổi sang Lucide qua `Icon`: icon trên nút (tưới, mở lô, điểm danh, hứng sương), tiêu đề khối, trạng thái cây, chứng nhận rừng, ô thống kê tác động xanh, dòng lối tắt.

### Điều hướng nội bộ và bố cục (C-082)

- Ba tab `SegmentedTabs` (dính đầu trang): **Hôm nay** / **Vườn** / **Cộng đồng**, mở sẵn Hôm nay.
  - Hôm nay: cảnh báo cây héo/chết → hồi sinh chuỗi (chỉ trong cửa sổ hồi sinh) → **Tưới cây** + Mua cây thật → **Điểm danh** + 7 ô ngày + vé giữ lửa + hứng sương → **Nhiệm vụ** → Quiz → Vòng quay → lối tắt Đổi vỏ chai.
  - Vườn: lô đất, sổ tay loài cây, tác động xanh + rừng của tôi, mục tiêu cộng đồng cây thật.
  - Cộng đồng: banner mùa, Chặng Mùa, tặng nước bạn bè, bảng xếp hạng tuần, top góp nước mùa, lối tắt Bảng tin.
- Thẻ vườn (nhỏ lại, ~160px) nằm trên thanh tab nên luôn thấy; tưới cây là nút chính (primary, 48px). Thứ tự DOM tưới → điểm danh → nhiệm vụ → quiz được khoá bằng test; vị trí theo pixel ở 390x844 CHƯA đo (xem "Việc còn lại").
- Khối của tab không chọn vẫn được dựng nhưng ẩn (`hidden` + `display:none`): vòng quay không bị dựng lại khi đổi tab (test đếm mount/unmount), đáp án quiz và hộp thu hoạch (dựng ở cấp trang) không mất.
- Hai lượt điểm danh (Q-09/Q-11): trang này chỉ có điểm danh giọt nước (điểm danh Điểm Xanh ở trang Hạng thành viên, đã nói rõ trong thẻ đó). Không có cách gộp UI an toàn mà không đổi luồng nên KHÔNG gộp; giữ một nút "Điểm danh" và thêm dòng "Nhận giọt nước tưới cây mỗi ngày" dưới tiêu đề để nhãn khác hẳn nút "Điểm danh +N" bên Điểm Xanh. Không đổi API.
- Hộp chúc mừng thu hoạch: lớp phủ `rgba(0,0,0,0.5)` tự dựng → `BottomSheet` của DS (luôn dựng, điều khiển bằng `open`; đóng bằng nút, vùng mờ hoặc vuốt như trước).
- Thẻ: `Card` + `Heading h2` + `Icon`; thanh tiến độ dùng `ProgressBar` (riêng thẻ vườn dùng bản tự vẽ nền tối vì ProgressBar chỉ có tông sáng, kèm `role="progressbar"`); nút dùng `Button` của DS (≥44px), danh sách lối tắt dùng `ListRow` (Tab + Enter/Space).

### Giữ nguyên (đã chứng minh bằng test)

Mọi lời gọi API, khoá làm mới cache, biểu thức `disabled`/`loading` của từng nút (kể cả `disabled` đi kèm `loading` nên spinner vẫn không hiện khi đang gửi, đúng như cũ), số hiển thị, thông điệp snackbar, thuật ngữ Q-26 (không thêm "TubuXu" mới; dòng "Mua bằng TubuXu" cũ giữ nguyên chờ PD-3), không có mua giọt nước bằng xu (Q-02). Season Pass và chữ "cây thật" di cư nguyên trạng.

### Test (đỏ → xanh)

- `ds-c076-pc10a.spec.ts`: thêm 25 file game (`game.tsx` + 24 file `components/game`) vào `FILES_PC10A` trước khi sửa: 64 test ĐỎ (legacy, màu thô, ZaUI, emoji); sau di cư 123/123 xanh (thêm `game-tabs.tsx` ở nhóm cuối, tổng 26 file game). Thêm kiểm "không import ZaUI ngoài `useSnackbar`/khung trang" cho `components/game/**`. Commit theo 4 nhóm file, mỗi nhóm thêm file vào guard rồi mới di cư.
- `pages/game-layout.spec.tsx` (MỚI, 12 test): chạy trên bản `game.tsx` cũ → 11 ĐỎ / 1 xanh (nhóm bị thiếu: một h1 ở 4 trạng thái, ba tab, ẩn/hiện khối, thứ tự tưới → điểm danh → nhiệm vụ → quiz, h2 mỗi khối, một nút Điểm danh, giới hạn 400 dòng); bản mới 12/12 xanh.
- `pages/game-behavior.spec.tsx` (71 test): vẫn 71/71 xanh. Sửa có chủ ý: tên nút bỏ emoji chức năng ("Tưới cây (20💧)", "Đã điểm danh", "Hứng giọt sương", "Mở lô (...)", "Tưới"), tiêu đề khối bỏ emoji, ô "Giọt nước đã góp" không còn 💧 nên số ô 💧 giảm 1, và helper `openTab` cho truy vấn role vào tab Vườn / Cộng đồng (khối ẩn không vào cây accessibility). Không đổi bất kỳ khẳng định nào về API/disable/số liệu.
- Vòng đầu trước khi di cư: tách hook `use-game-data`/`use-game-actions` là refactor thuần, 71 test vẫn xanh (commit `8720c05`).

### Lệnh kiểm chứng (output thật)

```
$ npx eslint src/pages/game.tsx src/pages/game-layout.spec.tsx src/pages/game-behavior.spec.tsx src/components/game src/ds-c076-pc10a.spec.ts
exit 0, không output
$ npx tsc --noEmit
exit 0, không output
$ node scripts/uiux/static-scan.mjs ... (legacy hex emoji file)
0 0 1 apps/miniapp/src/pages/game.tsx
0 0 3 apps/miniapp/src/components/game/checkin-streak.tsx   (25 file components/game: legacy 0, hex 0)
$ node scripts/check-undefined-css-vars.mjs
OK — every var(--x) reference is defined.
$ npx vitest run src/pages/game-layout.spec.tsx src/pages/game-behavior.spec.tsx src/pages/game-numbers.spec.tsx src/ds-c076-pc10a.spec.ts \
    src/ds-legacy-vars-4a.spec.ts src/ds-legacy-vars-4b.spec.ts src/ds-legacy-alias-contrast.spec.ts src/components/ui/button-guard.spec.ts \
    src/components/ui/hit-target-guard.spec.tsx src/i18n/terminology.spec.ts src/pages/format-guard.spec.ts \
    src/pages/loyalty-behavior.spec.tsx src/pages/loyalty-layout.spec.tsx src/pages/loyalty.spec.ts
 Test Files  14 passed (14)
      Tests  347 passed (347)
```

### Giả định

1. Tên trang "Vườn Xanh" (đúng nhãn tab dưới cùng trong `nav-config.ts`), không dùng "Vườn Cây" như tên nội bộ trong báo cáo.
2. Mua cây thật chuyển từ nút chính nhỏ sang nút phụ (secondary) và tưới cây thành nút chính: chỉ là thứ bậc trình bày, không đổi điều kiện hay handler.
3. Hứng giọt sương, vé giữ lửa và Mua cây thật đều là nút `secondary` 48px (DS không có biến thể nhỏ); dòng vé giữ lửa gồm biểu tượng + số vé bên trái, nút Mua bên phải.
4. Màu tông xanh của chữ nhấn (`leaf-700`) → tone `brand` (forest-600) theo ngữ nghĩa DS, không giữ nguyên giá trị sage-700; màu độ hiếm giữ đúng giá trị alias cũ (`honey-600` / `sage-600` / `stone-500`).
5. Khối ở tab khác được dựng sẵn (ẩn) thay vì chỉ dựng khi mở tab, để không mất trạng thái vòng quay; đổi lại DOM nặng bằng trang cũ (không nặng hơn).

### Việc còn lại / ghi chú

- CHƯA kiểm bằng mắt (không chạy dev server/Playwright theo quy định máy): chiều cao thẻ vườn + thanh tab + hai nút tưới/mua + thẻ điểm danh có vừa màn đầu 390x844 hay không; thanh tab `position: sticky; top: 0` trong `Page` của ZaUI (nếu `Page` không phải khung cuộn thì sticky vẫn đúng theo viewport, nhưng cần xem trên máy thật có bị header Zalo che không); tương phản chữ trắng trên bục xếp hạng `forest-500`; đáp án quiz dài xuống dòng trong lưới 2 cột. Ghi "unverified" cho mọi phần hình ảnh.
- `wheel.tsx` (legacy 13 và emoji) và `rank-badge.tsx` (legacy 1) chưa di cư, còn trong `LuckyWheelCard`; thuộc mục 4/4.
- Đã ghi ở mục 2/4 và giữ nguyên: nút ở trang Vườn không có `busyRef` đồng bộ như `loyalty.tsx` (hai cú chạm trong cùng một khung hình vẫn gọi API hai lần, nút khoá ngay ở khung sau). Chưa thêm vì đụng nhánh tiền/giọt nước, cần quyết định của điều phối viên và review opus.

### Đề xuất cho điều phối viên

1. `packages/eslint-config/index.js` loại `**/game/**` và `**/tier/**` khỏi `tubu-ds/no-raw-color` + `icon-button-aria-label` ("minh hoạ dùng màu tuỳ ý"). `components/game/**` giờ đã sạch hex/rgb, nên có thể bỏ riêng `**/game/**` để lint bảo vệ thay cho guard spec (tôi không sửa vì ngoài nhóm file).
2. PD-1 (ẩn Season Pass): chỉ cần xoá khối `{seasonPass?.active && ...}` trong tab Cộng đồng của `game.tsx`, gỡ `useGameData.seasonPass`, `useGameActions.claimPassM`, `components/game/season-pass.tsx` và `describe('GamePage — Chặng Mùa')` trong `game-behavior.spec.tsx`; đồng thời bỏ `season-pass.tsx` khỏi `GAME_FILES` của guard.
3. PD-1/PD-3 (đổi chữ "cây thật", gộp TubuXu vào Điểm Xanh): các chuỗi nằm ở `tree-actions.tsx` ("Mua cây thật", "Mua bằng TubuXu ..."), `eco-impact.tsx`, `community-goal.tsx`, `harvest-celebration.tsx`, `use-game-actions.ts` (snackbar "Đã mua 1 cây thật"); test đặc tả truy vấn đúng các chuỗi này nên đổi chữ phải đổi test cùng commit.
4. `apps/e2e` không có kịch bản nào chạm trang `/game`, nên không cần sửa e2e cho mục này.
5. Nếu chủ dự án muốn gộp trình bày hai điểm danh, cách an toàn duy nhất là một dòng lối tắt `ListRow` trong thẻ điểm danh trỏ sang `/loyalty` ("Điểm danh nhận Điểm Xanh"), không gộp nút/API; chưa làm vì ngoài quyết định Q-09/Q-11.

## Mục 4/4 — C-076: di cư `components/wheel.tsx` và `components/community/rank-badge.tsx`, tổng kết gói

Trạng thái: XONG. Với mục này, mọi file của gói PC-10a đã đạt legacy 0 / hex 0 / ESLint 0 / không import ZaUI ngoài khung trang.

### Số đo trước → sau

| File | static-scan legacy | hex | emoji | ESLint | import ZaUI |
|---|---|---|---|---|---|
| `components/wheel.tsx` | 13 → 0 | 0 → 0 | 8 → 8 (đều là nội dung: 7 ô minh hoạ trên bánh xe + 🎉 lời chúc; ⭐ nằm ngoài dải ký tự mà static-scan đếm) | 1 lỗi (`no-raw-color` rgba) → exit 0 | `Box, Text, Button` → không còn |
| `components/community/rank-badge.tsx` | 1 → 0 | 0 → 0 | 5 → 5 (4 emoji hạng 🌱🌿🌳🏆 + 1 trong chú thích) | exit 0 → exit 0 | `Text` → không còn |

Tổng gói (29 file: `pages/game.tsx`, `pages/loyalty.tsx`, `components/wheel.tsx`, `components/community/rank-badge.tsx`, 25 file `components/game/**`): legacy 0, hex 0, emoji 76 (đều là nội dung game/hạng/lời chúc, mỗi file có danh sách cho phép riêng trong `ALLOWED_EMOJI`). Baseline đầu gói: game 163 legacy / 90 emoji, loyalty 151 / 15, wheel 13, ESLint game 3 + loyalty 5 + wheel 1.

### Đã làm

- `wheel.tsx`: `Box/Text/Button` ZaUI → `div` + `Text`/`Button` của `components/ui`; màu bánh xe, kim, trục giữa → token v2 (`--color-action-primary-bg`, `--color-action-primary-bg-pressed`, `--sage-100`/`--forest-50` cho hai màu ô xen kẽ, `--elevation-1/2`) — cùng giá trị mà alias cũ resolve ra. Hộp kết quả tự dựng (`position: fixed` + `rgba(0,0,0,0.5)`) → `BottomSheet` của DS (luôn dựng, điều khiển bằng `open`; `prize` giữ nội dung để hoạt ảnh đóng 200ms không trống). Nút quay dùng `Button` 48px, vẫn `loading` + `disabled` cùng `spinning` như cũ. Bánh xe/kim/trục là trang trí nên thêm `aria-hidden`.
- `rank-badge.tsx`: `Text` ZaUI → `Text` DS (`caption`, tone `brand`, đậm 600). `levelEmoji`/`levelName` và điều kiện ẩn hạng ≤ 1 giữ nguyên.
- Giữ nguyên: lời gọi `onSpin` (đúng 1 lần mỗi lượt, khoá `lockRef`), thời lượng quay 3,6s, quay tối thiểu 5 vòng và chọn ô ngẫu nhiên chỉ để trình diễn, kết quả chỉ hiện khi cả backend lẫn hiệu ứng xong, dòng "+N Điểm Xanh đã vào tài khoản" chỉ khi `rewardType === 'POINTS' && value > 0`, haptic `medium` hai lần, chữ "Quay ngay (N Điểm Xanh)" / "Đang quay..." / "Chúc mừng!" / "Tuyệt vời!". Không thêm gì liên quan mua giọt nước bằng xu (Q-02), không thêm "TubuXu".

### Test (đỏ → xanh)

- `components/wheel.spec.tsx` (MỚI, 14 test đặc tả) và `components/community/rank-badge.spec.tsx` (MỚI, 11 test): viết và chạy XANH trên bản cũ trước (commit `581a4aa`), vẫn xanh sau khi di cư. Kiểm răng của spec vòng quay bằng 5 đột biến trên `wheel.tsx` cũ (bỏ `lockRef`, bỏ điều kiện `value > 0`, bỏ chờ 3,6s, bỏ `disabled`, bỏ nhả `lockRef`): đột biến bỏ `lockRef` ban đầu KHÔNG bị bắt (React kịp khoá nút giữa hai cú chạm tuần tự) nên thêm test "hai cú chạm trong cùng một khung hình" (hai `click()` trong một `act`), sau đó cả 5 đột biến đều làm ít nhất 1 test ĐỎ; đã khôi phục file nguyên trạng và `diff` xác nhận.
- `ds-c076-pc10a.spec.ts`: thêm `wheel.tsx` vào `FILES_PC10A` trước khi sửa: 3 test ĐỎ (legacy, màu thô, import `Box/Text/Button`); sau di cư xanh. Thêm `rank-badge.tsx` trước khi sửa: 2 test ĐỎ (legacy `--leaf-700`, import `Text` ZaUI); sau di cư xanh. Tổng guard 131/131. Kiểm "chỉ lấy khung trang từ zmp-ui" mở rộng sang hai file này; emoji cho phép của vòng quay là `🌿 🎁 💧 🪴 🏷 💚 🍀 🎉`, của badge là `🌱 🌿 🌳 🏆`.

### Lệnh kiểm chứng (output thật)

```
$ npx eslint src/pages/game.tsx src/pages/loyalty.tsx src/components/wheel.tsx src/components/community/rank-badge.tsx \
    src/components/game src/components/wheel.spec.tsx src/components/community/rank-badge.spec.tsx src/ds-c076-pc10a.spec.ts \
    src/pages/game-layout.spec.tsx src/pages/game-behavior.spec.tsx src/pages/loyalty-behavior.spec.tsx src/pages/loyalty-layout.spec.tsx
exit 0, không output
$ npx tsc --noEmit
exit 0, không output
$ node scripts/uiux/static-scan.mjs ... (legacy hex emoji file)
0 0 8 apps/miniapp/src/components/wheel.tsx
0 0 5 apps/miniapp/src/components/community/rank-badge.tsx
0 0 1 apps/miniapp/src/pages/game.tsx
0 0 8 apps/miniapp/src/pages/loyalty.tsx
(29 file của gói: legacy 0, hex 0, emoji 76)
$ node scripts/check-undefined-css-vars.mjs
OK — every var(--x) reference is defined.
$ npx vitest run src/components/wheel.spec.tsx src/components/community/rank-badge.spec.tsx src/ds-c076-pc10a.spec.ts \
    src/ds-legacy-vars-4a.spec.ts src/ds-legacy-vars-4b.spec.ts src/ds-legacy-alias-contrast.spec.ts src/components/ui/button-guard.spec.ts \
    src/components/ui/hit-target-guard.spec.tsx src/i18n/terminology.spec.ts src/pages/format-guard.spec.ts src/pages/game-layout.spec.tsx \
    src/pages/game-behavior.spec.tsx src/pages/game-numbers.spec.tsx src/pages/loyalty-behavior.spec.tsx src/pages/loyalty-layout.spec.tsx src/pages/loyalty.spec.ts
 Test Files  16 passed (16)
      Tests  380 passed (380)
```

### C-113 (phần thuộc file của gói)

Không còn emoji làm icon chức năng trong 29 file của gói: icon trên nút, tiêu đề khối, trạng thái và hàng lối tắt đều dùng `Icon` Lucide; guard `ALLOWED_EMOJI` chặn quay lại. Các file C-113 còn lại ngoài gói (`onboarding.tsx`, `reviews-section.tsx`, `post-card.tsx` với `KIND_LABEL` ❓🌿💡 và avatar 🌱, `bank-payment.tsx`) do gói khác xử lý.

### Giả định

1. Nút quay trước đây nền `--clay-500` (cam đất) tự gán trên nút ZaUI. DS `Button` không có biến thể màu đó (`flash` là terracotta-600 dành cho flash sale), nên dùng `primary` (forest) cỡ `lg`: đổi nhận diện màu nút, không đổi hành vi.
2. Kim chỉ trước đây có `filter: drop-shadow(0 2px 2px rgba(0,0,0,.2))`. `drop-shadow` không nhận token `--elevation-*` (là box-shadow) và không được có rgba thô, nên bỏ bóng của riêng kim chỉ (bánh xe và trục giữa vẫn có bóng bằng token). Không tạo `css/wheel.css` vì `check-undefined-css-vars.mjs` chỉ đọc 3 file định nghĩa cố định (xem mục 1/4).
3. Hộp kết quả giữa màn hình → bottom sheet (DS không có modal giữa màn hình; `Dialog = BottomSheet`), có thêm nút "Đóng" (X) của sheet; chạm vùng mờ vẫn đóng như cũ. Thay đổi trình bày, không đổi luồng: vẫn phải qua "Tuyệt vời!" hoặc đóng mới quay tiếp được.
4. `RankBadge`: ZaUI `xSmall bold` (13px, đậm 500) → `caption` 13px đậm 600; màu `--leaf-700` (sage-700) → tone `brand` (forest-600) theo ngữ nghĩa DS, như quyết định ở mục 3/4. Cạnh nhãn "🌿 Chuyên gia" ở `post-card.tsx`/`post-detail.tsx` (chưa di cư) sẽ lệch sắc rất nhẹ cho tới khi hai trang đó chuyển sang `Text tone="brand"`.
5. Bánh xe, kim, trục giữa gắn `aria-hidden`: 8 ô chỉ là minh hoạ (phần thưởng thật do backend trả), đọc emoji lần lượt chỉ gây nhiễu cho trình đọc màn hình.

### Việc còn lại

- CHƯA kiểm bằng mắt trên trình duyệt/Zalo (không chạy dev server/Playwright theo quy định máy): bánh xe 240px trong thẻ GameCard ở 390px, hoạt ảnh quay, bottom sheet kết quả đè lên nút quay, độ tương phản chữ "QUAY" trắng trên forest-600. Ghi "unverified" cho phần hình ảnh của toàn gói.
- Ghi từ mục 2/4 và 3/4, giữ nguyên: các nút ở trang Vườn không có khoá đồng bộ kiểu `busyRef`/`lockRef` (vòng quay thì có), cần quyết định của điều phối viên và review opus vì đụng nhánh giọt nước/điểm.

### Đề xuất cho điều phối viên

1. Gói đụng tiền/điểm: `use-game-actions.ts`, các nút tưới/điểm danh/thu hoạch và vòng quay (trừ Điểm Xanh) nên qua review độc lập opus hai lượt theo quy tắc cứng; diff trình bày của gói không đổi API, nhưng bộ test đặc tả (`game-behavior` 71 test, `loyalty-behavior` 20, `wheel` 14) là bằng chứng chính, nên cho reviewer đọc cùng.
2. Nên kiểm bằng mắt một lượt trên thiết bị (Zalo): 2 màn đầu trang Vườn Xanh ở 390x844, thanh tab dính đầu trang, bottom sheet của vòng quay/thu hoạch/hạng thành viên (ba hộp đều đã chuyển từ lớp phủ tự dựng sang `BottomSheet`).
3. `apps/e2e/tests/loyalty.miniapp.spec.ts` cần đổi selector `.tubu-pop` (đã nêu ở mục 1/4); không có kịch bản e2e nào chạm `/game`, vòng quay hay badge hạng.
4. Đồng nhất sắc chữ "Chuyên gia" cạnh badge hạng khi di cư `post-card.tsx`/`post-detail.tsx` (xem Giả định 4).
5. Nếu thiết kế muốn giữ nút quay màu cam đất như cũ: cần thêm biến thể `accent` vào `components/ui/button.tsx` (ngoài nhóm file của gói), không nên ghi đè `style` ở trang.

## Review lượt 1

Reviewer độc lập (opus) trả 1 blocker, 2 major, 4 minor. Mỗi blocker/major được xác minh lại trên mã thật trước khi sửa; cả ba đều ĐÚNG. Test ĐỎ chạy trước khi sửa, XANH sau khi sửa.

| # | Mức | Finding | Kết quả | Commit |
|---|---|---|---|---|
| 1 | blocker | `loyalty.tsx`: "Đổi ngay" trong hộp xác nhận đọc `sheetReward` (giá trị được giữ lại cho hoạt ảnh đóng) nên vẫn gọi API khi hộp đang đóng | ĐÃ SỬA | `945f982` |
| 2 | major | `apps/e2e/tests/loyalty.miniapp.spec.ts`: 3 kịch bản chọn hộp bằng `.tubu-pop` (không còn sau di cư) | ĐÃ SỬA (chưa chạy Playwright: unverified) | `6216ec2` |
| 3 | major | `game.tsx`: thanh tab nội bộ `sticky; top: 0` nằm dưới status bar/capsule Zalo | ĐÃ SỬA | `81e27a9` |
| 4 | minor | `harvest-celebration.tsx`: ô mã `role="button"` không có phím Enter/Space | ĐÃ SỬA | `3510b5d` |
| 5 | minor | guard emoji bỏ sót ⭐ ⬆ ⬇ ↩ | ĐÃ SỬA | `e8505d5` |
| 6 | minor | `missions-card.tsx`: thanh tiến độ mất màu theo trạng thái đạt | KHÔNG SỬA (chủ ý, ghi nhận) | không |
| 7 | minor | `PageHeader` `back="auto"` dựng thêm `BackButton` trong khi `components/app.tsx` đã dựng sẵn | KHÔNG SỬA (ngoài gói, ghi nhận) | không |

### 1. Blocker: đổi quà khi hộp xác nhận đang đóng — ĐÚNG

Xác minh: `BottomSheet` (`unmountOnClose`) giữ nội dung và footer trong DOM 200ms sau khi `open` về false (`ANIMATION_DURATION = 200` trong `zmp-ui/esm/components/sheet/utils/constants.js`; `Sheet` chỉ gỡ ở `afterClose`). Trong khoảng đó `redeemMut.isPending` đã false và `busyRef.redeem` đã reset ở `onSettled`, còn nút đọc `sheetReward = useLastNonNull(confirmReward)` vẫn khác null. Bản cũ (`Modal` ZaUI) unmount ngay nên không có hai đường này.

Test thêm trong `loyalty-behavior.spec.tsx` (ĐỎ trên mã cũ, XANH sau sửa; `confirm.isConnected` được assert để test không đúng giả khi nút đã gỡ):

- "bấm Huỷ rồi chạm ngay Đổi ngay trong hộp đang đóng: không đổi quà": cũ ĐỎ `expected "spy" to not be called at all, but actually been called 1 times ["r-ok"]`.
- "đổi thành công rồi chạm lại Đổi ngay trong hộp đang đóng: vẫn chỉ gọi API 1 lần": cũ ĐỎ `expected "spy" to be called 1 times, but got 2 times`.

Sửa: nút "Đổi ngay" gọi `doRedeem(confirmReward.id)` theo `confirmReward` (state sống), cả "Huỷ" và "Đổi ngay" thêm `disabled` khi `confirmReward === null`; `sheetReward` chỉ còn dùng để vẽ nội dung. Số 22/22 test của spec xanh (20 cũ + 2 mới), các test cũ chạm đúp/Huỷ/đổi lỗi không đổi.

Cùng kiểu rủi ro ở các hộp khác của gói được rà: hộp thẻ thành viên, chúc mừng lên hạng, kết quả vòng quay, thu hoạch chỉ có nút đóng/điều hướng/chép (idempotent), không gọi API tiền/điểm, nên không cần khoá thêm.

### 2. Major: selector e2e `.tubu-pop` — ĐÚNG

Xác minh: `grep tubu-pop apps/e2e/tests/loyalty.miniapp.spec.ts` có 3 chỗ (dòng 204, 255, 272); sau di cư cả ba hộp là `BottomSheet`, class `.tubu-pop` chỉ còn ở `tokens.css` và `checkout/order-success.tsx`. Chữ `'-50 Xanh'` đã lệch từ trước gói (bản cũ vẽ `-{formatPoints()} Xanh` = "-50 điểm Xanh").

Sửa tối thiểu trong file ngoài nhóm file của gói (lý do: chính gói làm hỏng ba kịch bản, đúng mẫu `returns-reversal.miniapp.spec.ts` đã dùng): đổi `page.locator('.tubu-pop')` thành `page.locator('.zaui-sheet')` (cùng `filter({ hasText })`), và `'-50 Xanh'` thành `'-50 điểm Xanh'`. Kiểm bằng jsdom (probe tạm, đã xoá): mở hộp xác nhận thì có đúng 1 `.zaui-sheet` chứa "Xác nhận đổi ưu đãi" và "-500 điểm Xanh", gồm các nút đóng, "Huỷ", "Đổi ngay" nên `modal.getByRole('button', { name: 'Đổi ngay' })` chỉ khớp một nút. `npx tsc --noEmit` trong `apps/e2e` exit 0. CHƯA chạy Playwright (quy định máy): unverified, điều phối viên chạy khi làm T1-T5.

### 3. Major: thanh tab dính dưới status bar — ĐÚNG

Xác minh: `game.tsx` không dùng `className="page"` (quy tắc `.page { padding-top: var(--safe-top) }` trong `tokens.css`), chỉ `PageHeader` đệm `safe-top` và khối đó cuộn đi, nên `top: 0` dính sát mép màn hình. Test thêm trong `game-layout.spec.tsx`: "thanh tab dính đầu trang chừa safe-top, không dính mép 0" (ĐỎ `expected '0px' to contain 'var(--safe-top)'`, XANH sau sửa). Sửa: `top: 'var(--safe-top)'`. Phần lọt giữa mép 0 và safe-top là vùng status bar, nội dung cuộn dưới đó giống mọi trang immersive khác của app. Kiểm bằng mắt ở 390x844 và trên Zalo thật vẫn là unverified, cần làm ở bước T.

### 4. Minor: ô mã giảm giá bàn phím — ĐÃ SỬA

Dùng `rowKeyboardProps()` có sẵn (`components/ui/row-keyboard.ts`: `tabIndex 0` + Enter/Space gọi lại `click()`), giữ nguyên DOM và handler chép. Test "ô mã giảm giá là nút bàn phím được: Enter và Space chép mã như chạm" trong `game-behavior.spec.tsx` ĐỎ (`expected "spy" to be called 1 times, but got 0 times`) rồi XANH; phím khác (`a`) không chép.

### 5. Minor: guard emoji — ĐÃ SỬA

`EMOJI` thành hợp của hai dải cũ (giữ ✓ ✗ vì chúng không thuộc `Extended_Pictographic`), `\p{Extended_Pictographic}` và khối `U+2B00-2BFF`. Không dùng cả dải mũi tên `U+2190-21FF` như gợi ý vì sẽ bắt dấu "→" làm dấu câu trong lời văn (`game.tsx`, `loyalty.tsx` đang có); ⬆ ⬇ ↩ vẫn bị bắt qua `Extended_Pictographic`. Thêm ca tự kiểm (`⭐ ⬆ ↩` bị bắt, `→ · ×` không). Quét 29 file của gói bằng bộ so khớp mới: chỉ thêm `⭐` ở `wheel.tsx` (ô minh hoạ trên bánh xe, là nội dung), nên đã thêm vào `ALLOWED_EMOJI` của file đó. Trước khi thêm vào danh sách cho phép: ĐỎ `expected [ '⭐' ] to deeply equal []`; sau: 132/132 xanh.

### 6. Minor: màu thanh tiến độ nhiệm vụ — KHÔNG SỬA

`components/ui/progress-bar.tsx` chỉ có `tone: 'brand' | 'flash'`; `flash` là terracotta của flash sale, không hợp nghĩa "đã đạt", và `components/ui/**` ngoài nhóm file của gói. Chấp nhận đổi trình bày có chủ đích: thanh tiến độ nhiệm vụ một màu; trạng thái "đã đạt, chờ nhận thưởng" vẫn thể hiện bằng số `progress/goal` đầy và nút "Nhận thưởng" hiện đúng điều kiện `canClaim` (không đổi). Đề xuất cho điều phối viên: thêm `tone="success"` vào `ProgressBar` nếu thiết kế muốn giữ tín hiệu màu.

### 7. Minor: hai nút "Quay lại" — XÁC NHẬN, NGOÀI GÓI

Xác minh: `components/app.tsx:242` dựng `<BackButton />` toàn cục và `PageHeader` (`back="auto"` mặc định, `page-header.tsx:33`) dựng thêm một cái; `/loyalty` bị trùng, `/game` không (đã `back={false}`). Không đổi `back={false}` ở `loyalty.tsx` vì khi đó `PageHeader` bỏ khoảng chừa 48px và nút nổi toàn cục đè lên tiêu đề. Cùng mẫu ở cart/checkout/orders; thuộc đợt sửa `PageHeader`/`BackButton` (chỉ giữ một nguồn), ghi nhận cho điều phối viên.

### Lệnh kiểm chứng sau sửa (output thật)

```
$ npx eslint (29 file của gói + 7 spec)           exit 0, không output
$ npx tsc --noEmit  (apps/miniapp)                exit 0
$ npx tsc --noEmit  (apps/e2e)                    exit 0
$ node scripts/check-undefined-css-vars.mjs       OK — every var(--x) reference is defined.
$ static-scan (legacy hex emoji file)
0 0 5 apps/miniapp/src/components/community/rank-badge.tsx
0 0 8 apps/miniapp/src/components/wheel.tsx
0 0 1 apps/miniapp/src/pages/game.tsx
0 0 8 apps/miniapp/src/pages/loyalty.tsx
$ npx vitest run <16 spec liên quan>
 Test Files  16 passed (16)
      Tests  385 passed (385)
```

(Trước lượt review: 380; thêm 5 = 2 loyalty + 1 game-layout + 1 game-behavior + 1 guard tự kiểm.)

### Việc còn lại

- Bước T (điều phối viên): chạy Playwright `loyalty.miniapp.spec.ts` để xác nhận selector `.zaui-sheet`; kiểm bằng mắt ở 390x844 và trên Zalo thanh tab dính dưới safe-top, hai màn đầu trang Vườn Xanh.

## Review lượt 2

Reviewer độc lập (opus) trả 1 major và 4 minor. Major được xác minh lại trên mã thật trước khi sửa: ĐÚNG. Test ĐỎ chạy trước khi sửa, XANH sau khi sửa.

| # | Mức | Finding | Kết quả | Commit |
|---|---|---|---|---|
| 1 | major | Hộp kết quả vòng quay nằm trong tab "Hôm nay" (display:none khi sang tab khác) | ĐÃ SỬA | `1a1112f5` |
| 2 | minor | `ProgressBar` nhiệm vụ mất phân biệt màu đạt/chưa đạt | KHÔNG SỬA (nhắc lại lượt 1 mục 6) | không |
| 3 | minor | `SegmentedTabs` thiếu `id`/`aria-controls` nối với `tabpanel`, không có phím mũi tên | KHÔNG SỬA (ngoài gói, đề xuất DS) | không |
| 4 | minor | Danh sách `GAME_FILES` của guard viết tay | ĐÃ SỬA | `1a1112f5` |
| 5 | minor | e2e `loyalty.miniapp.spec.ts` chưa chạy Playwright | KHÔNG CHẠY ĐƯỢC (quy định máy), vẫn unverified | không |

### 1. Major: hộp kết quả vòng quay trong tab ẩn — ĐÚNG

Xác minh trên `zmp-ui@1.11.14` thật (đọc mã, không suy đoán):

- `esm/components/sheet/sheet.js` dựng `<div class="zaui-sheet">` ngay tại chỗ (Mask + ModalWrapper + Content), không có `createPortal` trong `esm/components/sheet` và `esm/common/modal-wrapper` (`grep createPortal` trong `esm/` chỉ khớp `components/portal`, không được Sheet dùng).
- `esm/common/modal-wrapper/index.js` bật `document.querySelector('.zaui-page').classList.add('disable-scrolling')` khi `visible` và chỉ gỡ khi `visible` về false; CSS `.zaui-page.disable-scrolling{overflow:hidden}`.
- Lượt quay mất `SPIN_MS = 3600` ms; hộp mở lúc quay xong. Từ lúc có tab (C-082), `LuckyWheelCard` nằm trong `GameTabPanel tab="today"` (`display:none` khi không chọn), nên đổi sang "Vườn"/"Cộng đồng" giữa chừng thì hộp mở trong khối ẩn: phần thưởng không thấy, trang kẹt khoá cuộn tới khi quay lại tab Hôm nay. Hồi quy do C-082 gây ra; lời gọi `spin()` không đổi.
- Rà các khối tab khác: `components/game` chỉ có `harvest-celebration.tsx` (đã ở cấp trang) dùng `BottomSheet`; không khối nào khác mở hộp bất đồng bộ trong tab.

Test thêm `pages/game-wheel-tabs.spec.tsx` (6 test, dùng vòng quay THẬT, `Page` giả có class `zaui-page`, timer giả):

- ĐỎ trên mã cũ: "đổi sang tab Vườn trong lúc quay: hộp kết quả vẫn nhìn thấy được" và bản "Cộng đồng" (`expect(element).toBeVisible()` — `Received element is not visible: <h2>`); "đổi tab rồi đóng hộp: trang hết khoá cuộn" cũng ĐỎ (không tìm thấy nút "Tuyệt vời!" trong khối ẩn). 3 test còn lại (ở lại tab Hôm nay, quay lần hai, quay lỗi) xanh cả trước lẫn sau: đóng vai test đặc tả để chứng minh hành vi cũ giữ nguyên.
- XANH sau sửa (6/6).

Sửa (chọn "nâng lên cấp trang" như `HarvestCelebration`, không dùng portal vì app chưa có tiền lệ portal và vị trí z-index/theme của sheet trong `body` chưa kiểm được trên máy thật):

- `components/game/wheel-prize-sheet.tsx` (mới): `WheelPrizeSheet({ prize, open, onClose })`, nội dung hộp y nguyên bản cũ (🎉, tên quà, dòng "+N Điểm Xanh đã vào tài khoản" chỉ khi `POINTS` và `value > 0`).
- `components/game/use-wheel-prize.ts` (mới): giữ `prize` + `open`; `onResult(null)` đóng kết quả cũ (tương đương `setResultOpen(false)` đầu mỗi lượt quay), `onResult(prize)` mở kết quả mới.
- `components/wheel.tsx`: bỏ `BottomSheet`, thêm prop bắt buộc `onResult`; điều kiện khoá nút, `lockRef`, `SPIN_MS`, `haptic`, `Promise.all([onSpin(), timer])` giữ nguyên.
- `components/game/lucky-wheel-card.tsx` chuyển tiếp `onResult`; `pages/game.tsx` gọi `useWheelPrize()` và dựng `<WheelPrizeSheet>` cạnh `HarvestCelebration`, ngoài các `GameTabPanel`. `game.tsx` 244 dòng (guard ≤ 400 vẫn xanh).
- `components/wheel.spec.tsx`: 14 test cũ giữ nguyên chữ, chỉ đổi tên component dựng thành harness nối `Wheel` + `useWheelPrize` + `WheelPrizeSheet` đúng như trang; thêm 2 test hợp đồng `onResult` (bắt đầu quay: `null`; đủ 3,6 giây và backend xong: `prize` đúng một lần; lỗi: chỉ `null`). 16/16 xanh.
- Guard `ds-c076-pc10a.spec.ts`: file mới tự vào guard (xem mục 4); 🎉 chuyển danh sách cho phép từ `wheel.tsx` sang `wheel-prize-sheet.tsx`. Trước khi thêm cho phép: ĐỎ `expected [ '🎉' ] to deeply equal []` trên `wheel-prize-sheet.tsx`; sau: xanh.

Không đổi: lời gọi `spin()`, số Điểm Xanh hiển thị, điều kiện khoá nút quay, không thêm lại mua giọt nước bằng xu (Q-02).

### 2. Minor: màu thanh tiến độ nhiệm vụ — KHÔNG SỬA

Đã kiểm lại `components/ui/progress-bar.tsx`: `tone?: 'brand' | 'flash'`, không có tone "đạt"; `flash` là terracotta của flash sale, sai nghĩa. `components/ui/**` ngoài nhóm file của gói. Chấp nhận như đã ghi ở Review lượt 1 mục 6 (`canClaim`, số `progress/goal` và nút "Nhận thưởng" không đổi). Đề xuất cho điều phối viên: thêm `tone="success"` vào `ProgressBar`, sau đó `missions-card.tsx` truyền theo `isDone` (một dòng).

### 3. Minor: a11y tab/tabpanel — KHÔNG SỬA (ngoài gói)

`components/ui/segmented-tabs.tsx` dựng `role="tab"` không có `id`, không `aria-controls`, không xử lý phím mũi tên; `GameTabPanel` chỉ có `aria-label` (và ẩn bằng `hidden` + `display:none`). Nối `aria-controls`/`aria-labelledby` cần `SegmentedTabs` sinh `id` cho tab, nên là việc của gói DS. Tab vẫn là `button` thật cao 44px nên dùng được bằng bàn phím (Tab/Enter/Space) và trình đọc màn hình đọc được "tab, đã chọn". Đề xuất cho điều phối viên: `SegmentedTabs` nhận `idPrefix`, sinh `id="${idPrefix}-tab-${key}"` + `aria-controls="${idPrefix}-panel-${key}"` và roving tabindex + phím mũi tên; sau đó `GameTabPanel` thêm `id="${idPrefix}-panel-${tab}"` + `aria-labelledby`.

### 4. Minor: danh sách guard viết tay — ĐÃ SỬA

`ds-c076-pc10a.spec.ts`: `GAME_FILES` = hợp của danh sách ghim (`PINNED_GAME_FILES`, giữ `src/pages/game.tsx`) và `readdirSync('src/components/game')` (file `.ts/.tsx`, bỏ spec). File mới thêm vào thư mục tự bị guard legacy/hex/zmp-ui/emoji; chính hai file mới của mục 1 là ca chứng minh (ĐỎ ngay khi tạo, chưa phải sửa danh sách). Thêm test tự kiểm "danh sách guard khớp thư mục" (mọi file trong thư mục đều có trong guard, không file ghim nào đã biến mất).

### 5. Minor: e2e `loyalty.miniapp.spec.ts` — UNVERIFIED

Quy định máy cấm Playwright trong gói. Đã kiểm lại tĩnh: dòng 205, 256, 273 dùng `.zaui-sheet` (đúng cấu trúc của `BottomSheet`/ZaUI Sheet), chuỗi `'-50 điểm Xanh'` khớp `formatPoints`; không kịch bản e2e nào chạm `/game`, vòng quay hay hộp kết quả (grep `Quay ngay|Chúc mừng|vòng quay|/game` trong `apps/e2e/tests` chỉ khớp một thông báo CTV không liên quan), nên mục 1 của lượt này không ảnh hưởng e2e. Việc còn lại cho điều phối viên ở bước T: `npx playwright test loyalty.miniapp.spec.ts` (một job nặng) và ghi kết quả vào đây.

### Lệnh kiểm chứng sau sửa (output thật)

```
$ npx eslint src/pages/game.tsx src/pages/game-wheel-tabs.spec.tsx src/components/wheel.tsx src/components/wheel.spec.tsx \
    src/components/game src/ds-c076-pc10a.spec.ts                      exit 0, không output
$ npx tsc --noEmit  (apps/miniapp)                                     exit 0
$ node scripts/check-undefined-css-vars.mjs                            OK — every var(--x) reference is defined.
$ static-scan (legacy hex emoji file)
0 0 0 apps/miniapp/src/components/game/lucky-wheel-card.tsx
0 0 0 apps/miniapp/src/components/game/use-wheel-prize.ts
0 0 1 apps/miniapp/src/components/game/wheel-prize-sheet.tsx
0 0 7 apps/miniapp/src/components/wheel.tsx
0 0 1 apps/miniapp/src/pages/game.tsx
$ npx vitest run <16 spec liên quan của lượt 1> src/pages/game-wheel-tabs.spec.tsx
 Test Files  17 passed (17)
      Tests  402 passed (402)
```

(Lượt 1: 385 test, 16 file. Thêm 17 = 6 `game-wheel-tabs` + 2 hợp đồng `onResult` ở `wheel.spec` + 1 tự kiểm danh sách + 8 ca guard cho hai file mới.) `components/game/` giờ có 27 file (25 + `wheel-prize-sheet.tsx`, `use-wheel-prize.ts`); `wheel.tsx` còn 7 emoji nội dung (bánh xe).

### Việc còn lại

- Bước T (điều phối viên): Playwright `loyalty.miniapp.spec.ts`; xem bằng mắt trên Zalo: bấm "Quay ngay", sang tab Vườn trước khi hết 3,6 giây, hộp "Chúc mừng!" phải hiện trên tab Vườn và đóng được.
- Hộp kết quả vòng quay và hộp thu hoạch cùng là `BottomSheet` ở cấp trang; nếu cả hai cùng mở (thu hoạch xảy ra khi tưới, không xảy ra khi đang quay vì nút tưới nằm sau lớp phủ của hộp) thì chồng nhau, chưa có kịch bản thực tế.
