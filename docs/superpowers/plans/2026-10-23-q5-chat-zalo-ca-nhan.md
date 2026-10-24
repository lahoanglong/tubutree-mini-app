# Chat CSKH qua Zalo cá nhân (Q5): kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khách chat với Tubu Tree trong Mini App và web; tin chuyển vào một nhóm Zalo qua tài khoản Zalo cá nhân làm cầu nối; nhân viên trả lời trong nhóm; câu trả lời về đúng khách.

**Architecture:** App mới `apps/zalo-bridge` (Node, `zca-js` 2.1.2, một bản duy nhất) giữ phiên Zalo, chỉ nghe nhóm đã chọn, gửi tin theo hàng đợi giãn cách, đẩy sự kiện về API qua hộp thư đi trên đĩa. Module `support-chat` trong API lưu hội thoại, gộp và chuyển tin qua BullMQ, khớp trả lời theo trích tin hoặc mã `#XXXX`. Khách hỏi tin mới định kỳ; admin quản lý ở tab mới.

**Tech Stack:** NestJS 10 + Prisma + BullMQ (api), Node 22 + `zca-js` 2.1.2 + vitest (bridge), React + zmp-ui + react-query (miniapp), Next.js + react-query (web), `packages/app-core`, `packages/shared-types`, Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-10-23-q5-chat-zalo-ca-nhan-design.md`. Đọc spec trước; kế hoạch này chỉ ghi các quyết định người làm không tự đoán được.

## Global Constraints

- `zca-js` ghim đúng `"2.1.2"` (không `^`).
- Không đăng nhập tài khoản Zalo thật nào, không gọi Zalo thật trong test. Không push, không mở PR, không deploy. Chỉ commit cục bộ trên nhánh `feat/q5-chat-zalo-ca-nhan`.
- `chat.enabled` mặc định `false`.
- Mã hội thoại: 4 ký tự từ bảng `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (không `0 O 1 I`). Regex đầu tin chuyển: `^#[A-HJ-NP-Z2-9]{4} · `. Regex mã đầu câu nhân viên: `^\s*#([A-Za-z2-9]{4})(?![A-Za-z0-9])\s*` (không phân biệt hoa thường, chuẩn hoá chữ hoa).
- Khách chỉ thấy người gửi là "Tubu Tree"; không lộ `staffName`, `adminUserId`, `zaloMsgId` ra API khách.
- Giới hạn: nội dung tin khách ≤ 1.000 ký tự; 10 tin/phút, 200 tin/ngày mỗi khách; gộp 15 giây; bridge giãn 1.500 ms + ngẫu nhiên 0–1.000 ms, tối đa 300 tin/giờ.
- Tên khoá cấu hình không chứa `token|secret|key|pass` (bị che ở `config-redaction.ts:20`). Không thêm khoá `support.*` (`support-config-seed.spec.ts` đòi đúng 3 khoá). Tiền tố mới `chat.`.
- Mọi `@Cron` có `{ timeZone: CRON_TZ }`. Mini App không gọi `toLocaleString` ngoài `utils/format.ts` (`format-guard.spec.ts`).
- Comment chỉ giải thích "vì sao". Commit message tiếng Việt, kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`. Sau đổi schema: `cd apps/api && npx prisma generate`. Race spec chỉ chạy trên DB tên `tubutree_it` ở cụm Postgres riêng (`docs/2026-10-20-uat/tools/pg-native.sh start <port>`), không trỏ `5434`/`6381`.
- Web khổ điện thoại phải giống Mini App (bố cục, chữ, thứ tự).

## Review Focus

1. Khách bấm gửi hai lần hoặc mạng chập chờn gửi lại cùng `clientMsgId` → một tin, một lần chuyển. Test ở Task 4.
2. Nhân viên trả lời bằng trích một tin chuyển từ hôm trước → vẫn về đúng khách. Test ở Task 6.
3. Nhân viên chính là tài khoản cầu nối, gõ trả lời trên điện thoại (`isSelf: true`, nội dung khác tin đã gửi) → phải thành tin STAFF, không bị lọc nhầm là echo. Test ở Task 2 và Task 6.
4. Khách bị chặn vẫn nhận được trả lời của nhân viên; khách đã xoá tài khoản thì trả lời bị bỏ êm (2xx). Test ở Task 6.
5. Cầu nối khởi động lại khi hộp thư đi còn sự kiện → sự kiện được gửi lại, API chống trùng theo `zaloMsgId`. Test ở Task 2 và Task 6.

---

## Hợp đồng dùng chung

### Kiểu (`packages/shared-types/src/support-chat.ts`, xuất ở `index.ts`)

```ts
export type SupportSender = 'CUSTOMER' | 'STAFF' | 'SYSTEM';
export interface SupportChatContext { orderCode?: string; productSlug?: string }
export interface SupportChatMessageDTO {
  id: string; sender: SupportSender; body: string; imageUrl: string | null;
  context: SupportChatContext | null; clientMsgId: string | null; createdAt: string;
}
export interface SupportChatThreadDTO {
  code: string; blocked: boolean; enabled: boolean; slow: boolean;
  messages: SupportChatMessageDTO[]; hasMore: boolean;
}
export interface SupportChatPageDTO { messages: SupportChatMessageDTO[]; hasMore: boolean }
export interface SupportChatSendInput { clientMsgId: string; body?: string; imageUrl?: string; context?: SupportChatContext }
export type ZaloBridgeState = 'CONNECTED' | 'CONNECTING' | 'NEED_QR' | 'KICKED' | 'ERROR' | 'UNREACHABLE';
export type ZaloBridgeEvent =
  | { type: 'message'; groupId: string; msgId: string; cliMsgId: string; uidFrom: string; dName: string;
      isSelf: boolean; ts: number; text: string | null; imageUrl: string | null;
      quote: { globalMsgId: string; cliMsgId: string } | null }
  | { type: 'undo'; groupId: string; msgId: string }
  | { type: 'state'; state: Exclude<ZaloBridgeState, 'UNREACHABLE'>; since: string; lastError: string | null;
      zaloUid: string | null; displayName: string | null };
