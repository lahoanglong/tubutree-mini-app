# Data contract for "Đổi rác lấy quà" (written by the M1 author, read by the M2 to M8 authors)

Scope: names, types, literals and shapes that M1 creates. The registry (`registry.md`, section 4) stays binding; where this file adds something the registry leaves open it says "author decision". Anything the registry or the spec contradicts is listed in section 9. Paths: `api/` = `apps/api/src/`, `wx/` = `apps/api/src/modules/waste-exchange/`, `st/` = `packages/shared-types/src/`, `race/` = `apps/api/test/integration-race/`. The spec is `docs/superpowers/specs/2026-10-17-recycle-rewards-design.md` (cited as §x.y).

Conventions that hold for every table: Postgres table and column names are quoted camelCase in hand-written SQL (`"unitsPerPoint"`); ids are `String @id @default(cuid())` unless stated; `createdAt DateTime @default(now())`; `updatedAt DateTime @updatedAt` (NOT NULL, no DB default, so raw `INSERT` must supply `"updatedAt"`, for example `NOW()`); DTO dates are ISO strings, money is integer VND, points are integer Điểm Xanh.

## 1. Migration and database objects (item v and vi)

Migration folder: `apps/api/prisma/migrations/20261020000000_waste_exchange/migration.sql` (decision 4, review repo F17). It sorts after the newest folder of the base `feat/recycle-rewards` (`20261019120000_merchant_link_prev_rate`, from the launch branch) and after the folders of every other local branch (on 2026-10-18 both proof commands printed that same folder; re-run the proof, the value changes as other branches land). Before M1.1 (M1.1 Step 4a) and again before M8.2, run from the repository root:

```
for b in $(git for-each-ref --format='%(refname:short)' refs/heads); do git ls-tree --name-only $b apps/api/prisma/migrations/; done | xargs -n1 basename | grep -E '^[0-9]{14}_' | sort | tail -1
ls -d /Users/longla/coding/tubutree-mini-app/.claude/worktrees/*/apps/api/prisma/migrations/*/ | xargs -n1 basename | sort | tail -1
```

The folder must sort after both outputs; if a launch-review migration merges to main first, M8.2 recounts the go-live pins. One file, five sections in this order, written by five tasks:

| Section | Written by | Delimiter inside the file |
|---|---|---|
| header comment (Vietnamese; its first line gives the reason and contains "Chỉ THÊM", spec 11.7) + generated DDL (enums, tables, plain indexes, foreign keys) | M1.1 | none (everything above the first marker) |
| hand-written partial unique indexes and CHECKs | M1.2 | `-- BEGIN WASTE HAND-WRITTEN CONSTRAINTS` / `-- END WASTE HAND-WRITTEN CONSTRAINTS` |
| reference data (5 items, 5 gifts) | M1.3 | `-- BEGIN WASTE SEED DATA` / `-- END WASTE SEED DATA` |
| `system_configs` rows (21 keys) | M1.4 | `-- BEGIN WASTE CONFIG ROWS` / `-- END WASTE CONFIG ROWS` |
| `notification_templates` rows (10) | M1.5 | `-- BEGIN WASTE TEMPLATES` / `-- END WASTE TEMPLATES` |

Marker lines are author decisions (the registry only fixes the order). They are comment lines, so they are invisible to the SQL splitter and to `check-partial-indexes.ts`.

Partial unique indexes (five, all top-level statements, no `;` or `--` inside, never in a `DO` block). Exact statements are pinned in M1.2:

| Name | Table | Columns | Predicate |
|---|---|---|---|
| `points_transactions_recycle_ref_key` | `points_transactions` | `("refId")` | `"refType" = 'RECYCLE'` |
| `points_transactions_recycle_reverse_key` | `points_transactions` | `("refId")` | `"refType" = 'RECYCLE_REVERSED'` |
| `points_transactions_gift_refund_key` | `points_transactions` | `("refId")` | `"refType" = 'GIFT_REFUND'` |
| `waste_points_one_warehouse_key` | `waste_points` | `("kind")` | `"kind" = 'WAREHOUSE'` |
| `waste_point_staff_one_owner_key` | `waste_point_staff` | `("pointId")` | `"role" = 'OWNER' AND "isActive"` |

The first three are added to `KNOWN_PARTIAL_UNIQUE_INDEXES` (20 to 23, sorted) and the race pin becomes 23. The last two are discovered by the checker from the migration text.

CHECK constraints (sixteen, each in its own `DO $$ BEGIN ALTER TABLE ... ADD CONSTRAINT ... CHECK (...); EXCEPTION WHEN duplicate_object THEN NULL; END $$;` block). Expressions are pinned in M1.2; names are the registry section 4.1.3 names:

`waste_items_hazardous_not_active_chk`, `waste_items_units_per_point_chk`, `waste_items_points_per_group_chk`, `waste_items_drops_chk`, `waste_items_daily_cap_chk`, `waste_items_monthly_cap_chk`, `waste_points_partner_quota_chk`, `waste_points_warehouse_active_chk`, `waste_requests_expires_at_chk`, `waste_request_lines_received_chk`, `waste_request_lines_declared_chk`, `waste_point_usage_points_chk`, `waste_gifts_stock_chk`, `waste_gifts_voucher_fields_chk`, `waste_gifts_points_cost_chk`, `waste_gift_redemptions_ready_chk`.

Plain unique constraints and indexes come from `schema.prisma` (generated, not hand-written): `waste_items.code`, `waste_requests.code`, `waste_requests.orderId`, `waste_gift_redemptions.code`, `(userId, idempotencyKey)` on requests and on redemptions, `(pointId, userId)` on staff, `(requestId, itemId)` on lines.

Error text the database gives (used by tests): CHECK violation message contains `violates check constraint "<name>"`; unique violation contains `violates unique constraint "<name>"` for raw SQL, and Prisma client calls fail with `code: 'P2002'`.

Race-suite facts (`ci.yml` does not run them; `.github/workflows/race.yml` runs the whole suite on a PR into main that touches `apps/api/**`, `packages/shared-types/**` or `pnpm-lock.yaml`, nightly and by hand): container `tubu_it_main`, port 5550, database `tubutree_it` (main checkout; a lane running in parallel uses its own `tubu_it_rr_<lane>` container and port, registry 4.14 "Lane databases"). `apps/api/tsconfig.json` excludes `test/`, so race specs are not type-checked by `pnpm --filter @tubutree/api typecheck`, and ts-jest transpiles them with `isolatedModules: true`, so no tool reports a type error in them (read them for types at review); the race run is their check of behaviour.

## 2. Prisma enums (item ii, part 1) and models (item i)

Relation field names are pinned (later lanes write `include:` with them); the full list is in Task M1.1 "Interfaces" of M1.md.

Fourteen enums, values in this exact order:

- `WasteItemStatus`: ACTIVE, COMING_SOON, HIDDEN
- `WastePointKind`: WAREHOUSE, PARTNER
- `WastePointStatus`: ACTIVE, PAUSED, PENDING
- `WastePointStaffRole`: OWNER, STAFF
- `WasteMethod`: DROP_OFF, MAIL_IN, PICKUP
- `WasteRequestStatus`: OPEN, IN_TRANSIT, RECEIVED, COMPLETED, REJECTED, CANCELLED, EXPIRED, REVERSED
- `WasteCloseReason`: HOLD_EXPIRED, PICKUP_NO_SHOW, PICKUP_NOT_DISPATCHED, LOST, LOST_AT_WAREHOUSE, SHIP_LOCKED, ORDER_CANCELLED
- `WasteRejectionReason`: WET, DIRTY, FOREIGN_OBJECT, WRONG_TYPE, DAMAGED, NOT_ACCEPTED, OVERSIZE, HAZARDOUS, UNPAID_POSTAGE, OTHER
- `WasteShortfallReason`: WET, DIRTY, FOREIGN_OBJECT, WRONG_TYPE, DAMAGED, NOT_ACCEPTED, OTHER
- `WasteActorRole`: CUSTOMER, POINT_STAFF, STAFF, ADMIN, SYSTEM
- `WasteUnmatchedStatus`: OPEN, RESOLVED
- `WasteGiftKind`: VOUCHER, TREE, SEED_PACK, GIFT
- `WasteGiftStatus`: ACTIVE, HIDDEN
- `WasteGiftRedemptionStatus`: READY, FULFILLED, CANCELLED

