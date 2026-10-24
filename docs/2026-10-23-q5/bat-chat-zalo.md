# Bật Chat CSKH qua Zalo cá nhân

Khách chat với Tubu Tree trong Mini App (`/chat`) và trên web (`/ho-tro/chat`). Tin được chuyển vào một nhóm Zalo qua một tài khoản Zalo cá nhân làm "cầu nối" (service `zalo-bridge`, thư viện không chính thức `zca-js`). Nhân viên trả lời ngay trong Zalo (trích tin hoặc gõ `#MÃ` ở đầu tin) hoặc ở tab **Chat CSKH** trong trang admin.

Thiết kế đầy đủ: `docs/superpowers/specs/2026-10-23-q5-chat-zalo-ca-nhan-design.md`.

## 0. Đọc trước khi bật: rủi ro

1. **Zalo có thể khoá tài khoản cầu nối bất cứ lúc nào.** Điều khoản Zalo hiệu lực 05/09/2026, điều 4.7, cấm đăng nhập bằng phần mềm bên thứ ba, và `zca-js` tự cảnh báo có thể bị khoá. Vì vậy:
   - dùng **một SIM và một tài khoản Zalo riêng chỉ để làm cầu nối**, không dùng số của chủ hay nhân viên;
   - không kết bạn, không gửi hàng loạt, chỉ chuyển tin CSKH;
   - giãn cách gửi: cầu nối tự xếp hàng, mỗi tin cách nhau khoảng 1,5 đến 2,5 giây và tối đa 300 tin mỗi giờ, nên không bao giờ bắn dồn dập (không chỉnh các số này lên).

   Khi bị khoá: khách vẫn gửi được và tin nằm chờ; admin nhận cảnh báo; nhân viên trả lời từ tab Chat CSKH; khách thấy hotline.
2. **KHÔNG BAO GIỜ mở Zalo PC hoặc Zalo Web bằng tài khoản cầu nối.** Một tài khoản chỉ giữ một phiên web: mở Zalo PC/Web là cầu nối bị đá ra (mã 3000) và tab admin hiện "Đăng nhập nơi khác". Điện thoại thì được.
3. **Trích tin chưa được thử trên Zalo thật.** Cách nhân viên trả lời bằng cách trích một tin trong nhóm chưa kiểm chứng với Zalo thật. Một tin bắt đầu bằng `#MÃ` (mã hội thoại, ví dụ `#K7Q2 đơn mai giao ạ`) thì luôn khớp. Hướng dẫn nhân viên dùng `#MÃ` cho chắc, và thử trích tin ở bước thử tay dưới đây.
4. **`zca-js` có thể hỏng khi Zalo đổi giao thức.** Đã ghim đúng bản 2.1.2.
5. Tin đã vào nhóm Zalo không xoá được khi khách xoá tài khoản; văn bản chính sách bảo mật cần nói điều này.

## 1. Chuẩn bị (chủ dự án, một lần)

1. Lấy một SIM riêng, tạo tài khoản Zalo "Tubu Tree CSKH" trên điện thoại.
2. Bằng tài khoản đó tạo nhóm Zalo (ví dụ "Tubu CSKH"), mời các nhân viên CSKH vào bằng tài khoản cá nhân của họ.
3. Dặn nhân viên: trả lời khách bằng trích tin hoặc `#MÃ` ở đầu tin; không mở Zalo PC/Web bằng tài khoản cầu nối.

## 2. Biến môi trường

Không ghi giá trị thật vào tài liệu hay git. Tạo hai khoá ngẫu nhiên, ví dụ `openssl rand -hex 32` cho `ZALO_BRIDGE_SECRET` và `openssl rand -base64 32` cho `ZALO_BRIDGE_CREDENTIALS_KEY`.

**API** (file `.env` của máy chủ, nạp qua `env_file`):

| Biến | Dùng để |
|---|---|
| `ZALO_BRIDGE_URL` | Địa chỉ nội bộ API gọi cầu nối, trong mạng compose là `http://zalo-bridge:3110`. Để trống là chat không kết nối được. |
| `ZALO_BRIDGE_SECRET` | Khoá chung API và cầu nối (Bearer). Phải trùng với khoá của service `zalo-bridge`. Cầu nối từ chối khởi động nếu ngắn hơn 32 ký tự. |

**Service `zalo-bridge`** (khai trong `docker-compose.prod.yml` và `docker-compose.vietnix.yml`, không có `env_file` để thư viện không chính thức không thấy các khoá khác):

