# ctv đợt B (worker)

Nhánh review/1028-ctv tip 30eda7d433a04dd310b8f547c58f48674c4e86c8

LƯỢT 2 gói ctv. Chưa push/merge/deploy.
COMMIT lượt 2 (6): c6cfeed88 feat(hoa-hong) tự vào Ví; e7f5753cb fix(ctv) chữ + khung chờ; d717b5917 fix(chia-se) R-67; e17177b9d fix(nhan-vien); 797e9a758 fix(vi,gian-hang) test + a11y; 30eda7d43 viền hôm nay web + spec e2e.

TIỀN: hoa hồng đã duyệt tự vào Ví
- AffiliateService.autoTransferApprovedToWallet(): gọi ngay sau bước duyệt LOCKED→APPROVED trong approveDueCommissions (cron mỗi giờ, quét cả phần còn sót). KHÔNG có đường ghi tiền thứ hai: mỗi CTV gọi đúng requestPayout(userId, tổng, WALLET_BALANCE, key) nên cùng khoá tháng, khấu trừ TNCN, payout, sổ Ví, kiểm available.
- Khoá idempotency = auto-wallet:<userId>:<sha1(id commission sắp xếp)>. CTV bấm tay cùng lúc: bên đến sau không còn dòng APPROVED, bị từ chối "đã xử lý", chỉ cộng một lần.
- Cờ affiliate.auto_wallet_transfer_enabled: mặc định bật (code + seed + EXTRA_CONFIGS + validator chỉ nhận boolean). Tắt = hành vi cũ (bấm tay).
- Thiếu MST khi bị khấu trừ: không tự chuyển, giữ APPROVED cho nút bấm tay, CTV vẫn nhận tin "đã duyệt, chưa tự vào Ví".
- Thông báo COMMISSION_WALLET_CREDITED "Đã cộng …đ hoa hồng vào Ví Tubu (kèm thuế nếu có)", dedupeKey = khoá; CTV đã tự cộng không nhận thêm tin "đã duyệt".
- Trang CTV/Ví: dashboard trả autoWalletTransfer; câu sheet "Hoa hồng tự vào Ví Tubu khi…" (tắt cờ: "chuyển được vào Ví"); dòng dưới số to "Phần này chưa tự vào Ví được (thường do cần MST)". Nút Chuyển vào Ví giữ cho phần sót.
- MIGRATION 20261028110000: CHỈ thêm dữ liệu (1 dòng system_configs, 1 notification_templates, 1 UPDATE nội dung tin APPROVED nếu còn bản gốc), không đổi schema. Không đổi tỉ lệ, hold_days, ngưỡng thuế.
- Test: unit 11 ca (affiliate-auto-wallet.spec: cờ tắt, không cộng đôi, khoá xác định, lỗi từng CTV, thông báo) + race affiliate-auto-wallet.race-spec 12 ca (khấu trừ = bấm tay, cron×cron, cron×bấm tay 6 vòng, nhiều CTV, cờ tắt, thiếu MST, cộng dồn tháng; ổn định 3 lần). Sửa 2 race spec cũ cho khớp (ctv-notifications ghim cờ tắt; partial-return chấp nhận APPROVED|PAID).

REVIEW OPUS (mọi P1/P2 xong)
- P2 câu sheet hứa tự chuyển: làm lại theo hành vi thật + test app-core/Mini/web. ĐÃ LÀM.
- P2 R-67 ba chỗ link web: content-kit-sheet, product-detail, profile → miniAppLink; sửa 3 spec + web-base-url.spec. ĐÃ LÀM.
- P2 R-65 tô thẻ hôm nay: Badge "Hôm nay" + viền ở Mini và web, có test cả hai. ĐÃ LÀM.
- P3 sheet khi đang tải: khung chờ aria-busy, test Mini+web. ĐÃ LÀM.
- P3 test Mini chấm công đang tải/lỗi + Về Cá nhân (staff, my-payroll, web). ĐÃ LÀM.
- P3 test chạm thẻ "Hoa hồng đang chờ" + nhãn hạng dài (Mini+web), ảnh persona CTV + longtext. ĐÃ LÀM.
- P3 lệch nhãn/EmptyState staff: web dùng "Chép tuần" (aria-label giữ "Chép tuần trước") + EmptyState có hình như Mini. ĐÃ LÀM.
- P3 storefront-signup: gợi ý chỉ ở dòng đầu, chữ "Đã đạt/Chưa đạt" cho trình đọc màn hình. ĐÃ LÀM.
- P3 brand controller 200 rỗng với Mini bản cũ: KHÔNG LÀM trong mã; ghi chú deploy: phát hành Mini App mới cùng lúc API, nếu không người chưa có nhãn mở /brand-owner thấy lỗi tải thay màn trống.

KIỂM (chạy thật)
- tsc: api, web, miniapp, app-core, e2e sạch. eslint file đã đổi (api/web/miniapp) sạch. lint:parity xanh (0 pending).
- jest api: 485 suite / 11236 test pass. vitest app-core 72 file/936; miniapp 314/4883 (kể cả TZ=UTC 4883); web 7449 pass.
- Race Postgres nhúng 35740 (affiliate|commission|ctv|wallet|payout|account-deletion|brand|storefront|partial-return|cod-return|closed-order|merge-reversal|referral|checkout-reversal|admin-confirm): 39 suite / 414 test pass. Migrate deploy trên DB trống chạy được. Đã dừng cụm.
- Playwright miniapp toàn bộ: 205 pass, 10 skip. web-gate (affiliate, pro, account, order, web-checkout): 110 pass, 4 skip.
- Bundle Mini (vite build qua bundle-report): entry 711 KB raw/222 gz = baseline. Tổng 1919 KB raw/740 gz vs bản review-1028 1911/737: TĂNG 8 KB raw, 3 KB gz ở chunk lazy (3 tab, EmptyState, tự chuyển), entry không đổi. Web First Load: CHƯA đo (không next build). Không chạy run-all.

ẢNH: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens-ctv/ (15 file: ghép trước/sau affiliate, staff, my-payroll, wallet + 4 ảnh chỉ-sau persona CTV: wallet__ctv__sau-mini375/web375/mini375-longtext, affiliate__ctv__sau-mini375-vi-con-sot). Đã mở xem từng ảnh: Mini và web 375 khớp (hero, ví CTV, thẻ hôm nay, trang chặn nhân viên). Chèn 6.000.000đ APPROVED vào DB lane 7 cho persona ctv (chỉ DB lane). Lane 7 đã dừng, không --drop; routes.json khôi phục; params-l7.json xoá.

CHƯA KIỂM / CẦN CHỦ BIẾT
- Chưa chạy toàn bộ race suite (chỉ module affiliate/wallet + liên quan). Chưa thử cron thật trên DB có dữ liệu cũ: lượt cron đầu sau deploy sẽ tự cộng MỌI hoa hồng APPROVED đang tồn (chủ đã duyệt hành vi, vẫn nên biết); CTV chưa có MST và vượt ngưỡng thuế sẽ không tự chuyển.
- Ví Mini/web: nhãn thẻ "Hoa hồng có thể chuyển vào Ví" giữ nguyên (đúng cả khi cờ bật/tắt, là phần chưa tự vào).
- Web staff-hub: ảnh web lane chỉ phản ánh sửa mới sau khi rsync lại bản sao web (đã làm lượt này).
- Hero trang CTV vẫn hiện "Đang chờ: 0đ" lúc đang tải (có từ lượt 1, chưa sửa, ngoài P1/P2).
