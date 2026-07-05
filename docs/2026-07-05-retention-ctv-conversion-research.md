# Nghiên cứu sâu: CTV tooling · Chuyển đổi người mua · Loyalty/Gamification

> Ngày: 2026-07-05 · Nối tiếp [growth-features-research-roadmap](2026-07-05-growth-features-research-roadmap.md) (đã **bỏ** pillar Quỹ CLB/WeShare theo quyết định của user).
> Nguồn: 3 agent nghiên cứu song song (CTV tooling · buyer conversion · loyalty) + đối chiếu inventory codebase.
> **Độ tin cậy:** ✅ đã kiểm chứng/nguồn chính chủ · ⚠️ blog/marketing hoặc số liệu cần dè dặt · 🧠 nguyên lý ngành.

---

## 0. Điểm chốt chiến lược PHẢI đọc trước: ràng buộc nền tảng Zalo

Nghiên cứu chuyển đổi phát hiện **nút thắt quyết định toàn bộ chiến lược retention**: **Zalo Mini App KHÔNG có push notification miễn phí như app native.** Mọi thông báo chủ động phải đi qua:

| Kênh | Ràng buộc | Chi phí |
|---|---|---|
| **OA — tin Tư vấn (CSKH)** | Chỉ trong **cửa sổ 48h** kể từ tương tác cuối của user (OpenAPI backend: **7 ngày**) | **8 tin free/48h**, sau đó ~**55đ/tin** |
| **OA — Broadcast (marketing)** | Chỉ tới user đã **"quan tâm" OA**; chỉ gửi **6:00–19:59**; có quota | Theo gói |
| **ZNS (tới SĐT)** | Không cần quan tâm OA, nhưng **template phải duyệt trước (~2 ngày)** | **Tính phí/tin** (~200đ+) |

**Hệ quả:** không thể "bắn noti flash sale cho toàn bộ user" kiểu Shopee. Retention của Tubu có **chi phí biến đổi** (khác Shopee). Toàn bộ vòng nhắc-lại (giỏ bỏ quên, voucher sắp hết hạn, flash sale, nhắc tưới cây, nhắc streak) phải **thiết kế quanh OA 48h + ZNS trả phí**. → Ưu tiên: (a) giữ user tương tác đều để cửa sổ OA 48h luôn "mở" (tin free); (b) đăng ký template ZNS sớm cho các kịch bản quan trọng; (c) ngân sách hoá chi phí ZNS/OA ngay từ đầu.

App đã có module `integrations/zns` + `notifications` (template + log) → hạ tầng có sẵn, cần **chiến lược dùng** đúng.

---

## 1. MẢNG 1 — Bộ công cụ CTV (tham chiếu Dropii, Selly, Cuccu, Mio, Sapo, Abaha)

### 1.1 Đối chiếu với app hiện tại

| Năng lực | Nguồn tham chiếu | Tubu đã có? |
|---|---|---|
| Đăng ký CTV + dashboard hoa hồng + analytics | Selly/Cuccu | ✅ `affiliate` module |
| Link rút gọn + attribution | Sapo/Abaha | ✅ `AffiliateLink` + `ReferralTouch` |
| Gian hàng cá nhân | Sapo/Abaha | ✅ `storefront-builder` → `/s/:slug` |
| Ví hoa hồng + payout | tất cả | ✅ `Commission` + `Payout` |
| Nhiệm vụ CTV | Selly (F4) | ✅ `storefront-quest.service` |
| Đại lý B2B (bậc giá, công nợ, đặt lại, thưởng quý) | Droppii đại lý | ✅ `dealer` module |
| **📦 Content Kit bấm-là-share** (ảnh/video/caption/mô tả/USP per-SP) | Selly A1, Droppii A2 | ❌ **THIẾU** — đòn bẩy #1 của Selly/Droppii |
| **🧾 Lên đơn hộ khách** (CTV nhập TT khách → tạo đơn → gắn hoa hồng, COD) | Selly/Cuccu/Droppii B1 | ❌ **THIẾU** — trái tim mô hình "3 không" |
| **🎓 Academy/đào tạo** (video + bài học + chứng nhận onboarding) | Droppii Academy C1 | ❌ **THIẾU** (có thể tái dùng `feed` + `GameQuiz`) |
| **✨ Cá nhân hoá nội dung theo tên CTV** (chèn tên/thương hiệu vào ảnh/landing) | **Không đối thủ nào làm** — khoảng trống thị trường | ❌ **THIẾU** (cơ hội khác biệt) |
| **🏆 Leaderboard + contest CTV theo mùa** | Droppii "90 Ngày Tốc Chiến" F1, Selly F2 | ⚠️ có quest; **thiếu BXH/contest** (tái dùng season game) |
| **🎁 Mini-game thưởng cho CTV** (vòng quay, "vàng rơi") | Droppii F2 | ⚠️ có `GameSpin` cho user; **chưa áp cho CTV** |
| **📊 Cấp bậc CTV theo doanh số cá nhân + quyền lợi** | Droppii/Cuccu F3 | ⚠️ có `MembershipTier` cho khách; **chưa có rank CTV** |

