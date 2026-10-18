# PROMPT — Đưa toàn bộ chức năng Mini App lên website (chạy xuyên đêm)

> Dán nguyên phần dưới vạch vào một phiên Claude Code (Opus 5.5, effort high), mở ở thư mục gốc repo
> `/Users/longla/coding/tubutree-mini-app`. Nhánh nền `web/base` và worktree `.claude/worktrees/web-parity`
> (nhánh `web/integration`) đã tạo sẵn ngày 2026-10-18.

---

Dùng workflow và subagent cho việc này (tôi cho phép điều phối nhiều agent, tối đa 4 lane chạy song song mỗi đợt).

## Quyết định chủ dự án đã chốt (2026-10-18), không hỏi lại

| # | Chủ đề | Quyết định |
|---|---|---|
| Q1 | Nhánh gốc | `BASE = web/base` (db9adca0: `review/2026-10-18-launch` d2dcbe0b gộp với `feat/recycle-rewards` ef5ad5ed). `main` giữ nguyên vì hai nhánh kia còn nhận commit |
| Q2 | Số điện thoại trên web | Không xác minh SĐT trên web. Khách nhập SĐT ở địa chỉ giao hàng như hiện tại. Tính năng dựa vào SĐT đã xác minh (cộng điểm theo SĐT, quét mã đơn sàn, gộp tài khoản theo SĐT, `ensure-phone`) chỉ có trên Mini App; web hiện lời dặn "mở Mini App để dùng" kèm nút "Mở trên Zalo". Ghi `skip` có lý do trong file ánh xạ |
| Q3 | Zalo App ID | Web và Mini App dùng chung một Zalo App ID, nên một khách là một User (tra theo `zaloId`). Vẫn kiểm cấu hình ở bước 1; thấy lệch thì dừng phần ví/điểm/đơn và ghi câu hỏi |
| Q4 | Thanh toán web | Chỉ chuyển khoản QR + COD (phương thức API đã hỗ trợ cho web). Không thêm cổng ZaloPay web |
| Q5 | Màn nội bộ | Có, đưa lên web giống hệt Mini App (đại lý, nhân viên, bảng lương, chủ thương hiệu + doanh số, kiểm duyệt cộng đồng), kiểm quyền theo vai trò như Mini App. Làm sau màn khách hàng |
| Q6 | Máy tính | Responsive đầy đủ: điện thoại giống Mini App; máy tính có header điều hướng, lưới nhiều cột, khung rộng tối đa, theo các trang web đang có |
| Q7 | Thứ tự | `core` → `shop` → `account` → `loyalty` → `community` → `affiliate` → `game`, `ai` → `pro` → `recycle` |
| Q8 | Song song | 4 lane mỗi đợt. Gate tổng không chạy cùng lúc với lane đang chạy test |

## Mục tiêu

Repo này là monorepo Tubu Tree: `apps/api` (NestJS + Prisma), `apps/miniapp` (Zalo Mini App: Vite + React + zmp-ui + zmp-sdk), `apps/web` (Next.js 14 App Router + Tailwind), `apps/e2e` (Playwright), `packages/*` (shared-types, design-tokens, configs).

`apps/web` hiện chỉ có khoảng 16 route (trang chủ, sản phẩm, giỏ, thanh toán, tài khoản/địa chỉ/điểm xanh/đơn hàng/ví, đăng nhập Zalo OAuth, brand, gian hàng `/s/[slug]`, chính sách, admin, merchant, POS). Mini App có khoảng 45 màn ở `apps/miniapp/src/pages`.

Việc cần làm: **website khách hàng có đủ mọi chức năng của Mini App, hành vi giống nhau, chỉ đổi nền tảng.** Đồng thời dựng sẵn cấu trúc để từ nay mỗi chức năng mới được làm cho cả hai nền tảng mà không viết logic hai lần, và có một kiểm tra tự động chặn việc quên một nền tảng.

Giữ nguyên monorepo. Không tách repo.

