# UAT lane 1: hành trình mua hàng (L1-mua-hang)

- Mã kiểm thử: SHA 98803f006 (cùng PROD), worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104`. Không sửa mã ứng dụng, không đụng PROD.
- Lane 1: API 3211, web 3212, Mini 3213, Pancake giả 3218; DB `tubutree_uat_l1` (267/267 migration), Redis db 1.
- Ngày chạy: 2026-11-04, từ 03:56 đến khoảng 05:15.
- Persona: `new` (khách Zalo mới, có SĐT), `new_nophone` (Zalo, chưa SĐT), `returning` (Lộc Biếc, 82.992 điểm), `guest` (vãng lai), thêm `noaddr` (chưa có địa chỉ). Ca cần khách sạch lịch sử (mã WELCOME30, đơn đầu) dùng khách tạo mới `uat_<tag>` bằng hàm `fresh` trong `kit.mjs`.
- Khổ: Mini 375x812, web 375x812, web 1280x800 (Playwright, một trình duyệt mỗi lần).
- Script (chạy lại được): `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat/scripts/L1-mua-hang/`. Ảnh: `.../shots/L1-mua-hang/`. Số liệu thô: `.../scripts/L1-mua-hang/results/`.
- Cách chạy một ca: `cd /Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104 && export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH && node <script>`. Báo cáo này được dựng lại bằng `R2-report.mjs` từ `results/*.jsonl` (lấy dòng mới nhất của mỗi ID).

## Cách kiểm
1. A1 đến A4 (API): báo giá và đặt đơn COD so với mô hình tính độc lập (oracle trong `kit.mjs`, đọc luật ở `pricing.service.ts`, `checkout.service.ts`, `coupons.service.ts`, `cart.service.ts` và `SystemConfig` của DB lane), kèm đối soát SQL từng đơn (tổng dòng, giảm, phí giao, lượt dùng mã, tồn kho, sổ điểm, ví).
2. U1/U2 (giao diện): chụp và rút chữ mỗi màn trên ba khổ cho từng persona, so Mini 375 với web 375 (chữ, tiền, thứ tự khối), mở từng ảnh quan trọng để xác nhận.
3. U3 (bấm tay): thêm giỏ, tăng giảm, xoá, mua một phần, đặt COD, đặt chuyển khoản, webhook ngân hàng, mã sai, huỷ đơn, mua lại, trên Mini 375 và web 375 (web 1280 cho hành trình giỏ và COD).
4. U4: thanh đáy Mini 5 tab, không link ra ngoài, thứ tự khối Trang chủ lần mở thứ hai, tràn ngang.
5. R1: đối soát SQL toàn DB sau mọi ca và chạy `apps/api/scripts/reconcile-points.ts`, `reconcile-wallet.ts`.
