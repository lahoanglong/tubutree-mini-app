# Khảo sát scout: miniapp-mua-hang

(Báo cáo nguyên văn của agent quét, chưa kiểm chứng từng dòng.)

Scope: apps/miniapp/src/pages (18 files). Routes from apps/miniapp/src/components/app.tsx:189-245. Paths below are relative to apps/miniapp/src/. Spec counts are `^\s*it(` in `<page>.spec.tsx`; `it.each`/`test(` not counted. Several pages have extra spec files (product-detail-*.spec.tsx, order-detail-oa-prompt.spec.tsx) that I did not count.

## home.tsx — route `/` (app.tsx:189)
- Purpose: home feed. Block order depends on customer kind (new vs returning, `homeBlockOrder`) (pages/home.tsx:~120).
- Sub-features: search shell button that navigates to `/browse?focus=search`; unread notifications bell; PurchasedRail ("Mua lại", returning only); OrderStrip; PointsBoostStrip; FlashSale + UpcomingFlashSales; "Dành cho bạn" (authed only); bestSellers (see-all `/browse?sort=best_seller`); CategoryGrid (→ `/browse?category=` or `?segment=`); RecentlyViewedRail; featured (dedupe vs for-you); newArrivals (`/browse?sort=newest`); HomeExtras; NewCustomerGift (new only); pull-to-refresh; per-block error + retry; page-wide error if all three public grids fail.
- API: getNotifications → GET /me/notifications (or home/me bundle); fetchProducts → GET /products (sort=best_seller|newest, limit); fetchProducts → GET /products (featured); fetchForYou → GET /products/for-you; useCategories → GET /categories; FlashSale → GET /flash-sales/active, UpcomingFlashSales → GET /flash-sales/upcoming; usePurchasedItems → GET /me/purchased-items; usePublicConfig → GET /config/public; useHomeFeed → GET /home (public) and GET /home/me (auth) bundle (home-feed.ts:102,107).
- Zalo SDK/bridge: none in page (zmp-ui Page/useNavigate only).
- Auth: guest allowed. Authed-only blocks: notifications count, for-you, purchased rail.
- Needs verified phone: no.
- Key shared components: home/home-header, home/home-section, home/order-strip, home/home-extras, home/new-customer-gift, catalog/category-grid, catalog/recently-viewed-rail, reorder/purchased-rail, flash-sale, loyalty/points-boost-strip, pull-to-refresh.
- Spec tests: 35

## browse.tsx — route `/browse` (app.tsx:190)
- Purpose: catalog listing with search, category/segment, filters, sort, infinite scroll.
- Sub-features: search field with draft state and `?focus=search`; suggest list while typing (GET /search/suggest); recent searches list; category grid when no query; sort chips (suggested, best_seller, newest, price_asc, price_desc); FilterSheet (price, in-stock, rating 4+, brand list) with apply count; infinite list "load more"; result header; skeleton; empty and error states; filtersIgnored warning; RecentlyViewedRail; scroll restoration; cart button; discovery tracking (trackSearchPerformed, trackFilterApplied, trackSearchResultClicked).
- API: useQuery brands → GET /brands; useInfiniteQuery fetchCatalog → GET /products (params from catalogParams: q, category, segment, sort, brand, price, inStock, rating, page, limit; shop-api.ts:376); useSuggest → GET /search/suggest?q=.
- Zalo SDK/bridge: none.
- Auth: guest allowed.
- Needs verified phone: no.
- Key shared components: catalog/catalog-grid, catalog/category-grid, catalog/filter-sheet, catalog/sort-chips, catalog/suggest-list, catalog/result-header, catalog/recently-viewed-rail, ui/search-field, cart-button, pull-to-refresh.
- Spec tests: 39

