# Gói P3 muahang: Giỏ, thanh toán, mua chung, trang SP

Gốc: main 815fa3c1e. Nguồn: các P3 reviewer Opus nêu ở đợt 28/10 (gói giohang, muachung) chưa sửa, mục làm dở, và mục còn lại trong báo cáo cuối.

Với mỗi mục: kiểm còn đúng trên mã hiện tại không (nhiều mục đã sửa ở lượt review sau hoặc gói khác; dòng có thể lệch). Đã hết thì ghi skipped + bằng chứng file:dòng. Mục cần chủ quyết (ghi needs_owner/cần chủ quyết, hoặc phải đổi giá, luật điểm, phí, thể lệ, chữ pháp lý, cờ PROD, thêm tin gửi khách) thì skipped, ghi lựa chọn cho chủ. Mục trùng nhau thì làm một lần, ghi id kia là trùng.

## muahang-1 (review lượt 1, gói giohang)

File: apps/web/src/app/gio-hang/empty-cart.tsx:36-48

Vấn đề: E-97 được báo 'done', nhưng điều kiện xong của mục là 'so ảnh 375px hai nền khớp bố cục' và chưa ai chụp. Worker tự ghi là chưa kiểm phần hình. Kệ web dùng 'px-4 max-md:pb-4' và không có padding trên, còn Mini dùng padding '16px 16px 0'. Hai bản có thể lệch nhau mà chưa ai thấy.

Cách sửa đề xuất: Chụp /gio-hang khi giỏ trống ở web 375 và chụp màn giỏ trống của Mini, đặt cạnh nhau (theo ảnh mẫu cart__new__*375__s1). Chưa có ảnh thì ghi E-97 là partial. Nếu lệch thì chỉnh padding của section kệ cho giống Mini.

## muahang-2 (review lượt 1, gói giohang)

File: packages/app-core/src/route-map.json:82; apps/e2e/tests/support/mock-api.ts:417; apps/e2e/tests/support/checkout-mocks.ts:110-125; apps/e2e/tests/order.web.spec.ts:76

Vấn đề: Gói sửa 4 file thuộc gói dondep theo bảng chủ file. route-map.json phải sửa chỉ vì logic chạm mã bị tách sang hooks/use-referral-touch.ts, mà việc tách này mục không bắt buộc. Gộp nhánh dễ xung đột với dondep.

Cách sửa đề xuất: Cách 1: giữ effect chạm mã trong apps/miniapp/src/components/app.tsx (khoảng dòng 187-208 được phép sửa) để route-map.json khỏi phải đổi. Cách 2: giữ nguyên, nhưng gộp sau dondep và báo trước cho dondep về 3 hunk ở apps/e2e (đã tách riêng ở commit e3364aa00).

## muahang-3 (review lượt 1, gói giohang)

File: apps/miniapp/src/pages/storefront-view.tsx:50; apps/miniapp/src/pages/checkout.tsx:102; apps/web/src/app/thanh-toan/page.tsx:172

Vấn đề: Comment kể lại thay đổi, trái luật brief: '(trước đây mở một gian hàng đối tác là xoá mã và gửi slug...)' và '...vẫn gửi kèm đơn như trước'.

Cách sửa đề xuất: Bỏ câu '(trước đây ...)'. Đổi 'như trước' thành câu nói lý do, ví dụ 'Chưa biết (null) vẫn gửi kèm đơn để máy chủ tự quyết: lỗi mạng khi chạm không được làm CTV mất công.'

## muahang-4 (review lượt 1, gói giohang)

File: packages/app-core/src/shipping-eta.ts:41-46 (placedOrderKinds); apps/miniapp/src/components/checkout/order-success.tsx:106; apps/web/src/app/thanh-toan/page.tsx:378

Vấn đề: Dòng 'Giao dự kiến' ở màn đặt xong của mọi đơn Tubu đơn lẻ phụ thuộc cột `fulfiller` trong phản hồi place-order. Cột này có thật (findOrderResponse -> forBuyer giữ cả hàng) nhưng OrderDTO ở shared-types không khai báo. Sau này ai thêm 'fulfiller' vào BUYER_HIDDEN_ORDER_FIELDS, hoặc đổi findOrderResponse sang select từng cột, thì ngày giao biến mất ở cả hai nền mà tsc và test vẫn xanh. Lần chạy Playwright đầu đã đỏ đúng vì mock thiếu cột này.

