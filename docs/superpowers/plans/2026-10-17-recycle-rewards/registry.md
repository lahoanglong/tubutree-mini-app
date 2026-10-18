# Registry — Đổi rác lấy quà implementation plan (BINDING for all milestone authors)

Spec = `docs/superpowers/specs/2026-10-17-recycle-rewards-design.md` (cited as §x.y). Repo root = impl worktree. `api/` = `apps/api/src/`, `mini/` = `apps/miniapp/src/`, `web/` = `apps/web/src/`, `st/` = `packages/shared-types/src/`, `wx/` = `apps/api/src/modules/waste-exchange/`, `race/` = `apps/api/test/integration-race/`. Every name in §4 is binding; a lane that needs a change files it in its part under "Registry deviations" and does NOT silently rename.

## 1. Lanes, stages, DAG, reviewer gates, merge order

### 1.1 Stages (worktrees branch from `feat/recycle-rewards`; merge back with `--no-ff`, local only)
| Stage | Lanes (parallel) | Starts when merged | Why |
|---|---|---|---|
| S0 | L1a: M1.1→M1.2→M1.3→M1.4→M1.5 ; L1b: M1.7 (after M1.1) ; L1c: M1.6 (branched from L1a after M1.1, like L1b) | — | contract + data; migration file is serial inside L1a |
| S1 | L2-core: M2.1→M2.2→M2.3→M2.4→M2.5→M2.6a ; L6: M6.* ; L7: M7.* | S0 | M3/M4/M5 need core services; UI lanes need only `st/waste.ts` |
| S2 | L2-cust: M2.6b→M2.10 ; L3: M3.* ; L4: M4.* ; L5: M5.* (L6, L7 continue) | L2-core merged ("M2-core" merge point) | no file overlap between these lanes except the append-only `EXPECTED` map of `staff-permissions.matrix.spec.ts` (L3 and L4, R0; see §2 hot-spots) |
| S3 | L8: M8.2→M8.1→M8.3→M8.4→M8.5→M8.6→M8.7→M8.8 | all of S2 + L6 + L7 merged | removal must see the new feature in place (§13.3) |

Merge order back into `feat/recycle-rewards`: M1 → M2-core → M2-cust → M3 → M4 → M5 → M6 → M7 → M8.2 → M8.1 → M8.3 → M8.4 → M8.5 → M8.6 → M8.7 → M8.8. Each lane rebases on the branch tip before merging; expected conflicts only in append-only lists (§7 rule R0).

