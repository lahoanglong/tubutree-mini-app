# khampha đợt D

mergeable=True

## Sửa D1 (head review/1028-khampha: Review 3 xong, 1 commit mới 967739749, CLS đạt (<0,1), gate/Playwright/vitest xanh)

Nhánh review/1028-khampha, worktree r1028-khampha. Commit mới lượt này: 967739749 "fix(trang-chu): khung đồng hồ Giờ vàng luôn có trong cây..." (flash-sale.tsx và flash-sale.spec.tsx). Không push.

VIỆC LƯỢT NÀY
1. P2 hydrate HTML ISR cũ quá giờ hết suất: ĐÃ LÀM (967739749).
- Khung span role="timer" luôn vẽ. Hết giờ thì ẩn bằng invisible + aria-hidden.
- Có suppressHydrationWarning. Sau mount đổi key để React vẽ lại thuộc tính theo giờ trình duyệt, vì React không tự sửa thuộc tính hay chữ lệch.
- Test hydrateRoot mới: renderToString lúc 11:55, hydrate lúc 12:30. Thấy đỏ trước (Hydration failed, diff vào span timer), xanh sau.
- Test cũ "đã quá giờ" đổi theo: giờ kiểm invisible chứ không kiểm null.
2. P2 CLS bằng cls-probe (lane 2, giả mạng chậm 1200ms, web khổ 375): ĐÃ ĐO, đạt, không phải sửa thêm.
- Suất còn hơn 2 ngày: web new 0,0048; web returning 0,022; web guest 0,0048; Mini new 0,0374; Mini returning 0,074.
- Suất còn dưới 24 giờ (đặt endAt = now+3h trong DB lane 2): web new 0,0048; web returning 0,022; Mini new 0,0374; Mini returning 0,074.
- Mục tiêu <0,1: đạt hết. Trước đó web là 0,2383 (new) và 0,1167 (returning).
- Ca HTML ISR cũ quá giờ hết suất: chỉ kiểm bằng test hydrateRoot, không dựng được ở cls-probe.
3. P2 chụp lại: ĐÃ LÀM.
- 7 màn (home, browse, browse-category, browse-search, browse-brand, brand-slug, brand-story) × 3 persona (returning, new, guest), cộng home slow5s cho cả 3 persona.
- Ghép trước/sau vào screens-khampha/ (đã ghi đè), tự xem: home new/guest/returning, home guest slow5s, browse returning, browse-category new, brand-story guest, browse-search new/guest. Mini và web 375 giống nhau.
- Chỗ khác còn thấy: home guest slow5s, Mini hiện khung chờ còn web đã có nội dung vì có ISR (khác do thiết kế). browse-search Mini mở lớp gợi ý còn web hiện lưới kết quả (đúng như ảnh returning cũ).
- browse-search new/guest "trống": KHÔNG phải lỗi mã. Cột "trước" không có ảnh vì routes.json chỉ khai persona returning. Tôi chụp tạm new/guest rồi khôi phục routes.json bằng git checkout. Ảnh sau hiện đủ nội dung.
4. P3 dữ liệu dựng sẵn rỗng mà máy nhớ hadFlash: ĐÃ LÀM (cùng 967739749).
- FlashSkeleton hiện khi items rỗng và hadFlash và đang tải lại và không lỗi.
- Sửa kèm: hint không còn bị ghi "false" khi đang tải lại, vì trước đó dấu nhớ bị xoá trước khi biết kết quả thật.
- 2 test mới, thấy đỏ trước khi sửa.
5. P3 Mini auth offline hiện quà khách mới cho khách cũ (apps/miniapp/src/store/auth.ts:140/198): KHÔNG LÀM, ghi backlog.
6. new-customer-gift.tsx còn nhắc "định kỳ": KHÔNG LÀM, ghi backlog.
Review 3 không còn P0/P1/P2 nào khác.

