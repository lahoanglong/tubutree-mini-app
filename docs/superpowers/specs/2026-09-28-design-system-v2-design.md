# Design System v2 — Spec (dự án con 3 / "hoàn thiện xuất sắc")

**Ngày:** 2026-09-28 · **Nhánh:** `feat/complete-wip-2026-09` · **Trạng thái:** đã brainstorm + user duyệt, sẵn sàng viết plan.

**Đầu vào:** `docs/audit-2026-09/04-design-system.md` (audit 27/09/2026, 898 dòng, 6 P1 + 23 P2, không P0). Spec này ADOPT gần như nguyên vẹn kiến trúc token + danh sách component audit đã đề xuất (mục "Đầu vào cho Design System v2" của audit), chỉ khác ở: (a) 3 quyết định thị giác user chốt qua mockup trực quan (màu, font, logo), (b) phạm vi rollout cho riêng dự án con này, (c) các ruling nhỏ thay user cho câu hỏi audit nêu mà không đáng dừng lại hỏi.

---

## 1. Bối cảnh & mục tiêu

Audit đo được: `tokens.css` có 84 token nhưng 93,7% màu trong code trỏ thẳng bậc primitive; bộ primitive dùng chung (`Txt/Stack/Row/Card/Btn/Badge/Chip/SectionHeader/StickyActionBar/ListRow`, `Price`) có 0 trang sử dụng; ZaUI không được theme nên 137/255 nút zmp-ui hiện xanh Zalo mặc định; CTA cam chữ trắng chỉ đạt 2,65:1 (fail AA); style tổng thể hiện ra "chợ xanh vui tươi" chứ chưa "tiệm thảo mộc cao cấp" theo brief chủ shop (Aesop/Innisfree/The Body Shop). Không có lỗi P0 (tầng giao diện không làm sai tiền/điểm/tồn kho).

**Mục tiêu dự án con 3:** xây token semantic + cầu nối ZaUI + bộ component lõi + lint chặn hồi quy, RỒI áp dụng thật vào 1 luồng mua lại thí điểm (PDP → giỏ → thanh toán → chi tiết/danh sách đơn → gian hàng CTV) để chứng minh hệ thống chạy được trước khi dự án con 4 nhân rộng ra toàn app.

**Ngoài phạm vi dự án con này** (để lại cho dự án con 4/5/6/7): home/browse/feed, loyalty/game/Vườn Xanh, CTV/đại lý (trừ gian hàng CTV đã có trong luồng thí điểm), web admin (dự án con 7 riêng, style Shopify — không đụng), trang brand-story "bản đồ gỗ 3D", theme riêng cho đại lý (navy), bộ minh hoạ thay emoji cho game/hạng.

---

## 2. Quyết định thị giác (đã duyệt qua mockup, không đổi nữa)

Được chọn qua 3 vòng mockup trực quan (superpowers visual companion), theo hướng **"Deep Forest Apothecary"** — xanh rừng đậm nghiêm túc, gần Aesop/The Body Shop hơn Innisfree tươi sáng:

- **Màu:** xanh rừng đậm làm màu hành động chính, nền đá/cát ấm thay trắng tinh, vàng đồng làm accent cao cấp (thay lime + cam làm UI).
- **Font:** Fraunces (serif mềm, hữu cơ) cho display/heading + Inter cho body — thay Bricolage Grotesque, Plus Jakarta Sans, Inter cũ (giữ tên nhưng đổi vai trò), JetBrains Mono, Be Vietnam Pro.
- **Logo:** tiến hoá TỪ logo thật hiện có (`apps/miniapp/src/assets/tubu-logo.png` — chậu hạt giống bo tròn 2-tông + 3 chấm đốm + 2 lá mầm lệch), giữ NGUYÊN bố cục/chi tiết, chỉ đổi bảng màu cam-vàng-lime sang xanh rừng + vàng đồng. Không đổi wordmark web (icon lucide "cây" đặt cạnh chữ) — đó chỉ là placeholder tạm, thay bằng logo thật dùng chung.