The voucher discount type reuses the existing enum `CouponType { PERCENT AMOUNT FREESHIP }` (`schema.prisma:1314`, used by `Coupon.type` at :1333; registry 4.1 and 8.27, resolved by review repo F14 and coverage F13, decision 1). `WasteGift.voucherType CouponType?`. Shared types reuse the existing `CouponType` of `st/enums.ts:58-63` (a const object plus a type of the same name) for `RewardItemDTO.voucher.type`.

Twelve models. Notation: `name:Type`, `?` = nullable, `=x` = default. FK `onDelete` is stated per relation. All FKs not listed do not exist.

1. `WasteItem` (`waste_items`): id, code:String @unique, name, unitLabel, unitsPerPoint:Int, pointsPerGroup:Int, dropsPerUnit:Int =0, dailyCapQty:Int?, monthlyCapQty:Int?, status:WasteItemStatus =HIDDEN, prepInstructions:String?, imageUrl:String?, sortOrder:Int =0, gramsPerUnit:Int?, hazardous:Boolean =false, createdAt, updatedAt. Index `(status, sortOrder)`. Relations: `pointLinks WastePointItem[]`, `requestLines WasteRequestLine[]`.
2. `WastePoint` (`waste_points`): id, kind:WastePointKind, name, addressLine, provinceCode, provinceName, communeCode, communeName, lat:Float?, lng:Float?, phone:String?, openingHours:Json =`"{}"`, status:WastePointStatus =PENDING, monthlyQuotaPoints:Int?, perkText:String?, perkPendingText:String?, giftHandoverEnabled:Boolean =false, note:String?, sortOrder:Int =0, activatedAt:DateTime?, lastConfirmedAt:DateTime?, createdAt, updatedAt. Indexes `(kind, status)`, `(provinceCode, status)`. No FK to `storefronts`. Relations: `items WastePointItem[]`, `staff WastePointStaff[]`, `usage WastePointUsage[]`, `requests WasteRequest[]`.
3. `WastePointItem` (`waste_point_items`): pointId (FK to WastePoint, Cascade), itemId (FK to WasteItem, Restrict), `@@id([pointId, itemId])`, index `(itemId)`.
4. `WastePointStaff` (`waste_point_staff`): id, pointId (FK Cascade), userId (FK to User, Restrict), role:WastePointStaffRole =STAFF, isActive:Boolean =true, createdAt, updatedAt; `@@unique([pointId, userId])`, index `(userId, isActive)`.
5. `WastePointUsage` (`waste_point_usage`): pointId (FK Cascade), monthKey:String, pointsUsed:Int =0, confirmations:Int =0; `@@id([pointId, monthKey])`. Exactly four columns, because the SQL of spec §11.4 inserts only those four.
6. `WasteRequest` (`waste_requests`): id, code:String @unique, userId (FK to User, Restrict), method:WasteMethod, status:WasteRequestStatus =OPEN, pointId (FK to WastePoint, Restrict, required), orderId:String? @unique (FK to Order, Restrict), carrier:String?, trackingCode:String?, trackingNorm:String?, trackingConflict:Boolean =false, estimatedPoints:Int, estimatedDrops:Int =0, capDayKey:String, capMonthKey:String, expiresAt:DateTime?, inTransitAt:DateTime?, receivedAt:DateTime?, completedAt:DateTime?, closedAt:DateTime?, closeReason:WasteCloseReason?, confirmedByUserId:String?, pointsAwarded:Int?, dropsAwarded:Int?, receivedWeightGrams:Int?, carrierCostVnd:Int?, rejectionReason:WasteRejectionReason?, rejectionNote:String? @db.VarChar(500), reversedAt:DateTime?, reversedByUserId:String?, reversalReason:String?, reversalShortfallPoints:Int?, idempotencyKey:String, consentAt:DateTime, consentVersion:String, createdAt, updatedAt. Constraints: `@@unique([userId, idempotencyKey])`; indexes `(trackingNorm)`, `(userId, status)`, `(status, method)`, `(capMonthKey)`, `(confirmedByUserId, completedAt)`, `(pointId, status)`, `(status, expiresAt)`. `(confirmedByUserId, completedAt)` serves the staff daily-cap sum that confirm runs under the request row lock and the STAFF_CAP lock (review concurrency F13); the last two are author decisions (desk queue and expiry cron). All three are recorded in registry 4.1 (decision 9). Relations: `lines WasteRequestLine[]`, `user User`, `point WastePoint`, `order Order?`.
7. `WasteRequestLine` (`waste_request_lines`): id, requestId (FK Cascade), itemId (FK Restrict), itemCode, itemName, unitLabel, unitsPerPoint:Int, pointsPerGroup:Int, dropsPerUnit:Int, gramsPerUnit:Int?, declaredQty:Int, receivedQty:Int?, shortfallReason:WasteShortfallReason?, pointsAwarded:Int?; `@@unique([requestId, itemId])`, index `(itemId)`.
8. `WasteEvent` (`waste_events`): id, createdAt, kind:String, requestId:String?, pointId:String?, giftRedemptionId:String?, actorUserId:String?, actorRole:WasteActorRole, meta:Json?. No relations at all. Indexes `(requestId, createdAt)`, `(pointId, kind, createdAt)`, `(actorUserId, kind, createdAt)`.
9. `WasteUnmatchedParcel` (`waste_unmatched_parcels`): id, receivedAt:DateTime =now(), createdByUserId:String, carrier:String?, trackingCode:String?, trackingNorm:String?, description:String @db.VarChar(200), reason:String (value of `WasteUnmatchedReason`, section 3), relatedRequestId:String?, status:WasteUnmatchedStatus =OPEN, matchedRequestId:String?, resolvedByUserId:String?, resolvedAt:DateTime?, resolveNote:String?. No relations. Indexes `(status, receivedAt)`, `(trackingNorm)` (author decisions).
10. `WasteUserFlags` (`waste_user_flags`): userId:String @id (FK to User, Restrict), shipLockedAt:DateTime?, shipUnlockedAt:DateTime?, blockedAt:DateTime?, reason:String?, setByUserId:String? (no FK), updatedAt:DateTime @updatedAt. Back-relation `User.wasteFlags WasteUserFlags?`.
11. `WasteGift` (`waste_gifts`): id:String @id (no default), kind:WasteGiftKind, name, description:String?, label:String?, pointsCost:Int, status:WasteGiftStatus =HIDDEN, sortOrder:Int =0, imageUrl:String?, stock:Int?, claimInstructions:String?, voucherType:CouponType?, voucherValue:Int?, voucherMinOrder:Int?, voucherMaxDiscount:Int?, voucherValidDays:Int?, createdAt, updatedAt. Index `(status, sortOrder)`. Relation `redemptions WasteGiftRedemption[]`.
12. `WasteGiftRedemption` (`waste_gift_redemptions`): id, userId (FK to User, Restrict), giftId (FK to WasteGift, Restrict), giftKind:WasteGiftKind, giftName:String, pointsCost:Int, status:WasteGiftRedemptionStatus, code:String? @unique, couponId:String? (no FK: the coupon cleanup cron deletes coupons), idempotencyKey:String, claimExpiresAt:DateTime?, fulfilledAt:DateTime?, fulfilledByUserId:String?, fulfilledPointId:String?, cancelledAt:DateTime?, cancelledByUserId:String?, cancelReason:String?, refundedPoints:Int?, createdAt; `@@unique([userId, idempotencyKey])`, `@@index([status, claimExpiresAt])`, `@@index([userId, createdAt])`.

Back-relations added to existing models: `User.wasteRequests WasteRequest[]`, `User.wasteGiftRedemptions WasteGiftRedemption[]`, `User.wastePointStaff WastePointStaff[]`, `User.wasteFlags WasteUserFlags?`; `Order.wasteRequest WasteRequest?`. None of these adds a column to `users` or `orders`.

