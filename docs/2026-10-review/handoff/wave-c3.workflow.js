export const meta = {
  name: 'tubutree-2026-10-wave-c3',
  description: 'Đợt C vòng C3: PC-10a/b/c1/c2/c3 (C-076 di cư miniapp sang DS v2, C-082, C-079, C-113, Q-17) + PC-11 (admin web DS v2); worktree cố định hz7-*, từng mục một agent, review opus độc lập',
  phases: [
    { title: 'Implement', detail: 'mỗi mục một agent trong worktree hz7-PC-N, commit từng trang' },
    { title: 'Review', detail: 'reviewer opus độc lập chỉ đọc diff, chạy lại lệnh đo' },
    { title: 'Fix', detail: 'sửa theo review, review lượt 2 nếu còn blocker/major' },
  ],
}

function sem(max) {
  let active = 0
  const waiters = []
  return {
    async acquire() { if (active < max) { active++; return } await new Promise(r => waiters.push(r)) },
    release() { const w = waiters.shift(); if (w) w(); else active-- },
  }
}
const TOTAL = sem(3)
async function run(prompt, opts) {
  await TOTAL.acquire()
  try { return await agent(prompt, opts) } finally { TOTAL.release() }
}

const BASE = args.base
const REPO = args.repo
const NODEBIN = args.nodebin
const WT = (id) => REPO + '/.claude/worktrees/hz7-' + id
const BR = (id) => 'hz7/' + id

const COMMON_MINI = `QUY TẮC DI CƯ DS v2 (miniapp):
- Tài liệu: docs/superpowers/specs/2026-09-28-design-system-v2-design.md (spec), docs/superpowers/plans/2026-09-28-design-system-v2.md và 2026-09-28-design-system-v2-followups.md, docs/2026-10-review/impl/PC-1.md + PC-3.md (cách đã di cư), 04-uiux.md (A4-002, A4-010, A4-020, A4-031, A4-039). Trang mẫu đã sạch (legacy=0): apps/miniapp/src/pages/{home,browse,cart,checkout,orders}.tsx và components/ui/**. Token: apps/miniapp/src/css/tokens.css (khối "LEGACY v1 → v2 ALIAS" là danh sách tên CẤM dùng, kèm bảng map sang v2) và packages/design-tokens/src/tokens.css (token v2: --color-*, --radius-card/control/media/pill, --elevation-*, --font-ui, --stone-*/--forest-*/--sage-*/--honey-*/--clay-*).
- Mỗi file thuộc gói phải đạt: (1) npx eslint <file> trong apps/miniapp exit 0 và KHÔNG cảnh báo (kể cả consistent-type-imports: dùng --fix); (2) static-scan: legacy=0, hex=0; (3) không còn import ZaUI bị no-restricted-imports cấm (thay bằng component trong components/ui); (4) mỗi TRANG có đúng một h1 (PageHeader hoặc h1 riêng, C-114); (5) icon chức năng dùng components/ui/icon, không emoji; emoji là NỘI DUNG (game, hạng, lời chúc) thì được giữ; (6) vùng chạm >=44px (dùng Button/IconButton/ListRow của DS), không hex/rgb thô, màu bằng token semantic; (7) loading/empty/error dùng Skeleton/EmptyState; (8) HÀNH VI KHÔNG ĐỔI: không đổi lời gọi API, điều kiện, handler, số liệu hiển thị, thứ tự bước. Thấy lỗi nghiệp vụ thì ghi vào báo cáo, không trộn vào commit di cư (trừ mục được giao rõ).
- Lệnh đo (chạy ở gốc worktree; cột in ra: legacy hex emoji file): node scripts/uiux/static-scan.mjs >/dev/null && python3 -I -c "import json,sys; [print(r['legacy'],r['hex'],r['emoji'],r['file']) for r in json.load(open('scripts/uiux/results/static-scan.json'))['mini'] if any(r['file'].endswith(s) for s in sys.argv[1:])]" pages/x.tsx components/y.tsx
- Token mới/biến thể: KHÔNG sửa apps/miniapp/src/css/tokens.css, app.tsx, packages/design-tokens, components/ui/** (trừ file được nêu tên trong gói), ds-legacy-*.spec.ts. Cần token riêng của trang (màu nhận diện nhãn/dealer...): tạo apps/miniapp/src/css/<tên>.css, import từ chính trang đó, đặt tên --color-<vùng>-*, giá trị tham chiếu token v2 càng nhiều càng tốt. Cần đổi components/ui: ghi vào báo cáo mục "Đề xuất cho điều phối viên".
- TDD cho di cư: mỗi gói thêm guard spec apps/miniapp/src/ds-c076-<mã gói viết thường>.spec.ts (mẫu: src/ds-legacy-vars-4b.spec.ts, dùng cùng regex alias legacy + hex/rgb thô) liệt kê file của gói; thêm file vào danh sách TRƯỚC khi di cư (chạy thấy ĐỎ), di cư, chạy XANH, rồi commit spec + trang CÙNG MỘT commit. Thay đổi hành vi (nếu mục có) cần test vitest riêng đỏ→xanh.
- Mỗi TRANG một commit: "refactor(miniapp): di cư <trang> sang DS v2 (C-076)", dòng trống, rồi Co-Authored-By.
- Thuật ngữ Q-26: "Mã giảm giá", "Điểm Xanh", "Ví Tubu", "giọt nước"; không thêm chữ "TubuXu" mới (PD-3 sẽ gộp TubuXu vào Điểm Xanh). Trang beta.tsx và components/ui/primitives.tsx sẽ bị xoá ở PD-1: KHÔNG đụng.`