**Hoà giải với giá trị chính xác:** mockup dùng hex nháp để CHỌN HƯỚNG. Token thật dùng bảng màu audit đã tính contrast WCAG (mục 3 dưới) — cùng tinh thần "xanh rừng đậm" vừa chọn, chỉ là bản đã kiểm tra AA/AAA thay vì hex đoán. Logo (không bị luật contrast chữ ràng buộc như nút UI) dùng tông đậm hơn nữa (forest-800/900) để giữ cảm giác "gần đen" đã chọn ở mockup.

---

## 3. Kiến trúc token — 3 lớp

```
Lớp 1 — PRIMITIVE (chỉ tồn tại trong file token, trang/component KHÔNG được import trực tiếp)
  forest-{50,100,200,300,400,500,600,700,800,900}   xanh rừng (thương hiệu, hành động, logo)
  sage-{50,100,600,700}                              xanh xám dịu (bề mặt, accent mềm)
  stone-{0,25,50,100,200,300,400,450,500,600,700,800,900}  trung tính ấm (giấy/đá — thay neutral-*)
  clay-{50,100,500,600,700}                          đất nung (khuyến mãi, voucher — kế thừa cam logo)
  honey-{500,600}   terracotta-{50,600}   tubu-orange (#E08C1C, CHỈ cho logo/minh hoạ, không dùng UI)
  red/amber/blue-{50,600,700}                        trạng thái
  space-{0,1,2,3,4,5,6,8,10,12,16} → 0·2·4·8·12·16·20·24·32·40·48·64px
  radius-{0,4,8,12,16,24,full} · font-{display,ui} · size/leading/weight-* · dur-* · ease-*

Lớp 2 — SEMANTIC (thứ DUY NHẤT trang & component được tham chiếu)
  color.bg.{canvas, surface, subtle, inverse, scrim}
  color.text.{primary, secondary, tertiary, disabled, inverse, brand, link, price, price-compare, success, warning, danger}
  color.border.{subtle, default, strong, focus, selected}
  color.action.primary.{bg, bg-pressed, bg-disabled, fg, fg-disabled}
  color.action.secondary.{bg, bg-pressed, fg, border} · color.action.ghost.{fg, bg-pressed} · color.action.danger.*
  color.status.{success, warning, danger, info, neutral}.{fg, bg, border}
  color.promo.{fg, bg} · color.flash.{solid, fg, bg} · color.rating · color.game.{…} (dự trữ, chưa dùng đợt này)
  space.{inline-xs…xl, stack-xs…xl, inset-card, inset-page, gutter, section}
  radius.{control, card, media, sheet, pill} · elevation.{0,1,2,3,4}
  type.{display-lg … label, price-*} · motion.{tap, enter, exit, emphasize} · z.{base, sticky, nav, back, overlay, sheet, dialog, toast}

Lớp 3 — COMPONENT (+ cầu nối ZaUI)
  --btn-primary-bg: var(--color-action-primary-bg); --chip-selected-bg; --card-radius; --sheet-radius; --tabbar-active; …
  --zaui-light-color-primary / -button-primary-background / -button-primary-background-pressed
  --zaui-light-button-secondary-{background,text,icon} / -button-tertiary-{text,icon}
  --zaui-light-input-hover-border-color / -spinner-dot-color / -checkbox-checked-background / -radio-checked-background
  --zaui-light-switch-bg-color / -tabbar-active-line / -progress-completed / -slider-* / -picker-option-selected-color
  --zaui-light-bottom-navigation-active-color / -button-background-disabled / -button-text-disabled

THEME: cơ chế `[data-theme="dealer"]` ghi đè CHỈ Lớp 2 (action → navy) — thiết kế sẵn cơ chế, KHÔNG áp dụng nội dung theme đại lý trong dự án con này (đại lý ngoài phạm vi luồng thí điểm).
```

### Bảng màu (đã kiểm WCAG, dùng làm token thật)