### 1.2 Tính năng đáng làm nhất (xếp theo tác động/độ khó)

1. **Content Kit per-SP** ✅❌ — mỗi SP có bộ ảnh + 3–5 caption mẫu + video ngắn + USP + FAQ + chứng nhận; nút "Sao chép / Share Zalo". *Rất cao · Thấp.* Đặc biệt hợp sản phẩm thiên nhiên (cần kể chuyện thành phần/công dụng chuẩn, tránh CTV thổi phồng sai luật quảng cáo).
2. **Lên đơn hộ khách + COD** — CTV nhập tên/SĐT/địa chỉ khách → tạo đơn thay → tự gắn `ctvId`/hoa hồng → đối soát sau giao. *Rất cao · TB.* Cần đơn gắn CTV + luồng COD + ví hoa hồng đối soát.
3. **Cá nhân hoá nội dung theo tên CTV** — chèn tên/logo CTV vào ảnh/landing tự sinh ("shop của tôi"). *Cao · Thấp–TB.* **Không đối thủ nào có** → khác biệt hoá.
4. **Leaderboard + contest CTV theo mùa + mini-game** — tái dùng `Season`/`GameSpin`/leaderboard đã có. *Cao · Thấp–TB.*
5. **Academy nhẹ** — khoá video + bài học + quiz + chứng nhận; tái dùng `feed` + `GameQuiz`. *TB–cao · Thấp–TB.* Giảm bỏ cuộc tuần đầu + giảm rủi ro quảng cáo sai.
6. **Cấp bậc CTV theo doanh số CÁ NHÂN** (không theo tuyến dưới) + quyền lợi tăng dần. *TB–cao · TB.*

### 1.3 ⚠️ Bài học pháp lý từ Droppii (NÊN TRÁNH)

Nghiên cứu chéo xác nhận Droppii có **yếu tố đa cấp về cơ chế**: hoa hồng nhóm override tuyến dưới (6/9/12%), cấp bậc Coach/Mentor định theo downline, **phí gia nhập 599k–2.099k**. *(Tin đồn "Droppii bị chuyển công an" là **chưa xác minh** — nguồn chính thống chỉ nêu Greenleaf & LucMall.)*

→ **Với Tubu, TRÁNH:** hoa hồng đa tầng theo tuyến dưới, cấp bậc theo downline, phí gia nhập bắt buộc. **NÊN:** hoa hồng bán lẻ + thưởng mốc + **referral 1 cấp gắn đơn thật**. (Chi tiết pháp lý ở §4.)

---

## 2. MẢNG 2 — Chuyển đổi & giữ chân người mua (tham chiếu Shopee, Lazada, TikTok Shop)

### 2.1 Đối chiếu với app hiện tại

| Cơ chế | Nguồn | Tubu đã có? |
|---|---|---|
| **Freeship: ngưỡng + flat fee + override theo hạng + coupon freeship** | Shopee C2/C4 | ✅ **ĐÃ CÓ** — `pricing.calcShippingFee` (200k threshold, 19k flat, tier overrides) + coupon `freeship` |
| Review ảnh/video + cộng điểm | Shopee | ✅ `Review` |
| Voucher (welcome/sinh nhật/win-back/milestone) | Shopee | ✅ `vouchers` cron |
| Group buy / mua chung | — | ✅ `GroupBuy` |
| Subscription | — | ✅ `Subscription` |
| Chống oversell hàng giới hạn | Shopee flash sale | ✅ atomic stock decrement |
| **⚡ Flash sale ENGINE** (khung giờ, lịch, giá theo khung, kho phân bổ, countdown, "đã bán X%", "nhắc tôi") | Shopee B1–B4 | ❌ **THIẾU engine** — chỉ có `flash-sale.tsx` (FE) + comment chống oversell |
| **💬 Quick-reply + auto-reply CSKH** | Shopee A3/A4 | ❌ **THIẾU** (có kênh ZNS/OA nhưng chưa có mẫu tin/auto-reply) |
| **🛒 "Mua kèm / sản phẩm liên quan"** (cross-sell) | Shopee D3 | ❌ **THIẾU** (rule-based đơn giản) |
| **🎯 Feed "Dành cho bạn" cá nhân hoá** | Shopee D1/D2 | ⚠️ chỉ có `ai-advisor` nhẹ; **chưa có feed cá nhân hoá** |
| **🔔 Nhắc giỏ bỏ quên / voucher sắp hết hạn** (qua OA/ZNS) | Shopee D5 | ⚠️ có hạ tầng ZNS; **chưa có kịch bản remarketing** |
| **🤖 Chat AI tư vấn** | Shopee A2 | ⚠️ `ai-advisor` nhẹ; chưa phải chatbot CSKH 24/7 |
| Feed video khám phá (FYP) | TikTok Shop D4 | ❌ **không khả thi** trên Zalo Mini App (bỏ qua) |

