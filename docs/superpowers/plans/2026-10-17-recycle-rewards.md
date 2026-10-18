# Đổi rác lấy quà (recycle rewards) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Cho chủ dự án: kế hoạch này viết bằng tiếng Anh cho các agent thực thi; mọi câu chữ khách nhìn thấy giữ nguyên tiếng Việt trong dấu nháy. Thứ tự đọc: mục "Global Constraints", "Review Focus", "Execution plan", rồi các phần M1 đến M8.

**Goal:** One merged programme "Đổi rác lấy quà": customers hand in packaging at a drop-off point, post it to the HCM warehouse, or hand it over with an order via Gomdon, and receive Điểm Xanh (STANDARD lot) or gifts after the receiving place counts; it replaces Refill, the Gomdon checkout toggle and the hard-coded `DEFAULT_REWARD_CATALOG`.

**Architecture:** One new NestJS module `waste-exchange` (five lane modules: core, customer, receiving, catalog, pickup) over twelve new Prisma tables created by one additive migration. Points are granted only inside the single confirm transaction, through `RewardPointsService.grant`, after the receiving place counts; every lock, hold and cap sits behind one set of shared helpers (registry sections 4.3, 4.6, 4.12). The mini app gets the `/recycle*` flow and the `/rewards*` gift store, the web admin gets one `waste` tab, and Refill, the old Gomdon toggle and the hard-coded catalogue are removed in the last milestone; the shared DTOs live in `packages/shared-types/src/waste.ts` and are frozen after M1.6.

**Tech Stack:** pnpm + turbo monorepo on Node 22; `apps/api` NestJS 10, Prisma 5.22, PostgreSQL 16, jest (race suite on a Docker database); `apps/miniapp` Zalo Mini App with React, zmp-ui, vitest; `apps/web` Next.js admin, vitest; `apps/e2e` Playwright; `packages/shared-types`.

**Spec:** `docs/superpowers/specs/2026-10-17-recycle-rewards-design.md` (Vietnamese, owner-approved 2026-10-17). Executors read the task, the spec sections its `Spec:` line names, and the registry sections it names.

## Global Constraints

Every task's requirements include this section. Quoted Vietnamese is verbatim from the spec; section numbers are the spec's.

Product rules
- Reward = Điểm Xanh, STANDARD lot, existing rules unchanged: "1 điểm = 1đ, hạn 12 tháng, dùng tối đa 20% giá trị đơn, không trả phí ship"; Tubu bottles also earn "2 giọt mỗi vỏ" (§3.1; changing the rules is a non-goal, §2).
- Điểm Xanh scale (owner decision of 2026-10-18, spec appendix "Đổi thang Điểm Xanh"): 1 điểm = 1đ, so every amount of Điểm Xanh in this plan and in the spec is a new-scale number (`waste.mailin_min_points` 15000, `waste.customer_monthly_cap_points` 60000, a carton 1000 điểm, a gift 20000 to 100000 điểm). The branch you work on already contains the points-1d package (`POINTS_GRANT_HARD_MAX` 2_000_000, `loyalty.vnd_per_point_redeem` locked at 1, `game.tree_points_price` 50_000); the plan never edits those constants or their guards. Where a mockup image or a traceability requirement list shows a smaller older number, the number in the spec and the plan wins.
- "Điểm chỉ do Tubu phát. Đại lý không tự phát điểm và không đặt tỉ giá." "Số điểm cộng luôn theo số lượng thực nhận và không vượt số khách khai." Points are credited only by the confirm transaction of §15.5, never before the receiving place counts (§2).
- "Pin không nhận ở đợt 1 (hiện "Sắp nhận")." (§3.5, §14.1)
- Not in this phase: cash for waste, withdrawing or transferring points, cash fees to partners, in-app map, AI recognition, label printing, shipping refunds by points, collection hubs, TubuXu (§2).
- Impact is weight only: "khối lượng ước tính = số thực nhận nhân trọng lượng mỗi đơn vị (`gramsPerUnit`, admin đặt)", shown with "ước tính theo khối lượng trung bình" and only when every item of the request has a weight. "Không có hệ số CO2e, không quy ra cây, không nói "tái chế", "hấp thụ" hay "giảm khí thải"." (§5.7, §14.7)
- "Không dùng "tái chế 100%", "xử lý đúng chuẩn" khi chưa có hợp đồng với đơn vị tái chế đầu ra." Cartons and bubble wrap are described as "dùng lại để đóng hàng" (§14.7).
- Defaults at deploy: programme off (`waste.enabled` false), pickup lane off (`waste.lane_pickup_enabled` false), hazardous battery item not ACTIVE, no real customers on the pilot build (§12.4, §14.8, §18.1).