Cách sửa đề xuất: Thêm `fulfiller?: 'TUBU' | 'MERCHANT'` vào OrderDTO (packages/shared-types/src/order.ts; cần gói giữ file đồng ý), hoặc thêm test jest ở checkout.service.spec khẳng định phản hồi place-order đơn lẻ có `fulfiller`.

## muahang-5 (review lượt 1, gói giohang)

File: apps/web/src/lib/storefront-context.ts:157-164 (savePendingRef), apps/web/src/components/storefront-tracker.tsx:90-103

Vấn đề: Bản chờ chỉ giữ link mở gần nhất, và lần chạm bù diễn ra lúc đăng nhập chứ không phải lúc mở link. (a) Khách chưa đăng nhập mở link CTV A, sau đó mở link chia sẻ sản phẩm ?ref=<mã khách thường>: bản chờ A bị đè, chạm bù trả ok:false rồi xoá, nên A mất công. Máy chủ cố ý không để mã khách thường đè chạm CTV, nhưng bản chờ thì đè. (b) Chạm bù ở ngày 6 làm hạn ghi công kéo tới khoảng 13 ngày từ lúc bấm link, và có thể đè một chạm mới hơn đã ghi từ Mini App. Hai trường hợp đều hẹp và không phải hồi quy (trước đây không có bản chờ), cách làm cũng đúng như brief.

Cách sửa đề xuất: Giữ tối đa 3 bản chờ (mảng có savedAt) và chạm bù theo thứ tự cũ đến mới, để luật findEligibleReferrer của máy chủ chọn mã CTV cuối cùng hợp lệ. Hoặc ít nhất không ghi đè một bản chờ có kind 'CTV' bằng một link ?ref= thuần. Ghi phần (b) vào tài liệu cho chủ biết.

## muahang-6 (review lượt 1, gói giohang)

File: apps/miniapp/src/components/checkout/use-coupon-hint.ts:136-145

Vấn đề: Mini gọi POST /checkout/coupon-previews ở mỗi lần mở giỏ hoặc thanh toán chưa có mã, kể cả khi ví khách không có mã nào. Web (coupon-box.tsx:121) đã chặn trường hợp này bằng `couponsQ.data.length > 0`. Phía máy chủ đọc attribution, checkoutLines, user và couponBase trước khi biết ví rỗng, nên với hàng chục nghìn khách đây là tải thừa.

Cách sửa đề xuất: Bật hint chỉ khi biết ví có mã (dùng chung query ['coupons'] đã có, giống web), hoặc nhờ gói diem cho couponPreviews trả [] sớm khi `held` rỗng.

## muahang-7 (review lượt 2, gói giohang)

File: apps/web/src/components/storefront-tracker.tsx:47-67 (replayTouches), apps/web/src/lib/storefront-context.ts:~180 (savePendingRef)

Vấn đề: replayTouches bắt mọi lỗi (catch {}) rồi đặt delivered=false, nên bản chờ chỉ được giữ lại vì lỗi mạng như comment nói mà cả lỗi 4xx vĩnh viễn cũng bị giữ. Ví dụ ?ref= hoặc ?s= dài hơn 64 ký tự bị TouchDto (@MaxLength(64), affiliate.controller.ts:51-52) trả 400. Khi đó bản chờ kẹt 7 ngày. Mỗi lần tải trang đã đăng nhập và mỗi lần vào /s/ đều chạm lại các link CTV cũ trong danh sách, làm mới expiresAt phía máy chủ và đè chạm mới hơn từ Mini App. Xác suất thấp nhưng chạm tới ghi công.