Author decisions on defaults: `WasteItem.status` and `WasteGift.status` default `HIDDEN` and `WastePoint.status` default `PENDING`, so a record created without an explicit status is never exposed to customers. The warehouse row and seeded rows state their status explicitly.

## 3. Closed lists and code constants (item ii, part 2)

All of these are exported from `wx/waste.constants.ts` (M1.7) unless another file is named. Literal values are in registry section 4.3; they are repeated here only where other authors must type them.

- Lock classes `WASTE_LOCK_CLASS = { CUSTOMER: 731001, TRACKING: 731002, STAFF_CAP: 731003, POINT_CREATE: 731004 }`. The class number is written inside the SQL text (two-key form), never bound. The four helpers of `wx/waste-locks.ts` call `tx.$executeRaw` (`pg_advisory_xact_lock` returns `void`, which `$queryRaw` cannot deserialize; `$queryRaw` is only for `pg_try_advisory_xact_lock`, which returns boolean; review concurrency F8, decision 11).
- `WASTE_CONSENT_VERSION = '2026-10-17.1'`.
- Code alphabet (30 characters, Crockford base32 without 0, O, 1, I, L and U): `23456789ABCDEFGHJKMNPQRSTVWXYZ`. Pattern for tra mã: `^(TR-[2-9A-HJKMNP-TV-Z]{5}|QG-[2-9A-HJKMNP-TV-Z]{8})$`.
- `WASTE_REQUEST_POINTS_MAX = 2000000`, `WASTE_POINTS_MAX_PER_SITE = 200`, `WASTE_MAX_STAFF_PER_POINT = 5`, `WASTE_RECEIVE_REPLAY_MS = 600000`, `WASTE_DESK_RECENT_MS = 86400000`.
- `GOMDON_DISPATCHED_STATUSES = ['3','4','5','7']`; `WASTE_OPEN_STATUSES = ['OPEN','IN_TRANSIT','RECEIVED']`; `WASTE_CAP_STATUSES = ['OPEN','IN_TRANSIT','RECEIVED','COMPLETED','REVERSED']`.
- `WASTE_EVENT_KINDS` (41 values, `waste_events.kind` is a free `String` column validated in code): REQUEST_CREATED, REQUEST_EDITED, TRACKING_SET, TRACKING_EDITED, REQUEST_CANCELLED, REQUEST_ATTACHED, PICKUP_STARTED, PICKUP_ORDER_CANCELLED, REQUEST_EXPIRED, HOOK_ANOMALY, SHIP_LOCKED, REQUEST_CANCELLED_SHIP_LOCK, PARCEL_RECEIVED, PARCEL_UNMATCHED, UNMATCHED_RECORDED, UNMATCHED_RESOLVED, UNMATCHED_CLOSED, REQUEST_CONFIRMED, REQUEST_REJECTED, LOOKUP_MISS, POINTS_REVERSED, REQUEST_CLOSED_LOST, REQUEST_REOPENED, REQUEST_COST_UPDATED, PERK_SUBMITTED, PERK_APPROVED, PERK_REJECTED, ITEM_CREATED, ITEM_UPDATED, ITEMS_REORDERED, POINT_CREATED, POINT_UPDATED, POINTS_REORDERED, POINT_STAFF_ADDED, POINT_STAFF_REMOVED, GIFT_CREATED, GIFT_UPDATED, GIFTS_REORDERED, GIFT_FULFILLED, GIFT_CANCELLED, USER_FLAGS_UPDATED.
- Closed lists that are TypeScript unions in `st/waste.ts` (M1.6), with sibling `WASTE_<NAME>_VALUES` tuples: `WasteMatchBasis` = TR_CODE, TRACKING_PHONE, MANUAL, ORDER; `WasteUnmatchedReason` = NO_MATCH, TRACKING_MULTI, TR_TRACKING_CONFLICT, EXPIRED_REQUEST, NOT_RECEIVABLE, MANUAL_ENTRY; `WasteEligibility` = OK, GUEST, NEED_PHONE; `WasteWeekday` = MON, TUE, WED, THU, FRI, SAT, SUN; `WastePreviewBlock` = BELOW_MIN, MONTH_CAP_FOR_MIN, ITEM_MONTH_CAP, ITEM_DAY_CAP, POINTS_MONTH_CAP, POINT_QUOTA_FULL, POINT_UNAVAILABLE, ITEM_NOT_ACTIVE, POINT_MISSING_ITEMS, LANE_DISABLED, SHIP_LOCKED, MAX_OPEN, PICKUP_PENDING, NEED_PROVINCE; `WasteAlertKind` = QUOTA_PACE, FULL_MATCH, FULL_MATCH_CONFIRMER, AVG_UNITS, AVG_UNITS_CONFIRMER, REPEAT_CUSTOMER, LOOKUP_MISS, STAFF_ACCOUNT_CONFIRMED, STAFF_DIRECT; `WasteRequestQueueFilter` = TO_COUNT, EXPIRED, CUSTOMER_BLOCKED, ORDER_NOT_DELIVERED, TRANSIT_OVERDUE, ORDER_MISMATCH. The other fourteen unions equal the Prisma enums of section 2 and are checked against `@prisma/client` by `wx/waste-contract.spec.ts`.

Pure helper semantics pinned in M1.7 (author decisions where the registry gives only a signature):
- `normalizeWasteCode(raw)` and `normalizeTracking(raw)`: `raw.toUpperCase().replace(/\s+/g, '')`.
- `generateWasteCode(kind, rand)`: prefix `TR-` plus 5 or `QG-` plus 8 characters, each `WASTE_CODE_ALPHABET[rand(30)]`, default `rand` is `crypto.randomInt`.
- `lookupMissMeta(raw)`: normalise first; `length` is the length after normalisation; `classes` is the subset of `L` (letters), `D` (digits), `S` (any other non-space character) in that fixed order; `code` is present only when the normalised text matches the pattern above.
- `unitsToNextPoint(qty, s)` = `s.unitsPerPoint - (qty % s.unitsPerPoint)`, always between 1 and `unitsPerPoint`.

## 4. Config keys (item iii)

Single record in `wx/waste-config.keys.ts` (M1.4). Twenty-one keys, category `waste`, every seed row `createOnly: true`, every numeric key an integer enforced by `SystemConfigService.RANGES` with `integer: true`.