Customer-visible copy (§16.1)
- Words: "Điểm Xanh", "giọt nước", "mã giảm giá". Banned: "xu" standing alone, "TubuXu", a displayed "voucher" (no "Voucher" in any form in the new flow), "Mã ưu đãi", lowercase "điểm Xanh", "cây thật", "mua cây", "CO2", "hấp thụ", "Mã chứng nhận", "PanNature", "Rừng Xanh Lên", `/merchant`, "Cổng đối tác", "Kênh Đối Tác". Text the server returns is not scanned, but `seed.ts` and the migration are, so the TREE gift is named "Góp quỹ trồng cây".
- Icons are icons, never emoji (only files on the allowed-emoji list may contain emoji). Numbers and dates go through `utils/format` (`formatPoints`, `formatDate`, `formatDateTime`); the mini app vitest run pins Asia/Ho_Chi_Minh (`vitest-global-setup.ts`), and the new waste date helpers are proven TZ-independent by `src/utils/waste-labels-tz.spec.ts` (M6.1b).

API rules (§15)
- Customer routes `/waste/*` need a real user with a phone number, no `waste_user_flags.blockedAt`, and `waste.enabled` on; otherwise 403 with a Vietnamese reason, except the read routes and the two routes `PUT /waste/requests/:id/tracking` and `POST /waste/requests/:id/cancel` listed in §15.1. The three `/me/loyalty/rewards*` routes keep their paths and are never blocked by `waste.enabled` (§8, §15.1, §15.2).
- Permission at a receiving place is re-read from the database on every call (conditions (a) to (d) of §15.1), and once more inside the transaction after the request row is locked.
- Every write route has `@Throttle`: "tạo yêu cầu, sửa yêu cầu và đổi quà 10 mỗi phút, xác nhận 30 mỗi phút; hai route tra mã (`desk/lookup`, `requests/lookup`) và `POST /waste/points/nearby` 30 mỗi phút theo người gọi."
- `Idempotency-Key` is required for create-request and redeem: 8 to 128 characters of `[A-Za-z0-9_-]`; a malformed key is 400, same key and same body replays the old result, same key and different body is 409. Gift claim codes `QG-` and tracking codes travel in the body, never in a URL.
- Owner-only access for request ids: queries and writes carry `userId` of the caller; another customer's request answers the same 404 as an unknown id. Customer responses are allow-listed DTOs and never carry `trackingConflict`, `trackingNorm`, `confirmedByUserId`, `reversedByUserId`, `carrierCostVnd`, `reversalShortfallPoints`, `idempotencyKey`, `capDayKey`, `capMonthKey`.
- `/admin/waste/...` responses mask customer phone and name (`maskPhoneOrNull`, `maskFullName`) unless the re-read role is `ADMIN`, and carry no customer `userId` unless the operation needs it; each route has a contract test.
- PATCH and PUT bodies use `@OptionalNotNull()` or `@ValidateIf(present)` so `null` is 400, not 500; DTO classes are declared in the controller file (patch-null-contract scans them).
- Vietnam calendar time only through `common/vn-time.ts` (`startOfVnMonth`, `startOfVnDay`, `vnMonthKey`, `vnDateKey`), never local `Date` methods.