| Biến | Dùng để |
|---|---|
| `NODE_ENV` | Cố định `production`. |
| `PORT` | Cổng nghe, cố định `3110`, chỉ trong mạng `tubu`, không mở ra ngoài. |
| `HOST` | Địa chỉ nghe, cố định `0.0.0.0` trong container. |
| `ZALO_BRIDGE_SECRET` | Lấy từ `.env`; xác thực lời gọi từ API. |
| `ZALO_BRIDGE_CREDENTIALS_KEY` | Lấy từ `.env`; khoá AES (base64, đúng 32 byte) mã hoá phiên đăng nhập Zalo lưu trên đĩa. Mất khoá này là phải quét QR lại. |
| `ZALO_BRIDGE_DATA_DIR` | Thư mục dữ liệu, cố định `/data` (volume `zalo_bridge_data`, giữ phiên đăng nhập qua các lần deploy). |
| `API_EVENTS_URL` | Nơi cầu nối báo tin và trạng thái về API, cố định `http://api:3001/api/internal/zalo-bridge/events`. |

Chỉ ba biến cần người điền: `ZALO_BRIDGE_URL` (API), `ZALO_BRIDGE_SECRET` và `ZALO_BRIDGE_CREDENTIALS_KEY`. Các biến còn lại đã có sẵn trong compose.

## 3. Deploy

1. Gộp mã với `chat.enabled = false` (mặc định), nên khách chưa thấy gì.
2. Thêm ba biến ở mục 2 vào `.env` trên máy chủ.
3. Áp các migration mới (chỉ thêm bảng/cột/chỉ mục; bản `support_message_seen` có một câu UPDATE điền lại `seenAt` cho tin cũ):
   - `20261023100000_support_chat`
   - `20261023110000_support_bridge_actions`
   - `20261024100000_support_chat_hardening`
   - `20261024120000_support_message_seen`
   Lưu ý: trước khi hai khoá `ZALO_BRIDGE_SECRET` và `ZALO_BRIDGE_CREDENTIALS_KEY` có trong `.env`, service `zalo-bridge` từ chối khởi động và `restart: unless-stopped` làm nó khởi động lại liên tục (ồn log, không hại gì). Hoặc điền hai khoá trước, hoặc dựng các service khác theo tên (`docker compose up -d api web ...`) và để `zalo-bridge` cho sau.
4. Dựng service mới: `docker compose -f <file compose của máy> up -d --build zalo-bridge`, rồi deploy API và web theo `docs/launch/deploy-rollback-runbook.md`. Service không có cổng ra ngoài; `/health` trả 200 cả khi đang chờ quét QR.
5. Thứ tự với Mini App: deploy API TRƯỚC khi phát hành bất kỳ bản Mini App nào có thay đổi này. Bản Mini App mới luôn gửi `{ ids }` khi đánh dấu đã đọc; API cũ (chưa có `ReadDto`) trả 400 vì `forbidNonWhitelisted`. Đúng với ràng buộc 1 của `docs/launch/deploy-rollback-runbook.md` (bật API mới trước khi phát hành Mini App mới).

## 4. Bật trong tab Chat CSKH (admin)

1. Mở `/admin?tab=supportChat`, thẻ **Cầu nối Zalo**, bấm **Đăng nhập Zalo** và quét QR bằng Zalo của tài khoản cầu nối. Trạng thái chuyển sang "Đang kết nối".
2. Chọn nhóm nhận tin trong danh sách, bấm **Lưu nhóm**.
3. Bấm **Gửi tin thử**. Nhóm Zalo phải nhận một tin thử.
4. Bật công tắc **Cho khách chat** (xác nhận hộp thoại). Công tắc chỉ bật được khi cầu nối đang kết nối và đã chọn nhóm.

## 5. Thử tay trước khi báo cho khách

1. Khách gửi chữ, gửi ảnh, gửi ngoài giờ làm việc: tin vào đúng nhóm, ngoài giờ khách thấy lời báo trả lời chậm.
2. Nhân viên trả lời trong Zalo bằng trích tin, bằng `#MÃ`, gửi ảnh, thu hồi một tin: khách thấy tin Tubu Tree ở Mini App và web (cập nhật mỗi 5 giây).
3. Tắt mạng của cầu nối rồi bật lại (`docker compose stop zalo-bridge`, rồi `up -d zalo-bridge`): tin khách gửi lúc đó nằm chờ, sau đó được chuyển; tab admin báo mất kết nối rồi hết.
4. Mở Zalo PC bằng tài khoản cầu nối để thấy trạng thái "Đăng nhập nơi khác" (rồi đóng Zalo PC và bấm **Kết nối lại**). Chỉ làm một lần để biết, không để nhân viên làm.
5. Bật cho khách. Hai tuần đầu xem tab Chat CSKH mỗi ngày: hội thoại có nhãn "Chưa chuyển được" cần xem ngay.

