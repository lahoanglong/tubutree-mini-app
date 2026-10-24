# Theo dõi lỗi (Sentry / GlitchTip) và đóng /_next/image

## Theo dõi lỗi: tắt trừ khi có DSN

Không đặt DSN thì không có gì chạy: API không khởi tạo SDK, web không nạp SDK, không thêm filter hay listener nào.

Dùng được cả Sentry cloud lẫn GlitchTip tự host: hai bên nhận cùng định dạng DSN `https://<khoá>@<host>/<id dự án>`. Chỉ cần dán DSN.

### Biến môi trường (file `.env` ở thư mục compose)

| Biến | Dùng ở | Ghi chú |
|---|---|---|
| `SENTRY_DSN` | API (đọc lúc chạy), web server (đọc lúc chạy), và là nguồn của `NEXT_PUBLIC_SENTRY_DSN` khi build web | Rỗng = tắt. Sai dạng URL thì API không khởi động. |
| `SENTRY_ENVIRONMENT` | API, web | Rỗng = `NODE_ENV`. Staging chạy `NODE_ENV=production` thì đặt `staging` để không lẫn với prod. |
| `SENTRY_RELEASE` | API | Tuỳ chọn. Image chưa mang git sha nên không tự điền; muốn gắn bản phát hành thì đặt tay (vd `git rev-parse --short HEAD` lúc deploy). |
| `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | web, trình duyệt | Nhúng lúc BUILD qua build args của compose (lấy từ `SENTRY_DSN`/`SENTRY_ENVIRONMENT`). Đổi DSN phải build lại image web. |

DSN trình duyệt nằm trong JS công khai; đó là thiết kế của Sentry, DSN chỉ cho phép gửi sự kiện. Nên tạo dự án riêng cho web và API hoặc dùng bộ lọc "allowed domains" của dự án nếu lo bị gửi rác.

Bật: điền `SENTRY_DSN` vào `.env`, rồi `docker compose build web` + khởi động lại api và web (build lại vì biến `NEXT_PUBLIC_*`).

### Gửi gì, không gửi gì

- API: lỗi chưa xử lý có status 5xx (filter toàn cục; HttpException 4xx không bao giờ gửi), lỗi Prisma 500, `unhandledRejection`, `uncaughtException` (SDK gửi rồi thoát như Node mặc định).
- Web trình duyệt: lỗi vào `app/error.tsx` và `app/global-error.tsx`, cộng `window.onerror`/`unhandledrejection` (SDK nạp sau hydrate, lúc trình duyệt rảnh).
- Web server: SDK Node khởi tạo qua `instrumentation.ts`, bắt `uncaughtException`/`unhandledRejection`. Next 14.2 chưa có `onRequestError`, nên lỗi render server được Next tự bắt rồi chỉ ghi log; chúng không lên Sentry cho tới khi nâng Next.
- Không gửi: cookie, header Authorization/Cookie/`x-webhook-token`, thân request, query string, breadcrumb, biến cục bộ trong stack, PII mặc định (`sendDefaultPii: false`). Không replay, không tracing (`tracesSampleRate: 0`).
- BullMQ job fail và cron: repo không có điểm móc chung (mỗi processor tự xử lý), nên không móc riêng từng cái. Lỗi cron ném ra ngoài rơi vào `unhandledRejection` và được gửi.

### Gửi sự kiện thử (không thêm route công khai)

API, chạy trong container (dùng đúng DSN và SDK của image):

```sh
docker compose exec api node -e "const S=require('@sentry/node');S.init({dsn:process.env.SENTRY_DSN,environment:'test-event'});S.captureMessage('tubutree test event');S.flush(5000).then(()=>process.exit(0))"
```

Web server:

```sh
docker compose exec web node -e "const S=require('@sentry/node');S.init({dsn:process.env.SENTRY_DSN,environment:'test-event'});S.captureMessage('tubutree web test event');S.flush(5000).then(()=>process.exit(0))"
```

Trình duyệt: mở trang web đã build kèm DSN, mở DevTools Console, gõ `throw new Error('test')` không bắt được `error.tsx`; muốn thử đúng đường error boundary thì dùng bản dev (`pnpm --filter @tubutree/web dev` với `NEXT_PUBLIC_SENTRY_DSN` đặt) và tạm cho một trang ném lỗi khi render. Kiểm tra bằng tab Network có request tới host của DSN (`/api/<id>/envelope/`).

Sự kiện thử phải hiện trong dự án trong vài giây. Không thấy: kiểm DSN, và container có ra được host Sentry/GlitchTip không.

## /_next/image đã đóng

Next 14 có lỗ RCE chưa xác thực ở `/_next/image`, bản vá chỉ có từ 15.5. `apps/web/next.config.mjs` đặt `images: { unoptimized: true }`: route đó trả 404 và `<Image>` xuất `src` thẳng tới tệp tĩnh. Đã kiểm trên bản build production: trước 200, sau 404. Không cần chặn thêm ở Apache.