Interface rules (§16)
- Mini app: every new page and component is added to `FILES` of `ds-c076-pc10c1.spec.ts` before it is written; one `h1` per page through `PageHeader`; no `Button` from zmp-ui under `src/pages/`; balances through `pointsSummary(x).total`, never `.pointsBalance`; progress and "Cần thêm N điểm" use the server's `redeemablePoints`, `canRedeem`, `soldOut`; nothing new under `components/game/`.
- Create-request and redeem keep their `Idempotency-Key` in a `useRef` tied to the content; after success refresh the query keys `['waste']`, `['loyalty']`, `['points-txn']`, `['game']`, and after a gift redeem also `['loyalty-rewards']` and `['coupons']`.
- Web admin: one `waste` tab ("Đổi rác") in the group "Khách hàng", registered in the four places of `app/admin/page.tsx`, nine menu groups kept; every new file added to `MIGRATED` of `ds-palette-pc11.spec.ts` before it is written; `lucide-react` icons; dates through `lib/format-date.ts`; component tests use the repo's `test-utils/dom.tsx` (no testing-library).
- e2e: an unmocked API call fails the test (`E2E_UNMOCKED`); every `/waste/*` call is mocked in the flow's own spec.

Process rules
- Commits stay local. Never push, open a PR, merge to main or deploy; the owner decides those separately.
- The migration folder name must sort after the newest folder in `apps/api/prisma/migrations/` on every local branch and worktree (check again at M1.1 and M8.2).
- Run Node from `$HOME/.local/node/node-v22.23.3-darwin-arm64/bin`. Race specs use the lane's own container `tubu_it_rr_<lane>` on its port (registry 4.14 Lane databases), with `DATABASE_URL` matching `/tubutree_it(\?|$)/`. Never use or stop `tubu_it_main` or an `lr-*` container (another session's), `tubu_pg`, `tubu_redis` or `chodeli-temp-db-12565`; never use `pkill` or a bare `git stash`.
- Comments explain a non-obvious why only; no comment describes the change just made.

## Review Focus

The spec says what the programme must do; these are the inputs and conditions it implies but does not spell out, that a person using the programme is most likely to meet, most likely first. Each line names the test, in the task that owns the code, that pins it.

1. A customer who hands in less than one whole group of points, or a counter who finds fewer items than declared: the done page never says "Đã cộng" for 0 points and the progress bars use the server's `redeemablePoints`; the confirm button stays locked until every short line has a reason, and the points shown equal the per-line floor sum. Pinned by M6.5c (`'0 điểm: nói thật là chưa đủ để cộng, không hiện "Đã cộng"'`), M6.6a (`'dòng thiếu phải có lý do …'`) and M7.5c (`wastePointsForLines`).
2. A MAIL_IN customer who ships on day 7 and types the waybill a few hours after `expiresAt`, before the daily sweep: the code is accepted, the request goes IN_TRANSIT and `expiresAt` becomes null (spec 12.3). Pinned by M2.9 (`'an OPEN MAIL_IN past expiresAt but not yet swept accepts the first code and clears expiresAt'`).
3. A production deploy that runs migrations only, never the seed: the five items, five gifts, 21 `waste.*` config rows and ten notification templates already exist, with the programme off and the hazardous battery item not ACTIVE; otherwise the admin screen is empty and the feature cannot be switched on. Pinned by the DB-level tests of M1.3, M1.4 and M1.5.
4. An order placed while its pickup request is closed or its customer is locked: no Gomdon order is created and the whole checkout rolls back with a 409. Pinned by M5.1, M5.2a and the M5.2b race cases `'ship-lock step 2 then checkout'` and `'checkout then ship-lock step 2'`.
5. Two people confirming at the same moment, or a customer editing while staff confirm: no deadlock, no double grant, the partner's monthly quota never exceeded. Pinned by M3.2a (unit case 1, the lock order), M3.2b (race cases 4, 6 and 7) and M1.2 (`'spec 11.4 statement increments atomically, refuses past the quota, and is exact under concurrency'`).

