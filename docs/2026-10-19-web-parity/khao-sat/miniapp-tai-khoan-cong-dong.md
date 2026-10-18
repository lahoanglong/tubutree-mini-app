# Khảo sát scout: miniapp-tai-khoan-cong-dong

(Báo cáo nguyên văn của agent quét, chưa kiểm chứng từng dòng.)

Base: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/web-parity/apps/miniapp/src. Routes from components/app.tsx:189-245. Phone gating: none of the 19 pages calls ensurePhone or requestZaloPhoneToken directly (only checkout/recycle do), so "Needs verified phone" is no everywhere below. "Not traced" means the service body was not read.

## profile.tsx — route /profile
- Purpose: "Cá nhân" hub: header card, points/wallet/coupon shortcuts, grouped menu (MENU, profile.tsx:43-75) with role-based extras.
- Sub-features: header card → /edit-profile; shortcuts Điểm Xanh→/loyalty, Ví Tubu→/wallet (state.from=/profile), Mã giảm giá→/loyalty; menu groups Mua sắm / Tài sản / Hợp tác / Khác; "Hoàn tiền sàn ngoài" only if CASHBACK_ENABLED (false); /ai-advisor hidden unless aiAdvisorEnabled; /points/scan hidden unless cfg.loyalty.marketplaceClaimEnabled; "Quản lý nhãn hàng" added if owned brand exists; group "Công việc": STAFF+ADMIN see /staff and /my-payroll, ADMIN also /admin; loading skeleton (role="status"); referral code copy (copyText); no phase → AuthPhaseView.
- API: getLoyalty → GET /me/loyalty; getNotifications → GET /me/notifications; getWallet → GET /me/wallet; getCoupons → GET /me/coupons; getOwnedBrand → not traced; getDealerMe → not traced
- Zalo SDK/bridge: none (imports zmp-ui only)
- Auth: guest sees GuestPrompt via AuthPhaseView; login required for wallet/coupons/notifications queries; role gating: STAFF/ADMIN work menu, ADMIN extra item, AFFILIATE/DEALER via dealer and affiliate menu
- Needs verified phone: no
- Key shared components: AuthPhaseView, Avatar(zmp-ui), Badge, Card, EmptyState, Icon, ListRow, Skeleton, Heading/Text
- Spec tests: profile.spec.ts=11, profile-hub.spec.tsx=12, profile-brand-owner.spec.tsx=3 (total 26)