## product-detail.tsx — route `/product/:slug` (app.tsx:191)
- Purpose: product detail page with variation selection, add-to-cart, buy-now, and extra CTAs.
- Sub-features: variation selector (default = first in-stock variation); quantity selector clamped to stock; flash-sale price and countdown (flash list refetched every 60s); price and coupons (pdpCoupons filtered by product); freeship threshold line; image carousel; fulfiller block (TUBU / MERCHANT / UNAVAILABLE); reviews section with stars and "write review" (reviewOrderId from state); related and bought-together rails; SubscribeSheet ("Đặt định kỳ", discount from config); group-buy button ("Mua chung"); ContentKitSheet; share (shareWithFallback with referral path); wishlist heart; brand link to `brandBrowsePath`; Zalo OA chat button (only if VITE_ZALO_OA_ID set); StickyActionBar with add/buy-now; error state "Không tìm thấy sản phẩm này." with home action.
- API: fetchProduct → GET /products/{slug}; fetchRelated → GET /products/{slug}/related; fetchBoughtTogether → GET /products/{slug}/bought-together; fetchReviews → GET /products/{slug}/reviews; getCoupons → GET /me/coupons; getAffiliateMe → (affiliate-api, path not checked); getCart → GET /cart; addToCart → POST /cart/items {variationId, quantity}; fetchActiveFlashSales → GET /flash-sales/active; createGroupBuy → POST /group-buy {productId}; "Mua ngay" calls addToCart then navigates to `/checkout` with `itemIds`.
- Zalo SDK/bridge: services/zmp-bridge: hasOA, openOAChat.
- Auth: guest can view. Add-to-cart, buy-now, subscribe, group-buy, and review actions call `login()` first if not authenticated (product-detail.tsx ~296-330, 573).
- Needs verified phone: no.
- Key shared components: share-sheet, reviews-section, wishlist-heart, subscribe-sheet, content-kit-sheet, storefront-context-bar, catalog/suggested-rail, product/points-earn-line, loyalty/points-boost-strip, ui/sticky-action-bar, ui/quantity-selector, ui/price-tag, ui/product-tile, ui/scroll-row, ui/cart-badge.
- Spec tests: 8 (product-detail.spec.tsx only; plus 10 product-detail-*.spec.tsx files)

## cart.tsx — route `/cart` (app.tsx:192)
- Purpose: cart with line selection, coupon, and checkout entry.
- Sub-features: per-line checkbox (deselected set); quantity selector (PATCH on change); remove line with undo state; grouped by fulfiller (merchant lines); coupon code entry plus VoucherSheet; remove coupon; cart-selection query for chosen itemIds; "Mua tiếp" → `/browse`; "Thanh toán" → `/checkout` with `{state:{itemIds}}`; StorefrontContextBar; empty and error states; guest prompt via AuthPhaseView.
- API: getCart → GET /cart (storefrontSlug param when set); getCartSelection → GET /cart?itemIds=; updateCartItem → PATCH /cart/items/{id}; removeCartItem → DELETE /cart/items/{id}; applyCoupon → POST /cart/coupon {code}; removeCoupon → DELETE /cart/coupon.
- Zalo SDK/bridge: none.
- Auth: guest sees AuthPhaseView (login CTA); authed-only query (`enabled: phase === 'authenticated'`).
- Needs verified phone: no.
- Key shared components: checkout/voucher-sheet, catalog/suggested-rail, storefront-context-bar, ui/quantity-selector, ui/key-value-row, ui/sticky-action-bar, ui/auth-gate, ui/empty-state, ui/skeleton.
- Spec tests: 31