| Vai trò | Giá trị | Tỉ lệ contrast | Kết quả |
|---|---|---:|---|
| `bg.canvas` | stone-50 `#F6F4EF` | text.primary trên canvas: 15,81 | AAA |
| `bg.surface` | `#FFFFFF` | text.primary trên surface: 17,37 | AAA |
| `text.primary` | `#1C1A16` | — | — |
| `text.secondary` | stone-600 `#5A544A` | 7,50 / 6,82 | AAA / AA |
| `text.tertiary` | stone-500 `#746D61` | 5,12 / 4,66 | AA / AA |
| `text.disabled` | stone-400 `#9E978A` | 2,90 | miễn (disabled) |
| `border.strong` | stone-450 `#938B7E` | 3,37 | đạt 3:1 |
| `border.default` | stone-300 `#CBC5B8` | 1,72 | chỉ trang trí |
| **`action.primary.bg`** | **forest-600 `#245E3E`** | **7,65 (chữ trắng)** | **AAA** |
| `action.primary.bg-pressed` | forest-700 `#1B4B31` | 10,01 | AAA |
| `text.brand` / link / focus ring | forest-600 `#245E3E` | 7,65 | AAA |
| chip đang chọn / badge brand | forest-700 trên forest-50 `#EEF4EF` | 8,97 | AAA |
| eyebrow / khối nhấn | forest-800 `#143A26` trên sage-50 `#F2F5EC` | 11,45 | AAA |
| accent mềm | sage-700 `#4A6135` trên trắng | 6,88 | AA |
| `promo.solid` (badge −%) | clay-600 `#9C532C`, chữ trắng | 5,70 | AA |
| `promo` (voucher) | clay-700 `#7E4222` trên clay-50 `#FAF1EA` | 7,00 | AAA |
| `rating` (sao) | honey-500 `#B07A00` trên trắng | 3,73 | đạt 3:1 |
| `status.success` | `#2F7A48` trên `#EAF4EC` | 4,66 | AA |
| `status.warning` | `#8A5300` trên `#FFF4E0` | 5,81 | AA |
| `status.danger` | `#B3362F` trên `#FBEAE8` / trên trắng | 5,17 / 6,03 | AA |
| `status.info` | `#2E6391` trên `#E8F0F7` | 5,51 | AA |
| `flash.solid` | terracotta `#C2410C`, chữ trắng | 5,18 | AA |
| badge game/logo | `#1C1A16` trên cam logo `#E08C1C` | 6,57 | AA |

Thang forest đầy đủ: 50 `#EEF4EF` · 100 `#D6E6DA` · 200 `#B1CFB9` · 300 `#86B293` · 400 `#5B9170` · 500 `#3B7552` · 600 `#245E3E` · 700 `#1B4B31` · 800 `#143A26` · 900 `#0D291B`. **Logo dùng forest-800/900** (đậm hơn UI action) để giữ cảm giác gần-đen đã chọn ở mockup; chấm đốm trên logo dùng `honey-600` (đất nung-vàng đồng, giá trị cụ thể chốt khi vẽ asset — nằm giữa honey-500 `#B07A00` và clay-600 `#9C532C`).

### Thang chữ

Fraunces (display, weight 500/600, optical sizing) + Inter (UI/body, weight 400/500). Bỏ Bricolage Grotesque, Plus Jakarta Sans (vai trò UI), JetBrains Mono, Be Vietnam Pro. Tự host subset latin+vietnamese (không phụ thuộc `fonts.googleapis.com` lúc chạy trong Zalo — audit ghi nhận UNKNOWN liệu Zalo WebView chặn tải font runtime).

| Token | Cỡ / line-height | Weight | Dùng cho |
|---|---|---|---|
| `display-lg` | 32 / 40 (1,25) | 600 Fraunces | hero |
| `display-md` | 28 / 36 | 600 Fraunces | tiêu đề hero trang |
| `title-lg` | 22 / 30 (1,36) | 600 Fraunces | `PageHeader`, tên SP PDP |
| `title-md` | 18 / 26 | 600 Fraunces | tiêu đề khu, tiêu đề sheet |
| `title-sm` | 16 / 24 | 600 Fraunces | tiêu đề thẻ |
| `body-lg` | 16 / 24 (1,5) | 400 Inter | mô tả PDP |
| `body-md` | 15 / 22 | 400 Inter | thân mặc định |
| `body-sm` | 14 / 22 (1,57) | 400/500 Inter | tên SP thẻ (clamp 2 dòng: min-height 44px) |
| `caption` | 13 / 20 | 400/500 Inter | meta, timestamp (`text.tertiary`) |
| `label` | 12 / 16 | 600 Inter | badge, chip nhỏ, letter-spacing 0,02em |
| `price-xl/lg/md/sm` | 24/32 · 20/28 · 16/22 · 14/20 | 700/600 Inter | giá, `font-variant-numeric: tabular-nums` |