## Luật cứng (vi phạm là dừng)

1. Không `git push`, không mở PR, không merge vào `main`, không deploy, không ghi vào DB PROD/UAT hay DB dùng chung. Mọi thứ chỉ ở nhánh cục bộ.
2. Không đổi hành vi API đang có. Chỉ được **thêm** endpoint hay trường mới khi web thật sự cần. Mỗi thay đổi API phải có test và qua review Opus.
3. Chỗ dính **tiền, điểm, ví, mã giảm giá, hoa hồng, xác thực, số điện thoại, liên kết tài khoản**: không tự quyết. Chọn phương án an toàn nhất (tắt hoặc ẩn trên web), ghi câu hỏi vào báo cáo sáng. Gói đụng các chỗ này phải qua 2 lượt review Opus.
4. Không sửa test của Mini App để cho xanh. Test Mini App phải xanh trước và sau mỗi gói, không đổi số test trừ khi thêm.
5. Không xoá hay revert file mình không tạo. Không `pkill -f`; chỉ kill theo cổng: `lsof -ti tcp:<port> -sTCP:LISTEN | xargs kill`.
6. Không viết comment kể lại thay đổi ("đổi X thành Y"). Comment chỉ giải thích lý do không hiển nhiên.
7. Nói "xong" chỉ khi đã chạy lệnh kiểm chứng và dán kết quả. Chưa chạy thì ghi "chưa kiểm chứng".

## Môi trường (bài học cũ, làm đúng ngay từ đầu)