### 2.2 Tính năng đáng làm nhất (đã lọc theo khả thi trên Zalo)

**Bậc 1 — làm ngay (cao × dễ, không vướng Zalo):**
1. **Flash sale engine** — khung giờ vàng + countdown + kho giới hạn + thanh "đã bán X%" + 2 tầng (sàn/shop). *Cao · Thấp–TB.* Với hàng thiên nhiên: "giờ vàng lô mới về / nông sản tươi".
2. **UI freeship progress** — "mua thêm 30k để freeship" (tận dụng threshold đã có) → đẩy AOV. *Cao · Thấp.*
3. **Quick-reply + auto-reply trên OA** — kho mẫu trả lời + tin chào tự động. *TB–cao · Thấp.*
4. **"Mua kèm / sản phẩm liên quan" rule-based** — combo trà+mật ong… tăng AOV. *TB · Thấp–TB.*

**Bậc 2 — kế tiếp (cao × TB):**
5. **Feed "Dành cho bạn"** — item-CF/rule theo lịch sử xem-mua (tận dụng `ai-advisor`). *Cao · TB.*
6. **Remarketing qua OA+ZNS có chủ đích** — nhắc giỏ bỏ quên / voucher sắp hết hạn / lô mới, bằng ZNS template + tin OA trong cửa sổ 48h. *Cao · TB (vướng phí + template).*
7. **"Nhắc tôi" flash sale** — giá bí mật đến giờ mở; phần nhắc map sang OA/ZNS. *Cao · TB–cao.*

**Bậc 3 — sau:**
8. **Chat AI tư vấn 24/7** — rất hợp hàng thiên nhiên (giải thích thành phần/liều dùng). *Cao · TB–cao.*

---

## 3. MẢNG 3 — Tối ưu Loyalty/Gamification (app đã mạnh sẵn — trọng tâm TỐI ƯU)

### 3.1 Đối chiếu với app hiện tại

| Cơ chế | Nguồn | Tubu đã có? |
|---|---|---|
| Streak điểm danh + **streak freeze** | Duolingo A1 | ✅ có `GameProfile.streakFreezes` |
| Điểm/hạng + multiplier theo hạng | — | ✅ `MembershipTier` |
| Ví (VND) + TubuXu | — | ✅ **Ví** nhận hoa hồng CTV + cashback + hoàn đơn → **rút ngân hàng** (min 100k, phí 3k) hoặc **đổi TubuXu ×1.2**. **TubuXu** = tiêu-trong-app, **KHÔNG rút được** (`coins.service` chỉ grant/spend). Ví KHÔNG có đường user tự nạp. |
| Vòng quay / quiz / mission / mùa / BXH | Shopee/Duolingo | ✅ Vườn Xanh đầy đủ |
| Mục tiêu cộng đồng (hồ giọt nước) | Pokémon GO E4 | ✅ `CommunityGoal`/`CommunityContribution` |
| Tặng nước social | — | ✅ `WaterGift` |
| Referral thưởng xu (mốc CONFIRMED) | Dropbox B1 | ✅ 1 chiều |
| Subscription | Amazon C | ✅ (cơ bản) |
| **❄️ Streak REPAIR** (hồi sinh chuỗi đã mất, có giới hạn) | Duolingo A2 | ❌ **THIẾU** (mới có freeze phòng ngừa) |
| **📊 Dashboard Faucet/Sink + tách coin mềm/cứng** | game economy D1/D2 | ❌ **THIẾU** — nền tảng chống lạm phát |
| **⏸️ Skip/Pause thay vì Hủy** (subscription) | Recharge/HelloFresh C2 | ❌ **THIẾU** — đòn bẩy giảm churn mạnh |
| **📉 Discount thang theo số subscription** (5→15%) | Amazon Subscribe&Save C1 | ❌ **THIẾU** |
| **🔔 Nhắc đúng giờ cá nhân hoá** | Duolingo A5 | ⚠️ có nhắc tưới cố định; chưa cá nhân hoá giờ |
| **👥 Referral 2 chiều + milestone + anti-fraud** | Dropbox/Harry's B1/B2/B5 | ⚠️ mới 1 chiều, chưa milestone/contest/anti-fraud stack |
| **🎫 Season/Battle Pass** phủ lên Vườn Xanh | Fortnite E1 | ⚠️ có season; chưa có pass track free/premium |
| **⏳ Hết hạn điểm/breakage + nhắc trước** | loyalty accounting D4 | ❌ **THIẾU** (sink + win-back trigger) |
| **🔁 Replenishment nudge + dunning** | Amazon/Recurly C4/C5 | ⚠️ có `ReorderReminder`; chưa có dunning |