| Key | Type | Default | Bounds | Description (keys file, seed row, migration row, verbatim) |
|---|---|---|---|---|
| `waste.enabled` | boolean | false | | Cờ tổng của chương trình Đổi rác lấy quà, tắt thì khách không tạo được yêu cầu mới và bàn đại lý bị chặn, kho vẫn xử lý yêu cầu đã có. |
| `waste.lane_dropoff_enabled` | boolean | true | | Bật cách giao Mang tới điểm nhận cho yêu cầu mới. |
| `waste.lane_mailin_enabled` | boolean | true | | Bật cách giao Gửi về kho cho yêu cầu mới. |
| `waste.lane_pickup_enabled` | boolean | false | | Bật cách giao Thu kèm đơn cho yêu cầu mới, còn cần cờ Gomdon hiện có. |
| `waste.mailin_min_points` | int | 15000 | 1 to 1000000 | Số Điểm Xanh tối thiểu của một gói gửi kho, không được lớn hơn trần điểm tháng của khách. |
| `waste.pickup_min_points` | int | 10000 | 1 to 1000000 | Số Điểm Xanh tối thiểu của một gói thu kèm đơn, không được lớn hơn trần điểm tháng của khách. |
| `waste.customer_monthly_cap_points` | int | 60000 | 1 to 2000000 | Trần Điểm Xanh mỗi khách được cộng từ đổi rác trong một tháng. |
| `waste.max_open_requests` | int | 3 | 1 to 20 | Số yêu cầu đổi rác một khách được mở cùng lúc. |
| `waste.request_hold_days` | int | 7 | 1 to 60 | Số ngày giữ chỗ một yêu cầu và chờ khách nhập mã vận đơn. |
| `waste.pickup_wait_days` | int | 14 | 1 to 90 | Số ngày chờ hàng thu kèm về kho sau khi đơn mua đã giao. |
| `waste.in_transit_review_days` | int | 30 | 7 to 180 | Yêu cầu gửi kho đang vận chuyển quá ngần này ngày thì vào danh sách admin xem lại. |
| `waste.mailin_max_weight_kg` | int | 20 | 1 to 50 | Khối lượng tối đa của mỗi kiện gửi kho, tính bằng kg, theo giới hạn của hãng chuyển phát. |
| `waste.mailin_max_edge_cm` | int | 50 | 10 to 200 | Cạnh dài tối đa của mỗi kiện gửi kho, tính bằng cm. |
| `waste.shortfall_lock_pct` | int | 50 | 1 to 100 | Yêu cầu hoàn tất mà điểm cộng chưa tới (100 trừ ngần này) phần trăm điểm ước tính thì tính là một lần nhận thiếu. |
| `waste.shortfall_lock_streak` | int | 3 | 2 to 10 | Số lần nhận thiếu liền nhau thì khoá đường gửi kho và thu kèm đơn của khách. |
| `waste.staff_daily_cap_points` | int | 1000000 | 1 to 20000000 | Trần Điểm Xanh mỗi nhân viên kho hoặc điểm nhận được xác nhận trong một ngày. |
| `waste.gift_claim_days` | int | 60 | 7 to 365 | Số ngày khách được nhận quà bằng mã, quá hạn thì lượt đổi vào danh sách admin xem lại. |
| `waste.point_inactive_days` | int | 60 | 7 to 365 | Điểm nhận đối tác không có lượt xác nhận nào quá ngần này ngày kể từ lần xác nhận cuối hoặc lần kích hoạt thì bị ẩn khỏi danh sách khách. |
| `waste.mailin_fee_table` | json | `{"zones":[],"defaultZone":{"name":"Toàn quốc","low":30000,"high":85000}}` | JSON rule below | Bảng ước tính phí ship gửi kho theo vùng tỉnh, mỗi vùng có phí thấp và phí cao, cộng một vùng mặc định cho tỉnh chưa xếp. |
| `waste.alert_thresholds` | json | `{"quotaPacePct":60,"quotaPaceDays":10,"fullMatchPct":95,"fullMatchMinSample":10,"repeatCustomerCount":3,"repeatCustomerDays":7,"avgUnitsFactor":2,"lookupMissCount":10,"lookupMissDays":1,"staffDirectCount":5,"staffDirectDays":7}` | JSON rule below | Ngưỡng cảnh báo bất thường về điểm nhận và người xác nhận, chỉ để admin xem, không tự khoá ai. |
| `waste.rules_text` | string | `""` | string of at most 8000 characters | Thể lệ công khai của chương trình, tối đa 8000 ký tự, để trống thì mục Thể lệ hiện ghi chú sắp có. |

Keys ending in `_points` (four: `waste.mailin_min_points`, `waste.pickup_min_points`, `waste.customer_monthly_cap_points`, `waste.staff_daily_cap_points`) are also entries of `POINTS_NUMBER_KEYS` with `max` 1000000, 1000000, 2000000, 20000000, so `max + 1` is rejected and the guard finds a bound for every `_points` key.

JSON rules (author decisions; the spec only says "JSON_RULES"):
- `waste.mailin_fee_table`: an object with `zones` (array of at most 20 items) and `defaultZone`. A zone is `{ name: non-empty string up to 60 chars, provinceCodes: array of non-empty strings (no code may appear in two zones), low: integer 0 to 500000, high: integer from low to 500000 }`; `defaultZone` is `{ name, low, high }` with the same rules.
- `waste.alert_thresholds`: an object with exactly the eleven keys of the default and no others. `quotaPacePct` and `fullMatchPct` are integers 1 to 100; the four `*Days` keys are integers 1 to 31; `fullMatchMinSample`, `repeatCustomerCount`, `lookupMissCount`, `staffDirectCount` are integers 1 to 1000; `avgUnitsFactor` is a number from 1 to 20.
- Every JSON rule checks with typeof that an item is a non-null object before it reads fields and rejects anything else with BadRequestException: the rule returns a Vietnamese problem text for a malformed value (for example `zones: [null]`, `zones: ['x']`, `defaultZone: null`, `provinceCodes: null`, `quotaPacePct: '60'`), which `SystemConfigService.set` throws as `BadRequestException`; a rule never throws a `TypeError` (that would be an HTTP 500).

Extra exports of `waste-config.keys.ts` beyond the registry (additive): `WASTE_RANGES`, `WASTE_JSON_RULES`, `WASTE_BOOLEAN_KEYS`. They are consumed by `system-config.service.ts` (spread into `RANGES` and `JSON_RULES`) and by the four literal `assertBoolean` entries of `admin-config-rules.ts`.

Readers of the keys at runtime (M2.1 `WasteConfigService.snapshot`, `computeWastePublicFlags`, M5 `readPickupGate`) must pass the literal key string, for example `config.get('waste.enabled', false)`; `dead-config-keys.spec.ts` only checks that some non-spec source file contains the quoted key, and `waste-config.keys.ts` already satisfies it for all 21. Mitigation (binding, review coverage F15): `waste-config.keys.spec.ts` asserts that every `WASTE_CONFIG_KEYS` key occurs as a quoted literal in a non-spec file other than `waste-config.keys.ts`. That assertion cannot pass at M1.4 (no reader exists yet), so it is added by the task that adds the readers (M2.1), not by M1.4.

## 5. Notification templates (item iv)

Ten templates, channel `INAPP`, seed `createOnly: true`, migration `INSERT ... ON CONFLICT DO NOTHING`, one tuple per line `('<id>', '<CODE>', 'INAPP', '<body>')`. Bodies contain no apostrophe, no emoji, no standalone "xu", no "voucher". Free-text placeholders (`result`, `reason`, `detail`) never end with a full stop because the template adds it. Final copy (author draft, editable by the owner before launch, but seed and migration must stay identical):

| Code | Template id | Body | Placeholders | `dedupeKey` | Routing id in `data` |
|---|---|---|---|---|---|
| WASTE_PARCEL_RECEIVED | nt-waste-parcel-received | Kho Tubu đã nhận kiện của yêu cầu {{code}}. Tubu sẽ đếm và báo bạn kết quả cộng Điểm Xanh. | `code` | `waste:<requestId>:RECEIVED:<receiveEventId>` | `request_id` |
| WASTE_POINTS_CREDITED | nt-waste-points-credited | Yêu cầu {{code}} đã đếm xong. {{result}}. | `code`, `result` | `waste:<requestId>:COMPLETED` | `request_id` |
| WASTE_REQUEST_REJECTED | nt-waste-request-rejected | Yêu cầu {{code}} chưa được nhận: {{reason}}. Bạn xem chi tiết trong mục Đổi rác. | `code`, `reason` | `waste:<requestId>:REJECTED` | `request_id` |
| WASTE_REQUEST_EXPIRED | nt-waste-request-expired | Yêu cầu {{code}} đã đóng: {{detail}}. | `code`, `detail` | `waste:<requestId>:EXPIRED:<closedAt.toISOString()>` | `request_id` |
| WASTE_PICKUP_STARTED | nt-waste-pickup-started | Đơn mua của bạn đã giao. Nếu bưu tá đã nhận túi rác của yêu cầu {{code}}, túi sẽ về kho Tubu. Tubu chờ túi tới khoảng ngày {{until}}. | `code`, `until` | `waste:<requestId>:IN_TRANSIT` | `request_id` |
| WASTE_PICKUP_CANCELLED | nt-waste-pickup-cancelled | Đơn mua bị huỷ nên yêu cầu thu kèm rác {{code}} cũng đã đóng. Bạn tạo yêu cầu mới trong mục Đổi rác khi cần. | `code` | `waste:<requestId>:CANCELLED` | `request_id` |
| WASTE_POINTS_REVERSED | nt-waste-points-reversed | Tubu đã thu hồi {{points}} Điểm Xanh của yêu cầu {{code}}. Lý do: {{reason}}. | `code`, `points`, `reason` | `waste:<requestId>:REVERSED` | `request_id` |
| WASTE_SHIP_LOCKED | nt-waste-ship-locked | Đường gửi kho và thu kèm đơn đang tạm dừng với tài khoản của bạn. Bạn vẫn mang rác tới điểm nhận được. Yêu cầu thu kèm chưa gắn đơn (nếu có) sẽ được huỷ. Cần hỗ trợ, liên hệ Tubu Tree. | none | `waste-lock:<userId>:<shipLockedAt ISO>` | none |
| WASTE_GIFT_CANCELLED | nt-waste-gift-cancelled | Lượt đổi quà {{gift}} đã bị huỷ.{{points_note}} | `gift`, `points_note` (starts with a space, for example " Tubu đã hoàn 50.000 Điểm Xanh vào tài khoản của bạn." or " Lượt đổi này không được hoàn điểm.") | `waste-gift:<redemptionId>:CANCELLED` | `redemption_id` |
| WASTE_PERK_REVIEWED | nt-waste-perk-reviewed | Ưu đãi riêng của điểm nhận {{point}}: {{result}}. | `point`, `result` ("đã được duyệt" or "chưa được duyệt") | `waste-perk:<pointId>:<reviewEventId>` | `point_id` |

