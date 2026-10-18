# Gói ai (nhánh `lr2/ai`): AI tư vấn chạy trên Antigravity gateway

Quyết định của chủ dự án: AI tư vấn (chat với khách trong Mini App) chạy trên bộ Antigravity của chủ, cùng cách ChoDeli. Nhánh dựng từ `review/2026-10-18-launch`. Không gọi gateway hay AI thật ở bất kỳ test nào (HTTP được giả bằng `fetch` mock). Không push, không deploy.

## 1. Hợp đồng gateway (sao từ ChoDeli, chỉ đọc)

ChoDeli KHÔNG tự chạy `agy`; nó gọi HTTP tới container `antigravity_gateway`, nơi `agy` chạy (`chodeli-ai-oder/HUONG-DAN-DEPLOY-MAY-MOI.md:129`, `:175`). Mã nguồn gateway (repo `antigravity-gateway`) không có trong máy này, nên mọi điều về phía gateway dưới đây suy ra từ máy khách ChoDeli.

| Mục | Giá trị | Nguồn |
|---|---|---|
| Endpoint | `POST ${ANTIGRAVITY_GATEWAY_URL}/v1/complete` | `src/lib/ai/antigravity-client.ts:71` |
| Auth | `Authorization: Bearer ${ANTIGRAVITY_GATEWAY_KEY}`, key riêng từng dự án | `antigravity-client.ts:27-29`, `:73` |
| Body | `{task, prompt, images:[{base64,mimeType}], model?}`; `task` là nhãn dự án/tác vụ ("chodeli" ở ChoDeli, "tubutree" ở đây); `prompt` = system + "\n\n" + prompt | `antigravity-client.ts:65`, `:74` |
| Thành công | JSON `{result: string, model?, usage?:{inputTokens,outputTokens}}`; `result` rỗng là lỗi | `antigravity-client.ts:81-92` |
| Lỗi | HTTP không 2xx với JSON `{error, message}`; ChoDeli ghép thành `Antigravity Gateway lỗi (status error): message` | `antigravity-client.ts:77-79` |
| Timeout | Máy khách đặt mặc định 65 giây, phải lớn hơn timeout nội bộ của agy trong gateway (60 giây) để nhận `{error:"timeout"}` gọn thay vì bị ngắt socket | `antigravity-client.ts:32-39` |
| Tự bảo vệ của gateway | 429 `circuit_open` ("hourly cap reached" / "max concurrent requests reached"): tầng vẫn sống, trả lời ngay. Hết quota phía agy báo qua 500 `agy_error` | `src/lib/ai/gateway.ts:125-131` |
| Model bị agy gỡ | Lỗi chứa "invalid model selection" hoặc "not recognized as a known model" → gọi lại không kèm `model`, gateway dùng mặc định của nó | `gateway.ts:133-170` |
| Độ trễ | agy khởi động một tiến trình mỗi lượt, p50 khoảng 13 giây | `gateway.ts:64` (và `:685`: p50 14,8 giây, p90 29,6 giây) |
| Env | `ANTIGRAVITY_ENABLED` (mặc định true) `:19-23`; `ANTIGRAVITY_GATEWAY_URL` (mặc định `http://antigravity-gateway:8097`) `:24`; `ANTIGRAVITY_GATEWAY_KEY` `:29`; `ANTIGRAVITY_GATEWAY_TIMEOUT_MS` `:38`; `ANTIGRAVITY_MODEL` (mặc định `gemini-3.8-flash-high`) `:43` | `antigravity-client.ts` |
| Circuit breaker phía ChoDeli | 3 lỗi liên tiếp → bỏ qua 5 phút (429 `circuit_open` không tính) | `antigravity-breaker.ts:13-14`, `gateway.ts:552` |

## 2. Đã làm gì