Cách sửa đề xuất: Trong catch chỉ đặt delivered=false khi lỗi là NetworkError, ApiError có status >= 500, 401 hoặc 429 (import ApiError/NetworkError từ '@/lib/client-api'); 4xx khác coi như đã tới máy chủ. Thêm chặn ở savePendingRef: bỏ qua referralCode hoặc slug dài hơn 64 ký tự. Test ở storefront-tracker.spec.tsx: touch ném new ApiError('x', 400) thì readPendingRefs() rỗng; touch ném NetworkError thì vẫn giữ.

## muahang-8 (review lượt 2, gói giohang)

File: apps/web/src/lib/storefront-context.ts:17-22 (PENDING_REF_TTL_DAYS)

Vấn đề: Đây là thiết kế đúng theo brief E-8, worker đã tự nêu. Chạm bù lúc đăng nhập có thể đè một chạm mới hơn đã ghi từ Mini App, vì máy chủ upsert không kiểm thời điểm và chạm hợp lệ cuối cùng thắng. Ngoài ra nó kéo hạn ghi công tới khoảng 13–14 ngày kể từ lúc bấm link, trong khi affiliate.attribution_days = 7. Hoa hồng có thể về CTV cũ trong ca khách dùng cả hai nền.

Cách sửa đề xuất: Không sửa trong gói (cần chủ quyết, needs_owner). Ghi vào báo cáo cho chủ hai lựa chọn: (a) giữ 7 ngày; (b) hạ PENDING_REF_TTL_DAYS xuống 3 cho khớp hạn chạm, hoặc sau này API nhận clickedAt và tính expiresAt từ mốc đó (gói ctv).

## muahang-9 (review lượt 2, gói giohang)

File: apps/miniapp/src/hooks/use-referral-touch.ts:17-29 (cùng hành vi có sẵn ở web StorefrontTracker và Mini /brand)

Vấn đề: Sau E-48, mở gian hàng đối tác khi đang có mã CTV sẽ làm hook chạm lại với kind 'brand' và không có storefrontSlug. Máy chủ upsert chạm thành {storefrontSlug:null, kind:'brand'}, làm mất slug gian hàng CTV trong chạm. Trước đây Mini gửi slug đối tác làm mã nên ok:false và không đè. Hoa hồng không đổi, nhưng khi mất phiên thì đơn sau không còn gắn gian hàng CTV (combo, storefrontSlug của đơn). Web và /brand đã làm vậy từ trước nên hai nền nay giống nhau.

Cách sửa đề xuất: Tuỳ chọn, có thể để gói sau: trong useReferralTouch giữ useRef mã đã chạm thành công; khi kind khác 'ctv' và mã trùng mã đã chạm thì không gọi lại. Web StorefrontTracker làm tương tự cho type khác 'CTV'. Test: setContext CTV rồi chuyển sang partner cùng mã thì recordReferralTouch chỉ được gọi 1 lần.

## muahang-10 (review lượt 2, gói giohang)

File: apps/web/src/lib/storefront-context.spec.ts:91,133; apps/web/src/components/storefront-tracker.spec.tsx:97,271; apps/miniapp/src/pages/storefront-view.spec.tsx:92

Vấn đề: Tên describe có mã mục (E-7), (E-8), (E-48), trái luật brief là không nhắc mã mục E-x/R-x.

Cách sửa đề xuất: Bỏ phần '(E-7)', '(E-8)', '(E-48)' khỏi tên describe, giữ phần mô tả hành vi.

## muahang-11 (review lượt 2, gói giohang)

File: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-e2e-giohang.txt

Vấn đề: Gate chạy từ 02:16:36 đến 02:28:55, tức trên 3705dc67e; HEAD f7b29b85b được commit lúc 02:33:38. Commit cuối chỉ thêm apps/e2e/tests/cart-empty.web.spec.ts. Reviewer đã chạy lại tsc e2e (xanh) và Playwright spec đó (xanh) nên kết quả coi như còn đúng. Báo cáo của worker thiếu số First Load web của /gio-hang, /thanh-toan và layout (ReferralCapture to hơn), trong khi luật yêu cầu ≤ 2 KB hoặc ghi lý do.

Cách sửa đề xuất: Chạy next build cho apps/web ở 376ad7055 và ở HEAD, ghi First Load của /gio-hang, /thanh-toan và chunk chung của layout vào báo cáo gộp.