`wx/waste-notify.codes.ts` exports `WASTE_TEMPLATE_CODES` (the ten codes in the table order) and `WasteTemplateCode`. `notify()` calls must pass the code as a string literal (the gate spec `notification-templates-seed.spec.ts` scans for `notify(<userId>, 'CODE'`).

## 6. Reference data seeded by the migration and seed.ts (M1.3)

Items (id, code, name, unitLabel, unitsPerPoint to pointsPerGroup, dropsPerUnit, dailyCapQty, monthlyCapQty, status, sortOrder, hazardous; `gramsPerUnit` null everywhere, `imageUrl` null):

| id | code | name | unit | N to M | drops | day | month | status | sort | hazardous | prepInstructions |
|---|---|---|---|---|---|---|---|---|---|---|---|
| wi-carton | CARTON | Thùng carton cũ | thùng | 1 to 1000 | 0 | 10 | 60 | ACTIVE | 10 | false | Gấp phẳng, giữ khô và sạch. |
| wi-bubble-wrap | BUBBLE_WRAP | Nilon chống sốc | túi lớn | 1 to 1000 | 0 | 10 | 60 | ACTIVE | 20 | false | Túi còn nguyên, khô, không dính băng keo hay nhãn. |
| wi-milk-carton | MILK_CARTON | Vỏ hộp sữa sạch | vỏ | 5 to 1000 | 0 | 50 | 300 | ACTIVE | 30 | false | Rửa sạch, để ráo, ép dẹt. |
| wi-tubu-bottle | TUBU_BOTTLE | Vỏ chai, hộp Tubu Tree | vỏ | 1 to 2000 | 2 | null | 20 | ACTIVE | 40 | false | Vỏ chai hoặc hộp Tubu Tree đã dùng hết, rửa sạch, để ráo. |
| wi-battery | BATTERY | Pin đã dùng | viên | 1 to 1000 | 0 | null | null | COMING_SOON | 50 | true | null |

The unit label and the names are author drafts; the spec fixes only the rates and caps (§5.1 and registry 4.1.4). The battery unit "viên" and its 1 to 1000 rate exist only to satisfy the CHECKs.

Gifts (all `status ACTIVE`, `stock` null, `claimInstructions` null; vouchers have `voucherValidDays` 30; type, value, minOrder, maxDiscount, description and label (= the old `badge`) copied from `DEFAULT_REWARD_CATALOG`, `loyalty.service.ts:1537-1582`; names per decision 6 and review coverage F11, which are the names of mockup 16):

| id | kind | name | pointsCost | label | voucher type, value, minOrder, maxDiscount | sort |
|---|---|---|---|---|---|---|
| reward-freeship | VOUCHER | Miễn phí vận chuyển | 20000 | Phổ biến | FREESHIP, 0, 99000, null | 10 |
| reward-discount-50k | VOUCHER | Giảm 50.000đ | 50000 | Tiết kiệm | AMOUNT, 50000, 300000, null | 20 |
| reward-percent-15pct | VOUCHER | Giảm 15% | 75000 | Đặc quyền | PERCENT, 15, 250000, 80000 | 30 |
| reward-discount-100k | VOUCHER | Giảm 100.000đ | 100000 | HOT | AMOUNT, 100000, 600000, null | 40 |
| gift-tree | TREE | Góp quỹ trồng cây | 0 | null | none | 50 |

Descriptions (the current catalogue text, unchanged): freeship "Miễn phí vận chuyển cho 1 đơn từ 99.000đ — hữu ích khi đơn chưa đạt mức freeship của shop."; 50k "Giảm ngay 50.000đ cho đơn hàng từ 300.000đ"; 15% "Giảm 15% tối đa 80.000đ cho đơn hàng từ 250.000đ"; 100k "Giảm ngay 100.000đ cho đơn hàng từ 600.000đ"; tree "Dùng Điểm Xanh góp vào quỹ trồng cây của Tubu Tree." (author draft; the catalogue has no tree row). Names drop the word "Voucher" of the old titles and carry no "Mã giảm giá" prefix (spec 8, 16.1: no "Voucher" in any form); the ids do not change. Existing tests that assert the old "Voucher ..." titles are M4.2's to update.

No warehouse and no partner points are seeded (§11.7).

## 7. Shared types (item vii)

File `st/waste.ts` (M1.6), re-exported from `st/index.ts` with `export * from './waste'`. Names are exactly the registry section 4.9 names, including every DTO expansion the registry review added (decision 8: coverage F1, F4, F5, F6, F7, F10, F18, F19; repo F14), because `st/waste.ts` is frozen after M1.6 (rule R0). The shapes below are the typed form of those lists and fill what the registry leaves open; where both give a field list they are equal, and that list is the whole interface. Conventions: dates are ISO `string`, nullable means `| null`, optional means `?`.

Unions and tuples: see section 3 (fourteen enum-backed unions plus seven pure unions, each with a `WASTE_<NAME>_VALUES` tuple; for example `WASTE_METHOD_VALUES`, `WASTE_REQUEST_STATUS_VALUES`, `WASTE_GIFT_REDEMPTION_STATUS_VALUES`).