export interface ZaloBridgeHealth {
  state: Exclude<ZaloBridgeState, 'UNREACHABLE'>; zaloUid: string | null; displayName: string | null;
  avatar: string | null; since: string; lastError: string | null; queueSize: number; outboxSize: number; groupId: string | null;
}
```

### HTTP của cầu nối (cổng 3110, mọi lệnh cần `Authorization: Bearer <ZALO_BRIDGE_SECRET>`, sai → 401)

| Lệnh | Vào | Ra |
|---|---|---|
| `GET /health` | | `ZaloBridgeHealth` |
| `POST /qr/start` | | `{status:'WAITING_SCAN', image}` (data URL) |
| `GET /qr/status` | | `{status:'IDLE'|'WAITING_SCAN'|'SCANNED'|'SUCCESS'|'EXPIRED'|'FAILED', image?, displayName?}` |
| `POST /logout` · `POST /reconnect` | | `{ok:true}` |
| `GET /groups` | | `{groups:[{id,name,memberCount}]}`; chưa kết nối → 409 `{code:'NOT_CONNECTED'}` |
| `PUT /config` | `{groupId: string|null}` | `{groupId}` |
| `POST /send` | `{idempotencyKey, text}` | `{msgId}` (chuỗi); 409 `{code:'NOT_CONNECTED'|'NO_GROUP'}`; 502 `{code:'SEND_FAILED', message}` |

Sự kiện: `POST {API_EVENTS_URL}` (mặc định `http://api:3001/api/internal/zalo-bridge/events`), thân là `ZaloBridgeEvent`. API trả 200 `{ok:true}` hoặc 200 `{ok:true, unknownCode:'K7Q3'}`; 503 = gửi lại sau; 401/4xx khác = bỏ.

### API khách (`/me/support-chat`, cần đăng nhập, mọi vai)

| Lệnh | Ra |
|---|---|
| `GET /me/support-chat` | `SupportChatThreadDTO` (50 tin mới nhất, cũ → mới; tạo hội thoại nếu chưa có) |
| `GET /me/support-chat/messages?after=<id>` hoặc `?before=<id>` | `SupportChatPageDTO` (tối đa 50) |
| `POST /me/support-chat/messages` (`SupportChatSendInput`) | `SupportChatMessageDTO`; cùng `clientMsgId` → trả tin cũ, 200 |
| `POST /me/support-chat/read` | `{ok:true}` |
| `GET /me/support-chat/summary` | `{unreadCount:number}` |

Lỗi: chat tắt → 409 `{code:'CHAT_DISABLED', message:'Chat với Tubu Tree đang tạm đóng. Cần hỗ trợ, gọi hotline.'}`; bị chặn → 403 `{code:'CHAT_BLOCKED', message:'Bạn tạm thời không gửi được tin. Cần hỗ trợ, gọi hotline.'}`; thiếu cả `body` lẫn `imageUrl` → 400.

### API admin (`/admin/support-chat`, `@Roles('ADMIN')`; cột "CSKH" là có `@AllowStaff('CSKH')`)

| Lệnh | CSKH | Việc |
|---|---|---|
| `GET bridge` | có | trạng thái từ `SupportBridgeStatus` + `groupId`, `enabled` |
| `POST bridge/qr` · `GET bridge/qr` · `POST bridge/logout` · `POST bridge/reconnect` · `GET bridge/groups` · `POST bridge/test` | không | chuyển tiếp sang cầu nối; `test` gửi "Tin thử từ Tubu Tree lúc HH:MM." |
| `PUT settings` `{enabled?, groupId?}` | không | `SystemConfigService.set(..., adminUserId)`; đổi nhóm thì gọi `PUT /config` |
| `GET conversations?q=&filter=unforwarded&cursor=` | có | danh sách, tìm theo SĐT hoặc mã |
| `GET conversations/:id` | có | mọi tin kèm `staffName`, `adminUserId`, trạng thái chuyển |
| `POST conversations/:id/reply` `{body}` | có | tin STAFF nguồn ADMIN |
| `POST conversations/:id/block` · `DELETE conversations/:id/block` | có | chặn / bỏ chặn |
| `POST forwards/:id/resend` | có | gửi lại `FAILED`/`UNKNOWN` với cùng `idempotencyKey = forward.id` |

---

### Task 1: Lõi cầu nối (không Zalo)

**Files:**
- Create: `apps/zalo-bridge/{package.json,tsconfig.json,vitest.config.ts,eslint.config.mjs}`
- Create: `apps/zalo-bridge/src/{env.ts,crypto.ts,credentials.ts,auth.ts,config-store.ts,send-queue.ts,send-dedupe.ts,echo-filter.ts,outbox.ts}` và `*.spec.ts` cạnh từng file

**Interfaces:**
- Produces:
  - `loadEnv(raw = process.env): BridgeEnv`: ném lỗi nếu `ZALO_BRIDGE_SECRET` < 32 ký tự hoặc `ZALO_BRIDGE_CREDENTIALS_KEY` không giải base64 ra 32 byte. Các trường còn lại: `PORT` (mặc định 3110), `HOST` (`0.0.0.0`), `ZALO_BRIDGE_DATA_DIR` (`/data`), `API_EVENTS_URL`.
  - `encrypt(plain: string, key: Buffer): string` và `decrypt(blob: string, key: Buffer): string`: dạng `v1:<iv>:<tag>:<ct>` base64, AES-256-GCM.
  - `CredentialStore { load(): Promise<ZaloCredentials|null>; save(c): Promise<void>; clear(): Promise<void> }`: tệp `credentials.enc` trong data dir.
  - `isAuthorized(header: string|undefined, secret: string): boolean`: `timingSafeEqual`.
  - `ConfigStore { get(): {groupId: string|null}; set(groupId: string|null): Promise<void> }`: tệp `config.json`.
  - `SendQueue(opts: {spacingMs=1500, jitterMs=1000, maxPerHour=300, now, sleep, random})` với `enqueue<T>(fn: () => Promise<T>): Promise<T>` và `size()`.
  - `SendDedupe(ttlMs = 24h, max = 5000)` với `get(key): string|undefined` và `set(key, msgId)`.
  - `EchoFilter(now)`:
    - `noteSending(text)`;
    - `noteSent(msgId, text)`;
    - `isEcho(e: {msgId, isSelf, text}): boolean`, đúng khi `msgId` đã gửi (24 giờ) hoặc `isSelf` và nội dung trùng đúng một tin đang gửi hoặc đã gửi trong 60 giây.
  - `Outbox(dir, post: (e) => Promise<'ok'|'retry'|'drop'>, now)`:
    - `push(e): Promise<void>` ghi `outbox.jsonl` trước khi gửi;
    - `start()` và `stop()`;
    - `size()`;
    - thử lại lùi 5 giây nhân đôi tới 10 phút, bỏ sự kiện quá 24 giờ.