### 3.2 Nâng cấp đáng làm nhất (xếp theo tác động/độ khó)

1. **Streak Repair** (bổ sung cho freeze đã có) — chặn cú "reset về 0", nguyên nhân churn streak lớn nhất. *Rất cao · Thấp.*
2. **Dashboard Faucet/Sink + tách coin mềm/cứng** — TubuXu (cứng) chỉ nhận từ mua/cashback thật; game trả **coin mềm** (nước/hạt) không bơm vào tiền thật. *Rất cao · TB.* Làm sớm để không nợ kỹ thuật + giảm rủi ro pháp lý.
3. **Rà soát pháp lý TubuXu rút tiền** — xem §4. *Rất cao · Thấp (nhưng cần luật sư).*
4. **Skip/Pause thay vì Hủy** cho subscription — chuyển churn thành gián đoạn tạm. *Cao · Thấp–TB.*
5. **Discount thang theo số subscription** (5→15%) — khoá nhiều SKU tiêu hao (trà/dầu/mỹ phẩm) vào định kỳ. *Cao · TB.*
6. **Nhắc đúng giờ cá nhân hoá** qua OA/ZNS — cẩn trọng tần suất/chi phí. *Cao · TB.*
7. **Referral 2 chiều + reward-on-qualified-action + anti-fraud** (OTP/device fingerprint/self-referral block). *Cao · TB.*
8. **Season/Battle Pass nhẹ** phủ Vườn Xanh (track free + premium theo hạng/subscriber). *Cao · Cao.*
9. **Sự kiện cộng đồng "cao trào tập thể"** (mục tiêu chung → trồng rừng thật/CSR) — tái dùng `CommunityGoal`. *TB–cao · TB.*
10. **Hết hạn điểm có báo trước + nhắc "điểm sắp hết hạn"** — vừa là sink vừa là win-back. *TB · Thấp.*

### 3.3 Lịch live-ops đề xuất (bám lễ VN)

Tết (cao trào lớn nhất) → 8/3, 20/10 (nữ giới, hợp natural/beauty) → 30/4–1/5, 2/9 → Hè (season pass + CSR trồng rừng) → Trung Thu → 9.9/10.10/**11.11**/**12.12** (bám mega-sale, khác biệt bằng game + quà thật, không đua giảm giá thuần) → xen kẽ nhịp nghỉ chống burnout.

---

## 4. ⚠️ CẢNH BÁO PHÁP LÝ XUYÊN SUỐT (cả 3 mảng) — cần luật sư VN xác nhận