## checkout.tsx — route `/checkout` (app.tsx:193)
- Purpose: place an order: address, payment method, points, invoice, voucher, then place.
- Sub-features: address section (select or add); payment radio: COD, BANK_TRANSFER, WALLET (ZALOPAY hidden in code, comment at ~line 378); per-method disabled hint from quote; points toggle (usePoints); voucher sheet; referral code box; attach pickup request for waste (recycle) if open request exists; VAT invoice toggle with localStorage key `tubu_invoice`; order note; shipments split (multi-parcel) display; price summary sheet (BottomSheet x3); zero-total path (COD forced, quotedZeroTotal); price/total-changed warnings; over-stock line blocks placing; OrderSuccess overlay for COD (→ `/order/{code}` or `/`); BANK_TRANSFER → navigate `/bank-payment/{code}`; idempotency key ring per content; sticky "Đặt hàng" CTA.
- API: getAddresses → GET /me/addresses; getCart → GET /cart; checkoutQuote → POST /checkout/quote {addressId, pointsToUse, storefrontSlug, itemIds}; placeOrder → POST /checkout/place-order (body includes paymentMethod, expectedTotal, invoiceRequest, referralCode, itemIds, Idempotency key via placeOrder); getWallet → GET /me/wallet; getLoyalty → GET /me/loyalty; getWasteMe → GET /waste/me; coupon previews → POST /checkout/coupon-previews (via VoucherSheet); address create → POST /me/addresses (AddressSection).
- Zalo SDK/bridge: via store/auth ensurePhone() (auth store calls getZaloAccessToken + ensurePhoneApi; zmp-bridge.ts:59,84); no direct zmp-sdk in page.
- Auth: AuthPhaseView (guest or loading gate); queries enabled only when authenticated.
- Needs verified phone: yes. ensurePhone() is called on the CTA before order.mutate (checkout.tsx:959), non-blocking (errors swallowed).
- Key shared components: checkout/address-section, checkout/order-success, checkout/voucher-sheet, checkout/referral-code-box, ui/bottom-sheet, ui/form (Radio, Checkbox), ui/list-row, ui/product-thumb, ui/key-value-row, ui/sticky-action-bar, ui/auth-gate.
- Spec tests: 77

## bank-payment.tsx — route `/bank-payment/:code` (app.tsx:194)
- Purpose: show VietQR for bank transfer and poll until paid.
- Sub-features: QR image + amount; copy button for account/amount/content (copied state); countdown via useRemaining; manual "check payment" button (refetch with throwOnError), snackbar per status (PAID / UNPAID / FAILED / REFUNDED / other); on PAID shows success and navigates to `/order/{orderCode}` (replace); "back to order" and "home" buttons; error state with retry; SR live region.
- API: getBankQr → GET /payments/bank-qr/{code} (polled every 4000 ms until paymentStatus === 'PAID', then stops).
- Zalo SDK/bridge: none.
- Auth: not gated in the page (no auth hook); relies on API auth (unverified).
- Needs verified phone: no.
- Key shared components: ui/skeleton, ui/button, ui/icon, ui/icon-button, ui/price-tag (Money), ui/page-header, ui/sr-only, hooks/use-remaining.
- Spec tests: 20

## orders.tsx — route `/orders` (app.tsx:195; `/subscriptions` redirects here with `?tab=subscriptions`, app.tsx:236)
- Purpose: order history, with a subscriptions tab.
- Sub-features: SegmentedTabs (tab key from `?tab=`); tabs: all, pending_payment, processing, shipping, delivered, closed, subscriptions (ORDERS_TABS in orders-tabs); OrderCard list with "Xem thêm" pagination (page size 20); "Thanh toán" → `/bank-payment/{code}` on pending-payment cards; reorder via ReorderSheet; welcome hint for new customer when list is empty ("all" tab); PurchasedRail on "all" tab; subscriptions tab shows SubscriptionsPanel (pause/resume, cancel via sheet, skip, edit via SubscriptionEditSheet); empty and error states; guest prompt.
- API: fetchOrders → GET /orders?status=|group=&page=&limit=20; getNewCustomerOffer → GET /me/new-customer-offer; SubscriptionsPanel → GET /me/subscriptions; setSubscriptionStatus → POST /me/subscriptions/{id}/status {status}; skipSubscription → POST /me/subscriptions/{id}/skip; subscription edit → PATCH /me/subscriptions/{id}; getAddresses → GET /me/addresses (subscriptions panel).
- Zalo SDK/bridge: none.
- Auth: AuthGate (guest prompt). Queries enabled only when authenticated.
- Needs verified phone: no.
- Key shared components: orders/order-card, orders/orders-tabs, reorder/reorder-sheet, reorder/purchased-rail, subscriptions-panel, subscription-edit-sheet, ui/segmented-tabs, ui/auth-gate.
- Spec tests: 16 (orders.spec.tsx); subscriptions-panel.spec.tsx also exists