- [ ] **Step 1: Write failing tests**
  - `crypto.spec.ts`: mã rồi giải ra đúng chuỗi; sửa một byte của `ct` thì `decrypt` ném lỗi.
  - `env.spec.ts`: secret 31 ký tự thì ném lỗi `ZALO_BRIDGE_SECRET`; key 16 byte thì ném lỗi.
  - `auth.spec.ts`: `Bearer <secret>` → `true`; thiếu header, sai một ký tự, độ dài khác → `false`.
  - `send-queue.spec.ts` (đồng hồ giả):
    - hai lệnh cách nhau ≥ 1.500 ms;
    - lệnh thứ 301 trong một giờ chờ tới khi lệnh đầu quá 1 giờ;
    - lệnh lỗi không chặn lệnh sau.
  - `echo-filter.spec.ts`:
    - `noteSending('A')`, rồi `isEcho({isSelf:true,text:'A'})` → `true`;
    - `isSelf:true, text:'B'` → `false` (Review Focus 3);
    - sau 61 giây không có `noteSent` → `false`;
    - `noteSent('m1','A')`, rồi `isEcho({msgId:'m1', isSelf:false})` → `true`.
  - `outbox.spec.ts`:
    - `post` trả `'retry'` hai lần rồi `'ok'` → gửi đúng 3 lần, tệp rỗng;
    - tạo `Outbox` mới trên cùng thư mục thì sự kiện chưa gửi được gửi tiếp (Review Focus 5);
    - sự kiện 25 giờ tuổi bị bỏ.
  - `credentials.spec.ts`, `config-store.spec.ts`, `send-dedupe.spec.ts`: lưu, đọc, xoá; TTL hết thì `get` → `undefined`.
- [ ] **Step 2:** `pnpm install` (thêm `zca-js@2.1.2`, `vitest`, `typescript`, `@types/node`), rồi `pnpm --filter @tubutree/zalo-bridge test`. Expected: FAIL, thiếu module.
- [ ] **Step 3:** Implement các file trên. `tsconfig` CommonJS độc lập theo kiểu `packages/shared-types/tsconfig.json`. Script: `build` (tsc), `test` (vitest run), `lint`, `typecheck`.
- [ ] **Step 4:** `pnpm --filter @tubutree/zalo-bridge test && pnpm --filter @tubutree/zalo-bridge typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(zalo-bridge): lõi cầu nối: mã hoá phiên, hàng đợi gửi giãn cách, lọc echo, hộp thư đi trên đĩa`.

### Task 2: Cầu nối Zalo, HTTP và đóng gói

**Files:**
- Create: `apps/zalo-bridge/src/{zalo-client.ts,reconnect.ts,qr-session.ts,server.ts,main.ts}` và spec
- Create: `apps/zalo-bridge/Dockerfile`
- Modify: `docker-compose.prod.yml`, `docker-compose.vietnix.yml`, `.github/workflows/docker-build.yml`, `apps/api/src/config/ci-workflows.spec.ts`, `apps/api/src/config/deploy-compose.spec.ts` (nếu spec liệt kê service)

**Interfaces:**
- Consumes: Task 1.
- Produces: `createZaloClient(deps: {api?: ZcaApiLike, credentials, configStore, outbox, echo, queue, dedupe, now})`, trả về:
  - `state(): ZaloBridgeHealth`;
  - `start()`;
  - `qrStart()`;
  - `qrStatus()`;
  - `logout()`;
  - `reconnect()`;
  - `groups()`;
  - `send({idempotencyKey, text}): Promise<{msgId}>`.

  `ZcaApiLike` là phần nhỏ của `zca-js` mà client dùng; test tiêm bản giả. `createServer(client, env)` trả về `http.Server` theo bảng HTTP ở trên.

- [ ] **Step 1: Write failing tests** (`zalo-client.spec.ts`, API giả)
  - Lọc nhóm:
    - tin nhóm `G1` khi `groupId='G1'` → `outbox.push` một sự kiện `message` đúng trường;
    - tin nhóm `G2` hoặc chat riêng → không push, không log nội dung.
  - `quote` có `globalMsgId: 123` → sự kiện `quote.globalMsgId === '123'`.
  - Tin ảnh (`content.href`) → `imageUrl` = href, `text = null`.
  - Sự kiện undo của nhóm `G1` → `{type:'undo', msgId}`.
  - Echo: tin `isSelf` trùng một tin vừa `send` → không push; `isSelf` khác nội dung → push.
  - Listener đóng mã 3000 → `state().state === 'KICKED'`, không tự kết nối lại sau 10 phút đồng hồ giả.
  - Đóng mã khác hoặc `error` → `CONNECTING`, thử lại sau 5 giây, 10 giây, …, tối đa 5 phút.
  - Có phiên nhưng `login` lỗi → `NEED_QR`.
  - `send` hai lần cùng `idempotencyKey` → API giả `sendMessage` gọi đúng 1 lần, hai lần trả cùng `msgId`.
  - `send` khi chưa có nhóm → lỗi `NO_GROUP`.
  - Mỗi lần đổi trạng thái → push sự kiện `state`.
  - Có `unknownCode` từ API → `send` dòng "Không tìm thấy mã #K7Q3, tin chưa tới khách." với khoá `unknown-<msgId>`.
  - `server.spec.ts`: thiếu Bearer → 401 trên mọi lệnh; `PUT /config` lưu `groupId`; `POST /send` trả `{msgId}`.