const COMMON_WEB = `QUY TẮC DI CƯ DS v2 (web):
- Tài liệu: docs/2026-10-review/impl/PC-7.md (token web, bảng map palette cũ→v2, ghi chú còn mở "nền toàn cục mới ảnh hưởng admin"), docs/2026-10-review/impl/PC-1.md (tương phản), 04-uiux.md (A4-003, A4-009, A4-027), apps/web/tailwind.config.ts + packages/design-tokens/src/tailwind-preset.ts (class có sẵn: forest-*/sage-*/stone-*/honey-*/terracotta-*, class semantic cho trạng thái, font Fraunces cho tiêu đề), trang web khách đã di cư xong để lấy mẫu (apps/web/src/app/{page.tsx,san-pham,gio-hang,thanh-toan,tai-khoan}).
- Mỗi file thuộc gói phải đạt: (1) static-scan web (node scripts/uiux/static-scan.mjs rồi đọc scripts/uiux/results/static-scan.json mục web: legacyPalette=0, neutralCls=0, greenRed=0, hex=0; lệnh in cột bằng python3 -I tương tự: [print(r['legacyPalette'],r['neutralCls'],r['greenRed'],r['hex'],r['emoji'],r['file']) for r in ...['web'] if ...]); (2) npx eslint <file> trong apps/web exit 0; (3) emoji dùng làm icon thay bằng lucide-react; (4) bố cục không tràn ngang ở 390px (bảng/hàng tab cuộn ngang TRONG khung riêng thì được; Q-29: admin tối ưu máy tính nhưng không vỡ ở mobile); (5) vùng chạm >=44px ở mobile cho nút chính; (6) HÀNH VI KHÔNG ĐỔI: không đổi lời gọi API, điều kiện, handler, số liệu, thứ tự bước, text nghiệp vụ.
- KHÔNG sửa apps/web/tailwind.config.ts, globals.css, packages/design-tokens, file ngoài nhóm gói. Thiếu token/class: dùng class DS v2 gần nhất và ghi vào báo cáo mục "Đề xuất cho điều phối viên".
- TDD cho di cư: guard spec apps/web/src/ds-palette-pc11.spec.ts quét file của gói tìm class palette cũ/stock (primary|leaf|clay|sun|neutral, green|red|amber|blue|yellow|orange|... -NNN) và hex/rgb thô; thêm file vào danh sách TRƯỚC khi di cư (ĐỎ), di cư, XANH, commit spec + file CÙNG MỘT commit.
- Mỗi trang/component lớn một commit: "refactor(web): di cư <tên> sang DS v2 (C-097/Q-25)", dòng trống, rồi Co-Authored-By.`