---

## Execution plan

The plan has 113 tasks in eight parts (M1 to M8), ordered in lanes that can run in parallel. A task is the unit a fresh worker executes: it sees its own task text, the part preamble (the text above the first `### Task` of its part file), the registry and contract sections the task names, and the spec sections of its `Spec:` line. Nothing else is promised to it.

### Where the work happens (local only)

- Integration branch: `feat/recycle-rewards`, in the worktree `.claude/worktrees/recycle-impl`. Nothing in this plan is pushed, opened as a PR, merged to `main` or deployed; the owner decides that separately.
- Base: before any lane starts, `feat/recycle-rewards` must contain the points-1d package, the owner's Điểm Xanh x1000 change of the existing code (1 điểm = 1đ). Check once on the integration worktree: `grep -n "POINTS_GRANT_HARD_MAX" apps/api/src/modules/wallet/reward-points.service.ts` shows 2_000_000, `loyalty.vnd_per_point_redeem` is hard-locked at 1 in `system-config.service.ts`, and `cd apps/api && npx jest src/modules/system-config/points-unit-guard.spec.ts` passes. Every point amount in this plan is on that scale; this plan never edits those constants or their guards, it only adds the four `waste.*_points` entries (M1.4) and deletes `DEFAULT_REWARD_CATALOG` (M4.2b).
- One worktree and branch per lane: `.claude/worktrees/recycle-<lane>` on `feat/recycle-<lane>`, created from the integration branch tip when the lane's stage starts. Lanes L1b and L1c branch from `feat/recycle-L1a` after M1.1 is committed there (M1.6 imports the Prisma enums M1.1 generates, and M1.7 needs the models).

```
git worktree add .claude/worktrees/recycle-<lane> -b feat/recycle-<lane> <base branch>   # run from the recycle-impl worktree
cd .claude/worktrees/recycle-<lane> && pnpm install --frozen-lockfile --prefer-offline && (cd apps/api && npx prisma generate) && pnpm --filter @tubutree/shared-types build
```

- Race databases: one container per lane that has race specs, named and ported as in registry 4.14 "Lane databases" (`tubu_it_rr_L1` 5581, `tubu_it_rr_L2` 5582, `tubu_it_rr_L3` 5583, `tubu_it_rr_L4` 5584, `tubu_it_rr_L5` 5585, `tubu_it_rr_L8` 5586, integration `tubu_it_rr_int` 5587; lanes L1b, L1c, L6, L7 have none). Start a container with the `docker run` line of registry 4.14 DB gate A, using the lane's name and port.

### Stages, lanes and merge order (registry 1.1, 1.2)

| Stage | Lanes that run in parallel | Tasks per lane (in order) | Starts when |
|---|---|---|---|
| S0 | L1a, L1b, L1c | L1a: M1.1 M1.2 M1.3 M1.4 M1.5; L1b: M1.7; L1c: M1.6 | start |
| S1 | L2core, L6, L7 | L2core: M2.1a M2.1 M2.2 M2.3a M2.3 M2.4 M2.5 M2.6a; L6 and L7 see the table below | M1 merged |
| S2 | L2cust, L3, L4, L5 (L6 and L7 may still be running) | L2cust: M2.6b M2.6c M2.7 M2.8a M2.8b M2.9 M2.10; L3: M3.1a M3.1b M3.1c M3.2a M3.2b M3.3 M3.4a M3.4b M3.4c M3.5 M3.6a M3.6b M3.6c M3.7a M3.7b M3.8a M3.8b; L4: M4.1 M4.2a M4.2b M4.2c M4.3a M4.3b M4.4 M4.5 M4.6a M4.6b M4.7a M4.7b M4.7c M4.8; L5: M5.1 M5.2a M5.2b M5.3 M5.4 M5.5 M5.6a M5.6b M5.6c M5.6d | M2-core merged |
| S3 | L8 | M8.2 M8.1a M8.1b M8.3 M8.4a M8.4b M8.5 M8.6a M8.6b M8.7a M8.7b M8.7c M8.7d M8.8a M8.8b M8.8c | every other lane merged |