## edit-profile.tsx — route /edit-profile
- Purpose: edit fullName, email, dob, avatar.
- Sub-features: avatar tap → file input (accept image/*) → readAndCompressImage → AvatarCropModal → uploadToCloudinary (only if isCloudinaryConfigured()); email validation "Email không hợp lệ"; dob field; Save button disabled while emailInvalid or uploading; on avatarUrl rejection, retries without avatarUrl (edit-profile.tsx:~120); ErrorState with retry when getMe fails; navigate(-1) on success.
- API: getMe → GET /me; updateMe → PATCH /me (body fullName, email, avatarUrl, dob)
- Zalo SDK/bridge: none
- Auth: no phase check in page; getMe is unconditional; login effectively required
- Needs verified phone: no
- Key shared components: image-upload (readAndCompressImage, uploadToCloudinary), avatar-crop-modal, PageHeader, Field, Button, ErrorState, Skeleton
- Spec tests: edit-profile.spec.tsx=15

## settings.tsx — route /settings (+ settings-legacy-sync.ts, settings-notify-prefs.ts, both in pages/, not routes)
- Purpose: notification preferences (server) and font scale (device), plus account links and logout.
- Sub-features: "Thông báo" section: "Cập nhật đơn hàng" always on (no toggle); switch "Khuyến mãi & mã giảm giá" (notifyPromo); switch "Nhắc nhở Vườn Xanh & tương tác bài viết" (notifyGarden); toggles locked while saving; revert + snackbar on error. Font scale radiogroup "Cỡ chữ" with small/normal/large; applyFontScale. "Tài khoản": link /edit-profile, /addresses. OA section: followOA then requestNotifyPermission; disabled when !hasOA; state from getOaPromptState/setOaPromptState. Renders null until prefs read. Logout via useAuthStore.
- settings-notify-prefs.ts: fetchNotifyPrefs, saveNotifyPrefs, legacyOptOuts (only turns OFF groups the device had turned off and the server still has on).
- settings-legacy-sync.ts: syncLegacyNotifyPrefs / useLegacyNotifyPrefsSync(authed) run on app open: reads local tubu_prefs, pushes legacy opt-outs, then rewrites tubu_prefs to {fontScale} only.
- API: fetchNotifyPrefs → GET /me/notifications/prefs; saveNotifyPrefs → PATCH /me/notifications/prefs; syncLegacyNotifyPrefs → GET then PATCH /me/notifications/prefs (only if legacy keys exist)
- Zalo SDK/bridge: zmp-sdk/apis getStorage/setStorage (key tubu_prefs, JSON: {notifyPromo?, notifyGarden?, fontScale?}); zmp-bridge: hasOA, followOA, requestNotifyPermission, getOaPromptState, setOaPromptState
- Auth: no guest gate in page; fetchNotifyPrefs needs session (failure shows snackbar "Chưa tải được cài đặt thông báo")
- Needs verified phone: no
- Key shared components: PageHeader, Section, LinkRow (local), Card, ListRow, Icon, Text, Button, haptic, font-scale util
- Spec tests: settings.spec.tsx=14, settings-legacy-sync.spec.tsx=4 (settings-notify-prefs.ts has no spec)

## notifications.tsx — route /notifications
- Purpose: inbox of notifications with per-template icon, title, relative time, and an action per item.
- Sub-features: list with unread dot (aria-label "chưa đọc"); mark-one-read on open; "mark all read" mutation; detail BottomSheet/dialog (aria-label "Chi tiết thông báo") with back button; action per template: reorder reminder → ReorderSheet (REORDER_REMINDER*), link buttons (e.g. /rewards/mine, /recycle/desk, /recycle/done/:id, /recycle/r/:id, /game, /cart, /wallet, /subscriptions, /storefront, /dealer, /group-buy); ops/admin-only templates hidden; EmptyState; ErrorState with retry; window.history.state.notifDetail deep-opens a notification.
- API: getNotifications → GET /me/notifications; markNotificationRead → POST /me/notifications/:id/read; markAllNotificationsRead → POST /me/notifications/read-all; fetchPurchasedItems → not traced (shop-api); trackReorderReminderCta → analytics only
- Zalo SDK/bridge: none
- Auth: AuthGate (guest prompt); query enabled only when phase=authenticated
- Needs verified phone: no
- Key shared components: AuthGate, EmptyState, ErrorState, LineItemSkeleton, ReorderSheet, reorder-types, reorder-reminder, PageHeader, Card, IconButton, DsButton
- Spec tests: notifications-page.spec.tsx=12, notifications.spec.ts=25 (total 37)

## addresses.tsx — route /addresses
- Purpose: shipping address book.
- Sub-features: list of addresses with recipient · phone, default Badge; actions "Đặt mặc định" (set isDefault), "Sửa" (opens sheet), "Xóa" (confirm sheet "Xóa địa chỉ này?"); "add" BottomSheet title "Thêm địa chỉ" with AddressForm; edit sheet "Sửa địa chỉ"; EmptyState "Bạn chưa có địa chỉ giao hàng nào"; ErrorState retry; AuthGate.
- API: getAddresses → not traced (shop-api); updateAddress → PATCH /me/addresses/:id; deleteAddress → DELETE /me/addresses/:id. Add/create path: not traced.
- Zalo SDK/bridge: none
- Auth: AuthGate; login required
- Needs verified phone: no (phone is a free text field inside AddressForm)
- Key shared components: AddressForm, BottomSheet, Badge, Card, EmptyState, ErrorState, AuthGate, PageHeader
- Spec tests: addresses.spec.tsx=9

## loyalty.tsx — route /loyalty
- Purpose: tier/points hub: points balance, tier progress, check-in, coupons, member card, points history.
- Sub-features: daily check-in button (postDailyCheckIn, haptic, snackbar); member code copy (copyText) and member card BottomSheet "Thẻ Thành Viên Tubu" with QrCode (180px); "Mã giảm giá của tôi" coupon list; tier list "Các hạng" with thresholds; "Quyền lợi của bạn"; "Lịch sử Điểm Xanh" transactions; progressbar "Tiến độ lên hạng kế"; shortcut cards Vườn Cây (/game), Đổi rác lấy quà (/recycle, only if publicConfig.waste.enabled), Kho quà (/rewards); level-up detection saved in localStorage (KEY) and shows when tier rises; "Xem sản phẩm" → /browse on empty.
- API: getLoyalty → GET /me/loyalty; getCoupons → GET /me/coupons; getPointsTransactions → GET /me/points/transactions; getDailyCheckInStatus → GET /me/loyalty/check-in; postDailyCheckIn → POST /me/loyalty/check-in; getMemberCard → GET /me/loyalty/member-card
- Zalo SDK/bridge: none
- Auth: AuthPhaseView (guest prompt); queries enabled when authed
- Needs verified phone: no
- Key shared components: AuthPhaseView, QrCode, PointsBoostStrip (components/loyalty), BottomSheet, Badge, Card, ListRow, Skeleton, ErrorState, EmptyState, PageHeader
- Spec tests: loyalty.spec.ts=10, loyalty-behavior.spec.tsx=32, loyalty-layout.spec.tsx=9 (total 51)

## wallet.tsx — route /wallet
- Purpose: Ví Tubu balance, sources, withdraw, referral share, history.
- Sub-features: balance cards (SourceCard: Hoa hồng chờ duyệt, Hoa hồng có thể rút → /affiliate if approved >0, Hoàn tiền đã duyệt shown if CASHBACK_ENABLED or cashbackPending>0); "Rút tiền về ngân hàng" BottomSheet with amount, bank name, account number, account holder, fee default 3000 and min default 100000 (canWithdraw rule in utils/wallet-rules); withdraw uses idempotency key regenerated on success/error; referral share via useShareWithFallback; referral milestones from getReferral; infinite-scroll transaction list (WalletHistory, 20 per page); ErrorState; loyalty shortcut → /loyalty.
- API: getWallet → GET /me/wallet; getWalletTransactions → GET /me/wallet/transactions?page&limit=20; withdraw → POST /me/wallet/withdraw (path not traced in the grep; service at account-api.ts:359); getReferral → GET /me/referral; getLoyalty → GET /me/loyalty
- Zalo SDK/bridge: share via share-sheet useShareWithFallback (zmp shareLink path in zmp-bridge.ts:321)
- Auth: AuthPhaseView; queries enabled when authed
- Role gating: isAffiliate (AFFILIATE) and isCommissionRole (AFFILIATE or DEALER) change commission copy; commission still shown if amount >0 regardless of role
- Needs verified phone: no
- Key shared components: AuthPhaseView, BottomSheet, Field, Badge, Button, ErrorState, Skeleton, PageHeader, useShareWithFallback (share-sheet), uniqueById, newIdempotencyKey
- Spec tests: wallet.spec.tsx=36

## external-points.tsx — route /points/scan
- Purpose: claim Điểm Xanh from external-brand receipts/codes.
- Sub-features: text Field for the code + "Quét mã" button (scanCode, native QR); submit → result card (data-testid claim-result, status-mapped text, CLAIMED_BY_OTHER branch, past-milestone text); history list of claims paginated 10/page with state badges (PENDING, REVIEW, HELD_NO_MEMBER, CREDITED, REVERSED, LAPSED, default voided); error role="alert" with reject-code mapping (externalClaimRejectCode).
- API: submitExternalClaim → POST /me/external-points/claims {code}; getMyExternalClaims → GET /me/external-points/claims?page&limit=10; getPublicConfig → not traced (shop-api; staleTime 5 min)
- Zalo SDK/bridge: scanCode (zmp-bridge.ts:146, zmp-sdk QR scanner)
- Auth: AuthPhaseView
- Needs verified phone: no
- Key shared components: AuthPhaseView, PointsBoostStrip, Badge, Button, Card, EmptyState, ErrorState, Field, Skeleton
- Spec tests: external-points.spec.tsx=13

## rewards.tsx — route /rewards
- Purpose: "Kho quà": spend Điểm Xanh on rewards.
- Sub-features: SegmentedTabs REWARD_TABS: "Mã giảm giá" (VOUCHER), "Cây và hạt" (TREE, SEED_PACK), "Quà nhỏ" (GIFT); ListRow "Quà của tôi" → /rewards/mine; reward cards with rewardCardState (locked/affordable); confirm BottomSheet "Xác nhận đổi quà" → redeem; success BottomSheet "Đổi quà thành công" with navigate to target path; error snackbar; waste pickup address shown via pointAddress/openingHours.
- API: getLoyaltyRewards → GET /me/loyalty/rewards; getLoyalty → GET /me/loyalty; redeemLoyaltyReward → POST /me/loyalty/rewards/:rewardId/redeem (path per account-api.ts:219, body idempotencyKey); WASTE_QUERY_KEYS/invalidateAfterRedeem → cache only (waste-api); buyTree (game-api.ts:121) is imported but its call site was not traced
- Zalo SDK/bridge: none
- Auth: AuthGate
- Needs verified phone: no
- Key shared components: AuthGate, SegmentedTabs, BottomSheet, Badge, Card, ErrorState, ListRow, ProgressBar, Skeleton, PageHeader
- Spec tests: rewards.spec.tsx=16 (rewards-mine.spec.tsx counted separately)

## rewards-mine.tsx — route /rewards/mine
- Purpose: list of my redeemed gifts with code QR.
- Sub-features: each redemption card with QrCode (140px) of r.code; empty → EmptyState "Bạn chưa đổi quà nào" with CTA "Đến Kho quà" → /rewards; ErrorState; button → /loyalty; openingHoursText imported from ./rewards.
- API: getMyRedemptions → GET /me/loyalty/rewards/mine
- Zalo SDK/bridge: none
- Auth: AuthGate
- Needs verified phone: no
- Key shared components: AuthGate, QrCode, Card, EmptyState, ErrorState, ListRow, Skeleton, PageHeader
- Spec tests: rewards-mine.spec.tsx=6

## game.tsx — route /game ("Vườn Cây Tubu")
- Purpose: gamified garden: daily check-in, quiz, watering, trees, missions, season, community, friends.
- Sub-features: SegmentedTabs GAME_TABS: "Hôm nay" (today), "Vườn" (garden), "Cộng đồng" (community); today: GardenHero, streak (CheckInStreak, StreakRepair), QuizCard, LuckyWheelCard (spin + WheelPrizeSheet), MissionsCard, TreeHealthAlert, EcoImpact, TreeActions, waste link if publicConfig.waste.enabled; garden: GardenPlots, SpeciesCodex, FriendGifts, GameLinkRow; community: CommunityGoal, SeasonLeaderboard, WeeklyLeaderboard, HarvestCelebration; SeasonBanner; SeasonPass is hidden (SEASON_PASS_ENABLED=false); skeleton and SessionUnavailable on unavailable phase.
- API (via components/game/use-game-data.ts queries and use-game-actions.ts mutations): getGameProfile → GET /game/profile; getTodayQuiz → GET /game/quiz/today; answerQuiz → POST /game/quiz/:id/answer; getLeaderboard → GET /game/leaderboard; getMissions → GET /game/missions; claimMission → POST /game/missions/:code/claim; getForest → GET /game/forest; getCommunity → GET /game/community; getCollection → GET /game/collection; getSeason → GET /game/season; getSeasonLeaderboard → GET /game/season/leaderboard; getGarden → GET /game/garden; getFriends → GET /game/friends; checkIn → POST /game/check-in; collectDew → POST /game/dew/collect; buyStreakFreeze → POST /game/streak-freeze/buy; repairStreak → POST /game/streak/repair; spin → POST /game/spin; waterTree(20) → POST /game/tree/water (path at game-api.ts:108, not confirmed); buyTree(key) → POST /game/tree/buy (game-api.ts:121, not confirmed); unlockPlot → POST /game/garden/unlock {currency:"SEEDS"}; waterPlot(plotId,20) → POST /game/garden/plots/:id/water (path not confirmed); giftWater → POST /game/gift/:recipientId; claimSeasonPass → POST /game/season-pass/claim (not confirmed; gated off)
- Zalo SDK/bridge: none
- Auth: GameLoginGate when guest (onLogin → store login); SessionUnavailable when phase=unavailable
- Needs verified phone: no
- Key shared components: components/game/* (GardenHero, QuizCard, LuckyWheelCard, MissionsCard, GardenPlots, SpeciesCodex, FriendGifts, CommunityGoal, SeasonLeaderboard, WeeklyLeaderboard, HarvestCelebration, WheelPrizeSheet, game-tabs), SegmentedTabs, PageHeader
- Spec tests: game-behavior.spec.tsx=76, game-layout.spec.tsx=13, game-busy-lock.spec.tsx=7, game-wheel-tabs.spec.tsx=6, game-numbers.spec.tsx=1 (total 103)

## feed.tsx — route /feed (community Q&A)
- Purpose: community feed of posts (questions, tips, showcases).
- Sub-features: CommunityChannels; leaderboard and events entry buttons → /feed/leaderboard, /feed/events; SearchField (debounced 300 ms, useDebounced); sort chips new/popular; category chips (from getCategories); "unanswered" toggle chip; tag chip from ?tag=&tagName= with clear (navigate /feed replace); infinite list of PostCard → /feed/:id; PostComposer (create post); PullToRefresh; guest sees PublicPreviewList (getFeedPublicPreview) with login button; empty state "loginToView".
- API: getCategories → GET /feed/categories; getFeed → GET /feed (params sort, search, unanswered, tag, cursor); getFeedPublicPreview → GET /feed/public-preview; createPost → POST /feed (via PostComposer)
- Zalo SDK/bridge: none
- Auth: guest sees public preview; authed gets full feed (phase-based)
- Needs verified phone: no
- Key shared components: PostCard, PostComposer, PublicPreviewList, CommunityChannels, PullToRefresh, SearchField, ScrollRow, Chip, EmptyState, ErrorState
- Spec tests: feed.spec.tsx=26

## post-detail.tsx — route /feed/:id
- Purpose: single post with answers/comments.
- Sub-features: post body, kind labels/icons (KIND_LABEL/KIND_ICON); pending badge for owner; pin/unpin button (ADMIN); React heart toggle; comments list (infinite) with best-answer mark (QUESTION posts, owner or ADMIN), hide comment (owner), report comment (IconButton Flag); comment input (aria-label commentPlaceholder) + send; owner Edit (BottomSheet with title + body inputs) and Delete (confirm BottomSheet, then navigate /feed); report post BottomSheet (reason textarea, POST target POST); product tag buttons → /product/:slug; "Xem lời giải" / "Mua sản phẩm này" button for product-tagged posts; empty answers state; ErrorState.
- API: getPost → GET /feed/:id; getComments → GET /feed/:id/comments?cursor; reactPost → POST /feed/:id/react; addComment → POST /feed/:id/comments {body}; setBestAnswer → POST /feed/:id/best-answer/:commentId; removeComment → DELETE /feed/comments/:commentId; editPost → PATCH /feed/:id {title?, body}; deletePost → DELETE /feed/:id; reportContent → POST /feed/:postId/report (body targetType POST|COMMENT); adminPin → POST /feed/admin/:id/pin {pinned}
- Zalo SDK/bridge: none
- Auth: guest → EmptyState loginToView + login; owner/ADMIN gating as above
- Role gating: ADMIN (pin, best-answer on any question); owner (edit, delete, hide own comment, pending view)
- Needs verified phone: no
- Key shared components: AuthorLine, BottomSheet, EmptyState, ErrorState, IconButton, Skeleton, Input, PageHeader
- Spec tests: post-detail.spec.tsx=25

## community-events.tsx — route /feed/events
- Purpose: community events list with entries/posts per event.
- Sub-features: events list (listEvents); select event → infinite list of event posts (PostCard → /feed/:id); category chips; PostComposer for event posts; empty and error states.
- API: listEvents → GET /feed/events; eventPosts → GET /feed/events/:id/posts (cursor); getCategories → GET /feed/categories
- Zalo SDK/bridge: none
- Auth: guest sees login EmptyState; queries enabled when authed
- Needs verified phone: no
- Key shared components: PostCard, PostComposer, EmptyState, ErrorState, Skeleton, Badge, PageHeader
- Spec tests: community-events.spec.tsx=18

## community-leaderboard.tsx — route /feed/leaderboard
- Purpose: community ranking by reputation.
- Sub-features: table with rank (medal for 1-3, else #n), member Sprout icon, levelEmoji + levelName, reputation + "points" label; empty state; error retry.
- API: getLeaderboard → GET /feed/leaderboard
- Zalo SDK/bridge: none
- Auth: guest sees login EmptyState
- Needs verified phone: no
- Key shared components: levelEmoji (community/rank-badge), Card, EmptyState, ErrorState, Icon, Skeleton, Text
- Spec tests: community-leaderboard.spec.tsx=11

## academy.tsx — route /academy and /academy/:courseId
- Purpose: learning courses with lesson completion tracking.
- Sub-features: course list with progress text (vi.academy.progress) and ProgressBar; course detail (useParams courseId) with lessons numbered; VIDEO lessons open videoUrl as a link; ARTICLE lessons show body text; "complete" button per lesson (disabled when done or another completing; loading spinner); back → /academy replace; open course → /academy/:id; empty/error/skeleton states.
- API: fetchCourses → GET /academy/courses; fetchCourse → GET /academy/courses/:id; completeLesson → POST /academy/lessons/:lessonId/complete
- Zalo SDK/bridge: none (video open is a plain link, not openExternal)
- Auth: no phase/AuthGate in page; queries are unconditional; completing a lesson needs a session (not confirmed server-side here)
- Needs verified phone: no
- Key shared components: EmptyState, ErrorState, Skeleton, Button, Card, ListRow, ProgressBar, PageHeader
- Spec tests: academy.spec.tsx=18

## ai-advisor.tsx — route /ai-advisor
- Purpose: chat with the AI product advisor.
- Sub-features: chat log (role="log"); 3 suggestion chips (SUGGESTIONS); text input "Nhập câu hỏi…" + send (disabled when empty; loading state); product cards in replies → /product/:slug; failed reply shows fallback text; history sent is last 20 turns (MAX_HISTORY_TURNS=20); redirects to / if aiAdvisorEnabled is not true (after cfg loaded).
- API: aiChat → POST /ai-advisor/chat {message, history}
- Zalo SDK/bridge: none
- Auth: no phase check in page (login needed server-side)
- Needs verified phone: no
- Key shared components: Button, Card, Icon, ListRow, PageHeader, Text, Spinner (zmp-ui)
- Spec tests: ai-advisor.spec.tsx=29

## affiliate.tsx — route /affiliate (CTV/Cộng tác viên, 1127 lines)
- Purpose: affiliate (CTV) dashboard, registration, links, commissions, payouts, tax, storefront analytics.
- Sub-features: RegisterGate for non-CTV (terms version copy from vi.ctvTerms; registerAffiliate) ; CannotRegister ("Tài khoản này không đăng ký CTV được", for canRegister=false); Dashboard: shortcut row Chia sẻ (share referral via useShareWithFallback), Gian hàng (/storefront, if storefront), Lên đơn hộ (CtvOrderSheet in Sheet), Rút tiền (withdraw); MiniStat cards; links list with createAffiliateLink('HOMEPAGE'); commissions with COMMISSION_META badges (PENDING "Đang chờ · đơn chưa giao", LOCKED, APPROVED "Có thể rút", PAID, REJECTED); payouts list with PAYOUT_META; withdraw BottomSheet "Rút hoa hồng" (method WALLET_BALANCE default or BANK; BANK needs minimum from config; tax withheld payoutTax by config PIT; taxId required when askTaxId, validated by PERSONAL_TAX_ID_PATTERN; amount fixed to full withdrawable); tax statement by year; CTV tiers and milestone rewards (MilestoneRewards, claimCtvMilestone); storefront analytics and product breakdown; CtvShortcuts; link to /academy; loading skeleton.
- API: getAffiliateMe → GET /affiliate/me; registerAffiliate → POST /affiliate/register {termsVersion?}; getAffiliateDashboard → GET /affiliate/dashboard; getAffiliateLinks → GET /affiliate/links; createAffiliateLink → POST /affiliate/links {targetType, targetId?}; getCommissions → GET /affiliate/commissions; getMyPayouts → GET /affiliate/payouts; requestPayout → POST /affiliate/payouts (body amount, method, bankInfo, taxId; path at affiliate-api.ts:156-166, not re-verified); getTaxStatement → GET /affiliate/tax-statement?year; getStorefrontAnalytics → GET /affiliate/analytics/storefronts; getProductBreakdown → GET /affiliate/analytics/products; getCtvTiers → GET /affiliate/tiers; getCtvMilestones → GET /affiliate/milestones; claimCtvMilestone → POST /affiliate/milestones/:id/claim (path not confirmed); createCtvOrder → POST /affiliate/orders (CtvOrderSheet; path not confirmed); quoteCtvOrder → POST /affiliate/orders/quote; fetchContentKit → GET /affiliate/content-kit/:slug (not used in this page's grep, only in ContentKit sheet)
- Zalo SDK/bridge: none directly on this page; share via useShareWithFallback (share-sheet, Zalo share); openAffiliateLink in services/zmp-bridge.ts:168 is used by cashback.tsx, not here
- Auth: AuthPhaseView when not authed; then affiliate-me decides Dashboard / CannotRegister / RegisterGate
- Role gating: isAffiliate (CTV dashboard) vs canRegister=false (DEALER/STAFF cannot register); payout method ZALOPAY listed in types but UI offers WALLET_BALANCE and BANK
- Needs verified phone: no
- Key shared components: ChoiceCard, CtvOrderSheet, CtvShortcuts, MilestoneRewards, milestone-copy, Sheet(zmp-ui), BottomSheet, Badge, Checkbox, ProgressBar, useShareWithFallback
- Spec tests: affiliate.spec.tsx=40

## Surprising (max 5)
1. Feature flags hard-off in utils/features.ts: SEASON_PASS_ENABLED=false (game season pass hidden), CASHBACK_ENABLED=false (wallet cashback source and profile "Hoàn tiền sàn ngoài" hidden).
2. Settings uses zmp-sdk getStorage/setStorage key tubu_prefs as device store, with a one-time legacy migration (settings-legacy-sync.ts) that can only turn OFF the server's notify flags; web must not reproduce that device-only store as source of truth.
3. Zalo-only behaviour: followOA + requestNotifyPermission (settings OA section, gated by VITE_ZALO_OA_ID), scanCode (external-points QR), shareLink via useShareWithFallback (wallet, affiliate, feed/group-buy). Web needs QR scan and share-link equivalents or none.
4. Hard-coded values: wallet withdraw fee 3000 and min 100000 when API omits them; game waterTree/waterPlot drops fixed at 20; feed search debounce 300 ms; AI history cap 20 turns; affiliate ZALOPAY payout type is in the types but not offered in UI.
5. Unconfirmed: several service paths were read only from the grep (game water/buy/plot, affiliate orders/milestone claim, wallet withdraw, requestPayout body). getOwnedBrand, getDealerMe, getAddresses, getPublicConfig, fetchPurchasedItems, getWishlist bodies were not traced. Spec counts use `it(`/`test(` at line start; `it.each` is included, variant spec files are summed per page.