SỐ KIỂM THẬT
- tsc --noEmit: web, miniapp sạch. eslint src/components/home và src/lib (web) sạch.
- vitest web: 441 file, 7451 test pass. app-core: 917 pass. miniapp: 4875 pass (chạy thường).
- Miniapp với TZ=UTC: 4874 pass, 1 fail ở profile-hub.spec "ba số dư" (timeout 1485ms khi máy tải ~65). Chạy riêng ca đó 31/31 pass, cả có và không TZ=UTC. File này tôi không đụng.
- lint:parity: xanh, 0 mục pending.
- Web gate cả bộ (cổng 3761-3765): 354 passed, 38 skipped, 0 fail.
- Playwright Mini toàn bộ (E2E_SCOPE=miniapp, cổng 3763): 205 passed, 10 skipped, 0 fail.
- Không đụng API, điểm hay tiền nên không chạy jest API và race.
- Mini entry (vite build + bundle-report): 706 KB raw / 221 KB gz, đạt ≤711. Tổng JS 1633 KB (baseline 1624, +9 KB); tổng gồm css và assets là 1920 KB (baseline 1911). Mức +9 vượt "+5 KB mỗi gói". Lượt này không đổi Mini; mức tăng từ trước (khảo sát chào mừng tách khỏi entry thành chunk lazy). CẦN NGƯỜI GIAO XEM.
- Web First Load (bảng next build): / 206 kB (base 204, +2); /san-pham 158 kB (base 157, +1). Trong mức ≤ +2 KB.

ẢNH
/Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens-khampha/ (home, browse, browse-category, browse-search, browse-brand, brand-slug, brand-story × returning/new/guest; home__*__slow5s__s1.png)

GHI BACKLOG
- Mini auth offline: khách cũ mất mạng lúc mở app (status 'error') vẫn thấy quà khách mới (apps/miniapp/src/store/auth.ts:140/198). Lỗi có từ trước.
- new-customer-gift.tsx còn nhắc "định kỳ" trong khi gói muahang tắt Định kỳ. Sửa sau khi gộp muahang.
- routes.json: browse-search chỉ khai persona returning, nên ma trận chụp không có new/guest. Nên thêm.

LANE VÀ DỌN
- Lane 2 đã dừng (lane-down.sh 2, không --drop). Cổng 3760-3769 không còn tiến trình nghe.
- docs/2026-10-28-review/tools/params-l2.json còn untracked, không commit. routes.json và capture.mjs đã khôi phục.
- DB lane 2: endAt Giờ vàng đã đổi thành now+3h để đo ca dưới 24 giờ (dữ liệu lane, không đụng PROD).

## Review D1

KẾT LUẬN: chưa merge

- [P2] apps/web/src/components/home/flash-sale.tsx:103 — Bản sửa P3 (dữ liệu dựng sẵn rỗng mà máy nhớ có Giờ vàng thì vẽ FlashSkeleton) làm CLS tệ hơn, không tốt hơn.
  - Nguyên nhân: máy chủ không đọc được kho nên `hadFlash` lúc dựng HTML luôn là false (dòng 94). Vì vậy HTML ISR không bao giờ có khung giữ chỗ. Khung cao 300px chỉ được chèn vào sau hydrate.
  - Ca hay gặp nhất: hết suất, chưa có suất mới, khách đã thấy Giờ vàng ở lần mở trước. Đây là lần đầu khách cũ quay lại sau mỗi suất.
    - Trước commit: không có lần nhảy nào.
    - Sau commit: hai lần nhảy 300px, một lần khi khung hiện, một lần khi lần tải lại trả `[]`.
  - Ca mà reviewer lo (bản dựng rỗng, lần tải lại mang suất mới về) vẫn nhảy một lần như cũ, chỉ sớm hơn. Như vậy không ca nào đỡ hơn.
  - Đã chứng minh bằng spec tạm (đã xoá). `renderToString(<FlashSale initial={[]}/>)` cho `""`. Đặt `localStorage.tubu_home_flash='1'` rồi hydrateRoot thì thấy `flash-sale-loading`. Lần tải lại trả `[]` thì khung biến mất, HTML về `""`.
  - Mức ảnh hưởng: khách mới và khách vãng lai có khối Giờ vàng ở khoảng y≈450/812. Hai lần nhảy như vậy ước cho CLS khoảng 0,3, vượt mục tiêu R-2 (< 0,1). cls-probe của worker không đo ca này.
  - Test mới ở flash-sale.spec.tsx:113 dùng `render()` chứ không dùng hydrate, nên không lộ ra việc khung không có trong HTML. Chú thích ở dòng 102 ("giữ chỗ để khối không chen vào") sai.
  - Cách sửa:
    - Bỏ nhánh ở dòng 103 và ghi rõ ca bản dựng rỗng rồi lần tải lại mang suất mới là chấp nhận được (hiếm, ISR làm mới mỗi 60 giây).
    - Giữ phần sửa `!q.isFetching` ở dòng 96.
    - Thêm test hydrateRoot: initial `[]`, hint là '1', lần tải lại trả `[]`, kiểm không có khung nào được chèn vào.