- [ ] **Step 2:** `pnpm --filter @tubutree/zalo-bridge test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - Dùng `new Zalo({ selfListen: true })`.
  - Đọc kiểu sự kiện `closed`/`disconnected`/`undo` và cấu trúc tin ảnh trong `node_modules/zca-js/dist/apis/listen.d.ts` và `models/*.d.ts`. Ghi trong comment dòng định nghĩa đã đối chiếu.
  - Trong `main.ts`, gọi `loadEnv` trước mọi việc; lỗi thì `process.exit(1)`.
  - Dockerfile `node:22-alpine`, theo mẫu `apps/api/Dockerfile:7-21` (pnpm 9.15.9), chạy `node dist/main.js`.
  - Service compose `zalo-bridge`:
    - `restart: unless-stopped`, `logging: *default-logging`, `env_file: .env`;
    - volume `zalo_bridge_data:/data`, `networks: [tubu]`;
    - **không** `ports`;
    - vietnix thêm `mem_limit: 256m`.
  - Thêm `zalo-bridge` vào ma trận `docker-build.yml` và assert ở `ci-workflows.spec.ts`.
- [ ] **Step 4:**
  - Chạy `pnpm --filter @tubutree/zalo-bridge test && pnpm --filter @tubutree/zalo-bridge build`, rồi `cd apps/api && npx jest src/config`. Expected: PASS.
  - Nếu máy có docker thì chạy thêm `docker build -f apps/zalo-bridge/Dockerfile .`. Không có docker thì ghi "chưa kiểm chứng".
- [ ] **Step 5:** Commit `feat(zalo-bridge): kết nối zca-js 2.1.2, chỉ nghe nhóm đã chọn, HTTP nội bộ, service docker`.

### Task 3: Dữ liệu, cấu hình, kiểu dùng chung

**Files:**
- Modify: `apps/api/prisma/schema.prisma`; Create: `apps/api/prisma/migrations/20261023100000_support_chat/migration.sql`
- Create: `apps/api/src/modules/support-chat/support-chat.config.ts`
- Modify: `apps/api/src/modules/system-config/system-config.service.ts` (`JSON_RULES` `:271`, `RANGES` `:97`), `apps/api/prisma/seed.ts` (`SYSTEM_CONFIGS` `:24`, `NOTIFICATION_TEMPLATES` `:741`), `apps/api/prisma/reference-data/config-selection.ts` (`REFERENCE_CONFIG_PREFIXES` `:12`), `reference-config-selection.spec.ts` (`APPROVED_LOADED_KEYS` `:22`)
- Modify: `apps/api/src/modules/data-retention/data-retention.service.ts` (`RETENTION_POLICY` `:19`, `cleanups()` `:127`)
- Create: `packages/shared-types/src/support-chat.ts`; Modify: `packages/shared-types/src/index.ts`

**Interfaces:**
- Produces:
  - Prisma models `SupportConversation`, `SupportMessage`, `SupportForward`, `SupportBridgeStatus` (đúng trường ở spec 5.3), cùng enum `SupportSender`, `SupportSource`, `SupportForwardStatus`.
  - Hằng ở `support-chat.config.ts`: `CHAT_ENABLED_KEY='chat.enabled'`, `CHAT_GROUP_KEY='chat.zalo_group_id'`, `CHAT_HOURS_KEY='chat.hours'`, `CHAT_OFF_HOURS_TEXT_KEY='chat.off_hours_text'`, `CHAT_RETENTION_KEY='retention.support_chat_days'`.
  - Hằng `DEFAULT_CHAT_HOURS={start:'08:00',end:'21:00'}` và `DEFAULT_OFF_HOURS_TEXT='Tubu Tree trả lời từ 8:00 đến 21:00 mỗi ngày. Tin của bạn đã được ghi lại, nhân viên sẽ trả lời khi vào giờ.'`.
  - Mẫu thông báo `SUPPORT_CHAT_REPLY` (INAPP, `'Tubu Tree đã trả lời bạn: {{preview}}'`) và `OPS_ZALO_BRIDGE_DOWN` (INAPP, `'Cầu nối Zalo của chat CSKH mất kết nối từ {{since}} ({{state}}). Vào tab Chat CSKH để kết nối lại.'`).
  - Kiểu ở mục "Hợp đồng dùng chung".

- [ ] **Step 1: Write failing tests**
  - Trong `system-config.service.spec.ts` (hoặc spec rule riêng):
    - `chat.hours` nhận `{start:'08:00',end:'21:00'}`;
    - từ chối `{start:'8h'}`, `start >= end`, thiếu trường;
    - `chat.enabled` chỉ nhận boolean.
  - `RANGES['retention.support_chat_days']` là `{min:90, max:3650, integer:true}`.
- [ ] **Step 2:** `cd apps/api && npx jest src/modules/system-config`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - Migration tạo bảng và chỉ mục:
    - `SupportMessage(conversationId, createdAt)`;
    - unique `(conversationId, clientMsgId)`;
    - unique `zaloMsgId` trên cả `SupportMessage` và `SupportForward`;
    - `SupportForward(status, createdAt)`.
  - Migration `INSERT … ON CONFLICT DO NOTHING` cho 2 mẫu thông báo, theo mẫu `20261020120000_dealer_bonus_topup_template`, và cho 5 khoá `system_configs`, theo cột của bảng.
  - Seed `createOnly: true` cho cùng các dòng.
  - Retention: thêm lớp `support_chat` (mặc định 365, tối thiểu 90) xoá `support_messages` và `support_forwards` có `createdAt < cutoff`.
  - Mọi khoá phải xuất hiện dạng chuỗi trong `support-chat.config.ts` (`dead-config-keys.spec.ts`).
- [ ] **Step 4:** Chạy lần lượt:
  - `cd apps/api && npx prisma generate && npx jest src/modules/system-config src/modules/data-retention src/modules/notifications prisma`;
  - `pnpm --filter @tubutree/shared-types build`.
  - Expected: PASS, gồm `support-config-seed`, `dead-config-keys`, `reference-config-selection`, `config-numeric-ranges`, `notification-templates-seed`.
- [ ] **Step 5:** Commit `feat(support-chat): bảng hội thoại, tin, lần chuyển, trạng thái cầu nối; khoá chat.* và mẫu thông báo`.

### Task 4: API khách: đọc, gửi, giới hạn, ngoài giờ, đặt lịch chuyển

**Files:**
- Create: `apps/api/src/modules/support-chat/{support-chat.module.ts,support-chat.service.ts,support-chat.controller.ts,dto/send-message.dto.ts,conversation-code.ts,chat-hours.ts}` và spec
- Modify: `apps/api/src/app.module.ts` (`:51-54`, `:111-115`), `apps/api/src/jobs/queues.ts` (`QUEUE_SUPPORT_CHAT_FORWARD = 'support-chat-forward'`), `apps/api/src/jobs/queue.module.ts:30-37`

**Interfaces:**
- Consumes: Task 3.
- Produces:
  - `newConversationCode(random = Math.random): string`.
  - `isWithinHours(now: Date, hours: {start,end}): boolean` theo giờ `Asia/Ho_Chi_Minh`.
  - `SupportChatService.getThread(userId)`, `.page(userId, {after?, before?})`, `.send(userId, input: SupportChatSendInput, source: 'MINIAPP'|'WEB')`, `.markRead(userId)`, `.unreadCount(userId)`.
  - `scheduleForward(conversationId: string): Promise<void>` (jobId `conv-<id>`, delay 15.000, gỡ job đã xong như `gomdon-queue.ts:40-67`, bọc `withQueueTimeout`).
  - `toCustomerDTO(m): SupportChatMessageDTO`.

- [ ] **Step 1: Write failing tests** (`support-chat.service.spec.ts`, Prisma giả theo `cskh.service.spec.ts`)
  - `getThread` tạo hội thoại với `code` đúng bảng chữ; trùng `code` (P2002) thì thử mã khác.
  - Tin STAFF có `recalledAt` không có trong `getThread` và `page`; DTO khách không có `staffName`.
  - `send` cùng `clientMsgId` hai lần → một `create`, lần hai trả tin cũ, `scheduleForward` gọi một lần (Review Focus 1).
  - `send` khi `chat.enabled=false` → 409 `CHAT_DISABLED`; khi `blockedAt` → 403 `CHAT_BLOCKED`.
  - `send` thiếu `body` lẫn `imageUrl` → 400.
  - Tin thứ 201 trong ngày (giờ VN) → 429.
  - Ngoài giờ, tin đầu trong ngày → thêm tin SYSTEM `DEFAULT_OFF_HOURS_TEXT` sau tin khách, đặt `lastOffHoursNoticeOn`; tin thứ hai cùng ngày → không thêm.
  - `unreadCount` đếm tin STAFF/SYSTEM chưa thu hồi, sau `customerReadAt`.
  - `thread.slow` là `true` khi `SupportBridgeStatus.state !== 'CONNECTED'` và `since` cách quá 10 phút.
  - `send-message.dto.spec.ts`:
    - `body` 1.001 ký tự → lỗi;
    - `imageUrl` không phải `https://res.cloudinary.com/...` → lỗi (không nhận base64);
    - `context.orderCode` ≤ 40 ký tự.
  - `chat-hours.spec.ts`: 07:59 → `false`, 08:00 → `true`, 20:59 → `true`, 21:00 → `false` (giờ VN, chạy cả `TZ=UTC`).
- [ ] **Step 2:** `cd apps/api && npx jest src/modules/support-chat`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - Controller `@Controller('me/support-chat')`.
  - `@Throttle({ default: { ttl: 60_000, limit: 10 } })` trên `POST messages`.
  - Nguồn là `WEB` khi header `x-client` của web có mặt; xem cách app phân biệt client hiện có, không có thì nhận trường `source` trong DTO, mặc định `MINIAPP`.
- [ ] **Step 4:** `cd apps/api && npx jest src/modules/support-chat src/common && TZ=UTC npx jest src/modules/support-chat`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(support-chat): API khách đọc gửi tin, chống gửi trùng, giới hạn, tin ngoài giờ`.

### Task 5: Chuyển tin vào Zalo

**Files:**
- Create: `apps/api/src/modules/support-chat/{bridge-client.ts,forward-format.ts,support-chat-forward.processor.ts}` và spec
- Modify: `apps/api/src/config/env.validation.ts` (`ZALO_BRIDGE_URL: z.union([z.literal(''), z.string().url()]).default('')`, `ZALO_BRIDGE_SECRET: z.string().default('')`), `.env.production.example`, `apps/api/.env.example`

**Interfaces:**
- Consumes: Task 3 and 4 (`QUEUE_SUPPORT_CHAT_FORWARD`).
- Produces:
  - `BridgeClient`:
    - `health(): Promise<ZaloBridgeHealth|null>` (null khi không gọi được);
    - `send(key, text): Promise<{ok:true,msgId}|{ok:false, retry:boolean, unknown:boolean, code, message}>`;
    - `qrStart()`, `qrStatus()`, `logout()`, `reconnect()`, `groups()`, `setGroup(id)`.

    Hết giờ 15 giây với `send` thì `unknown:true`. URL trống thì mọi lệnh trả `{ok:false, retry:false, code:'BRIDGE_NOT_CONFIGURED'}`.
  - `formatForward(input: {code, name, phone: string|null, tier: string|null, context: SupportChatContext|null, items: {body, imageUrl}[]}): string`.
  - `maskPhone(p: string): string`.

- [ ] **Step 1: Write failing tests**
  - `forward-format.spec.ts`:
    - đúng mẫu ở spec 4.3 với `code:'K7Q2', name:'Lan', phone:'0901234234', tier:'Hạng Vàng', context:{orderCode:'TT12345'}`;
    - không có SĐT thì dòng đầu là `#K7Q2 · Lan · Hạng Vàng`;
    - `maskPhone('0901234234') === '09•••••234'`;
    - dòng cuối đúng `(Trả lời tin này, hoặc gõ #K7Q2 ở đầu câu, để gửi cho khách)`;
    - dòng đầu khớp regex đầu tin chuyển.
  - `support-chat-forward.processor.spec.ts`:
    - gom mọi tin CUSTOMER `forwardId = null` của hội thoại thành một `SupportForward` và gán `forwardId`;
    - tổng nội dung > 3.000 ký tự thì phần dư để lại và đặt lịch lần sau;
    - `send` ok → `SENT`, `zaloMsgId`, `sentAt`;
    - `retry:true` → ném lỗi để BullMQ thử lại, giữ `PENDING`;
    - `unknown:true` → `UNKNOWN`, không ném;
    - lỗi khác → `FAILED`, ghi `lastError`;
    - chat đã tắt sau khi khách gửi → vẫn chuyển;
    - hội thoại bị chặn → không chuyển, tin giữ `forwardId = null`.
  - `bridge-client.spec.ts` (`fetch` giả): header Bearer; hết giờ thì `unknown:true`; 409 `NOT_CONNECTED` thì `retry:true`.
  - `env-example.spec.ts` xanh với 2 biến mới.
- [ ] **Step 2:** `cd apps/api && npx jest src/modules/support-chat src/config`. Expected: FAIL.
- [ ] **Step 3:** Implement. Processor theo mẫu `notifications.processor.ts:21-29`. Lấy hạng theo trường hạng hiện có của `User`; không có thì `null`.
- [ ] **Step 4:** Chạy lại lệnh Step 2. Expected: PASS.
- [ ] **Step 5:** Commit `feat(support-chat): gộp và chuyển tin khách vào nhóm Zalo qua cầu nối, không tự gửi lại khi không rõ kết quả`.

### Task 6: Nhận trả lời từ Zalo

**Files:**
- Create: `apps/api/src/modules/support-chat/{bridge-events.controller.ts,bridge-events.service.ts,staff-reply-parse.ts}` và spec
- Create: `apps/api/test/integration-race/support-chat.race-spec.ts`
- Modify: `Caddyfile:13-16` (chặn `/api/internal/*` từ ngoài: `@internal path /api/internal/*` + `respond @internal 404`), `ops/vietnix-vhost-*` (chặn cùng đường dẫn), `apps/miniapp/src/pages/notifications.tsx:37,97` và `apps/web/src/components/account/notification-view.ts:100,116` (mã `SUPPORT_CHAT_REPLY` mở `/chat`, web `/ho-tro/chat`)

**Interfaces:**
- Consumes: Task 3, 4, 5.
- Produces:
  - `parseStaffReply(text: string|null): {code: string|null, body: string}`.
  - `isForwardHeader(text: string): boolean`.
  - `BridgeEventsService.handle(e: ZaloBridgeEvent): Promise<{status: 200|503, body: {ok:true, unknownCode?}|{retry:true}}>`.

- [ ] **Step 1: Write failing tests** (`bridge-events.service.spec.ts`)
  - Bearer sai hoặc `ZALO_BRIDGE_SECRET` trống → 401 ở controller, ở mọi môi trường.
  - `msgId` trùng `SupportForward.zaloMsgId` → bỏ.
  - `isSelf` và `isForwardHeader` → bỏ.
  - `isSelf`, nội dung thường, có trích tin chuyển → tin STAFF (Review Focus 3).
  - `quote.globalMsgId` khớp forward tạo hôm trước → tin STAFF đúng hội thoại (Review Focus 2).
  - Mã `#k7q2 Dạ đơn giao chiều nay` → tin STAFF `body = 'Dạ đơn giao chiều nay'`.
  - Mã `#K7Q3` không tồn tại → 200 `{ok:true, unknownCode:'K7Q3'}`, không tạo tin.
  - Câu thường không trích, không mã → 200, không tạo tin.
  - Có `quote` chưa khớp + có forward `PENDING` không `zaloMsgId` tạo trong 5 phút → 503; quá 5 phút → 200 bỏ.
  - Cùng `msgId` hai lần → một tin (P2002 bỏ êm, Review Focus 5).
  - Hội thoại bị chặn vẫn nhận tin STAFF; khách đã xoá (không còn hội thoại) → 200 bỏ (Review Focus 4).
  - Tin STAFF mới → `notify(userId, 'SUPPORT_CHAT_REPLY', {preview, route:'/chat'}, {dedupeKey:'support-reply-<convId>', dedupeWithinMs:600000})`; `preview` ≤ 60 ký tự.
  - `undo` → `recalledAt` cho tin STAFF có `zaloMsgId`.
  - `state` → upsert `SupportBridgeStatus`; `since` chỉ đổi khi `state` đổi.
  - `staff-reply-parse.spec.ts`: `'#K7Q2'` không nội dung → `body = ''`; `'#K7Q22 abc'` → `code = null`.
  - Race spec (Postgres thật):
    - 5 lần `send` song song trong 15 giây → một `SupportForward` sau khi processor chạy;
    - hai `handle` cùng sự kiện song song → một tin;
    - trả lời tới khi forward còn `PENDING` → 503, rồi ghi `zaloMsgId` và gửi lại → một tin STAFF;
    - echo (`isSelf`, đầu tin chuyển) tới trước khi ghi `zaloMsgId` → không có tin STAFF.
- [ ] **Step 2:**
  - `cd apps/api && npx jest src/modules/support-chat`. Expected: FAIL.
  - Race: `DATABASE_URL=postgresql://…/tubutree_it npx jest -c test/integration-race/jest.config.js --runInBand support-chat`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - `@Public() @SkipThrottle() @Controller('internal/zalo-bridge')`, `@Post('events') @HttpCode(200)`.
  - 503 trả bằng `ServiceUnavailableException({retry:true})`.
- [ ] **Step 4:** Chạy lại cả hai lệnh, thêm `cd apps/miniapp && npx vitest run src/pages/notifications` và `cd apps/web && npx vitest run --minWorkers=1 --maxWorkers=4 src/components/account`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(support-chat): nhận trả lời của nhân viên từ nhóm Zalo, khớp theo trích tin hoặc mã, chống mất và trùng`.

### Task 7: API admin, cron sức khoẻ, ops inbox, xoá tài khoản

**Files:**
- Create: `apps/api/src/modules/support-chat/{support-chat-admin.controller.ts,support-chat-admin.service.ts,bridge-health.cron.ts}` và spec
- Modify: `apps/api/src/common/staff-permissions.matrix.spec.ts:29`, `apps/api/src/modules/ops/ops-inbox.service.ts:23,74` + `ops-inbox.service.spec.ts:299,317,336` + `test/integration-race/ops-health.race-spec.ts:171,184`, `apps/api/src/modules/users/account-deletion.service.ts:304-337`

**Interfaces:**
- Consumes: Task 3–6.
- Produces:
  - Lệnh ở bảng "API admin".
  - `InboxKey` thêm `'supportChatUnforwarded'` (audience `['CSKH']`) và `'zaloBridgeDown'` (audience `'ADMIN'`).
  - `BridgeHealthCron.everyMinute()`.

- [ ] **Step 1: Write failing tests**
  - `support-chat-admin.service.spec.ts`:
    - `PUT settings {groupId:'G1'}` → `SystemConfigService.set(CHAT_GROUP_KEY,'G1',adminId)` và `bridge.setGroup('G1')`;
    - `reply` → tin STAFF nguồn `ADMIN` có `adminUserId`, gửi thông báo như Task 6, không gửi vào Zalo;
    - `resend` chỉ nhận `FAILED`/`UNKNOWN`, dùng `idempotencyKey = forward.id`;
    - `block` đặt `blockedAt` và `blockedByUserId`, `unblock` xoá;
    - tìm `q='K7Q2'` theo mã, `q='0901'` theo SĐT;
    - `filter=unforwarded` trả hội thoại có forward `FAILED|UNKNOWN` hoặc tin khách chưa chuyển quá 10 phút;
    - `qrStart`, `logout`, `reconnect` ghi một sự kiện có `adminUserId` (dùng `recordUserAdminEvent` ở `common/user-admin-events.ts` nếu hợp kiểu, không thì bảng riêng trong migration Task 3).
  - Bảng ma trận quyền: thêm từng dòng theo cột "CSKH" của bảng admin (`[CSKH]` hoặc `ADMIN_ONLY`).
  - `bridge-health.cron.spec.ts`:
    - `health()` null → `UNREACHABLE`;
    - cầu nối có `groupId` khác cấu hình → gọi `setGroup`;
    - không `CONNECTED` quá 10 phút và `downAlertedAt` trống hoặc cách hơn 1 giờ → `notifyAdmins` mẫu `OPS_ZALO_BRIDGE_DOWN` một lần, đặt `downAlertedAt`;
    - tin khách chưa chuyển quá 2 phút → `scheduleForward`.
  - Ops inbox spec: hai khoá mới có số đếm đúng.
  - `account-deletion.service.spec.ts`: xoá tài khoản thì xoá tin, lần chuyển, hội thoại của người đó trong cùng giao dịch.
- [ ] **Step 2:** `cd apps/api && npx jest src/modules/support-chat src/modules/ops src/modules/users src/common`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - Cron `@Cron('0 * * * * *', { timeZone: CRON_TZ })` có cờ `running` như `external-claim.cron.ts:33-37`.
  - Xoá tài khoản theo thứ tự khoá đã ghi ở `account-deletion.service.ts:140-165`.
- [ ] **Step 4:** Chạy lại lệnh Step 2, cùng `ops-health` race. Expected: PASS.
- [ ] **Step 5:** Commit `feat(support-chat): API admin chat CSKH, cron sức khoẻ cầu nối, mục ops inbox, xoá theo tài khoản`.

### Task 8: app-core, public config, route map

**Files:**
- Create: `packages/app-core/src/api/support-chat.ts`, `packages/app-core/src/queries/support-chat.ts` và spec
- Modify: `apps/api/src/modules/system-config/public-config.ts:65-124`, `packages/app-core/src/api/config.ts:8`, `apps/miniapp/src/services/shop-api.ts:201`, `packages/app-core/src/route-map.json` (`{ "miniapp": "/chat", "web": "/ho-tro/chat", "private": true }`)

**Interfaces:**
- Produces:
  - `getSupportChat(http)`, `getSupportChatPage(http, {after?, before?})`, `sendSupportChat(http, input)`, `markSupportChatRead(http)`, `getSupportChatSummary(http)`.
  - Queries `supportChatQuery(http)` key `['support-chat']` và `supportChatSummaryQuery(http)` key `['support-chat-summary']`.
  - Public config `chat: {enabled: boolean, hours: {start: string, end: string}}`.

- [ ] **Step 1:** Spec app-core: mỗi hàm gọi đúng đường dẫn, đúng method. Spec `public-config.spec.ts`: `chat.enabled` mặc định `false`, `chat.hours` mặc định `DEFAULT_CHAT_HOURS`.
- [ ] **Step 2:** `cd packages/app-core && npx vitest run src/api/support-chat src/queries` và `cd apps/api && npx jest public-config`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Chạy lại lệnh Step 2. Expected: PASS. `pnpm lint:parity` sẽ đỏ tới khi Task 9 và 10 có trang; tạm đặt `"pending": true` ở Task 8 rồi bỏ ở Task 10.
- [ ] **Step 5:** Commit `feat(support-chat): hàm gọi API chat trong app-core, public config chat, route /chat`.

### Task 9: Màn chat Mini App và lối vào

**Files:**
- Create: `apps/miniapp/src/pages/support-chat.tsx`, `apps/miniapp/src/components/support-chat/{message-list.tsx,composer.tsx,context-chip.tsx}`, `apps/miniapp/src/services/support-chat-api.ts` và spec
- Modify: `apps/miniapp/src/components/app.tsx` (lazy `SupportChatPage`, `<Route path="/chat">`), `components/support-contact.tsx`, `pages/product-detail.tsx:759`, `pages/about.tsx:110`, `pages/profile.tsx:73-80` (`MENU` nhóm "Khác": `{ label: 'Chat với Tubu Tree', to: '/chat' }` có chấm đỏ theo `unreadCount`)

**Interfaces:**
- Consumes: Task 8.
- Produces: route `/chat?order=<code>` hoặc `/chat?product=<slug>`.

- [ ] **Step 1: Write failing tests** (`pages/support-chat.spec.tsx` theo mẫu `wishlist.spec.tsx`)
  - Hiện tin cũ → mới; tin khách bên phải, tin Tubu Tree bên trái có chữ "Tubu Tree".
  - Gửi: tin hiện ngay trạng thái "Đang gửi", API trả về thì "Đã gửi"; `clientMsgId` giữ nguyên khi bấm gửi lại sau lỗi mạng.
  - `?order=TT12345` → thẻ "Về đơn TT12345"; tin đầu gửi kèm `context.orderCode`, tin sau không kèm.
  - `slow: true` → dòng "Nhân viên có thể trả lời chậm. Cần gấp, gọi hotline <support.hotline>".
  - `blocked: true` → ô nhập ẩn, hiện câu ở hợp đồng.
  - `enabled: false` → ô nhập ẩn, hiện câu `CHAT_DISABLED`.
  - Không Cloudinary → không có nút ảnh.
  - Ô nhập chặn ở 1.000 ký tự.
  - Mở màn → `markSupportChatRead`.
  - `refetchInterval` 5.000 khi `document.visibilityState === 'visible'`, `false` khi ẩn.
  - `support-contact.spec.tsx`:
    - chat bật và đã đăng nhập → nút "Chat với Tubu Tree" điều hướng `/chat?order=<orderCode>`, không còn nút OA;
    - chat tắt → giữ nút OA và hotline như cũ;
    - chat bật nhưng chưa đăng nhập → giữ nút OA và hotline, thêm lời mời "Đăng nhập để chat với Tubu Tree".
  - `profile` spec: dòng menu chỉ hiện khi `chat.enabled`.
- [ ] **Step 2:** `cd apps/miniapp && npx vitest run src/pages/support-chat src/components/support-contact src/pages/profile`. Expected: FAIL.
- [ ] **Step 3:** Implement bằng component và token sẵn có của Mini App (`zmp-ui`, `ListRow`, màu trong theme). Giờ hiển thị dùng helper trong `utils/format.ts`.
- [ ] **Step 4:** `cd apps/miniapp && npx vitest run && TZ=UTC npx vitest run && npx tsc --noEmit`. Expected: PASS, gồm `format-guard.spec.ts`.
- [ ] **Step 5:** Commit `feat(miniapp): màn chat với Tubu Tree, lối vào từ đơn, sản phẩm, hồ sơ`.

### Task 10: Màn chat web

**Files:**
- Create: `apps/web/src/app/ho-tro/chat/{layout.tsx,page.tsx,page.spec.tsx}`, `apps/web/src/components/support-chat/*`
- Modify: `apps/web/src/app/page-titles.spec.ts`, `apps/web/src/components/account/account-menu.ts:33`, `apps/web/src/lib/site.ts:16` (thêm `/ho-tro/chat` vào đường riêng tư), `apps/web/src/app/san-pham/[slug]/pdp-extras.tsx:326`, `apps/web/src/app/gioi-thieu/about-view.tsx:184,228`, `packages/app-core/src/route-map.json` (bỏ `pending`)

**Interfaces:**
- Consumes: Task 8.

- [ ] **Step 1: Write failing tests**: các ca như Task 9 trong `page.spec.tsx` (mẫu `tai-khoan/yeu-thich/page.spec.tsx`), cùng ca khách chưa đăng nhập thấy `LoginRequired` với `returnTo="/ho-tro/chat"`. Ảnh dùng `components/account/cloudinary-upload.ts`.
- [ ] **Step 2:** `cd apps/web && npx vitest run --minWorkers=1 --maxWorkers=4 src/app/ho-tro src/components/account src/app/page-titles`. Expected: FAIL.
- [ ] **Step 3:** Implement. Khổ ≤ 430 px giống Mini App (cùng thứ tự, cùng chữ).
- [ ] **Step 4:** Chạy lần lượt:
  - `cd apps/web && npx vitest run --minWorkers=1 --maxWorkers=4`, lặp lại với `TZ=UTC`;
  - `npx tsc --noEmit`;
  - `pnpm lint:parity`.

  Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): màn chat với Tubu Tree, giống Mini App ở khổ điện thoại`.

### Task 11: Tab admin "Chat CSKH"

**Files:**
- Create: `apps/web/src/components/admin/support-chat-tab.tsx`, `apps/web/src/components/admin/support-chat/{bridge-card.tsx,qr-modal.tsx,conversation-list.tsx,conversation-detail.tsx}` và spec
- Modify: `apps/web/src/lib/admin-client.ts` (hàm cho từng lệnh admin; `InboxKey` `:1662`), `apps/web/src/app/admin/page.tsx` (`Tab` `:167-209` thêm `'supportChat'`, `NAV_GROUPS` `:280` `{ k: 'supportChat', label: 'Chat CSKH' }`, `STAFF_TABS.CSKH` `:310`, render `:607`, map ops inbox `:472-498`), `apps/web/src/components/admin/ops-inbox-tab.tsx:11`, `apps/web/src/app/admin/page.spec.tsx:2074`

**Interfaces:**
- Consumes: Task 7.

- [ ] **Step 1: Write failing tests** (mẫu `engagement-tab.spec.tsx`)
  - Thẻ trạng thái hiện chữ theo `state`: `CONNECTED` "Đang kết nối", `NEED_QR` "Cần quét QR", `KICKED` "Đăng nhập nơi khác", `UNREACHABLE`/`ERROR` "Mất kết nối từ HH:MM".
  - STAFF CSKH không thấy nút đăng nhập, đăng xuất, chọn nhóm, công tắc.
  - QR: hỏi `GET bridge/qr` mỗi 2 giây, dừng khi `SUCCESS`/`EXPIRED`/`FAILED`.
  - Công tắc bật chat có hộp xác nhận; Huỷ thì không gọi API.
  - Hội thoại: tìm, lọc "Có tin chưa chuyển được", mở chi tiết thấy `staffName`.
  - "Gửi lại" chỉ hiện với `FAILED`/`UNKNOWN`.
  - Trả lời gọi `POST conversations/:id/reply`.
  - Chặn có xác nhận.
  - Ops inbox: hai nhãn mới, bấm thì mở tab `supportChat`.
- [ ] **Step 2:** `cd apps/web && npx vitest run --minWorkers=1 --maxWorkers=4 src/components/admin src/app/admin`. Expected: FAIL.
- [ ] **Step 3:** Implement theo các tab admin hiện có (`./ui`, `LoadError`).
- [ ] **Step 4:** Chạy lại lệnh Step 2 và `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(admin): tab Chat CSKH: kết nối Zalo bằng QR, chọn nhóm, bật tắt, xem và trả lời hội thoại`.

### Task 12: E2E, tài liệu vận hành, gate

**Files:**
- Create: `apps/e2e/tests/support/support-chat-mocks.ts`, `apps/e2e/tests/support-chat.miniapp.spec.ts`, `apps/e2e/tests/support-chat.web.spec.ts`, `apps/e2e/tests/admin-support-chat.spec.ts`
- Modify: `apps/e2e/playwright.config.ts:117` (thêm spec admin), `docs/GO-LIVE-KEYS.md` (mục mới "Chat CSKH qua Zalo cá nhân": số riêng, tạo nhóm, biến `ZALO_BRIDGE_*`, cảnh báo Zalo PC/Web, thử tay theo spec mục 7), `docs/launch/deploy-rollback-runbook.md` (service `zalo-bridge`, migration mới)

- [ ] **Step 1:** Viết spec Playwright với mock API:
  - Mini App: gửi tin rồi lần hỏi sau trả thêm tin Tubu Tree, hiện bên trái.
  - Web khổ 390: cùng luồng.
  - Admin: thấy trạng thái, mở hội thoại, trả lời.
  - Chụp màn chat Mini App và web cùng khổ 390 px với cùng dữ liệu mock, lưu ở `docs/2026-10-23-q5/screens/`, so cạnh nhau: bố cục, chữ, thứ tự phải giống.
- [ ] **Step 2:**
  - Mini App: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3283 npx playwright test support-chat`.
  - Web: `rm -rf apps/web/.next && E2E_API_PORT=3281 E2E_WEB_PORT=3282 E2E_MINIAPP_PORT=3283 scripts/web-gate.sh --workers=3`.

  Expected: PASS.
- [ ] **Step 3:**
  - Gate đủ: `bash docs/2026-10-20-uat/tools/gate.sh "$PWD" docs/2026-10-23-q5/logs/gate-1 full`. Chỉ chạy khi `uptime` < 40. Expected: dòng cuối `XANH: …`.
  - Kèm `pnpm --filter @tubutree/zalo-bridge test`.
- [ ] **Step 4:** Commit `test(e2e): luồng chat CSKH Mini App, web, admin; tài liệu bật cầu nối Zalo`.
