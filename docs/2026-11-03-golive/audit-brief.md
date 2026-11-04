# Audit gl-1103: review tổng thể trước go-live. Luật cho auditor và người xác minh

Mục tiêu: tìm mọi lỗi và điểm chưa đạt chuẩn cao nhất ở luồng khách trước khi mở cho khách thật, trên Mini App 375, web 375 (phải giống Mini 1:1) và web 1280. Chỉ đọc và đo; KHÔNG sửa mã, KHÔNG commit.

## Mã và môi trường
- Mã: worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs` (main 52fd5cd65 = PROD 0aa8af5d1 + tài liệu). Đọc `AGENTS.md`, `DESIGN.md`, `.claude/skills/tubu-ui/SKILL.md`, `docs/design/ds-map.json`.
- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`. Bài học: `/Users/longla/.claude/projects/-Users-longla-coding-tubutree-mini-app/memory/env-lessons-tubutree.md`.
- Lane 5 (API http://localhost:3251/api, web http://localhost:3252, Mini App http://localhost:3253) và lane 6 (3261/3262/3263) chạy mã main, dữ liệu seed (`docs/2026-10-28-review/tools/LANES.md`: persona `returning`, `new`, `new_nophone`, `guest`, `ctv`, `ctv_pending`, `dealer`; `params-l5.json`, `params-l6.json`). Không dừng, không bật lại lane; không đụng lane khác.
- Chụp: `cd /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs && node docs/2026-10-28-review/tools/capture.mjs --lane 5 --phase mini375,web375,web1280 --keys <khoá màn của bạn> [--state loading,error500,offline,empty,longtext]`. Khoá màn: `node docs/2026-10-28-review/tools/capture.mjs --list` hoặc `docs/2026-10-28-review/tools/routes.json`. Ảnh vào `docs/2026-10-28-review/screens/<nhãn>/`; chỉ chụp khoá của vùng mình. Cặp so: `docs/2026-10-28-review/tools/pairs.mjs`. Đi luồng có thao tác: `docs/2026-10-20-uat/tools/uat-harness/miniapp-session.mjs`, `web-session.mjs` (đọc đầu file), hoặc script Playwright riêng của bạn trong scratchpad của bạn. Xem ảnh bằng Read.
- Thao tác ghi dữ liệu (thêm giỏ, đặt đơn, đổi trả, điểm danh, gửi chat): chỉ vùng được giao lane cho phép (bảng dưới). Còn lại chỉ xem.
- CẤM: sửa mã, commit, push; đọc/ghi PROD; `pkill -f`; kill tiến trình không phải của mình; `npx playwright test` trần.

| Vùng | Lane ghi | Persona được ghi |
|---|---|---|
| khampha | không ghi | — |
| pdp | 5 (chỉ Yêu thích, thêm giỏ của `new_nophone`) | new_nophone |
| giohang | 6 | returning, new |
| donhang | 5 (đổi trả, huỷ đơn, đọc thông báo, chat) | returning |
| xanh | 5 (điểm danh, đổi rác, Vườn) | new, ctv, ctv_pending, dealer |
| hieunang | không ghi; `tools/perf/run-all.mjs` dùng lane 5 + cổng 3601/3603/3611 | — |
| baomat | 6 (thăm dò API bằng token persona; không làm hỏng dữ liệu persona `returning`/`new` của vùng giohang: tạo user riêng qua `/auth/guest` nếu cần) | guest tự tạo |

## Không báo lại (đã có người làm hoặc đã chốt)
- Đang sửa ở đợt gl-1103 (brief `docs/2026-11-03-golive/brief.md`): auth Mini (logout khi refresh đang bay, storage ZMP lỗi/chậm, login lúc loading), chữ client khớp câu API (`checkout-rules`, `order-actions`) + `terminology.spec`, CLS ghi chú hết suất ở PDP, nợ `max-md` PDP web, e2e chiều cao phiếu mã web, hàng huy hiệu bậc CTV, R-140, R-109 múi giờ Mini, R-23 thanh toán web 375, R-132 xếp hạng cộng đồng web, test chập chờn `bundles-cls` + `add-to-cart.spec`.
- Phiên `tubutree-mini-app-db` đang làm: admin, API affiliate/wallet/waste/loyalty/garden/cron/ZNS/Pancake/data-retention. Vùng `xanh` và `baomat` vẫn báo lỗi ở đó nhưng ghi `owner: db`.
- Đã chốt, không báo lại: R-177 (Mini chờ biết loại khách mới hiện khối), R-160, R-56, R-164 ca 2, R-172; "cửa hàng" nghĩa điểm bán thật; chữ pháp lý; giá Giờ vàng lớn ở đầu PDP vẫn là giá của đợt khi khách hết suất; các mục §3, §4 "Cố ý để nguyên" của `docs/2026-10-31-shop-redesign/plans/handoff-wave8.md`. Mục backlog đã xong: `docs/2026-10-28-review/20-backlog.md` (bảng "Sau đợt 31/10–01/11"). Cờ PROD đang tắt: `waste.*`, `chat.enabled`, `loyalty.marketplaceClaimEnabled` (vẫn review mã vì sẽ bật).
- Dữ liệu seed không có ảnh SP: khung lá thay ảnh là bình thường.

## Cách review (dùng skill)
- Giao diện: gọi skill `tubu-ui`, `design:design-critique`, `design:ux-copy`, `design:accessibility-review`, `ecc:make-interfaces-feel-better` (nhóm giao diện); hiệu năng: `ecc:react-performance`, `ecc:frontend-patterns`; bảo mật: `ecc:security-review`, `ecc:api-design`.
- Mỗi màn: mọi persona hợp lệ; trạng thái ok, loading, lỗi 500, mất mạng, rỗng, chữ dài; 375 Mini vs web (chữ, thứ tự, khoảng cách, màu, cỡ chữ, vùng chạm ≥ 44px), 1280 web; console lỗi, pageErrors, lời gọi API thừa; ca biên (hết hàng, hết suất, mã hết hạn, địa chỉ thiếu, phiên hết hạn, bấm đúp); chữ theo giọng đợt 8.
- Đối chiếu mẫu Shopee/Grab khi nói "chuẩn cao nhất", nhưng không đề xuất đổi luật điểm/giá/pháp lý.

## Mức
P0: chặn mở khách (không mua được, sai tiền/điểm, lộ dữ liệu, sập, vi phạm chính sách Zalo). P1: khách gặp lỗi rõ hoặc lệch lớn Mini/web 375. P2: lỗi nhỏ có thật, lệch nhỏ, thiếu trạng thái lỗi/rỗng. P3: đánh bóng.

## Trả về
Mỗi phát hiện: mức, nền (mini375/web375/web1280/api/cả hai), màn, vấn đề (1–2 câu), bằng chứng (file:dòng, đường dẫn ảnh, số đo, lệnh tái hiện), đề xuất sửa cụ thể, công sức S/M/L, `owner` (`2a` hay `db`), `needsOwnerDecision` (đụng luật/giá/pháp lý/bố cục lớn/bỏ chức năng). Không gộp nhiều lỗi khác nhau vào một mục. Không báo điều chưa kiểm; nói rõ phần nào chưa kiểm được.
