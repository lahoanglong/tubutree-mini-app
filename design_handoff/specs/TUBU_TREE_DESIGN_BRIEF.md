# TUBU TREE — Design Brief

**Tài liệu thiết kế (Design Brief) — v1.0**

> **Mục tiêu file này:** Đưa cho Claude (hoặc designer) để **tạo ra Design System + thiết kế cho Zalo Mini App + Web shop** trước khi đưa vào Claude Code triển khai.
>
> **Tài liệu liên quan:** `TUBU_TREE_SPEC_v1.1.md` (đặc tả kỹ thuật + nghiệp vụ chi tiết). File này chỉ tập trung vào **vấn đề thiết kế trực quan**, không lặp lại logic nghiệp vụ — designer cần đọc spec để hiểu flow đầy đủ.

---

## 0. Mục lục

1. Bối cảnh & Brand DNA
2. User personas (Avatar người dùng)
3. Design principles (Nguyên tắc thiết kế)
4. Visual identity (Màu, font, ảnh, icon, illustration)
5. Design tokens (variables để code-ready)
6. Component library (atomic design)
7. Screen inventory — Zalo Mini App
8. Screen inventory — Shop Web (PWA)
9. Screen inventory — Admin nội bộ
10. UX flows quan trọng (chi tiết step-by-step)
11. Microinteractions & animation guidelines
12. Voice & tone (writing style)
13. Empty states, error states, loading states
14. Accessibility checklist
15. Deliverables (file Figma cần giao)
16. Quy trình review & approval

---

## 1. Bối cảnh & Brand DNA

### 1.1 Tubu Tree là ai?

**Tubu Tree** là nhà phân phối đa thương hiệu các sản phẩm thiên nhiên Việt Nam. Tagline chính thức: **"Sống xanh An Lành"**.

**10 thương hiệu đối tác hiện tại** (mỗi brand có signature riêng):

| Brand | Ngành hàng | Vùng nguyên liệu | Signature ingredient |
|-------|-----------|------------------|----------------------|
| **Visante** | Mỹ phẩm chăm sóc tóc/da/cơ thể | Quảng Nam | Sâm Việt Nam |
| **Pơ Lang** | Mỹ phẩm dưỡng da/môi | Đắk Lắk | Bơ, gấc ép lạnh |
| **Cobote** | Mỹ phẩm + dầu dừa | Bến Tre | Dừa nguyên chất |
| **Fuwa3e** | Tẩy rửa sinh học | Đồng Tháp | Enzyme từ vỏ dứa |
| **Baby Care** | Tẩy rửa cho bé | — | An toàn trẻ sơ sinh |
| **Umikai** | Sản phẩm tẩy rửa cao cấp | — | — |
| **BH.Nong** | Thực phẩm/gạo lứt | Quảng Nam | Gạo lứt nảy mầm |
| **Sokfram** | Mật hoa dừa | Trà Vinh | Mật hoa dừa tự nhiên |
| **Le Plateau Coffee** | Cà phê | Lâm Đồng | Cà phê cao nguyên |
| **The Moshav Farm / Hector** | Thực phẩm/quà tặng | Đa vùng | Đặc sản theo mùa |

### 1.2 Brand DNA cốt lõi

> Đây là kim chỉ nam cho mọi quyết định thiết kế. Khi phân vân, quay về đây.

| Trục | Là gì | KHÔNG phải là gì |
|------|-------|------------------|
| **Cảm giác chính** | An lành, ấm áp, gần gũi với thiên nhiên | Sang chảnh xa cách, công nghệ lạnh lùng |
| **Ngôn ngữ** | Thân thuộc, kể chuyện như bạn bè | Nhà thuốc lạnh lùng, marketing đại trà |
| **Hình ảnh** | Ảnh thật, nắng tự nhiên, vùng nguyên liệu Việt Nam, bàn tay người làm | Stock photo phương Tây, model trắng sáng nhân tạo |
| **Màu chủ đạo** | Xanh lá thiên nhiên + đất sét + nắng vàng | Đen huyền bí + đỏ lạnh + xanh tech bright |
| **Tinh thần** | Sống chậm, bền vững, tử tế với đất | Fast fashion, urgent sale, dopamine hit |
| **Cộng đồng** | Mẹ và bé, gia đình Việt 3 thế hệ, người yêu thiên nhiên | Single sành điệu thành thị, tiêu dùng phô trương |

### 1.3 Differentiation so với đối thủ

| App | Cảm giác hiện tại | Tubu Tree cần khác |
|-----|--------------------|---------------------|
| **Sinh Dược mini app** | Đầy đủ chức năng nhưng UI rời rạc, màu sắc mạnh, nhiều icon emoji thô, layout dày | Tinh tế hơn, ít noise hơn, khoảng trắng nhiều hơn, chữ Việt đẹp |
| **Shopee/Lazada** | Loud, đỏ sale, urgency cao, FOMO | Calm, ưu tiên chuyện kể, không deadline |
| **The Body Shop / L'Occitane** | Sang trọng nhưng phương Tây | Việt Nam, thân thiện, không cao quá |
| **Cocoon** | Cùng phân khúc, brand mạnh, UI tốt | Đa thương hiệu (không bị giới hạn 1 dòng) → cần "marketplace cộng đồng các thương hiệu Việt" |

**Một câu mô tả mục tiêu thiết kế:**

> *"Mở mini app Tubu Tree giống như bước vào một khu vườn an lành — có chỗ ngồi xem, có chỗ chọn đồ, có người kể chuyện về vùng đất tạo ra sản phẩm — KHÔNG giống một siêu thị online đỏ vàng nhấp nháy."*

---

## 2. User Personas

> 4 personas chính, được chia theo cách họ tương tác với app. Mỗi screen design cần hỏi *"Persona này dùng được không?"*.

### 2.1 Persona A — Linh, Mẹ trẻ (29 tuổi, primary)

- **Việc làm:** Marketing executive, nghỉ chế độ thai sản đã quay lại làm.
- **Sống ở:** Quận 7, TPHCM. Chung cư.
- **Con:** 1 bé 8 tháng tuổi.
- **Thu nhập:** 25tr/tháng (cả vợ chồng ~50tr).
- **Pain points:**
  - Sợ hoá chất ảnh hưởng con.
  - Không có thời gian đọc nhiều, cần thông tin nhanh và đáng tin.
  - Mua đồ online qua Zalo của shop quen, không muốn cài app mới.
  - Đã từng bị mua nhầm hàng giả → cần niềm tin về chính hãng.
- **Goals:**
  - Tìm sản phẩm AN TOÀN cho con (dầu gội cho bé, nước rửa bình sữa, sữa tắm rôm sảy).
  - Trải nghiệm mua hàng "không phải nghĩ" — vào, thấy đúng món, mua.
  - Nhận hàng nhanh.
- **Dùng device gì:** iPhone 13 Pro, Zalo + Tiktok + Shopee thường xuyên.
- **Khi nào mở mini app:** lúc cho con bú đêm, lúc đi grab, trưa nghỉ ăn.
- **Phân loại trong app:** `CUSTOMER`, segment `mom_baby`.

**Design implication:**
- Trang chủ phải gợi ý "Cho mẹ và bé" ở vị trí ưu tiên.
- Filter "An toàn cho trẻ sơ sinh" rõ ràng.
- Mọi sản phẩm phải có badge "Lành tính / Mẹ bầu dùng được / Có thử nghiệm da" hiển thị to.
- Tốc độ load < 2s vì cô vào bằng tay 1 (đang bế con).

### 2.2 Persona B — Trang, CTV bán hàng (35 tuổi, primary)

- **Việc làm:** Nội trợ + bán hàng online qua Facebook/Zalo Personal.
- **Sống ở:** Biên Hoà, Đồng Nai. Nhà riêng.
- **Thu nhập:** từ bán hàng 8-15tr/tháng, biến động.
- **Pain points:**
  - Phải nhập kho mới có thể bán → khó, vốn nặng → muốn affiliate.
  - Đã thử Zapi, Hodi Group, MWG affiliate — phức tạp, đối soát chậm.
  - Muốn share link nhanh sang Zalo + Facebook, có caption gợi ý sẵn.
  - Cần thấy NGAY hôm nay kiếm được bao nhiêu.
- **Goals:**
  - Kiếm thêm thu nhập ổn định không cần vốn.
  - Bán đồ "có tâm" cho cộng đồng mẹ bỉm sữa cô tham gia.
  - Lên hạng cao hơn để hoa hồng tốt hơn.
- **Dùng device gì:** Samsung A53, dùng Zalo PC + mobile song song.
- **Phân loại trong app:** `AFFILIATE`, hạng "Cộng tác viên Bạc".

**Design implication:**
- Dashboard hoa hồng PHẢI là màn hình đầu cô mở (khác Persona A).
- Số tiền hôm nay/tháng phải HIỆN TO ngay top fold.
- Progress bar lên bậc tiếp theo cần khích lệ, không gây stress.
- Nút "Chia sẻ ngay" + "Caption gợi ý" cực dễ thấy ở mọi sản phẩm.
- Có thể có chế độ "Tối giản" cho người không biết nhiều công nghệ.