Merge order into `feat/recycle-rewards`, always `git merge --no-ff`, after the lane's last task is committed and its lane gate is green: M1, M2-core (M2.1a to M2.6a), M2-cust, M3, M4, M5, M6, M7, then L8 as one lane. Conflicts are expected only in the append-only shared lists of registry 7 rule R0 (keep both sides) and in the hot-spot files of registry 2.9 (the listed order decides). After each stage merge, run the full gate (registry 4.14 "Full gate") on the integration worktree against `tubu_it_rr_int`; a red step is repaired by a new task assigned by the plan owner, never silently inside another task.

Before M1.1 and again before M8.2 run the migration folder-order proof (registry 4.14): the waste migration folder `20261019000000_waste_exchange` must sort after every folder on every local branch and worktree.

### How one task runs

1. A worker (Sonnet; high effort for tasks whose Gate says "opus reviewer required") follows the steps in order: failing test first, run it and see it fail for the stated reason, implement, run it green, run the Gate, commit. The commit message ends with the trailer `Plan-Task: <id>`.
2. A reviewer re-runs the task's Gate itself and checks the diff against the task text, the spec sections of the `Spec:` line and the registry hazards. It is an Opus reviewer for the 80 tasks whose Gate says "opus reviewer required" (registry 1.3: points, money, auth, customer messages, locks, production data) and a Sonnet reviewer for the rest.
3. BLOCKER and MAJOR findings go to a fixer (at most two rounds per task). A task still red after that stops its lane; the dispatcher reports it and does not skip it.
4. The dispatcher never trusts a worker's or reviewer's narration: it re-runs the Gate commands of every task it accepts.

The machine is shared and often loaded: a race spec that fails with `P2028` ("Transaction already closed" under load) is re-run once on its own before it is treated as a defect, and no more than the lanes of one stage run at the same time.

### Tasks