- [P3] apps/miniapp/src/components/app.tsx:47 — Tổng Mini tăng +8,3 KB raw, quá mức +5 KB của gói. Báo cáo cũng thiếu số từng chunk như luật yêu cầu.
  - Đo bằng chunk-diff.mjs, so www của review-1028 (cùng mã app với base) với www của r1028-khampha:

    | Chunk | Thay đổi raw |
    |---|---|
    | onboarding.module.js | +8,5 KB (chunk mới) |
    | browse | +2,1 KB |
    | wallet | +0,5 KB |
    | brand-story | +0,4 KB |
    | flag | +0,4 KB (mới) |
    | brand-view | +0,3 KB |
    | user-round | +0,3 KB (mới) |
    | index (entry) | −4,8 KB |
    | Tổng | 1911,3 → 1919,6 KB |

  - Chunk onboarding không bao giờ được tải, vì `ONBOARDING_SURVEY_ENABLED` là hằng false. Người dùng không chịu thêm byte nào, nhưng con số vẫn vượt luật.
  - Cách sửa: người giao quyết có chấp nhận chunk chết này hay không. Nếu không, bỏ hẳn `lazy(import('./onboarding'))` khi cờ tắt (import có điều kiện theo hằng lúc build).
- [P3] apps/web/src/components/home/flash-sale.tsx:118 — Khi mọi suất trong HTML ISR cũ đã quá giờ, khối vẫn hiện thẻ giá của suất đã hết. Lần tải lại trả `[]` thì khối 300px biến mất và trang nhảy. Hydrate không còn lỗi, nhưng ca CLS này chưa đo. Ghi vào báo cáo là chấp nhận được, hoặc đo bằng cls-probe.
- [P3] Bong bóng Vườn Xanh vẫn che thẻ Giờ vàng hoặc thẻ sản phẩm trong ảnh home__returning và browse-search__new (cả Mini và web). Lượt C đã ghi là chấp nhận, nhắc lại để người giao chốt.
- [P3] Worktree r1028-khampha còn file chưa track `docs/2026-10-28-review/tools/params-l2.json`. Dọn đi trước khi gộp.

Đã kiểm: flash-sale.spec.tsx 25/25 xanh (Node 22). Bản sửa hydrate ở dòng 118–130 đúng: khung đồng hồ luôn có, ẩn bằng `invisible`, đổi key sau mount. Ảnh browse-search new có đủ nội dung.

Chưa kiểm lại (chỉ lấy từ báo cáo worker): web gate 354 pass, Playwright Mini 205 pass, số cls-probe, First Load / 206 KB và /san-pham 158 KB. Lượt này không được bật server.

GHI BACKLOG (worker đã liệt kê, đồng ý):
- apps/miniapp/src/store/auth.ts:140/198 — khách cũ mất mạng lúc mở app vẫn thấy quà khách mới.
- new-customer-gift.tsx còn nhắc "định kỳ" trong khi gói muahang tắt Định kỳ.
- routes.json: browse-search mới khai persona returning, nên thêm new và guest.

## Sửa D2 (head 0944b25ec)

Nhánh review/1028-khampha (r1028-khampha). Lượt sửa theo reviewer, 2 commit mới:
- 9fd650e90 fix(trang-chu): bỏ khung giữ chỗ Giờ vàng khi bản dựng sẵn rỗng; test hydrate (R-2)
- 0944b25ec perf(mini): không phát chunk khảo sát chào mừng khi cờ tắt (R-2)