const PKGS = [
  {
    id: 'PC-10a', kind: 'mini', rm: 'opus', twoPass: false,
    spec: `GÓI PC-10a — Di cư game + loyalty sang DS v2 (C-076 lô 1) và C-082 chia khối trang game (+ phần C-113 thuộc file của gói).
File sở hữu (CHỈ sửa các file này, file mới trong apps/miniapp/src/components/game/ và components/loyalty/, spec tương ứng): apps/miniapp/src/pages/game.tsx, pages/loyalty.tsx, components/wheel.tsx, components/community/rank-badge.tsx, spec đi kèm của chúng.
Baseline: game.tsx legacy 163 / emoji 90, loyalty.tsx legacy 151 / emoji 15, wheel.tsx legacy 13, ESLint game 3 + loyalty 5 + wheel 1 lỗi. Mục tiêu: các file trên eslint 0, legacy 0, hex 0; emoji chỉ còn khi là nội dung game/hạng.
C-082: game.tsx dài ~1.285 dòng, ~20 khối xếp dọc không điều hướng nội bộ. Tách mỗi khối thành component trong components/game/ (props rõ ràng, trang chỉ ghép, game.tsx <= ~400 dòng), thêm điều hướng nội bộ (SegmentedTabs hoặc neo mục có cuộn) để 2 màn hình đầu (390x844) chứa hành động chính (tưới nước/thu hoạch, điểm danh, nhiệm vụ hôm nay). Điểm danh: API đang có hai lượt điểm danh (Điểm Xanh và Vườn); chủ dự án (Q-09/Q-11) giữ cả hai ở tầng dữ liệu. KHÔNG đổi logic gọi API/số liệu; chỉ trình bày để người dùng không thấy hai nút gây rối; nếu không có cách gộp UI an toàn thì giữ hai nút, nhãn rõ khác nhau, và ghi vào báo cáo.
Season Pass sẽ bị ẩn ở PD-1: di cư nguyên trạng, không thiết kế lại. "Cây thật" sẽ đổi chữ ở PD-1: giữ nguyên chữ hiện có.
TUYỆT ĐỐI không đổi hành vi tiền/điểm/giọt nước: mọi lời gọi API, điều kiện enable/disable nút, số hiển thị giữ nguyên (PA-5 vừa vá rò rỉ game; bỏ mua giọt nước bằng xu là quyết định Q-02, đừng thêm lại). Trước khi tách khối, viết test đặc tả hành vi (characterization) cho các nhánh chính của game (nút tưới/thu hoạch/điểm danh disable đúng lúc) để chứng minh tách khối không đổi hành vi.`,
    items: [
      { k: 'i1', c: 'C-076', model: 'sonnet', scope: 'Guard spec ds-c076-pc10a + di cư pages/loyalty.tsx (một trang một commit).' },
      { k: 'i2', c: 'C-082', model: 'sonnet', scope: 'C-082 bước 1: viết test đặc tả hành vi cho game.tsx rồi TÁCH KHỐI thành components/game/* (refactor thuần, chưa đổi giao diện), mỗi nhóm khối một commit, test vẫn xanh.' },
      { k: 'i3', c: 'C-076', model: 'sonnet', scope: 'C-082 bước 2 + C-076: di cư các khối game sang DS v2, thêm điều hướng nội bộ và bố cục 2 màn đầu, game.tsx đạt legacy 0/hex 0/ESLint 0.' },
      { k: 'i4', c: 'C-076', model: 'sonnet', scope: 'Di cư components/wheel.tsx và components/community/rank-badge.tsx (giữ emoji hạng) + hoàn thiện báo cáo gói (số đo trước/sau từng file, giả định, đề xuất cho điều phối viên).' },
    ],
  },
  {
    id: 'PC-10b', kind: 'mini', rm: 'opus', twoPass: false,
    spec: `GÓI PC-10b — Di cư affiliate, dealer, storefront, brand sang DS v2 (C-076 lô 2) + C-079.
File sở hữu (CHỈ sửa các file này + file mới trong components/affiliate/, css/dealer-theme.css, spec tương ứng): apps/miniapp/src/pages/{affiliate,dealer,storefront-builder,brand-story,brand-owner,brand-view}.tsx, pages/product-detail.tsx (CHỈ vùng liên kết Hành trình nguyên liệu/nhãn, khoảng dòng 285-300, và emoji của file này), components/affiliate/** (ctv-order-sheet, milestone-copy), components/content-kit-sheet.tsx, components/share-sheet.tsx, components/storefront-context-bar.tsx, utils/brands.ts, spec đi kèm.
Baseline: affiliate legacy 125 + ESLint 4; dealer legacy 125 + ESLint 10; storefront-builder legacy 88; brand-story legacy 15 + hex 102 + ESLint 13; brand-owner 19; ctv-order-sheet 37; content-kit-sheet 10; share-sheet 3; storefront-context-bar 4; brands.ts hex 17.
Dealer: tokens.css ghi chú rằng --dealer-ink/-soft/-bg giữ hex v1 vì dealer là B2B chưa có thiết kế riêng. Quyết định thiết kế cho gói này: giữ nhận diện B2B nhưng KHÔNG dùng tên alias legacy: tạo apps/miniapp/src/css/dealer-theme.css khai báo --color-dealer-ink / --color-dealer-ink-soft / --color-dealer-bg (cùng giá trị, đây là nơi DUY NHẤT được giữ hex), import từ dealer.tsx; phần còn lại của dealer dùng token v2 như mọi trang. Tương tự màu nhận diện từng nhãn trong brand-story/brands.ts: gom thành bảng dữ liệu một chỗ (utils/brands.ts hoặc css/brand-theme.css) thay vì hex rải rác, và đọc quy tắc ESLint tubu-ds/no-raw-color để biết nơi hợp lệ.
C-079: 'Hành trình nguyên liệu' ở brand-story.tsx (~dòng 539) có 2/8 nút dẫn tới danh sách rỗng vì lọc sản phẩm theo TÊN nhãn; product-detail.tsx (~292-299) có liên kết tương tự; trang nhãn mồ côi. Tra API apps/api/src/modules/catalog (tham số brand nhận slug hay tên?) và dữ liệu seed để sửa liên kết dùng đúng slug/id; test vitest đỏ→xanh cho hàm dựng URL/bộ lọc. Không sửa API trừ khi bắt buộc (ghi rõ lý do).
Hoa hồng/tiền CTV hiển thị trong affiliate và dealer (số dư, hoa hồng, công nợ, hạn mức): TUYỆT ĐỐI giữ nguyên cách tính/hiển thị và mọi lời gọi API.`,
    items: [
      { k: 'i1', c: 'C-076', model: 'sonnet', scope: 'Guard spec ds-c076-pc10b + di cư pages/affiliate.tsx và components/affiliate/** (một file một commit).' },
      { k: 'i2', c: 'C-076', model: 'sonnet', scope: 'Di cư pages/dealer.tsx (kèm css/dealer-theme.css).' },
      { k: 'i3', c: 'C-076', model: 'sonnet', scope: 'Di cư pages/storefront-builder.tsx, components/storefront-context-bar.tsx, components/content-kit-sheet.tsx, components/share-sheet.tsx.' },
      { k: 'i4', c: 'C-079', model: 'sonnet', scope: 'C-079 (sửa liên kết Hành trình nguyên liệu + product-detail vùng nhãn) rồi di cư brand-story.tsx, brand-owner.tsx, brand-view.tsx (emoji), utils/brands.ts; hoàn thiện báo cáo gói (số đo trước/sau từng file, giả định, đề xuất cho điều phối viên).' },
    ],
  },
  {
    id: 'PC-10c1', kind: 'mini', rm: 'opus', twoPass: false,
    spec: `GÓI PC-10c1 — Di cư ví, cộng đồng, và các trang phụ sang DS v2 (C-076 lô 3: wallet + post-detail + feed + phần còn lại nhóm 1).
File sở hữu (CHỈ sửa các file này + spec tương ứng): apps/miniapp/src/pages/{wallet,cashback,post-detail,feed,group-buy,community-events,community-leaderboard,community-moderation,refill,ai-advisor,academy}.tsx, components/community/{post-composer,post-card,product-picker}.tsx (rank-badge là của PC-10a, KHÔNG đụng).
Baseline legacy: wallet 73 (ESLint 6), post-detail 60, refill 37, ai-advisor 34, feed 34, cashback 26 (ESLint 6), community-events 26, post-composer 23, academy 23, community-moderation 23, group-buy 16, community-leaderboard 15, post-card 18 (emoji 9), product-picker 7.
Ví Tubu / cashback hiển thị số dư, lịch sử, rút tiền: TUYỆT ĐỐI không đổi cách tính/hiển thị số, điều kiện nút, lời gọi API (PB-3 vừa có sổ cái ví).
Emoji ở post-card, post-composer, community-leaderboard (reaction, huy hiệu) là NỘI DUNG cộng đồng thì được giữ; emoji làm icon nút/điều hướng thì đổi sang Icon (C-113).`,
    items: [
      { k: 'i1', c: 'C-076', model: 'sonnet', scope: 'Guard spec ds-c076-pc10c1 + di cư pages/wallet.tsx và pages/cashback.tsx.' },
      { k: 'i2', c: 'C-076', model: 'sonnet', scope: 'Di cư pages/post-detail.tsx, pages/feed.tsx, components/community/{post-composer,post-card,product-picker}.tsx.' },
      { k: 'i3', c: 'C-076', model: 'sonnet', scope: 'Di cư pages/community-events.tsx, community-leaderboard.tsx, community-moderation.tsx, group-buy.tsx.' },
      { k: 'i4', c: 'C-076', model: 'sonnet', scope: 'Di cư pages/refill.tsx, ai-advisor.tsx, academy.tsx + hoàn thiện báo cáo gói (số đo trước/sau từng file, giả định, đề xuất cho điều phối viên).' },
    ],
  },
  {
    id: 'PC-10c2', kind: 'mini', rm: 'opus', twoPass: false,
    spec: `GÓI PC-10c2 — Di cư hồ sơ/cài đặt/nhân sự/admin miniapp sang DS v2 (C-076 lô 4a) + cấu hình liên hệ Q-17 + C-113 trong các trang này.
File sở hữu (CHỈ sửa các file này + spec tương ứng): apps/miniapp/src/pages/{profile,settings,edit-profile,about,about-data,notifications,addresses,wishlist,not-found,bank-payment,order-detail,staff,my-payroll,admin}.tsx (about-data.ts), và cho Q-17: apps/api/src/modules/system-config/** (chỉ phần cấu hình công khai), apps/api/prisma/seed.ts (chỉ khoá liên hệ, createOnly), apps/web/src/lib/site.ts + components/site-footer.tsx CHỈ ĐỌC để đối chiếu (đã đọc /config/public ở PC-7), order-detail.tsx CHỈ phần emoji (PC-3 đã di cư xong trang).
Baseline legacy: profile 41 (ESLint 3), staff 41 (ESLint 3), admin 32, about 30, settings 22 (ESLint spec 2), my-payroll 17 (ESLint 8), notifications 15, addresses 12, edit-profile 1, wishlist 1, not-found 1, bank-payment emoji 7, order-detail emoji 4.
Q-17 (quyết định chủ dự án): hotline 0899 149 229, email tubutree@gmail.com; Zalo OA chưa có thì ẨN dòng; lưu thành cấu hình (app_config/SystemConfig) admin sửa được; dòng chưa có giá trị thì ẩn. Footer web đã đọc từ /config/public. Việc của gói: kiểm tra miniapp (about.tsx, about-data.ts, profile/settings có liên hệ hỗ trợ?) có đọc cùng khoá /config/public không hay hard-code; sửa cho đọc từ cấu hình, ẩn dòng rỗng, test vitest đỏ→xanh; kiểm API: khoá liên hệ có trong whitelist công khai của system-config và seed createOnly đúng giá trị; thiếu thì bổ sung kèm test jest (chạy jest --maxWorkers=1 đúng spec liên quan, không full suite). Không bịa số Zalo OA.
Màn nhân sự (staff, my-payroll) hiển thị chấm công/lương: TUYỆT ĐỐI giữ nguyên cách tính/hiển thị và lời gọi API (PC-9 vừa sửa).
beta.tsx sẽ bị xoá ở PD-1: KHÔNG đụng.`,
    items: [
      { k: 'i1', c: 'C-076', model: 'sonnet', scope: 'Guard spec ds-c076-pc10c2 + di cư pages/profile.tsx, settings.tsx, edit-profile.tsx (và spec lint).' },
      { k: 'i2', c: 'Q-17', model: 'sonnet', scope: 'Q-17 cấu hình liên hệ (miniapp + API/seed nếu cần) + di cư pages/about.tsx.' },
      { k: 'i3', c: 'C-076', model: 'sonnet', scope: 'Di cư pages/notifications.tsx, addresses.tsx, wishlist.tsx, not-found.tsx; C-113: emoji ở bank-payment.tsx và order-detail.tsx.' },
      { k: 'i4', c: 'C-076', model: 'sonnet', scope: 'Di cư pages/staff.tsx, my-payroll.tsx, admin.tsx + hoàn thiện báo cáo gói (số đo trước/sau từng file, giả định, đề xuất cho điều phối viên).' },
    ],
  },
  {
    id: 'PC-10c3', kind: 'mini', rm: 'opus', twoPass: false,
    spec: `GÓI PC-10c3 — Di cư component dùng chung còn lại sang DS v2 (C-076 lô 4b) + C-113 (emoji làm icon ngoài game/hạng).
File sở hữu (CHỈ sửa các file này + spec tương ứng): apps/miniapp/src/components/{reviews-section,onboarding,product-card,flash-sale,avatar-crop-modal,image-upload,error-boundary,geo-picker,qr-code,subscribe-sheet,wishlist-heart,pull-to-refresh}.tsx, components/checkout/{voucher-sheet,address-section,referral-code-box}.tsx, components/ui/{quantity-selector,time-input}.tsx (CHỈ hai file này trong ui/; primitives.tsx sẽ bị xoá ở PD-1, KHÔNG đụng), spec đi kèm.
Baseline legacy: reviews-section 34 (emoji 12), voucher-sheet 32, flash-sale 26, onboarding 23 (emoji 21), product-card 20, address-section 14, image-upload 11, quantity-selector 6, wishlist-heart 4, time-input 2 + hex 2, avatar-crop-modal 3 + hex 8 (ESLint 7), error-boundary hex 3 (ESLint 3), geo-picker emoji 3, qr-code hex 2, subscribe-sheet 1, referral-code-box + pull-to-refresh emoji 1.
Đây là component DÙNG CHUNG ở nhiều trang (giỏ, checkout, chi tiết SP, Home): giữ nguyên props/hành vi công khai (không đổi chữ ký), spec hiện có phải vẫn xanh; kiểm nơi dùng bằng grep trước khi đổi.
Lưu ý: flash-sale.tsx còn ZaUI có chủ đích (ghi trong ds-legacy-vars-4b.spec.ts): chỉ đổi màu/alias, giữ cấu trúc nếu việc thay ZaUI làm đổi hành vi countdown.`,
    items: [
      { k: 'i1', c: 'C-076', model: 'sonnet', scope: 'Guard spec ds-c076-pc10c3 + di cư reviews-section, onboarding (C-113 emoji), product-card, flash-sale, checkout/voucher-sheet.' },
      { k: 'i2', c: 'C-076', model: 'haiku', scope: 'Di cư các file nhỏ: checkout/address-section, avatar-crop-modal, image-upload, error-boundary, geo-picker, qr-code, subscribe-sheet, wishlist-heart, ui/quantity-selector, ui/time-input, referral-code-box, pull-to-refresh (ESLint tubu-ds là chốt) + hoàn thiện báo cáo gói (số đo trước/sau từng file, giả định, đề xuất cho điều phối viên).' },
    ],
  },
  {
    id: 'PC-11', kind: 'web', rm: 'opus', twoPass: true,
    spec: `GÓI PC-11 — Admin web + merchant + brand sang DS v2 (Q-25: đồng bộ cả admin; Q-29: admin tối ưu máy tính nhưng không vỡ ở 390px). Làm SAU PC-7 (đã merge).
PHẠM VI: chỉ đổi giao diện sang token/palette DS v2 + sửa bố cục vỡ do nền toàn cục mới của PC-7 + bảo đảm 390px không tràn ngang trang. KHÔNG tái cấu trúc 19 tab (C-091/C-093 để backlog), KHÔNG đổi hành vi.
File sở hữu (CHỈ sửa): apps/web/src/app/admin/** (layout.tsx, page.tsx, analytics-tab.tsx, pos/page.tsx), apps/web/src/components/admin/**, apps/web/src/app/merchant/**, apps/web/src/app/brand/**, apps/web/src/lib/admin-pickers.ts, apps/web/src/components/geo-picker.tsx, spec đi kèm.
Baseline (static-scan web, nhóm file này): admin/page.tsx neutral 296 + stock 165 + emoji 14; merchant/page.tsx legacyPalette 30 + neutral 178 + stock 79 + hex 8; brand/[slug]/page.tsx legacyPalette 14; tổng admin 35 file: neutral 581, stock palette 351. Mục tiêu: các file trên legacyPalette=0, neutralCls=0, greenRed=0, hex=0, emoji icon -> lucide-react.
Màn admin có thao tác tiền/đơn (đã nhận tiền chuyển khoản, trạng thái đơn, hoàn/đổi trả, payout, công nợ/hạn mức đại lý, duyệt claim): chỉ đổi class/markup trình bày; mọi handler, điều kiện disable, hộp xác nhận (confirm-dialog), nhãn nút nghiệp vụ, log hành động phải giữ nguyên. Component có spec (order-status-actions, dealer-credit-panel, payout-admin-tab...) phải vẫn xanh mà KHÔNG sửa assert (đổi assert chỉ khi test bám vào class cũ, và ghi lý do).`,
    items: [
      { k: 'i1', c: 'C-097', model: 'sonnet', scope: 'Guard spec ds-palette-pc11 + nền admin (admin/layout.tsx) + component dùng chung của admin: components/admin/{ui,confirm-dialog,page-nav,search-picker,config-item,evidence-images,invoice-filter-chips,dealer-tier-select,ns1-card,loyalty-config-card,gomdon-config-card}.tsx.' },
      { k: 'i2', c: 'C-097', model: 'sonnet', scope: 'admin/page.tsx NỬA ĐẦU: khung trang, đăng nhập, thanh tab, và các tab từ đầu file tới khoảng dòng 1300 (mỗi cụm tab một commit).' },
      { k: 'i3', c: 'C-097', model: 'sonnet', scope: 'admin/page.tsx NỬA SAU: các tab từ khoảng dòng 1300 tới cuối file + emoji->lucide (mỗi cụm tab một commit).' },
      { k: 'i4', c: 'C-097', model: 'sonnet', scope: 'Các component admin còn lại: merchant-products-tab, dealer-claims-tab, order-detail-extras, payout-admin-tab, recycling-panel, dealer-credit-panel, dealer-payment-panel, pos-credits-tab, pos-screen, account-deletion-panel, order-status-actions, reviews-tab, cashback-tab, subscriptions-tab, admin/analytics-tab.tsx, admin/pos/page.tsx, lib/admin-pickers.ts, components/geo-picker.tsx.' },
      { k: 'i5', c: 'C-097', model: 'sonnet', scope: 'app/merchant/page.tsx và app/brand/[slug]/page.tsx (hex 8 -> token) + hoàn thiện báo cáo gói (số đo trước/sau, ảnh hưởng 390px, giả định, đề xuất cho điều phối viên).' },
    ],
  },
]