| Task | Title | Lane | Depends on | Opus reviewer |
|---|---|---|---|---|
| M1.1 | Prisma models + generated DDL | L1a | none | yes |
| M1.2 | Hand-written constraints + index pins + race test infra | L1a | M1.1 | yes |
| M1.3 | Reference data | L1a | M1.2 | yes |
| M1.4 | Config keys (D1) | L1a | M1.3 | yes |
| M1.5 | Notification templates (D2) | L1a | M1.4 | yes |
| M1.6 | Shared contract (D3) | L1c | M1.1 | no |
| M1.7 | Foundation code + module shells | L1b | M1.1 | yes |
| M2.1a | WasteConfigService | L2core | M1.4, M1.7 | yes |
| M2.1 | Public waste flags in /config/public | L2core | M2.1a | yes |
| M2.2 | Events, notifier, queue filters | L2core | M1.5, M1.7 | yes |
| M2.3a | Staff access, idempotency key, masking, messages | L2core | M1.7 | yes |
| M2.3 | WasteAccessService | L2core | M2.3a, M1.2 | yes |
| M2.4 | Caps and validateAndHold | L2core | M2.1a, M2.3 | yes |
| M2.5 | Ship-lock evaluation (15.6) | L2core | M2.2, M2.4, M2.3 | yes |
| M2.6a | Request mapper and read service | L2core | M2.5, M2.1a, M2-core | yes |
| M2.6b | Catalogue and /waste/me services | L2cust | M2.6a, M2.1 | yes |
| M2.6c | Customer controller, read routes | L2cust | M2.6b | yes |
| M2.7 | Preview and mail-in fee estimate | L2cust | M2.6c | no |
| M2.8a | Create request | L2cust | M2.7 | yes |
| M2.8b | Edit request | L2cust | M2.8a | yes |
| M2.9 | Tracking code and customer cancel | L2cust | M2.8b | yes |
| M2.10 | Guest merge, account-deletion and partner blockers | L2cust | M1.2 | yes |
| M3.1a | Quota counter and staff daily usage | L3 | M2.1a, M2.6a, M2-core | yes |
| M3.1b | Confirm-line validator | L3 | M3.1a | yes |
| M3.1c | Match evaluator | L3 | M3.1b | yes |
| M3.2a | Confirm transaction (service) | L3 | M3.1c | yes |
| M3.2b | Confirm race spec | L3 | M3.2a | yes |
| M3.3 | Reject and close-lost | L3 | M3.2b | yes |
| M3.4a | Receive (warehouse parcel intake) | L3 | M3.1c | yes |
| M3.4b | Unmatched parcels: create, list, resolve | L3 | M3.4a | yes |
| M3.4c | Receive race spec | L3 | M3.4b | yes |
| M3.5 | Reopen a late parcel | L3 | M3.4c, M3.3 | yes |
| M3.6a | RECYCLE_RULE in the points-expiry ledger | L3 | M3.2b | yes |
| M3.6b | Reverse points (service) | L3 | M3.6a | yes |
| M3.6c | Reverse race spec | L3 | M3.6b | yes |
| M3.7a | Desk service (points, lookup, perk) | L3 | M3.3 | yes |
| M3.7b | Desk controller | L3 | M3.7a | yes |
| M3.8a | Admin requests service: queue, lookup, detail, cost, user flags | L3 | M3.3, M3.4c, M3.5, M3.6c | yes |
| M3.8b | Admin requests controller | L3 | M3.8a, M3.7b | yes |
| M4.1 | Gift catalogue read + /mine (LoyaltyService) | L4 | M1.3, M2-core | yes |
| M4.2a | LoyaltyService staff check delegates to assertActiveStaff | L4 | M4.1 | yes |
| M4.2b | redeemReward on waste_gifts (catalogue constant removal, one commit) | L4 | M4.2a | yes |
| M4.2c | Gift redeem race spec (real Postgres) | L4 | M4.2b | yes |
| M4.3a | WasteGiftRedemptionsService (fulfil, cancel, queue) + gift-cancel race spec | L4 | M4.2c | yes |
| M4.3b | Desk and admin gift-redemption controllers + catalogue module wiring | L4 | M4.3a | yes |
| M4.4 | Admin gift catalogue CRUD, stock and order | L4 | M4.3b | yes |
| M4.5 | Admin waste items CRUD and order | L4 | M2-core | yes |
| M4.6a | Admin receiving points list, create, update, order | L4 | M2-core | yes |
| M4.6b | Point staff add/remove and perk approve/reject | L4 | M4.6a | yes |
| M4.7a | Monthly metrics function and `WasteReportsService.monthly` | L4 | M4.6b | yes |
| M4.7b | Anomaly alerts `computeWasteAlerts` | L4 | M4.7a | yes |
| M4.7c | Overview, monthly CSV, point reports and reports controller | L4 | M4.7b | yes |
| M4.8 | Ops inbox waste keys replace `refillPending` (API) | L4 | M2-core | yes |
| M5.1 | Attach helpers | L5 | M2-core | yes |
| M5.2a | Checkout integration (DTO, service, unit spec) | L5 | M5.1 | yes |
| M5.2b | Checkout attach race spec (ship lock × checkout with points) | L5 | M5.2a | yes |
| M5.3 | Order hooks | L5 | M2-core | yes |
| M5.4 | Expiry cron | L5 | M5.3, M5.2b | yes |
| M5.5 | Sweep cron | L5 | M5.3 | yes |
| M5.6a | Remove `recyclingEnabled` from `/config/public` (API) | L5 | M5.2a | no |
| M5.6b | Web checkout without the old recycling toggle | L5 | M5.6a | no |
| M5.6c | Remove the customer-side recycling components and helpers (web) | L5 | M5.6b | no |
| M5.6d | Drop stale `recyclingEnabled` mocks from the web checkout specs | L5 | M5.6c | no |
| M6.1a | Waste API client, idempotency hook, test fixtures | L6 | M1.6 | no |
| M6.1b | PublicConfig.waste, waste labels, new-flow copy guard | L6 | M6.1a | no |
| M6.7a | account-api reward types, ledger labels, loyalty page hands rewards to /rewards | L6 | M6.1b | yes |
| M6.2 | Timeline and waste point picker components | L6 | M6.1b | no |
| M6.3 | /recycle home and /recycle/rules | L6 | M6.2 | no |
| M6.4a | /recycle/new wizard (pick items, then pick a method) | L6 | M6.3 | yes |
| M6.4b | /recycle/points (nearby points list) | L6 | M6.4a | yes |
| M6.5a | /recycle/r/:id (track, QR, mail-in and pickup blocks) | L6 | M6.4b | no |
| M6.5b | /recycle/r/:id/edit and /recycle/requests | L6 | M6.5a | no |
| M6.5c | /recycle/done/:id (points credited) | L6 | M6.5b | no |
| M6.6a | /recycle/desk (lookup, count, confirm, reject) | L6 | M6.2 | yes |
| M6.6b | desk perk card, monthly report, gift hand-over | L6 | M6.6a | yes |
| M6.7b | /rewards (Kho quà) | L6 | M6.7a | yes |
| M6.7c | /rewards/mine (Quà của tôi) | L6 | M6.7b | yes |
| M6.8a | checkout "Thu kèm rác" toggle replaces the old Gomdon box | L6 | M6.5c | yes |
| M6.8b | order-detail request line; remove client Gomdon status copies | L6 | M6.8a | yes |
| M6.9a | entry points (Cá nhân, Vườn Xanh, Điểm Xanh) | L6 | M6.3, M6.5c, M6.6b, M6.7c, M6.9, M6.5, M6.6, M6.7 | no |
| M6.9b | notification routing for WASTE codes | L6 | M6.9a | no |
| M7.1a | Admin client waste functions | L7 | M1.6 | no |
| M7.1b | Register the waste tab (refill tab replaced) | L7 | M7.1a | no |
| M7.2 | Waste tab: chips, staff view, monthly strip, alerts | L7 | M7.1b | no |
| M7.3 | Items section (Hàng nhận) | L7 | M7.2 | no |
| M7.4a | Point register and edit form | L7 | M7.3 | no |
| M7.4b | Points section (Điểm nhận) table, filters, alerts | L7 | M7.4a | no |
| M7.4c | Point detail: people, perk review, credit log, month quantities | L7 | M7.4b | yes |
| M7.5a | Requests section: queues, lookup, warehouse receive | L7 | M7.4c | yes |
| M7.5b | Unmatched parcels (hàng không rõ chủ) | L7 | M7.5a | yes |
| M7.5c | Request detail: counting screen, reject, admin-only actions | L7 | M7.5b | yes |
| M7.5d | User drawer link and flags; requests filtered by customer | L7 | M7.5c | yes |
| M7.6a | Gifts section: catalogue and stock (admin) | L7 | M7.5d | no |
| M7.6b | Gift pickup queue (Trao / Huỷ) and engagement tab clean-up | L7 | M7.6a | yes |
| M7.7a | Waste config card and `waste.` money prefix | L7 | M7.6b | yes |
| M7.7b | Web ledger labels for recycle and gift reasons | L7 | M7.7a | no |
| M7.7c | Ops inbox web keys for waste queues | L7 | M7.7b | no |
| M8.2 | Go-live check `db.waste_point` replaces `db.refill_location` | L8 | none | yes |
| M8.1a | Swap the patch-null pin and drop Refill mentions in comments | L8 | M8.2 | yes |
| M8.1b | Delete the Refill API module, its race specs and its config keys | L8 | M8.1a | yes |
| M8.3 | Retire the REFILL_* templates and mark the Refill tables deprecated | L8 | M8.1b, M8.2, M4.8 | yes |
| M8.4a | Mini app — drop the "Duyệt đổi vỏ" tab and move the session-unavailable row to /recycle | L8 | M6.3, M6.1a | no |
| M8.4b | Mini app — delete the Refill page, service and picker; `/refill` redirects to `/recycle` | L8 | M8.4a | no |
| M8.5 | Web admin — delete the Refill tab, panel and client functions | L8 | M7.1b, M7.7c | no |
| M8.6a | Audit and UI/UX scripts — drop Refill, add the new routes, regenerate the endpoint lists | L8 | M8.4b, M8.5 | no |
| M8.6b | Docs — runbook, pilot playbook, Gomdon, go-live keys, README and the launch checklist | L8 | M8.6a | no |
| M8.7a | Playwright — shared waste mocks, `/recycle` customer flows and the desk golden path | L8 | none | no |
| M8.7b | Playwright — Kho quà (`/rewards`) and the loyalty page | L8 | M8.7a | no |
| M8.7c | Playwright — checkout "Thu kèm rác" attach flow replaces the old recycling toggle | L8 | M8.7a | no |
| M8.7d | Playwright — web admin waste tab | L8 | M8.7a | no |
| M8.8a | Race — cross-lane lock pairs in both orders | L8 | M8.1a, M8.7d | yes |
| M8.8b | Race — exactly one WasteEvent per successful write, across all routes | L8 | M8.8a | yes |
| M8.8c | Full gate, coupon-hash runbook query, final opus review | L8 | M8.8b | yes |