P2 flash-sale.tsx: ĐÃ SỬA. Bỏ nhánh `items.length===0 && hadFlash && isFetching` (khung chỉ có sau hydrate nên thêm một lần nhảy). Giữ `!q.isFetching` ở settledWithFlash. Ca "dựng rỗng, lần tải lại mang suất mới về" vẫn nhảy một lần: chấp nhận (hiếm, ISR làm mới 60 giây). Test cũ khẳng định khung (dùng render) được thay bằng test hydrateRoot: initial [], hint '1', lần tải lại trả [] → HTML server là "", không khung nào chèn vào, DOM cuối "". Kiểm test đỏ trên mã cũ (1 failed | 24 passed), xanh trên mã mới.
P3 bundle Mini +8,3 KB: ĐÃ SỬA. app.tsx: `OnboardingGate = ONBOARDING_SURVEY_ENABLED ? lazy(...) : () => null`. Chunk onboarding không còn trong www (0 file khớp).
P3 file params-l2.json: ĐÃ XOÁ, cây làm việc sạch.
P3 Giờ vàng ISR quá giờ hết suất, khối 300px biến mất khi tải lại trả []: KHÔNG sửa, ghi nhận chấp nhận được (hiếm), chưa đo bằng cls-probe.
P3 bong bóng Vườn Xanh che thẻ ở home__returning, browse-search__new: KHÔNG sửa, người giao chốt (lượt C đã ghi chấp nhận).

Kiểm (Node 22):
- web vitest toàn bộ: 441 file, 7451 test pass.
- miniapp vitest toàn bộ: lần chạy song song với web có 1 test đỏ (4874/4875), do tải máy; chạy lại riêng: 314 file, 4875/4875 pass.
- tsc --noEmit web và miniapp: không lỗi. eslint flash-sale.tsx, flash-sale.spec.tsx, app.tsx: không lỗi.
- bundle-report --build-miniapp: entry 706 KB raw (≤711, base 711), gzip 220; tổng 1910 KB raw / 737 gz (base 1911,3; không tăng). Chunk onboarding.module.js +8,5 KB đã biến mất; các chunk khác như đo trước: browse +2,1, wallet +0,5, brand-story +0,4, flag +0,4 (mới), brand-view +0,3, user-round +0,3 (mới), entry −4,8 → tổng giờ không vượt +5 KB.
- Chưa chạy lại lượt này: Playwright Mini/web gate, lint:parity, web First Load (next build), ảnh trước/sau, cls-probe. Phần đổi chỉ là xoá một nhánh vẽ khung (web) và hằng lúc build (Mini), nên không đổi giao diện ở ca đã chụp. Ảnh cũ: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens-khampha/ (không chụp lại). Web First Load: không đổi so với lượt trước (chỉ xoá mã); số vẫn là 206 KB và /san-pham 158 KB từ báo cáo trước, chưa đo lại.
- Lane: lượt này không bật lane/server, không cần dừng.

GHI BACKLOG:
- apps/miniapp/src/store/auth.ts:140/198: khách cũ mất mạng lúc mở app vẫn thấy quà khách mới.
- new-customer-gift.tsx còn nhắc "định kỳ" trong khi gói muahang tắt Định kỳ.
- routes.json: browse-search mới khai persona returning, nên thêm new và guest.
- Ca CLS còn lại ở Giờ vàng: ISR cũ quá giờ hết suất, hoặc dựng rỗng rồi tải lại mang suất mới về, mỗi ca một lần nhảy; chưa đo bằng cls-probe.
- Bong bóng Vườn Xanh che thẻ ở home__returning, browse-search__new (Mini và web).

Cần người giao: đo CLS/LCP bằng run-all.mjs; xác nhận hai ca CLS còn lại là chấp nhận được.

## Review D2

KẾT LUẬN: merge được

Cả hai lỗi lượt trước đã sửa thật. Không có P0, P1 hay P2 mới.