## 6. Gỡ về (rollback)

1. Tắt công tắc **Cho khách chat** trong tab admin (hoặc đặt `chat.enabled = false`): khách thấy chat tạm đóng cùng hotline, các nút OA/hotline/email như trước.
2. Dừng service: `docker compose -f <file compose của máy> stop zalo-bridge`. Tin khách gửi trước đó vẫn lưu trong DB.
3. Bốn migration đều chỉ thêm (additive; bản `support_message_seen` chỉ điền cột mới), nên quay API/web về bản cũ không cần gỡ migration; bảng và cột mới nằm im không ai đọc. Không chạy `migrate down` trên PROD.
4. Nếu tài khoản cầu nối bị khoá: chat tự rơi về chế độ chờ (mục 0.1); thay SIM/tài khoản mới và quét QR lại ở bước 4.

## 7. Cầu nối báo không xoá được hoặc không lưu được tệp phiên

Thẻ **Cầu nối Zalo** ghi "Không xoá được tệp phiên đăng nhập cũ (…)", hoặc bấm **Đăng xuất** thì báo `LOGOUT_CLEAR_FAILED`: trên đĩa còn tệp phiên của một tài khoản cầu nối không còn dùng (tài khoản đã đăng xuất, hoặc phiên cũ trước lần quét QR mới) mà đĩa từ chối xoá. Cầu nối đang chạy vẫn an toàn, nó không đăng nhập bằng tệp đó. Nhưng nếu container khởi động lại lúc tệp còn đó, nó sẽ đăng nhập lại tài khoản cũ. Vì vậy **đừng khởi động lại container** cho tới khi thẻ hết báo.

Thẻ chỉ ghi "Không lưu được phiên đăng nhập: …" (không kèm dòng trên): phiên đang chạy chưa ghi được ra đĩa, tệp cũ đã xoá, nên khởi động lại sẽ phải quét QR lại. Sửa quyền hoặc dung lượng đĩa rồi bấm **Kết nối lại**.

**Thẻ đang "Đang kết nối"** (tài khoản cầu nối đang chạy và chuyển tin):

- Không bấm **Đăng xuất**: nó đăng xuất luôn tài khoản đang trả lời khách.
- Sửa quyền thư mục hoặc dung lượng đĩa trên máy chủ, rồi bấm **Kết nối lại**. Cầu nối lưu lại phiên đang chạy, đè lên tệp cũ, và thẻ hết báo.

**Thẻ đang "Cần quét QR"** (đã đăng xuất):

1. Lời báo là `ETIMEDOUT` (đĩa chậm): đợi khoảng một phút rồi xem lại thẻ. Không còn dòng "Không xoá được…" là xong.
2. Còn dòng đó: bấm **Đăng xuất** lại một lần.
3. Vẫn còn: xoá tay bằng quyền root (cầu nối chạy bằng user `node`, chính user vừa bị từ chối):
   - container đang chạy: `docker compose -f <file compose của máy> exec -u root zalo-bridge sh -c 'rm -f /data/credentials.enc /data/credentials.enc.*.tmp'`
   - container không chạy: `docker compose -f <file compose của máy> run --rm -u root --entrypoint sh zalo-bridge -c 'rm -f /data/credentials.enc /data/credentials.enc.*.tmp'`

   Rồi bấm **Đăng xuất** lại để thẻ hết báo lỗi, và kiểm tra quyền thư mục, dung lượng đĩa của máy chủ.
4. Không xoá tay được: đổi `ZALO_BRIDGE_CREDENTIALS_KEY` trong `.env` (`openssl rand -base64 32`) rồi `docker compose -f <file compose của máy> up -d zalo-bridge`. Tệp cũ không giải mã được nữa nên cầu nối về "Cần quét QR". Tệp cũ vẫn nằm trên volume: đừng khôi phục khoá cũ từ bản sao `.env`, và xoá tệp khi vào lại được máy.