### 2.3 Persona C — Anh Hùng, Đại lý (42 tuổi, primary)

- **Việc làm:** Chủ tiệm tạp hoá + nhà thuốc nhỏ ở Đắk Lắk.
- **Đã làm đại lý:** Pơ Lang được 2 năm, đang muốn lấy thêm Visante và Fuwa3e.
- **Pain points:**
  - Mỗi lần đặt hàng phải gọi điện hoặc nhắn Zalo cá nhân cho sale → lâu, lẫn lộn.
  - Không nhớ giá nhập của mình so với giá lẻ → khó tính lời.
  - Lo công nợ lẫn lộn.
  - Muốn xem báo cáo tháng/quý dễ dàng.
- **Goals:**
  - Đặt hàng NHANH, 1 mình tự làm được không cần qua sale.
  - Biết NGAY còn nợ bao nhiêu, hạn thanh toán khi nào.
  - Biết quý này đã đạt mục tiêu chưa → bonus bao nhiêu.
  - In bảng giá ra giấy để cho khách của mình xem.
- **Dùng device gì:** Oppo Reno8, dùng Excel + Zalo + Pancake POS.
- **Phân loại trong app:** `DEALER`, bậc "Cấp 2 — Đại lý phổ thông".

**Design implication:**
- App phải có **mode hoàn toàn khác** khi anh đăng nhập (xem mục 7).
- Bỏ hết "voucher, mua chung, vòng quay" — không phải thứ anh quan tâm.
- Bảng giá table dày + search + export Excel/PDF.
- Đặt nhanh: SKU code, paste từ Excel, lưu mẫu đơn.
- Theme tone xám-xanh navy (chứ không xanh lá tươi như mode B2C).

### 2.4 Persona D — Bác Liên, Người về hưu (58 tuổi, secondary)

- **Việc làm:** Đã nghỉ hưu, làm vườn, chăm cháu.
- **Pain points:**
  - Chữ nhỏ khó đọc.
  - Sợ ấn nhầm nút.
  - Hay nghe lời con dâu/bạn bè rồi mua.
  - Quan tâm sản phẩm "lành" cho cả nhà 3 thế hệ.
- **Design implication:**
  - Font tối thiểu phải ≥ 14px, có chế độ "Chữ to" (font scale 1.25x).
  - Nút CTA phải > 48dp touch target.
  - Tránh micro-interaction màu mè, nhanh quá.
  - Không bắt buộc tạo tài khoản phức tạp — chỉ cần SĐT/Zalo là xong.

### 2.5 Persona ma trận quyết định

Khi designer phân vân một quyết định, áp dụng bảng:

| Quyết định | Persona A (Mẹ Linh) | Persona B (CTV Trang) | Persona C (Anh Hùng) | Persona D (Bác Liên) |
|------------|---------------------|------------------------|----------------------|----------------------|
| Có nên dùng emoji không? | OK, vừa phải | OK | KHÔNG (B2B) | Vừa phải, dễ hiểu |
| Có nên có animation? | OK, nhẹ | OK | KHÔNG (làm chậm) | Hạn chế, dễ choáng |
| Density (mật độ thông tin) | Trung bình | Cao (dashboard) | Cao (table) | Thấp |
| Tốc độ ưu tiên | Cao | Cao | Cực cao | Trung bình |
| Hiển thị giá | Có sale strikethrough | Có % hoa hồng | Có giá nhập + giá lẻ | Lớn, rõ |


---

## 3. Design Principles

> 7 nguyên tắc xương sống. Mọi quyết định thiết kế phải đi qua được ít nhất 5/7.

### 3.1 Tự nhiên hơn là tiệt trùng
- Ưu tiên ảnh thật người làm sản phẩm thay vì 3D render.
- Texture có hạt nhẹ (paper grain) thay vì gradient bóng.
- Đường cong mềm thay vì góc vuông cứng.

### 3.2 Tử tế hơn là khẩn cấp
- KHÔNG dùng countdown đỏ, KHÔNG dùng "Chỉ còn 3 sản phẩm — Mua ngay!".
- Sale có nhưng êm: "Giảm giá tháng này" thay vì "FLASH SALE 24H".
- Notification dùng tone tâm sự, không lệnh.

### 3.3 Một bước, một mục đích
- Mỗi màn hình rõ 1 CTA chính (primary action).
- Tránh "nhồi" 5 thứ vào 1 banner.

### 3.4 Hiển thị niềm tin
- Mỗi sản phẩm có: nguồn nguyên liệu, chứng nhận, hạn dùng, ai sản xuất.
- "Đã có 1.234 khách mua" thay vì "Bestseller".
- Review thật có ảnh.

### 3.5 Mạnh tay với khoảng trắng
- Không sợ "thiếu nội dung" — khoảng trắng cho phép sản phẩm "thở".
- Tối thiểu padding 16px ngoài, gap 12-16px giữa các block.

### 3.6 Dùng được khi đang bế con
- Nút quan trọng phải bấm được bằng 1 ngón cái khi đang cầm điện thoại bằng 1 tay (vùng thumb-reach).
- CTA chính luôn nằm ở 1/3 dưới màn hình.

### 3.7 Tự hào Việt Nam, không "quê"
- Ngôn ngữ Việt chuẩn, văn vẻ nhẹ — KHÔNG cố ý "sai chính tả" để trẻ trung.
- Yếu tố Việt qua: chữ Việt đẹp (Be Vietnam Pro), ảnh vùng quê thật, từ vựng địa phương (vùng nguyên liệu) — KHÔNG qua emoji tre/nón lá thô.

---

## 4. Visual Identity

### 4.1 Logo

- **Logo chính:** "Tubu Tree" với 1 ký hiệu cây cách điệu. (Đã có sẵn — anh cung cấp file SVG/PNG để design team dùng làm gốc.)
- **Logo cho mini app icon (1024×1024):** chỉ icon cây, simplify, contrast tốt trên cả nền sáng và tối, đọc được ở size 48×48.
- **Clear space:** Tối thiểu = chiều cao của ký hiệu cây.
- **Minimum size:** 24px digital, 12mm in print.

### 4.2 Bảng màu (Color Palette)

> **Triết lý:** màu xanh lá làm chính (brand thiên nhiên), bổ trợ bằng đất sét ấm để tránh "lạnh tech". Có hệ phụ cho từng brand để brand carousel sống động.

#### Primary — Lá tươi (Green)
| Token | Hex | Dùng cho |
|-------|-----|----------|
| `green-50` | `#F1F8F2` | Nền nhẹ, badge bg |
| `green-100` | `#DDEDE0` | Card hover, tag bg |
| `green-200` | `#B5D6BD` | Border nhẹ, divider |
| `green-400` | `#5FA376` | Icon, link |
| `green-600` | `#2E7D4F` | **Primary brand, CTA chính** ⭐ |
| `green-700` | `#235F3D` | CTA hover/pressed |
| `green-900` | `#0F2D1C` | Heading trên nền sáng |

#### Secondary — Đất sét (Clay/Terracotta)
| Token | Hex | Dùng cho |
|-------|-----|----------|
| `clay-50` | `#FBF4ED` | Nền section đặc biệt |
| `clay-200` | `#EDD4BD` | Badge sale (mềm, không chát) |
| `clay-500` | `#C97B4A` | **Secondary accent** — voucher, hạng |
| `clay-700` | `#8C4F2A` | Text trên nền clay |

#### Accent — Nắng (Warm Yellow)
| Token | Hex | Dùng cho |
|-------|-----|----------|
| `sun-300` | `#FDD96E` | Game tokens, highlight |
| `sun-500` | `#F4B400` | Star rating, badge hạng cao |

#### Neutral — Trung tính
| Token | Hex | Dùng cho |
|-------|-----|----------|
| `neutral-0` | `#FFFFFF` | Surface chính |
| `neutral-50` | `#FAFAF8` | App background (warm white, không trắng tinh) |
| `neutral-100` | `#F2F2EF` | Card alt |
| `neutral-200` | `#E5E5E0` | Border |
| `neutral-400` | `#A8A8A0` | Placeholder, disabled |
| `neutral-600` | `#5F5F58` | Body text |
| `neutral-900` | `#1A1A17` | Heading |

#### Semantic
| Token | Hex | Dùng cho |
|-------|-----|----------|
| `success` | `#2E7D4F` (= green-600) | Success state |
| `warning` | `#E58B00` | Cảnh báo, hold |
| `danger` | `#C73E3E` | Lỗi, hủy đơn (dịu hơn red thông thường) |
| `info` | `#3D7BB8` | Thông báo |