function ctx(p) {
  const wt = WT(p.id)
  return `
BỐI CẢNH: Tubu Tree, monorepo pnpm + Turborepo (apps/api NestJS+Prisma, apps/web Next.js, apps/miniapp Zalo Mini App, apps/e2e Playwright, packages/*). macOS, shell zsh.
MÃ GÓI: ${p.id}. Bạn làm việc trong git worktree CỐ ĐỊNH của gói: ${wt} (nhánh ${BR(p.id)}, tách từ hardening/2026-10 commit ${BASE}). MỌI lệnh shell bắt đầu bằng: export PATH=${NODEBIN}:$PATH; cd ${wt} && ... (bắt buộc Node 22 vì jsdom 30; shell không nhớ biến giữa các lệnh). MỌI đường dẫn Read/Edit/Write nằm dưới ${wt}. Repo chính ${REPO} là của điều phối viên: KHÔNG sửa gì ở đó.
MÁY CÓ THỂ SẬP: thay đổi chưa commit sẽ MẤT. Commit NGAY khi một bước đã xanh (git add <file cụ thể>, không dùng git add -A), commit sớm, commit nhiều. Đầu mỗi lượt chạy: git status + git log --oneline ${BASE}..HEAD để biết lần trước làm tới đâu; mục đã có commit và test xanh thì chỉ xác nhận (chạy lại lệnh đo của mục) rồi trả kết quả, đừng làm lại; có thay đổi dở thì xem diff, hoàn thiện rồi commit.
TÀI LIỆU: docs/2026-10-review/00-ROADMAP.md (mục 5 vòng C3, mục 9 = quyết định chủ dự án, BẮT BUỘC tuân theo), docs/2026-10-review/findings-catalog.md (dòng C-xxx), báo cáo gốc 04-uiux.md, 01-pm.md cùng thư mục, docs/2026-10-review/HANDOFF.md.
MÔI TRƯỜNG (đã dựng sẵn): node_modules thật trong worktree, packages/shared-types/dist, Prisma client. KHÔNG cần Docker/Postgres cho gói này (nếu thật sự cần DB: dùng container tubu_it_main cổng 5550, DATABASE_URL=postgresql://tubu:tubu@localhost:5550/tubutree_it, KHÔNG ghi vào DB khác).
${p.kind === 'web' ? COMMON_WEB : COMMON_MINI}
QUY TRÌNH:
 - Mỗi mục: đo baseline -> viết/mở rộng guard spec thấy ĐỎ -> sửa -> XANH -> commit. Comment code chỉ giải thích "vì sao" không hiển nhiên, không kể lại thay đổi ("đổi X sang Y" cấm). Giữ phong cách code xung quanh.
 - Message commit kết thúc bằng đúng dòng: Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
 - Test: chỉ spec liên quan (miniapp/web: npx vitest run <đường dẫn spec>, KHÔNG dùng --maxWorkers; api: npx jest <spec> --maxWorkers=1). KHÔNG chạy full suite, KHÔNG Playwright, KHÔNG dev server (máy 15,5GB RAM, chỉ 1 job nặng một lúc, điều phối viên chạy). Được chạy tsc --noEmit của app bị sửa và ESLint file đã sửa.
 - CẤM: git stash/reset/checkout/restore/rebase/push/merge/cherry-pick/switch; git worktree remove; deploy; đụng PROD; gọi dịch vụ ngoài thật; sửa file ngoài nhóm file của gói (buộc phải thì giữ tối thiểu và ghi lý do trong báo cáo).
 - Nghiệp vụ không rõ: chọn phương án an toàn nhất (không đổi hành vi), ghi vào "Giả định" trong báo cáo.
BÁO CÁO: ghi/append mục của bạn vào docs/2026-10-review/impl/${p.id}.md trong worktree và commit: từng file/mục (XONG / MỘT PHẦN / BỎ + lý do), số đo trước -> sau (legacy/hex/emoji/ESLint), test thêm (đỏ -> xanh), lệnh kiểm chứng + vài dòng output thật, giả định, việc còn lại, "Đề xuất cho điều phối viên".
`
}

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['DONE', 'PARTIAL', 'SKIPPED', 'BLOCKED'] },
    head: { type: 'string' },
    note: { type: 'string' },
    tests: { type: 'array', items: { type: 'object', properties: { cmd: { type: 'string' }, result: { type: 'string' } }, required: ['cmd', 'result'] } },
  },
  required: ['status', 'head', 'note'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'CHANGES'] },
    findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, file: { type: 'string' }, line: { type: 'integer' }, issue: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'issue'] } },
    summary: { type: 'string' },
  },
  required: ['verdict', 'findings', 'summary'],
}

