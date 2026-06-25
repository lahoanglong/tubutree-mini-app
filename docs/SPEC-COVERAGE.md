# Tubu Tree — Spec Coverage (Build Spec v1.1)

Đối chiếu §6.1–6.14 spec với code. Cập nhật: 2026-06-24 (TubuXu + giới thiệu bạn bè + hoàn thiện cashback).
Trạng thái: **✅ xong** · **🟡 một phần / back-office** · **⏳ Phase 2 (hoãn có chủ đích)** · **❓ cần bạn quyết**.

## Core (§6.1–6.13)

| Mục | Trạng thái | Ghi chú |
|-----|-----------|---------|
| 6.1 Auth & user | ✅ 🟡 | Zalo Mini App login + web OAuth, JWT refresh **rotation atomic + chống reuse**, RBAC, /me + addresses. 🟡 gated/defer: OTP SMS web (cần eSMS provider — Zalo login đã phủ), account-merge-by-phone (edge case), field `gender` |
| 6.2 Catalog | ✅ | products/brands/categories, search typeahead (Postgres), related (cùng brand), **bought-together (co-occurrence)** |
| 6.3 Cart & checkout B2C | ✅ | cart+coupon, quote, place-order **idempotent + atomic ví/điểm**, COD/ZaloPay/Ví. 🟡 VNPay (đã chọn ZaloPay), isCombo, PENDING_SYNC-retry: hoãn |
| 6.4 Đơn & tracking | ✅ | list/detail/cancel/repurchase/track + **đổi/trả (return-request)** full-stack |
| 6.5 Hóa đơn điện tử | ✅ | issue-invoice + webhook invoice.issued (cần key Pancake để phát hành thật) |
| 6.6 Loyalty | ✅ 🟡 | điểm/tier/multiplier, voucher welcome/birthday/winback/**milestone**. **TubuXu** (tiền tệ tiêu-trong-app): Ví→xu ×1.2, rút min 100k/phí 3k (**idempotency-key chống rút 2 lần**), mua hàng/nước/cây bằng xu (2026-06-24). Đơn trả bằng XU **không sinh điểm Xanh** (config `loyalty.earn_points_on_xu`, default off) — chống khuếch đại; hủy/đổi-trả đơn XU **hoàn lại xu**. ❓ nightly tier-recalc + grace 30 ngày: cần chốt cách tính điểm-hạng (lifetime vs balance) |
| 6.7 Gamification | ✅ | **Vườn Xanh 2.0 đủ 4 phase (2026-06-15):** check-in/streak + **vé giữ lửa** + **giọt sương**, **quiz thiên nhiên→💧** (chủ đề/độ khó/reveal "Bạn có biết"), spin, tưới cây→thu hoạch (**cây héo/chết §6.7.3**, cây thật+chứng nhận), **push nhắc** (điểm danh/cây khát), **mốc cộng đồng cây thật** (CommunityGoal/Contribution + fulfil batch), **sổ tay loài** (10 loài VN, rarity), **mùa/sự kiện + BXH mùa**, **tặng nước bạn bè** (social), **lô đất / mở rộng vườn** (GardenPlot — mở lô bằng 💧/xu, tưới & thu hoạch độc lập, 2026-06-24). |
| 6.8 Affiliate/CTV | ✅ | register, link, dashboard + **bậc doanh số tháng**, commission lifecycle, payout (chống mất tiền/double-spend) |
| 6.9 Cashback | ✅ | merchants, click→deeplink, postback **có verify token** (guard số âm, bỏ qua sau PAID), settle cron→Ví + **thông báo CASHBACK_PAID**, **referee CONFIRMED đầu → thưởng TubuXu 2 chiều** (cần key Accesstrade thật). 🟡 reconciliation cron kéo /transactions từ AT: gated theo key |
| 6.10 Đại lý B2B | ✅ 🟡 | **User-facing đủ**: đăng ký+KYC, bảng giá theo bậc (cap 45%), đơn CREDIT/PREPAID, credit-ledger, Quick Order. 🟡 back-office hoãn: thưởng quý, admin upload Excel giá, DealerPriceHistory |
| 6.11 Notifications | ✅ | 17 template INAPP/ZNS (ZNS gửi thật khi có OA token) |
| 6.12 Search & gợi ý | ✅ | gợi ý cùng-brand + thường-mua-kèm. (Meilisearch: dùng Postgres thay — đã quyết) |
| 6.13 Reviews | ✅ | review sau DELIVERED, ảnh+sao, điểm 10/5, badge "Đã mua", **admin ẩn (không xóa)** |

## §6.14 Tính năng bứt phá (Discovery)

| Mục | Phase | Trạng thái |
|-----|-------|-----------|
| 6.14.1 Onboarding Quiz | 1 | ✅ |
| 6.14.2 Brand Story Map | 1-2 | ✅ |
| 6.14.5 Refer 2 chiều | 1 | ✅ (cả 2 nhận 50k voucher, đơn ≥200k) + **giới thiệu kiểu MoMo: thưởng TubuXu 2 chiều khi referee có cashback CONFIRMED đầu; ghi referredById lúc đăng ký qua ?ref=** |
| 6.14.7 Lifecycle Reminder | 1 | ✅ (cron nhắc mua lại) |
| 6.14.10 Wishlist + Price Drop Alert | 1 | ✅ |
| 6.14.4 Subscribe & Save | 2 | ✅ (đã làm sớm) |
| 6.14.3 AI tư vấn 24/7 | 2 | ✅ (chatbot RAG catalog; DeepSeek chính + Gemini dự phòng; rate-limit 10/phút; tắt graceful khi thiếu key) |
| 6.14.6 Refill/đổi vỏ chai | 2 | ⏳ |
| 6.14.8 Mua chung (Group Buy) | 2 | ✅ (mở nhóm/tham gia, đủ người trước hạn → SUCCESS + coupon giảm giá mỗi thành viên; cron hết hạn → FAILED; atomic chống vượt target) |
| 6.14.9 Review video (UGC) | 2 | ⏳ |
| 6.14.11 Beta Tester | 2 | ⏳ |
| 6.14.12 Community Feed | 2 | ✅ (bảng tin: bài viết + thả tim 💚 + bình luận; auto-post khi thu hoạch; tên ẩn) |

## Tổng kết
- **Toàn bộ §6.1–6.14 đã audit. Phase-1 user-facing hoàn thiện** — miniapp dùng được full chức năng (với COD/Ví/TubuXu; ZaloPay/ZNS/Pancake/Accesstrade/eSMS bật khi có key).
- **399 unit test pass**, 43 suite (gồm Vườn Xanh 2.0 + TubuXu + Group Buy + Garden plot atomic/guard 2026-06-25). 3-app typecheck + build sạch. API boot + health OK.
- **TubuXu (2026-06-24):** Ví→xu ×1.2; rút bank min 100k/phí 3k; thanh toán đơn bằng xu; mua nước/cây thật bằng xu; giới thiệu bạn thưởng xu 2 chiều khi referee có cashback CONFIRMED. Đối soát: `pnpm --filter @tubutree/api reconcile:points`. Spec: `docs/superpowers/specs/2026-06-24-tubuxu-referral-cashback-design.md`.
- **Cần bạn quyết/cấp:** (1) cách tính điểm-hạng cho tier-recalc cron §6.6; (2) API keys go-live còn thiếu (ZaloPay/OA-ZNS/Accesstrade/Cloudinary) — xem `.env.production.example`. **Pancake đã có key trong `.env`.**
- **Đã hoàn thiện thêm (2026-06-24/25):** AI tư vấn 24/7 ✅, Mua chung/Group Buy ✅ (idempotent coupon + cron reconcile), Community Feed ✅, lô đất/mở rộng vườn ✅.
- **Back-office/Phase-2 còn hoãn có chủ đích:** thưởng quý đại lý, admin Excel giá, **6.14.6 Refill/đổi vỏ chai**, **6.14.9 Review video (UGC)**, **6.14.11 Beta Tester**.
- Deploy: xem `docs/DEPLOY-GCP.md` (đã push GitHub, đợi bạn dựng VM).