### 1.2 Task DAG (task → depends on). Cross-lane edges marked ⇢
- M1.1 ← none. M1.2 ← M1.1. M1.3 ← M1.2. M1.4 ← M1.3. M1.5 ← M1.4. M1.6 ← M1.1. M1.7 ← M1.1.
- M2.1 ← M1.4, M1.7. M2.2 ← M1.5, M1.7. M2.3 ← M1.7, M1.2 (its real-DB spec uses the M1.2 fixtures). M2.4 ← M2.1, M2.3. M2.5 ← M2.2, M2.4 (appends to `race/waste-core.race-spec.ts` after M2.3 and M2.4). — M2.6a ← M2.5 (last task of M2-core). M2.6b ← M2.6a, M2.1. M2.7 ← M2.6. M2.8 ← M2.6. M2.9 ← M2.8. M2.10 ← M1.2 (independent of other M2 tasks; runs in L2-cust).
- M3.1 ⇢ M2-core. M3.2 ← M3.1. M3.3 ← M3.2; ⇢ M2.6a (in M2-core: `customer/waste-request.mapper.ts`, C10). M3.4 ← M3.1. M3.5 ← M3.3, M3.4. M3.6 ← M3.2. M3.7 ← M3.3. M3.8 ← M3.3, M3.4, M3.5, M3.6, M3.7.
- M4.1 ⇢ M2-core, M1.3. M4.2 ← M4.1. M4.3 ← M4.2. M4.4 ← M4.3 (adds gift CRUD to M4.3's `waste-admin-gifts.controller.ts`). M4.5 ⇢ M2-core, after M4.4 (appends to waste-catalog.module.ts after the M4.3b/M4.4 entries). M4.6 ⇢ M2-core, after M4.5 (same file). M4.7 ← M4.6. M4.8 ⇢ M2-core.
- M5.1 ⇢ M2-core. M5.2 ← M5.1. M5.3 ⇢ M2-core. M5.4 ← M5.3, M5.2 (appends to M5.2's attach race spec). M5.5 ← M5.3. M5.6 ← M5.2.
- M6.1 ⇢ M1.6. M6.2 ← M6.1. M6.3 ← M6.2, M6.7a. M6.4 ← M6.3. M6.5 ← M6.4. M6.6 ← M6.2, M6.5 (app.tsx order). M6.7a ← M6.1b. M6.7b ← M6.7a, M6.6b (app.tsx order). M6.8 ← M6.5. M6.9 ← M6.3, M6.5, M6.6, M6.7.
- M7.1 ⇢ M1.6. M7.2 ← M7.1. M7.3, M7.4, M7.5, M7.6, M7.7 ← M7.2 (serial in lane).
- M8.2 ⇢ M1 (merged). M8.1 ← M8.2; ⇢ M3 (merged), M4.6, M4.8. M8.3 ← M8.1. M8.4 ⇢ M6 (merged). M8.5 ⇢ M7 (merged). M8.6 ← M8.4, M8.5. M8.7 ⇢ M2–M7 merged. M8.8 ← all.

### 1.3 Opus reviewer gate (points, money, auth, customer messages, PROD data, locks)
Required: M1.1 M1.2 M1.3 M1.4 M1.5 M1.7 · M2.1 M2.2 M2.3 M2.4 M2.5 M2.6 M2.8 M2.9 M2.10 · M3.1–M3.8 (all) · M4.1 M4.2 M4.3 M4.4 M4.5 M4.6 M4.7 M4.8 · M5.1–M5.5 · M6.4 M6.6 M6.7 M6.8 · M7.4c M7.5 M7.6b M7.7a · M8.1 M8.2 M8.3 M8.8.
Not required (sonnet reviewer enough): M1.6 M2.7 M5.6 M6.1 M6.2 M6.3 M6.5 M6.9 M7.1 M7.2 M7.3 M7.4a M7.4b M7.6a M7.7b M7.7c M8.4 M8.5 M8.6 M8.7.

## 2. File map

Legend: C = create, M = modify, D = delete. Owner task in brackets.

### 2.1 M1 (data + contract)
- M `apps/api/prisma/schema.prisma` — enums + 12 models of §11.1, back-relations on `User`, `Order`, names of the 3 new partial indexes in the `PointsTransaction` comment block (comment-only) [M1.1]; later `/// @deprecated` on Refill models [M8.3].
- C `apps/api/prisma/migrations/20261020000000_waste_exchange/migration.sql` — one additive migration (§11.7). Order of sections inside (each delimited by `-- BEGIN <NAME>` / `-- END <NAME>` comment lines): generated DDL [M1.1] → hand-written §11.3 [M1.2] → reference data [M1.3] → config rows [M1.4] → templates [M1.5]. Before M1.1 and again before M8.2, run, both from the repository root (folder-order proof of 4.14), `for b in $(git for-each-ref --format='%(refname:short)' refs/heads); do git ls-tree --name-only $b apps/api/prisma/migrations/; done | xargs -n1 basename | grep -E '^[0-9]{14}_' | sort | tail -1` and `ls -d /Users/longla/coding/tubutree-mini-app/.claude/worktrees/*/apps/api/prisma/migrations/*/ | xargs -n1 basename | sort | tail -1` (on 2026-10-18 both printed `20261019120000_merchant_link_prev_rate`, from branch `lr2/commission`, which the base contains); the folder must sort after both outputs; if a further launch-review migration lands first, M8.2 recounts the §7 item 22 pins.
- C `wx/waste-schema.spec.ts` [M1.1], `wx/waste-migration.spec.ts` [M1.2], `wx/waste-seed-data.ts` (seed constants + upsert-argument builders; `seedWasteReferenceData()` in seed.ts loops over them) + `wx/waste-seed-data.spec.ts` [M1.3], `wx/waste-notify.codes.spec.ts` [M1.5] — CI-run unit specs pinning schema/migration/seed text.
- M `apps/api/prisma/check-partial-indexes.ts` (KNOWN list 20→23, sorted) [M1.2]; M `race/partial-unique-indexes.race-spec.ts` (pin 23) [M1.2].
- M `race/helpers.ts` `deleteItData` (waste tables) [M1.2] — no other task edits helpers.ts. C `race/fixtures/waste-fixtures.ts` (factories and the GR2 order helpers, §4.10) [M1.2]; C `race/waste-order-helpers.race-spec.ts` (real-DB proof of the GR2 helpers, §4.10) [M1.2]. M `race/delete-it-data.race-spec.ts` [M1.2]. C `race/waste-db-constraints.race-spec.ts` [M1.2; +voucher cases M1.3; +config rows M1.4; +templates M1.5].
- M `apps/api/prisma/seed.ts` — `seedWasteReferenceData()` items+gifts [M1.3]; waste rows in `SYSTEM_CONFIGS` (literal) + `assertWasteConfigSeedRows(SYSTEM_CONFIGS)` call [M1.4]; 10 rows in `NOTIFICATION_TEMPLATES` [M1.5]; 5 `refill.*` config rows removed [M8.1]; REFILL_* templates removed [M8.3].
- C `wx/waste-config.keys.ts` (D1) + C `wx/waste-config.keys.spec.ts` [M1.4].
- M `api/modules/system-config/system-config.service.ts` (+`.spec.ts`) RANGES/JSON_RULES for waste.* (spreads `WASTE_RANGES`, `WASTE_JSON_RULES`) [M1.4]; refill rules + `PICKUP_PHONE_PATTERN` import removed [M8.1].
- M `api/modules/admin/admin-config-rules.ts` (assertBoolean for 4 waste booleans) [M1.4].
- M `api/modules/system-config/points-unit-guard.spec.ts` (POINTS_NUMBER_KEYS + 4 waste keys) [M1.4]; M `apps/api/prisma/reference-data/config-selection.ts` (`waste` entry of `EXCLUDED_CONFIG_PREFIXES`, with its reason) [M1.4].
- C `wx/waste-notify.codes.ts` (D2) [M1.5]; M `api/modules/notifications/notification-templates-seed.spec.ts` (CODES +10) [M1.5]; REFILL_* out [M8.3].
- C `st/waste.ts`, M `st/index.ts` (`export * from './waste'`), C `apps/api/src/modules/waste-exchange/waste-contract.spec.ts` [M1.6].
- C `wx/waste.constants.ts`, `wx/waste-locks.ts`, `wx/waste-codes.ts`, `wx/waste-points.ts` (+ specs; `wx/waste-locks.spec.ts` also source-scans every later `wx/` file: advisory locks only with a waste class literal or a `hashtext('cron:` key) [M1.7].
- C module shells (each `@Module({})`, filled later by owner lane): `wx/core/waste-core.module.ts` [shell M1.7, owner M2.1–M2.5], `wx/customer/waste-customer.module.ts` [M2.6a (L2-core), then M2.6b–M2.9 (L2-cust)], `wx/receiving/waste-receiving.module.ts` [M3], `wx/catalog/waste-catalog.module.ts` [M4], `wx/pickup/waste-pickup.module.ts` [M5]; C `wx/waste-exchange.module.ts` importing the five [M1.7]; M `api/app.module.ts` add `WasteExchangeModule` [M1.7] (RefillModule removed by M8.1). C `wx/waste-exchange.module.spec.ts` [M1.7 only, final form per D1: imports list and no own controllers/providers, a compile test with `useMocker` that resolves only `Waste*` providers inside the graph, AppModule registration; later tasks run it in their Gate and never edit it].

### 2.2 M2 (core + customer API) — all new files under `wx/core/` (M2.1–M2.5) or `wx/customer/` (M2.6–M2.9)
- C `core/waste-config.service.ts`, `core/waste-public-config.ts` (+specs) [M2.1]; M `apps/api/src/modules/waste-exchange/waste-config.keys.spec.ts` (add: every key of `WASTE_CONFIG_KEYS` occurs as a quoted literal in a non-spec source file other than `waste-config.keys.ts`; cannot pass before M2.1 because `snapshot()` is the first reader, review cov F15) [M2.1]; M `api/modules/system-config/public-config.ts` (`buildPublicConfig`, shared by `GET /config/public` and the `publicConfig` block of `GET /home`: add the `waste` block) + `api/modules/system-config/system-config.controller.spec.ts` (adds the waste case) [M2.1].
- C `core/waste-events.ts`, `core/waste-notifier.service.ts`, `core/waste-queue-filters.ts` (+specs) [M2.2].
- C `api/common/staff-access.ts`, `api/common/idempotency-key.ts`, `core/waste-access.service.ts`, `core/waste-mask.ts` (+specs) [M2.3]. Also C `core/waste-messages.ts` (+spec) [M2.3a: `export const WASTE_MESSAGES`, the shared Vietnamese sentences not pinned in 4.13, read by M2.3 to M2.9, M3, M4.2, M4.3 and M8.8a]; C `race/waste-core.race-spec.ts` [M2.3; appended by M2.4 and M2.5: real-DB proof of `availablePointIds`, `capUsage` and the §15.6 SQL].
- C `core/waste-caps.ts` (pure), `core/waste-hold.service.ts` (+specs) [M2.4].
- C `core/waste-ship-lock.service.ts` (+spec) [M2.5].
- C `customer/waste-catalogue.service.ts`, `customer/waste-me.service.ts`, `customer/waste-request.mapper.ts`, `customer/waste-customer.controller.ts` (read routes) (+specs) [M2.6]. M2.6a (L2-core) creates customer/waste-request.mapper.ts and customer/waste-requests.service.ts (read methods list/detail/byOrder) (+specs); M2.6b, M2.6c (L2-cust) create the rest.
- C `customer/waste-fee.ts`, `customer/waste-preview.service.ts`; M controller (+preview route) [M2.7].
- M `customer/waste-requests.service.ts` (created by M2.6a); M controller (+create, edit); C `race/waste-create.race-spec.ts`, `race/waste-edit.race-spec.ts` [M2.8].
- M `customer/waste-requests.service.ts` (+setTracking, cancel), controller; C `race/waste-tracking.race-spec.ts` [M2.9].
- M `api/modules/auth/auth.service.ts` (`mergeGuestInto`), `api/modules/users/account-deletion.service.ts` (`collectBlockers`, `DeletionBlockerCode`), `api/modules/merchant/merchant-fulfilment.service.ts` (`partnerBlockers`); M `race/auth-merge-guest.race-spec.ts`, `race/account-deletion.race-spec.ts` (+unit specs of those services) [M2.10].

### 2.3 M3 (receiving + points) — new files under `wx/receiving/`
- C `waste-quota.ts`, `waste-confirm-lines.ts`, `waste-match.ts` (+specs) [M3.1]; C `race/waste-quota.race-spec.ts` (§11.4 SQL on real Postgres) [M3.1a].
- C `waste-confirm.service.ts` (+spec), C `race/waste-confirm.race-spec.ts` [M3.2]; M same service (+reject, closeLost) [M3.3]. C `waste-admin-detail.mapper.ts` (+spec) [M3.3: `WASTE_ADMIN_DETAIL_INCLUDE` = `WASTE_REQUEST_FULL_INCLUDE` of `customer/waste-request.mapper.ts` (M2.6a, in M2-core) + `user { id, fullName, phone }`, and `toAdminRequestDetail` built on `toRequestDetail`; returned by closeLost (M3.3), reopen (M3.5), detail and setCost (M3.8a)]; M `race/waste-confirm.race-spec.ts` (append) [M3.3].
- C `waste-receive.service.ts` (+spec), C `race/waste-receive.race-spec.ts` [M3.4].
- C `waste-admin-requests.service.ts` [M3.5 reopen; M3.8 queue/lookup/detail/cost/flags]. `closeLost` lives in `waste-confirm.service.ts` (§4.8). M `race/waste-receive.race-spec.ts` (append) [M3.5]; C `race/waste-admin-requests.race-spec.ts` (setFlags/setCost locking transactions) [M3.8a].
- C `waste-reverse.service.ts` (+spec), C `race/waste-reverse.race-spec.ts`; M `api/modules/loyalty/loyalty-expiry.service.ts` (+ its spec) RECYCLE_RULE [M3.6].
- C `waste-desk.service.ts`, `waste-desk.controller.ts` (+specs) [M3.7]; C `waste-receiving.dto.ts` (confirm/reject body classes shared by the desk and admin controllers) [M3.7b].
- C `waste-admin-requests.controller.ts` (+spec) [M3.8].

### 2.4 M4 (gifts, admin catalogue, reports, ops inbox) — new files under `wx/catalog/`
- M `api/modules/loyalty/loyalty.service.ts` [M4.1 catalogue+mine; M4.2 redeem + delete DEFAULT_REWARD_CATALOG/RewardCatalogItem + assertPosStaff→assertActiveStaff]; M `loyalty.controller.ts` [M4.1 route mine; M4.2 header]; M `loyalty-features.spec.ts`, `loyalty-locked-window.spec.ts` [M4.1/M4.2]; keep `lockedPointsMessage` public and unchanged (checkout.service.spec.ts:172); M `loyalty.controller.spec.ts` [M4.1: pins the new `GET me/loyalty/rewards/mine` route; M4.2b adds the two `Idempotency-Key` header tests] (redeemReward and the new `getMyRedemptions` stay without `@Roles`).
- M `api/modules/admin/admin-engagement.service.ts`, `admin-engagement.controller.spec.ts`; M race `loyalty`, `pd3-points-lots`, `pd3-checkout-points`, `pf6-locked-window-outside-tx`, `admin-engagement-price-history` (key per call); C `race/waste-gift-redeem.race-spec.ts` [M4.2].
- C `waste-gift-redemptions.service.ts`, `waste-desk-gifts.controller.ts`, `waste-admin-gifts.controller.ts` (redemption routes) (+specs), C `race/waste-gift-cancel.race-spec.ts` [M4.3]; M `waste-admin-gifts.controller.ts` (+gift CRUD), C `waste-admin-gifts.service.ts` [M4.4].
- C `waste-admin-items.controller.ts`, `waste-admin-items.service.ts` [M4.5].
- C `waste-admin-points.controller.ts`, `waste-admin-points.service.ts` [M4.6].
- C `waste-reports.service.ts`, `waste-alerts.ts`, `waste-reports.controller.ts` (+specs) [M4.7].
- M `api/modules/ops/ops-inbox.service.ts` + `.spec.ts`, M `race/ops-health.race-spec.ts` [M4.8].

### 2.5 M5 (pickup lane) — new files under `wx/pickup/`
- C `waste-pickup-attach.ts` (+spec) [M5.1].
- M `api/modules/checkout/checkout.service.ts`, `dto/checkout.dto.ts`, `checkout.service.spec.ts`, `dto/checkout.dto.spec.ts`; C `race/waste-pickup-attach.race-spec.ts` (incl. ship-lock × checkout) [M5.2].
- C `waste-pickup-hooks.service.ts` (+spec); M `api/modules/orders/order-status.service.ts`, `orders.service.ts`, `orders.module.ts` (+their specs) [M5.3].
- C `waste-expiry.cron.ts` (+spec), M `race/waste-pickup-attach.race-spec.ts` (+expiry case) [M5.4]. C `waste-pickup-sweep.cron.ts` (+spec) [M5.5].
- M `api/modules/system-config/public-config.ts` + `system-config.controller.spec.ts` (remove `recyclingEnabled`: its `isGomdonRecyclingEnabled` entry in `buildPublicConfig` and the `describe('recyclingEnabled …')` block); web customer checkout: M `web/app/thanh-toan/page.tsx` and its specs that set `recyclingEnabled` (checkout-parity, total-changed, checkout-offline, checkout-split, checkout-discount-rows, points-label, checkout-empty-cart, coupon, checkout-address-note, checkout-sticky), `web/app/guest-pages.a11y.spec.tsx`, D `web/components/recycling-checkout.tsx`, `web/components/recycling-status.tsx`; M `web/lib/recycling.ts`(+spec) (remove only the customer-side `RECYCLING_NOTE_MAX`, `recyclingCheckoutFields`, `recyclingBookedAfterPayment`, `RecyclingTone`, `RecyclingPickupView`, `recyclingPickupView` and their cases; KEEP `Tone`, `GOMDON_*`, `gomdonStatusLabel`, `gomdonCancelLabel`, `isGomdonPickedUp`, `needsRecyclingAttention`, `gomdonAdminActions`, which are used by admin `ui.tsx`, `recycling-panel.tsx` and `lib/order-view.ts`); M `web/lib/order-view.ts`(+spec), `web/lib/shop-client.ts` (PublicConfig, placeOrder body), `web/components/admin/admin-components.spec.tsx` (drop RecyclingCheckoutSection import), `web/components/admin/ds-v2-shared.spec.tsx` if it imports removed files, `apps/e2e/tests/web-checkout.web.spec.ts`, `web/ds-v2-guest.spec.ts` (drop the two deleted paths in the same commit), `web/app/tai-khoan/orders-section.tsx` and `web/app/tai-khoan/don-hang/[code]/page.tsx` (drop `<RecyclingStatus>`) [M5.6]. Keep `recycling-panel.tsx`, `gomdon-config-card.tsx`, Gomdon pipeline (§12.2), and `admin.service.ts` `gomdonStatus().recyclingEnabled` + `web/lib/admin-client.ts:667` (technical Gomdon switch, unrelated to `/config/public`). Gomdon label rewording (C15, split by file owner): M5.6c rewords the 'tái chế' labels only in files no other lane touches: `web/components/admin/gomdon-config-card.tsx:134`, `web/components/admin/recycling-panel.tsx:133,136`, `web/components/admin/ops-health-tab.tsx:464`, `web/lib/export-csv.ts:65`, `web/components/admin/ops-tabs.spec.tsx:191`; `web/app/admin/page.tsx:733,1143-1144` and `page.spec.tsx:498,512` belong to M7.7a; `apps/api/prisma/seed.ts:253` to M8.1; `api/config/go-live/db-checks.ts:338` and `env-checks.ts:212,216` to M8.2. M5.6 never regenerates `scripts/uiux/generated/*.json` (D2: only M8.6a).

### 2.6 M6 (mini app) — new pages flat under `mini/pages/`
- C `mini/services/waste-api.ts`(+spec), `mini/utils/waste-labels.ts`(+spec), `mini/hooks/use-idempotency-key.ts`(+spec); M `mini/services/shop-api.ts` (`PublicConfig.waste`), `mini/hooks/use-public-config.spec.ts`, `mini/hooks/use-public-config.ts` (`PUBLIC_CONFIG_FALLBACK.waste = { enabled: false, dropoff: false, mailin: false, pickup: false }`), `apps/e2e/tests/support/mock-api.ts` (`publicConfig()` waste field) [M6.1].
- C `mini/components/ui/timeline.tsx`, `mini/components/waste-point-picker.tsx` (+specs); M `apps/miniapp/src/ds-c076-pc10c1.spec.ts` (entries are paths relative to apps/miniapp, e.g. 'src/pages/<file>.tsx' or 'src/components/ui/timeline.tsx') FILES [M6.2; every later M6 task adds its own files first].
- C `pages/recycle.tsx`, `pages/recycle-rules.tsx` (+specs); M `mini/components/app.tsx` [M6.3].
- C `pages/recycle-new.tsx`, `pages/recycle-points.tsx` (+specs); M app.tsx [M6.4].
- C `pages/recycle-request.tsx` (/recycle/r/:id), `pages/recycle-edit.tsx`, `pages/recycle-requests.tsx`, `pages/recycle-done.tsx` (+specs); M app.tsx [M6.5].
- C `pages/recycle-desk.tsx` (+spec); M app.tsx [M6.6].
- C `pages/rewards.tsx`, `pages/rewards-mine.tsx` (+specs); M `mini/services/account-api.ts` (+spec: types, `redeemLoyaltyReward(id,key)`, `getMyRedemptions`, ledger labels §10.4), `mini/pages/loyalty.tsx` (remove reward list, add Kho quà row) + `loyalty-behavior.spec.tsx`, `loyalty-layout.spec.tsx`, `loyalty.spec.ts` (source scan: move the `rewardsQ.isError`/`rewardsQ.refetch()` assertions to `pages/rewards.tsx`, keep the `checkInQ` ones); M app.tsx; M `apps/e2e/tests/loyalty.miniapp.spec.ts` (typecheck against the new `account-api.ts` types only; behaviour rewrite M8.7) [M6.7].
- M `mini/pages/checkout.tsx`(+spec), `mini/pages/order-detail.tsx`(+spec), `mini/services/shop-api.ts` (placeOrder body, drop `recyclingEnabled`), `mini/hooks/use-public-config.ts` (drop `recyclingEnabled` from the fallback), `mini/utils/format.ts` (remove recycling helpers), `mini/utils/order-status.ts`(+spec), D `mini/utils/format-recycling.spec.ts`, M `apps/e2e/tests/support/mock-api.ts`, `support/checkout-mocks.ts`, `checkout.miniapp.spec.ts`, `recycling-pickup.miniapp.spec.ts` (typecheck-level only; full rewrite M8.7) [M6.8].
- M `mini/pages/profile.tsx`(+`profile.spec.ts`), `mini/pages/game.tsx` (GameLinkRow) + `game-behavior.spec.tsx`, `mini/pages/loyalty.tsx` (Đổi rác row, flag-gated) + `loyalty-behavior.spec.tsx` (:119-124 → `/recycle`), `mini/pages/notifications.tsx` (+`notifications.spec.ts`) [M6.9].

### 2.7 M7 (web admin) — new files under `web/components/admin/`
- M `web/lib/admin-client.ts` (waste functions §4.11), `web/app/admin/page.tsx` + `page.spec.tsx` (refill tab → waste tab in all 7 places: `RefillTab` import, `Tab` member, nav item, `STAFF_TABS` comment, `STAFF_TABS.BASE`, inbox map entry, render line); M7.1 also creates the empty `waste-tab.tsx` shell (heading only, + its MIGRATED line) so the tab can be registered; M7.2 fills it [M7.1].
- M `waste-tab.tsx`(+spec) shell, chips, monthly strip; M `apps/web/src/ds-palette-pc11.spec.ts` (entries relative to apps/web/src, e.g. 'components/admin/waste-tab.tsx') MIGRATED [M7.2; each later M7 task adds its files first]. M7.2 also exports `type WasteSeed = { section: 'points' | 'requests' | 'gifts'; preset: string; n: number }` from `waste-tab.tsx`; `page.tsx` renders `<WasteTab key={wasteSeed?.n ?? 0} … seed={wasteSeed} />`, so a new seed remounts the tab, which starts on `seed.section` and passes `seed` to that section; a section ignores a seed whose section is not its own (D3).
- C `waste-items-section.tsx`(+spec) [M7.3]. C `waste-points-section.tsx`(+spec) [M7.4].
- C `waste-requests-section.tsx`(+spec); M `user-detail-drawer.tsx`(+spec): requests link + fix sentence "đổi vỏ chai" [M7.5].
- C `waste-gifts-section.tsx`(+spec); M `engagement-tab.tsx`(+spec) drop read-only catalogue [M7.6].
- C `waste-config-card.tsx`(+spec); M `config-item.tsx` (`MONEY_PREFIXES` + `waste.`), `web/lib/ledger-labels.ts`(+spec), `admin-client.ts` (`InboxKey` +8 / −`refillPending`), `ops-inbox-tab.tsx` (INBOX_LABELS), `web/app/admin/page.tsx` (`openInbox` map :413-437 (`target`, typed over `Exclude<InboxKey, …>`; the waste keys get an early-return branch like returns and community and join that `Exclude` list): each waste key opens the waste tab with WasteSeed { section, preset, n } per D3, M7.2 exports WasteSeed from waste-tab.tsx; drop refillPending) + `page.spec.tsx:129`, `ops-inbox-tab.spec.tsx` [M7.7]; `ops-tabs.spec.tsx` pins only `RefillTab`, so M7.7c runs it unchanged (its Gomdon label is M5.6c's, its `RefillTab` describe M8.5's).
- D3 mapping (M7.7c, `page.tsx`): `wasteToCount` → requests/`toCount`; `wasteUnmatched` → requests/`unmatched`; `wasteBlockedPending` → requests/`customerBlocked`; `wastePointsPending` → points/`pending`; `wastePerksPending` → points/`perk`; `wasteTransitOverdue` → requests/`transitOverdue`; `wasteGiftOverdue` → gifts/`overdue`; `wasteOrderMismatch` → requests/`orderMismatch`. Each section reads `seed.preset` in its own task with one test (seed → chip pressed and the matching query URL called): M7.4b points (`pending`, `perk`), M7.5a requests (`toCount`, `customerBlocked`, `transitOverdue`, `orderMismatch`), M7.5b requests `unmatched` (opens the unmatched view, which M7.5b creates), M7.6b gifts (`overdue`); M7.7c adds the page-level test (clicking each inbox chip sets the seed and calls the listed URL). Count = rows holds on the API side because inbox and queues share `core/waste-queue-filters.ts` (4.5).

### 2.8 M8 (removal + hardening)
- D `api/modules/refill/*` (9 files), D race `refill-approval|refill-idempotency|refill-locations|refill-locations-create`; M `app.module.ts`, `common/endpoint-inventory.spec.ts` (REMOVED + comment), `common/patch-null-contract.spec.ts` (`'PATCH /admin/refill-locations/:id'` → `'PATCH /admin/waste/points/:id'`), `modules/cart/cart.service.ts`, `modules/coupons/coupons.service.spec.ts` (mentions), `common/staff-permissions.matrix.spec.ts` (delete the `EXPECTED` rows of the refill routes and of `GET /admin/engagement/rewards`); in the same commit: `system-config/dead-config-keys.ts` (+5 refill keys), `seed.ts` (5 `refill.*` config rows out), `apps/api/prisma/reference-data/config-selection.ts` (`refill` entry of `EXCLUDED_CONFIG_PREFIXES` out), `system-config.service.ts`(+spec) (refill RANGES/JSON_RULES + spec cases, `PICKUP_PHONE_PATTERN` import), `common/phone.ts` (drop `PICKUP_PHONE_PATTERN` if unused); M `api/modules/admin/admin-engagement.controller.ts` (drop `@Get('rewards')`), `admin-engagement.service.ts` (drop `rewardCatalog`), `admin-engagement.controller.spec.ts`, race `admin-engagement-price-history` (drop the rewardCatalog block); `GET /admin/engagement/rewards` joins REMOVED [M8.1].
- M `api/config/go-live/{db-checks,collect,collect.spec,db-checks.spec,go-live.fixtures,run.spec,types}.ts` (db.waste_point: FAIL when waste.enabled ∧ no ACTIVE WAREHOUSE; WARN when waste.lane_pickup_enabled ∧ Gomdon flag off; WARN when waste.mailin_min_points or waste.pickup_min_points > waste.customer_monthly_cap_points; DbSnapshot.refill → waste, collect.ts counts waste_points, CONFIG_KEYS_OF_INTEREST += the 5 waste keys read; IMAGE_COMPATIBLE_MIGRATIONS + new folder; one db-checks.spec case per FAIL/WARN; pins §7 item 22) [M8.2].
- M `seed.ts` (REFILL_* templates out), `notification-templates-seed.spec.ts`, `schema.prisma` (`/// @deprecated` BottleReturn, RefillPickupLocation; plain comment RefillStatus), `common/schema-deprecated.spec.ts` (2 DEPRECATED rows + raw-SQL list) [M8.3].
- D mini `pages/refill.tsx`(+spec), `services/refill-api.ts`(+spec), `components/refill-location-picker.tsx` (no spec file exists, checked 2026-10-18); M `components/app.tsx` (`/refill` → `<Navigate to="/recycle" replace />`, drop RefillPage), `i18n/vi.ts`, `pages/admin.tsx`(+`admin.spec.tsx`), `pages/session-unavailable.spec.tsx`, `apps/miniapp/src/ds-c076-pc10c1.spec.ts` (entries are paths relative to apps/miniapp, e.g. 'src/pages/<file>.tsx' or 'src/components/ui/timeline.tsx') (drop `src/pages/refill.tsx`); in the same commit: D `apps/e2e/tests/refill.miniapp.spec.ts`, M `apps/e2e/tests/offline-states.miniapp.spec.ts` (`/refill` row); M8.4a never edits `mini/pages/recycle.tsx` (an M6.3 file): a failing `Đổi rác` row of the session-unavailable spec is reported to the M6 owner (wrapping the page would show the guest prompt before the paused card, spec 4.1) [M8.4].
- D web `refill-tab.tsx`, `refill-locations-panel.tsx` (+specs); M `lib/admin-client.ts` (drop refill fns), `test-utils/fixtures/admin-config-rows.ts`, `components/admin/ops-tabs.spec.tsx` (drop the `RefillTab` import :5 and its describe :844-880, same commit as the deletion), `app/admin/page.spec.tsx` (drop the `listPendingRefills` mock line if M7 left it) [M8.5].
- M docs (`docs/launch/deploy-rollback-runbook.md`, `docs/launch/pilot-order-playbook.md`, `docs/integrations/gomdon.md`, `docs/GO-LIVE-KEYS.md`, `README.md`, and the four handbook pages `docs/launch/so-tay-van-hanh/README.md`, `admin.md`, `cskh.md`, `kho.md` that still name the old "Đổi vỏ chai" tab), scripts (`scripts/audit/seed-audit-personas.ts`, `scripts/uiux/routes.mjs`, `scripts/uiux/scorecard.mjs`, edit `scripts/audit/routes.json` by hand (D2, the seed is never run); regenerate `scripts/uiux/generated/miniapp-endpoints.json` and `web-endpoints.json` (only here, D2); `turbo.json` (`@tubutree/api#test` inputs + `docs/**`, `README.md`) and `apps/api/src/common/beta-removed-audit.spec.ts` (its toEqual pin) in the same commit (C19)) [M8.6].
- C e2e `apps/e2e/tests/recycle.miniapp.spec.ts`, `recycle-desk.miniapp.spec.ts`, `rewards.miniapp.spec.ts`, `admin-waste.spec.ts` + M `apps/e2e/playwright.config.ts` (append `/.*admin-waste\.spec\.ts/` to the Web Admin `testMatch` array); M `recycling-pickup.miniapp.spec.ts` (rewrite to attach flow), `checkout.miniapp.spec.ts`, `loyalty.miniapp.spec.ts`, `support/mock-api.ts` (`mockSession` shared GETs) [M8.7].
- C `race/waste-cross-lane.race-spec.ts`; run `docs/2026-10-review/handoff/verify-full.sh` through the temporary-copy command of 4.14 "Full gate" (never as is: it hard-codes the main checkout and `tubu_it_main`); final opus review [M8.8].

### 2.9 Hot-spot edit order (only these tasks may touch these files, in this order)
| File | Order |
|---|---|
| `api/app.module.ts` | M1.7 → M8.1 |
| `wx/waste-exchange.module.ts` | M1.7 only |
| `wx/waste-exchange.module.spec.ts` | M1.7 only (final form, D1); later tasks run it in their Gate and never edit it |
| `wx/<lane>/*.module.ts` | shell M1.7 → owning lane only, except customer/waste-customer.module.ts: shell M1.7 → M2.6a (L2-core) → M2.6b → M2.6c → M2.7 (L2-cust); catalog/waste-catalog.module.ts: shell M1.7 → M4.3b → M4.4 → M4.5 → M4.6a → M4.6b → M4.7c; pickup/waste-pickup.module.ts: shell M1.7 → M5.3 → M5.4 → M5.5 |
| `apps/api/prisma/schema.prisma` | M1.1 → M8.3 |
| migration folder `..._waste_exchange` | M1.1 → M1.2 → M1.3 → M1.4 → M1.5 (never after M1) |
| `apps/api/prisma/seed.ts` | M1.3 → M1.4 → M1.5 → M8.1 → M8.3 |
| `system-config.service.ts` | M1.4 → M8.1 |
| `system-config/public-config.ts` | M2.1 → M5.6 |
| `common/staff-permissions.matrix.spec.ts` | L3: M3.8b; L4 (parallel to L3): M4.3b → M4.4 → M4.5 → M4.6a → M4.6b → M4.7c; then M8.1b (`EXPECTED` rows only, R0 append-only: each lane adds its own waste rows and passes the spec on its own branch; a merge conflict at the M3 → M4 merge is resolved by keeping both sets of rows; M8.1b deletes the refill and `engagement/rewards` rows) |
| `apps/api/prisma/reference-data/config-selection.ts` | M1.4 (adds `waste` to `EXCLUDED_CONFIG_PREFIXES`) → M8.1b (removes `refill`) |
| `system-config.controller.spec.ts` | M2.1 (adds waste case) → M5.6a (renames it to 'defaults -> waste all false', recyclingEnabled now absent) |
| `loyalty.service.ts`, `loyalty.controller.ts`, `loyalty-features.spec.ts`, `loyalty-locked-window.spec.ts` | M4.1 → M4.2 |
| `loyalty.controller.spec.ts` | M4.1 (pins `GET me/loyalty/rewards/mine`) → M4.2b (two `Idempotency-Key` header tests) |
| `race/waste-db-constraints.race-spec.ts` | M1.2 → M1.3 → M1.4 → M1.5 |
| `customer/waste-customer.controller.ts` | M2.6 → M2.7 → M2.8 → M2.9 |
| `customer/waste-requests.service.ts` (+.spec.ts) | M2.6a (L2-core) → M2.8a → M2.8b → M2.9 (L2-cust starts after the M2-core merge) |
| `customer/waste-request.mapper.ts` | M2.6a only (read by M3.3) |
| `race/waste-core.race-spec.ts` | M2.3 → M2.4 → M2.5 |
| `receiving/waste-confirm.service.ts` | M3.2 → M3.3 |
| `race/waste-confirm.race-spec.ts` | M3.2b → M3.3 |
| `race/waste-receive.race-spec.ts` | M3.4c → M3.5 |
| `receiving/waste-admin-requests.service.ts` | M3.5 → M3.8 |
| `catalog/waste-admin-gifts.controller.ts` | M4.3 → M4.4 |
| `race/waste-pickup-attach.race-spec.ts` | M5.2 → M5.4 |
| `loyalty-expiry.service.ts` | M3.6 |
| `checkout.service.ts`, `checkout.dto.ts` | M5.2 |
| `order-status.service.ts`, `orders.service.ts`, `orders.module.ts` | M5.3 |
| `auth.service.ts`, `account-deletion.service.ts`, `merchant-fulfilment.service.ts` | M2.10 |
| `ops-inbox.service.ts` (+spec, ops-health race) | M4.8 |
| `race/helpers.ts` | M1.2 |
| `notification-templates-seed.spec.ts` | M1.5 → M8.3 |
| `st/waste.ts` | M1.6 only (frozen; see R0) ; `st/index.ts` M1.6 (+append-only lines per R0) |
| `mini/components/app.tsx` | M6.3 → M6.4 → M6.5 → M6.6 → M6.7 → M8.4 |
| `mini/pages/profile.tsx`, `game.tsx`, `notifications.tsx` | M6.9 |
| `mini/pages/loyalty.tsx` | M6.7 → M6.9 |
| `mini/pages/loyalty-behavior.spec.tsx` | M6.7 → M6.9 |
| `mini/hooks/use-public-config.ts` | M6.1 → M6.8 |
| `mini/hooks/use-public-config.spec.ts` | M6.1 → M6.8 |
| `mini/components/app-routes-waste.spec.ts` | M6.3 (create) → M6.4…M6.7 (append) |
| `mini/pages/loyalty.spec.ts` | M6.7a → M6.7b |
| `mini/utils/format.ts` | M6.8 only (labels go to `utils/waste-labels.ts`) |
| `mini/services/shop-api.ts` | M6.1 → M6.8 |
| `apps/miniapp/src/ds-c076-pc10c1.spec.ts` | M6.2…M6.7 (append) → M8.4 |
| `apps/e2e/tests/support/mock-api.ts` | M6.1 → M6.8 → M8.7 |
| `apps/e2e/tests/loyalty.miniapp.spec.ts` | M6.7 → M8.7 |
| `apps/e2e/tests/checkout.miniapp.spec.ts`, `recycling-pickup.miniapp.spec.ts` | M6.8 → M8.7 |
| `web/components/admin/waste-tab.tsx` | M7.1 → M7.2 → M7.3 → M7.4b → M7.5a → M7.5d → M7.6a → M7.7a (one mount line each; M7.5d the URL read) |
| `web/app/admin/page.tsx` + `page.spec.tsx` | M7.1 → M7.7 → M8.5 (page.spec.tsx only: drop the listPendingRefills mock) |
| `web/components/admin/ops-tabs.spec.tsx` | M5.6c (Gomdon label :191, C15) → M8.5 (drop `RefillTab`); M7.7c runs it unchanged |
| `scripts/uiux/generated/miniapp-endpoints.json`, `web-endpoints.json`, `scripts/audit/routes.json` (+`personas.json`) | M8.6a only (D2: endpoints regenerated, routes.json edited by hand, the audit seed is never run) |
| `web/lib/admin-client.ts` | M7.1 → M7.7 → M8.5 |
| `apps/web/src/ds-palette-pc11.spec.ts` | M7.1 → M7.2…M7.7 (append; M8.5 does not touch it) |
| `web/app/thanh-toan/page.tsx` | M5.6 |

## 3. Task list

M1 — data layer and contract (7)
- M1.1 Prisma models + generated DDL. §11.1, §11.7, §6. Schema enums/models/relations exactly per §4.1; `prisma migrate diff --to-schema-datamodel --script` into the migration; header lines "-- Đổi rác lấy quà ... Chỉ THÊM". Dep none. Produces: Prisma models/enums §4.1, migration folder.
- M1.2 Hand-written constraints + index pins + race test infra. §11.3, §10.1, §13.2 row "Chỉ mục". Appends 5 partial unique indexes + all CHECKs (exact names §4.1.3); KNOWN list 23; pin 23; `deleteItData` waste tables; `waste-fixtures.ts`; `delete-it-data` additions; `waste-db-constraints.race-spec.ts`. Dep M1.1. Produces: constraint names, fixtures §4.10.
- M1.3 Reference data. §11.7, §5.1, §8. 5 items + 4 vouchers + `gift-tree` in migration (ON CONFLICT DO NOTHING) and `seedWasteReferenceData()` in seed.ts (same ids and names, §4.1.4; constants in `wx/waste-seed-data.ts`); voucher CHECK cases in constraints spec. Dep M1.2.
- M1.4 Config keys (D1). §11.5. `WASTE_CONFIG_KEYS`; literal seed rows createOnly; migration INSERT ... ON CONFLICT (key) DO NOTHING; RANGES (integer), JSON_RULES (fee table, thresholds, rules_text), assertBoolean ×4; POINTS_NUMBER_KEYS; `assertWasteConfigSeedRows`; `waste-config.keys.spec.ts`. Dep M1.3. Produces: §4.2.
- M1.5 Notification templates (D2). §11.6, §10.2. 10 templates in seed + migration (one line per tuple, r12 format) + `WASTE_TEMPLATE_CODES`; CODES +10; placeholders exactly §4.4. Dep M1.4.
- M1.6 Shared contract (D3). §15.2–15.4. `st/waste.ts` per §4.9; index export; build; type test that unions equal Prisma enum values (jest in api: `apps/api/src/modules/waste-exchange/waste-contract.spec.ts` comparing `Object.values(X)` of the named enum imports from `@prisma/client` (e.g. `import { WasteMethod } from '@prisma/client'`, not `$Enums`) to a const tuple exported next to each union). Dep M1.1.
- M1.7 Foundation code + module shells. §10.1, §11.1 codes, §11.2 formula, §8 QG code, §15.1. `waste.constants.ts`, `waste-locks.ts`, `waste-codes.ts`, `waste-points.ts` (§4.3) + 5 shells + root module + app.module. Dep M1.1.

M2 — core + customer API (10; M2.1–M2.5 and M2.6a form the "M2-core" merge unit; the lettered splits are defined in M2.md, and M2.1a, M2.3a and M2.6a belong to M2-core)
- M2.1 WasteConfigService + public flags. §11.5 last para, §12.4, §15.1 Cờ tổng. `snapshot()`, `computeWastePublicFlags`; `/config/public.waste`. Dep M1.4, M1.7.
- M2.2 Events, notifier, queue filters. §9 last para, §11.1 waste_events, §11.6, §10.2, §13.2 ops row. Dep M1.5, M1.7.
- M2.3 Access layer. §15.1 (all bullets), §6 "Ai được xác nhận", §5.5 owner rule. `assertActiveStaff`, `requireIdempotencyKey`, `WasteAccessService`, masking. Dep M1.7.
- M2.4 Caps and holds (`validateAndHold`). §11.2, §5.3, §7.4 edit rules. Dep M2.1, M2.3.
- M2.5 Ship-lock evaluator. §15.6, §5.4. Two-step lock + PICKUP auto-cancel + notify. Dep M2.2.
- M2.6 Customer reads + controller skeleton. §15.2 rows me/items/points/nearby/requests list+detail/by-order/rules, §15.1 ownership + response allow-list, §5.5 inactive hiding, §4.4. M2.6a (mapper + read service) is the last task of M2-core (Dep M2.5); M2.6b, M2.6c run in L2-cust.
- M2.7 Preview. §15.2 preview row, §4.2–4.3, §7.2 fee table. Dep M2.6.
- M2.8 Create + edit. §15.2 create/PATCH rows, §11.2 idempotency order, §7.4. Races: create×create, edit×edit, edit×create. Dep M2.6.
- M2.9 Tracking + cancel. §15.2 tracking/cancel rows, §5.3 trackingConflict, §10.1 tracking lock. Race: tracking spec. Dep M2.8.
- M2.10 Account merge/delete integration. §11.1 last paragraph, §14.4. Dep M1.2.

M3 — receiving and points (8)
- M3.1 Receiving primitives: quota counter (§11.4), staff daily usage (§15.5 step 6 query), confirm-line validator (§15.5 step 5), match evaluator (§15.4 receive, §7.2). Dep M2-core.
- M3.2 Confirm transaction. §15.5 all steps, §10.1, §10.5, §5.2, §15.6 post-commit. Race: confirm×confirm, quota boundary. Dep M3.1.
- M3.3 Reject + close-lost. §15.5 last para, §15.4 close-lost row, §11.6. Dep M3.2; imports the M2.6a mapper (in M2-core, C10).
- M3.4 Receive, unmatched, resolve. §15.4 receive/unmatched/resolve rows, §5.4 unmatched cases. Race: receive spec. Dep M3.1.
- M3.5 Reopen. §15.4 reopen row, §11.2 REOPEN path. Dep M3.3, M3.4.
- M3.6 Reverse + RECYCLE_RULE. §10.3, §15.4 reverse row. Race: reverse spec. Dep M3.2.
- M3.7 Desk API. §15.3 rows points/lookup/confirm/reject/perk PUT, §4.10 errors, §5.6. Dep M3.3.
- M3.8 Admin requests API + user flags. §15.4 rows GET requests/lookup/:id, receive/confirm/reject/reverse/cost/close-lost/reopen, unmatched, users/:userId/flags; masking contract tests. Dep M3.3–M3.6.

M4 — gifts, admin catalogue, reports, ops inbox (8)
- M4.1 Gift catalogue read + /mine. §15.2 rewards rows, §8 TREE price, §4.8 soldOut. Dep M2-core, M1.3.
- M4.2 redeemReward on waste_gifts. §8 (idempotency order, stock SQL, kinds, real user), §13.2 "Kho quà cứng" row. Race: redeem spec. Dep M4.1.
- M4.3 Fulfil + cancel + redemption queue. §15.3 gifts/fulfil, §15.4 gift-redemptions rows, §10.4 GIFT_REFUND. Race: gift-cancel spec. Dep M4.2.
- M4.4 Admin gifts CRUD + order. §15.4 gifts row, §11.3 pointsCost. Dep M4.3.
- M4.5 Admin items CRUD + order. §15.4 items row, §5.1, §14.1 hazardous. Dep M2-core; after M4.4 (waste-catalog.module.ts append order).
- M4.6 Admin points CRUD + staff + perk review + order. §15.4 points/staff/perk rows, §6, §5.5–5.6. Dep M2-core; after M4.5 (same file).
- M4.7 Reports + overview + alerts + desk point report. §17.2 incl. month convention, §5.5 alerts, §15.3 report row, §15.4 overview/reports rows. Dep M4.6.
- M4.8 Ops inbox keys (API). §13.2 ops row. Dep M2-core.

M5 — pickup lane (6)
- M5.1 Attach helpers. §12.2 step 2 (a)(b)(d), §10.1. Dep M2-core.
- M5.2 Checkout integration. §12.2 step 2, rules (isSameRequest, ctor), §13.2 checkout row (API part), §17.3 unit "gomdon-push". Race: attach spec (attach × ship-lock step 1/2 × checkout with points). Dep M5.1.
- M5.3 Order hooks. §12.2 step 3 (a)(b), hook points. Dep M2-core.
- M5.4 Expiry cron. §12.3 all, §12.2 step 4, §15.6 PICKUP_NO_SHOW evaluation. Race: appends 'attach day 5 × expiry cron day 7 no close' to the attach spec. Dep M5.3, M5.2.
- M5.5 Sweep cron. §12.2 step 3 sweep paragraph, HOOK_ANOMALY. Dep M5.3.
- M5.6 Old toggle removal (API public field + web customer). §12.2 last bullet, §13.2 checkout row (web/API). Dep M5.2.

M6 — mini app (9)
- M6.1 API client, labels, idempotency hook, PublicConfig.waste (+e2e mock). §16.1 gates, §11.5 public flags, §4.6 label table.
- M6.2 Timeline + point picker components. §16.1 Component mới, §4.4.
- M6.3 /recycle home + /recycle/rules. §4.1 (order of status cards), §14.2.
- M6.4 /recycle/new wizard + /recycle/points. §4.2–4.4, §16.1 idempotency, location.
- M6.5 Request screens: /recycle/r/:id, /edit, /requests, /done/:id. §4.5, 4.5b, 4.6, 4.7.
- M6.6 /recycle/desk. §4.10, §15.3.
- M6.7 /rewards + /rewards/mine + loyalty.tsx + account-api + ledger labels. §4.8, §10.4, §16.1 rewards rows.
- M6.8 Checkout toggle + order-detail line + remove old Gomdon copies. §12.2 step 2, bullets 5–6.
- M6.9 Entry points + notification routing. §16.1 Lối vào, §11.6 routing.

M7 — web admin (7)
- M7.1 admin-client + tab registration. §16.2 first para, §13.2 web row. M7.2 Tab shell + staff view + monthly strip. §16.2, §9. M7.3 Items. M7.4 Points. M7.5 Requests (+user drawer link). M7.6 Gifts (+engagement-tab). M7.7 Config card, ledger labels, ops-inbox web keys.

M8 — removal and hardening (8)
Lane order M8.2 → M8.1 → M8.3 → M8.4 … M8.8.
- M8.2 Go-live check swap (runs first: removes the `refill.pickup_address` go-live reader; §13.2 Go-live row, both warnings, §7 item 22 pins). Dep M1 merged. M8.1 Remove Refill API (+ refill config keys: DEAD_CONFIG_KEYS, seed rows, RANGES/JSON_RULES in the module-deletion commit). Dep M8.2. M8.3 Refill templates and schema deprecation (REFILL_* templates/CODES, `/// @deprecated`, `schema-deprecated.spec.ts`). Dep M8.1. M8.4 Mini app refill removal. M8.5 Web refill removal. M8.6 Docs, scripts, runbook (incl. §11.3 partial-index note, §14.8 list, §10.3 fraud-reversal procedure: cancel READY gifts first, deactivate unused coupons, set blockedAt; §15.4 cancel refundPoints has no default for blocked/REVERSED customers). M8.7 Playwright e2e (§17.3). M8.8 Cross-lane race specs + full gate + opus review.

## 4. Interface registry (binding)

### 4.1 Prisma (M1.1) — names; `@@map` = table name of §11.1
Enums: `WasteItemStatus {ACTIVE COMING_SOON HIDDEN}`, `WastePointKind {WAREHOUSE PARTNER}`, `WastePointStatus {ACTIVE PAUSED PENDING}`, `WastePointStaffRole {OWNER STAFF}`, `WasteMethod {DROP_OFF MAIL_IN PICKUP}`, `WasteRequestStatus {OPEN IN_TRANSIT RECEIVED COMPLETED REJECTED CANCELLED EXPIRED REVERSED}`, `WasteCloseReason {HOLD_EXPIRED PICKUP_NO_SHOW PICKUP_NOT_DISPATCHED LOST LOST_AT_WAREHOUSE SHIP_LOCKED ORDER_CANCELLED}`, `WasteRejectionReason {WET DIRTY FOREIGN_OBJECT WRONG_TYPE DAMAGED NOT_ACCEPTED OVERSIZE HAZARDOUS UNPAID_POSTAGE OTHER}`, `WasteShortfallReason {WET DIRTY FOREIGN_OBJECT WRONG_TYPE DAMAGED NOT_ACCEPTED OTHER}`, `WasteActorRole {CUSTOMER POINT_STAFF STAFF ADMIN SYSTEM}`, `WasteUnmatchedStatus {OPEN RESOLVED}`, `WasteGiftKind {VOUCHER TREE SEED_PACK GIFT}`, `WasteGiftStatus {ACTIVE HIDDEN}`, `WasteGiftRedemptionStatus {READY FULFILLED CANCELLED}`. Voucher discount type reuses enum `CouponType {PERCENT AMOUNT FREESHIP}` (schema.prisma:1314); `WasteGift.voucherType CouponType?`; `st` uses the existing `CouponType` from `packages/shared-types/src/enums.ts` for `RewardItemDTO.voucher.type`.
Models (camelCase fields as named in §11.1; ids `String @id @default(cuid())` except `WasteGift.id` fixed string, `WastePointItem` composite PK, `WastePointUsage` PK `(pointId, monthKey)`):
- `WasteItem` (`waste_items`): code @unique, name, unitLabel, unitsPerPoint Int, pointsPerGroup Int, dropsPerUnit Int @default(0), dailyCapQty Int?, monthlyCapQty Int?, status, prepInstructions String?, imageUrl String?, sortOrder Int, gramsPerUnit Int?, hazardous Boolean @default(false), timestamps; `@@index([status, sortOrder])`.
- `WastePoint` (`waste_points`): kind, name, addressLine, provinceCode, provinceName, communeCode, communeName, lat Float?, lng Float?, phone String?, openingHours Json, status, monthlyQuotaPoints Int?, perkText String?, perkPendingText String?, giftHandoverEnabled Boolean @default(false), note String?, sortOrder Int, activatedAt DateTime?, lastConfirmedAt DateTime?, timestamps; `@@index([kind, status])`, `@@index([provinceCode, status])`. No FK to storefronts.
- `WastePointItem` (`waste_point_items`): pointId FK, itemId FK, `@@id([pointId, itemId])`, `@@index([itemId])`.
- `WastePointStaff` (`waste_point_staff`): pointId FK, userId FK→User (no cascade), role, isActive, `@@unique([pointId, userId])`, `@@index([userId, isActive])`.
- `WastePointUsage` (`waste_point_usage`): pointId FK, monthKey String, pointsUsed Int @default(0), confirmations Int @default(0).
- `WasteRequest` (`waste_requests`): code @unique, userId FK→User, method, status, pointId FK→WastePoint (nullable? NO: required; MAIL_IN/PICKUP store warehouse id), orderId String? @unique FK→Order, carrier?, trackingCode?, trackingNorm? `@@index([trackingNorm])`, trackingConflict Boolean @default(false), estimatedPoints Int, estimatedDrops Int, capDayKey, capMonthKey, expiresAt?, inTransitAt?, receivedAt?, completedAt?, closedAt?, closeReason?, confirmedByUserId? (no FK), pointsAwarded Int?, dropsAwarded Int?, receivedWeightGrams Int?, carrierCostVnd Int?, rejectionReason?, rejectionNote? @db.VarChar(500), reversedAt?, reversedByUserId? (no FK), reversalReason?, reversalShortfallPoints Int?, idempotencyKey String, consentAt DateTime, consentVersion String, timestamps; `@@unique([userId, idempotencyKey])`, `@@index([userId, status])`, `@@index([status, method])`, `@@index([capMonthKey])`, `@@index([confirmedByUserId, completedAt])`, `@@index([pointId, status])`, `@@index([status, expiresAt])`.
- `WasteRequestLine` (`waste_request_lines`): requestId FK onDelete Cascade, itemId FK, itemCode, itemName, unitLabel, unitsPerPoint, pointsPerGroup, dropsPerUnit, gramsPerUnit Int?, declaredQty Int, receivedQty Int?, shortfallReason?, pointsAwarded Int?; `@@unique([requestId, itemId])`, `@@index([itemId])`.
- `WasteEvent` (`waste_events`): createdAt, kind String (closed list §4.3), requestId?, pointId?, giftRedemptionId?, actorUserId?, actorRole, meta Json?; no FKs; `@@index([requestId, createdAt])`, `@@index([pointId, kind, createdAt])`, `@@index([actorUserId, kind, createdAt])`.
- `WasteUnmatchedParcel` (`waste_unmatched_parcels`): receivedAt, createdByUserId (no FK), carrier?, trackingCode?, trackingNorm?, description @db.VarChar(200), reason String (`WasteUnmatchedReason`), relatedRequestId? (no FK — architect call §8.9), status, matchedRequestId? (no FK), resolvedByUserId?, resolvedAt?, resolveNote?; `@@index([status, receivedAt])`, `@@index([trackingNorm])`.
- `WasteUserFlags` (`waste_user_flags`): userId @id FK→User, shipLockedAt?, shipUnlockedAt?, blockedAt?, reason?, setByUserId? (no FK), updatedAt. Relation name on User: `wasteFlags WasteUserFlags?`.
- `WasteGift` (`waste_gifts`): id String @id, kind, name, description?, label?, pointsCost Int, status, sortOrder, imageUrl?, stock Int?, claimInstructions?, voucherType CouponType?, voucherValue Int?, voucherMinOrder Int?, voucherMaxDiscount Int?, voucherValidDays Int?, timestamps; `@@index([status, sortOrder])`.
- `WasteGiftRedemption` (`waste_gift_redemptions`): userId FK→User, giftId FK→WasteGift, giftKind, giftName, pointsCost, status, code String? @unique, couponId String?, idempotencyKey, claimExpiresAt?, fulfilledAt?, fulfilledByUserId?, fulfilledPointId?, cancelledAt?, cancelledByUserId?, cancelReason?, refundedPoints Int?, createdAt; `@@unique([userId, idempotencyKey])`, `@@index([status, claimExpiresAt])`, `@@index([userId, createdAt])`.
- Back-relations: `User.wasteRequests`, `User.wasteGiftRedemptions`, `User.wastePointStaff`, `User.wasteFlags`; `Order.wasteRequest WasteRequest?`.

4.1.3 Hand-written names (M1.2): partial unique `points_transactions_recycle_ref_key`, `points_transactions_recycle_reverse_key`, `points_transactions_gift_refund_key`, `waste_points_one_warehouse_key`, `waste_point_staff_one_owner_key` (exact SQL §11.3). CHECK names: `waste_items_hazardous_not_active_chk`, `waste_items_units_per_point_chk`, `waste_items_points_per_group_chk`, `waste_items_drops_chk`, `waste_items_daily_cap_chk`, `waste_items_monthly_cap_chk`, `waste_points_partner_quota_chk`, `waste_points_warehouse_active_chk`, `waste_requests_expires_at_chk`, `waste_request_lines_received_chk`, `waste_request_lines_declared_chk`, `waste_point_usage_points_chk`, `waste_gifts_stock_chk`, `waste_gifts_voucher_fields_chk`, `waste_gifts_points_cost_chk`, `waste_gift_redemptions_ready_chk`.
4.1.4 Seed ids (M1.3): items `wi-carton` (code `CARTON`, "thùng", 1→1000, day 10, month 60), `wi-bubble-wrap` (`BUBBLE_WRAP`, "túi lớn", 1→1000, 10/60), `wi-milk-carton` (`MILK_CARTON`, "vỏ", 5→1000, 50/300), `wi-tubu-bottle` (`TUBU_BOTTLE`, "vỏ", 1→2000, drops 2, month 20, no day), `wi-battery` (`BATTERY`, `COMING_SOON`, hazardous). Gifts `reward-freeship` (20000, FREESHIP, min 99000), `reward-discount-50k` (50000, 50000, min 300000), `reward-percent-15pct` (75000, 15%, max 80000, min 250000), `reward-discount-100k` (100000, 100000, min 600000) — all validDays 30, type/value/minOrder/maxDiscount as in `DEFAULT_REWARD_CATALOG` (loyalty.service.ts:1536); name = title without the word "Voucher" and without a "Mã giảm giá" prefix: "Miễn phí vận chuyển" (`reward-freeship`), "Giảm 50.000đ" (`reward-discount-50k`), "Giảm 15%" (`reward-percent-15pct`), "Giảm 100.000đ" (`reward-discount-100k`) (mockup 16); description = current description; label = current badge; sortOrder 10/20/30/40 in the order freeship, 50k, 15%, 100k; kind VOUCHER, status ACTIVE, stock NULL; `gift-tree` (TREE, name "Góp quỹ trồng cây", pointsCost 0 — CHECK allows TREE outside 1..2000000).

### 4.2 Config (M1.4 owns keys; M2.1 reads)
`wx/waste-config.keys.ts`:
```ts
export type WasteConfigType = 'boolean' | 'int' | 'json' | 'string';
export interface WasteConfigKeyDef { default: boolean | number | string | Record<string, unknown>; type: WasteConfigType; category: 'waste'; description: string; min?: number; max?: number; maxLength?: number }
export const WASTE_CONFIG_KEYS = { 'waste.enabled': {...}, ... } as const satisfies Record<string, WasteConfigKeyDef>;
export type WasteConfigKey = keyof typeof WASTE_CONFIG_KEYS;
export function assertWasteConfigSeedRows(rows: ReadonlyArray<{ key: string; value: unknown; category?: string; createOnly?: boolean; description?: string }>): void; // throws if any WASTE key missing/differs or a waste.* row is not in the record
export const WASTE_RANGES;       // RANGES entries for every int waste key (integer: true); spread by system-config.service.ts
export const WASTE_JSON_RULES;   // JSON_RULES for waste.mailin_fee_table, waste.alert_thresholds, waste.rules_text; spread by system-config.service.ts
export const WASTE_BOOLEAN_KEYS; // the 4 waste booleans (admin-config-rules assertBoolean)
```
Keys (default; bounds): `waste.enabled` false; `waste.lane_dropoff_enabled` true; `waste.lane_mailin_enabled` true; `waste.lane_pickup_enabled` false; `waste.mailin_min_points` 15000 (1..1000000); `waste.pickup_min_points` 10000 (1..1000000); `waste.customer_monthly_cap_points` 60000 (1..2000000); `waste.max_open_requests` 3 (1..20); `waste.request_hold_days` 7 (1..60); `waste.pickup_wait_days` 14 (1..90); `waste.in_transit_review_days` 30 (7..180); `waste.mailin_max_weight_kg` 20 (1..50); `waste.mailin_max_edge_cm` 50 (10..200); `waste.shortfall_lock_pct` 50 (1..100); `waste.shortfall_lock_streak` 3 (2..10); `waste.staff_daily_cap_points` 1000000 (1..20000000); `waste.gift_claim_days` 60 (7..365); `waste.point_inactive_days` 60 (7..365); `waste.mailin_fee_table` `{ zones: [], defaultZone: { name: 'Toàn quốc', low: 30000, high: 85000 } }`; `waste.alert_thresholds` `{ quotaPacePct: 60, quotaPaceDays: 10, fullMatchPct: 95, fullMatchMinSample: 10, repeatCustomerCount: 3, repeatCustomerDays: 7, avgUnitsFactor: 2, lookupMissCount: 10, lookupMissDays: 1, staffDirectCount: 5, staffDirectDays: 7 }`; `waste.rules_text` '' (≤8000 chars). All ints `integer: true` in RANGES; all seed rows `createOnly: true`, category `'waste'`. POINTS_NUMBER_KEYS adds `waste.mailin_min_points {max:1000000}`, `waste.pickup_min_points {max:1000000}`, `waste.customer_monthly_cap_points {max:2000000}`, `waste.staff_daily_cap_points {max:20000000}`.
`WasteConfigSnapshot` (M2.1, `core/waste-config.service.ts`):
```ts
export interface WasteConfigSnapshot { enabled: boolean; laneDropoff: boolean; laneMailin: boolean; lanePickup: boolean; mailinMinPoints: number; pickupMinPoints: number; customerMonthlyCapPoints: number; maxOpenRequests: number; requestHoldDays: number; pickupWaitDays: number; inTransitReviewDays: number; mailinMaxWeightKg: number; mailinMaxEdgeCm: number; shortfallLockPct: number; shortfallLockStreak: number; staffDailyCapPoints: number; giftClaimDays: number; pointInactiveDays: number; mailinFeeTable: WasteFeeTable; alertThresholds: WasteAlertThresholds; rulesText: string }
@Injectable() export class WasteConfigService {
  snapshot(): Promise<WasteConfigSnapshot>;   // outside any tx; invalid stored value → default + logger.warn
  isEnabled(): Promise<boolean>;
}
// core/waste-public-config.ts (no DI; used by `buildPublicConfig` in system-config/public-config.ts)
export function computeWastePublicFlags(config: Pick<SystemConfigService, 'get'>, gomdonEnabled?: () => Promise<boolean>): Promise<WastePublicFlags>; // default gomdonEnabled = () => isGomdonRecyclingEnabled(config).catch(() => false)
```
`WastePublicFlags = { enabled; dropoff; mailin; pickup }`, each lane true only if `enabled`; `pickup` also needs `waste.lane_pickup_enabled` and Gomdon.

### 4.3 Foundation (M1.7)
```ts
// wx/waste.constants.ts
export const WASTE_LOCK_CLASS = { CUSTOMER: 731001, TRACKING: 731002, STAFF_CAP: 731003, POINT_CREATE: 731004 } as const;
export const WASTE_CONSENT_VERSION = '2026-10-17.1';
export const WASTE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'; // = [2-9A-HJKMNP-TV-Z], 30 chars
export const WASTE_LOOKUP_PATTERN = /^(TR-[2-9A-HJKMNP-TV-Z]{5}|QG-[2-9A-HJKMNP-TV-Z]{8})$/;
export const WASTE_REQUEST_POINTS_MAX = 2_000_000;
export const WASTE_POINTS_MAX_PER_SITE = 200;           // §15.4 points cap
export const WASTE_MAX_STAFF_PER_POINT = 5;
export const WASTE_RECEIVE_REPLAY_MS = 10 * 60_000;     // §15.4
export const WASTE_DESK_RECENT_MS = 24 * 3_600_000;     // §15.3 lookup "trong 24 giờ qua"
export const GOMDON_DISPATCHED_STATUSES = ['3', '4', '5', '7'] as const; // §12.2 step 4
export const WASTE_OPEN_STATUSES = ['OPEN', 'IN_TRANSIT', 'RECEIVED'] as const;
export const WASTE_CAP_STATUSES = ['OPEN', 'IN_TRANSIT', 'RECEIVED', 'COMPLETED', 'REVERSED'] as const;
export const WASTE_EVENT_KINDS = ['REQUEST_CREATED','REQUEST_EDITED','TRACKING_SET','TRACKING_EDITED','REQUEST_CANCELLED','REQUEST_ATTACHED','PICKUP_STARTED','PICKUP_ORDER_CANCELLED','REQUEST_EXPIRED','HOOK_ANOMALY','SHIP_LOCKED','REQUEST_CANCELLED_SHIP_LOCK','PARCEL_RECEIVED','PARCEL_UNMATCHED','UNMATCHED_RECORDED','UNMATCHED_RESOLVED','UNMATCHED_CLOSED','REQUEST_CONFIRMED','REQUEST_REJECTED','LOOKUP_MISS','POINTS_REVERSED','REQUEST_CLOSED_LOST','REQUEST_REOPENED','REQUEST_COST_UPDATED','PERK_SUBMITTED','PERK_APPROVED','PERK_REJECTED','ITEM_CREATED','ITEM_UPDATED','ITEMS_REORDERED','POINT_CREATED','POINT_UPDATED','POINTS_REORDERED','POINT_STAFF_ADDED','POINT_STAFF_REMOVED','GIFT_CREATED','GIFT_UPDATED','GIFTS_REORDERED','GIFT_FULFILLED','GIFT_CANCELLED','USER_FLAGS_UPDATED'] as const;
export type WasteEventKind = (typeof WASTE_EVENT_KINDS)[number];
// wx/waste-locks.ts — class literal is written INSIDE the SQL text (never a bound parameter), two-key form; call with tx.$executeRaw (void result; $queryRaw is only for pg_try_advisory_xact_lock, which returns boolean)
export function lockWasteCustomer(tx: Prisma.TransactionClient, userId: string): Promise<void>;      // SELECT pg_advisory_xact_lock(731001, hashtext(${userId}))
export function lockWasteTracking(tx: Prisma.TransactionClient): Promise<void>;                       // SELECT pg_advisory_xact_lock(731002, 0)
export function lockWasteStaffCap(tx: Prisma.TransactionClient, staffUserId: string): Promise<void>;  // SELECT pg_advisory_xact_lock(731003, hashtext(${staffUserId}))
export function lockWastePointCreate(tx: Prisma.TransactionClient): Promise<void>;                    // SELECT pg_advisory_xact_lock(731004, 0)
// spec of waste-locks asserts the raw template strings contain the literal and only the id is a parameter
// wx/waste-codes.ts
export function generateWasteCode(kind: 'TR' | 'QG', rand?: (n: number) => number): string; // TR-xxxxx / QG-xxxxxxxx
export function normalizeWasteCode(raw: string): string;   // toUpperCase + remove all whitespace
export function normalizeTracking(raw: string): string;    // same normalisation → trackingNorm
export function lookupMissMeta(raw: string): { code?: string; length: number; classes: string }; // §11.1 LOOKUP_MISS rule
// wx/waste-points.ts (pure, §11.2)
export interface WasteRateSnapshot { unitsPerPoint: number; pointsPerGroup: number; dropsPerUnit: number; gramsPerUnit: number | null }
export function linePoints(qty: number, s: WasteRateSnapshot): number;          // Math.floor(qty / unitsPerPoint) * pointsPerGroup
export function lineDrops(qty: number, s: WasteRateSnapshot): number;           // qty * dropsPerUnit
export function unitsToNextPoint(qty: number, s: WasteRateSnapshot): number;    // for "thêm N vỏ nữa"
export function requestTotals(lines: ReadonlyArray<{ qty: number; snap: WasteRateSnapshot }>): { points: number; drops: number; grams: number | null }; // grams null if any line lacks gramsPerUnit
```
TR/QG codes: uniqueness by `@unique`; generator retried (max 5) on a pre-insert `findUnique` inside the tx; a residual P2002 is caught outside the tx and the whole call retried once.

### 4.4 Notifications (M1.5 templates; M2.2 notifier)
`wx/waste-notify.codes.ts`: `export const WASTE_TEMPLATE_CODES = ['WASTE_PARCEL_RECEIVED','WASTE_POINTS_CREDITED','WASTE_REQUEST_REJECTED','WASTE_REQUEST_EXPIRED','WASTE_PICKUP_STARTED','WASTE_PICKUP_CANCELLED','WASTE_POINTS_REVERSED','WASTE_SHIP_LOCKED','WASTE_GIFT_CANCELLED','WASTE_PERK_REVIEWED'] as const; export type WasteTemplateCode = (typeof WASTE_TEMPLATE_CODES)[number];`
| Code | Template id | Placeholders (exact) | dedupeKey |
|---|---|---|---|
| WASTE_PARCEL_RECEIVED | nt-waste-parcel-received | `{{code}}` | `waste:<requestId>:RECEIVED:<receiveEventId>` |
| WASTE_POINTS_CREDITED | nt-waste-points-credited | `{{code}}` `{{result}}` | `waste:<requestId>:COMPLETED` |
| WASTE_REQUEST_REJECTED | nt-waste-request-rejected | `{{code}}` `{{reason}}` | `waste:<requestId>:REJECTED` |
| WASTE_REQUEST_EXPIRED | nt-waste-request-expired | `{{code}}` `{{detail}}` | `waste:<requestId>:EXPIRED:<closedAt.toISOString()>` |
| WASTE_PICKUP_STARTED | nt-waste-pickup-started | `{{code}}` `{{until}}` | `waste:<requestId>:IN_TRANSIT` |
| WASTE_PICKUP_CANCELLED | nt-waste-pickup-cancelled | `{{code}}` | `waste:<requestId>:CANCELLED` |
| WASTE_POINTS_REVERSED | nt-waste-points-reversed | `{{code}}` `{{points}}` `{{reason}}` | `waste:<requestId>:REVERSED` |
| WASTE_SHIP_LOCKED | nt-waste-ship-locked | none (neutral text, §15.6) | `waste-lock:<userId>:<shipLockedAt ISO>` |
| WASTE_GIFT_CANCELLED | nt-waste-gift-cancelled | `{{gift}}` `{{points_note}}` | `waste-gift:<redemptionId>:CANCELLED` |
| WASTE_PERK_REVIEWED | nt-waste-perk-reviewed | `{{point}}` `{{result}}` | `waste-perk:<pointId>:<reviewEventId>` |
Every request-scoped call also passes `request_id` in `data` (routing, §11.6); gift: `redemption_id`; perk: `point_id`. Texts: "Điểm Xanh", no `'`, no "xu", no "voucher".
```ts
// core/waste-notifier.service.ts — each method calls this.notifications.notify(userId, '<LITERAL CODE>', data, { dedupeKey }) and swallows errors (.catch(() => undefined) + logger.warn). Call only after commit.
parcelReceived(userId: string, req: { id: string; code: string }, receiveEventId: string): Promise<void>;
pointsCredited(userId: string, req: { id: string; code: string }, points: number, drops: number): Promise<void>; // result = points>0 ? 'Tubu đã cộng N Điểm Xanh[ và M giọt nước]' (N = formatPoints(points) of `common/format-points.ts`) : truthful 'chưa đủ để cộng' sentence
requestRejected(userId: string, req: { id: string; code: string }, reason: WasteRejectionReason): Promise<void>; // HAZARDOUS → "có vật không nhận"
requestExpired(userId: string, req: { id: string; code: string }, closeReason: WasteCloseReason, closedAt: Date): Promise<void>; // detail per closeReason (§4.6 wording; LOST_AT_WAREHOUSE admits Tubu fault + support; PICKUP_NOT_DISPATCHED apologises + suggests mail-in)
pickupStarted(userId: string, req: { id: string; code: string }, expiresAt: Date): Promise<void>; // until = formatVnDate(expiresAt)
pickupCancelled(userId: string, req: { id: string; code: string }): Promise<void>;
pointsReversed(userId: string, req: { id: string; code: string }, taken: number, reason: string): Promise<void>; // points = formatPoints(taken)
shipLocked(userId: string, shipLockedAt: Date): Promise<void>;
giftCancelled(userId: string, r: { id: string; giftName: string }, refundedPoints: number): Promise<void>; // points_note shows formatPoints(refundedPoints)
perkReviewed(ownerUserId: string, p: { id: string; name: string }, approved: boolean, reviewEventId: string): Promise<void>;
```

### 4.5 Events, access, filters (M2.2, M2.3)
```ts
// core/waste-events.ts
export type WasteDeviceMeta = { ip: string | null; userAgent: string | null }; // type alias so it is assignable to Prisma.InputJsonObject inside event meta
export interface WasteEventInput { kind: WasteEventKind; actorUserId: string | null; actorRole: WasteActorRole; requestId?: string | null; pointId?: string | null; giftRedemptionId?: string | null; meta?: Prisma.InputJsonObject } // meta: before/after + itemId/giftId/subjectUserId/staffUserId/matchBasis/device
export function writeWasteEvent(db: Prisma.TransactionClient, input: WasteEventInput): Promise<{ id: string }>; // pass this.prisma outside tx (PrismaService satisfies TransactionClient shape)
export function truncateIp(ip: string | null | undefined): string | null;   // IPv4 drop last octet; IPv6 keep first 48 bits
export function deviceMetaOf(req: { ip?: string; headers: Record<string, string | string[] | undefined> }): WasteDeviceMeta; // UA first 200 chars
@Injectable() export class WasteEventsService { record(input: WasteEventInput, db?: Prisma.TransactionClient): Promise<{ id: string }> }
// core/waste-queue-filters.ts — single source for queues (M3.8, M4.3, M4.6) and ops inbox (M4.8)
export const WASTE_TO_COUNT_WHERE: Prisma.WasteRequestWhereInput;            // method in [MAIL_IN,PICKUP], status RECEIVED
export const WASTE_EXPIRED_WHERE: Prisma.WasteRequestWhereInput;             // status EXPIRED
export function wasteCustomerBlockedWhere(): Prisma.WasteRequestWhereInput;   // status in OPEN/IN_TRANSIT/RECEIVED and user.isBlocked or user.wasteFlags.blockedAt not null
export function wasteOrderNotDeliveredWhere(): Prisma.WasteRequestWhereInput; // PICKUP, orderId not null, status OPEN, order.status not in DELIVERED/RETURNED/CANCELLED
export function wasteTransitOverdueWhere(now: Date, reviewDays: number): Prisma.WasteRequestWhereInput; // MAIL_IN, IN_TRANSIT, inTransitAt < now − days
export function wasteOrderMismatchWhere(): Prisma.WasteRequestWhereInput;     // (order CANCELLED ∧ status ≠ CANCELLED) ∨ (order in DELIVERED/RETURNED ∧ status = CANCELLED)
export const WASTE_UNMATCHED_OPEN_WHERE: Prisma.WasteUnmatchedParcelWhereInput;
export const WASTE_POINTS_PENDING_WHERE: Prisma.WastePointWhereInput;        // status PENDING
export const WASTE_PERKS_PENDING_WHERE: Prisma.WastePointWhereInput;         // perkPendingText not null and ≠ ''
export function wasteGiftOverdueWhere(now: Date): Prisma.WasteGiftRedemptionWhereInput; // READY ∧ claimExpiresAt < now
// api/common/staff-access.ts
export interface ActiveStaff { id: string; role: 'STAFF' | 'ADMIN'; phone: string | null }
export function assertActiveStaff(db: Pick<PrismaService, 'user'> | Prisma.TransactionClient, userId: string, message?: string): Promise<ActiveStaff>; // role STAFF/ADMIN ∧ !isBlocked ∧ mergedIntoId null, else 403(message ?? 'Chỉ nhân viên hoặc quản trị viên mới làm được thao tác này.')
export function assertActiveAdmin(db: Pick<PrismaService, 'user'> | Prisma.TransactionClient, userId: string): Promise<ActiveStaff>;
// api/common/idempotency-key.ts
export function requireIdempotencyKey(raw: unknown): string; // missing or not /^[A-Za-z0-9_-]{8,128}$/ → 400; invalid message identical to parseTreeBuyKey
// core/waste-mask.ts
export function customerView(u: { fullName: string | null; phone: string | null; id: string }, viewerIsAdmin: boolean, includeUserId?: boolean): { name: string; phone: string | null; userId?: string }; // maskFullName/maskPhoneOrNull unless admin
// core/waste-access.service.ts
export type WasteGateMode = 'FULL' | 'OWN'; // FULL = real+phone+enabled+!blocked ; OWN = real+phone only (read exceptions, tracking, cancel)
export interface WasteCustomerContext { userId: string; phone: string; blocked: boolean; shipLockedAt: Date | null; programmeEnabled: boolean }
export function eligibilityOf(u: { phone: string | null; zaloId: string | null }): WasteEligibility; // GUEST if !isRealUser, NEED_PHONE if !phone, else OK
export interface WastePointAccess { pointId: string; kind: WastePointKind; name: string; status: WastePointStatus; giftHandoverEnabled: boolean; monthlyQuotaPoints: number | null; actorRole: 'POINT_STAFF' | 'STAFF' | 'ADMIN'; myRole: WastePointStaffRole; caller: { id: string; phone: string | null; role: string } }
@Injectable() export class WasteAccessService {
  customerGate(userId: string, mode: WasteGateMode, programmeEnabled: boolean): Promise<WasteCustomerContext>; // 403 messages §4.13
  assertPointAccess(userId: string, pointId: string, opts: { programmeEnabled: boolean; db?: Prisma.TransactionClient }): Promise<WastePointAccess>; // §15.1 (a)-(d); PARTNER + !programmeEnabled → 403
  assertWarehouseActor(userId: string, db?: Prisma.TransactionClient): Promise<ActiveStaff>; // assertActiveStaff + blockedAt (except ADMIN)
  listOperablePoints(userId: string, programmeEnabled: boolean): Promise<WastePointAccess[]>; // GET /waste/desk/points and /waste/me
  availablePointIds(db: Prisma.TransactionClient, pointIds?: string[]): Promise<Set<string>>; // ACTIVE ∧ (WAREHOUSE ∨ exactly one valid OWNER per §15.1 d), one aggregate query
  warehousePoint(db?: Prisma.TransactionClient): Promise<{ id: string } | null>;
}
```
Event meta (C06, binding for every writer): every WasteEvent except LOOKUP_MISS (spec 11.1: typed string only) writes `meta.before` and `meta.after` (changed fields only, null when the row did not exist) plus whichever of itemId, giftId, subjectUserId, staffUserId apply (spec 9, last paragraph). HOOK_ANOMALY changes nothing, so it writes before = after = { requestStatus, orderStatus } plus orderId. LOOKUP_MISS writes pointId per 4.8. Staff add/remove store the staff member under `staffUserId`, never `userId`. Gift redeem writes no WasteEvent (GIFT_REDEEM is a ledger reason).

### 4.6 Caps, ship lock (M2.4, M2.5) — called by M2.6–M2.8, M3.2–M3.6, M5.4
```ts
// core/waste-hold.service.ts
export type WasteHoldPath = 'CREATE' | 'EDIT' | 'REOPEN';
export type WasteHoldConfig = Pick<WasteConfigSnapshot, 'laneDropoff' | 'laneMailin' | 'lanePickup' | 'mailinMinPoints' | 'pickupMinPoints' | 'customerMonthlyCapPoints' | 'maxOpenRequests' | 'requestHoldDays'>;
export interface WasteHoldInput { path: WasteHoldPath; userId: string; method: WasteMethod; lines: WasteLineInput[]; pointId: string | null; existing?: { id: string; pointId: string; capDayKey: string; capMonthKey: string }; now: Date }
export interface WasteLineSnapshot { itemId: string; itemCode: string; itemName: string; unitLabel: string; unitsPerPoint: number; pointsPerGroup: number; dropsPerUnit: number; gramsPerUnit: number | null; declaredQty: number; hazardous: boolean }
export interface WasteHoldResult { pointId: string; capDayKey: string; capMonthKey: string; expiresAt: Date | null /* CREATE only (now + requestHoldDays); null for EDIT and REOPEN — callers never write it on those paths */; lines: WasteLineSnapshot[]; estimatedPoints: number; estimatedDrops: number }
export interface WasteCapUsage { itemDay: Map<string, number>; itemMonth: Map<string, number>; pointsMonth: number; openCount: number; pickupPendingCode: string | null }
@Injectable() export class WasteHoldService {
  validateAndHold(tx: Prisma.TransactionClient, input: WasteHoldInput, cfg: WasteHoldConfig): Promise<WasteHoldResult>; // caller already holds lockWasteCustomer (+ FOR UPDATE row for EDIT/REOPEN); never reads SystemConfig; throws §4.13; reads `waste_user_flags` (`shipLockedAt`, `blockedAt`) with `tx` after the replay step (plain SELECT, no row lock) — never a value from the pre-tx gate
  evaluate(db: Prisma.TransactionClient, input: WasteHoldInput, cfg: WasteHoldConfig): Promise<{ result: Omit<WasteHoldResult, 'expiresAt'>; blocks: WastePreviewBlockDTO[] }>; // non-throwing twin for preview and /waste/me; reads `waste_user_flags` with the passed `db`
  capUsage(db: Prisma.TransactionClient, userId: string, capDayKey: string, capMonthKey: string, excludeRequestId?: string): Promise<WasteCapUsage>;
}
// Path matrix (§11.2): lane flags + maxOpen + consent + one unattached PICKUP (`PICKUP_PENDING` → 409, `pickupPendingCode` read under the CUSTOMER lock): CREATE only (the PICKUP rule applies when method is PICKUP); min thresholds + shipLock: CREATE, EDIT; ACTIVE items + point has all items: CREATE, EDIT; point available + quota hint: CREATE, EDIT only if pointId changed; day cap: CREATE/EDIT DROP_OFF; month caps: all three; REOPEN uses stored capMonthKey only. REOPEN reads the rate columns of each line from the stored waste_request_lines of `existing.id`, never from the current item row (spec 5.1); create and EDIT snapshot the current item rates (C01; signature and WasteHoldInput unchanged; a REOPEN line without a stored snapshot throws).
// core/waste-ship-lock.service.ts
@Injectable() export class WasteShipLockService {
  shouldLock(db: Prisma.TransactionClient, userId: string, pct: number, streak: number): Promise<boolean>; // §15.6 SQL via $queryRaw
  evaluateAndLock(userId: string, cfg: Pick<WasteConfigSnapshot, 'shortfallLockPct' | 'shortfallLockStreak'>): Promise<{ locked: boolean; shipLockedAt: Date | null; cancelledRequestIds: string[] }>; // post-commit only; step1 tx (createMany skipDuplicates → flags row FOR UPDATE → shouldLock(tx) re-check, false returns { locked: false, … } with no event, no notify and no step 2 → updateMany shipLockedAt IS NULL → SHIP_LOCKED event only if count===1; count 0 → return { locked: false, … } with no notify and no step 2) then notifier.shipLocked, then step2 per-row autocommit cancel (closeReason SHIP_LOCKED, event REQUEST_CANCELLED_SHIP_LOCK)
}
```

### 4.7 Customer services (M2.6–M2.9)
```ts
WasteCatalogueService: listItems(): Promise<WasteItemDTO[]>; listPoints(provinceCode?: string): Promise<WastePointDTO[]>; nearbyPoints(body: WasteNearbyRequest): Promise<WastePointDTO[]>; // ≤200, inactive-hidden PARTNER excluded (§5.5), quotaFull derived, resolveZaloLocation(process.env.ZALO_APP_SECRET, token, accessToken)
WasteMeService: me(userId: string): Promise<WasteMeDTO>; rules(): Promise<WasteRulesDTO>;
WastePreviewService: preview(userId: string, body: WastePreviewRequest): Promise<WastePreviewDTO>;
WasteRequestsService:
  create(userId: string, idempotencyKey: string, body: WasteCreateRequest): Promise<WasteRequestDetailDTO>; // tx: lockWasteCustomer → replay check (same method + {itemId,declaredQty} set + pointId only for DROP_OFF) → validateAndHold(CREATE) → insert → REQUEST_CREATED event; P2002 on (userId,idempotencyKey) caught outside → re-read → replay/409
  edit(userId: string, id: string, body: WasteEditRequest): Promise<WasteRequestDetailDTO>;   // tx: lockWasteCustomer → FOR UPDATE (id,userId) → validateAndHold(EDIT) → replace lines → updateMany(userId,status OPEN,orderId null,trackingCode null) (never sets code/expiresAt/consentAt/capDayKey/capMonthKey; count≠1 → throw 409) → REQUEST_EDITED (before/after lines)
  setTracking(userId: string, id: string, body: WasteTrackingRequest): Promise<WasteRequestDetailDTO>; // tx: lockWasteTracking FIRST → FOR UPDATE own row → ...
  cancel(userId: string, id: string): Promise<WasteRequestDetailDTO>;  // replay when already CANCELLED by customer returns stored DTO, no event
  list(userId: string): Promise<WasteRequestSummaryDTO[]>; detail(userId: string, id: string): Promise<WasteRequestDetailDTO>; byOrder(userId: string, orderId: string): Promise<WasteRequestDetailDTO>;
// customer/waste-request.mapper.ts
export function toRequestSummary(row: WasteRequestWithPoint): WasteRequestSummaryDTO;
export function toRequestDetail(row: WasteRequestFull, pointAvailable: boolean): WasteRequestDetailDTO; // allow-list; never trackingConflict/trackingNorm/confirmedByUserId/reversedByUserId/carrierCostVnd/reversalShortfallPoints/idempotencyKey/capDayKey/capMonthKey
// customer/waste-fee.ts
export function estimateMailinFee(table: WasteFeeTable, province: { code: string; name: string }): WasteFeeEstimate; // echoes provinceCode/provinceName (province of the body or of the default address, §15.2)
```

### 4.8 Receiving, gifts, pickup services (M3, M4, M5)
```ts
// receiving/waste-quota.ts
export function incrementPointUsage(tx: Prisma.TransactionClient, pointId: string, monthKey: string, points: number, quota: number): Promise<number | null>; // pre-check points<=quota; §11.4 SQL; null = over quota; monthKey = vnMonthKey(now) at confirm (never the request's capMonthKey); uses the exact SQL text of `QUOTA_SQL` in `race/waste-db-constraints.race-spec.ts` (M1.2 Step 5b): spec 11.4 with `$3::int` and `$4::int`
export function pointUsage(db: Prisma.TransactionClient, pointId: string, monthKey: string): Promise<{ pointsUsed: number; confirmations: number }>; // callers pass vnMonthKey(new Date()) (reports of a past month pass that month, §17.2)
export function staffConfirmedToday(tx: Prisma.TransactionClient, staffUserId: string, now: Date): Promise<number>; // Σ pointsAwarded, confirmedByUserId, completedAt in VN day, status COMPLETED|REVERSED
// receiving/waste-confirm-lines.ts
export function validateConfirmLines(stored: ReadonlyArray<WasteStoredLine>, body: ReadonlyArray<WasteConfirmLineInput>): WasteValidatedLine[]; // mismatch → 409 'Khách vừa sửa yêu cầu, vui lòng tra lại mã'; hazardous → receivedQty must be 0 with WRONG_TYPE
// receiving/waste-match.ts
export type WasteMatchOutcome = { ok: true; basis: WasteMatchBasis } | { ok: false; reason: WasteUnmatchedReason; relatedRequestId?: string };
export function evaluateMatch(tx: Prisma.TransactionClient, req: { id: string; code: string; method: WasteMethod; trackingNorm: string | null; orderId: string | null }, match: WasteMatchInput | undefined): Promise<WasteMatchOutcome>;
// receiving/waste-confirm.service.ts
export interface WasteStaffCall { callerUserId: string; requestId: string; route: 'DESK' | 'ADMIN'; device: WasteDeviceMeta }
WasteConfirmService:
  confirm(call: WasteStaffCall, body: WasteConfirmRequest): Promise<WasteConfirmResultDTO>; // §15.5; DESK point = request.pointId; ADMIN route point = warehouse
  reject(call: WasteStaffCall, body: WasteRejectRequest): Promise<WasteRejectResultDTO>;
  closeLost(adminUserId: string, requestId: string, body: WasteCloseLostRequest): Promise<WasteRequestAdminDetailDTO>;
// receiving/waste-receive.service.ts
WasteReceiveService: receive(callerUserId: string, requestId: string, body: WasteReceiveRequest): Promise<WasteReceiveResultDTO>; createUnmatched(callerUserId: string, body: WasteUnmatchedCreateRequest): Promise<WasteUnmatchedDTO>; resolveUnmatched(callerUserId: string, id: string, body: WasteUnmatchedResolveRequest): Promise<WasteUnmatchedDTO>; listUnmatched(viewerUserId: string, q: { status?: WasteUnmatchedStatus }): Promise<WasteUnmatchedDTO[]>;
// resolveUnmatched: action MATCH on a row with reason 'TR_TRACKING_CONFLICT' requires assertActiveAdmin (STAFF → 403); CLOSE stays R(SA).
// receiving/waste-reverse.service.ts
WasteReverseService: reverse(adminUserId: string, requestId: string, body: WasteReverseRequest): Promise<WasteReverseResultDTO>;
// receiving/waste-admin-requests.service.ts
WasteAdminRequestsService: reopen(adminUserId, id, body: WasteReopenRequest): Promise<WasteRequestAdminDetailDTO>; queue(viewerUserId, q: AdminWasteRequestQuery) /* filter TRANSIT_OVERDUE|ORDER_MISMATCH or userId → assertActiveAdmin, else 403 (spec 15.4) */: Promise<{ rows: AdminWasteRequestRowDTO[]; nextCursor: string | null }>; lookup(viewerUserId, code: string): Promise<AdminWasteRequestRowDTO[]>; detail(viewerUserId, id): Promise<WasteRequestAdminDetailDTO>; setCost(adminUserId, id, body: WasteCostRequest): Promise<WasteRequestAdminDetailDTO>; getFlags(adminUserId: string, userId: string): Promise<WasteUserFlagsDTO>; setFlags(adminUserId, userId, body: WasteUserFlagsUpdateRequest): Promise<WasteUserFlagsDTO>;
// receiving/waste-desk.service.ts
WasteDeskService: points(userId): Promise<WasteDeskPointDTO[]>; lookup(userId, code: string): Promise<WasteDeskLookupDTO>; submitPerk(userId, pointId, body: WastePerkSubmitRequest): Promise<WasteDeskPointDTO>;
// api/modules/loyalty/loyalty-expiry.service.ts (M3.6)
export const recycleLotKey = (requestId: string): string => `RECYCLE:${requestId}`; // RECYCLE_RULE: lotKey refType 'RECYCLE' ∧ refId; reversedLotKey refType 'RECYCLE_REVERSED' ∧ refId (ORDER_RULE pattern)
// LoyaltyService (M4.1/M4.2)
getRewardCatalog(userId: string): Promise<RewardCatalogDTO>;
getMyRedemptions(userId: string): Promise<GiftRedemptionDTO[]>;
redeemReward(userId: string, rewardId: string, idempotencyKey: string): Promise<RedeemRewardResultDTO>; // 404 before config/tx; TREE → 400 'Quà góp quỹ trồng cây đổi bằng nút Góp cây ở Vườn Xanh.'; SEED_PACK/GIFT need isRealUser (403 REAL_USER_REQUIRED_MSG) before any write; hidden/sold out → 400 'Quà này đã hết hoặc đã ngừng đổi'; before the tx read `returnWindowDays()` and `waste.gift_claim_days` (TREE is rejected first, so `game.tree_points_price` is never read here, only by `getRewardCatalog`); replay (userId,key) after users FOR UPDATE: same giftId → stored result, no deduction; other giftId → 409; P2002 on (userId,idempotencyKey) caught outside tx → re-read → same rule
// catalog/*
WasteGiftRedemptionsService: fulfilAtDesk(callerUserId, body: WasteDeskGiftFulfilRequest): Promise<GiftRedemptionDTO>; fulfilById(callerUserId, id, body: { code: string }): Promise<GiftRedemptionDTO>; cancel(adminUserId, id, body: WasteGiftCancelRequest): Promise<GiftRedemptionDTO>; queue(viewerUserId, q: GiftRedemptionsQuery): Promise<AdminGiftRedemptionRowDTO[]>;
WasteAdminItemsService / WasteAdminPointsService / WasteAdminGiftsService: list/create/update/reorder (+ points: list(q: AdminWastePointQuery), addStaff, removeStaff (lock order §4.12 #19), approvePerk, rejectPerk) — DTOs §4.9; each write records exactly one event.
WasteReportsService: monthly(month: string /* YYYY-MM VN */, pointId?: string): Promise<WasteMonthlyReport>; overview(month: string): Promise<WasteOverviewDTO>; csv(month: string): Promise<string>; pointReport(callerUserId: string, pointId: string, month: string): Promise<WastePointMonthlyReportDTO>;
// pointReport = assertPointAccess + monthly(month, pointId) mapped to WastePointMonthlyReportDTO; GET /admin/waste/points/:id/report (R(A)) uses the same mapping without point access; overview, csv and both point reports share monthly() (spec 17.2)
export function computeWasteAlerts(db: PrismaService, now: Date, t: WasteAlertThresholds): Promise<WasteAlertDTO[]>; // catalog/waste-alerts.ts
// pickup/waste-pickup-attach.ts (no DI; used inside CheckoutService)
export function readPickupGate(config: Pick<SystemConfigService, 'get'> | undefined, gomdonEnabled: () => Promise<boolean>): Promise<boolean>; // pre-tx: waste.enabled ∧ waste.lane_pickup_enabled ∧ gomdon; undefined config → false
export interface LockedPickupRequest { id: string; code: string; lines: { itemName: string; unitLabel: string; declaredQty: number }[] }
export function lockPickupRequestForCheckout(tx: Prisma.TransactionClient, userId: string, wasteRequestId: string): Promise<LockedPickupRequest>; // FOR UPDATE where id,userId,method PICKUP,status OPEN,orderId NULL → else 409 'Yêu cầu thu rác đã hết hạn hoặc đã huỷ'; flags blockedAt/shipLockedAt → 409 'Thu kèm rác đang tạm dừng với tài khoản của bạn, hãy tắt công tắc để đặt đơn'
export function buildPickupRecyclingNote(req: LockedPickupRequest): string; // includes TR- code + "<item>: N <unit>" lines, no customer text
export function attachPickupRequest(tx: Prisma.TransactionClient, userId: string, requestId: string, orderId: string): Promise<void>; // updateMany (id,userId,PICKUP,OPEN,orderId NULL) set orderId, expiresAt NULL; count≠1 → 409 (same text); REQUEST_ATTACHED event actor CUSTOMER
// pickup/waste-pickup-hooks.service.ts
WastePickupHooks: onOrderCancelled(orderId: string): Promise<void>; onOrderDelivered(orderId: string): Promise<void>; // never throw; deliveredAt re-read from DB
// pickup/waste-expiry.cron.ts : WasteExpiryCron.run(now?: Date): Promise<{ expired: number }>; @Cron('0 30 3 * * *', { name: 'waste.expiry', timeZone: CRON_TZ }); try-lock hashtext('cron:waste.expiry')
// pickup/waste-pickup-sweep.cron.ts : WastePickupSweepCron.run(): Promise<{ cancelled: number; started: number; anomalies: number }>; @Cron('0 */5 * * * *', { name: 'waste.pickup-sweep', timeZone: CRON_TZ }); try-lock hashtext('cron:waste.pickup_sweep')
```
LOOKUP_MISS pointId (C11): desk lookup (M3.7a) = the caller's only point, else its first PARTNER point, else its first point; admin/warehouse request lookup (M3.8a) = the warehouse point id; desk gift fulfil (M4.3a) = body.pointId; gift fulfil by id (M4.3a) = the warehouse point id. With no ACTIVE warehouse, pointId is null. M4.7b counts misses by this pointId and ignores null.

### 4.9 `st/waste.ts` (M1.6) — exact exported names
Field-level definitions: where this section lists fields they are binding; for DTO names listed here without fields, `contract.md` section 7 is the field-level definition (M1.6 implements both; a lane that needs another field creates `st/waste-m<n>.ts` per rule R0).
Every field list below is M1.6 content (`st/waste.ts` is frozen after M1.6, R0); M2–M7 and the UI lanes read this one definition. `voucher.type` everywhere is the existing `CouponType` of `packages/shared-types/src/enums.ts` (not redeclared).
Unions: `WasteRequestStatus`, `WasteMethod`, `WasteItemStatus`, `WastePointKind`, `WastePointStatus`, `WastePointStaffRole`, `WasteShortfallReason`, `WasteRejectionReason`, `WasteCloseReason`, `WasteActorRole`, `WasteMatchBasis = 'TR_CODE'|'TRACKING_PHONE'|'MANUAL'|'ORDER'`, `WasteUnmatchedStatus`, `WasteUnmatchedReason = 'NO_MATCH'|'TRACKING_MULTI'|'TR_TRACKING_CONFLICT'|'EXPIRED_REQUEST'|'NOT_RECEIVABLE'|'MANUAL_ENTRY'`, `WasteGiftKind`, `WasteGiftStatus`, `WasteGiftRedemptionStatus`, `WasteEligibility = 'OK'|'GUEST'|'NEED_PHONE'`, `WasteWeekday = 'MON'|...|'SUN'`, `WastePreviewBlock = 'BELOW_MIN'|'MONTH_CAP_FOR_MIN'|'ITEM_MONTH_CAP'|'ITEM_DAY_CAP'|'POINTS_MONTH_CAP'|'POINT_QUOTA_FULL'|'POINT_UNAVAILABLE'|'ITEM_NOT_ACTIVE'|'POINT_MISSING_ITEMS'|'LANE_DISABLED'|'SHIP_LOCKED'|'MAX_OPEN'|'PICKUP_PENDING'|'NEED_PROVINCE'`, `WasteAlertKind = 'QUOTA_PACE'|'FULL_MATCH'|'FULL_MATCH_CONFIRMER'|'AVG_UNITS'|'AVG_UNITS_CONFIRMER'|'REPEAT_CUSTOMER'|'LOOKUP_MISS'|'STAFF_ACCOUNT_CONFIRMED'|'STAFF_DIRECT'`, `WasteRequestQueueFilter = 'TO_COUNT'|'EXPIRED'|'CUSTOMER_BLOCKED'|'ORDER_NOT_DELIVERED'|'TRANSIT_OVERDUE'|'ORDER_MISMATCH'`.
Each union has a sibling tuple `export const WASTE_<NAME>_VALUES = [...] as const` for the enum-equality test.
Config shapes: `WasteFeeTable { zones: { name: string; provinceCodes: string[]; low: number; high: number }[]; defaultZone: { name: string; low: number; high: number } }`, `WasteFeeEstimate { zoneName: string; provinceCode: string; provinceName: string; low: number; high: number }`, `WasteAlertThresholds` (11 keys §4.2), `WastePublicFlags`, `WasteOpeningHours = Partial<Record<WasteWeekday, { open: string; close: string }[]>>`, `WasteLaneFlags { dropoff: boolean; mailin: boolean; pickup: boolean }`, `WasteParcelLimits { maxWeightKg: number; maxEdgeCm: number }`.
Customer DTOs: `WasteLineInput {itemId; declaredQty}`, `WasteItemDTO {id; code; name; unitLabel; unitsPerPoint; pointsPerGroup; dropsPerUnit; dailyCapQty: number|null; monthlyCapQty: number|null; status: WasteItemStatus; prepInstructions: string|null; imageUrl: string|null; gramsPerUnit: number|null; hazardous; sortOrder}`, `WasteMeItemDTO extends WasteItemDTO {monthRemainingQty: number|null; dayRemainingQty: number|null}`, `WastePointDTO {id; kind; name; addressLine; provinceCode; provinceName; communeCode; communeName; lat; lng; phone; openingHours; acceptedItemIds: string[]; perkText: string|null; quotaFull: boolean; distanceKm: number|null}`, `WastePointContactDTO {id; kind; name; addressLine; communeName; provinceName; phone: string|null; openingHours: WasteOpeningHours}`, `WasteDeskPointRefDTO {id; name; kind}`, `WasteMeDTO {programmeEnabled; eligibility; blocked; shipLockedAt: string|null; laneFlags; parcelLimits; balance: {pointsBalance; pointsConvertedBalance; redeemablePoints}|null; monthUsage: {capMonthKey; pointsUsed; pointsCap}|null; impactGrams: number|null /* Σ receivedQty×gramsPerUnit over the caller's COMPLETED requests whose every line has gramsPerUnit; null when none qualify (spec 5.7) */; thresholds: {mailinMinPoints; pickupMinPoints; maxOpenRequests}; items: WasteMeItemDTO[]; openRequests: WasteRequestSummaryDTO[]; deskPoints: WasteDeskPointRefDTO[] /* from the role and staff rows only, whatever eligibility is (D9) */}`, `WasteNearbyRequest {provinceCode?; locationToken; zaloAccessToken}`, `WastePreviewRequest {lines; method?; pointId?; provinceCode?}`, `WastePreviewBlockDTO {code: WastePreviewBlock; itemId?; missingPoints?; openCount?; pickupRequestCode?; pointsRemaining?}`, `WastePreviewDTO {estimatedPoints; estimatedDrops; estimatedGrams: number|null; pointsValueVnd; blocks: WastePreviewBlockDTO[]; feeEstimate: WasteFeeEstimate|null; itemCaps: {itemId; monthRemainingQty: number|null; dayRemainingQty: number|null}[]; pointsMonthRemaining: number}`, `WasteCreateRequest {method; lines; pointId?; consent: true; packagingConsent?: boolean; postagePaidConsent?: boolean}`, `WasteEditRequest {lines; pointId?}`, `WasteTrackingRequest {carrier; trackingCode}`, `WasteRequestLineDTO {itemId; itemName; unitLabel; unitsPerPoint; pointsPerGroup; dropsPerUnit; gramsPerUnit: number|null; declaredQty; receivedQty: number|null; shortfallReason: WasteShortfallReason|null; pointsAwarded: number|null}`, `WasteRequestSummaryDTO {id; code; method; status; closeReason; createdAt; expiresAt; estimatedPoints; pointsAwarded; pointName; orderCode; lines: {itemName; unitLabel; declaredQty}[]}`, `WasteRequestDetailDTO extends Summary {lines: WasteRequestLineDTO[] /* narrows Summary.lines */; point: WastePointContactDTO|null; pointAvailable; carrier; trackingCode; inTransitAt; receivedAt; completedAt; closedAt; rejectionReason; rejectionNote; dropsAwarded; impactGrams: number|null /* only when status COMPLETED and every line has gramsPerUnit (spec 4.7, 5.7) */; reversedPoints: number|null; reversalReason: string|null; editable; cancellable; orderId}`, `WasteRulesDTO {text: string|null}`.
Rewards: `RewardItemDTO {id; kind; name; description; label; pointsCost; imageUrl; stockRemaining: number|null; soldOut; canRedeem; claimInstructions; voucher: WasteVoucherSpec|null; sortOrder}`, `WasteVoucherSpec {type: CouponType /* enums.ts */; value: number; minOrder: number|null; maxDiscount: number|null; validDays: number}` (also `AdminWasteGiftDTO.voucher`), `RewardCatalogDTO {pointsBalance; pointsConvertedBalance; lockedPoints; redeemablePoints; giftClaimDays: number; claimPoint: {name; addressLine; communeName; provinceName; openingHours: WasteOpeningHours} | null /* the ACTIVE WAREHOUSE; null if none */; rewards: RewardItemDTO[]}`, `GiftRedemptionDTO {id; giftId; giftKind; giftName; pointsCost; status; code: string|null; claimExpiresAt; claimPoint: {name; addressLine; communeName; provinceName; openingHours: WasteOpeningHours} | null /* READY only */; fulfilledAt; cancelledAt; cancelReason; refundedPoints; couponCode: string|null; createdAt}`, `RedeemRewardResultDTO {success: true; message; pointsSpent; remainingPoints; redemption: GiftRedemptionDTO; coupon: {code; type; value; minOrder; maxDiscount; endAt}|null}`.
Desk: `WasteDeskPointDTO {id; kind; name; giftHandoverEnabled; myRole; quota: {limit; used; remaining}|null; perkText; perkPendingText; staffDailyCapRemaining}`, `WasteDeskLookupRequest {code}`, `WasteDeskRequestDTO {id; code; method; status; pointId; customerName; customerPhone; estimatedPoints; lines: {itemId; itemName; unitLabel; unitsPerPoint; pointsPerGroup; declaredQty; receivedQty; hazardous}[]}`, `WasteDeskGiftDTO {id; giftName; customerName; status; claimExpiresAt}`, `WasteDeskLookupDTO = {type: 'REQUEST'; request: WasteDeskRequestDTO} | {type: 'GIFT'; redemption: WasteDeskGiftDTO}`, `WasteMatchInput {parcelCode?; phoneMatchConfirmed?; parcelTracking?}`, `WasteConfirmLineInput {itemId; declaredQty; receivedQty; shortfallReason?}`, `WasteConfirmRequest {lines; receivedWeightGrams?; match?}`, `WasteRejectRequest {rejectionReason; rejectionNote?; match?}`, `WasteConfirmResultDTO {requestId; code; status: 'COMPLETED'; pointsAwarded; dropsAwarded; quota: {limit; used; remaining}|null; staffDailyCapRemaining}`, `WasteRejectResultDTO {requestId; code; status: 'REJECTED'}`, `WasteDeskGiftFulfilRequest {code; pointId}`, `WastePerkSubmitRequest {perkText}`, `WastePointMonthlyReportDTO {pointId; month; confirmations; pointsAwarded; quotaUsed; units: {itemId; itemName; unitLabel; qty}[]}`.
receivedWeightGrams everywhere: integer 1..100000, excluded from the confirm replay comparison (spec 15.3); carrierCostVnd: integer ≥ 0.
Admin: `AdminWasteItemDTO`, `WasteItemUpsertRequest`, `AdminWastePointDTO extends WastePointDTO {status; monthlyQuotaPoints: number|null; monthUsage: {monthKey; pointsUsed; confirmations}; quotaFull: boolean; perkPendingText: string|null; giftHandoverEnabled; note: string|null; sortOrder; activatedAt: string|null; lastConfirmedAt: string|null; hiddenInactive: boolean; staff: WastePointStaffDTO[]}`, `AdminWastePointQuery {status?: WastePointStatus; perkPending?: boolean}`, `WastePointUpsertRequest`, `WastePointStaffDTO`, `WastePointStaffAddRequest {userId; role}`, `AdminWasteRequestQuery {method?; status?; filter?: WasteRequestQueueFilter; userId?; pointId? /* with status 'COMPLETED' = per-point credit log */; cursor?; limit?}`, `AdminWasteRequestRowDTO`, `WasteRequestAdminDetailDTO` (+`events?: AdminWasteEventDTO[]` admin only), `AdminWasteEventDTO`, `WasteReceiveRequest {match?; receivedWeightGrams?}`, `WasteReceiveResultDTO = {outcome: 'RECEIVED'; requestId; receivedAt} | {outcome: 'ALREADY_RECEIVED'; receivedAt} | {outcome: 'UNMATCHED'; unmatchedId; reason: WasteUnmatchedReason}`, `WasteUnmatchedDTO`, `WasteUnmatchedCreateRequest {carrier?; trackingCode?; description}`, `WasteUnmatchedResolveRequest = {action: 'MATCH'; requestId; note} | {action: 'CLOSE'; note}`, `WasteReverseRequest {reason}`, `WasteReverseResultDTO {requestId; status: 'REVERSED'; pointsTaken; shortfallPoints}`, `WasteCostRequest {carrierCostVnd?; receivedWeightGrams?}`, `WasteCloseLostRequest {reason}`, `WasteReopenRequest {reason; unmatchedId?}`, `WasteUserFlagsDTO`, `WasteUserFlagsUpdateRequest {shipLocked?; blocked?; reason}`, `AdminWasteGiftDTO {id; kind; name; description; label; pointsCost; status; sortOrder; imageUrl; stock: number|null; claimInstructions; voucher: {type; value; minOrder: number|null; maxDiscount: number|null; validDays}|null; redemptionCount: number /* TREE: distinct GAME_BUY_TREE: reasons */; fundTreeTotal?: number /* TREE only, planted_trees count */}`, `WasteGiftUpsertRequest`, `GiftRedemptionsQuery {status?; overdue?}`, `AdminGiftRedemptionRowDTO {id; giftId; giftKind; giftName; pointsCost; status; codeLast2: string|null; code?: string|null /* ADMIN only */; customerName; customerPhone /* masked unless ADMIN */; userId?: string /* ADMIN only */; claimExpiresAt; overdue: boolean; createdAt}` (spec 15.4: STAFF never receives the full `QG-` code, only its last 2 characters), `WasteGiftCancelRequest {reason; refundPoints?}`, `WasteReorderRequest {ids: string[]}`, `WasteMonthMetrics {requestsCreatedByMethod: Record<WasteMethod, number>; requestsByStatus: Record<WasteRequestStatus, number>; completeHoursP50: number|null; completeHoursP90: number|null; unitsByItem: {itemId; itemName; unitLabel; qty}[]; unitsByPoint: {pointId; pointName; qty}[]; pointsIssued; pointsReversed; receivedDeclaredPctByMethod: Record<WasteMethod, number|null>; receivedDeclaredPctByPoint: {pointId; pct: number|null}[]; rejectionsByReason: Record<WasteRejectionReason, number>; expiredCount; quotaByPoint: {pointId; pointName; quota: number|null; used; confirmations}[]; pickupCount; carrierCostVnd; receivedWeightGrams: number|null; estimatedWeightGrams: number|null; repeatCustomers60d; ordersOfExchangers; ordersOfNonExchangers; costVndPer1000PointsIssued: number|null /* Math.round(carrierCostVnd * 1000 / pointsIssued), null when pointsIssued is 0 */}`, `WasteAlertDTO {kind; pointId?; pointName?; confirmerName?; value; threshold; detail}`, `WasteOverviewDTO {month; previousMonth; current: WasteMonthMetrics; previous: WasteMonthMetrics; alerts: WasteAlertDTO[]}`.
API controllers declare class-validator DTO classes in the controller file that `implements` these interfaces (patch-null rule); shared-types stays type-only plus the `*_VALUES` tuples.
Leaf types (binding, copied verbatim from contract.md section 7 "Leaf types"; M1.6 Step 3 writes exactly these). Key points: `staffDailyCapRemaining: number` (never null, the warehouse included, D7), `WasteMatchInput.parcelTracking?: string` (the carrier tracking code read on the parcel, optional; spec 15.4 "mã vận đơn lệch chỉ ghi nhật ký": M3.4a logs `parcelTrackingNorm` and `trackingMismatch` in the `PARCEL_RECEIVED` meta, the M7.5a receive form is the only sender, a mismatch never blocks the receive), `WasteAlertDTO.threshold: number | null` (null for STAFF_ACCOUNT_CONFIRMED), coupon `minOrder`/`maxDiscount: number | null`, `endAt: string`.
```ts
export interface WastePublicFlags { enabled: boolean; dropoff: boolean; mailin: boolean; pickup: boolean }
export interface WasteAlertThresholds { quotaPacePct: number; quotaPaceDays: number; fullMatchPct: number; fullMatchMinSample: number; repeatCustomerCount: number; repeatCustomerDays: number; avgUnitsFactor: number; lookupMissCount: number; lookupMissDays: number; staffDirectCount: number; staffDirectDays: number }
export interface WasteLineInput { itemId: string; declaredQty: number }
export interface WasteDeskPointRefDTO { id: string; name: string; kind: WastePointKind }
export interface WasteNearbyRequest { provinceCode?: string; locationToken: string; zaloAccessToken: string }
export interface WastePreviewRequest { lines: WasteLineInput[]; method?: WasteMethod; pointId?: string; provinceCode?: string }
export interface WastePreviewBlockDTO { code: WastePreviewBlock; itemId?: string; missingPoints?: number; openCount?: number; pickupRequestCode?: string; pointsRemaining?: number }
export interface WastePreviewDTO { estimatedPoints: number; estimatedDrops: number; estimatedGrams: number | null; pointsValueVnd: number; blocks: WastePreviewBlockDTO[]; feeEstimate: WasteFeeEstimate | null; itemCaps: { itemId: string; monthRemainingQty: number | null; dayRemainingQty: number | null }[]; pointsMonthRemaining: number }
export interface WasteCreateRequest { method: WasteMethod; lines: WasteLineInput[]; pointId?: string; consent: true; packagingConsent?: boolean; postagePaidConsent?: boolean }
export interface WasteEditRequest { lines: WasteLineInput[]; pointId?: string }
export interface WasteTrackingRequest { carrier: string; trackingCode: string }
export interface RedeemRewardResultDTO { success: true; message: string; pointsSpent: number; remainingPoints: number; redemption: GiftRedemptionDTO; coupon: { code: string; type: CouponType; value: number; minOrder: number | null; maxDiscount: number | null; endAt: string } | null }
export interface WasteDeskPointDTO { id: string; kind: WastePointKind; name: string; giftHandoverEnabled: boolean; myRole: WastePointStaffRole; quota: { limit: number; used: number; remaining: number } | null; perkText: string | null; perkPendingText: string | null; staffDailyCapRemaining: number }
export interface WasteDeskLookupRequest { code: string }
export interface WasteDeskRequestDTO { id: string; code: string; method: WasteMethod; status: WasteRequestStatus; pointId: string; customerName: string; customerPhone: string | null; estimatedPoints: number; lines: { itemId: string; itemName: string; unitLabel: string; unitsPerPoint: number; pointsPerGroup: number; declaredQty: number; receivedQty: number | null; hazardous: boolean }[] }
export interface WasteDeskGiftDTO { id: string; giftName: string; customerName: string; status: WasteGiftRedemptionStatus; claimExpiresAt: string | null }
export type WasteDeskLookupDTO = { type: 'REQUEST'; request: WasteDeskRequestDTO } | { type: 'GIFT'; redemption: WasteDeskGiftDTO };
export interface WasteMatchInput { parcelCode?: string; phoneMatchConfirmed?: boolean; parcelTracking?: string }
export interface WasteConfirmLineInput { itemId: string; declaredQty: number; receivedQty: number; shortfallReason?: WasteShortfallReason }
export interface WasteConfirmRequest { lines: WasteConfirmLineInput[]; receivedWeightGrams?: number; match?: WasteMatchInput }
export interface WasteRejectRequest { rejectionReason: WasteRejectionReason; rejectionNote?: string; match?: WasteMatchInput }
export interface WasteConfirmResultDTO { requestId: string; code: string; status: 'COMPLETED'; pointsAwarded: number; dropsAwarded: number; quota: { limit: number; used: number; remaining: number } | null; staffDailyCapRemaining: number }
export interface WasteRejectResultDTO { requestId: string; code: string; status: 'REJECTED' }
export interface WasteDeskGiftFulfilRequest { code: string; pointId: string }
export interface WastePerkSubmitRequest { perkText: string }
export interface WastePointMonthlyReportDTO { pointId: string; month: string; confirmations: number; pointsAwarded: number; quotaUsed: number; units: { itemId: string; itemName: string; unitLabel: string; qty: number }[] }
export interface WastePointStaffAddRequest { userId: string; role: WastePointStaffRole }
export interface WasteReceiveRequest { match?: WasteMatchInput; receivedWeightGrams?: number }
export type WasteReceiveResultDTO = { outcome: 'RECEIVED'; requestId: string; receivedAt: string } | { outcome: 'ALREADY_RECEIVED'; receivedAt: string } | { outcome: 'UNMATCHED'; unmatchedId: string; reason: WasteUnmatchedReason };
export interface WasteUnmatchedCreateRequest { carrier?: string; trackingCode?: string; description: string }
export type WasteUnmatchedResolveRequest = { action: 'MATCH'; requestId: string; note: string } | { action: 'CLOSE'; note: string };
export interface WasteReverseRequest { reason: string }
export interface WasteReverseResultDTO { requestId: string; status: 'REVERSED'; pointsTaken: number; shortfallPoints: number }
export interface WasteCostRequest { carrierCostVnd?: number; receivedWeightGrams?: number }
export interface WasteCloseLostRequest { reason: string }
export interface WasteReopenRequest { reason: string; unmatchedId?: string }
export interface WasteGiftCancelRequest { reason: string; refundPoints?: boolean }
export interface WasteReorderRequest { ids: string[] }
export interface WasteAlertDTO { kind: WasteAlertKind; pointId?: string; pointName?: string; confirmerName?: string; value: number; threshold: number | null; detail: string }
export interface WasteOverviewDTO { month: string; previousMonth: string; current: WasteMonthMetrics; previous: WasteMonthMetrics; alerts: WasteAlertDTO[] }
```

### 4.10 Race fixtures (M1.2) `race/fixtures/waste-fixtures.ts`
`createWasteItem(prisma, over?)`, `createWastePoint(prisma, { kind, ownerUserId?, quota?, itemIds? })` (PARTNER creates the owner staff row and reuses the owner's existing storefront (`prisma.storefront.findFirst({ where: { ownerUserId } })`, because `storefronts_ownerUserId_key` allows one store per owner); a reused owner storefront that is neither `type: 'MERCHANT'` nor `isPartner: true` is updated with `isPartner: true`; only when none exists it creates one inline: `prisma.storefront.create({ data: { type: 'MERCHANT', isPartner: true, slug: 'wx-<tag>', subdomain: 'wx-<tag>', ownerUserId, title, isPublished: true } })`, copied from `n2b-harness.ts:71-74` (the `prisma.storefront.create` call); returns the point plus `ownerStorefrontId` and `createdStorefront: boolean` (true only when the call created the store)), `createWarehouse(prisma)` (idempotent: one per DB), `createWasteRequest(prisma, { userId, method, status, pointId, lines, orderId?, capMonthKey?, expiresAt?, estimatedPoints? })` (`estimatedPoints` = the override when given, else Σ `Math.floor(declaredQty / unitsPerPoint) * pointsPerGroup` over the lines (4.3 `linePoints`); `estimatedDrops` = Σ `declaredQty * dropsPerUnit` (4.3 `lineDrops`); never the declared quantity sum), `createGiftRedemption(prisma, {...})`, `createWasteGift(prisma, over?)`, `cleanupWaste(prisma, { pointIds?, itemIds?, giftIds?, storefrontIds? })` (pass only storefronts the fixture created: it sets `ownerUserId: null` on them and deletes them; suites call it before `deleteItData`). All waste race specs import only these, the order helpers below and `helpers.ts`.
Every waste race spec that changes a `waste.*` config row, a seeded item or a seeded gift restores the original in afterAll (n2b-harness savedConfig pattern).
Config cache (GR1): `SystemConfigService` caches each key 60 s per instance (`system-config.service.ts:42` `private cache`). A test that writes a config row (`helpers.ts` `setConfig`, raw upsert) after the Nest module compiled then runs `(moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.clear();` (precedent `pf6-spin-prize-guard.race-spec.ts:49`), restores the row in `finally` or `afterAll` and clears again; in `beforeAll` it writes config before the first service call. Never `SystemConfigService.set` in tests (it writes config history rows and needs an actor, :420-468).
Forced interleaving (GR2): M1.2 also adds these helpers to `race/fixtures/waste-fixtures.ts`, bodies adapted from `race/checkout-reversal-lock-order.race-spec.ts:143-196`:
```ts
export function holdLock(prisma: PrismaClient, lockSql: Prisma.Sql): Promise<{ pid: number; release: () => void; done: Promise<void> }>; // side $transaction (timeout 30_000) runs tx.$executeRaw(lockSql) (row SELECT ... FOR UPDATE / FOR NO KEY UPDATE, or SELECT pg_advisory_xact_lock(...); never $queryRaw), reads SELECT pg_backend_pid()::int AS pid, resolves, then awaits the release gate
export function lockWaiters(prisma: PrismaClient, holderPid: number): Promise<number>; // backends transitively blocked by holderPid (recursive pg_blocking_pids CTE)
export function waitUntil(cond: () => Promise<boolean> | boolean, what: string, tries?: number /* default 200 */): Promise<void>; // poll every 25 ms, at most tries times, then throw new Error('timeout waiting for ' + what)
export function blockedBackends(prisma: PrismaClient): Promise<number>; // SELECT count(*)::int AS "n" FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND cardinality(pg_blocking_pids(pid)) > 0
export function raceWithHold<A, B>(prisma: PrismaClient, lockSql: Prisma.Sql, first: () => Promise<A>, second: () => Promise<B>): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]>; // holdLock; start first; waitUntil(lockWaiters >= 1); start second; waitUntil(lockWaiters >= 2); release; await done; allSettled
export function holdFirstCall<T extends object, K extends keyof T>(obj: T, method: K): { reached: Promise<void>; release: () => void; restore: () => void }; // jest.spyOn(obj, method).mockImplementationOnce: resolves reached, awaits the gate, then calls the original
```
A case that asserts an order ("B waits for A", "second sees first's write", both orders) uses `raceWithHold` (only when both contenders really queue on the held lock) or `holdFirstCall` (then `await h.reached`, start B with a settled flag, `await waitUntil(async () => bSettled || (await blockedBackends(prisma)) >= 1, 'B queued behind A')`, then `h.release()`); never a sleep, `runInOrder` or "start B N ms later". `barrierOnFirstCalls` (`helpers.ts:151-177`) stays only for "all N pre-checks read before any write". Every case also asserts `expect(errors.join()).not.toMatch(/40P01|P2034/)`. M1.2 proves the helpers on the real DB in `race/waste-order-helpers.race-spec.ts` (advisory-lock queue of two `$executeRaw` contenders finishing in start order; the same on a `users` row FOR UPDATE; holdFirstCall with blockedBackends >= 1; waitUntil with `tries = 2` throwing 'timeout waiting for <what>'). The shared helpers replace every file-local copy: a race spec that imports a name and also declares it fails with TS2440 under ts-jest; the M2 preamble, M5.2b and M8.8a drop their local holdLock/lockWaiters/waitUntil/inOrder/holdRowForUpdate/holdAdvisory/raceCheckoutWith.
Tagged-template reads (GR3): a unit test that inspects a `$queryRaw`/`$executeRaw` tagged-template call reads it as `const [strings, ...values] = mock.calls[i] as [TemplateStringsArray, ...unknown[]]; const sql = strings.join('?');` and asserts on `sql` and on `values`, never on `String(mock.calls[i][0])`; a fake tx that implements raw SQL first throws when called outside a transaction context.
Post-commit order (GR9): effects the spec puts after commit (notifier, `shipLock.evaluateAndLock`, hooks, queue emits) are asserted after commit: the `$transaction` mock runs the callback then pushes `'tx end'` to a shared `order: string[]`; each post-commit mock pushes its own name; the test asserts `order.indexOf('tx end') < order.indexOf('<effect>')`.

### 4.11 Client function names
Mini app `mini/services/waste-api.ts`: `getWasteMe, getWasteItems, getWastePoints(provinceCode?), getNearbyWastePoints(body), previewWaste(body), createWasteRequest(body, idempotencyKey), editWasteRequest(id, body), setWasteTracking(id, body), cancelWasteRequest(id), listWasteRequests(), getWasteRequest(id), getWasteRequestByOrder(orderId), getWasteRules(), getDeskPoints(), deskLookup(code), deskConfirm(id, body), deskReject(id, body), deskFulfilGift(body), getDeskPointReport(pointId, month), submitDeskPerk(pointId, body)`. Query keys: `['waste','me']`, `['waste','items']`, `['waste','points',province]`, `['waste','requests']`, `['waste','request',id]`, `['waste','desk']`, `['loyalty-rewards']`, `['loyalty-rewards','mine']`. `mini/services/account-api.ts`: `getLoyaltyRewards()` → `RewardCatalogDTO`, `redeemLoyaltyReward(rewardId, idempotencyKey)`, `getMyRedemptions()`. `mini/hooks/use-idempotency-key.ts`: `useIdempotencyKey(content: unknown): { key: string; rotate(): void }` (stable while JSON of content unchanged; kept on network error).
Web `web/lib/admin-client.ts`: `getWasteOverview, downloadWasteMonthlyCsv, listWasteItems, createWasteItem, updateWasteItem, reorderWasteItems, listWastePoints(q?: AdminWastePointQuery), getWastePointReport(id, month), createWastePoint, updateWastePoint, reorderWastePoints, addWastePointStaff, removeWastePointStaff, approveWastePerk, rejectWastePerk, listWasteRequests, lookupWasteRequests, getWasteRequest, receiveWasteRequest, confirmWasteRequest, rejectWasteRequest, reverseWasteRequest, setWasteRequestCost, closeLostWasteRequest, reopenWasteRequest, listWasteUnmatched, createWasteUnmatched, resolveWasteUnmatched, getWasteUserFlags, setWasteUserFlags, listWasteGifts, createWasteGift, updateWasteGift, reorderWasteGifts, listGiftRedemptions, fulfilGiftRedemption, cancelGiftRedemption`.

### 4.12 Lock order per transaction (§10.1 restated; "→" = acquired after)
1. Confirm (M3.2): (1) `waste_requests` row FOR UPDATE → (2) `lockWasteStaffCap(caller)` → (3) `waste_point_usage` row via upsert [PARTNER ∧ points>0] → (4) `users` row (grant/applyPointsDelta) → (5) game profile row (upsert then SELECT … FOR UPDATE) → (6) `waste_points` row (UPDATE lastConfirmedAt) → event insert.
2. Reject / close-lost (M3.3): request row FOR UPDATE → updateMany → event.
3. Reverse (M3.6): request row FOR UPDATE → `users` FOR UPDATE (read `pointsBalance`) → `recoverable = lotRecoverable(await loadPointExpiryTxns(tx, userId), recycleLotKey(requestId)) ?? pointsAwarded`, `take = min(pointsAwarded, recoverable, max(0, pointsBalance))` → updateMany COMPLETED→REVERSED (count must be 1) → if `take > 0` negative ledger row via `applyPointsDelta` (error contract (b) below) else no ledger row → `reversalShortfallPoints = pointsAwarded − take` → event.
4. Create (M2.8): `lockWasteCustomer(user)` → replay read → validateAndHold reads → insert request (FK KEY SHARE users, points) + lines (KEY SHARE items) → event.
5. Edit (M2.8): `lockWasteCustomer` → request row FOR UPDATE → validateAndHold → lines delete/insert → updateMany → event.
6. Reopen (M3.5): `lockWasteCustomer(request.userId)` (read userId first without lock, re-check after FOR UPDATE) → request row FOR UPDATE → validateAndHold(REOPEN) → updateMany EXPIRED→RECEIVED → unmatched updateMany OPEN→RESOLVED (if unmatchedId) → event.
7. Tracking (M2.9): `lockWasteTracking()` → own request row FOR UPDATE → updateMany own → updateMany `trackingConflict` on other unclosed rows with same trackingNorm → event.
8. Customer cancel (M2.9): request row FOR UPDATE (id,userId) → updateMany → event.
9. Receive (M3.4): request row FOR UPDATE → order read (no lock) → evaluateMatch → updateMany → PARCEL_RECEIVED event (same tx). Unmatched write = separate tx AFTER the first ends: request row FOR UPDATE (when :id) → recent PARCEL_UNMATCHED check → insert unmatched → event.
10. Resolve (M3.4): request row FOR UPDATE → order read → updateMany request → updateMany unmatched → event.
11. Gift redeem (M4.2): `users` FOR UPDATE → replay lookup `(userId, idempotencyKey)` → `lockedOrderPoints` → `waste_gifts` conditional stock UPDATE → points updateMany guard → coupon create (VOUCHER) → redemption insert → ledger insert.
12. Gift cancel (M4.3): redemption updateMany READY→CANCELLED (row lock) → `users` (grant, only if refund) → `waste_gifts` stock +1 → event.
13. Gift fulfil (M4.3): single redemption updateMany → event.
14. Checkout attach (M5.2): `lockForCheckout` (cart) + the existing `CartChangedError` throw → `lockPickupRequestForCheckout` (request row FOR UPDATE + flags read) → variants (`assertVariationsSellable`, `lockVariationsInIdOrder`) → flash (`consumeFlashQuotas`) → partner-store KEY SHARE (`assertPartnerStoresUnderLock`) → `order.create` → `attachPickupRequest` (same row) → REQUEST_ATTACHED event → `users` FOR UPDATE (points) → first-order lock (`assertFirstOrderInTx`: `pg_advisory_xact_lock(hashtext('first-order'), hashtext(userId))`, taken when the order waives the first-order shipping fee (`checkout.service.ts`) and again inside `coupons.redeem` when the coupon is `newCustomerOnly` (`coupons.service.ts`), always before the coupon two-key lock; the second call in the same transaction re-enters the lock) → coupons two-key lock.
15. Hooks/sweep/expiry (M5.3–M5.5): per request one short tx (conditional updateMany + event); no other locks. Sweep/expiry outer tx holds only `pg_try_advisory_xact_lock(hashtext('cron:…'))`.
16. Ship lock (M2.5): step 1 tx flags createMany → flags row `SELECT 1 FROM waste_user_flags WHERE "userId" = $1 FOR UPDATE` → `shouldLock(tx, …)` re-check (false: return not locked, no event, no notify, no step 2) → flags updateMany → event; step 2 per-row autocommit updateMany + event; never in the caller's tx.
17. Point create (M4.6): `lockWastePointCreate()` → count (≤200) → insert.
18. Merge (M2.10): existing advisory + guest rows + both `users` rows FOR UPDATE → waste rows (rename dup idempotency keys `MERGED:<guestId>:<key>` set-based first, then move).
19. Point staff add/remove (M4.6): `SELECT … FROM waste_points WHERE id = $1 FOR NO KEY UPDATE` (compatible with confirm's FK KEY SHARE) → count active staff (≤5) and OWNER rows → insert/update `waste_point_staff` → event. An OWNER P2002 on `waste_point_staff_one_owner_key` is caught outside the tx → 409 with a Vietnamese sentence.
20. Reorder (M4.4 gifts, M4.5 items, M4.6 points): first statement in the transaction locks every row of the table in one global order, `SELECT "id" FROM "<table>" ORDER BY "id" FOR UPDATE` (`waste_gifts`, `waste_items`; `waste_points` uses `FOR NO KEY UPDATE`, compatible with the FK `KEY SHARE` of confirm and request inserts) → `sortOrder` updates in body order → one `*_REORDERED` event.
Error contract for ledger writes (all money tasks, binding): (a) `grant(...)` returning `false` inside confirm (item 1) or gift cancel (item 12) → `throw new InternalServerErrorException(...)` + `logger.error` (rolls back usage, status, drops, stock); (b) reverse (item 3) writes the negative row with `applyPointsDelta(tx, { userId: req.userId, delta: -take, lot: 'STANDARD', reason: 'RECYCLE_REVERSED:<code>', refType: 'RECYCLE_REVERSED', refId: requestId })` and throws if `!applied`; a P2002 escaping the reverse tx is caught in `WasteReverseService.reverse` outside the tx and rethrown as `InternalServerErrorException` (never left to `PrismaExceptionFilter`, which maps P2002 → 409); (c) confirm's outside-tx P2002 handler (re-read → stored result or 409 `Vui lòng thử lại`) lives in `WasteConfirmService.confirm`.

### 4.13 Pinned messages and status codes (shared across tasks)
- Programme off (FULL gate, desk PARTNER, DROP_OFF confirm): 403 `Tính năng Đổi rác lấy quà đang tắt. Liên hệ quản trị viên.`
- Guest: 403 `REAL_USER_REQUIRED_MSG`; no phone: 403 `Bạn cần chia sẻ số điện thoại để dùng Đổi rác lấy quà.`; blocked: 403 `Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree.`
- Ship-locked create/edit MAIL_IN|PICKUP: 403 `Đường gửi kho và thu kèm đơn đang tạm dừng với tài khoản của bạn, liên hệ CSKH.`
- Point unavailable: 409 `Điểm nhận đang tạm ngừng, hãy chọn điểm khác`; item not ACTIVE: 409 `Món này hiện chưa nhận, hãy bỏ khỏi danh sách`; tracking on non-MAIL_IN: 409 `Yêu cầu này không dùng mã vận đơn`; lookup miss / foreign request: 404 `Không tìm thấy mã`; staff cap: 409 `Bạn đã chạm trần điểm xác nhận hôm nay`; quota: 409 `Điểm đã hết hạn mức tháng, còn N điểm` (N = `formatPoints(remaining)` of `common/format-points.ts`); customer blocked at confirm: 409 `Khách đang bị khoá, không cộng điểm được` (STAFF/ADMIN) / `Yêu cầu này đang chờ Tubu xử lý, chưa xác nhận được tại điểm` (POINT_STAFF); self/same phone/colleague: 403 `Bạn không thể xác nhận yêu cầu này`; lines changed: 409 `Khách vừa sửa yêu cầu, vui lòng tra lại mã`; P2002 after confirm not completed: 409 `Vui lòng thử lại`; not owner: 404 (same as missing id). Other caps/threshold violations: 409 with a full Vietnamese sentence chosen by M2.4.

### 4.14 Shared commands (node environment, DB gate A, DB gate B, folder-order proof, lint, race specs, lane databases, full gate, Playwright scope)

All commands run from the repository root of your worktree unless a `cd` is shown. Node 22 is required (Node 20 gives unrelated jsdom failures).

Node environment (export in every new shell before any command below):

```
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
export DATABASE_URL="postgresql://tubu:tubu@localhost:<lane port>/tubutree_it?schema=public"
# <lane container> and <lane port>: your lane's race database (Lane databases below). Never use tubu_it_main or port 5550: they belong to another session.
```

Workspace build (once per worktree after `pnpm install`, and again after any change under `packages/shared-types/src`): `pnpm --filter @tubutree/shared-types build` (exit 0; `packages/shared-types/dist/index.d.ts` exists). `pnpm --filter @tubutree/api typecheck` resolves `@tubutree/shared-types` through `dist` and fails with TS2307 until it has run; jest maps the package to `src`, so a missing build shows only at the typecheck.

DB gate A (fresh race database, applies every migration including the waste one):

```
docker ps --filter name=<lane container> --format '{{.Names}}'
# must print <lane container>. If it prints nothing, start the container, then rerun pg_isready until it says "accepting connections":
docker run -d --rm --name <lane container> --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p <lane port>:5432 postgres:16-alpine
docker exec <lane container> pg_isready -U tubu
docker exec <lane container> psql -U tubu -d postgres -c "DROP DATABASE IF EXISTS tubutree_it WITH (FORCE)" -c "CREATE DATABASE tubutree_it"
cd apps/api && npx prisma migrate deploy
```

Expected last line of the deploy: `All migrations have been successfully applied.` Never use `pkill`; never stop a container you did not start.

DB gate B (drift and partial-index check, run after gate A):

```
cd apps/api && npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
cd apps/api && npx tsx prisma/check-partial-indexes.ts
```

Expected: the first exits 0 (exit 2 means drift), the second exits 0 and lists no missing index.

Migration folder-order proof (M1.1 Step 4a, and again before M8.2). Run from the repository root (the `git ls-tree` path is relative to the current directory):

```
for b in $(git for-each-ref --format='%(refname:short)' refs/heads); do git ls-tree --name-only $b apps/api/prisma/migrations/; done | xargs -n1 basename | grep -E '^[0-9]{14}_' | sort | tail -1
ls -d /Users/longla/coding/tubutree-mini-app/.claude/worktrees/*/apps/api/prisma/migrations/*/ | xargs -n1 basename | sort | tail -1
```

Expected: both print a folder name that sorts before `20261020000000_waste_exchange`. On 2026-10-18 both printed `20261019120000_merchant_link_prev_rate` (branch `lr2/commission`, merged into the base); re-run the proof, the value changes as other branches land. The `grep` drops `migration_lock.toml`, which sorts after every timestamp; the second command uses an absolute path because a worker runs inside its own worktree.

Lint (what `docs/2026-10-review/handoff/verify-full.sh` runs; the `lint` scripts in the `package.json` files do not enforce zero warnings):

```
cd apps/api && npx eslint src --max-warnings=0
cd apps/miniapp && npx eslint "src/**/*.{ts,tsx}" --max-warnings=0
cd apps/web && npx eslint src --max-warnings=0
```

Expected: exit 0.

Race specs run in a lane only with `cd apps/api && npx jest -c test/integration-race/jest.config.js --runInBand <name pattern>`, after DB gate A; `ci.yml` does not run them (`.github/workflows/race.yml` runs the whole suite, after `prisma migrate deploy` and the drift check, on a PR into main that touches `apps/api/**`, `packages/shared-types/**` or `pnpm-lock.yaml`, nightly and by hand, so it first sees them when the branch becomes a PR) and `tsc` does not check them (`apps/api/tsconfig.json` excludes `test`).

Commits: the harness adds the `Co-Authored-By` trailer. Commits stay local; never push.

Parts cite these blocks by name ("registry 4.14 DB gate A", "registry 4.14 Lint", ...).

Lane databases. When several lanes run at once each lane uses its own race container, so two lanes never share one database: name `tubu_it_rr_<lane>` and the host port of this table: L1 5581 (`tubu_it_rr_L1`, lane L1a; L1b and L1c need none), L2 5582 (`tubu_it_rr_L2`, L2-core then L2-cust, never at the same time), L3 5583, L4 5584, L5 5585, L8 5586, the integration worktree `tubu_it_rr_int` 5587; L6 and L7 need none. Other sessions of the owner may run `tubu_it_main` on 5550 and `lr-*` containers on 55xx ports, so a lane never uses those names or ports. The container and port of a lane come from the worker's context line (the dispatcher creates and starts the lane's container): substitute the name for `<lane container>` and the port for `<lane port>` in every DB gate A/B command and in `DATABASE_URL` (for example `docker exec tubu_it_rr_L3 pg_isready -U tubu` and `postgresql://tubu:tubu@localhost:5583/tubutree_it?schema=public`); the URL must still match `/tubutree_it(\?|$)/`. Never stop or recreate a container you did not start.

Full gate (`verify-full.sh`). `docs/2026-10-review/handoff/verify-full.sh` hard-codes `R=/Users/longla/coding/tubutree-mini-app` (:3, the main checkout), `OUT=${1:-<a scratch directory of another session>}` (:4; the log directory is the FIRST ARGUMENT, an `OUT=` environment prefix is overwritten), `cd $R` (:7) and the container `tubu_it_main` / `localhost:5550` (:19-20): run as is, it verifies main, not the worktree. Never edit it inside the repository. To use it on a worktree, run a temporary copy outside the repository with `R` set to the worktree and the container/port of the lane; from the worktree root:

```
V=$(mktemp -d) && sed -e "s#^R=.*#R=$(pwd)#" -e "s#^OUT=.*#OUT=\${1:?log dir}#" -e "s#tubu_it_main#<lane container>#g" -e "s#localhost:5550#localhost:<lane port>#g" docs/2026-10-review/handoff/verify-full.sh > "$V/verify-full-impl.sh" && grep -n '^R=\|^OUT=' "$V/verify-full-impl.sh" && ! grep -n 'tubu_it_main\|localhost:5550' "$V/verify-full-impl.sh" && bash "$V/verify-full-impl.sh" "$V/out"
```

The first grep must print the worktree path on the `R=` line and `OUT=${1:?log dir}`; the second grep must print nothing. `<lane container>` and `<lane port>` are the race database of the worker's context line (Lane databases above). The full gate runs once per merge at the integration branch (M8.8c); per lane only the commands named in the task Gates run.

Playwright scope (M8.7). The worktree has no `apps/api/.env`. Always pass `--reporter=line` (except with `--list`): the config's `reporter: 'html'` (`playwright.config.ts:109`) serves the report and never exits when a test fails outside CI. Mini app specs run with `E2E_SCOPE=miniapp pnpm --filter @tubutree/e2e exec playwright test --reporter=line <spec>` (`playwright.config.ts:44-45`, `:115-116`: the miniapp scope needs no API or DB). Admin specs run with `E2E_SCOPE=web-admin pnpm --filter @tubutree/e2e exec playwright test --reporter=line <spec>` once M8.7d has added `const webAdminOnly = process.env.E2E_SCOPE === 'web-admin';` with `webServer: miniappOnly ? [miniappServer] : webAdminOnly ? [webServer] : [apiServer, webServer, miniappServer]` and `projects: miniappOnly ? allProjects.filter((p) => p.name === 'Zalo Mini App') : webAdminOnly ? allProjects.filter((p) => p.name === 'Web Admin') : allProjects,` (Web Admin project and the Next server only; the admin specs mock every `/api/` call; `global-setup.ts:102-123` degrades to an empty token without `.env`). Before any run: `lsof -nP -iTCP:<port> -sTCP:LISTEN` for 3112 and 3113; if a listener exists, `lsof -a -p <pid> -d cwd -Fn` must print a path inside this task's own worktree (`git rev-parse --show-toplevel`), never recycle-impl or the main checkout; otherwise stop and report blocked (`reuseExistingServer`, `playwright.config.ts:56/65/72`, would test another checkout). Never kill it.

## 5. Route table
Decorator legend: R(SA) = `@Roles('STAFF','ADMIN')`, R(A) = `@Roles('ADMIN')`, T10/T30/T60 = `@Throttle({ default: { ttl: 60_000, limit: N } })`, IK = `Idempotency-Key` via `requireIdempotencyKey`. Customer gate mode in brackets.
@HttpCode(200) on POST /admin/waste/requests/:id/receive (all three outcomes, spec 15.4); the e2e/unit test asserts 200.
| Method path | Controller file | Decorators | Service method | Task |
|---|---|---|---|---|
| GET /waste/me | customer/waste-customer.controller.ts | — [none] | WasteMeService.me | M2.6 |
| GET /waste/rules | same | — [none] | WasteMeService.rules | M2.6 |
| GET /waste/items | same | — [FULL] | WasteCatalogueService.listItems | M2.6 |
| GET /waste/points?provinceCode= | same | — [FULL] | listPoints | M2.6 |
| POST /waste/points/nearby | same | T30 [FULL] | nearbyPoints | M2.6 |
| GET /waste/requests | same | — [OWN] | WasteRequestsService.list | M2.6 |
| GET /waste/requests/by-order/:orderId | same (declared before :id) | — [OWN] | byOrder | M2.6 |
| GET /waste/requests/:id | same | — [OWN] | detail | M2.6 |
| POST /waste/preview | same | T60 [FULL] | WastePreviewService.preview | M2.7 |
| POST /waste/requests | same | T10 IK [FULL] | create | M2.8 |
| PATCH /waste/requests/:id | same | T10 [FULL] | edit | M2.8 |
| PUT /waste/requests/:id/tracking | same | T10 [OWN] | setTracking | M2.9 |
| POST /waste/requests/:id/cancel | same | T10 [OWN] | cancel | M2.9 |
| GET /waste/desk/points | receiving/waste-desk.controller.ts | — | WasteDeskService.points | M3.7 |
| POST /waste/desk/lookup | same | T30 | WasteDeskService.lookup | M3.7 |
| POST /waste/desk/requests/:id/confirm | same | T30 | WasteConfirmService.confirm(route DESK) | M3.7 |
| POST /waste/desk/requests/:id/reject | same | T30 | WasteConfirmService.reject(route DESK) | M3.7 |
| PUT /waste/desk/points/:pointId/perk | same | T10 | WasteDeskService.submitPerk (OWNER only) | M3.7 |
| POST /waste/desk/gifts/fulfil | catalog/waste-desk-gifts.controller.ts | T30 | WasteGiftRedemptionsService.fulfilAtDesk | M4.3 |
| GET /waste/desk/points/:pointId/report?month= | catalog/waste-reports.controller.ts | — | WasteReportsService.pointReport | M4.7 |
| GET /admin/waste/overview | catalog/waste-reports.controller.ts | R(A) | overview | M4.7 |
| GET /admin/waste/reports/monthly?month= | same | R(A) | csv (text/csv) | M4.7 |
| GET/POST/PATCH(:id) /admin/waste/items, PUT /admin/waste/items/order | catalog/waste-admin-items.controller.ts | R(A), writes T30 | WasteAdminItemsService.* | M4.5 |
| GET(?status=&perkPending= → AdminWastePointQuery)/POST/PATCH(:id) /admin/waste/points, PUT /admin/waste/points/order | catalog/waste-admin-points.controller.ts | R(A), writes T30 | WasteAdminPointsService.* | M4.6 |
| POST /admin/waste/points/:id/staff, DELETE /admin/waste/points/:id/staff/:userId | same | R(A) T30 | addStaff / removeStaff | M4.6 |
| POST /admin/waste/points/:id/perk/approve, …/perk/reject | same | R(A) T30 | approvePerk / rejectPerk | M4.6 |
| GET /admin/waste/points/:id/report?month= | catalog/waste-reports.controller.ts | R(A) | WasteReportsService.monthly(month, pointId) → WastePointMonthlyReportDTO | M4.7 |
| GET /admin/waste/requests | receiving/waste-admin-requests.controller.ts | R(SA) | WasteAdminRequestsService.queue | M3.8 |
| GET /admin/waste/requests/lookup?code= (before :id) | same | R(SA) T30 | lookup | M3.8 |
| GET /admin/waste/requests/:id | same | R(SA) | detail | M3.8 |
| POST /admin/waste/requests/:id/receive | same | R(SA) T30 @HttpCode(200) | WasteReceiveService.receive | M3.8 |
| POST /admin/waste/requests/:id/confirm | same | R(SA) T30 | WasteConfirmService.confirm(route ADMIN) | M3.8 |
| POST /admin/waste/requests/:id/reject | same | R(SA) T30 | WasteConfirmService.reject(route ADMIN) | M3.8 |
| POST /admin/waste/requests/:id/reverse | same | R(A) T10 | WasteReverseService.reverse | M3.8 |
| PATCH /admin/waste/requests/:id/cost | same | R(A) T30 | setCost | M3.8 |
| POST /admin/waste/requests/:id/close-lost | same | R(A) T10 | WasteConfirmService.closeLost | M3.8 |
| POST /admin/waste/requests/:id/reopen | same | R(A) T10 | reopen | M3.8 |
| GET /admin/waste/unmatched, POST /admin/waste/unmatched, POST /admin/waste/unmatched/:id/resolve | same | R(SA), writes T30 | WasteReceiveService.listUnmatched/createUnmatched/resolveUnmatched | M3.8 |
| GET/PUT /admin/waste/users/:userId/flags | same | R(A), PUT T10 | getFlags / setFlags | M3.8 |
| GET/POST/PATCH(:id) /admin/waste/gifts, PUT /admin/waste/gifts/order | catalog/waste-admin-gifts.controller.ts | R(A), writes T30 | WasteAdminGiftsService.* | M4.4 |
| GET /admin/waste/gift-redemptions | same | R(SA) | WasteGiftRedemptionsService.queue | M4.3 |
| POST /admin/waste/gift-redemptions/:id/fulfil | same | R(SA) T30 | fulfilById | M4.3 |
| POST /admin/waste/gift-redemptions/:id/cancel | same | R(A) T10 | cancel | M4.3 |
| GET /me/loyalty/rewards | api/modules/loyalty/loyalty.controller.ts | — | LoyaltyService.getRewardCatalog | M4.1 |
| GET /me/loyalty/rewards/mine | same | — | LoyaltyService.getMyRedemptions | M4.1 |
| POST /me/loyalty/rewards/:id/redeem | same | T10 IK (`@Headers('idempotency-key')`) | LoyaltyService.redeemReward | M4.2 |
Every service on a staff/admin route re-reads role via `assertActiveStaff`/`assertActiveAdmin`/`assertPointAccess`; JWT `@Roles` is only the first filter.

## 6. Test ownership (§17.3)
Unit: points calc (floor, snapshot, multi-line) M1.7; clamp received≤declared + hazardous 0/WRONG_TYPE M3.1; day/month/points caps + path matrix M2.4; input validation per controller (M2.6–M2.9, M3.7, M3.8, M4.2–M4.6); state steps customer M2.8/M2.9, staff M3.2–M3.5, system M5.3–M5.5; TREE canRedeem 28000 STANDARD + 30000 CONVERTED vs 50000 → true M4.1; order with wasteRequestId goes to `gomdon-push` at placement M5.2. Reports M4.7: one unit/race case per WasteMonthMetrics field on fixed fixtures incl. month convention (created by createdAt, units/points by completedAt incl. REVERSED, reversed by reversedAt, quota from waste_point_usage), CSV and pointReport from the same function, pointReport has no reversed column.
Race files (Postgres, `race/`): `waste-db-constraints` M1.2/M1.3 (CHECKs, 4 vouchers pass); `waste-create` M2.8 (create×create day/month/open caps; replay at max open, MAIL_IN/PICKUP replay ignores pointId; PICKUP create×create → one row); `waste-edit` M2.8 (edit×edit, edit×create — CUSTOMER lock); `waste-tracking` M2.9 (same code ×2 → both trackingConflict; cross swap no deadlock — TRACKING lock; re-tap vs first entry); `waste-confirm` M3.2 (confirm×confirm one grant; N confirms at quota edge — usage row); `waste-receive` M3.4 (receive×2 sequential + Promise.all → one RECEIVED, ALREADY_RECEIVED; EXPIRED ×2 concurrent → one unmatched; resolve×resolve once); `waste-reverse` M3.6 (reverse×confirm request→users; reverse×LoyaltyExpiryService cron users; reverse after partial spend take/shortfall); `waste-gift-redeem` M4.2 (stock 1 × many; balance just enough; same key parallel); `waste-gift-cancel` M4.3 (cancel×cancel one refund; cancel×fulfil; cancel×redeem; fulfil×fulfil; fulfilledPointId never on non-READY); `waste-pickup-attach` M5.2 (ship-lock step1/2 × checkout with points, no flags row → no deadlock); M5.4 appends the case 'attach day 5 × expiry cron day 7 no close' to the same file; `waste-cross-lane` M8.8 (edit×confirm both orders incl. qty-only edit; edit×attach; cancel×attach; cancel×confirm; reverse×checkout-with-points attaching a COMPLETED and an OPEN request; class pairs CUSTOMER×STAFF_CAP and TRACKING×STAFF_CAP). Modified: `partial-unique-indexes` (23) M1.2; `delete-it-data` M1.2; `auth-merge-guest`, `account-deletion` M2.10; `loyalty`, `pd3-points-lots`, `pd3-checkout-points`, `pf6-locked-window-outside-tx`, `admin-engagement-price-history` M4.2; `ops-health` M4.8; refill race specs deleted M8.1. Every pair named above is tested in both orders (A takes its first lock first, then B first; force the order with a held `FOR UPDATE`/advisory lock on a side connection or a barrier), per spec 17.3 "kể cả chiều ngược lại"; each race spec names the two cases `<A> then <B>` and `<B> then <A>`, and asserts no `40P01`/P2034 in either.
DB constraints: KNOWN list + CI check M1.2; CHECK cases M1.2/M1.3.
Permission/state/notification bullets: demoted/blocked staff loses access next call M2.3+M3.7; PARTNER without valid OWNER → 403 desk, hidden from list, create DROP_OFF 409, no two OWNERs M2.3/M2.6/M2.8/M4.6; enabled off → PARTNER desk 403, warehouse receive + READY fulfil OK, DROP_OFF confirm blocked from any route M3.7/M3.8/M4.3; blocked customer → confirm 409 stays, reject OK M3.2/M3.3; blockedAt cancels OPEN + sets tracking on MAIL_IN, create/edit 403, tracking on PICKUP/DROP_OFF 409 no write M2.8/M2.9; confirm PICKUP with order CONFIRMED rejected M3.2; checkout with wasteRequestId when ship-locked/blocked → 409 no order M5.2; receive/resolve on DROP_OFF or unattached/undelivered PICKUP → 409 no change, two staff resolve once M3.4; attach day 5 not closed day 7 M5.4; cancelOrder and setStatus close request in same request, delivered → IN_TRANSIT with expiresAt from real deliveredAt (first delivery), hook failure fixed by sweep incl. deliveredEffectsAt set M5.3/M5.5; expiry closeReason per branch ('2' with gomdonOrderId → NOT_DISPATCHED, not a strike), notify only rows closed M5.4; NO_SHOW doesn't raise wasteOrderMismatch M4.8+M5.4; late parcel via reopen, cap-rejected, not blocked by lane flag/min/ship-lock M3.5; TR vs tracking mismatch, shared tracking, no-code parcels M3.4; unmatched written in committed separate tx + 200 UNMATCHED; confirm/reject bad basis 409 no write M3.4/M3.2/M3.3; same TR by other staff or >10 min → unmatched M3.4; 15.6 statuses counted/not, unlock doesn't relock M2.5; carton-only reaches mail-in min M2.4; staff routes mask name/phone M3.7/M3.8/M4.3; exactly one WasteEvent per successful write, none on replay, separate rows for hook/cron/15.6 cascade — each owning task asserts its own routes, M8.8 sweeps all routes; lookup miss single 404 M3.7/M3.8; bad Idempotency-Key 400 M2.8/M4.2; replay at max open M2.8; B on A's request 404 (GET/PATCH/tracking/cancel) M2.6/M2.8/M2.9; no trackingConflict/internal fields in customer responses M2.6/M2.9; guest/no-phone /waste/me 200 non-OK, POST requests 403 M2.6/M2.8; guest SEED_PACK/GIFT 403 no deduction M4.2; hidden/sold-out VOUCHER 400 M4.2; stock 0 → canRedeem false + soldOut true M4.1; inactive item lines 409 (incl. battery) M2.8; edit after lane flag off and at max open succeeds M2.8; edit keeping unavailable point OK without consent, switching to unavailable 409 M2.8; PARTNER sees neutral blocked text M3.2; fulfil wrong code 404 + LOOKUP_MISS, fulfilled/cancelled 409 M4.3; gift-redemptions queue for STAFF has no full QG code (codeLast2 only) and masked name/phone, ADMIN sees full M4.3; STAFF resolve(MATCH) of a TR_TRACKING_CONFLICT unmatched row → 403, ADMIN OK M3.4; STAFF queue with filter TRANSIT_OVERDUE/ORDER_MISMATCH or userId → 403 M3.8.
Migration: deploy on empty DB + drift + templates in seed and migration M1.1–M1.5; whole-gate rerun M8.8.
Mini app vitest: wizard state, counters, mail-in threshold + fee>points warning M6.4; progress bar M6.3/M6.4/M6.5; home status-card order (off before sign-in) M6.3; pickup block when locked/flag off (4.5b) M6.5; "Đã hết" M6.7; Mini app vitest pins Asia/Ho_Chi_Minh (vitest-global-setup.ts); TZ independence of the new waste date helpers is proven by src/utils/waste-labels-tz.spec.ts (M6.1b). Web vitest runs with TZ=UTC.
Playwright (M8.7): golden path create → desk confirm → points → redeem; ship with tracking; pickup attach at checkout (flag on in mock); quota-full point disabled; location denied; no horizontal overflow (scrollWidth) on /recycle, /recycle/new, /recycle/r/:id, /recycle/desk, /rewards at 390 px, normal and html[data-font-scale='large'] (ported from refill.miniapp.spec.ts).
Human review (mockups 390 px + large font; desk timing): M8.8 checklist, owner.

## 7. Ordering hazards (gate specs) and rules
R0 Append-only shared lists: `st/index.ts`, `ds-c076-pc10c1.spec.ts` FILES, `ds-palette-pc11.spec.ts` MIGRATED, `no-raw-date-format.spec.ts` declarations, `READS_STANDARD_LOT_ON_PURPOSE`, `EXPECTED` of `staff-permissions.matrix.spec.ts` (waste routes add rows; M8.1 deletes only the refill and `engagement/rewards` rows): add lines only, never reorder; conflicts resolved by keeping both. `st/waste.ts` is frozen after M1.6: a lane needing a new DTO creates `st/waste-m<n>.ts` and appends one export line to `st/index.ts`.
1. `dead-config-keys.spec.ts` and `reference-config-selection.spec.ts`: waste seed rows land in the same commit as `waste-config.keys.ts` (M1.4), and that commit adds `waste` to `EXCLUDED_CONFIG_PREFIXES` of `apps/api/prisma/reference-data/config-selection.ts` (reason: migration `20261020000000_waste_exchange` creates the rows); a `SYSTEM_CONFIGS` prefix that is neither loaded nor excluded fails that spec. Refill keys: M8.2 (go-live) first removes the `refill.pickup_address` reader; then M8.1 deletes the refill module AND, in the same commit, adds the 5 `refill.*` keys to `DEAD_CONFIG_KEYS`, removes their `SYSTEM_CONFIGS` rows and their RANGES/JSON_RULES (+ spec cases, `PICKUP_PHONE_PATTERN` import), and removes the `refill` entry of `EXCLUDED_CONFIG_PREFIXES` (that spec requires every excluded prefix to keep a seeded key). M8.3 keeps only templates and schema deprecation.
2. Seed parser (`dead-config-keys`, `points-unit-guard`, `config-numeric-ranges`): `SYSTEM_CONFIGS` entries must be literal objects (no identifiers/spreads); `assertWasteConfigSeedRows` is called after the array. Every numeric seeded key needs a RANGES rule with `integer: true` (config-numeric-ranges); every seeded `*_points` key needs an entry in `POINTS_NUMBER_KEYS` (or `SPIN_COST_BOUND`) of `points-unit-guard.spec.ts` whose `max` equals its RANGES max, and `set(key, max + 1)` must be rejected.
3. `points-unit-guard`: migration text must not contain `loyalty.point_expire_months` (M1.1–M1.5 grep before commit).
4. `notification-templates-seed`: templates, migration INSERT and CODES in one commit (M1.5); notifier passes literal codes (M2.2). REFILL_* seed + CODES removal only in M8.3 after `refill.service.ts` deleted (M8.1; lane order M8.2 → M8.1 → M8.3).
5. `check-partial-indexes` / `partial-unique-indexes` pin: index SQL + KNOWN list + pin 23 in the same commit (M1.2); index statements top-level, start of line, no `;`/`--` inside, no DO block.
6. Drift check (`verify-full.sh`): any schema.prisma change after M1 must be comment-only (M8.3 `/// @deprecated`).
7. `schema-deprecated.spec.ts`: Refill deprecation only after module (M8.1), ops-inbox `p.bottleReturn.count` (M4.8) and go-live raw SQL (M8.2) are gone → M8.3 (last of M8.2 → M8.1 → M8.3).
8. `patch-null-contract.spec.ts`: every PATCH/PUT DTO class in the controller file (or relative import) with `@OptionalNotNull()` on non-nullable optional fields. The pinned `'PATCH /admin/refill-locations/:id'` swaps to `'PATCH /admin/waste/points/:id'` in M8.1 (needs M4.6 merged).
9. `endpoint-inventory.spec.ts`: refill routes appended to REMOVED in M8.1; no edit needed for new routes.
10. `ops-inbox.service.spec.ts` + `ops-health.race-spec.ts` (exact key lists per role) updated in M4.8 with the service; web `InboxKey`/labels M7.7 (web compiles independently).
11. `apps/miniapp/src/ds-c076-pc10c1.spec.ts` (entries are paths relative to apps/miniapp, e.g. 'src/pages/<file>.tsx' or 'src/components/ui/timeline.tsx'): add each new miniapp page/component to FILES in the same commit, before writing it; drop `src/pages/refill.tsx` in the commit that deletes it (M8.4) (ENOENT otherwise). Never create files in `components/game/`.
12. `apps/web/src/ds-palette-pc11.spec.ts` (entries relative to apps/web/src, e.g. 'components/admin/waste-tab.tsx'): add each admin file before writing (M7.1 `waste-tab.tsx` shell, then M7.2–M7.7); refill files are not pinned there, so M8.5 does not edit it.
13. Copy guards (`tree-fund-copy.spec.ts`, ds legacy alias specs, `check-undefined-css-vars`, uiux static-scan): forbidden words of §16.1 in miniapp src AND in `seed.ts`/migration text (gift-tree name "Góp quỹ trồng cây"); icons not emoji; `i18n/vi-no-hardcoded-amounts.spec.ts` (no money amount such as `20.000đ` or `30k` in `i18n/vi.ts` or `pages/about-data.ts`; a justified one carries `// hardcoded-amount-ok: <reason>`) and `i18n/ui-emoji.spec.ts` (an emoji line in `i18n/vi.ts` only under a key of its ENCOURAGEMENT_KEYS list).
14. `points-lots-guard.spec.ts`: new miniapp files never read `.pointsBalance`; use `pointsSummary(x).total` and server `redeemablePoints`/`canRedeem`/`soldOut`.
15. e2e typecheck in CI: `PublicConfig` (miniapp) change requires `apps/e2e/tests/support/mock-api.ts` (+`checkout-mocks.ts`) edit in the same commit (M6.1, M6.8). Same rule for every miniapp service type that e2e imports: M6.7 edits `apps/e2e/tests/loyalty.miniapp.spec.ts` to typecheck against the new `account-api.ts` types (behaviour rewrite stays in M8.7); M8.4 deletes `apps/e2e/tests/refill.miniapp.spec.ts` and fixes the `/refill` row of `offline-states.miniapp.spec.ts` in the same commit that deletes `services/refill-api.ts`. D6 (as amended by C25): the task that changes the mini app `PublicConfig` (M6.1b adds `waste`, M6.8a drops `recyclingEnabled`) edits `support/checkout-mocks.ts` and `support/mock-api.ts` in the same commit; M8.7a adds the `/waste/*` route mocks. Tests M6 cannot rewrite become `test.fixme(` (M6.7a: the two reward tests of `loyalty.miniapp.spec.ts`) or `test.describe.fixme(` (M6.8a: `recycling-pickup.miniapp.spec.ts`), each with a "rewritten in M8.7" comment; the M8.7 task that owns the spec turns them back (M8.7b Gate: `grep -c fixme apps/e2e/tests/loyalty.miniapp.spec.ts` prints 0; M8.7c Gate: the same for `recycling-pickup.miniapp.spec.ts`); the baseline is zero (no fixme at 5ae209d4), so no baseline file is recorded and M8.8c gates on `grep -rnE "test\.(describe\.)?fixme" apps/e2e/tests` printing nothing.
16. `checkout.service.spec.ts` builds by position: M5.2 must NOT change `CheckoutService` ctor (pure helpers + existing optional `config`); if it does, fix the spec in the same commit. `checkout.dto.spec.ts`, `buyer-order-fields.spec.ts` (no new Order columns).
17. `forbidNonWhitelisted` on PlaceOrderDto: removing `hasRecyclingPickup`/`recyclingNote` (M5.2) and web stop-sending (M5.6) ship in the same lane merge; miniapp stops sending in M6.8 (until then the miniapp toggle is hidden because M5.6 drops `recyclingEnabled`).
18. `redeemReward` 3rd param + `DEFAULT_REWARD_CATALOG` removal: all unit specs, `admin-engagement.service.ts` and 5 race specs in the same commit (M4.2).
19. `deleteItData` must delete waste tables before `orders`/`users` (M1.2) before any waste race spec exists.
20. `cron-timezone.spec.ts`: every new `@Cron` has `timeZone: CRON_TZ` (M5.4, M5.5).
21. `staff-permissions.matrix.spec.ts`: use `@Roles`, never `@AllowStaff`. Its `EXPECTED` map must equal every route of the module graph that is ADMIN-only, open to STAFF, carries `@AllowStaff` or has an `/admin` path segment, so each controller task with `/admin/waste/*` routes adds their rows in the same commit (R(SA) → `STAFF`, R(A) → `ADMIN_ONLY`; M3.8, M4.3–M4.7) and M8.1 deletes the rows of `GET /admin/engagement/rewards` and of the refill routes (:109, :185-188, :244-246).
22. Go-live (M8.2), in one commit with the `IMAGE_COMPATIBLE_MIGRATIONS` append: `db-checks.spec.ts:140` `toHaveLength(2)`→`toHaveLength(3)`, :144 `'(5)'`→`'(6)'`, :152 `'6 migration chờ áp, 1 cái nằm ngoài'`→`'7 migration chờ áp, 1 cái nằm ngoài'` (leave :159 `'7 … 4 cái nằm ngoài'` unchanged; do NOT add the new folder to `go-live.fixtures.ts` MIGRATIONS, or every count shifts); replace the `db.refill_location` block (:18, :190-240) with `db.waste_point` cases; `run.spec.ts:62-63,69,72` (oldProd uses the waste snapshot; post-deploy FAIL list becomes `['db.migrations_pending','db.required_migrations','redis.policy']` while `waste.enabled` is absent); `collect.spec.ts:47,69,80,83` (`waste_points` in place of `refill_pickup_locations`); `go-live.fixtures.ts:85` (`waste` snapshot in place of `refill`).
23. Web `page.spec.tsx` (9 groups, the nav button count the file pins, which this plan leaves unchanged: 37 on the base of 2026-10-18, 38 once the external-points menu item of the launch branch is merged; heading list incl. waste, staff no-group behaviour) and miniapp `profile.spec.ts` (unique destinations), `admin.spec.tsx:243` tab list (M7.1, M6.9, M8.4).
24. Race suite and drift reach CI only through `.github/workflows/race.yml` (PR into main touching `apps/api/**`, `packages/shared-types/**` or `pnpm-lock.yaml`; nightly 03:00 VN; manual); `ci.yml` runs neither, so no lane gate sees them: every task that adds SQL/locks states the docker race command and runs it.
25. Config key names must not contain pass/key/token/secret (redaction) — none do.
26. Also scan-guarded: web `lib/points-lots-guard.spec.ts` (whole web src, admin included); miniapp `pages/format-guard.spec.ts` (no toLocale* outside utils/format.ts); `utils/clipboard.spec.ts` (use `copyText`); `ds-c076-pc10a.spec.ts` (loyalty.tsx, game.tsx) and `ds-c076-pc10c2.spec.ts` (profile.tsx, notifications.tsx, order-detail.tsx) for files edited in M6.7–M6.9; api `points-expiry-guard.spec.ts` (credit only via `RewardPointsService.grant(…, expiresAt)`; reverse writes `delta: -take` only when take > 0; no raw INSERT into points_transactions); api `config/deploy-compose.spec.ts` (the first bash block under `### 1.5` of `docs/launch/deploy-rollback-runbook.md` keeps its vhost `.bak` restore shape) and `config/ops-workflows.spec.ts` (`docs/GO-LIVE-KEYS.md` keeps its `## …Pancake`, `## …Gomdon` and `## …báo động vận hành` headings and the key names it lists), so M8.6's doc edits leave those passages as they are.
27. `wx/waste-exchange.module.spec.ts` (D1): written once in M1.7 in its final form (compile test with `useMocker`, so lane modules that gain providers and controllers keep it green); M2–M5 tasks run it in their Gate (M5.4 and M5.5 included) and never edit it; a red run means a missing export in a lane module, never a reason to edit the spec.
28. Generated files (D2): `scripts/uiux/generated/{miniapp,web}-endpoints.json` are read by no CI job or spec and are regenerated only in M8.6a (`node scripts/uiux/extract-endpoints.mjs miniapp` and `... web`); `scripts/audit/routes.json` is edited by hand in M8.6a (delete `/refill`, add one entry per new mini app route in the same shape), because `seed-audit-personas.ts` runs only against `tubutree_audit` on the dev stack, which this plan never touches; M8.6b's launch checklist says to regenerate `routes.json` and `personas.json` on the audit stack when it is next started.
29. `wx/core/waste-caps.spec.ts` (M2.4) scans every non-spec `.ts` under `apps/api/src/modules/waste-exchange/` and fails on `/\.(setHours|getMonth)\(/` (spec 15.1: calendar time only through `common/vn-time.ts`); every later task that adds a file under that folder must pass it unchanged.
30. `wx/core/waste-events.spec.ts` (M2.2) scans every non-spec `.ts` under `apps/api/src/` and fails on `/\.wasteEvent\.(update|updateMany|upsert|delete|deleteMany)\(/` or `/(UPDATE|DELETE\s+FROM|TRUNCATE(\s+TABLE)?)\s+"?waste_events"?\b/i` (spec 11.1 append-only); no file is excluded.
31. `wx/receiving/waste-admin-requests.controller.spec.ts` (M3.8b) test 'single credit path (spec 10.1)' scans every non-spec `.ts` under `apps/api/src` for RECYCLE ledger writes (`.grant(… 'RECYCLE', …)`, or `applyPointsDelta` / `pointsTransaction.create|createMany|upsert` with `refType: 'RECYCLE'`) and expects only `modules/waste-exchange/receiving/waste-confirm.service.ts`; every later task that writes points must pass it unchanged (spec 10.1: one credit path, no manual credit tool).

## 8. Architect's calls, ambiguities, spec issues
1. Core stage inside M2 (M2.1–M2.5 and M2.6a merge first; M2.6a carries the request mapper that M3.3 imports). M3, M4, M5 all need config snapshot, events, notifier, access and ship-lock; putting them in one early merge unit removes every cross-lane code dependency in S2. M2 therefore has 10 tasks (5 core + 5 customer), above the 4–9 target; splitting the id would break "keep ids".
2. Module shells in M1.7: `waste-exchange.module.ts` imports five per-lane sub-modules that start empty, so no lane edits a shared module file or `app.module.ts`. `WastePickupModule` is also imported by `OrdersModule` (M5.3); it must not import `OrdersModule` (cycle).
3. Refill schema deprecation moved M1 → M8.3: `schema-deprecated.spec.ts` fails while `RefillService`, ops-inbox and go-live still read `bottleReturn`/raw tables. M8 order is M8.2 (go-live) → M8.1 (module + refill config keys, so `dead-config-keys.spec.ts` never goes red) → M8.3 (templates + deprecation).
4. Foundation helpers (codes, points formula, lock helpers, constants) moved from M2 to M1.7 so M3/M4 do not wait on M2.
5. D1 refinement (not a reversal): the seed parser evaluates `SYSTEM_CONFIGS` with `new Function`, so rows must stay literal; seed.ts imports `WASTE_CONFIG_KEYS` only to call `assertWasteConfigSeedRows(SYSTEM_CONFIGS)`, and `waste-config.keys.spec.ts` checks seed rows, RANGES/JSON/boolean rules and migration INSERTs against the record. Note: because the keys file quotes every key, dead-config-keys can no longer catch an unused waste key; the keys spec does not either. Mitigation (binding): WasteConfigService.snapshot(), computeWastePublicFlags and readPickupGate read each key with an inline string literal (config.get('waste.enabled', ...)); waste-config.keys.spec.ts asserts every WASTE_CONFIG_KEYS key occurs as a quoted literal in a non-spec file other than waste-config.keys.ts.
6. `assertPosStaff` is a private method of `LoyaltyService` (`loyalty.service.ts:1121`), not a cashier module; extracted as `common/staff-access.ts` (M2.3), LoyaltyService delegates in M4.2. The shared helper adds `mergedIntoId IS NULL` (§15.1 b). LoyaltyService passes its current message: assertActiveStaff(db, id, 'Chỉ nhân viên hoặc quản trị viên mới có quyền quét thẻ thành viên.').
7. `collectBlockers` is in `users/account-deletion.service.ts` and `partnerBlockers` in `merchant/merchant-fulfilment.service.ts`, not in `auth.service.ts` as spec 11.1 and the brief imply. New `DeletionBlockerCode`s: `WASTE_REQUEST_OPEN`, `WASTE_UNDER_REVIEW` (message `Tài khoản đang được Tubu xem xét, liên hệ CSKH`).
8. `waste_events.kind` is a `String` column with the closed list in code (`WASTE_EVENT_KINDS`), not a Prisma enum, so adding a kind needs no migration; a unit test rejects unknown kinds in `writeWasteEvent`.
9. `waste_unmatched_parcels` request columns have NO FK (spec 15.4 only warns about the FK case). This removes the KEY SHARE wait entirely; the separate-transaction rule still applies.
10. Confirm step 11 updates `waste_points.lastConfirmedAt`, a row lock missing from spec 10.1's order list. Analysis: it is last in the tx; the only other writers of that row (admin point PATCH, point create) take no other lock; two confirms at one PARTNER serialize on the usage row first. Added as step (6) in §4.12; M3.2 reviewer must confirm.
11. Spec 15.1 leaves `GET /waste/items` and `/waste/points` outside the read exceptions, so they return 403 when the programme is off or for guests; the mini app uses `/waste/me.items` for the home list and only calls `/waste/items`/`/points` inside the wizard. Kept as written.
12. `DELETE points/:id/staff` (15.4) has no body convention; registry uses `DELETE /admin/waste/points/:id/staff/:userId` (15.4 allows path changes).
13. Desk lookup body is `{ code }` (15.3); with several points the server checks all points of the caller and returns `pointId`; confirm then uses the request's `pointId`.
14. `POST /waste/preview` is not a write; registry gives it T60 (spec silent).
15. Read exceptions still require real user + phone except `/waste/me` and `/waste/rules` (15.1 says only those two drop that requirement). Gate mode `OWN`.
16. Ship-locked customer editing MAIL_IN/PICKUP: 15.2 says "không sửa được" without a code, 15.6 says 403; registry picks 403 (safer, matches create).
17. Point staff need not have a phone: a null staff phone never equals the customer's (customers always have one, §15.1), so the same-phone ban stays sound. POST points/:id/staff enforces only §15.1(d) (OWNER) and isRealUser.
18. Spec inconsistency, 13.2 vs repo: `checkout-parity.spec.tsx` DOES exist at `apps/web/src/app/thanh-toan/checkout-parity.spec.tsx` (the conventions digest says it does not). M5.6 updates it.
19. Spec 8 says redeem idempotency check sits "after users FOR UPDATE and before lockedOrderPoints"; spec 8 also places the stock UPDATE "after users"; the order of stock vs points deduction is unspecified. Registry: stock UPDATE before points deduction (fail fast on sold out; both roll back on throw).
20. Spec 10.1 claims `mergeGuestInto` cannot deadlock with gift cancel because guests only own FULFILLED vouchers. Verified: `mergeGuestInto` is only called with a `guest_` zaloId source, and guests fail `isRealUser`, so they cannot hold READY redemptions or requests. Holds.
21. Spec 11.2 pins `validateAndHold`'s consent check to CREATE, but MAIL_IN also needs packaging + postage commitments (4.3, 14.1); registry adds `packagingConsent`/`postagePaidConsent` to `WasteCreateRequest`, required only for MAIL_IN at CREATE (400 if missing).
22. Spec 15.4 `reopen` for PICKUP says "(đã gắn đơn)"; an unattached PICKUP that expired by HOLD_EXPIRED is not reopenable → 409 (no parcel can exist).
23. Spec 12.4 puts the public `pickup` flag in M5 in the draft; it is computed in `computeWastePublicFlags` (M2.1) with the other flags, since the same function serves `buildPublicConfig`.
24. `QG-` code rule "must not start with TUBU or be ≥8 digits" is satisfied structurally by the `QG-` prefix; a unit test still asserts it (M1.7).
25. Spec 17.3 lists "thu hồi điểm đua với cron hết hạn": interpreted as the existing points-expiry cron (`LoyaltyExpiryService`, locks `users`), not the waste expiry cron (which never touches COMPLETED rows). Both are cheap to add; M3.6 covers the loyalty cron.
26. Risk the owner should know: the coupon two-key lock `pg_advisory_xact_lock(hashtext(coupon.id), hashtext(userId))` (`coupons.service.ts:299`, only when `perUserLimit > 0`) can collide with `WASTE_LOCK_CLASS.CUSTOMER` (731001) only if some coupon **id** hashes to 731001; spec accepts (10.1). M8.8 adds to the runbook: run `SELECT id, code FROM coupons WHERE "perUserLimit" > 0 AND hashtext(id) IN (731001,731002,731003,731004)` (ids, not codes; reward coupons keep being created, so this is a periodic ops query, not a one-off). The other existing two-key locks cannot collide either: `assertFirstOrderInTx` (`common/first-order.ts`, `pg_advisory_xact_lock(hashtext('first-order'), hashtext(userId))`, first key 276497134), `CouponClaimService` (`coupons/coupon-claim.service.ts:85`, first key `hashtext('coupon-claim')` = -1772501529) and `AdminCouponBatchService` (`admin/admin-coupon-batch.service.ts:102`, first key `hashtext('coupon-batch')` = -912181282); all three first keys are outside 731001–731004.
27. Resolved (see review F14): CouponType; inline storefront fixture; seed-large untouched; admin.service `recyclingEnabled` kept.
28. D1 (replaces the per-lane edits of `waste-exchange.module.spec.ts`): M1.7 writes the spec once in its final form; its compile test is `Test.createTestingModule({ imports: [WasteExchangeModule] }).useMocker(outside).compile()` with `outside = (token) => (typeof token === 'function' && token.name.startsWith('Waste') ? undefined : {})` (a falsy mocker result rethrows the original resolution error, `@nestjs/testing/testing-injector.js`), so only `Waste*` providers must resolve inside the graph; the "controllers undefined" loop is gone and no later task edits the file (hot-spot 2.9, hazard 27).
29. D2 (replaces "regenerate routes.json" of 2.8): generated endpoint JSON is regenerated only in M8.6a; `scripts/audit/routes.json` is edited by hand and the audit seed is never run (hazard 28).
30. D3 (replaces "the 8 waste keys → 'waste'" of 2.7): each ops-inbox waste key opens the waste tab with `WasteSeed { section, preset, n }` (2.7), as `openInbox` already does for returns (`setReturnsSeed({ filter, n: Date.now() })`); spec 13.2 requires the count to equal the rows after the click.
31. D5: R12.2.107 (Gomdon-status copy in `OrderDTO`) is NOT PLANNED in this release. `BUYER_VISIBLE_SYNC_FIELDS` (`orders/buyer-order-fields.ts:37`) feeds the customer cancel rule (mini app `order-status.ts`, web `lib/order-view.ts:211` `isGomdonPickedUp`) and the admin `RecyclingPanel`; removing the fields would re-enable cancel after pickup. M6.8b removes the customer-facing recycling copies only; the DTO fields stay (owner message lists it as a deviation).
32. D6 (amended by C25): e2e mocks follow the mini app type change in the same commit, and `test.fixme` markers added by M6 are removed by M8.7 against a zero baseline (hazard 15).
33. D9: `deskPoints` of `GET /waste/me` (and `GET /waste/desk/points`) comes from the role and staff rows only, whatever `eligibility` is (spec 15.1: every active STAFF/ADMIN gets the warehouse, a point staff gets their PARTNER points; with 8.17, no phone needed); the customer parts of `/me` (requests, caps, nearby list) stay omitted for GUEST/NEED_PHONE. M2.6b pins it with one test (STAFF without phone → `eligibility: 'NEED_PHONE'` and `deskPoints` contains the warehouse).
34. D4: M7.6b (gift cancel with `refundPoints`, QG hand-over) needs the opus reviewer (1.3); 1.3 also adds M4.4 (voucher value, Q1 default), M7.4c and M7.7a.