| Việc | File chính |
|---|---|
| Provider `antigravity` trong `LlmClient`: `fetch` + `AbortController`, đúng hợp đồng trên (`task:"tubutree"`, `images:[]`), thử lại một lần không kèm model khi model bị gỡ, ánh xạ lỗi sang `timeout`/`busy`/`error` (429 và 504 `timeout` của gateway), mọi lỗi cuối cùng thành `LlmUnavailableException` (thông điệp chung, không có key/URL/nội dung gateway) | `apps/api/src/modules/ai-advisor/llm.client.ts` |
| Chọn provider: `AI_ADVISOR_PROVIDER` (trống = antigravity > deepseek > gemini theo cái đã đủ khoá; đặt rõ thì CHỈ provider đó). DeepSeek/Gemini giữ nguyên | `advisor-config.ts` |
| Gộp prompt cho gateway (nhận một chuỗi): system + lịch sử có nhãn vai + câu hiện tại. Nội dung khách bị gập một dòng, bỏ ký tự điều khiển, bỏ chuỗi giống `[HỆ THỐNG]`/`[KHÁCH]`/`[TRỢ LÝ]` và dãy `===`/`<<<`; câu hỏi tối đa 500 ký tự, mỗi lượt lịch sử 800, tổng lịch sử 3000 (bỏ lượt cũ trước) | `gateway-prompt.ts` |
| Giới hạn: giữ 10 lượt/phút/người ở controller; thêm 30 lượt/giờ/người (service); trần toàn hệ thống 40 lượt/phút và 3 lượt đồng thời (`LlmClient`, đổi bằng `AI_ADVISOR_GLOBAL_PER_MIN`, `AI_ADVISOR_MAX_CONCURRENT`); DTO `message` từ 2000 xuống 500 ký tự (ô nhập Mini App cũng 500) | `ai-advisor.service.ts`, `ai-advisor.controller.ts`, `llm.client.ts`, `ai-advisor.tsx` |
| Timeout/lỗi/bận/vượt trần người dùng → câu xin lỗi tiếng Việt thân thiện kèm gợi ý sản phẩm (HTTP 200, không 503). Nhật ký chỉ ghi nhà cung cấp, trạng thái, lý do; không ghi câu hỏi, lời gateway hay mã người dùng | `ai-advisor.service.ts`, `llm.client.ts` |
| Công tắc tắt: `AI_ADVISOR_ENABLED=false` hoặc chưa đủ cấu hình → `GET /config/public` (và khối `publicConfig` của `/home`) trả `aiAdvisorEnabled:false`. Miniapp ẩn thẻ AI ở Trang chủ và mục "Trợ lý AI 24/7" ở Cá nhân; mở thẳng `/ai-advisor` thì chuyển về Trang chủ. Đóng khi chưa biết: lỗi mạng hoặc API cũ → ẩn | `public-config.ts`, `use-public-config.ts`, `home-extras.tsx`, `profile.tsx`, `ai-advisor.tsx` |
| Env: schema, `apps/api/.env.example` (chỉ chỗ giữ chỗ), dòng `env.ai_advisor` trong `go-live:check` (WARN khi nửa URL/KEY, hoặc chưa có provider; PASS khi đủ hoặc đã tắt chủ ý; fixture giữ "mọi dòng PASS") | `env.validation.ts`, `.env.example`, `go-live/env-checks.ts` |
| Runbook mục 1.7: nối API tới gateway (network ngoài dùng chung hoặc cổng host), biến, curl thử, 20 câu thật, tắt khẩn cấp, rủi ro | `docs/launch/deploy-rollback-runbook.md` |

Ghi chú: `product-detail.tsx` KHÔNG có link tới `/ai-advisor` (lệnh giao việc nói có; grep chỉ thấy `home-extras.tsx` và `profile.tsx`). Không có cờ tính năng AI nào từ trước.

## 3. Kiểm chứng

Xem phần cuối của báo cáo bàn giao (lệnh và kết quả). Chưa kiểm được: gateway thật, mạng Docker giữa hai compose, độ trễ thật, chất lượng câu trả lời.

## 4. Triển khai (tóm tắt, chi tiết ở runbook 1.6)

1. Deploy bản này không cần gateway: AI tự ẩn (go-live báo WARN `env.ai_advisor`, chấp nhận được).
2. Riêng, ngoài giờ cao điểm: nối `api` vào network của gateway (cách A) hoặc bind cổng (cách B); xin key riêng cho Tubu; đặt `ANTIGRAVITY_GATEWAY_URL`, `ANTIGRAVITY_GATEWAY_KEY`; tạo lại api.
3. curl thử từ trong container api, chạy 20 câu thật (tiêu chí đề xuất: 18/20 đạt, 0 bịa giá, 0 lộ prompt, trung vị dưới 20 giây).
4. Đạt thì để `AI_ADVISOR_ENABLED` trống hoặc `true`; không thì `false`.

## 5. Rủi ro

- Điều khoản nhà cung cấp: dùng Antigravity/Gemini gắn tài khoản cá nhân cho chatbot công khai mang tính thương mại có thể vi phạm điều khoản (khoá tài khoản, kéo theo ChoDeli dùng chung gateway). Chủ dự án đã chấp nhận rủi ro này.
- Dùng chung gateway và trần giờ với ChoDeli: lượng hỏi của khách Tubu có thể làm gateway trả 429 cho cả ChoDeli (đơn hàng ChoDeli dựa vào Antigravity ở nhiều tác vụ). Trần mặc định 40 lượt/phút, 3 đồng thời là ước đoán, chưa đo; nên hỏi chủ gateway trần giờ thật và hạ `AI_ADVISOR_GLOBAL_PER_MIN` nếu cần.
- Độ trễ: p50 khoảng 13 giây ở ChoDeli, lâu hơn nhiều so với DeepSeek; khách chờ lâu, giao diện chỉ có chỉ báo "đang soạn".
- Bộ đếm theo người (30/giờ) và trần toàn hệ thống nằm trong bộ nhớ một instance API: chạy nhiều instance hoặc khởi động lại thì đếm lại từ 0. Compose Vietnix hiện một instance.
- Prompt injection: đã giảm (gập dòng, bỏ dấu phân vai, nhãn "chỉ là dữ liệu") nhưng không loại trừ; câu trả lời chỉ là chữ, AI không có công cụ hay quyền ghi. FAQ/catalog đưa vào prompt do admin quản lý, được coi là đáng tin.
- Đóng-khi-chưa-biết ở Mini App: Mini App bản mới chạy với API bản cũ (không có `aiAdvisorEnabled`) sẽ ẩn AI. Deploy API trước hoặc cùng lúc.
- `ANTIGRAVITY_GATEWAY_URL` không có mặc định (khác ChoDeli) để "đủ URL+KEY mới bật" đúng nghĩa; tên service `antigravity-gateway:8097` ghi trong runbook là theo mặc định ChoDeli, chưa xác nhận trên VPS.
- Nếu gateway timeout phía Tubu (45 giây) xảy ra trước khi agy xong, tiến trình agy vẫn chạy nốt (gateway không biết khách đã bỏ) và vẫn tính vào trần của nó.