- Mọi lệnh shell: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`.
- `npx prisma generate` chạy trong `apps/api`, sau mỗi merge có đổi schema.
- Docker: chỉ `docker run --rm --tmpfs ...` và `docker rm -f -v`. DB test race: container `tubu_it_main` cổng 5550, DB `tubutree_it`.
- Web chạy ở `localhost`, không dùng `127.0.0.1` (middleware đọc nhãn đầu Host làm subdomain gian hàng).
- Test ngày giờ: chạy thêm `TZ=UTC` trước khi tin là xanh.
- Playwright: không chạy `npx playwright test <file>` trần (tự bật API theo `.env` dùng chung). Dùng scope rõ ràng; với web dùng DB riêng của worktree.
- macOS không có `timeout`. Không sửa script bash đang chạy. Không chạy gate tổng cùng lúc với agent đang chạy test (tranh CPU gây P2028 giả).

## 0. Nhánh gốc và tránh đụng việc khác

`BASE = web/base`

1. Worktree tích hợp `.claude/worktrees/web-parity`, nhánh `web/integration`, đã tạo từ `web/base`. Chưa có thì tạo.
2. Phiên đổi rác (`tubutree-mini-app-f8`) và phiên launch (`tubutree-mini-app-80`) vẫn có thể thêm commit vào `feat/recycle-rewards` và `review/2026-10-18-launch`. **Trước mỗi đợt lane**, nếu một trong hai nhánh có commit mới (`git rev-list --count web/integration..<nhánh>` > 0), gộp nhánh đó vào `web/integration` trên một worktree rảnh, chạy `npx prisma generate` trong `apps/api` và gate typecheck của ba app, rồi mới tạo lane mới. Xung đột thì không tự giải phần của phiên khác: dừng gộp, ghi vào `PROGRESS.md`, chạy tiếp trên bản cũ. Không sửa file trên hai nhánh đó, không gộp gì vào `main`.
3. Ghi `docs/2026-10-19-web-parity/PROGRESS.md` ngay từ đầu và cập nhật sau mỗi bước (gói nào xong, hash, lệnh kiểm chứng, gói nào đang chạy, agent id). **Nếu phiên bị ngắt vì hết hạn mức rồi tôi dán lại prompt này, đọc PROGRESS.md trước và làm tiếp, không làm lại.**

## 1. Khảo sát (chỉ viết tài liệu, không sửa code)

Giao cho scout (Haiku) quét, phần kết luận do phiên chính (Opus) làm. Kết quả ở `docs/2026-10-19-web-parity/`:

**00-ma-tran.md — ma trận tương đương.** Mỗi màn trong `apps/miniapp/src/pages` một dòng:
- màn Mini App, route web tương ứng (đã có / thiếu / có nhưng thiếu chức năng con), chức năng con còn thiếu,
- API dùng (file service), quyền/vai trò cần, Zalo SDK dùng,
- trang công khai (cần SEO, SSR/ISR) hay riêng tư (client, `noindex`),
- lane dự kiến và độ ưu tiên.
Đọc cả tài liệu quyết định đang có: `ARCHITECTURE_DECISIONS.md`, `docs/2026-09-08-feature-map.md`, `docs/2026-10-18-launch-review/03-cau-hoi-sang.md` (mục "Quyết định đã chốt"), `docs/2026-10-18-launch-review/impl/webconv.md`. Test đang khoá quyết định cũ (ví dụ `apps/miniapp/src/no-merchant-web-entry.spec.ts`, `apps/web/src/merchant-no-guest-entry.spec.ts`) phải được tôn trọng; chỗ nào mâu thuẫn với "giống nhau toàn bộ" thì ghi câu hỏi, không tự phá.

**01-thiet-ke.md — kiến trúc hai nền tảng.** Chốt theo hướng sau, chỉ lệch khi có lý do ghi rõ:

1. `packages/app-core` (TypeScript thuần, không import `zmp-sdk`, `zmp-ui`, `next`, `react-router`):
   - hàm gọi API theo từng miền, nhận một `HttpClient` tiêm vào (Mini App bọc axios, web bọc fetch hiện có ở `apps/web/src/lib/api.ts`, `client-api.ts`),
   - query key và hook React Query dùng chung (React thuần, không phụ thuộc router),
   - quy tắc nghiệp vụ phía client đang bị viết hai lần (ví dụ `cart-key`, `checkout-rules`, `checkout-points`, định dạng tiền/ngày, chữ tiếng Việt dùng chung),
   - kiểu dữ liệu lấy từ `packages/shared-types`.
2. Interface `PlatformBridge` trong app-core cho mọi khả năng riêng của nền tảng; Mini App cài bằng `apps/miniapp/src/services/zmp-bridge.ts` (đang có), web cài mới. Bảng ánh xạ mặc định:

| Mini App (zmp-sdk) | Web |
|---|---|
| `getAccessToken` / `login` | Zalo OAuth đang có (`POST /auth/zalo-oauth`, trang `/dang-nhap`) |
| `getPhoneNumber` / `ensure-phone` | Không có trên web (Q2). Tính năng cần SĐT đã xác minh hiện lời dặn mở Mini App |
| `getStorage` / `setStorage` | `localStorage` bọc try/catch |
| `openShareSheet` | Web Share API, dự phòng chép liên kết (đã có `share-button.tsx`) |
| `getLocation` | `navigator.geolocation`, từ chối thì cho chọn tay |
| `openChat` / `followOA` | liên kết `https://zalo.me/<OA id>` |
| `openPhone` | `tel:` |
| `openWebview` | liên kết thường |
| `requestSendNotification` | trung tâm thông báo trong web; không làm web push đợt này |
| `Payment` (ZaloPay trong Mini App) | chuyển khoản QR + COD (Q4). Không tích hợp cổng thanh toán mới |

3. Giao diện tách theo nền tảng: Mini App giữ zmp-ui + react-router; web dùng Next App Router + Tailwind + `@tubutree/design-tokens` theo hệ thiết kế web hiện có (`ds-v2-guest`). Không ép chia sẻ component giao diện đợt này; chỉ đưa vào `packages/` component thuần trình bày nếu cả hai bên đã giống hệt.
4. Web phải chạy tốt cả điện thoại (dưới 768px giống Mini App, có thanh dính đáy) và máy tính (header điều hướng, khung rộng tối đa, không kéo ngang).
5. **Liên kết tài khoản (Q3):** chủ xác nhận web và Mini App dùng chung một Zalo App ID. Kiểm lại trong code và cấu hình: `ZALO_APP_ID` mà `apps/api/src/modules/auth/zalo.service.ts` dùng cho OAuth web, so với app id của Mini App (`apps/miniapp/app-config.json` hoặc file cấu hình zmp tương đương, các file `.env*`). Chỉ ghi tên biến và kết quả khớp/lệch, không chép giá trị bí mật vào tài liệu. Lệch thì dừng phần ví/điểm/đơn trên web và ghi câu hỏi. Không tự viết cơ chế gộp tài khoản.

