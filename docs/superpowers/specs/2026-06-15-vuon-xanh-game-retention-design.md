# Vườn Xanh 2.0 — Nâng cấp game trồng cây cho retention & CSR

- **Ngày:** 2026-06-15
- **Trạng thái:** Design đã duyệt (chờ review spec → writing-plans Phase 1)
- **Phạm vi:** `apps/miniapp` (FE game) + `apps/api` (module game) + `packages/shared-types`

## 1. Mục tiêu & nguyên tắc

**Mục tiêu chính (user chốt):** Thương hiệu + CSR — gắn bó cảm xúc qua **trồng cây thật** và **giáo dục sống xanh**, hơn là thưởng tiền. Hệ quả: daily loop dựa trên đầu tư cảm xúc + học hỏi, không phải cày điểm.

**Mục tiêu phụ:** user mở app **hàng ngày** (retention D1/D7/D30); đẩy mua hàng là hệ quả sau.

**Nguyên tắc chốt qua brainstorming:**
1. **Quiz thiên nhiên = nguồn nước CHÍNH** (mô hình Freerice): trả lời đúng câu hỏi khoa học/thiên nhiên → thu 💧 + học 1 điều ("Bạn có biết…").
2. **Cây thật theo MỐC CỘNG ĐỒNG** (mô hình Ant Forest, gom batch): hồ giọt nước toàn user → đủ mốc → Tubu trồng cây thật ở vùng VN có tên → chi phí kiểm soát, cảm giác chung tay.
3. **Tách tiền tệ:** 💧 (game-currency, phi quy đổi) cho daily action + huy hiệu/trang trí cosmetic; **điểm Xanh** (tiền loyalty thật) CHỈ ở mốc lớn/hiếm → cắt liền nợ.
4. **Chất lượng bắt buộc:** code sạch (tách module), không bug (atomic/idempotent), TDD logic kinh tế, UX mượt 60fps, UI hiện đại–đẹp–dễ dùng.

## 2. Học từ game thành công (research 2026-06-15)