## muahang-12 (review lượt 1, gói muachung)

File: apps/web/src/components/add-to-cart.tsx:166 (đọc ?ma=) và :189-196 (nhánh Mua ngay)

Vấn đề: (a) `?ma=` vẫn nằm trên URL sau khi đã áp. Tải lại trang hoặc quay lại rồi thêm giỏ thì mã bị áp lại, kể cả khi khách đã bỏ chọn mã ở giỏ. Mini thì gỡ state sau lần thử đầu, web có sẵn mẫu forgetOrderParam (product-reviews.tsx:67-72) nhưng không dùng. (b) Hàm nhận mọi mã chứ không riêng mã nhóm: một link soạn sẵn `?ma=<mã bất kỳ>` sẽ thay mã khách đang chọn trong giỏ. (c) Mua ngay mà áp mã lỗi thì `note` bị bỏ và trang chuyển sang /thanh-toan không một lời. Mini báo lý do bằng snackbar trước khi chuyển.

Cách sửa đề xuất: Sau lần thử đầu, gỡ `ma` bằng history.replaceState theo cách của forgetOrderParam. Chỉ áp khi mã khớp /^GBUY-/. Với nhánh buyNow mà note là lỗi: hiện note (setMsg) và nhờ gói giohang hiện lời ở /thanh-toan qua sessionStorage; nếu không làm thì ghi rõ trong báo cáo là khác Mini. Thêm ca spec: tải lại sau khi áp thì không gọi applyCoupon lần hai; ?ma=WELCOME30 thì không gọi.

## muahang-13 (review lượt 1, gói muachung)

File: apps/miniapp/src/pages/group-buy.tsx:52-58

Vấn đề: Comment "API chi tiết cần đăng nhập nên khách chưa đăng nhập chỉ xem danh sách chung" đã sai từ khi GET /group-buy/:id thành @Public. Truy vấn còn `enabled: ... && authed` và khoá ['group-buy','one',id] không gắn người xem, trong khi web đã bỏ điều kiện authed và gắn khoá theo viewer.

Cách sửa đề xuất: Sửa comment theo hành vi mới. Để giống web: bỏ `&& authed`, khoá thêm viewer (user?.id ?? 'guest'), cùng luật groupBuyOneQuery của app-core.

## muahang-14 (review lượt 1, gói muachung)

File: packages/app-core/src/review-copy.ts:12-17 (rewardHint), gọi ở apps/web/src/app/san-pham/[slug]/product-reviews.tsx:419

Vấn đề: Câu thưởng web giờ luôn mời "thêm video +15.000", kể cả khi bản build thiếu NEXT_PUBLIC_CLOUDINARY_* (ReviewVideoUpload trả null, không có nút chọn video). Bản web cũ cố ý không mời video khi không tải được. Mini cũng hứa như vậy khi VideoUpload trả null.

Cách sửa đề xuất: Thêm tham số `canUploadVideo` cho rewardHint; false thì dùng câu không nhắc video. Web truyền theo env Cloudinary, Mini truyền isCloudinaryConfigured(). Test app-core cho nhánh này.

## muahang-15 (review lượt 2, gói muachung)

File: apps/miniapp/src/components/image-upload.tsx:239-242 (pick), :270 và :282 (nút Đổi video / chọn video)

Vấn đề: Nút chọn video và nút 'Đổi video' của Mini vẫn bấm được khi video đang tải (web thì khoá bằng disabled={disabled || busy}). Khách chạm lần hai sẽ có hai lần tải chạy song song. Lần đầu xong thì gọi changeUploading(false), nên videoBusy ở WriteReview về false và nút Gửi mở lại dù lần tải thứ hai chưa xong. Như vậy cách khoá Gửi của R1-2 vẫn hở trên Mini, và khách có thể gửi đánh giá với video cũ hoặc không đúng video vừa chọn.