## order-detail.tsx — route `/order/:code` (app.tsx:196)
- Purpose: one order: status timeline, items, payment, refunds, returns, cancel, reorder, and waste link.
- Sub-features: shipping journey timeline from shippingHistory; tracking link (openExternal); invoice link (openExternal); items with per-item review link (only when DELIVERED and reviewable); merchant/fulfilment and siblings (other shipments) links; cancel order (only if canCustomerCancel) with Sheet confirm and refund method choice (WALLET or bank form: RefundBankInput); return/exchange request (ReturnRequestSheet with estimate) and refund destination picker; list of return requests and refunds (OrderRefunds); points reversed note; waste request link → `/recycle/r/{id}`; reorder (ReorderSheet); OA prompt (once) using zmp-bridge state; support contact; "back to orders" button; error state "Không tìm thấy đơn hàng này.".
- API: fetchOrder → GET /orders/{code}; fetchMyReturns → GET /orders/me/returns; fetchMyRefunds → GET /orders/me/refunds?orderId=; fetchRefundBank → GET /orders/me/refund-bank; cancelOrder → POST /orders/{code}/cancel (body = destination or {}); fetchOrders → GET /orders?page=1&limit=1 (OA prompt gate); getWasteRequestByOrder → GET /waste/requests/by-order/{orderId}; return-request → POST /orders/{code}/return-request; return-estimate → POST /orders/{code}/return-estimate; refund destination → POST /orders/me/refunds/{refundId}/destination; repurchase → POST /orders/{code}/repurchase (via ReorderSheet, not verified in page).
- Zalo SDK/bridge: openExternal (zmp-bridge), hasOA/openOAChat (OA prompt state).
- Auth: AuthPhaseView (phase gate). Owner check: meId vs order owner for cancel rules (canCustomerCancel in utils/order-status.ts:151).
- Needs verified phone: no.
- Key shared components: orders/return-request-sheet, orders/refund-destination-picker, orders/order-refunds, reorder/reorder-sheet, support-contact, ui/key-value-row, ui/list-row, ui/badge, ui/icon, ui/sticky-action-bar, ui/skeleton.
- Spec tests: 35 (order-detail.spec.tsx); order-detail-oa-prompt.spec.tsx also exists

## wishlist.tsx — route `/wishlist` (app.tsx:231)
- Purpose: saved products grid.
- Sub-features: 2-column grid of ProductCard; loading skeleton; error + retry; empty state with "Khám phá sản phẩm" → `/browse`.
- API: getWishlist → GET /me/wishlist. (Toggle is in WishlistHeart, not this page: POST /me/wishlist {productId}; DELETE /me/wishlist/{productId}; ids GET /me/wishlist/ids.)
- Zalo SDK/bridge: none.
- Auth: AuthGate; query enabled only when authenticated.
- Needs verified phone: no.
- Key shared components: product-card (default export), ui/page-header, ui/skeleton, ui/empty-state, ui/auth-gate.
- Spec tests: 4

## group-buy.tsx — routes `/group-buy` and `/group-buy/:id` (app.tsx:203-204)
- Purpose: group-buy ("Mua chung") list and join flow; `/:id` highlights an invited group.
- Sub-features: invited-group card with "Bạn được mời vào nhóm này" banner; list of other groups (OPEN/SUCCESS/expired); progress bar (currentSize/targetSize) and time-left; card CTA: "Đăng nhập để tham gia" (guest), "Tham gia mua chung (−N%)", "Đã tham gia", "Nhóm của bạn", or closed label; share per group via shareWithFallback (path includes referral); open product page on card tap; empty and error states.
- API: listGroupBuys → GET /group-buy; getGroupBuy → GET /group-buy/{id}; joinGroupBuy → POST /group-buy/{id}/join.
- Zalo SDK/bridge: share via share-sheet (shareWithFallback; underlying bridge not checked).
- Auth: guest can view; join needs login (guest label is "Đăng nhập để tham gia"). Group state uses authed, referralCode from store.
- Needs verified phone: no.
- Key shared components: share-sheet, ui/card, ui/progress-bar, ui/badge, ui/button, ui/icon, ui/page-header, ui/text, ui/skeleton, ui/empty-state.
- Spec tests: 26