1. **MLM / đa cấp — Nghị định 40/2018 + Điều 217a BLHS.** Referral/hoa hồng phải: **1 cấp** (không ăn theo tuyến dưới nhiều tầng), **gắn đơn mua thật** (không thưởng cho "tuyển/đăng ký"), **không phí gia nhập/không bắt mua để tham gia**, có **cap**. Tránh ngôn ngữ "tuyến dưới/hệ thống/tuyển đại lý".
2. **Ví (VND) rút được vs TubuXu không rút — rủi ro trung gian thanh toán (Nghị định 52/2024, NHNN).** *(Đã xác minh code 2026-07-05: **TubuXu KHÔNG rút được** — chỉ tiêu trong app; **Ví** mới rút được, và Ví **chỉ** nhận tiền platform nợ user, KHÔNG có đường user tự nạp.)*
   - **Đánh giá rủi ro: THẤP hơn nhiều so với ví điện tử top-up.** Ví điện tử (ví, cần giấy phép NHNN) theo định nghĩa phải cho **user nạp tiền của họ vào** + dùng thanh toán cho bên thứ ba. Ví Tubu KHÔNG có top-up, chỉ chứa **thu nhập/hoàn tiền platform nợ user** (giống số dư hoa hồng của Accesstrade/Masoffer, ví tài xế Grab) → về bản chất là **thanh toán khoản phải trả cho chính user**, không phải giữ-và-chuyển tiền hộ người khác. TubuXu không rút được = **store-credit khép kín** (như Shopee Xu) — rủi ro thấp.
   - **Guardrail BẮT BUỘC giữ để không thành ví điện tử:** (a) **KHÔNG thêm đường user nạp tiền vào Ví**; (b) **KHÔNG cho chuyển Ví giữa các user (P2P)**; (c) giữ TubuXu **một chiều, không cash-out**; (d) diễn đạt rút tiền là "rút hoa hồng/hoàn tiền đã tích lũy", không phải "rút từ ví điện tử".
   - **Việc cần làm (tuân thủ thuế, không phải giấy phép):** hoa hồng trả CTV là **thu nhập chịu thuế TNCN** — cân nhắc nghĩa vụ **khấu trừ 10% khi chi trả ≥2 triệu/lần** cho cá nhân (Thông tư 111/2013 về hoa hồng môi giới). Cashback là hoàn tiền mua sắm của chính user → rủi ro thấp hơn.
   - *(Vẫn nên để luật sư xác nhận cách diễn đạt "rút hoa hồng" + nghĩa vụ khấu trừ TNCN.)*
3. **Vòng quay/loot box gambling-adjacent.** Giữ vòng quay ở **currency mềm/phần thưởng phi-tiền-mặt**, không cho mua lượt quay bằng tiền thật để trúng coin rút được.
4. **Subscription — hủy phải minh bạch** (tránh dark pattern "roach motel"); luôn có đường hủy rõ trong app dù có save-flow skip/pause.

*(Đây là phân tích rủi ro, KHÔNG phải tư vấn pháp lý.)*

---

## 5. ROADMAP TỔNG HỢP (3 mảng, xếp theo tác động/độ khó)

### Đợt 1 — "Quick wins" (cao × dễ, làm ngay)
- **CTV:** Content Kit per-SP (share/copy) · Cá nhân hoá nội dung theo tên CTV.
- **Mua:** Flash sale engine · UI freeship progress · Quick-reply/auto-reply OA · "Mua kèm" rule-based.
- **Loyalty:** Streak Repair · Hết hạn điểm + nhắc trước.
- **Nền tảng:** Chiến lược OA 48h + đăng ký template ZNS sớm.

### Đợt 2 — "Nền tảng & giữ chân" (cao × TB, làm sớm để không nợ kỹ thuật)
- **Loyalty:** Dashboard Faucet/Sink + tách coin mềm/cứng · Skip/Pause subscription · Discount thang subscription · Referral 2 chiều + anti-fraud.
- **Mua:** Feed "Dành cho bạn" · Remarketing OA+ZNS (giỏ bỏ quên/voucher).
- **CTV:** Lên đơn hộ khách · Leaderboard/contest CTV.
- **Pháp lý:** Rà soát TubuXu rút tiền + referral 1 cấp với luật sư.

### Đợt 3 — "Chiều sâu"
- **CTV:** Academy nhẹ · Cấp bậc CTV theo doanh số cá nhân.
- **Loyalty:** Season/Battle Pass phủ Vườn Xanh · Sự kiện cộng đồng cao trào tập thể · Replenishment nudge + dunning.
- **Mua:** "Nhắc tôi" flash sale · Chat AI tư vấn.

---

## 5bis. KẾ HOẠCH PHASE — ưu tiên Mảng 2 + Mảng 3 (tạm hoãn Mảng 1 CTV)

Theo quyết định của user: làm **Mảng 2 (chuyển đổi người mua) + Mảng 3 (loyalty)** trước. Sắp theo tác động × độ khó × phụ thuộc.