**02-ke-hoach.md — các lane**, mỗi lane một nhánh và một worktree riêng, ghi danh sách file dự kiến sửa để hai lane cùng đợt không chạm cùng file. Thứ tự theo Q7 (chỉ đổi khi phụ thuộc kỹ thuật bắt buộc, ghi lý do):
1. `core` — tạo `packages/app-core` + `PlatformBridge` + bản web của bridge. Chuyển Mini App sang dùng app-core **từng module**, chỉ module mà lane khác cần, hành vi giữ nguyên.
2. `shop` — home feed, browse/lọc, wishlist, flash sale, group-buy, brand view/story, phần còn thiếu của trang sản phẩm (mã giảm giá, freeship, đơn vị giao, đánh giá, chia sẻ).
3. `account` — hub hồ sơ, sửa hồ sơ, cài đặt + tuỳ chọn thông báo, trung tâm thông báo, đơn hàng/chi tiết (đổi trả, đánh giá theo đơn, mua lại), chuyển khoản, yêu cầu xoá tài khoản (`POST /me/deletion-request`).
4. `loyalty` — hạng thành viên, cashback, ví, điểm xanh, refill, đặt định kỳ.
5. `community` — feed, bài viết, sự kiện, bảng xếp hạng, kiểm duyệt, academy, giới thiệu. Trang công khai làm SSR/ISR + metadata + sitemap.
6. `affiliate` — CTV/affiliate, `?ref=`, bộ nội dung chia sẻ, gian hàng và trình dựng gian hàng.
7. `game` — vòng quay.
8. `ai` — trợ lý AI.
9. `pro` — đại lý, nhân viên, bảng lương, chủ thương hiệu và doanh số, kiểm duyệt cộng đồng (Q5: làm đủ, kiểm quyền theo vai trò như Mini App).
10. `recycle` — các màn đổi rác (đã nằm trong main theo Q1).

Dừng ở đây 1 lần: tự review 00–02 bằng một agent Opus (reviewer) xem có bỏ sót màn, có lane đụng nhau, có chỗ tiền/xác thực bị tự quyết. Sửa theo review rồi mới sang bước 2. Không chờ tôi.

## 2. Thực hiện từng lane

Mỗi lane theo đúng vòng sau, chạy 4 lane song song mỗi đợt (Q8); `core` chạy trước một mình vì lane khác phụ thuộc. Máy quá tải khi 4 lane cùng chạy test (P2028, timeout) thì cho lane chạy test lần lượt, không coi là lỗi code.

1. Worktree `.claude/worktrees/web-<lane>`, nhánh `web/<lane>` từ tip `web/integration` mới nhất.
2. Implement bằng agent **Sonnet 5.5, effort medium** (`worker`). `core` dùng Sonnet 5.5 effort high vì sửa Mini App.
   - TDD: test đỏ trước. Chuyển ý nghĩa test của màn Mini App sang test vitest bên web (cùng hành vi, cùng chữ tiếng Việt, cùng trạng thái rỗng/lỗi/đang tải).
   - Mỗi màn web có: trạng thái đang tải, rỗng, lỗi, chưa đăng nhập; quyền theo vai trò; `noindex` cho trang riêng tư; metadata cho trang công khai.
   - Luồng chính của lane có thêm một Playwright spec `apps/e2e/tests/*.web.spec.ts`.
   - Mỗi mục một commit, thông điệp tiếng Việt nói lý do.