## brand-view.tsx — route `/brand/:slug` (app.tsx:239)
- Purpose: brand landing page (public brand profile and product list).
- Sub-features: brand header and follower count; follow/unfollow toggle (error toast "Cần đăng nhập để theo dõi nhãn." when not logged in); share sheet with referral; share-to-earn banner (eligible affiliates only); product tiles row (ScrollRow) → `/product/{slug}`; dealer CTA: "Vào kênh đại lý" / "Xem hồ sơ đại lý" / "Đăng ký đại lý" → `/dealer`; sets storefront context kind 'brand' in store; loading skeleton, error state.
- API: getPublicBrand → GET /brand/public/{slug}; getBrandFollowState → GET /brand/{slug}/follow-state; followBrand → POST /brand/{slug}/follow; unfollowBrand → DELETE /brand/{slug}/follow; getBrandShareToEarn → GET /brand/{slug}/share-to-earn; getDealerMe → GET /dealer/me (authed only).
- Zalo SDK/bridge: share via ShareSheet (shareWithFallback).
- Auth: guest can view; follow needs login; dealer data only when authed.
- Role gating: dealer state (isDealer / APPROVED / PENDING) drives CTA; share-to-earn only for eligible affiliates.
- Needs verified phone: no.
- Key shared components: store-page-shell, share-sheet, ui/product-tile, ui/scroll-row, ui/badge, ui/button, ui/page-header, ui/skeleton, ui/empty-state.
- Spec tests: 19

## brand-story.tsx — route `/brand-story` (app.tsx:234)
- Purpose: static brand-origin story with a Vietnam-style map of origin pins (SVG).
- Sub-features: SVG map (LED backlight and wood filters) with pins for each origin in BRAND_ORIGINS; tapping a pin opens a BottomSheet for that brand; from the sheet, navigate to brandBrowsePath (browse filtered by brand) (brand-story.tsx:464); PageHeader title from vi.home.brandStoryTitle.
- API: none (data is static from utils/brand-origins).
- Zalo SDK/bridge: none.
- Auth: none (guest).
- Needs verified phone: no.
- Key shared components: ui/page-header, ui/bottom-sheet, ui/button, ui/icon, ui/text.
- Spec tests: 9

## storefront-view.tsx — route `/s/:slug` (app.tsx:238)
- Purpose: public CTV / affiliate storefront page.
- Sub-features: collections of items (empty collections filtered out); owner detection (referral code match): owner sees "add product" CTA → `/storefront`, others see "view products" → `/browse`; share sheet; not-found and error states; SuggestedRail; product tiles → `/product/{slug}`; TierBadge.
- API: getPublicStorefront → GET /storefront/public/{slug} (staleTime 60s).
- Zalo SDK/bridge: share via ShareSheet.
- Auth: guest can view. isOwner uses store user referralCode.
- Role gating: owner vs visitor only.
- Needs verified phone: no.
- Key shared components: store-page-shell, share-sheet, catalog/suggested-rail, ui/tier-badge, ui/product-tile, ui/page-header, ui/empty-state, ui/skeleton.
- Spec tests: 10 (storefront-view.spec.tsx). storefront-view-not-found.spec.tsx also exists.