Quy tắc: cấm cỡ dưới 12px và cỡ lẻ; không đặt `fontSize` inline; line-height luôn tương đối (không px cố định như ZaUI hiện tại); chế độ "Chữ to" nhân thang qua biến `--type-scale` (×1,25 hoặc ×1,5 — xem mục 6).

### Spacing / radius / elevation / motion / z-index

| Nhóm | Thang |
|---|---|
| Spacing (4-pt, 8 là nhịp chính) | 0·2 (chỉ trong component)·4·8·12·16 (gutter)·20·24 (giữa khu)·32·40·48·64 |
| Radius | 4 (tag nhỏ)·8 (input)·**12 (control/nút/media)**·16 (thẻ)·24 (sheet/dialog)·full (pill/avatar) |
| Elevation (bóng tint `#1C1A16`, không đen thuần) | 0 phẳng+viền · 1 thẻ `0 1px 2px/.06,0 2px 8px/.05` · 2 thanh dính `0 4px 16px/.08` · 3 sheet `0 -8px 24px/.10` · 4 dialog `0 16px 40px/.16` |
| Motion | tap 100ms scale .97 · enter 200-250ms ease-out · exit 150ms ease-in · emphasize 300-400ms; giữ `prefers-reduced-motion` |
| z-index | base 0 · sticky 20 · nav 100 · back 110 · overlay 900 · sheet 1000 · dialog 1100 · toast 1200 · onboarding 1300 |

---

## 4. Kỹ thuật: Tailwind + package token dùng chung

**Xác nhận khả thi (verify 2026-09-28):** build thật của miniapp chạy qua Vite chuẩn (`vite build`, plugin `zmp-vite-plugin` + `@vitejs/plugin-react` trong `vite.config.mts`) — KHÔNG qua zmp-cli's own bundler. `zmp start`/`zmp deploy` chỉ đóng gói/upload lên Zalo, không xử lý CSS. Thêm Tailwind vào miniapp là thay đổi Vite/PostCSS tiêu chuẩn, không đụng tới pipeline deploy Zalo. Cờ `includeTailwindCSS:false` trong `zmp-cli.json` chỉ là metadata lúc scaffold ban đầu, không chặn thêm Tailwind sau.

- Tạo `packages/design-tokens`: xuất CSS custom properties (3 lớp ở mục 3) + 1 Tailwind preset dùng chung. Cả `apps/web/tailwind.config.ts` và `apps/miniapp` (mới thêm Tailwind, `includeTailwindCSS` bật) đều `extend` từ preset này — hết cảnh web tự chép tay hex đồng bộ thủ công với miniapp (như hiện tại).
- ZaUI vẫn giữ làm nền hành vi (Sheet/Input/Picker/Spinner...), chỉ theme lại qua ghi đè biến `--zaui-*` (Lớp 3) — đúng khuyến nghị audit, không tự dựng lại từ đầu.
- Component lõi (mục 5) viết bằng Tailwind utility classes tham chiếu token, không còn `style={{}}` tự do.

---

## 5. Component lõi — nguyên danh sách audit đề xuất, xếp theo mức ưu tiên/số trang sửa