function itemPrompt(p, it, idx, n) {
  return `${ctx(p)}
GÓI ${p.id} — MỤC ${idx + 1}/${n} (${it.c}).
TOÀN BỘ ĐẶC TẢ GÓI (để hiểu ngữ cảnh):
${p.spec}

PHẠM VI CỦA LƯỢT NÀY (chỉ làm phần này; các mục khác do lượt khác làm và có thể đã commit trong worktree): ${it.scope}
Trả về StructuredOutput: status (DONE/PARTIAL/SKIPPED/BLOCKED), head = git rev-parse HEAD sau commit cuối, note <= 8 dòng, tests [{cmd, result}] (lệnh đã chạy + kết quả thật, gồm lệnh đo ESLint/static-scan của từng file đã xong).`
}

function reviewPrompt(p, round) {
  const wt = WT(p.id)
  const measure = p.kind === 'web'
    ? 'static-scan web (legacyPalette/neutralCls/greenRed/hex của file đổi), npx eslint từng file trong apps/web, npx vitest run các spec admin liên quan + ds-palette-pc11.spec.ts, npx tsc --noEmit trong apps/web'
    : 'npx eslint từng file đổi trong apps/miniapp (kỳ vọng 0 lỗi 0 cảnh báo), static-scan (legacy/hex của file đổi), guard spec ds-c076-*.spec.ts của gói, npx vitest run các spec liên quan, npx tsc --noEmit trong apps/miniapp'
  return `Bạn là REVIEWER ĐỘC LẬP (lượt ${round}) cho gói ${p.id} của đợt hardening Tubu Tree (di cư giao diện sang DS v2, KHÔNG được đổi hành vi). Bạn KHÔNG nhận kết luận của người làm — tự đọc diff và code, tự chạy lại lệnh đo.
Môi trường: mọi lệnh shell bắt đầu bằng export PATH=${NODEBIN}:$PATH; cd ${wt} && ... Worktree: ${wt} (nhánh ${BR(p.id)}). Base: ${BASE}. Xem: git -C "${wt}" log --oneline ${BASE}..HEAD ; git -C "${wt}" diff ${BASE}..HEAD -- . ':!docs/2026-10-review/impl' (impl/*.md là lời tự báo, không phải bằng chứng).
YÊU CẦU CỦA GÓI (để đối chiếu):
${p.spec}
Quyết định chủ dự án: docs/2026-10-review/00-ROADMAP.md mục 9.
Nhiệm vụ: tìm lỗi THẬT trong diff.
 (a) HÀNH VI: với từng file đổi, đối chiếu code trước/sau (git show ${BASE}:<file>): lời gọi API, điều kiện enable/disable, onClick/onChange, số tiền/điểm/số lượng hiển thị, thứ tự bước, text nghiệp vụ, key i18n, sự kiện analytics, nút/khối bị xoá nhầm hoặc mất lối vào. Mọi thay đổi hành vi không thuộc mục được giao = blocker (nếu đụng tiền/điểm/ví/công nợ/chấm công/lương) hoặc major.
 (b) ĐO: chạy lại ${measure}; ghi kết quả thật. Mục tiêu đo không đạt = major.
 (c) DS/a11y: dùng đúng component DS (không dựng lại thứ DS đã có), vùng chạm >=44px, đúng một h1 mỗi trang, trạng thái loading/empty/error, aria-label cho nút icon, thứ tự focus, tương phản bằng token, không hex/rgb/alias legacy còn sót, không emoji làm icon chức năng.
 (d) TEST: guard spec có thật sự bắt lỗi không (danh sách file không rỗng, regex đúng, không .skip), test hành vi có assert thật; thay assert cũ của spec có sẵn mà không có lý do = major.
 (e) PHẠM VI: file ngoài nhóm bị sửa, file tạm/rác được commit, sửa tokens.css/app.tsx/design-tokens/components/ui ngoài danh sách = major.
Với mỗi nghi ngờ truy 2-3 trường hợp cụ thể qua code. KHÔNG sửa code, KHÔNG git ghi, KHÔNG chạy full suite/Playwright/dev server.
Phân loại: blocker (đổi hành vi tiền/điểm/auth/dữ liệu, mất chức năng, vỡ luồng chính), major (đổi hành vi khác, đo không đạt, thiếu test quan trọng, a11y hỏng nghiêm trọng, ngoài phạm vi), minor (còn lại). Verdict CHANGES nếu có blocker hoặc major.
Trả về StructuredOutput: verdict, findings [{severity, file, line, issue, fix}], summary <= 8 dòng (kèm kết quả lệnh đo thật).`
}

