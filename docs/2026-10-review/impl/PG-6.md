# PG-6: hàm danh sách của web khách ném lỗi thay vì trả mảng rỗng

## Làm gì
Ba hàm danh sách trong apps/web/src/lib/api.ts (getProducts, getBrands, getStorefrontList) trước đây nuốt mọi lỗi và trả `[]`. Nay chúng dùng chung helper `fetchList`: lỗi mạng hoặc `!res.ok` lúc runtime ném `ApiUnavailableError` (giống `fetchDetail`). Khi `process.env.NEXT_PHASE === 'phase-production-build'` vẫn trả `[]`, nên `next build` không hỏng khi API chưa chạy. Chữ ký và kiểu trả về giữ nguyên. Ngoài ba hàm này, `sitemap.ts` bỏ hai khối try/catch nuốt lỗi, vì nếu giữ thì chúng vô hiệu hoá thay đổi (sitemap rút gọn bị ISR giữ 3600 giây).

## Nơi gọi và hành vi khi API lỗi lúc runtime
- `app/page.tsx` (trang chủ, getProducts + getBrands qua Promise.all): không có catch; lỗi đi tới `app/error.tsx`, vốn thân thiện ("Có chút trục trặc" kèm nút "Thử lại", không lộ chi tiết). Trang chủ là route động (ƒ trong bảng build, do dùng searchParams), nên nếu không có bản cache nào thì khách thấy trang lỗi này thay cho "không có sản phẩm". Đây là chỗ đánh đổi chính, xem rủi ro.
- `app/sitemap.ts` (getProducts, getStorefrontList): route tĩnh revalidate 3600; bỏ catch, lỗi lúc revalidate thì Next giữ sitemap đầy đủ lần trước. Lần đầu không có bản cache thì crawler nhận 500 và sẽ thử lại.
- Không có nơi nào dùng `.catch(() => [])` cho các hàm này. Layout dùng chung (layout.tsx, site-footer) chỉ dùng `getPublicSupport`, hàm này có fallback `DEFAULT_SUPPORT` và cố ý KHÔNG đổi (menu/footer dùng chung: một lần API lỗi mà làm cả site hiện lỗi thì không chấp nhận được). Không đụng tới.
- `getProducts` trong merchant/page.spec.tsx là hàm khác (getMerchantProducts), không liên quan.

## Next 14 có giữ bản cũ khi ném lỗi lúc revalidate không
Theo tài liệu ISR của Next 14: nếu có lỗi khi tái tạo trang ở nền, Next tiếp tục phục vụ bản đã tạo thành công gần nhất. Tôi dựa vào tài liệu/kiến thức sẵn có, KHÔNG xác nhận bằng thực nghiệm (unverified: chưa chạy `next start` với API lúc sống lúc chết).

## Kiểm
Chạy trong /Users/longla/coding/tubutree-mini-app/.claude/worktrees/hz21-PG-6/apps/web:
- Test đỏ trước: `vitest run src/lib/api-ssr.spec.ts` có 12 test fail (3 hàm x 4 ca ném lỗi), đúng lý do "resolved []" thay vì reject.
- `npx vitest run src/lib src/app`: 33 file, 457 test pass, exit 0 (gồm test mới trong api-ssr.spec.ts: thành công, mất kết nối, 429/500/503 ném ApiUnavailableError, phase build trả [], cho cả ba hàm).
- `npx tsc --noEmit`: exit 0.
- `npx eslint --max-warnings=0 src/lib/api.ts src/lib/api-ssr.spec.ts src/app/sitemap.ts`: exit 0.
- `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:9/api API_BASE_URL=http://127.0.0.1:9/api npx next build` (API không chạy): exit 0, không có chữ "error" trong log.

## Chưa verify
- Hành vi giữ bản cũ của ISR thực tế (như trên); không chạy Playwright hay full suite.
- Không so build với HEAD gốc vì build mới đã qua.

## Rủi ro và cân nhắc
- Được: không còn bản rỗng bị cache tới 300-3600 giây cho khách và Googlebot; sitemap không bị thu hẹp.
- Mất: khi API lỗi và chưa có bản cache hợp lệ (khởi động lạnh, hoặc trang chủ động theo searchParams như `?q=`), khách thấy trang lỗi thay vì trang chủ có hero và danh sách rỗng. Trang chủ trắng phần danh sách trước đây vẫn có hero/lợi ích; nay cả trang là error boundary (có nút Thử lại). Nếu muốn giữ hero khi lỗi, cần một quyết định riêng (ví dụ catch cục bộ ở page.tsx), tôi không tự mở rộng.
- Build: sitemap.xml được dựng lúc build với API chưa chạy sẽ chỉ có trang chủ tới lần revalidate đầu (hành vi cũ, không đổi).