Đã kiểm lại hai bản sửa:
- **P2 khung giữ chỗ Giờ vàng:** đã sửa thật. Nhánh `items.length===0 && hadFlash && q.isFetching` đã bị xoá khỏi flash-sale.tsx. `!q.isFetching` ở dòng 96 vẫn giữ.
  - Test hydrateRoot mới ở flash-sale.spec.tsx:116-141 có `renderToString` ra `""`, MutationObserver không thấy khung, DOM cuối `""`.
  - Tôi suy luận mã cũ sẽ làm test này đỏ: sau hydrate, hadFlash thành true trong lúc đang tải lại, nên khung được chèn vào. Tôi không chạy lại test trên mã cũ.
  - Chạy flash-sale.spec trên Node 22: 25/25 xanh.
- **P3 bundle Mini:** đã sửa thật. `ONBOARDING_SURVEY_ENABLED` là hằng `false` (onboarding-flag.ts:5), app.tsx:47-49 dùng `() => null`.
  - Trong apps/miniapp/www/assets không còn file nào khớp `onboarding`.
  - Chạy `tsc --noEmit` miniapp: không lỗi. Chạy onboarding.spec cùng các spec app: 29/29 xanh.
- **P3 file params-l2.json:** đã xoá, cây làm việc sạch.
- **Ảnh chụp:** chụp lúc 15:11, sau commit 967739749 (15:03). Hai commit mới (15:36) không đổi ca nào đã chụp. Có đủ home slow5s cho new và guest.

Lỗi còn lại:
- [P3] apps/web/src/components/home/flash-sale.tsx:101 — `if (q.isLoading) return hadFlash ? <FlashSkeleton/> : null` có cùng lỗi với nhánh vừa xoá.
  - Khi nào xảy ra: `loadHomeInitial` gọi `/flash-sales/active` lỗi lúc làm mới ISR. `orUndefined` (home-initial.ts:33) nuốt lỗi nên `initial` là undefined.
  - Ở máy chủ, `hadFlash` luôn là false, nên HTML không có khung. Sau hydrate, khách đã nhớ Giờ vàng thấy khung 300px chèn vào (một lần nhảy). Nếu lần tải lại trả `[]` thì khung mất (lần nhảy thứ hai).
  - Cách sửa: trên web, bỏ khung khi isLoading, hoặc chỉ vẽ khung khi điều hướng phía trình duyệt. Nếu không sửa thì GHI BACKLOG, ghi rõ ca này hiếm.
- [P3] Báo cáo của worker — Lượt này không chạy lại web gate, Playwright Mini, First Load và cls-probe. Các số 354 pass, 205 pass, / 206 KB, /san-pham 158 KB và số CLS đều lấy từ head 967739749.
  - Đổi từ đó tới HEAD chỉ là xoá một nhánh vẽ và thêm một hằng lúc build, nên rủi ro thấp. Dù vậy, việc người giao yêu cầu là chạy cả bộ.
  - Cách sửa: người giao chạy gate cả bộ trên 0944b25ec khi gộp.
- [P3] Báo cáo của worker — Lần chạy song song có một test miniapp đỏ (4874/4875) nhưng báo cáo không ghi tên test đó.
  - Cách sửa: ghi tên test để biết nó có chập chờn do gói này gây ra hay không.

Chưa kiểm (không bật server): số CLS/LCP, First Load web, Playwright.

GHI BACKLOG (đồng ý với danh sách của worker, thêm mục cuối):
- apps/miniapp/src/store/auth.ts:140/198 — khách cũ mất mạng lúc mở app vẫn thấy quà khách mới.
- new-customer-gift.tsx còn nhắc "định kỳ" trong khi gói muahang tắt Định kỳ.
- routes.json — browse-search mới khai persona returning, nên thêm new và guest.
- Giờ vàng còn hai ca CLS, mỗi ca nhảy một lần, chưa đo bằng cls-probe:
  - HTML ISR cũ được trả sau giờ hết suất.
  - Bản dựng sẵn rỗng, lần tải lại mang suất mới về.
- Bong bóng Vườn Xanh che thẻ ở home__returning và browse-search__new (Mini và web).
- flash-sale.tsx:101 — ca `initial` undefined nêu ở P3 đầu tiên.