3. Gate của lane (dán kết quả vào `impl/<lane>.md`):
   ```
   pnpm --filter @tubutree/app-core test        # nếu lane đụng app-core
   pnpm --filter @tubutree/web typecheck && pnpm --filter @tubutree/web lint && pnpm --filter @tubutree/web test
   TZ=UTC pnpm --filter @tubutree/web test
   pnpm --filter @tubutree/miniapp typecheck && pnpm --filter @tubutree/miniapp test   # số test không giảm
   pnpm lint:vars
   pnpm --filter @tubutree/web build && pnpm --filter @tubutree/miniapp build
   ```
   Lane đụng API: thêm `npx tsc --noEmit` và jest các module liên quan trong `apps/api`, cộng `npx jest prisma/reference-data src/modules/system-config` nếu thêm khoá cấu hình.
4. Review bằng agent **Opus 5.5, effort high** (`reviewer`): so từng màn web với màn Mini App (hành vi, chữ, quyền, trạng thái lỗi), tìm lỗi thật, không bắt lỗi trình bày vặt. Lane tiền/điểm/xác thực: 2 lượt.
5. Worker sửa theo review, chạy lại gate.
6. Phiên chính tự chạy lại gate (không tin lời kể của agent), rồi gộp `--no-ff` vào `web/integration` trên một worktree rảnh (không gộp vào worktree đang chạy gate). Cập nhật `00-ma-tran.md` và `PROGRESS.md`.

Một lane kẹt quá 2 vòng sửa mà gate vẫn đỏ: dừng lane đó, ghi lý do và lỗi vào `impl/<lane>.md`, làm lane khác.

## 3. Rào chắn để từ nay làm chức năng mới cho cả hai nền tảng

Làm trong lane `core` hoặc ngay sau nó:

1. `docs/platform-parity.json`: mỗi file màn ở `apps/miniapp/src/pages/*.tsx` (trừ spec) ánh xạ tới route web, hoặc `{ "skip": "<lý do>" }` cho màn cố ý chỉ có một bên.
2. `scripts/check-platform-parity.mjs`: đỏ khi có màn Mini App chưa có trong file ánh xạ, hoặc route web được ánh xạ không tồn tại. Có test riêng. Gắn vào `pnpm lint` ở root và vào `.github/workflows/ci.yml` (sửa file, không push).
3. `AGENTS.md` ở gốc repo, mục ngắn "Hai nền tảng": logic gọi API và quy tắc nghiệp vụ đặt ở `packages/app-core`; khả năng riêng nền tảng đi qua `PlatformBridge`; chức năng khách hàng mới phải có cả màn Mini App và trang web trong cùng nhánh, hoặc có dòng `skip` kèm lý do; trước khi xong chạy `node scripts/check-platform-parity.mjs`.
4. Tạo `CLAUDE.md` ở gốc chỉ một dòng trỏ tới `AGENTS.md`.

## 4. Gate cuối và báo cáo sáng

Khi hết lane hoặc gần hết hạn mức:
1. Trên `web/integration`: chạy toàn bộ gate ở bước 2.3 cho mọi app, cộng `bash docs/2026-10-review/handoff/verify-full.sh <outdir>` nếu có DB test, cộng Playwright web spec mới với DB riêng. Ghi lệnh và kết quả thật.
2. Viết `docs/2026-10-19-web-parity/99-bao-cao-sang.md`:
   - bảng lane: trạng thái, nhánh, hash, số test thêm, gate,
   - ma trận tương đương cập nhật: bao nhiêu màn đã có trên web, còn bao nhiêu,
   - phần chưa kiểm chứng (ví dụ chưa thử trên điện thoại thật, chưa thử Zalo OAuth thật),
   - **câu hỏi cho chủ dự án**, mỗi câu kèm mặc định đã dùng, xếp theo mức chặn (tiền/xác thực trước),
   - việc tiếp theo, theo thứ tự.
3. Không push. Dừng.
