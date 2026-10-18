# Khảo sát scout: miniapp-noi-bo-doi-rac

(Báo cáo nguyên văn của agent quét, chưa kiểm chứng từng dòng.)

Base for all files: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/web-parity/apps/miniapp/src/pages/ (services/ and components/ are in the parent folder). Spec counts = lines matching `^\s*(it|test)\(` in the matching *.spec.tsx; `it.each` would be missed.

## dealer.tsx — route /dealer
- Purpose: B2B dealer portal: apply, price list ordering, orders, credit, quarterly report, rewards.
- Sub-features: state switch: isDealer||APPROVED → hub, PENDING → pending screen, else apply form (dealer.tsx:104-106). Tabs Bảng giá / Đơn hàng / Công nợ / Báo cáo (dealer.tsx:227-230). Price tab: per-variation qty (DEALER_MAX_QTY 9999), preorder when qty > stock, save/delete order templates, StickyActionBar. PREPAID order → /bank-payment/:code (dealer.tsx:416). Credit payment with Idempotency key. Reward claim. Search, BottomSheet. Loading/empty/error states present. No polling, no camera, no location.
- API:
  getDealerMe → GET /dealer/me
  applyDealer → POST /dealer/apply
  getPricelist → GET /dealer/pricelist
  placeDealerOrder → POST /dealer/orders
  getDealerOrders → GET /dealer/orders
  getCreditLedger → GET /dealer/credit-ledger
  payCredit → POST /dealer/credit-payment
  getQuarterlyReport → GET /dealer/quarterly-report
  getDealerRewards → GET /dealer/rewards
  claimDealerReward → POST /dealer/rewards/:id/claim
  getTemplates → GET /dealer/templates
  saveTemplate → POST /dealer/templates
  deleteTemplate → DELETE /dealer/templates/:id