function fixPrompt(p, review, round) {
  return `${ctx(p)}
SỬA THEO REVIEW lượt ${round} cho gói ${p.id}. Làm TRỰC TIẾP trong worktree ${WT(p.id)}.
YÊU CẦU GÓI:
${p.spec}
FINDINGS của reviewer độc lập (JSON):
${JSON.stringify(review.findings, null, 1)}
Với mỗi blocker/major: xác minh lại (reviewer có thể sai — nếu sai, giải thích bằng bằng chứng trong báo cáo, không sửa mù); nếu đúng: test đỏ trước rồi sửa, commit riêng "fix(<scope>): address review <ngắn> (C-xxx)". Minor: sửa nếu rẻ và an toàn. Cập nhật docs/2026-10-review/impl/${p.id}.md mục "Review lượt ${round}" (từng finding: đã sửa / không sửa + lý do) và commit.
Trả về StructuredOutput: status, head, note, tests.`
}

phase('Implement')
log('Base ' + BASE + '; ' + PKGS.length + ' gói trong worktree cố định hz7-*, tối đa 3 agent cùng lúc; resume được sau sập máy')

const results = await pipeline(
  PKGS,
  async (p) => {
    const items = []
    for (let i = 0; i < p.items.length; i++) {
      const it = p.items[i]
      const r = await run(itemPrompt(p, it, i, p.items.length), { label: 'impl:' + p.id + ':' + it.k, phase: 'Implement', model: it.model, schema: ITEM_SCHEMA })
      items.push({ c: it.c, k: it.k, status: r ? r.status : 'FAILED', note: r ? r.note : 'agent null', head: r && r.head, tests: r && r.tests })
    }
    const r1 = await run(reviewPrompt(p, 1), { label: 'review1:' + p.id, phase: 'Review', model: p.rm, effort: 'high', schema: REVIEW_SCHEMA })
    let fix1 = null, r2 = null, fix2 = null, r3 = null
    if (r1 && r1.verdict === 'CHANGES') {
      fix1 = await run(fixPrompt(p, r1, 1), { label: 'fix1:' + p.id, phase: 'Fix', model: 'sonnet', schema: ITEM_SCHEMA })
      r2 = await run(reviewPrompt(p, 2), { label: 'review2:' + p.id, phase: 'Review', model: p.rm, effort: 'high', schema: REVIEW_SCHEMA })
    } else if (p.twoPass) {
      r2 = await run(reviewPrompt(p, 2), { label: 'review2:' + p.id, phase: 'Review', model: p.rm, effort: 'high', schema: REVIEW_SCHEMA })
    }
    if (r2 && r2.verdict === 'CHANGES') {
      fix2 = await run(fixPrompt(p, r2, 2), { label: 'fix2:' + p.id, phase: 'Fix', model: 'sonnet', schema: ITEM_SCHEMA })
      r3 = await run(reviewPrompt(p, 3), { label: 'review3:' + p.id, phase: 'Review', model: p.rm, effort: 'high', schema: REVIEW_SCHEMA })
    }
    return { id: p.id, items, r1, fix1, r2, fix2, r3 }
  },
)

return results.map(r => r && ({
  id: r.id,
  worktree: WT(r.id), branch: BR(r.id),
  items: r.items.map(i => ({ c: i.c, k: i.k, status: i.status, head: i.head, note: i.note })),
  review1: r.r1 && (r.r1.verdict + ' (' + r.r1.findings.length + ' findings): ' + r.r1.summary),
  fix1: r.fix1 && { status: r.fix1.status, head: r.fix1.head, note: r.fix1.note },
  review2: r.r2 && { verdict: r.r2.verdict, open: r.r2.findings.filter(f => f.severity !== 'minor'), summary: r.r2.summary },
  fix2: r.fix2 && { status: r.fix2.status, head: r.fix2.head, note: r.fix2.note },
  review3: r.r3 && { verdict: r.r3.verdict, open: r.r3.findings.filter(f => f.severity !== 'minor'), summary: r.r3.summary },
}))