### Phase 1 — Quick wins (cao × dễ, tái dùng hạ tầng sẵn có)
| Việc | Mảng | Ghi chú triển khai |
|---|---|---|
| **Flash sale engine** | M2 | Model FlashSale (lịch, khung giờ, giá theo khung, kho phân bổ) + countdown + "đã bán X%". Tái dùng atomic stock decrement đã có. *Build lớn nhất Phase 1.* |
| **UI freeship progress** | M2 | "Mua thêm Xđ để freeship" — freeship logic đã có (`pricing.calcShippingFee`), chỉ thêm hiển thị. |
| **"Mua kèm / SP liên quan"** | M2 | Rule-based theo danh mục/combo (trà+mật ong). |
| **Quick-reply + auto-reply OA** | M2 | Kho mẫu tin + tin chào tự động qua Zalo OA. |
| **Streak Repair** | M3 | Bổ sung cho `streakFreezes` đã có: hồi sinh chuỗi đã mất (giới hạn 1 lần/tháng). |
| **Hết hạn điểm + nhắc "sắp hết hạn"** | M3 | Sink chống lạm phát + trigger win-back. |
| **Nền tảng: chiến lược OA 48h + đăng ký template ZNS** | cả 2 | Bắt buộc làm trước remarketing (Phase 2). |

### Phase 2 — Đòn bẩy giữ chân & chống churn (cao × TB)
| Việc | Mảng | Ghi chú |
|---|---|---|
| **Skip/Pause thay vì Hủy** (subscription) | M3 | Save-flow: bỏ qua kỳ/tạm dừng/đổi tần suất trước khi cho hủy (vẫn có đường hủy rõ). |
| **Discount thang theo số subscription** (5→15%) | M3 | Khoá nhiều SKU tiêu hao vào định kỳ. |
| **Remarketing OA + ZNS** | M2 | Nhắc giỏ bỏ quên / voucher sắp hết hạn / lô mới. Cần template ZNS từ Phase 1. |
| **Feed "Dành cho bạn"** | M2 | item-CF/rule theo lịch sử xem-mua; tận dụng `ai-advisor`. |
| **Dashboard Faucet/Sink** (economy telemetry) | M3 | Theo dõi phát/tiêu coin. *Lưu ý: coin mềm (nước/hạt) vs TubuXu vs Ví ĐÃ tách sẵn — chủ yếu cần dashboard đo lường.* |

### Phase 3 — Chiều sâu & nhịp mùa
| Việc | Mảng | Ghi chú |
|---|---|---|
| **Referral 2 chiều + anti-fraud stack** | M3 | Thưởng cả 2 phía, gắn đơn thật; OTP + device fingerprint + chặn self-referral. **Giữ 1 cấp** (xem §4). |
| **Season/Battle Pass** phủ Vườn Xanh | M3 | Track free + premium (theo hạng/subscriber); tái dùng `Season`. |
| **Sự kiện cộng đồng cao trào tập thể** | M3 | Mục tiêu chung → trồng rừng thật/CSR; tái dùng `CommunityGoal`. |
| **"Nhắc tôi" flash sale + Chat AI tư vấn** | M2 | Nhắc map sang OA/ZNS; Chat AI hợp hàng thiên nhiên (giải thích thành phần). |

---

## 6. Giới hạn nghiên cứu & độ tin cậy

- **Nguồn CTV (Droppii/Selly/Cuccu):** phần lớn từ blog affiliate/trang chính chủ (thiên vị tích cực) + báo chí (cao cho gọi vốn/mô hình). Số % hoa hồng dao động theo nguồn/thời điểm — coi là khoảng tham chiếu.
- **Đã bác bỏ/đính chính:** "Droppii bị chuyển công an" (chưa xác minh); Freeship Xtra % cũ (đã tái cấu trúc 04/2025); các con số freeship "44,7%/46%" (misattributed); flash sale "tự thêm giỏ + nhắc 3 phút" (không có nguồn); CRR "90 ngày" (đúng là 12h/30 ngày).
- **Số liệu cần dè dặt:** lift % của Dropbox/Duolingo/cá nhân hoá; involuntary churn 20–40%; breakage điển hình. Nguyên lý ngành thì vững; con số cụ thể nên tự verify trước khi dùng đối ngoại.
- **Ràng buộc Zalo (OA/ZNS/phí):** confidence cao (nguồn chính chủ oa.zalo.me, zalo.solutions, miniapp.zaloplatforms.com) — nhưng phí/quota có thể đổi theo thời điểm.
- **Pháp lý:** khung Nghị định 40/2018, 52/2024, Điều 217a BLHS là thật; áp dụng cụ thể cho Tubu **cần luật sư**.