- Zalo SDK/bridge: none
- Auth: login needed (getDealerMe query). No explicit auth gate in page. Role gating: by me.isDealer / me.status, not by role.
- Needs verified phone: no. Apply form takes a typed phone (dealer.tsx:140, 177).
- Key shared components: BottomSheet, StickyActionBar, QuantitySelector, SearchField, SegmentedTabs, Badge, ProgressBar, ImageUpload, EmptyState, ErrorState, Skeleton, Card, PageHeader
- Spec tests: 32
- Web today: none for /dealer/* paths. Web has only admin dealer tabs (components/admin/dealer-*-tab.tsx, dealer-tiers-section.tsx).

## dealer-pricing.ts — no route (pure helpers used by dealer.tsx:62)
- Purpose: DEALER_MAX_QTY=9999; preorderQty(qty,stock)=max(0,qty-max(0,stock)); realDiscountPct(retail,dealer)=round((1-dealer/retail)*100), 0 if dealer>=retail or retail<=0.
- Sub-features: none (pure functions, no UI)
- API: none
- Zalo SDK/bridge: none
- Auth: n/a
- Needs verified phone: no
- Key shared components: none
- Spec tests: 0 (no dealer-pricing.spec file)
- Web today: none

## staff.tsx — route /staff
- Purpose: staff self-service: GPS check-in/out, heartbeat, own shift requests.
- Sub-features: role gate → fallback screen (staff.tsx:62-63). TodayCard with check-in/out. Heartbeat every 3 min while a session is open (staff.tsx:143-167); backend auto-checks-out when out of zone. Shift list by status PENDING/APPROVED/REJECTED/CANCELLED; cancel shows "phạt 1h" penalty (staff.tsx:540). Shift editor with "Ca chuẩn" template chips and "Ngày áp dụng" day chips (staff.tsx:605,664,696). Copy week, edit, delete. role="switch" at staff.tsx:749. Location failure → one warning snackbar per failure streak. Loading/error states.
- API:
  getAttendanceStatus → GET /staff/attendance/status
  checkin → POST /staff/attendance/checkin
  checkout → POST /staff/attendance/checkout
  heartbeat → POST /staff/attendance/heartbeat
  getShiftTemplates → GET /staff/shift-templates
  getShifts → GET /staff/shifts
  createShifts → POST /staff/shifts
  updateShift → PATCH /staff/shifts/:id
  deleteShift → DELETE /staff/shifts/:id
  copyWeek → POST /staff/shifts/copy-week
  cancelShift → POST /staff/shifts/:id/cancel
- Zalo SDK/bridge: services/attendance-api.ts:2 imports requestZaloLocationStrict and getZaloAccessToken; acquireLocationPayload (attendance-api.ts:51) returns {locationToken, zaloAccessToken}. Check-in needs a Zalo location token.
- Auth: login needed. Role STAFF or ADMIN only (staff.tsx:62-63).
- Needs verified phone: no
- Key shared components: BottomSheet, Field, TimeInput, PeriodNav, Badge, Card, Skeleton, ErrorState, PageHeader, Heading/Text, ImageUpload (imported)
- Spec tests: 35
- Web today: partial. app/admin/page.tsx:277 "Chấm công" tab → components/admin/attendance-tab.tsx (admin side only: /admin/attendance/live, /admin/attendance/manual-checkout). No /staff/* self-service.

## my-payroll.tsx — route /my-payroll
- Purpose: staff monthly pay view and bank account update.
- Sub-features: role gate (my-payroll.tsx:44-45). Month/year PeriodNav. Day list with status badges. PAID rows show proof image (my-payroll.tsx:174). Bank-info BottomSheet form. Session history for the month. Empty/error/loading states.
- API:
  getMyPayroll → GET /staff/payroll?year&month
  updateBank → PUT /staff/bank
  getHistory → GET /staff/attendance/history?from&to
- Zalo SDK/bridge: none
- Auth: login needed. Role STAFF or ADMIN (my-payroll.tsx:44-45).
- Needs verified phone: no
- Key shared components: BottomSheet, Field, PeriodNav, ImageUpload, Badge, Card, EmptyState, ErrorState, Skeleton, Button
- Spec tests: 12
- Web today: none

## brand-owner.tsx — route /brand-owner
- Purpose: brand owner console: edit owned brand profile and promotions.
- Sub-features: tabs "Hồ sơ & khuyến mãi" and "Doanh thu" (brand-owner.tsx:76-77). Profile editor: logo/cover via ImageUpload, tagline, story, origin. Promotions CRUD in BottomSheet with isActive, couponCode, start/end. Verified badge when brand.isVerified (brand-owner.tsx:166). Sales tab renders BrandSalesTab (brand-owner.tsx:203). Loading/empty/error states.
- API:
  getOwnedBrand → GET /brand/owner/me
  updateOwnedBrand → PATCH /brand/owner/me
  createOwnedPromotion → POST /brand/owner/me/promotions
  updateOwnedPromotion → PATCH /brand/owner/me/promotions/:id
  deleteOwnedPromotion → DELETE /brand/owner/me/promotions/:id
- Zalo SDK/bridge: none (haptic util only)
- Auth: login needed. No role check in page; access control is server-side (not verified).
- Needs verified phone: no
- Key shared components: BottomSheet, Field, SegmentedTabs, ImageUpload, IconButton, Badge, Card, Button, EmptyState, ErrorState, Skeleton, PageHeader
- Spec tests: 21
- Web today: none for /brand/owner/*. app/brand/[slug]/page.tsx is the public brand view only.

## brand-owner-sales.tsx — no route (tab inside /brand-owner, brand-owner.tsx:203)
- Purpose: owned-brand revenue by period.
- Sub-features: period SegmentedTabs (BrandSalesPeriod), StatTile totals, loading/empty/error.
- API: getOwnedBrandSales → GET /brand/owner/me/sales?period=
- Zalo SDK/bridge: none
- Auth: same as brand-owner (login)
- Needs verified phone: no
- Key shared components: SegmentedTabs, StatTile, Skeleton, EmptyState, ErrorState, Heading, Text
- Spec tests: 0 (no brand-owner-sales.spec file)
- Web today: none

## storefront-builder.tsx — route /storefront
- Purpose: merchant mini-shop builder: profile, theme, collections, items, template, quests, stats, publish.
- Sub-features: create storefront if none. Publish toggle. Template picker sheet (categories → apply template). Theme swatches (STOREFRONT_THEME_COLORS). Profile sheet. Merchant config sheet with warehousePhone text field (storefront-builder.tsx:930-1053). Collections CRUD: kind NORMAL/COMBO, layout GRID/CAROUSEL/STACK, comboDiscountPct. Item picker sheet with search: add, pin, hide, note, remove. Stats section and quest section with claim. ShareSheet, ContentKitSheet. Partner check isPartnerStore (utils/partner-store.ts:7-10). Loading/empty/error states.
- API:
  getStorefrontCategories → GET /categories
  applyStorefrontTemplate → POST /storefront/me/apply-template
  getMyStorefront → GET /storefront/me
  createStorefront → POST /storefront
  updateStorefront → PATCH /storefront/me
  publishStorefront → POST /storefront/me/publish
  createCollection → POST /storefront/me/collections
  updateCollection → PATCH /storefront/me/collections/:id
  deleteCollection → DELETE /storefront/me/collections/:id
  addItem → POST /storefront/me/collections/:id/items
  updateItem → PATCH /storefront/me/items/:id
  removeItem → DELETE /storefront/me/items/:id
  pickerProducts → GET /storefront/me/products?search=
  getStorefrontStats → GET /storefront/me/stats
  getQuests → GET /storefront/me/quests
  claimQuest → POST /storefront/me/quests/:code/claim
- Zalo SDK/bridge: none in page
- Auth: login needed. No role check in page.
- Needs verified phone: no
- Key shared components: BottomSheet, Field, ImageUpload, ShareSheet, ContentKitSheet, PriceTag, ProgressBar, StickyActionBar, Badge, Card, Button, EmptyState, ErrorState, Skeleton
- Spec tests: 55
- Web today: none for /storefront/me*. app/s/[slug]/page.tsx is the public shop view only.

## admin.tsx — route /admin
- Purpose: admin hub: staff roles, shift approval, payroll, refill approval, attendance edit.
- Sub-features: role gate ADMIN only (admin.tsx:70-71). Tabs "Nhân sự" / "Duyệt ca" / "Lương" / "Duyệt đổi vỏ" (admin.tsx tab list). Staff: list, grant by phone (PHONE_RE) with role STAFF|ADMIN; ADMIN grant needs window.confirm (admin.tsx:532); revoke with confirm (admin.tsx:565-582); pending invites. Shifts: filter PENDING, approve, reject with reason, bulk approve, shift-template create/delete (TemplateSheet). Payroll: month PeriodNav, rows, DetailSheet per staff, set hourly rate, finalize, reopen, mark-paid, CSV export (csvField). Session time edit. Refill: approve (optional receivedQuantity), reject (reason), search by name/phone (admin.tsx:1018).
- API:
  listStaff → GET /admin/staff
  grantStaff → POST /admin/staff/grant
  revokeStaff → POST /admin/staff/revoke
  adminGetShifts → GET /admin/shifts
  approveShift → POST /admin/shifts/:id/approve
  rejectShift → POST /admin/shifts/:id/reject
  bulkApproveShifts → POST /admin/shifts/bulk-approve
  adminGetTemplates → GET /admin/shift-templates
  createTemplate → POST /admin/shift-templates
  deleteTemplate → DELETE /admin/shift-templates/:id
  adminGetPayroll → GET /admin/payroll?year&month
  adminGetDetail → GET /admin/payroll/:staffId/detail
  setRate → PUT /admin/staff/:userId/rate
  finalizePayroll → POST /admin/payroll/:staffId/finalize
  reopenPayroll → POST /admin/payroll/:staffId/reopen?year&month
  markPaid → POST /admin/payroll/:staffId/mark-paid
  adminEditSession → POST /admin/attendance/session/:id/edit
  getPendingRefillReturns → GET /refill/admin/pending
  approveRefillReturn → POST /refill/admin/:id/approve
  rejectRefillReturn → POST /refill/admin/:id/reject
- Zalo SDK/bridge: none
- Auth: login needed. Role ADMIN only (admin.tsx:70-71).
- Needs verified phone: no. Phone is typed and format-checked only.
- Key shared components: BottomSheet, Field, SegmentedTabs, PeriodNav, TimeInput, SearchField, QuantitySelector, KeyValueRow, ImageUpload, Badge, Card, Button, EmptyState, ErrorState, Skeleton
- Spec tests: 47
- Web today: partial. app/admin/page.tsx (admin console; tabs incl. 'attendance' at :167/:277/:562), components/admin/attendance-tab.tsx, lib/admin-client.ts (/refill/admin/*). No /admin/shifts, /admin/payroll, or /admin/shift-templates found.

## community-moderation.tsx — route /admin/community
- Purpose: community moderation: pending posts, reports, events (create, close, winner).
- Sub-features: role gate ADMIN only (community-moderation.tsx:68-69). Tabs pending / reports / events (community-moderation.tsx:98-99). Pending cards approve/reject. Reports: resolve, or hide the target post or comment (community-moderation.tsx:216). Events: OPEN/CLOSED view, create, close, participants, pick winner via radiogroup. Empty/error/loading states. No polling.
- API:
  adminPendingPosts → GET /feed/admin/pending
  adminApprovePost → POST /feed/admin/:id/approve
  adminRejectPost → POST /feed/admin/:id/reject
  adminReports → GET /feed/admin/reports
  adminResolveReport → POST /feed/admin/reports/:id/resolve
  adminHidePost → DELETE /feed/:id
  removeComment → DELETE /feed/comments/:commentId
  adminEvents → GET /feed/admin/events?status=OPEN|CLOSED
  adminEventParticipants → GET /feed/admin/events/:id/participants
  createEvent → POST /feed/events
  closeEvent → POST /feed/events/:id/close
  pickEventWinner → POST /feed/events/:id/winner
- Zalo SDK/bridge: none
- Auth: login needed. Role ADMIN only (community-moderation.tsx:68-69).
- Needs verified phone: no
- Key shared components: Avatar (zmp-ui), Field, SegmentedTabs, ImageUpload, Card, Button, Icon, EmptyState, ErrorState, Skeleton, PageHeader; ../components/community/post-card (KIND_LABEL)
- Spec tests: 37
- Web today: yes. components/admin/community-moderation-tab.tsx and lib/community-moderation-client.ts (/feed/admin/*), mounted from app/admin/page.tsx.

## recycle.tsx — route /recycle
- Purpose: recycling hub: balance, impact, recent requests, links to new/points/rules/requests.
- Sub-features: guest login then phone share (recycle.tsx:116-131). NoticeCard, RequestsBlock, impactLine. Loading and SessionUnavailable (recycle.tsx:173). Refetch via query invalidation only.
- API:
  getWasteMe → GET /waste/me
  getLoyaltyRewards → GET /me/loyalty/rewards
- Zalo SDK/bridge: ensurePhone from useAuthStore (Zalo phone share); no direct zmp-bridge import
- Auth: useAuthPhase; guest login is offered
- Needs verified phone: yes, shared via Zalo ensurePhone at recycle.tsx:122 and :130. Server-side requirement not verified.
- Key shared components: SessionUnavailable, Badge, Button, Card, ErrorState, IconButton, ListRow, PageHeader, ProgressBar, Skeleton, Timeline, Heading, Text
- Spec tests: 24
- Web today: none for customer /waste/*. Web admin only: app/admin/page.tsx + components/admin/waste-requests-section.tsx, waste-config-card.tsx (/admin/waste/*).

## recycle-rules.tsx — route /recycle/rules
- Purpose: show current waste rules.
- Sub-features: loading skeleton, ErrorState, PageHeader, Text
- API: getWasteRules → GET /waste/rules
- Zalo SDK/bridge: none
- Auth: no useAuthPhase gate in page (not verified)
- Needs verified phone: no
- Key shared components: ErrorState, Skeleton, PageHeader, Text
- Spec tests: 3
- Web today: none

## recycle-new.tsx — route /recycle/new
- Purpose: create a waste (recycling) request: pick items, pickup point, preview points, submit.
- Sub-features: WasteItemStep item quantities with allowance and isLocked (recycle-new.tsx:111). Province list. Nearby points using Zalo location (recycle-new.tsx:297-299). Live preview, debounced. Submit with Idempotency-Key. Loyalty rewards. Navigates to /recycle/points with WastePointsNavState. StickyActionBar. SessionUnavailable (recycle-new.tsx:344).
- API:
  getWasteMe → GET /waste/me
  getWasteItems / getWastePoints → GET /waste/points?provinceCode=
  getNearbyWastePoints → POST /waste/points/nearby
  previewWaste → POST /waste/preview
  createWasteRequest → POST /waste/requests (header Idempotency-Key)
  getProvinces → GET /geo/provinces
  getLoyaltyRewards → GET /me/loyalty/rewards
- Zalo SDK/bridge: services/zmp-bridge.ts requestZaloLocation, getZaloAccessToken
- Auth: useAuthPhase; SessionUnavailable on error
- Needs verified phone: no (only /recycle does ensurePhone)
- Key shared components: WasteItemStep (exported), Badge, Button, Card, Checkbox, PageHeader, ProductThumb, ProgressBar, QuantitySelector, Skeleton, StickyActionBar, Text
- Spec tests: 31
- Web today: none

## recycle-points.tsx — route /recycle/points
- Purpose: choose a pickup or drop-off point.
- Sub-features: SegmentedTabs, SearchField with filterPointsByText, province filter, nearby via Zalo location, WastePointPicker, StickyActionBar confirm (returns to /recycle/new). Empty/error/loading.
- API:
  getWasteMe → GET /waste/me
  getWastePoints → GET /waste/points?provinceCode=
  getNearbyWastePoints → POST /waste/points/nearby
- Zalo SDK/bridge: services/zmp-bridge.ts requestZaloLocation, getZaloAccessToken
- Auth: useAuthPhase; SessionUnavailable
- Needs verified phone: no
- Key shared components: WastePointPicker, SearchField, SegmentedTabs, StickyActionBar, Button, EmptyState, ErrorState, Skeleton, PageHeader, Text
- Spec tests: 16
- Web today: none

## recycle-request.tsx — route /recycle/r/:id
- Purpose: request detail: status timeline, declared vs counted, drop-off QR, tracking, cancel.
- Sub-features: QrCode of r.code (recycle-request.tsx:364). Copy recipient/address to clipboard (:240). TrackingForm in BottomSheet (setWasteTracking). Cancel request. SupportContact. Timeline. DeclaredCountedTable (exported, reused by recycle-done). Loading/error/404 (isNotFoundError).
- API:
  getWasteRequest → GET /waste/requests/:id
  cancelWasteRequest → POST /waste/requests/:id/cancel
  setWasteTracking → PUT /waste/requests/:id/tracking
  getWastePoints → GET /waste/points
  getWasteMe → GET /waste/me
- Zalo SDK/bridge: none (uses utils/clipboard copyText)
- Auth: useAuthPhase; SessionUnavailable
- Needs verified phone: no
- Key shared components: QrCode, SupportContact, BottomSheet, Field, Timeline, Button, EmptyState, ErrorState, Skeleton, PageHeader, Text
- Spec tests: 26
- Web today: none

## recycle-edit.tsx — route /recycle/r/:id/edit
- Purpose: edit lines of an existing request.
- Sub-features: reuses WasteItemStep from recycle-new; debounced preview (PREVIEW_DEBOUNCE_MS); StickyActionBar save; SessionUnavailable.
- API:
  getWasteRequest → GET /waste/requests/:id
  getWasteMe → GET /waste/me
  previewWaste → POST /waste/preview
  editWasteRequest → PATCH /waste/requests/:id
- Zalo SDK/bridge: none
- Auth: useAuthPhase
- Needs verified phone: no
- Key shared components: WasteItemStep, StickyActionBar, PageHeader, Button, ErrorState, Skeleton, Text
- Spec tests: 10
- Web today: none

## recycle-requests.tsx — route /recycle/requests
- Purpose: list of my waste requests.
- Sub-features: SegmentedTabs "Đang xử lý" (open) / "Đã đóng" (closed) (recycle-requests.tsx). ListRow rows. EmptyState, ErrorState, Skeleton.
- API: listWasteRequests → GET /waste/requests
- Zalo SDK/bridge: none
- Auth: useAuthPhase; SessionUnavailable
- Needs verified phone: no
- Key shared components: ListRow, SegmentedTabs, EmptyState, ErrorState, Skeleton, PageHeader
- Spec tests: 6
- Web today: none

## recycle-done.tsx — route /recycle/done/:id
- Purpose: completion screen: points earned, next-reward progress.
- Sub-features: DeclaredCountedTable (from recycle-request), impactLine (from recycle), nextRewardProgress ProgressBar, back/home buttons. Loading/error.
- API:
  getWasteRequest → GET /waste/requests/:id
  getWasteMe → GET /waste/me
  getLoyaltyRewards → GET /me/loyalty/rewards
- Zalo SDK/bridge: none
- Auth: useAuthPhase; SessionUnavailable
- Needs verified phone: no
- Key shared components: DeclaredCountedTable, ProgressBar, Icon, Card, Button, ErrorState, Skeleton, PageHeader
- Spec tests: 10
- Web today: none

## recycle-desk.tsx — route /recycle/desk
- Purpose: counter desk for pickup points: find request or gift by code, confirm counted items, reject, fulfil gift.
- Sub-features: wrapped in AuthGate (recycle-desk.tsx:405). Point selector (kind WAREHOUSE special case, :66). Code input → lookup returns REQUEST or GIFT (:164-165). readOnly when COMPLETED or REJECTED (:174). QuotaCard. RejectSheet with radiogroup of DESK_REJECTION_OPTIONS; note required when reason=OTHER (:103). QuantitySelector for counted qty. Gift fulfil. WasteDeskPerk and WasteDeskReport components. Typed code entry only, no scanner.
- API:
  getDeskPoints → GET /waste/desk/points
  deskLookup → POST /waste/desk/lookup
  deskConfirm → POST /waste/desk/requests/:id/confirm
  deskReject → POST /waste/desk/requests/:id/reject
  deskFulfilGift → POST /waste/desk/gifts/fulfil
- Zalo SDK/bridge: none
- Auth: AuthGate (login required). No role check in page; any logged-in user reaches the screen, server enforces (not verified).
- Needs verified phone: no
- Key shared components: AuthGate, BottomSheet, Field, QuantitySelector, SegmentedTabs, WasteDeskPerk, WasteDeskReport, Card, Button, EmptyState, ErrorState, Skeleton, PageHeader
- Spec tests: 29
- Web today: none for /waste/desk/*. Web admin has /admin/waste/* (app/admin/page.tsx, components/admin/waste-requests-section.tsx).

## Surprises
1. Staff check-in requires a Zalo location token (services/attendance-api.ts:51-60). A web port needs a different location source. Pages that do not check role in the page (dealer, brand-owner, storefront-builder, recycle-desk) rely on the server.
2. Only /recycle asks for a verified phone (recycle.tsx:116-131). Dealer apply takes a typed phone.
3. dealer-pricing.ts has no spec, yet it holds the pricing math (preorderQty, realDiscountPct).
4. brand-owner-sales has no route and no spec; it is a tab inside /brand-owner.
5. Web already has admin-side equivalents for community moderation, waste, dealer tiers, and attendance. It has no customer or staff/brand/dealer portal pages.
