/**
 * Phần chỉ chạy ở máy chủ của bản khách dựng sẵn (app/gio-hang, app/vuon-xanh): chuỗi script nội tuyến và mốc cấu hình nạp sẵn. Tách khỏi
 * guest-prebuilt.ts vì module đó nằm trong JS của mọi trang (client-api, giỏ khách dùng hằng số của nó), còn các chuỗi này không cần ở trình duyệt.
 */
import { SESSION_COOKIE } from './home-restore-hint';
import { GUEST_CART_COOKIE, GUEST_CART_ID_RE, GUEST_CART_KEY, GUEST_CART_SLUG_RE, WEB_COOKIE_MAX_AGE_S } from './guest-prebuilt';

/** staleTime của usePublicConfig (lib/use-public-config.ts; spec so hai số). */
export const PUBLIC_CONFIG_STALE_MS = 5 * 60_000;

/**
 * Mốc `updatedAt` cho cấu hình công khai nạp sẵn trong bản ISR của Giỏ khách: lùi lại để cấu hình hết tươi đúng `revalidateS` giây sau lúc dựng.
 * Lấy mốc dựng thì cấu hình nạp sẵn còn tươi thêm cả staleTime 5 phút của usePublicConfig, nên khách nhận HTML đã cũ vẫn dùng cờ giỏ khách cũ
 * mà không hỏi lại; lùi mốc thì khách nhận HTML cũ hơn `revalidateS` giây tải lại cấu hình ngay khi hydrate (vẫn vẽ bản nạp sẵn trước).
 */
export function prebuiltConfigSeededAt(renderedAt: number, revalidateS: number, staleMs = PUBLIC_CONFIG_STALE_MS): number {
  return renderedAt - Math.max(0, staleMs - revalidateS * 1000);
}

const js = (v: string) => JSON.stringify(v).replace(/</g, '\\u003c');

/**
 * Script nội tuyến (ES5) đặt trong bản khách dựng sẵn, chạy khi trình duyệt đọc tới nó. Middleware chỉ đọc cookie, còn sự thật nằm ở
 * localStorage, nên hai thứ lệch thì máy nhận nhầm bản khách:
 * - còn dấu phiên `tubu_web_session` mà mất cookie (Safari xoá cookie do script ghi sau 7 ngày): người đã đăng nhập thấy giao diện khách
 *   một nhịp, rồi khung chờ, rồi trang thật;
 * - (Giỏ hàng) giỏ khách có món mà chưa có cookie giỏ (giỏ tạo trước khi có cookie): giỏ chớp trống.
 * Script ghi lại cookie đúng như writeWebCookie rồi tải lại trang đúng một lần (reload, không replace: URL có `#` thì replace chỉ cuộn tới neo), để middleware đưa bản thường. Chặn vòng lặp: chỉ tải lại khi đọc
 * lại được cookie vừa ghi, và mỗi tab mỗi đường dẫn tải lại một lần (sessionStorage). Lỗi gì cũng nuốt: trang chạy như trước.
 */
export function prebuiltMismatchScript(kind: 'cart' | 'garden'): string {
  const cart =
    kind === 'cart'
      ? `if(n===null){var a=JSON.parse(localStorage.getItem(${js(GUEST_CART_KEY)})||'null');if(Object.prototype.toString.call(a)==='[object Array]'){` +
        `for(var i=0;i<a.length;i++){var x=a[i];if(x&&typeof x==='object'&&typeof x.variationId==='string'&&${String(GUEST_CART_ID_RE)}.test(x.variationId)&&` +
        `typeof x.slug==='string'&&${String(GUEST_CART_SLUG_RE)}.test(x.slug)&&typeof x.quantity==='number'&&isFinite(x.quantity)&&x.quantity>=1){n=${js(GUEST_CART_COOKIE)};break}}}}`
      : '';
  return (
    `(function(){try{var n=null,g;if(localStorage.getItem(${js(SESSION_COOKIE)})==='1')n=${js(SESSION_COOKIE)};${cart}if(n===null)return;` +
    `document.cookie=n+'=1; Path=/; Max-Age=${WEB_COOKIE_MAX_AGE_S}; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');` +
    `if((';'+document.cookie+';').replace(/\\s/g,'').indexOf(';'+n+'=1;')<0)return;` +
    `g='tubu_prebuilt_reload:'+location.pathname;if(sessionStorage.getItem(g)==='1')return;sessionStorage.setItem(g,'1');location.reload()}catch(e){}})()`
  );
}
