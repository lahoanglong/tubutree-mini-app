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
| static-scan `components/game/**` legacy / hex / emoji | 152 / 0 / 83 | 0 / 0 / 54 (26 file, mọi file legacy 0, hex 0) |
| ESLint `pages/game.tsx` + `components/game` + spec | exit 0 | exit 0, không cảnh báo |
| import ZaUI trong `components/game/**` | `Box, Text, Button` (22 file) | chỉ `useSnackbar` (hộp thu hoạch) |
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

- `ds-c076-pc10a.spec.ts`: thêm 26 file game vào `FILES_PC10A` trước khi sửa: 64 test ĐỎ (legacy, màu thô, ZaUI, emoji); sau di cư 123/123 xanh. Thêm kiểm "không import ZaUI ngoài `useSnackbar`/khung trang" cho `components/game/**`. Commit theo 4 nhóm file, mỗi nhóm thêm file vào guard rồi mới di cư.
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
0 0 3 apps/miniapp/src/components/game/checkin-streak.tsx   (26 file components/game: legacy 0, hex 0)
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