| # | Component | Props chính | Thay thế cho |
|---:|---|---|---|
| 1 | **Theme bridge ZaUI** (token, không phải component) | — | 137 nút xanh Zalo + 84 input |
| 2 | `Button` | `variant: primary/secondary/ghost/danger/flash; size: md(44)/lg(48); loading; disabled; icon?; fullWidth?; onPress` — tự quản `loading` (hiện spinner, giữ nhãn, `aria-busy`, không đẩy `disabled` cho ZaUI) | 255 zmp `Button`, 218 nút tự chế, `Btn` |
| 3 | `Text` / `Heading` | `variant: TypeToken; tone; as?` — `Heading` render đúng `h1`-`h3` | 1.051 `Text` ZaUI, 116 `fontSize` literal |
| 4 | `PageHeader` | `title; subtitle?; back?; actions?; variant: plain/hero` | 3+ kiểu tiêu đề, 9 trang thiếu tiêu đề |
| 5 | `PriceTag`/`Money`/`Points`/`Xu` | `value; compareAt?; flash?; subscribePrice?; size; tone` — 1 module format, `tabular-nums` | 60 kiểu trình bày, 6 formatter lặp |
| 6 | `BottomSheet`/`Dialog` | `open; onClose; title; description?; footer?; size: auto/half/full; dismissible` | `Sheet` lắp tay ×48, 7 overlay tự chế |
| 7 | `Card` | `variant: raised/outline/flat; padding; onPress?` | 47 thẻ tự vẽ |
| 8 | `Badge`/`StatusPill` | `tone; size; icon?` | 34 pill tự vẽ, `STATUS_COLOR` |
| 9 | `IconButton` | `icon; label (bắt buộc); size: md(44)/sm(36 nhìn/44 chạm); badge?` | 31 vòng icon, 17 thiếu `aria-label` |
| 10 | `ListRow`/`KeyValueRow` | `icon?; title; subtitle?; trailing?: chevron/switch/node; onPress?` — SỬA lỗi cũ: chỉ vùng chữ nhận `onClick` dù hiệu ứng nhấn áp cả hàng | `LinkRow` ×2, `Row` ×6 |
| 11 | `ProductTile` | `product; variant: grid/rail/list/line/compact; mode: b2c/ctv/dealer; price?; action?: add/rebuy/subscribe/none; badge?` — biến thể `action:'rebuy'` dùng lại logic `repurchase` của `order-detail.tsx` | `ProductCard` + 4 bản chép + ~9 dòng hàng |
| 12 | `Chip`/`SegmentedTabs` | `selected; onPress; icon?; count?; variant` / `items; value; onChange` | 3 `Chip`, 5 kiểu tab |
| 13 | `StickyActionBar` | `primary; secondary?; summary?` — xử lý safe-area MỘT LẦN (sửa lỗi 20 sheet cộng safe-area đôi vì ZaUI đã tự thêm) | 10 thanh tự vẽ |
| 14 | `ProgressBar`/`Meter` | `value; max; tone; label?` | 12 thanh tự vẽ |
| 15 | Form: `Field`,`Checkbox`,`Radio`,`Switch`,`AddressForm` | theo ZaUI đã theme; `AddressForm` gộp còn 1 bản | `RadioDot`,`ToggleVisual`,`Toggle`, `AddressForm` ×2 |
| 16 | `EmptyState`/`ErrorState`/`Skeleton` (đổi màu, giữ logic) | thêm `variant: page/inline`, sửa nút "Thử lại" theo token mới | đã dùng tốt (36-37 file), chỉ cần recolor |
| 17 | `StatTile`, `FlashBadge`/`CountdownChip`, `Icon` (wrapper lucide, stroke 1,75 cố định, size sm16/md20/lg24), `Avatar` | — | `KpiCard/MiniStat/Stat/EcoStat`, badge flash ×5, 18 cỡ icon |

---

## 6. Lint / CI guardrail (bật ngay cho code mới trong dự án con này)