## about.tsx (+ about-data.ts) — route `/about` (app.tsx:230)
- Purpose: about page, FAQ, support contacts, policies, account deletion, logout.
- Sub-features: hero card; FAQ with category chips (ScrollRow) and accordion (first item open); FAQ falls back to fallbackFaq() when API is empty or fails (about-data.ts); support rows (hotline tap → callPhone, email, Zalo OA chat if hasOA); policy rows (terms, privacy, returns open a sheet with "open on web" button → `WEB_BASE_URL/chinh-sach/<slug>`; shipping opens web directly); destructive "Xóa tài khoản" with confirm sheet → POST /me/deletion-request; logout button.
- API: fetchFaqs → GET /faqs; fetchSupportContact → GET /config/public (support.hotline, email, zaloOaName); requestAccountDeletion → POST /me/deletion-request {reason?}.
- Zalo SDK/bridge: services/zmp-bridge: openOAChat, hasOA, callPhone, openExternal.
- Auth: guest can view; logout and delete use the auth store; delete requires auth (not verified in code path).
- Needs verified phone: no.
- Key shared components: ui/bottom-sheet, ui/card, ui/chip, ui/key-value-row, ui/list-row, ui/page-header, ui/scroll-row, ui/skeleton, ui/text, ui/button.
- Spec tests: 20 (about.spec.tsx); about-data.spec.ts also exists

## not-found.tsx — route `*` (app.tsx:245)
- Purpose: 404 page.
- Sub-features: EmptyState (art "search") with CTA "Về trang chủ" → `/` (replace); hidden h1 for a11y.
- API: none.
- Zalo SDK/bridge: none.
- Auth: none.
- Needs verified phone: no.
- Key shared components: ui/empty-state, ui/sr-only.
- Spec tests: 3

## refill.tsx — route `/refill` (app.tsx:205)
- Purpose: bottle refill: return empty bottles for points and see refill status.
- Sub-features: quantity selector bounded by monthlyRemaining; pickup location picker (multiple locations, last-used default); return submit with idempotency key; monthly remaining quota; history with pending/approved/rejected states (rejectionReason, declared vs received quantity); pickup details with call button (callPhone); paused-location warning; link to `/game`; error and loading states.
- API: getRefillSummary → GET /refill/me; returnBottles → POST /refill/return {quantity, pickupLocationId?} (with idempotency key header).
- Zalo SDK/bridge: callPhone (zmp-bridge).
- Auth: AuthGate; query enabled only when authenticated.
- Needs verified phone: no.
- Key shared components: refill-location-picker (RefillLocationPicker, RefillLocationInfo, RefillLocationDetails), support-contact, ui/quantity-selector, ui/list-row, ui/card, ui/badge, ui/button, ui/icon, ui/page-header, ui/skeleton, ui/empty-state.
- Spec tests: 44

## cashback.tsx — route `/cashback` (app.tsx:228)
- Purpose: cashback merchants list and pending cashback balance and history.
- Sub-features: pending balance card (AuthPhaseView when not authed); merchant list; merchant BottomSheet; click → POST /cashback/click then open affiliate deeplink; transaction history; PageHeader "Hoàn tiền".
- API: getMerchants → GET /cashback/merchants (public); getCashbackTransactions → GET /cashback/transactions (authed); getWallet → GET /me/wallet (authed); createCashbackClick → POST /cashback/click {merchantId, productUrl?}.
- Zalo SDK/bridge: openAffiliateLink (zmp-bridge).
- Auth: merchants public; balance and transactions need authed (AuthPhaseView).
- Needs verified phone: no.
- Key shared components: ui/bottom-sheet, ui/badge, ui/button, ui/empty-state, ui/icon, ui/page-header, ui/row-keyboard, ui/skeleton, ui/text.
- Spec tests: 10

## Surprises
1. checkout.tsx:378-382 ZALOPAY is hidden in code (comment says it would show success without collecting money); payment options are COD, BANK_TRANSFER, WALLET only.
2. home.tsx:~120 block order and a new-customer layout are gated by config flag `homeNewCustomerLayout` (default off); layout changes by customer kind.
3. about-data.ts DEFAULT_SUPPORT hard-codes hotline `0899 149 229` and email `tubutree@gmail.com`; fallbackFaq text hard-codes policy numbers.
4. Zalo-only: login via zmp-bridge/auth store (getZaloAccessToken, ensurePhone), openOAChat/hasOA, callPhone, openExternal, openAffiliateLink (cashback), shareWithFallback; web equivalents needed for each.
5. Many UI strings are hard-coded Vietnamese in pages (wishlist.tsx, group-buy.tsx, refill.tsx toasts) rather than vi.* keys; /subscriptions redirects to /orders?tab=subscriptions.