#### Brand Accent (cho từng thương hiệu — dùng làm chip/tag/category card)
| Brand | Accent color | Hex |
|-------|-------------|-----|
| Visante | Sâm nâu đỏ | `#8B3A3A` |
| Pơ Lang | Bơ-cam | `#D4843E` |
| Cobote | Dừa kem | `#E8D9B5` (text dark trên) |
| Fuwa3e | Vàng dứa | `#E8B72C` |
| Baby Care | Xanh em bé | `#A8D8E8` |
| BH.Nong | Nâu lúa | `#7A5C3A` |
| Sokfram | Vàng mật | `#DCA84A` |
| Le Plateau Coffee | Nâu cà phê | `#4A2C20` |
| The Moshav | Xanh oliu | `#7A8B5C` |
| Hector | Xám trung tính | `#6B6B6B` |

#### Dark mode (Phase 2)
- Giữ nguyên brand accent, đổi neutral scale, giảm saturation primary green nhẹ (#3F9D67).

### 4.3 Typography

> **2 font chính, miễn phí, Việt đẹp:**

- **Display & UI:** [Be Vietnam Pro](https://fonts.google.com/specimen/Be+Vietnam+Pro) — chữ Việt có dấu sắc nét, modern, dễ đọc. Dùng cho mọi UI element + heading.
- **Body dài (story, blog post):** [Inter](https://fonts.google.com/specimen/Inter) — cho đoạn văn dài, neutral, dễ đọc.

#### Type scale

| Token | Size (mobile) | Size (desktop) | Line height | Weight | Dùng cho |
|-------|---------------|----------------|-------------|--------|----------|
| `display-lg` | 32px | 48px | 1.15 | 700 | Hero heading homepage |
| `display-md` | 28px | 36px | 1.2 | 700 | Section heading |
| `h1` | 24px | 28px | 1.25 | 700 | Page title |
| `h2` | 20px | 22px | 1.3 | 600 | Subsection |
| `h3` | 18px | 18px | 1.35 | 600 | Card title |
| `body-lg` | 16px | 16px | 1.5 | 400 | Body chính |
| `body-md` | 14px | 14px | 1.5 | 400 | Body phụ, meta |
| `body-sm` | 13px | 13px | 1.45 | 400 | Caption, label |
| `label` | 12px | 12px | 1.3 | 500 | Form label, tag |
| `mono` | 14px | 14px | 1.4 | 500 | SKU, order code (font mono: JetBrains Mono) |

**Quy tắc:**
- Tối đa 3 weight trên 1 màn hình.
- Heading dùng weight 700, body 400, emphasis 500-600.
- Không bao giờ dùng all-caps cho đoạn văn (chỉ cho label ngắn ≤ 3 từ).

### 4.4 Ảnh chụp (Photography Direction)

> **Đặt hàng nhiếp ảnh theo brief này.** Đừng dùng stock photo.

#### Ảnh sản phẩm (Product shots)
- Nền: **giấy kraft thật**, **gỗ mộc**, hoặc **vải linen** — không nền trắng tinh studio.
- Ánh sáng: **nắng sáng tự nhiên hắt nghiêng** (golden hour), có bóng nhẹ — không flat studio.
- Phụ kiện: **lá, hoa, hạt thật của vùng nguyên liệu** (lá sâm cho Visante, quả bơ cho Pơ Lang...).
- Tỷ lệ: **1:1** cho thumbnail, **4:5** cho feature, **16:9** cho banner.
- Hậu kỳ: giữ texture, giảm clarity slider, **không retouch quá mượt** — sản phẩm Việt tự hào về sự "thật".

#### Ảnh lifestyle
- Người Việt thật, **đa độ tuổi** (đặc biệt có người già + trẻ con + mẹ trẻ — đại diện 3 thế hệ).
- Bối cảnh nhà Việt: bếp, sân vườn, hiên nhà, chợ quê.
- KHÔNG: white background, model mặc đồ Tây sang chảnh, studio chrome.

#### Ảnh vùng nguyên liệu
- Đây là **kho ảnh quý nhất** cho Brand Story Map (mục 7.14.2 spec).
- Mỗi vùng tối thiểu **5 ảnh**: toàn cảnh ruộng/vườn, cận cảnh người làm việc, sản phẩm thô, sản phẩm đang chế biến, sản phẩm thành phẩm tại nơi sản xuất.

### 4.5 Iconography

#### Icon library chính
**[Lucide Icons](https://lucide.dev)** — open source, > 1500 icon, design ngất ngơ phù hợp brand thiên nhiên.

**Style rule:**
- Stroke width: 1.75
- Size: 16 / 20 / 24 / 32px
- Corner radius: 2px (mềm)
- Không dùng filled icon trừ khi state active

#### Icon custom cần vẽ riêng
| Icon | Lý do | Mô tả |
|------|-------|-------|
| **Tubu Leaf** | Logo nhỏ | Lá đơn cách điệu |
| **Hạt giống (Seed)** | Game currency | Hạt mọc mầm |
| **Cây 10 cấp** | Game tree growth | Từ mầm → cây trưởng thành (10 trạng thái) |
| **Điểm Xanh** | Loyalty | Lá tròn |
| **Vùng nguyên liệu** | Brand Story Map | Pin có lá |
| **Hạng Mầm Xanh/Lộc Biếc/Đại Thụ/Cổ Thụ** | Membership badges | 4 hình ảnh cây phát triển |
| **Cộng tác viên các bậc** | CTV tiers | 5 huy hiệu (Tân binh → Kim Cương) |
| **Đại lý 4 bậc** | Dealer tiers | 4 huy hiệu B2B |

### 4.6 Illustration

- **Style:** flat illustration **có texture giấy nhẹ**, color palette chính của brand.
- Tham khảo: thiết kế của **Notion Vietnam**, **MoMo "Hoàn tiền"**, **Tiki Sách** — modern flat nhưng có hồn.
- KHÔNG dùng: 3D blob, neumorphism, claymorphism, glassmorphism — quá tech, không hợp brand.

#### Illustration cần thiết
1. Empty cart "Giỏ hàng đang trống" — 1 cái rổ tre với 1 chiếc lá.
2. Empty wishlist — cây non chưa nở.
3. Onboarding hero — vườn xanh với 6 cây = 6 vùng nguyên liệu.
4. Success order — 1 gói hàng được bọc giấy + sticky note "Cảm ơn".
5. Error 404 — chú chim đậu trên cành tìm tổ.
6. Loading — animated leaf falling slow.

### 4.7 Tone of motion

- **Duration:** 200ms cho micro, 300-400ms cho transition, KHÔNG vượt 500ms.
- **Easing:** chủ yếu `ease-out` (cảm giác "lá rơi"), tránh `ease-in-out` cứng.
- **Spring physics:** chỉ dùng cho game (cây lớn lên, vòng quay).
- **Reduced motion:** tôn trọng setting OS, disable mọi animation phụ trợ.

---

## 5. Design Tokens (Code-ready)

> File này được implement thành `tokens.json` (Style Dictionary) → export sang `tailwind.config.js` + CSS variables + Figma Tokens plugin.

### 5.1 Spacing scale (8pt grid)
```
space-0:   0px
space-1:   4px
space-2:   8px
space-3:   12px
space-4:   16px   ← default gap
space-5:   20px
space-6:   24px
space-8:   32px
space-10:  40px
space-12:  48px
space-16:  64px
space-20:  80px
```

### 5.2 Radius
```
radius-none:  0px
radius-sm:    6px    (chip, tag)
radius-md:    10px   ← default cho input, button
radius-lg:    16px   (card)
radius-xl:    24px   (bottom sheet, modal)
radius-full:  9999px (pill, avatar)
```

### 5.3 Shadow / Elevation
```
shadow-xs:   0 1px 2px rgba(15,45,28,0.04)
shadow-sm:   0 2px 6px rgba(15,45,28,0.06)            ← card mặc định
shadow-md:   0 4px 12px rgba(15,45,28,0.08)           ← elevated card
shadow-lg:   0 12px 32px rgba(15,45,28,0.12)          ← modal, dropdown
shadow-focus:0 0 0 3px rgba(46,125,79,0.25)          ← focus ring
```

> **Không dùng pure black shadow** — dùng tint xanh đậm để tự nhiên hơn.

### 5.4 Breakpoints (cho Web shop)
```
sm:   640px
md:   768px    ← tablet
lg:   1024px   ← desktop default
xl:   1280px
2xl:  1536px
```

### 5.5 Z-index scale
```
z-base:       0
z-dropdown:   10
z-sticky:     20
z-overlay:    30
z-modal:      40
z-popover:    50
z-toast:      60
z-tooltip:    70
```

### 5.6 Mini app constraints riêng

> Zalo Mini App có giới hạn riêng — designer cần biết.

- **Viewport:** rộng 375px (iPhone) → 414px (Plus). Safe area top 44pt (notch), bottom 34pt.
- **Top header bar (do Zalo provide):** ~44pt, không design vào.
- **Bottom tab bar (designer tự design):** 56pt + safe area.
- **Modal trong mini app:** Bottom sheet pattern thường tốt hơn center modal.
- **Không có swipe-back gesture từ edge** ở Android — cần nút back tường minh.


---

## 6. Component Library (Atomic Design)

> Đầy đủ component cho design system. Phân theo atomic design: Atom → Molecule → Organism → Template → Page. Mỗi component liệt kê: variants, states, props quan trọng.

### 6.1 Atoms (cơ bản)

#### Button
- **Variants:** `primary` (green-600), `secondary` (outlined green), `tertiary` (text only), `danger`, `clay` (cho voucher/sale)
- **Sizes:** `sm` (32px), `md` (44px default), `lg` (52px)
- **States:** default, hover, pressed, focused, disabled, loading
- **Width:** auto, full-width (mobile thường full-width cho primary CTA)
- **Icon:** trái, phải, hoặc chỉ icon (icon-only)

#### Input
- **Variants:** text, password, number, phone, OTP (6 ô), search
- **States:** default, focused, error, disabled, success (checkmark)
- **Affixes:** prefix icon, suffix icon, clear button, character counter
- **Helper text** + **error text** layout

#### Select / Dropdown
- Native cho mobile (UX tốt hơn) + custom cho web.
- Search trong dropdown khi > 10 option.

#### Checkbox & Radio
- Touch target 24px hit area mở rộng đến 44px.

#### Switch (Toggle)
- Cho setting (thông báo, dark mode), không cho lựa chọn quan trọng.

#### Chip / Tag
- **Variants:** filter (clickable, có state selected), info (read-only), brand chip (gắn brand color)

#### Badge
- Số đỏ trên icon (cart, notification).
- Brand badge (Visante, Pơ Lang...).
- Trạng thái (Mới, Sale, Hết hàng).

#### Avatar
- Sizes: 24, 32, 40, 56, 80px.
- Fallback: chữ cái đầu tên trên nền green-100.

#### Divider
- Solid + dashed. Default neutral-200.

#### Skeleton loader
- Animated shimmer. Cho card, list item, image, text line.

#### Toast / Snackbar
- Top hoặc bottom. Auto-dismiss 3s. Có nút action (vd "Hoàn tác").
- Variants: info, success, warning, error.

#### Spinner / Progress
- Loading inline (button) + page-level + linear progress (upload, checkout step).

### 6.2 Molecules (kết hợp)

#### ProductCard
> Component quan trọng nhất — dùng nhiều nhất.

**3 layout variants:**

1. **Vertical (grid)** — dùng cho catalog grid 2 cột
   ```
   ┌──────────────────┐
   │   [Ảnh 1:1]      │
   │   ●Sale badge    │
   │                  │
   ├──────────────────┤
   │ ⓦ Visante       │  ← brand chip
   │ Dầu Gội Sâm     │  ← name (2 lines max)
   │ Visante 500ml    │
   │                  │
   │ ★4.8 (124)       │  ← rating + count
   │                  │
   │ 280k ̶3̶4̶9̶k̶  -20%  │  ← price + crossed + discount
   │                  │
   │  [+ Add to cart] │  ← CTA
   └──────────────────┘
   ```

2. **Horizontal (list)** — cho search results, wishlist
3. **Compact (mini)** — cho "Sản phẩm thường mua kèm"

**States:** in-stock, low-stock (badge "Còn 3"), out-of-stock (overlay gray + label), pre-order.

**CTV variant:** thêm dòng "Hoa hồng: +12.5% (35k)" nổi bật, nút "Chia sẻ" thay thế "Add to cart".

**Dealer variant:** không show rating + review, hiện "Giá nhập: 130.000đ / Còn 24 cái / SKU: VST-DG-500".

#### PriceTag
- Hiển thị giá hiện tại + giá gốc (gạch ngang) + % giảm + range giá (cho variation).
- Variant "Affiliate" hiển thị thêm hoa hồng dự tính.

#### QuantitySelector
- `- [1] +` với touch target lớn.
- Khi đạt min/max disable nút tương ứng.

#### Address Card
- Tên người nhận, SĐT, địa chỉ đầy đủ.
- Badge "Mặc định", nút Sửa, Xóa.

#### OrderItem
- Ảnh + tên + variation + qty + giá. Layout list.

#### Step Indicator (Checkout)
- 3 bước: Giỏ → Địa chỉ → Thanh toán. Có progress.

#### TabBar (Bottom Navigation)
- 5 tabs với icon + label. Active state: green-600.

#### SegmentedControl
- "B2C / Đại lý" toggle. "Hoa hồng / Cashback" tab trong wallet.

#### EmptyState
- Illustration + heading + body text + CTA. Components reusable cho mọi empty case.

#### FilterChip Group (horizontal scroll)
- Brand, giá, công dụng — scrollable horizontal.

#### Notification Item
- Icon + title + body 1 line + timestamp + dot unread.

#### ReviewCard
- Avatar + rating sao + tên + "Đã mua" badge + body + ảnh thumbnail strip + reaction button.

### 6.3 Organisms (lớn hơn)

#### Header
**Variants:**
- Mini app — không có header (Zalo provide), chỉ có pseudo-header trong page
- Web mobile — sticky top, có logo + search icon + cart badge
- Web desktop — full nav với menu chính

#### BottomSheet
- Slide từ dưới lên, có drag handle. Dùng cho: chọn variation, áp voucher, xác nhận hủy đơn.

#### Modal
- Center overlay. Chỉ dùng cho important confirm (Logout, Hủy đơn lớn).

#### ProductGallery (PDP)
- Carousel ảnh full-width (1:1) + thumbnail strip + pinch-zoom + share button.

#### VariationSelector (PDP)
- Cho dung tích / hương / màu. Hiển thị giá thay đổi realtime.

#### CartSummary
- Subtotal, voucher applied, shipping fee, total. Sticky bottom với CTA Checkout.

#### CheckoutAddressBlock
- Address card + nút "Đổi địa chỉ" → mở list.

#### PaymentMethodList
- Radio list: COD, ZaloPay, Bank, Credit Card. Logo cho mỗi method.

#### OrderStatusTimeline
- Vertical timeline với 5 step: Đã đặt → Xác nhận → Đóng gói → Vận chuyển → Giao thành công. Có thời gian thật.

#### LoyaltyTierProgress
> **Phần đặc biệt — cần thiết kế hấp dẫn để khuyến khích lên hạng.**
- Cây nhỏ → cây lớn (visual metaphor).
- Progress bar có gradient từ green-200 → green-600.
- "Còn 3.500.000đ để lên Đại Thụ" — micro-copy khích lệ.

#### AffiliateDashboardWidget
> **Persona B (CTV Trang) dùng nhiều nhất — cần đẹp và thông tin nén.**

Layout đã design ở SPEC mục 7.8.3 — designer mở rộng:
- Card lớn "Bậc hiện tại" với badge huy hiệu + % bonus.
- Card "Doanh số tháng" với progress bar đẩy bậc.
- Card "Số dư" với 2 nút Rút STK / Chuyển Ví Tubu ×1.5.
- KPI strip 4 con số.
- Bar chart 30 ngày qua.
- List đơn gần nhất với commission breakdown.

#### CashbackMerchantGrid
- Grid logo merchant (Shopee, Lazada, Tiki...) 3 cột.
- Mỗi ô: logo + tên + "Hoàn 3.5%" badge + nút.

#### GameSpinWheel
- Vòng quay 9 phần. Phần thưởng hiển thị rõ.
- Animation quay 3-4s + easing slow-out ở cuối.
- Pop-up "Bạn nhận được X" với confetti.

#### TreeGardenView
- Khu vườn ảo isometric. Cây xếp grid 2-3 cột.
- Mỗi cây thuộc brand riêng với accent color.
- Cây có 10 stage growth (illustration sequence).
- Nút "Tưới" + animation lá lung lay.

#### BrandStoryMap
- Bản đồ Việt Nam SVG.
- 6 hotspot tỉnh có brand. Tap → popup story.

#### DealerPriceTable
> **Persona C (Anh Hùng) cần — cần dày, chuyên nghiệp.**
- Table có: SKU, Tên rút gọn, Giá lẻ, Giá nhập, Chiết khấu %, Tồn, [Đặt].
- Sticky header, sort, filter.
- Row hover/active.

#### QuickOrderBar (Dealer)
- Input SKU lớn + Quantity input + nút "Thêm". Enter để confirm fast.
- "Paste từ Excel" button mở textarea.

### 6.4 Templates (layout chuẩn)

| Template | Cấu trúc | Dùng cho |
|----------|----------|----------|
| `MiniAppListing` | Header pseudo + filter chip strip + grid 2 cột + bottom tab | Catalog, search results |
| `MiniAppDetail` | Gallery + info + sticky bottom CTA | PDP |
| `MiniAppForm` | Header + form fields + sticky submit | Checkout step, dealer apply |
| `MiniAppDashboard` | Header + scroll cards | Home, Affiliate Dashboard |
| `WebShopGrid` | Top nav + breadcrumb + sidebar filter + grid 4 cột | Web catalog |
| `WebShopDetail` | 2 cột (gallery trái, info phải sticky) | Web PDP |
| `WebCheckout` | 2 cột (form trái, summary phải sticky) | Web checkout |
| `AdminTable` | Header + filter bar + table + pagination | Mọi list trong admin |
| `AdminForm` | Header + sections + save bar | Edit product, edit coupon |

---

## 7. Screen Inventory — Zalo Mini App

> Tất cả màn hình cần thiết kế. Designer xem mục này để biết deliverables. Mỗi screen có: tên, mục đích, key elements, persona target, priority (P1 = MVP, P2 = sau MVP).

### 7.1 Onboarding & Auth (4 màn)

| # | Screen | Persona | Priority | Key elements |
|---|--------|---------|----------|--------------|
| 1 | Splash / Welcome | All | P1 | Logo animation, tagline "Sống xanh An Lành" |
| 2 | Permission request (Zalo userInfo + phone) | All | P1 | Card giải thích vì sao cần, đẹp + minh bạch |
| 3 | Onboarding Quiz 5 câu | All B2C | P1 | Mỗi câu 1 màn, illustration, có nút skip |
| 4 | Welcome bonus celebration | All B2C | P1 | "Tặng bạn voucher 30k!" + confetti |

### 7.2 B2C Mode (Persona A, B, D)

#### 7.2.1 Home & Navigation
| # | Screen | Priority | Notes |
|---|--------|----------|-------|
| 5 | Home (segment-based) | P1 | Hero banner + brand carousel + "Cho bạn" + "Sale" + "Mới về" |
| 6 | Brand Carousel chi tiết | P1 | 10 brand horizontal scrollable, mỗi brand có accent color khác |
| 7 | Category overview | P1 | Grid icon categories |
| 8 | Search + suggestion | P1 | Recent searches + trending + autocomplete |
| 9 | Search results | P1 | Grid + sort + filter |

#### 7.2.2 Catalog & Product
| # | Screen | Priority | Notes |
|---|--------|----------|-------|
| 10 | Brand page (vd Visante) | P1 | Brand hero + story snippet + grid sản phẩm |
| 11 | Category page | P1 | Filter sidebar (bottom sheet on mobile) |
| 12 | Product Detail (PDP) | P1 | Gallery + variation + ingredient + review tab + sticky CTA |
| 13 | Product Detail — variation modal | P1 | Bottom sheet chọn dung tích/hương |
| 14 | Reviews full list | P2 | Filter theo rating, có ảnh |
| 15 | Ingredient detail | P2 | Mỗi thành phần có % + benefit + nguồn |

#### 7.2.3 Cart & Checkout
| # | Screen | Priority | Notes |
|---|--------|----------|-------|
| 16 | Cart | P1 | Items + voucher input + summary |
| 17 | Voucher list (bottom sheet) | P1 | Available + locked + có thể save dùng sau |
| 18 | Checkout step 1: Address | P1 | List địa chỉ + thêm mới |
| 19 | Checkout step 2: Shipping & invoice | P1 | Chọn ship + toggle "Xuất hóa đơn VAT" + form MST |
| 20 | Checkout step 3: Payment | P1 | Radio list method + summary cuối |
| 21 | Order placed success | P1 | Illustration + order code + 2 CTA (Theo dõi đơn, Tiếp tục mua) |
| 22 | Payment processing (ZaloPay) | P1 | Loading + brand ZaloPay |
| 23 | Payment failed | P1 | Empathetic copy + nút thử lại |

#### 7.2.4 Orders & Profile
| # | Screen | Priority | Notes |
|---|--------|----------|-------|
| 24 | My Orders list | P1 | Filter theo status, group theo ngày |
| 25 | Order Detail | P1 | Timeline + items + summary + nút (Cancel/Track/Reorder/Issue Invoice/Return) |
| 26 | Track shipping detail | P1 | Timeline chi tiết từ Pancake |
| 27 | Return request form | P1 | Reason + ảnh + video upload |
| 28 | Profile / Cá nhân | P1 | Avatar + tier badge + menu (Đơn hàng, Voucher, Điểm, Cài đặt, OA chat, Đăng xuất) |
| 29 | Edit profile | P1 | Tên, DOB, gender, email |
| 30 | Address book | P1 | List + thêm/sửa/xóa |
| 31 | Notifications inbox | P1 | List + đánh dấu đã đọc + setting |

#### 7.2.5 Loyalty & Game
| # | Screen | Priority | Notes |
|---|--------|----------|-------|
| 32 | Loyalty Dashboard | P1 | Tier visual + progress + history + benefits |
| 33 | Points transaction history | P1 | List + filter |
| 34 | Voucher list (saved) | P1 | Active + expired tab |
| 35 | Game Home / Hub | P1 | Khu vườn + check-in CTA + vòng quay + quiz + missions |
| 36 | Daily check-in modal | P1 | Animation tặng hạt giống + streak counter |
| 37 | Tree Garden detail | P1 | Khu vườn ảo, tap cây để xem chi tiết, nút "Tưới" |
| 38 | Tree level-up celebration | P1 | Cây lớn lên + reward unlock animation |
| 39 | Spin wheel | P1 | Vòng quay + result popup |
| 40 | Quiz daily | P1 | Card swiper 5 câu + kết quả tổng |
| 41 | Missions list | P1 | List + progress bar + claim button |
| 42 | Leaderboard tháng | P2 | Top 10 + your rank |
| 43 | Brand Story Map | P1 | VN map + popup mỗi vùng |
| 44 | Vùng nguyên liệu detail | P1 | Story full + video + ảnh + "Cây tôi đã trồng" |

#### 7.2.6 Wallet & Affiliate
| # | Screen | Priority | Notes |
|---|--------|----------|-------|
| 45 | Wallet overview | P1 | 3 số: Withdrawable / Tubu Wallet / Pending. 2 CTA chính. |
| 46 | Withdraw flow | P1 | Chọn method → nhập STK → confirm |
| 47 | Convert to Tubu Wallet (×1.5) modal | P1 | Hiển thị tính toán + confirm |
| 48 | Affiliate signup | P1 | Terms + benefits + nút "Trở thành CTV" |
| 49 | Affiliate Dashboard | P1 | (Đã mô tả 6.3) |
| 50 | Affiliate links list | P1 | Stats từng link, copy/share |
| 51 | Share product modal | P1 | 3 dạng link (deeplink/web/QR) + caption gợi ý |
| 52 | Commission history | P1 | List + filter status |
| 53 | Withdraw history | P1 | List + status |
| 54 | Affiliate leaderboard | P2 | Top 20 CTV tháng |

#### 7.2.7 Cashback (sàn ngoài)
| # | Screen | Priority | Notes |
|---|--------|----------|-------|
| 55 | Cashback home / Merchant grid | P1 | Grid logo + tỉ lệ hoàn |
| 56 | Merchant detail | P1 | % chi tiết + điều khoản + nút "Mua sắm hoàn tiền" |
| 57 | Outgoing redirect (loading) | P1 | "Đang chuyển đến Shopee..." |
| 58 | Cashback transactions | P1 | 3 trạng thái: Pending / Confirmed / Paid |

### 7.3 Dealer Mode (Persona C) — KHÁC HẲN B2C

> Khi user role `DEALER` mở app, vào thẳng Dealer Home. Theme navy-gray. KHÔNG có game, voucher cá nhân, cashback.

| # | Screen | Priority | Notes |
|---|--------|----------|-------|
| 59 | Dealer Application form | P1 | Multi-step: business info → upload doc → review |
| 60 | Dealer Application status (pending) | P1 | Timeline xét duyệt |
| 61 | Dealer Home | P1 | Doanh số tháng/quý + thông báo + nút "Đặt nhanh" + quick stats |
| 62 | Price list (Bảng giá) | P1 | Table dày + search + filter brand + sort |
| 63 | Quick Order | P1 | SKU input + qty + autocomplete + paste-from-excel button |
| 64 | Order templates | P1 | List mẫu đơn đã lưu + Sử dụng / Sửa / Xóa |
| 65 | Cart B2B | P1 | Items + tổng + chọn ngày giao |
| 66 | Place dealer order | P1 | Confirm + công nợ check |
| 67 | Dealer orders list | P1 | Filter status + filter quý |
| 68 | Dealer order detail | P1 | Items + invoice + shipping + công nợ tác động |
| 69 | Credit ledger (Công nợ) | P1 | Số dư hiện tại + hạn thanh toán + list giao dịch |
| 70 | Report payment | P1 | Upload ảnh ủy nhiệm chi |
| 71 | Quarterly report | P2 | Doanh số quý + bonus dự kiến + tiến độ mục tiêu |
| 72 | Switch to retail mode (toggle) | P1 | Small UI toggle ở top |

### 7.4 Common / Cross-cutting

| # | Screen | Priority | Notes |
|---|--------|----------|-------|
| 73 | Settings | P1 | Notification toggle, language, dark mode, font size, privacy |
| 74 | About Tubu Tree | P1 | Story + mission + team + contact |
| 75 | FAQ / Help center | P1 | Categorized Q&A + chat OA shortcut |
| 76 | Terms & Privacy | P1 | Long text scroll, có TOC |
| 77 | Delete account | P1 | Confirm flow (PDPL compliance) |
| 78 | Error pages (network, 404, 500) | P1 | Illustration + retry |
| 79 | App version / changelog | P2 | Cho user thấy update mới |

**Tổng: 79 screen** cho mini app phase 1.


---

## 8. Screen Inventory — Shop Web (PWA)

> Tổng: ~45 screen. Web share design language với mini app nhưng tận dụng không gian rộng hơn (multi-column).

### 8.1 Public pages (SEO-critical)
| # | Screen | Priority |
|---|--------|----------|
| W1 | Home (landing) | P1 |
| W2 | Brand landing (vd `/visante`) | P1 |
| W3 | Category landing | P1 |
| W4 | Product detail (2-col: gallery left, info right) | P1 |
| W5 | Search results | P1 |
| W6 | Câu chuyện (Story) | P1 |
| W7 | About Tubu Tree | P1 |
| W8 | FAQ | P1 |
| W9 | Liên hệ | P1 |
| W10 | Chính sách (Đổi trả, Bảo mật, Điều khoản) — 3 trang | P1 |
| W11 | 404, 500 | P1 |

### 8.2 Authenticated B2C
| # | Screen | Priority |
|---|--------|----------|
| W12 | Login / OTP / Zalo OAuth | P1 |
| W13 | Cart (full page) | P1 |
| W14 | Checkout (multi-step trên 1 page với accordion) | P1 |
| W15 | Order success | P1 |
| W16 | My orders | P1 |
| W17 | Order detail + tracking | P1 |
| W18 | Profile dashboard | P1 |
| W19 | Loyalty page | P1 |
| W20 | Voucher page | P1 |
| W21 | Address book | P1 |
| W22 | Wallet + Withdraw | P1 |
| W23 | Affiliate dashboard (rộng hơn mini app, có chart đẹp) | P1 |
| W24 | Affiliate links manager (table) | P1 |
| W25 | Cashback merchants + transactions | P1 |
| W26 | Game hub (rút gọn so với mini app) | P2 |
| W27 | Notifications | P1 |
| W28 | Settings | P1 |

### 8.3 Dealer (web)
| # | Screen | Priority |
|---|--------|----------|
| W29 | Dealer login | P1 |
| W30 | Dealer home | P1 |
| W31 | Bảng giá (table cực dày, full width) | P1 |
| W32 | Quick order (paste Excel friendly) | P1 |
| W33 | Order templates | P1 |
| W34 | Dealer orders | P1 |
| W35 | Công nợ ledger | P1 |
| W36 | Quarterly report | P2 |

### 8.4 PWA-specific
| # | Element | Priority |
|---|---------|----------|
| W37 | Install banner | P1 |
| W38 | Offline page | P1 |
| W39 | Push permission prompt | P2 |

---

## 9. Screen Inventory — Admin nội bộ

> ~30 screen. Style: clean dashboard, dày data, tốc độ. Tham khảo Linear, Notion admin, Shopify admin.

| # | Screen | Mô tả |
|---|--------|-------|
| A1 | Login | Email + 2FA |
| A2 | Dashboard | KPI tổng + biểu đồ doanh thu + đơn hôm nay |
| A3 | Orders | Table + filter + bulk action |
| A4 | Order detail | Full info + nút phát hành hóa đơn, refund, manual ship |
| A5 | Products (overrides) | Bảng giá retail, SEO meta, brand assignment |
| A6 | Categories CRUD | Tree + sort + image |
| A7 | Brand CRUD | Brand info + story |
| A8 | Customers | Search + filter tier + xem chi tiết |
| A9 | Customer detail | Đầy đủ history + manual adjust điểm/voucher |
| A10 | Dealer applications | Pending list + approve/reject |
| A11 | Dealer management | Set bậc, tier, công nợ adjust |
| A12 | Dealer price upload | Excel import wizard |
| A13 | Affiliate management | List CTV + ngưỡng bậc + tweak rate |
| A14 | Commission ledger | Bulk approve, reject, mark paid |
| A15 | Cashback merchants | CRUD + rate + deeplink template |
| A16 | Cashback transactions | Đối soát manual |
| A17 | Coupons / Voucher CRUD | Phân loại tự động/thủ công |
| A18 | Loyalty tier config | Edit tier, perks |
| A19 | Game config | Vòng quay prizes + Quiz CRUD + Missions CRUD |
| A20 | Notification templates | ZNS template CRUD |
| A21 | Broadcast campaign | Compose + segment + schedule + preview |
| A22 | System config | All key-value với history |
| A23 | Eco / Tree tracking | List cây user đạt cấp 10 → assign location + ảnh real |
| A24 | Reviews moderation | Filter mới + ẩn/hiện |
| A25 | Return requests | List + approve workflow |
| A26 | Reports — Revenue | By time, brand, channel |
| A27 | Reports — CTV | Top, monthly |
| A28 | Reports — Dealer | Quarterly + bonus |
| A29 | Reports — Cashback | Reconciliation |
| A30 | Audit log | Toàn bộ admin action |
| A31 | User management (staff) | Role assign, 2FA enforce |

---

## 10. UX Flows quan trọng

> Designer mockup từng step. Số trong [brackets] tương ứng screen ID ở mục 7-8.

### 10.1 First-time user flow (Persona A — Mẹ Linh)

```
[1] Splash
  ↓
[2] Permission Zalo (userInfo + phone)
  ↓ accept
[3] Onboarding Quiz Q1: Quan tâm gì? → chọn "Cho bé"
  ↓
[3] Quiz Q2: Sống cùng? → "Có em bé"
  ↓
[3] Quiz Q3: Vấn đề da/tóc của con? → "Nhạy cảm + rôm sảy"
  ↓ (skip Q4 Q5)
[4] Welcome voucher 30k + nhiệm vụ "Mua đơn đầu"
  ↓
[5] Home — gợi ý ngay "Cho bé": Sữa tắm Visante baby, Fuwa3e baby, Pơ Lang mặt nạ bơ
  ↓
[12] PDP Sữa tắm Visante baby → check ingredient → add to cart
  ↓
[16] Cart → áp voucher welcome 30k
  ↓
[18-20] Checkout 3 steps
  ↓
[21] Order success — show "Bạn đã nhận 50đ Xanh + đang theo dõi đơn"
  ↓
ZNS push: "Đơn đã xác nhận"
  ↓ (sau 2 ngày)
ZNS push: "Đơn đã giao — đánh giá nhận điểm"
```

### 10.2 Returning CTV flow (Persona B — CTV Trang)

```
[1] Splash → silent login
  ↓
[49] Affiliate Dashboard (auto land vì role AFFILIATE)
  ↓ thấy "Còn 4.580.000đ là lên Bạc" → có động lực
  ↓ scroll xuống xem đơn mới
  ↓
Browse sản phẩm hot → [12] PDP
  ↓
[51] Share modal (3 dạng link + caption gợi ý)
  ↓ copy caption → mở Zalo Personal → paste post
  ↓ (sau 1 ngày, có 2 bạn đặt)
ZNS push: "Bạn vừa nhận thêm 87.500đ hoa hồng"
  ↓
[45] Wallet → thấy có 312k → muốn rút
  ↓
[47] Modal Convert to Tubu Wallet — thấy ×1.5 = 468k → chọn convert
  ↓ về [5] Home mode B2C, mua hàng bằng Tubu Wallet
```

### 10.3 Dealer order flow (Persona C — Anh Hùng)

```
[1] Splash → silent login → role DEALER → vào [61] Dealer Home
  ↓
[63] Quick Order
  ↓ paste từ Excel (10 SKU + qty)
  ↓ system parse → preview cart [65]
  ↓ confirm → [66] Place order
  ↓ system check công nợ: OK
  ↓ tạo order, push Pancake, return success
  ↓
[68] Dealer order detail → thấy "Sẽ đẩy GHN ngày 25/12"
  ↓
ZNS push (sau 2 ngày): "Đơn nhập #TUBU... đang vận chuyển"
```

### 10.4 Cashback flow (Persona A)

```
[5] Home → thấy banner "Hoàn tiền Shopee 3.5%"
  ↓
[55] Cashback merchant grid → tap Shopee
  ↓
[56] Shopee detail → đọc T&C → tap "Mua sắm hoàn tiền"
  ↓
[57] Loading "Đang chuyển..."
  ↓ mở Shopee app (external)
  ↓ mua hàng trong Shopee
  ↓ (15 ngày sau)
ZNS: "Bạn nhận hoàn 47.000đ chờ duyệt"
  ↓ (sau 20 ngày)
ZNS: "47.000đ đã duyệt — có thể rút"
  ↓
[58] Cashback transactions → thấy CONFIRMED
  ↓ → [45] Wallet → rút hoặc convert Tubu Wallet
```

### 10.5 Tree garden game flow (Persona A casual)

```
[35] Game Hub
  ↓ thấy "+1 hạt giống — Check-in hôm nay" CTA
  ↓ tap → [36] Daily check-in modal (animation)
  ↓ +1 seed, streak 5/7
  ↓
[37] Tree Garden → thấy cây Visante đang cấp 4
  ↓ tap "Tưới" 3 lần (mỗi lần dùng 1 seed)
  ↓ cây lên cấp 5
  ↓
[38] Level-up modal: "Cây cấp 5 — nhận voucher 50k!"
  ↓ continue chơi → đến cấp 10 (sau 3 tháng)
  ↓
[38] Cấp 10 special: "Tubu sẽ trồng 1 cây Sâm thật ở Quảng Nam"
  ↓ (sau 2 tuần, admin upload ảnh cây thật)
  ↓
ZNS: "Cây thật của bạn đã được trồng — xem ảnh"
  ↓
[44] Vùng nguyên liệu detail → có ảnh + GPS cây
```

---

## 11. Microinteractions & Animation

### 11.1 Nguyên tắc chung
- Mọi animation phụ trợ phải có **purpose** (cho user feedback, không trang trí).
- Tôn trọng `prefers-reduced-motion`.
- Test trên Android low-end (Samsung A series cũ) — animation 60fps.

### 11.2 Catalog cụ thể

| Action | Animation |
|--------|-----------|
| Add to cart | Sản phẩm "bay" parabola về icon cart, cart badge bounce +1 |
| Pull-to-refresh | Lá xoay tròn, hết = "fall" xuống |
| Tab switch | Slide ngang 200ms ease-out |
| Modal open | Fade overlay 200ms + slide-up sheet 300ms ease-out |
| Heart wishlist | Pulse + đổi màu fill |
| Voucher apply success | Confetti nhẹ 1.5s + price update slide |
| Tree level up | Cây zoom + sparkle + sound (optional) |
| Spin wheel | Spin 3-4s spring easing → slow out → pin land |
| Daily check-in | Hạt giống bay vào "kho hạt", counter +1 |
| Order success | Checkmark draw 600ms + scale-in icon |
| Loading skeleton | Shimmer left→right 1.4s loop |
| Tier up notification | Badge xoay 360° + scale 1.2 → 1 + glow |

### 11.3 Haptic feedback (mini app via Zalo SDK)
- Light: tap chip, toggle.
- Medium: add to cart success.
- Heavy: order placed, level up, big reward.

---

## 12. Voice & Tone (Writing style)

> Designer phối hợp content writer. Đây là rule cho mọi UI copy.

### 12.1 Nguyên tắc viết
1. **Ngôi xưng:** "Bạn" / "Tubu Tree" (KHÔNG "anh/chị", "shop", "chúng tôi" — trừ chính sách formal)
2. **Câu ngắn:** ưu tiên ≤ 12 từ.
3. **Việt thuần:** "Mời 3 bạn — nhận voucher" KHÔNG "Refer 3 friends to claim voucher".
4. **Tích cực:** "Còn 3 ngày để giữ hạng" thay "Bạn sắp bị rớt hạng".
5. **Đồng cảm:** lỗi gì cũng KHÔNG đổ tại user. "Có vẻ kết nối chậm, thử lại nhé?" thay "Network error".

### 12.2 Bảng từ vựng

| Tình huống | Dùng | Tránh |
|------------|------|-------|
| User vừa đặt đơn | "Cảm ơn bạn đã chọn Tubu" | "Đặt hàng thành công" |
| Empty cart | "Giỏ còn trống đấy" | "No items in cart" |
| Hết hàng | "Tạm hết — sẽ về sớm" | "Out of stock" |
| Voucher hết hạn | "Voucher này đã ngừng" | "Voucher expired" |
| Loading lâu | "Đang chuẩn bị cho bạn..." | "Loading..." |
| Lỗi server | "Có chút trục trặc, thử lại nhé" | "Server error 500" |
| CTA mua | "Thêm vào giỏ" | "Add to cart" |
| CTA share CTV | "Chia sẻ — kiếm 45k" | "Share to earn commission" |
| Lên hạng | "Chúc mừng! Bạn vừa lên Đại Thụ 🌳" | "Tier upgraded" |
| Tier requirement | "Còn 2 đơn nữa là Đại Thụ" | "Need 2 more orders for Đại Thụ" |
| Confirm hủy | "Bạn muốn hủy đơn này?" | "Cancel order?" |
| Login | "Tiếp tục với Zalo" | "Login with Zalo" |
| Profile blank | "Bạn chưa thêm địa chỉ" | "No address" |

### 12.3 Microcopy đặc biệt

- **Birthday voucher**: "Chúc mừng sinh nhật bạn 🌿 Tubu tặng quà tháng này"
- **Sinh nhật cây thật trồng**: "Hôm nay là sinh nhật 1 năm cây Sâm bạn đã trồng ở Quảng Nam"
- **Cashback confirmed**: "47.000đ đã sẵn sàng — chuyển Ví Tubu được 70.500đ"
- **Empty state Wishlist**: "Tim sản phẩm bạn thích để Tubu nhắc khi giảm giá"

---

## 13. Empty / Error / Loading States

> Mỗi state có illustration riêng + copy + CTA. Không bao giờ chỉ "No data".

### 13.1 Empty states (checklist)

| Context | Illustration | Heading | Body | CTA |
|---------|-------------|---------|------|-----|
| Cart trống | Rổ tre + lá | "Giỏ còn trống đấy" | "Khám phá sản phẩm Tubu chọn riêng cho bạn" | "Khám phá ngay" |
| Wishlist trống | Cây non chưa nở | "Chưa có sản phẩm yêu thích" | "Bấm tim để lưu sản phẩm bạn thích" | "Xem sản phẩm" |
| Order list trống | Hộp + sticky note | "Bạn chưa có đơn nào" | "Mua đơn đầu — nhận 30k voucher" | "Bắt đầu mua" |
| Search no result | Kính lúp + lá | "Không tìm thấy '<keyword>'" | "Thử từ khóa khác hoặc xem brand" | "Xem theo brand" |
| Voucher trống | Phong thư cuộn | "Chưa có voucher nào" | "Tích đơn để nhận voucher tự động" | "Khám phá" |
| Notification trống | Chuông gió | "Không có thông báo mới" | — | — |
| Affiliate links trống | Link chain với lá | "Bạn chưa tạo link nào" | "Mở 1 sản phẩm và bấm Chia sẻ" | "Xem sản phẩm" |
| Tree garden trống | Đất nâu | "Khu vườn chưa có cây" | "Check-in mỗi ngày để nhận hạt giống" | "Check-in ngay" |

### 13.2 Error states

| Type | Display | Copy |
|------|---------|------|
| Network offline | Banner top + offline page | "Mất kết nối. Tubu sẽ thử lại khi có mạng" |
| API timeout | Toast | "Hơi chậm tí, bạn đợi nhé" + nút retry |
| 404 | Full page | "Trang này lạc đường rồi" + nút về home |
| 500 | Full page | "Tubu đang sửa lại — quay lại sau ít phút nhé" |
| Out of stock checkout | Inline cart | "Sản phẩm vừa hết — Tubu sẽ gợi ý tương tự" |
| Payment failed | Modal | "Thanh toán chưa thành công. Thử lại hoặc đổi cách khác?" |

### 13.3 Loading states

- **First load**: full skeleton (không spinner toàn màn hình).
- **Subsequent**: spinner inline ở vùng đang load.
- **Long task** (> 2s): "Đang chuẩn bị..." text + progress nếu biết.
- **Optimistic UI**: add to cart, like, check-in — update UI ngay, rollback nếu fail.

---

## 14. Accessibility Checklist

- [ ] Mọi text contrast ≥ 4.5:1 trên nền (WCAG AA).
- [ ] Text size base 14px+, scalable lên 1.5× (cho persona D).
- [ ] Touch target ≥ 44×44pt cho mọi action.
- [ ] Focus state rõ ràng (3px ring xanh).
- [ ] Form labels rõ — không chỉ placeholder.
- [ ] Error message kèm icon + màu (không chỉ màu).
- [ ] Tab order hợp lý trên web.
- [ ] Alt text cho mọi ảnh sản phẩm.
- [ ] `aria-label` cho icon-only button.
- [ ] Skip-to-content link trên web.
- [ ] Reduced motion respect.
- [ ] Heading hierarchy đúng (h1 → h2 → h3).
- [ ] Dark mode (phase 2) đảm bảo contrast.
- [ ] Lang attribute `lang="vi"` trên web.


---

## 15. Deliverables (Files cần giao cuối design phase)

> **Output cuối cùng** mà designer cần submit để team code có thể bắt đầu mà không bị block.

### 15.1 Figma file structure

Tổ chức file Figma theo cấu trúc sau:

```
📁 TubuTree Design System
├── 📄 00 — Cover & README
├── 📄 01 — Foundations
│   ├── Brand
│   ├── Colors (Light)
│   ├── Colors (Dark — P2)
│   ├── Typography
│   ├── Spacing & Radius
│   ├── Shadow & Elevation
│   ├── Iconography
│   └── Illustration library
│
├── 📄 02 — Components
│   ├── Atoms (Buttons, Inputs, Tags, ...)
│   ├── Molecules (ProductCard, PriceTag, ...)
│   ├── Organisms (Header, Cart, Dashboard, ...)
│   └── Templates
│
├── 📄 03 — Mini App Screens (79 màn)
│   ├── 1. Onboarding
│   ├── 2. B2C — Home & Catalog
│   ├── 3. B2C — Cart & Checkout
│   ├── 4. B2C — Orders & Profile
│   ├── 5. B2C — Loyalty & Game
│   ├── 6. B2C — Wallet & Affiliate
│   ├── 7. B2C — Cashback
│   ├── 8. Dealer Mode
│   └── 9. Common
│
├── 📄 04 — Web Shop (45 màn)
│   ├── Public
│   ├── Authenticated B2C
│   ├── Dealer
│   └── PWA
│
├── 📄 05 — Admin (31 màn)
│
├── 📄 06 — Flows (Interactive prototypes)
│   ├── First-time user
│   ├── Returning CTV
│   ├── Dealer order
│   ├── Cashback
│   └── Tree garden
│
├── 📄 07 — Marketing assets
│   ├── App icon (mini app + PWA)
│   ├── Splash screen
│   ├── Social share previews
│   └── QR code branded
│
└── 📄 08 — Hand-off notes (developer-facing)
```

### 15.2 Tokens export

- File `tokens.json` (Figma Tokens / Style Dictionary format).
- Generated outputs:
  - `tokens.css` (CSS vars)
  - `tokens.ts` (TypeScript)
  - `tailwind.config.js` (cho web + miniapp)

### 15.3 Asset export

- **Icons**: SVG outline 24px (default) + 16/20/32 variants.
- **Illustrations**: SVG (preferred) + PNG @1x @2x @3x fallback.
- **Brand logos**: SVG + PNG.
- **Photography**: organized folder by brand + by use case, named theo convention `<brand>_<context>_<size>.jpg`.
- **Animations**: Lottie JSON cho check-in, level-up, vòng quay.

### 15.4 Prototype demo

- Figma prototype có 5 user flows ở mục 10 chạy interactive.
- Embed link share cho stakeholder review.

### 15.5 Design documentation

- Inline notes trong Figma cho mỗi screen (designer rationale).
- File `DESIGN_DECISIONS.md` ghi lại các quyết định lớn (vì sao chọn green-600 làm primary, vì sao tách dealer mode...).

### 15.6 Acceptance criteria

Trước khi handoff cho developer, design phải:
- [ ] Mọi screen P1 hoàn thành ở **3 state**: empty / filled / error.
- [ ] Mọi component P1 đã ở component library với variants + props doc.
- [ ] 5 flows quan trọng prototype interactive.
- [ ] Tokens export ra JSON.
- [ ] Đã test responsive (web): mobile 375px, tablet 768px, desktop 1280px.
- [ ] Đã review accessibility checklist.
- [ ] Có versioning rõ (v0.1 — sketches, v0.5 — wireframe, v1.0 — final).

---

## 16. Quy trình review & approval

### 16.1 Vai trò
- **Anh (Tubu Tree CEO)**: approver cuối cùng cho brand DNA + screen quan trọng (Home, Checkout, Affiliate Dashboard, Dealer Mode).
- **Designer** (Claude hoặc team người): chủ động đề xuất, không hỏi quá nhiều câu lặt vặt.
- **PM/Tech Lead**: review feasibility, đảm bảo design ≤ effort code reasonable.

### 16.2 Milestone review

| Milestone | Deliverable | Approver |
|-----------|-------------|----------|
| M1: Brand Foundation | Color, typo, illustration style — 1 sample home + 1 PDP | Anh |
| M2: Design System v0.5 | Tokens + Atoms + Molecules + 5 organism quan trọng | Anh + Tech Lead |
| M3: Mini App MVP screens | 25 screen P1 + 1 prototype flow | Anh |
| M4: Full mini app | 79 màn + 5 flow | Anh + Tech Lead |
| M5: Web + Admin | 45+31 màn | Anh + Tech Lead |
| M6: Final handoff | Tokens, assets, prototype, doc | All |

### 16.3 Feedback rules
- Anh review mỗi milestone trong **3 ngày**, comment trực tiếp trên Figma frame.
- Designer phản hồi/sửa trong **5 ngày**.
- Tránh "đập đi làm lại" — dùng versioning.
- Mọi quyết định ghi vào `DESIGN_DECISIONS.md`.

---

## 17. Prompt mẫu để đưa cho Claude (Design phase)

> Khi anh sẵn sàng đưa file này cho Claude làm design phase, dùng prompt sau:

```
Tôi cần bạn làm designer cho dự án Tubu Tree.

Đọc kỹ file DESIGN_BRIEF.md và TUBU_TREE_SPEC_v1.1.md kèm theo.

Quy tắc:
1. Đọc toàn bộ DESIGN_BRIEF.md trước khi bắt đầu.
2. Tham chiếu SPEC chỉ khi cần hiểu logic nghiệp vụ — KHÔNG copy spec vào design.
3. Bắt đầu phase theo milestone trong mục 16.2.
4. Mỗi milestone, deliver:
   - Frame Figma-ready (cho tôi import lại) — dạng SVG hoặc Figma component spec
   - Mô tả ngắn rationale cho mỗi quyết định lớn
   - Câu hỏi cụ thể nếu có ambiguous, không hỏi câu mơ hồ
5. Mọi component và screen phải pass nguyên tắc ở mục 3 (Design Principles)
   và sống đúng Brand DNA ở mục 1.
6. Trong phạm vi cho phép của Claude, có thể:
   - Generate SVG component code
   - Generate Tailwind CSS class chuẩn token
   - Generate React component JSX (cho Storybook/preview)
   - Generate Mermaid diagram cho flow
   - Generate prompts cho Midjourney/DALL-E để tạo illustration
7. KHÔNG được:
   - Đề xuất animation library nặng không cần
   - Bỏ qua accessibility checklist
   - Dùng stock photo phương Tây
   - Phát minh ra brand color khác bảng đã chốt mục 4.2

Bắt đầu với M1: Brand Foundation.
Trình bày:
- 3 lựa chọn hero homepage layout (sketch level)
- 2 lựa chọn ProductCard variant (sketch level)
- Hỏi tôi chọn trước khi đi vào chi tiết.
```

---

## 18. Câu hỏi cần Tubu Tree trả lời trước khi design phase

> Tương tự "10 câu hỏi" ở SPEC. Đây là câu hỏi designer cần biết.

### A. Brand assets
1. Có file logo SVG/AI gốc không? Có brand guideline cũ (font, màu) đã chốt chưa?
2. Có sẵn ảnh chụp sản phẩm chất lượng cao chưa? Có thể đặt thêm photoshoot không? Budget?
3. Có sẵn video về vùng nguyên liệu chưa? Hay cần đi quay mới?
4. Slogan chính thức ngoài "Sống xanh An Lành" có thêm câu nào không?

### B. Inspiration & references
5. App nào (trong/ngoài Việt Nam) mà anh thấy design **hợp brand Tubu** nhất? Tại sao?
6. App nào anh đặc biệt **không muốn giống**? Tại sao?
7. Có style preference: minimalism / cozy / playful / editorial?

### C. Constraints
8. Có brand nào trong 10 brand đối tác có sẵn brand guideline RIÊNG mà designer phải tôn trọng không? (Vd Fuwa3e có template marketing riêng?)
9. Mini app có support cả Android low-end (Samsung A series) không? (Ảnh hưởng đến animation complexity)
10. Dark mode có cần ngay Phase 1 không hay để Phase 2?
11. Đa ngôn ngữ (EN) có cần thiết kế chỗ trống cho dịch chưa? Hay chỉ tiếng Việt?

### D. Edge cases
12. Có nhân vật/mascot không? (Vd một con thú đại diện Tubu Tree?) Hay chỉ là logo cây?
13. Có muốn dùng AI illustration (Midjourney/SDXL) cho onboarding/empty states không, hay phải vẽ tay 100%?
14. Có ngân sách thuê illustrator riêng cho Brand Story Map vùng nguyên liệu không? (Việc này khá quan trọng để bứt phá so với Sinh Dược)

---

**Kết thúc Design Brief v1.0.**

> Designer (Claude hoặc team người) đọc xong file này có đủ context để bắt đầu M1 mà không cần hỏi lại quá nhiều câu cơ bản. Mọi quyết định trong file này có thể chỉnh sửa nếu có lý do — không phải kinh thánh.