Items that are not tasks and stay with the owner (spec 17.1, 18.1): the launch checklist written by M8.6b (`docs/launch/recycle-rewards-launch-checklist.md`), the on-device check of each screen against its mockup, the written answer from Gomdon before `waste.lane_pickup_enabled` is switched on, the legal confirmations of spec 14.8, and the real-customer pilot. This plan builds and verifies the software only.

## Parts

Read the registry first: it is binding for every part (lanes and DAG, file map, interfaces, route table, test ownership, ordering hazards). Each part starts with a preamble that every task of that part inherits.

| File | What it holds |
|---|---|
| [registry.md](2026-10-17-recycle-rewards/registry.md) | Lanes, stages, task DAG, reviewer gate; file map and hot-spot edit order; interface registry (sections 4.x); route table; test ownership; ordering hazards; architect calls |
| [contract.md](2026-10-17-recycle-rewards/contract.md) | Names, types, literals and shapes that M1 creates (the shared-types contract) |
| [M1.md](2026-10-17-recycle-rewards/M1.md) | Data layer, config keys, notification templates, shared contract, foundation code |
| [M2.md](2026-10-17-recycle-rewards/M2.md) | Core services and the customer API (create, edit, tracking, cancel, merge) |
| [M3.md](2026-10-17-recycle-rewards/M3.md) | Receiving place: confirm, reject, receive, unmatched parcels, reopen, reverse, desk and admin request API |
| [M4.md](2026-10-17-recycle-rewards/M4.md) | Gifts (catalogue in the database, redeem, fulfil, cancel), admin catalogue API, reports, ops inbox |
| [M5.md](2026-10-17-recycle-rewards/M5.md) | Pickup with an order (Gomdon lane), hooks, expiry and sweep crons, removal of the old checkout toggle |
| [M6.md](2026-10-17-recycle-rewards/M6.md) | Mini app: `/recycle*` flow, desk, `/rewards*` gift store, entry points, notification routing |
| [M7.md](2026-10-17-recycle-rewards/M7.md) | Web admin: one `waste` tab (items, points, requests, gifts, config), inbox keys |
| [M8.md](2026-10-17-recycle-rewards/M8.md) | Refill removal, go-live checks, docs and launch checklist, e2e specs, cross-lane race specs, final gate |
| [traceability/README.md](2026-10-17-recycle-rewards/traceability/README.md) | Spec requirement lists and the coverage map from each requirement to the task step that pins it |