Names grouped by route (a route's author reads only its group):

- Config and flags (`GET /config/public.waste`, `/waste/me`, `/waste/preview`): `WastePublicFlags`, `WasteLaneFlags`, `WasteParcelLimits`, `WasteFeeTable`, `WasteFeeEstimate`, `WasteAlertThresholds`, `WasteOpeningHours`.
- Customer reads: `WasteItemDTO`, `WasteMeItemDTO`, `WastePointDTO`, `WastePointContactDTO`, `WasteDeskPointRefDTO`, `WasteMeDTO`, `WasteNearbyRequest`, `WasteRulesDTO`, `WasteRequestLineDTO`, `WasteRequestSummaryDTO`, `WasteRequestDetailDTO`.
- Customer writes: `WasteLineInput`, `WastePreviewRequest`, `WastePreviewBlockDTO`, `WastePreviewDTO`, `WasteCreateRequest`, `WasteEditRequest`, `WasteTrackingRequest`.
- Rewards (`/me/loyalty/rewards*`): `WasteVoucherSpec` (new, additive), `RewardItemDTO`, `RewardCatalogDTO`, `GiftRedemptionDTO`, `RedeemRewardResultDTO`.
- Desk (`/waste/desk/*`): `WasteDeskPointDTO`, `WasteDeskLookupRequest`, `WasteDeskRequestDTO`, `WasteDeskGiftDTO`, `WasteDeskLookupDTO`, `WasteMatchInput`, `WasteConfirmLineInput`, `WasteConfirmRequest`, `WasteRejectRequest`, `WasteConfirmResultDTO`, `WasteRejectResultDTO`, `WasteDeskGiftFulfilRequest`, `WastePerkSubmitRequest`, `WastePointMonthlyReportDTO` (also the response of the admin route `GET /admin/waste/points/:id/report?month=`, R(A), `WasteReportsService.monthly(month, pointId)`, M4.7; review coverage F7).
- Admin catalogue: `AdminWasteItemDTO`, `WasteItemUpsertRequest`, `AdminWastePointDTO`, `AdminWastePointQuery`, `WastePointUpsertRequest`, `WastePointStaffDTO`, `WastePointStaffAddRequest`, `AdminWasteGiftDTO`, `WasteGiftUpsertRequest`, `WasteReorderRequest`.
- Admin requests: `AdminWasteRequestQuery`, `AdminWasteRequestRowDTO`, `WasteRequestAdminDetailDTO`, `AdminWasteEventDTO`, `WasteReceiveRequest`, `WasteReceiveResultDTO`, `WasteUnmatchedDTO`, `WasteUnmatchedCreateRequest`, `WasteUnmatchedResolveRequest`, `WasteReverseRequest`, `WasteReverseResultDTO`, `WasteCostRequest`, `WasteCloseLostRequest`, `WasteReopenRequest`, `WasteUserFlagsDTO`, `WasteUserFlagsUpdateRequest`.
- Admin gifts and reports: `GiftRedemptionsQuery`, `AdminGiftRedemptionRowDTO`, `WasteGiftCancelRequest`, `WasteMonthMetrics`, `WasteAlertDTO`, `WasteOverviewDTO`.

Field shapes the registry leaves open (author decisions; each cites the spec text it comes from):

- `WasteVoucherSpec { type: CouponType; value: number; minOrder: number | null; maxDiscount: number | null; validDays: number }` (author name for the inline voucher shape that registry 4.9 writes in `RewardItemDTO` and `AdminWasteGiftDTO`; structurally equal). `RewardItemDTO.voucher`, `AdminWasteGiftDTO.voucher` and `WasteGiftUpsertRequest.voucher` use it. `CouponType` is imported from `./enums` (decision 1), never redeclared.
- `WasteFeeEstimate { zoneName: string; provinceCode: string; provinceName: string; low: number; high: number }` (review coverage F18: the province the server used, for "Phí ship, từ Hà Nội" when the request has no `provinceCode` and the default address decides).
- `WasteItemDTO { id: string; code: string; name: string; unitLabel: string; unitsPerPoint: number; pointsPerGroup: number; dropsPerUnit: number; dailyCapQty: number | null; monthlyCapQty: number | null; status: WasteItemStatus; prepInstructions: string | null; imageUrl: string | null; gramsPerUnit: number | null; hazardous: boolean; sortOrder: number }` (review coverage F6; the client builds the cap sentence from the two caps and greys out `COMING_SOON`, §4.2). `HIDDEN` items are never returned to customers.
- `WastePointContactDTO { id: string; kind: WastePointKind; name: string; addressLine: string; communeName: string; provinceName: string; phone: string | null; openingHours: WasteOpeningHours }` (review coverage F6; §15.2 detail: name, address, commune, province, phone, hours).
- `WasteRequestLineDTO { itemId: string; itemName: string; unitLabel: string; unitsPerPoint: number; pointsPerGroup: number; dropsPerUnit: number; gramsPerUnit: number | null; declaredQty: number; receivedQty: number | null; shortfallReason: WasteShortfallReason | null; pointsAwarded: number | null }` (review coverage F6).
- `WasteRequestSummaryDTO { id: string; code: string; method: WasteMethod; status: WasteRequestStatus; closeReason: WasteCloseReason | null; createdAt: string; expiresAt: string | null; estimatedPoints: number; pointsAwarded: number | null; pointName: string; orderCode: string | null; lines: { itemName: string; unitLabel: string; declaredQty: number }[] }` (review coverage F6: home cards and the checkout card show the items without a detail call; for `MAIL_IN` and `PICKUP` `pointName` is the warehouse name).
- `WasteRequestDetailDTO extends WasteRequestSummaryDTO { lines: WasteRequestLineDTO[]; point: WastePointContactDTO | null; pointAvailable: boolean; carrier: string | null; trackingCode: string | null; inTransitAt: string | null; receivedAt: string | null; completedAt: string | null; closedAt: string | null; rejectionReason: WasteRejectionReason | null; rejectionNote: string | null; dropsAwarded: number | null; impactGrams: number | null; reversedPoints: number | null; reversalReason: string | null; editable: boolean; cancellable: boolean; orderId: string | null }`. `lines` narrows the summary line type (a `WasteRequestLineDTO` has the three summary fields, so `extends` compiles). `impactGrams` (review coverage F4) is set only when the status is `COMPLETED` and every line has `gramsPerUnit` (spec 4.7, 5.7), else null. `reversedPoints` means points actually taken back, `pointsAwarded - reversalShortfallPoints`, and is null unless the status is `REVERSED`.
- `WasteMeDTO { programmeEnabled: boolean; eligibility: WasteEligibility; blocked: boolean; shipLockedAt: string | null; laneFlags: WasteLaneFlags; parcelLimits: WasteParcelLimits; balance: { pointsBalance: number; pointsConvertedBalance: number; redeemablePoints: number } | null; monthUsage: { capMonthKey: string; pointsUsed: number; pointsCap: number } | null; impactGrams: number | null; thresholds: { mailinMinPoints: number; pickupMinPoints: number; maxOpenRequests: number }; items: WasteMeItemDTO[]; openRequests: WasteRequestSummaryDTO[]; deskPoints: WasteDeskPointRefDTO[] }`. `impactGrams` (review coverage F4) is Σ receivedQty × gramsPerUnit over the caller's `COMPLETED` requests whose every line has `gramsPerUnit`; null when none qualify (spec 5.7).
- `RewardItemDTO { id: string; kind: WasteGiftKind; name: string; description: string | null; label: string | null; pointsCost: number; imageUrl: string | null; stockRemaining: number | null; soldOut: boolean; canRedeem: boolean; claimInstructions: string | null; voucher: WasteVoucherSpec | null; sortOrder: number }` (`voucher.type` is `CouponType`, review repo F14).
- `RewardCatalogDTO { pointsBalance: number; pointsConvertedBalance: number; lockedPoints: number; redeemablePoints: number; giftClaimDays: number; claimPoint: { name: string; addressLine: string; communeName: string; provinceName: string; openingHours: WasteOpeningHours } | null; rewards: RewardItemDTO[] }` (review coverage F5: `claimPoint` is the ACTIVE WAREHOUSE, null if none; `giftClaimDays` is `waste.gift_claim_days`; these `/me/loyalty/*` routes work while `waste.enabled` is off).
- `GiftRedemptionDTO { id: string; giftId: string; giftKind: WasteGiftKind; giftName: string; pointsCost: number; status: WasteGiftRedemptionStatus; code: string | null; claimExpiresAt: string | null; claimPoint: { name: string; addressLine: string; communeName: string; provinceName: string; openingHours: WasteOpeningHours } | null; fulfilledAt: string | null; cancelledAt: string | null; cancelReason: string | null; refundedPoints: number | null; couponCode: string | null; createdAt: string }` (review coverage F5: `claimPoint` only for `READY`, else null).
- `AdminWasteItemDTO extends WasteItemDTO { createdAt: string; updatedAt: string }` (`gramsPerUnit` and `hazardous` now come from `WasteItemDTO`).
- `WasteItemUpsertRequest { code: string; name: string; unitLabel: string; unitsPerPoint: number; pointsPerGroup: number; dropsPerUnit?: number; dailyCapQty?: number | null; monthlyCapQty?: number | null; status?: WasteItemStatus; prepInstructions?: string | null; imageUrl?: string | null; sortOrder?: number; gramsPerUnit?: number | null; hazardous?: boolean }`. On PATCH every field is optional; `hazardous: false` and `status: 'ACTIVE'` on a hazardous item are 400 (§15.4, §14.1).
- `WastePointStaffDTO { userId: string; role: WastePointStaffRole; isActive: boolean; fullName: string | null; phone: string | null }` (admin only, unmasked).
- `WastePointDTO { id: string; kind: WastePointKind; name: string; addressLine: string; provinceCode: string; provinceName: string; communeCode: string; communeName: string; lat: number | null; lng: number | null; phone: string | null; openingHours: WasteOpeningHours; acceptedItemIds: string[]; perkText: string | null; quotaFull: boolean; distanceKm: number | null }` (registry 4.9 list, typed).
- `AdminWastePointDTO extends WastePointDTO { status: WastePointStatus; monthlyQuotaPoints: number | null; monthUsage: { monthKey: string; pointsUsed: number; confirmations: number }; quotaFull: boolean; perkPendingText: string | null; giftHandoverEnabled: boolean; note: string | null; sortOrder: number; activatedAt: string | null; lastConfirmedAt: string | null; hiddenInactive: boolean; staff: WastePointStaffDTO[] }` (review coverage F7: `monthUsage` is the current VN month, zeros when the point has no usage row; `quotaFull` drives the "Tạm dừng, hết hạn mức" label; item links come from `acceptedItemIds`; `distanceKm` is null on admin rows).
- `AdminWastePointQuery { status?: WastePointStatus; perkPending?: boolean }` (review coverage F7: `GET /admin/waste/points` filters, including `PENDING`; source of `wastePointsPending` and `wastePerksPending`).
- `AdminWasteRequestQuery { method?: WasteMethod; status?: WasteRequestStatus; filter?: WasteRequestQueueFilter; userId?: string; pointId?: string; cursor?: string; limit?: number }` (review coverage F7 adds `pointId`, used with `status: 'COMPLETED'` for the per-point credit log; coverage F3: `filter` `TRANSIT_OVERDUE`/`ORDER_MISMATCH` and `userId` are ADMIN-only, 403 for STAFF).
- `WastePointUpsertRequest { kind?: WastePointKind; name: string; addressLine: string; provinceCode: string; provinceName: string; communeCode: string; communeName: string; lat?: number | null; lng?: number | null; phone?: string | null; openingHours?: WasteOpeningHours; status?: WastePointStatus; monthlyQuotaPoints?: number | null; giftHandoverEnabled?: boolean; note?: string | null; sortOrder?: number; itemIds?: string[] }` (`kind` only on create; PATCH makes every field optional).
- `AdminWasteGiftDTO { id: string; kind: WasteGiftKind; name: string; description: string | null; label: string | null; pointsCost: number; status: WasteGiftStatus; sortOrder: number; imageUrl: string | null; stock: number | null; claimInstructions: string | null; voucher: WasteVoucherSpec | null; redemptionCount: number; fundTreeTotal?: number }` (review coverage F19: `redemptionCount` is read from `waste_gift_redemptions`, for `TREE` the number of distinct `GAME_BUY_TREE:` reasons; `fundTreeTotal` only on `TREE`, the `planted_trees` count).
- `WasteGiftUpsertRequest { kind?: WasteGiftKind; name: string; description?: string | null; label?: string | null; pointsCost?: number; status?: WasteGiftStatus; sortOrder?: number; imageUrl?: string | null; stock?: number | null; claimInstructions?: string | null; voucher?: WasteVoucherSpec }` (the server generates the id of a new gift as `gift-<random>`; `kind` only on create; a `TREE` gift accepts only name, sortOrder, imageUrl and status).
- `AdminWasteRequestRowDTO { id: string; code: string; method: WasteMethod; status: WasteRequestStatus; closeReason: WasteCloseReason | null; createdAt: string; expiresAt: string | null; inTransitAt: string | null; receivedAt: string | null; estimatedPoints: number; pointsAwarded: number | null; pointId: string; pointName: string; customerName: string; customerPhone: string | null; userId?: string; carrier: string | null; trackingCode: string | null; trackingConflict: boolean; orderCode: string | null; waitingReason: 'CUSTOMER_BLOCKED' | 'ORDER_NOT_DELIVERED' | null }`. `customerName` and `customerPhone` are masked unless the re-read role is ADMIN; `userId` is present only for ADMIN (§15.1).
- `WasteRequestAdminDetailDTO extends WasteRequestDetailDTO { customerName: string; customerPhone: string | null; userId?: string; trackingConflict: boolean; confirmedByUserId: string | null; receivedWeightGrams: number | null; carrierCostVnd: number | null; reversedAt: string | null; reversedByUserId: string | null; reversalShortfallPoints: number | null; capDayKey: string; capMonthKey: string; consentAt: string; consentVersion: string; events?: AdminWasteEventDTO[] }` (`events` and `userId` only for ADMIN).
- `AdminWasteEventDTO { id: string; createdAt: string; kind: string; actorUserId: string | null; actorRole: WasteActorRole; requestId: string | null; pointId: string | null; giftRedemptionId: string | null; meta: Record<string, unknown> | null }`.
- `WasteUnmatchedDTO { id: string; receivedAt: string; createdByUserId: string; carrier: string | null; trackingCode: string | null; description: string; reason: WasteUnmatchedReason; relatedRequestId: string | null; status: WasteUnmatchedStatus; matchedRequestId: string | null; resolvedByUserId: string | null; resolvedAt: string | null; resolveNote: string | null }`.
- `WasteUserFlagsDTO { userId: string; shipLockedAt: string | null; shipUnlockedAt: string | null; blockedAt: string | null; reason: string | null; setByUserId: string | null; updatedAt: string | null }` (all null and `updatedAt` null when the customer has no row).
- `WasteUserFlagsUpdateRequest { shipLocked?: boolean; blocked?: boolean; reason: string }`.
- `GiftRedemptionsQuery { status?: WasteGiftRedemptionStatus; overdue?: boolean }`.
- `AdminGiftRedemptionRowDTO { id: string; giftId: string; giftKind: WasteGiftKind; giftName: string; pointsCost: number; status: WasteGiftRedemptionStatus; codeLast2: string | null; code?: string | null; customerName: string; customerPhone: string | null; userId?: string; claimExpiresAt: string | null; overdue: boolean; createdAt: string }` (review coverage F1). `codeLast2` is the last two characters of the `QG-` code for everyone; `code` and `userId` are present only for ADMIN (absent, not null, for STAFF), and the name and phone are masked unless ADMIN (§15.4: STAFF never receives the full code, so a staff member cannot fulfil without the customer).
- `WasteMonthMetrics { requestsCreatedByMethod: Record<WasteMethod, number>; requestsByStatus: Record<WasteRequestStatus, number>; completeHoursP50: number | null; completeHoursP90: number | null; unitsByItem: { itemId: string; itemName: string; unitLabel: string; qty: number }[]; unitsByPoint: { pointId: string; pointName: string; qty: number }[]; pointsIssued: number; pointsReversed: number; receivedDeclaredPctByMethod: Record<WasteMethod, number | null>; receivedDeclaredPctByPoint: { pointId: string; pct: number | null }[]; rejectionsByReason: Record<WasteRejectionReason, number>; expiredCount: number; quotaByPoint: { pointId: string; pointName: string; quota: number | null; used: number; confirmations: number }[]; pickupCount: number; carrierCostVnd: number; receivedWeightGrams: number | null; estimatedWeightGrams: number | null; repeatCustomers60d: number; ordersOfExchangers: number; ordersOfNonExchangers: number; costVndPer1000PointsIssued: number | null }` (review coverage F10: 21 fields that cover the metrics list of spec 17.2; month convention: created by `createdAt`, units and points by `completedAt` including `REVERSED`, reversed by `reversedAt`, quota from `waste_point_usage`; the CSV and the point report use the same function). The month is carried by `WasteOverviewDTO.month`/`previousMonth`, not by this object.
- `receivedWeightGrams` in `WasteConfirmRequest`, `WasteReceiveRequest` and `WasteCostRequest`: integer 1..100000, excluded from the confirm replay comparison (spec 15.3); `carrierCostVnd`: integer ≥ 0 (review coverage F14). Shared types carry `number`; the controller DTO classes enforce the bounds.

Leaf types (author decisions, frozen with `st/waste.ts` after M1.6): the types of every field that registry 4.2 and 4.9 name without a type. M1.6 Step 3 writes exactly these; where the registry already types a field, the type here is the same.

```ts
// config (registry 4.2 line "WastePublicFlags = { enabled; dropoff; mailin; pickup }", spec 11.5 public config; thresholds = the 11 keys of section 4)
export interface WastePublicFlags { enabled: boolean; dropoff: boolean; mailin: boolean; pickup: boolean }
export interface WasteAlertThresholds { quotaPacePct: number; quotaPaceDays: number; fullMatchPct: number; fullMatchMinSample: number; repeatCustomerCount: number; repeatCustomerDays: number; avgUnitsFactor: number; lookupMissCount: number; lookupMissDays: number; staffDirectCount: number; staffDirectDays: number }
// customer (spec 15.2)
export interface WasteLineInput { itemId: string; declaredQty: number }
export interface WasteDeskPointRefDTO { id: string; name: string; kind: WastePointKind }
export interface WasteNearbyRequest { provinceCode?: string; locationToken: string; zaloAccessToken: string }
export interface WastePreviewRequest { lines: WasteLineInput[]; method?: WasteMethod; pointId?: string; provinceCode?: string }
export interface WastePreviewBlockDTO { code: WastePreviewBlock; itemId?: string; missingPoints?: number; openCount?: number; pickupRequestCode?: string; pointsRemaining?: number }
export interface WastePreviewDTO { estimatedPoints: number; estimatedDrops: number; estimatedGrams: number | null; pointsValueVnd: number; blocks: WastePreviewBlockDTO[]; feeEstimate: WasteFeeEstimate | null; itemCaps: { itemId: string; monthRemainingQty: number | null; dayRemainingQty: number | null }[]; pointsMonthRemaining: number }
export interface WasteCreateRequest { method: WasteMethod; lines: WasteLineInput[]; pointId?: string; consent: true; packagingConsent?: boolean; postagePaidConsent?: boolean }
export interface WasteEditRequest { lines: WasteLineInput[]; pointId?: string }
export interface WasteTrackingRequest { carrier: string; trackingCode: string }
// rewards (coupon shape of the existing Coupon model: minOrder Int?, maxDiscount Int?, endAt DateTime)
export interface RedeemRewardResultDTO { success: true; message: string; pointsSpent: number; remainingPoints: number; redemption: GiftRedemptionDTO; coupon: { code: string; type: CouponType; value: number; minOrder: number | null; maxDiscount: number | null; endAt: string } | null }
// desk (spec 15.3 table, 15.5)
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
// admin (spec 15.4, 5.5)
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
// threshold is null for STAFF_ACCOUNT_CONFIRMED, which flags every case and has no threshold (spec 5.5).
export interface WasteAlertDTO { kind: WasteAlertKind; pointId?: string; pointName?: string; confirmerName?: string; value: number; threshold: number | null; detail: string }
export interface WasteOverviewDTO { month: string; previousMonth: string; current: WasteMonthMetrics; previous: WasteMonthMetrics; alerts: WasteAlertDTO[] }
```

`staffDailyCapRemaining` is `waste.staff_daily_cap_points` minus the caller's points confirmed today (spec 15.5 step 6), never below 0; it is a number for every point, the warehouse included (spec 15.3: the warehouse has `quota: null`, not a null remaining cap). `customerPhone` is `maskPhoneOrNull` output, so it can be null (spec 15.3).

Not exported from shared-types (stay inside the API): `WasteMonthlyReport` (named only in registry 4.8 `WasteReportsService.monthly`), `WasteStoredLine`, `WasteValidatedLine`, `WasteRequestWithPoint`, `WasteRequestFull`, `WasteHoldInput` and the other service-internal types of registry 4.5 to 4.8.

## 8. Test fixtures (M1.2)

`race/fixtures/waste-fixtures.ts` exports the six names of registry 4.10 and, as additive helpers (recorded in registry 4.10, decision 9), `createWasteGift(prisma, over?)`, a `storefrontIds` option on `cleanupWaste`, `ownerStorefrontId` and `createdStorefront` fields on the result of `createWastePoint`, and `expiresAt` and `estimatedPoints` options on `createWasteRequest`. Behaviour: `createWasteItem` defaults to code `IT_<random>`, unit "cái", 1 to 1000, status ACTIVE; `createWarehouse` returns the single WAREHOUSE row, creating it (status ACTIVE) only when none exists; `createWastePoint({ kind: 'PARTNER' })` creates an ACTIVE point with quota 100000 unless `quota` is given, plus, when `ownerUserId` is given, an active OWNER staff row and the owner storefront: the existing one (`prisma.storefront.findFirst({ where: { ownerUserId } })`, because `storefronts_ownerUserId_key` allows one store per owner, migration `20260916010000_add_storefront_owner_unique`), else one created inline (`helpers.ts` exports no partner-store helper; review repo F14): `prisma.storefront.create({ data: { type: 'MERCHANT', isPartner: true, slug: 'wx-<tag>', subdomain: 'wx-<tag>', ownerUserId, title, isPublished: true } })`, copied from `n2b-harness.ts:71-74`, so that the valid-OWNER rule of §15.1 (d) holds (`PARTNER_STORE_WHERE`, `merchant/partner-store.ts:9`). A reused owner storefront that is neither `type: 'MERCHANT'` nor `isPartner: true` is updated with `isPartner: true`. `createdStorefront` is true only when the call created the store. `createWasteRequest` sets `estimatedPoints` to `o.estimatedPoints` or Σ `floor(declaredQty / unitsPerPoint) * pointsPerGroup` and `estimatedDrops` to Σ `declaredQty * dropsPerUnit` over the lines (§11.2, registry 4.3 `linePoints`/`lineDrops`). Pass to `cleanupWaste` only storefronts the fixture created. `cleanupWaste` sets `ownerUserId: null` on those storefronts, deletes the waste rows in foreign-key order and deletes the storefronts last; suites call it BEFORE `deleteItData` (the `n2b-harness.ts:45-47` order). It also works after `deleteItData` (the storefront owner FK is `ON DELETE SET NULL`, migration `20260626010000_storefront_core` line 111), which only `delete-it-data.race-spec.ts` uses, because that spec tests `deleteItData` itself. The same file also exports the GR2 order helpers `holdLock`, `lockWaiters`, `waitUntil`, `blockedBackends`, `raceWithHold`, `holdFirstCall` (signatures in registry 4.10), proven by `race/waste-order-helpers.race-spec.ts` (M1.2); registry 4.10 also holds the config-restore and config-cache rules (GR1) every race spec follows.

## 9. Ambiguities, contradictions and gaps found while writing M1

1. Registry 4.9 names `WasteMonthlyReport` only in 4.8 (`WasteReportsService.monthly`), not in the shared-types list. Treated as API-internal (section 7).
2. Registry 2.1 lists `schema.prisma` as touched only by M1.1 and M8.3, while spec 11.3 says the partial indexes are "not declared in Prisma". The comment block above `PointsTransaction` in `schema.prisma` documents partial indexes by name; M1.1 adds the three new names there as a comment (no drift effect).
3. Registry 4.1 says `WasteUserFlags` has `userId @id FK to User` without an `onDelete`; spec 11.1 says "khoá ngoại tới users (không xoá lan)". Resolved as Restrict (plus the `deleteItData` addition in M1.2).
4. Resolved (decision 10): the M1.6 union test uses the named enum exports of `@prisma/client` (for example `WasteMethod`), which exist for every Prisma 5 enum and are the form the repo imports; the registry now says so.
5. Spec 11.6 lists no dedupe key for `WASTE_PICKUP_CANCELLED` beyond the general `waste:<id>:<status>`; the registry table uses `waste:<requestId>:CANCELLED`. The plan follows the registry table; M2 owners confirm no second CANCELLED notification can occur for the same request.
6. Spec 11.5 pins no bounds for the two JSON keys; section 4 states the author's rules.
7. Spec 4.2 does not define what "thêm N vỏ nữa" shows when the quantity is already an exact multiple; `unitsToNextPoint` returns the full group size in that case.
8. Spec 11.1 gives `consentVersion` as "hằng trong mã" without a value; registry 4.3 fixes `2026-10-17.1`.
9. Resolved (decision 6, review coverage F11): the four voucher names are "Miễn phí vận chuyển", "Giảm 50.000đ", "Giảm 15%", "Giảm 100.000đ" (mockup 16); ids, values, descriptions and labels stay as in `DEFAULT_REWARD_CATALOG` (section 6).
10. Still open, not covered by review repo F14 (UNVERIFIED): that `prisma migrate diff --script` run on a database migrated up to `20261019120000_merchant_link_prev_rate` produces exactly the objects of section 2 (the implementer of M1.1 confirms with the drift command); the exact shape of the Prisma client error for a CHECK violation (raw SQL is used in tests to avoid depending on it).