Cách sửa đề xuất: Trong VideoUpload, `pick` trả về sớm khi `uploading` (if (uploading) return;), đồng thời thêm `disabled={uploading}` cho hai nút chọn/đổi video và nút Xoá video, như ReviewVideoUpload của web. Thêm một ca vào image-upload.spec.tsx: fetch treo, bấm chọn lần hai thì không mở input, onBusyChange chỉ nhận true một lần cho tới khi resolve.

## muahang-16 (review lượt 2, gói muachung)

File: apps/web/src/components/add-to-cart.tsx:188, :214, :221-222

Vấn đề: Màu câu báo áp mã nhóm trên web ngược nghĩa và khác Mini. Với kết quả 'switched' ("Đã đổi sang mã GBUY-…", tức áp được), Mua ngay vẫn giữ câu trên màn với setSuccess(false), nên chữ hiện màu đỏ như lỗi. Ngược lại, Thêm vào giỏ mà mã chưa áp được ("Chưa chọn sẵn được mã: …") lại hiện màu xanh thành công vì setSuccess(true). Mini đúng hơn: 'switched' là info/success, notApplied là warning.

Cách sửa đề xuất: Cho applyGroupCoupon trả thêm `ok: outcome.kind !== 'notApplied'` (và false ở nhánh catch). Ở nhánh Mua ngay, đổi thành setSuccess(ok) và chỉ giữ 1,8 giây khi !ok, hoặc giữ cả hai trường hợp nhưng đặt màu theo ok. Ở nhánh Thêm vào giỏ, khi !ok thì tách câu mã ra một dòng màu cảnh báo (text-warning-fg), còn 'Đã thêm vào giỏ!' vẫn để màu xanh. Thêm ca vào add-to-cart.spec: 'switched' thì không có lớp text-danger-fg; notApplied ở Thêm giỏ thì có lớp cảnh báo.

## muahang-17 (review lượt 2, gói muachung)

File: apps/web/src/lib/flash-price.ts:87-93; apps/web/src/components/flash-price.tsx:57; apps/web/src/components/add-to-cart.tsx (flash = runningFlash(...))

Vấn đề: Comment nói giá và nhãn Giờ vàng 'biến mất đúng lúc đợt hết', nhưng trên web chỉ PdpFlashMeta chạy lại mỗi giây (useCountdown). PdpPrice, AddToCart (dòng 'Giá Giờ vàng …', giá trên nút) và PdpPointsEarn không chạy lại khi tới endAt. Vì vậy sau mốc hết giờ, đồng hồ đã tắt nhưng giá Giờ vàng còn hiện tới 60 giây, cho tới lần tải lại danh sách (REFRESH_MS). Mini không bị vì useCountdown nằm ngay trong trang. Không sai tiền, vì máy chủ tính lại giá khi thêm giỏ.

Cách sửa đề xuất: Trong useActiveFlashSales (apps/web/src/lib/use-flash-sales.ts), đặt một setTimeout tới endAt gần nhất trừ serverNow() để gọi refetch hoặc tăng một state tick, rồi dọn timer khi danh sách đổi. Cách khác là sửa comment cho đúng: chỉ lọc ở lần render kế tiếp. Thêm ca vào pdp-price.spec: dùng fake timers, cho thời gian qua endAt và kiểm giá Giờ vàng biến mất mà không cần refetch.

## muahang-18 (review lượt 2, gói muachung)

File: apps/web/next.config.mjs:46-57 (gói dondep giữ)

Vấn đề: CSP (đang ở chế độ Report-Only) chưa có media-src, nên rơi về default-src 'self'. Thẻ <video> xem trước video Cloudinary và bước đọc độ dài video qua blob: URL (readVideoDuration) sẽ sinh báo vi phạm. Khi chuyển sang chặn thật, ô xem trước video và bước kiểm 60 giây trên máy sẽ hỏng (bước kiểm thì lặng lẽ rơi về kiểm phía Cloudinary). Video trong danh sách đánh giá đã bị như vậy từ trước, gói này thêm đường blob:.

Cách sửa đề xuất: Ghi vào báo cáo để gói dondep thêm `media-src 'self' blob: https://res.cloudinary.com` vào cspReportOnly. Gói này không tự sửa next.config.mjs.
