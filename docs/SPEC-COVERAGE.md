# Tubu Tree — Spec Coverage (Build Spec v1.1)

Đối chiếu §6.1–6.14 spec với code. Cập nhật: loop review đêm 2026-06-13.
Trạng thái: **✅ xong** · **🟡 một phần / back-office** · **⏳ Phase 2 (hoãn có chủ đích)** · **❓ cần bạn quyết**.

## Core (§6.1–6.13)

| Mục | Trạng thái | Ghi chú |
|-----|-----------|---------|
| 6.1 Auth & user | ✅ 🟡 | Zalo Mini App login + web OAuth, JWT refresh **rotation atomic + chống reuse**, RBAC, /me + addresses. 🟡 gated/defer: OTP SMS web (cần eSMS provider — Zalo login đã phủ), account-merge-by-phone (edge case), field `gender` |
| 6.2 Catalog | ✅ | products/brands/categories, search typeahead (Postgres), related (cùng brand), **bought-together (co-occurrence)** |
| 6.3 Cart & checkout B2C | ✅ | cart+coupon, quote, place-order **idempotent + atomic ví/điểm**, COD/ZaloPay/Ví. 🟡 VNPay (đã chọn ZaloPay), isCombo, PENDING_SYNC-retry: hoãn |
| 6.4 Đơn & tracking | ✅ | list/detail/cancel/repurchase/track + **đổi/trả (return-request)** full-stack |
| 6.5 Hóa đơn điện tử | ✅ | issue-invoice + webhook invoice.issued (cần key Pancake để phát hành thật) |
| 6.6 Loyalty | ✅ 🟡 | điểm/tier/multiplier, voucher welcome/birthday/winback/**milestone**. ❓ nightly tier-recalc + grace 30 ngày: cần chốt cách tính điểm-hạng (lifetime vs balance) |
| 6.7 Gamification | ✅ 🟡 | check-in/streak, spin (Điểm Xanh), quiz, tưới cây→thu hoạch, **cây héo/chết §6.7.3**, **cây thật + chứng nhận**, missions, leaderboard. ⏳ Phase-2: ghé vườn bạn bè (social), lô đất, free-spin economy |
| 6.8 Affiliate/CTV | ✅ | register, link, dashboard + **bậc doanh số tháng**, commission lifecycle, payout (chống mất tiền/double-spend) |
| 6.9 Cashback | ✅ | merchants, click→deeplink, postback **có verify token**, settle cron→Ví (cần key Accesstrade thật) |
| 6.10 Đại lý B2B | ✅ 🟡 | **User-facing đủ**: đăng ký+KYC, bảng giá theo bậc (cap 45%), đơn CREDIT/PREPAID, credit-ledger, Quick Order. 🟡 back-office hoãn: thưởng quý, admin upload Excel giá, DealerPriceHistory |
| 6.11 Notifications | ✅ | 17 template INAPP/ZNS (ZNS gửi thật khi có OA token) |
| 6.12 Search & gợi ý | ✅ | gợi ý cùng-brand + thường-mua-kèm. (Meilisearch: dùng Postgres thay — đã quyết) |
| 6.13 Reviews | ✅ | review sau DELIVERED, ảnh+sao, điểm 10/5, badge "Đã mua", **admin ẩn (không xóa)** |

## §6.14 Tính năng bứt phá (Discovery)

| Mục | Phase | Trạng thái |
|-----|-------|-----------|
| 6.14.1 Onboarding Quiz | 1 | ✅ |
| 6.14.2 Brand Story Map | 1-2 | ✅ |
| 6.14.5 Refer 2 chiều | 1 | ✅ (cả 2 nhận 50k, đơn ≥200k) |
| 6.14.7 Lifecycle Reminder | 1 | ✅ (cron nhắc mua lại) |
| 6.14.10 Wishlist + Price Drop Alert | 1 | ✅ |
| 6.14.4 Subscribe & Save | 2 | ✅ (đã làm sớm) |
| 6.14.3 AI tư vấn 24/7 | 2 | ⏳ cần Claude API key |
| 6.14.6 Refill/đổi vỏ chai | 2 | ⏳ |
| 6.14.8 Mua chung (Group Buy) | 2 | ⏳ |
| 6.14.9 Review video (UGC) | 2 | ⏳ |
| 6.14.11 Beta Tester | 2 | ⏳ |
| 6.14.12 Community Feed | 2 | ⏳ |

## Tổng kết
- **Toàn bộ §6.1–6.14 đã audit. Phase-1 user-facing hoàn thiện** — miniapp dùng được full chức năng (với COD/Ví; ZaloPay/ZNS/Pancake/Accesstrade/eSMS bật khi có key).
- **200 unit test pass**, 28 suite. 3-app build sạch (local + Docker). API boot + health OK.
- **Cần bạn quyết/cấp:** (1) cách tính điểm-hạng cho tier-recalc cron §6.6; (2) API keys go-live (Pancake/ZaloPay/OA-ZNS/Accesstrade/Cloudinary) — xem `.env.production.example`.
- **Back-office/Phase-2 hoãn có chủ đích:** thưởng quý đại lý, admin Excel giá, AI tư vấn, group buy, review video, community feed.
- Deploy: xem `docs/DEPLOY-GCP.md` (đã push GitHub, đợi bạn dựng VM).
