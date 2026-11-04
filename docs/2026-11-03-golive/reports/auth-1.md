# Gói auth, lượt 1 (nhánh gl/1103-auth, gốc 52fd5cd65)

Commit (chưa push):
- b6d472ea3 fix(auth): bỏ phiên trả về sau đăng xuất; lỗi hay treo storage ZMP không đổi khách sang tài khoản khác
- ec4693ddf fix(auth): chạm tim lúc đang khôi phục phiên thì chạy tiếp sau khi ra phiên; test Tim và PDP lúc loading

## Mục 1. Đăng xuất khi phiên đang bay (xong)
`sessionEpoch` tăng đồng bộ ở đầu `logout()` (cùng lúc huỷ restore/login/refresh đang chờ). Mọi đường tạo phiên chụp epoch lúc bắt đầu và nhận qua `adoptSession`: epoch lệch thì không đặt token, không lưu refresh, không đổi user/status, refresh token mới được thu hồi bằng `/auth/logout` (không chờ). Phủ: restore, handler 401 (cả nhánh thành công lẫn bị từ chối), login Zalo, login Khách, ensurePhoneOrThrow, upgradeGuestSilently. Đăng nhập bắt đầu sau logout không gộp vào lần cũ (đã có test). Ghi refresh đáp sau lần xoá của logout thì xoá lại.
Test: 10 ca mới, đỏ với mã cũ (đã kiểm bằng cách đặt lại auth.ts gốc: 20 ca đỏ gồm mục 2).

## Mục 2. Storage ZMP ném lỗi / treo > 3 s (xong)
- `StorageFailure` (cha của `StorageTimeoutError`): mọi lỗi storage ở đường đăng nhập, kể cả `getStorage` ném đồng bộ, là lỗi tạm: status `error`, không rơi sang Khách/tài khoản khác, không xoá token. `useSessionRecovery` vẫn thử lại (có ca restore lại sau khi storage hồi).
- Đăng nhập Zalo/Khách thành công mà lưu refresh hỏng: vẫn vào phiên; token giữ trong bộ nhớ (`unpersistedRefresh`) cho refresh của phiên này.
- `clearRefresh` nuốt mọi `StorageFailure` (trước đây chỉ hết giờ): khoá + xoá token ném lỗi vẫn báo khoá, login() không còn reject. Ca cũ "login() ném ra ngoài" đổi kỳ vọng theo.
- Chữ mới `vi.errors.sessionStorage`: "Máy chưa đọc hay lưu được dữ liệu đăng nhập. Bạn mở lại ứng dụng rồi thử lại nhé." Hết giờ 3 s cũng dùng câu này, không còn "mất kết nối". 
Test: 9 ca mới + 2 ca cũ sửa kỳ vọng.

## Mục 3. Tim / PDP lúc 'loading'
- PDP: đã đúng từ #125 (loginWithNotice chờ restore, ra phiên thì mua chạy tiếp). Thêm `product-detail-restoring.spec.tsx` (store thật): bấm Thêm vào giỏ lúc loading, refreshTokens 1 lần, không login song song, ra phiên thì addToCart chạy.
- Tim: login() chờ restore đúng, nhưng ra phiên thì lần chạm bị nuốt. Sửa `wishlist-heart.tsx`: chạm lúc 'loading' mà ra phiên thì chạy tiếp toggle (từ 'idle' vẫn chỉ đăng nhập như cũ). Test `wishlist-heart-restoring.spec.tsx` (store thật), đỏ với mã cũ.
- Các nơi gọi `login()` khác (reviews, support-contact, coupon, game, flash-sale, group-buy, recycle...) đi qua cùng store nên không song song; không đổi hành vi, chưa thêm test riêng từng nơi.

## Số kiểm thật
- tsc apps/miniapp: sạch. eslint các file đã sửa: sạch.
- auth.spec: 91/91 (TZ=UTC). Heart + PDP restoring: xanh.
- Vitest miniapp toàn bộ: lượt đầu (máy tải nhẹ hơn) UTC 6548/6549, NY 6546/6549. Các lượt sau máy tải 85-140 nên đỏ hàng loạt do timeout, không dùng được. Chạy riêng các file chạm store/auth hoặc wishlist-heart (137 file) rồi các file đỏ còn lại: chỉ còn `flash-sale.spec.tsx` 3 ca đỏ, ĐỎ CẢ Ở MÃ GỐC (không do gói này). offers.spec + product-detail-flash.spec xanh khi chạy riêng 2 lần. KHÔNG chạy lại trọn bộ NY sau cùng: rủi ro (cần chạy lại khi máy rảnh).
- `pnpm lint:parity`: xanh (px 3769, max-md 1014, không đổi).
- Playwright Mini (offers, features, profile-calls, zalo-policy, referral): 24 pass, 2 đỏ ở features.miniapp.spec (Brand Owner, Storefront Builder): goto timeout lần 1, lần 2 "POST /events chưa mock". Mã gốc cũng đỏ 1/2 ca ở spec này, nên không do gói này.
- Bundle Mini (vite build, cùng phép đo): entry gốc 675199 B raw / 210305 B gzip; sau sửa 676069 / 210633: TĂNG +870 B raw / +328 B gzip. Tổng gzip 862 KB không đổi. VI PHẠM luật "entry không được tăng" ở mức 0,3 KB; store auth nằm trong entry nên không tránh được mà giữ đủ yêu cầu. Cần điều phối quyết định chấp nhận hay cắt.
- Ảnh: không đổi giao diện.

## Chưa làm / rủi ro
- Chưa có reviewer Opus (đường đăng nhập cần 2 lượt APPROVE).
- Logout treo storage vẫn tăng epoch: phiên đang bay bị bỏ dù logout chưa xong (chấp nhận: người dùng đã bấm Đăng xuất).
- `unpersistedRefresh` chỉ sống trong bộ nhớ; mở lại app sau khi storage hỏng sẽ đăng nhập lại từ đầu.