- Cấm hex/rgba/named color literal trong `style={{}}` hoặc JSX string (ngoại lệ: file trong `game/`, `tier/` — khu được phép sôi động).
- Cấm import `Button` thẳng từ `zmp-ui` trong `pages/**` (phải qua DS `Button`).
- Bắt buộc `aria-label` khi `IconButton`/nút chỉ-icon không có text con.
- Check `var(--...)` tham chiếu tới token không tồn tại (audit tìm thấy 3 lỗi loại này: `--leaf-500`, `--primary-300`, `--neutral-150`).
- Cấm `fontSize` inline (phải qua `Text`/`Heading` variant).
- Baseline: dùng đúng bảng chỉ số mục 4 của audit (2.356 `style={{}}`, 226 nút xanh Zalo, 209 emoji chức năng...) làm mốc — script CI so KHÔNG được tăng ở các file/thư mục đã migrate (chưa migrate thì tạm miễn, không chặn build hiện tại).

---

## 7. Phạm vi rollout dự án con 3 (luồng thí điểm)

**Migrate:** `product-detail.tsx` (PDP) → `cart.tsx` → `checkout.tsx` + `bank-payment.tsx` → `order-detail.tsx` + `orders.tsx` → `storefront-view.tsx` + `brand-view.tsx` (gộp thành 1 template `StorePage` — 2 trang cùng khung: cover, avatar tròn, tên, dải badge, lưới sản phẩm, CTA đáy, chỉ lệch vài số đo nhỏ).

**Web:** KHÔNG migrate trang web shop đợt này (dự án con 4 sẽ làm cả web lẫn phần miniapp còn lại) — nhưng `packages/design-tokens` PHẢI publish xong để dự án con 4 dùng ngay, không làm lại kiến trúc.

**Không đổi trong dự án con này:** logic nghiệp vụ, API contract, cấu trúc route — chỉ đổi lớp trình bày (token/component/style). Nếu phát hiện bug nghiệp vụ trong lúc migrate (như audit đã liệt kê ở A4-06 gian hàng CTV thiếu giá giờ vàng/trạng thái hết hàng), SỬA LUÔN vì đang đụng đúng file đó.

---

## 8. Ruling (quyết định thay chủ shop cho câu hỏi audit nêu, không đáng dừng lại hỏi)

| # | Câu hỏi audit nêu | Ruling |
|---|---|---|
| 1 | Xoá `design-system/tubu-tree/MASTER.md` (nguồn sai — cyan/Rubik/Claymorphism/"Language Learning App")? | Xoá, đánh dấu `design_handoff/README.md` và `SPEC:1792,1839` (§7.2) là lỗi thời. Spec này là nguồn duy nhất từ nay. |
| 4 | Giữ ZaUI hay tự dựng lại? | Giữ ZaUI, chỉ theme lại (khuyến nghị của audit). |
| 3 | Đầu tư bộ minh hoạ riêng thay emoji game/hạng? | CHƯA — ngoài phạm vi, chi phí lớn (audit gắn nhãn "L"). Emoji khu game/hạng tiếp tục được miễn như audit đã chấp nhận. |
| 5b | Merchant chọn màu gian hàng tự do hay giới hạn? | Giới hạn 4-6 accent đã duyệt sẵn contrast — audit chỉ ra tự do đang gây theme không nhãn/lệch chuẩn giữa web và miniapp. |
| 7 | Mở lại pinch-zoom? Chữ to ×1,25 hay ×1,5? | Coi là vá lỗi tuân thủ SPEC gốc (đã yêu cầu ×1,5 + không khoá zoom từ đầu, code hiện chưa làm đúng) — không phải quyết định mới, làm theo SPEC. |
| 8 | Brand-story "bản đồ gỗ 3D" giữ hay vẽ phẳng lại? | Ngoài phạm vi luồng thí điểm — để dự án con sau. |
| 9 | Theme navy đại lý có trong DS v2? | Thiết kế SẴN cơ chế `[data-theme]` ở token (mục 3), nhưng KHÔNG áp dụng nội dung/trang đại lý trong dự án con này (dự án con 6). |

---

## 9. Kiểm thử

Playwright (theo quyết định roadmap gốc — chỉ Playwright, không cần công cụ khác): snapshot/contrast check cho 5 trang migrate + `StorePage`; test tương tác Button loading state (sửa lỗi A4-04: 96/110 nút không hiện spinner); test `ListRow` cả hàng nhận press (sửa lỗi primitives.tsx cũ); test responsive tại 375px (mobile) tối thiểu.