| Nguồn | Bài học áp dụng |
|---|---|
| **Ant Forest (Alipay)** — 500M user, 100M+ cây thật ([WEF](https://www.weforum.org/stories/2020/07/china-ant-forest-app-carbon-emissions-trees/)) | Hành động ảo → cây thật; **vùng trồng có tên** + chứng nhận + minh bạch tác động; cơ chế **hẹn giờ** (giọt sương sáng); social để dành phase sau |
| **Duolingo** — 55% DAU ([trophy.so](https://trophy.so/blog/duolingo-gamification-case-study)) | **Streak + vé giữ lửa** (loss-aversion), **daily goal**, BXH (+40%), **push cá nhân hoá**, badge/quest; mỗi cơ chế phục vụ 1 nhóm user |
| **Freerice (WFP)** ([wfpusa.org](https://wfpusa.org/get-involved/freerice/)) | Trả lời quiz → quyên góp THẬT; nhiều **chủ đề + mức khó** + mục tiêu nhóm cộng dồn → xác nhận cơ chế "quiz → nước → cây thật" |
| **Shopee Farm/Lazada** | Check-in ngày + spin + vouchers; tie-in mua sắm nhẹ (ta giữ nhẹ qua tách tiền tệ) |
| **Nguyên lý retention** ([habit loop](https://dev.to/krizekster/the-habit-loop-hidden-in-every-game-youve-ever-loved-14kn)) | Loss-aversion (95% game dùng daily reward), **variable reward** (spin/rương) mạnh nhất, streak ≥7 ngày giữ chân tốt nhất, tránh biến grind thành "việc vặt" |

## 3. Trải nghiệm & vòng lặp ngày

```
Mở app
  → "Nhiệm vụ hôm nay" (điểm danh · trả lời quiz thiên nhiên lấy 💧 · tưới cây)
  → cây lớn thấy rõ (animation) → góp vào hồ cộng đồng
  → push nhắc hôm sau ("cây khát" / "giữ lửa" / "cộng đồng sắp đạt mốc")
```

**Lớp giữ chân:** streak + vé giữ lửa · mốc thưởng 3/7/14/30/100 ngày · badge · BXH tuần · spin (variable) · giọt sương sáng (hẹn giờ).

**Lớp nhân văn/giáo dục (điểm khác biệt):** mỗi câu hỏi dạy 1 điều · mỗi loài cây/vùng có chuyện sinh thái · trang **Tác động** minh bạch (cây thật, CO₂ ước tính, vùng, chứng nhận).

### Cơ chế quiz thiên nhiên (cốt lõi)
- Chủ đề: 🌳 Cây cối · 💧 Nước · 🌍 Đất · 🌬️ Không khí · 🐾 Động vật · ♻️ Tái chế · ⚡ Năng lượng.
- Nhiều mức khó; trả lời đúng → 💧 (bonus theo độ khó + streak ngày).
- Sau mỗi câu: reveal đáp án đúng + **"Bạn có biết…"** (giải thích ngắn).
- Giới hạn câu/ngày (config) để giữ nhịp daily, tránh cày 1 lần hết.

### Kinh tế (tách bạch — kiểm soát liền nợ)
- **💧 Giọt nước** = tiền game chính. Kiếm: quiz đúng, điểm danh (base nhỏ), giọt sương sáng, spin, (phase sau: hành động eco/đơn hàng). Tiêu: tưới cây, vé giữ lửa, trang trí.
- **Huy hiệu + trang trí** = thưởng thành tựu, phi quy đổi.
- **Điểm Xanh** (tiền thật): chỉ ở mốc lớn/hiếm (hoàn thành mùa, mốc cá nhân xa, phần thưởng mốc cộng đồng). Daily action KHÔNG còn mint điểm Xanh (hiện ~17đ/ngày → bỏ).

### Cây & thu hoạch
- Tưới 💧 → tăng tiến độ → đủ target → **thu hoạch**: cây ẢO vào bộ sưu tập + **toàn bộ 💧 đã tưới góp vào hồ cộng đồng**; phần dư carry-over (giữ logic hiện có).
- Cây héo/chết theo ngày không tưới (giữ, nhưng **vé giữ lửa** giảm sốc churn).

### Mốc cộng đồng (CSR cốt lõi)
- Hồ giọt nước toàn user (theo mùa/vùng): "Cộng đồng Tubu: X / Y 💧 → Z cây thật ở [vùng]".
- Đủ mốc → Tubu cam kết/trồng batch thật qua PanNature (gate tích hợp) → phát chứng nhận → mở mốc/vùng mới.
- Hiện đóng góp cá nhân + ghi nhận ("Bạn đã góp N💧 — top M%").

## 4. Kiến trúc kỹ thuật

### 4.1 Data model (Prisma)
**Sửa hiện có:**
- `GameQuiz`: thêm `category` (enum/string), `difficulty` (1..3), `explanation` (text), `waterReward` (int). (Giữ `correct`, `options`.)
- `GameProfile`: thêm `streakFreezes` (int default 0), `lastDewAt` (DateTime?), làm rõ `totalSeeds` = 💧 game-currency.

**Bảng mới:**
- `PlantSpecies` — `id, name, scientificName, region, rarity, story, ecoFact, imageUrl`.
- `UserSpecies` — `userId, speciesId, count, firstCollectedAt` (unique [userId, speciesId]).
- `CommunityGoal` — `id, seasonId?, title, region, targetDrops, currentDrops, treesToPlant, status(ACTIVE|FULFILLING|DONE), startAt, endAt`.
- `CommunityContribution` — `userId, goalId, drops` (unique [userId, goalId], increment nguyên tử).
- `Season` — `id, theme, region, featuredSpeciesIds, startAt, endAt`.
- (Phase 3) `GardenDecor` + `UserDecor` (cosmetic).

### 4.2 Tách module (sạch — thay GameService 376 dòng)
- `game-economy.service.ts` — 💧/điểm/streak/check-in/dew (atomic).
- `game-quiz.service.ts` — quiz theo chủ đề/độ khó + reveal explanation + thưởng 💧.
- `game-tree.service.ts` — tưới/thu hoạch/health/carry-over.
- `game-community.service.ts` — hồ cộng đồng, đóng góp, fulfil mốc → tạo PlantedTree batch.
- `game-collection.service.ts` — sổ tay loài + sưu tập (Phase 3).
- `game-season.service.ts` — mùa/sự kiện (Phase 4).
- `game.service.ts` còn là facade mỏng / xoá dần.

### 4.3 Endpoints (bổ sung)
- `GET /game/home` — gộp profile + daily-goal state + dew (giảm round-trip).
- `GET /game/quiz/today`, `POST /game/quiz/:id/answer` (trả `explanation`, `waterReward`).
- `POST /game/dew/collect`.
- `POST /game/streak-freeze/buy`.
- `GET /game/community` (mốc hiện tại + tiến độ + đóng góp của tôi).
- `GET /game/collection`, `GET /game/season` (phase sau).

### 4.4 An toàn (không bug)
- Tiền tệ: `updateMany` với điều kiện `gte` (đã có ở spin) cho mọi chỗ trừ 💧.
- Daily action: idempotent theo `dayKey` (đã có).
- Hồ cộng đồng: `increment` nguyên tử trên `CommunityGoal.currentDrops` + upsert `CommunityContribution` increment; fulfil mốc trong transaction + khoá trạng thái (`status` chuyển ACTIVE→FULFILLING `updateMany` count-guard chống trồng batch 2 lần).

## 5. UI/UX (hiện đại, đẹp, dễ dùng)
- Redesign màn **Vườn Xanh**: `GardenHero` (cây mọc động + theming mùa/trời), `DailyGoalCard` (3 micro-action), `QuizSheet` (sheet đẹp + reveal "Bạn có biết"), `CommunityMeter` (thanh tiến độ nổi bật + vùng có tên), `StreakStrip` (chuỗi + vé giữ lửa), `SpeciesCodex` (lưới sưu tập), `ImpactPanel` (cây thật/CO₂/chứng nhận), reuse `WheelOfFortune`.
- Icon Lucide đồng bộ ([[design-icon-immersive]]); giữ emoji minh hoạ game (cây/giọt) đúng quy ước.
- Animation 60fps (giọt nước, cây lớn, thu hoạch celebration), haptic, skeleton + error state mọi query, optimistic update cho tưới/điểm danh.
- Mỗi component isolated, props rõ, test được.

## 6. Yêu cầu chất lượng (NFR — bắt buộc)
- **TDD** cho logic kinh tế (streak tăng/đứt, carry-over thu hoạch, thưởng 💧 theo độ khó, fulfil mốc cộng đồng): hàm thuần + unit test (mở rộng `game.service.spec.ts`).
- **Atomic/idempotent** như §4.4 — không âm tiền, không double-credit, không double-plant.
- Mọi commit: `pnpm typecheck` + `lint` + `build` xanh (BE + FE); migration kèm khi đổi schema.
- Không phá vỡ consumer hiện có (điểm Xanh vẫn dùng ở ví/loyalty).

## 7. Phân phase (mỗi phase: spec con nếu cần → plan → code → test → ship)
- **Phase 1 — Vòng lặp lõi + nền retention** *(hiệu quả retention cao nhất, làm trước)*:
  quiz-thiên-nhiên-ra-💧 (category/difficulty/explanation), chuyển daily reward sang 💧, `DailyGoalCard`, streak + vé giữ lửa + mốc thưởng, giọt sương sáng, push nhắc (OA/in-app; ZNS gate), `GardenHero` + thu hoạch đẹp. Tách `game-economy`/`game-quiz`/`game-tree`.
- **Phase 2 — Mốc cộng đồng cây thật:** `CommunityGoal/Contribution`, `CommunityMeter`, fulfil batch theo vùng, `ImpactPanel`, chứng nhận rework.
- **Phase 3 — Sưu tập & chiều sâu vườn:** `PlantSpecies/UserSpecies` + chuyện sinh thái, `SpeciesCodex`, trang trí, theming mùa.
- **Phase 4 — Mùa/sự kiện + BXH mùa + (tuỳ chọn) tặng nước bạn bè (social).**

## 8. Rủi ro / phụ thuộc
- **PanNature**: trồng cây thật mốc cộng đồng cần kênh tích hợp (webhook/batch) — gate, hiện cam kết + chứng nhận trước ([[pending-decisions]] #12).
- **ZNS push**: cần template duyệt (~7–14 ngày) — Phase 1 dùng OA/in-app trước ([[pending-decisions]] #4/#11).
- **Nội dung**: cần ngân hàng câu hỏi thiên nhiên (chủ đề/độ khó/giải thích) + chuyện loài/vùng — cần soạn nội dung (người dùng cung cấp hoặc tôi seed mẫu).

## 9. Out of scope (YAGNI giai đoạn này)
- Mua bán cosmetic bằng tiền thật; PvP; chat trong game; tích hợp bước chân/đo carbon thật (Ant Forest-style) — cân nhắc rất sau.
