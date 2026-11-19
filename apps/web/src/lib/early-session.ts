/**
 * Khôi phục phiên sớm cho Giỏ hàng và Vườn Xanh của khách ĐÃ đăng nhập (tubu-w8-01). Bình thường thứ tự là: tải xong JS, hydrate, AuthProvider
 * gọi `POST /auth/refresh`, rồi trang mới gọi giỏ / hồ sơ game: ba lượt mạng nối đuôi sau khi JS chạy, LCP ở 390px quanh 2,1–2,4 giây.
 * Script nội tuyến ở đây chạy ngay khi trình duyệt đọc tới nó trong HTML (trước khi JS của trang tải xong): gọi refresh, có access token thì
 * gọi luôn các GET trang sẽ cần. `client-api.ts` nhận lại kết quả: lượt khôi phục phiên dùng đúng lượt refresh này (không gọi lần hai) và
 * `apiFetch` lấy phản hồi GET đã về thay vì gọi lại.
 *
 * Module thuần (không 'use client', không đụng window lúc import): trang ISR dựng chuỗi script ở máy chủ, client-api đọc tên biến toàn cục.
 */
import { SESSION_COOKIE } from './home-restore-hint';

/** Biến toàn cục script để lại cho `client-api.ts` (đọc qua `claim` / `take`). */
export const EARLY_SESSION_GLOBAL = '__tubuEarlySession';

/** Kết quả một lượt gọi của script: như `Reply` của client-api, thân là JSON thô (chưa ghép gốc API cho ảnh). */
export interface EarlyReply {
  status: number;
  ok: boolean;
  body: unknown;
}

/** Thứ script để lại ở `window[EARLY_SESSION_GLOBAL]`. Hạn, khoá theo phiên và "nhận một lần" nằm trong script (HTML) để JS dùng chung của mọi trang không nặng thêm. */
export interface EarlySession {
  /** Lượt refresh của script, nhận đúng một lần; null khi đã nhận hay quá EARLY_REFRESH_TTL_MS (cookie đã xoay ở lượt sớm nên refresh lại vẫn hợp lệ). */
  claim(): Promise<EarlyReply> | null;
  /**
   * Phản hồi GET đã gọi cho `path`, nhận đúng một lần, chỉ khi `token` là access token lượt refresh sớm trả về (đăng xuất, đổi tài khoản thì không)
   * và trong PRIMED_TTL_MS (lượt tải đầu, không vẽ dữ liệu cũ). null = gọi mạng như thường; lượt gọi của script ném thì cũng thành null.
   */
  take(path: string, token: string): Promise<EarlyReply | null> | null;
}

export const EARLY_REFRESH_TTL_MS = 60_000;
export const PRIMED_TTL_MS = 30_000;

/**
 * GET mỗi trang gọi ngay khi phiên khôi phục xong, đúng chuỗi đường dẫn `apiFetch` nhận (không có query). Lệch một ký tự thì phản hồi mồi
 * không ai lấy và trang gọi lại như cũ (chậm, không sai): `early-session.spec.ts` so với chính các hàm gọi API để bắt lệch.
 * - Giỏ: giỏ (phần tử LCP là thanh Miễn phí giao hàng) và mã của tôi (dải nhắc mã nằm TRÊN các dòng giỏ, hiện muộn thì đẩy cả danh sách).
 * - Vườn Xanh: hồ sơ game (phần tử LCP là bình nước), các khối GameBody chờ trước khi bỏ khung chờ, khối đầu trang và thanh đầu.
 */
export const EARLY_GETS = {
  cart: ['/cart', '/me/coupons'],
  garden: [
    '/game/profile',
    '/game/quiz/today',
    '/game/missions',
    '/me/loyalty',
    '/me/daily-check-in',
    '/game/mini/today',
    '/game/arcade/status',
    '/game/daily',
    '/me/summary',
    '/me/coupons',
    '/cart',
  ],
} as const satisfies Record<string, readonly string[]>;

/** Gốc API như `BASE` của client-api (biến build, nên chuỗi script trong bản ISR khớp với JS của cùng bản build). */
export const EARLY_API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

/** Hạn chờ mỗi lượt gọi của script, bằng `REQUEST_TIMEOUT_MS` của client-api. */
const TIMEOUT_MS = 20_000;

/** JSON nhúng an toàn trong thẻ script: `<` thành `<` để chuỗi không đóng được thẻ. */
const inline = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/**
 * Script nội tuyến (ES5, không phụ thuộc gì) đặt trong HTML của bản thường của trang (bản khách dựng sẵn không có phiên nên không cần).
 * Chỉ chạy khi có cờ phiên `tubu_web_session` trong localStorage, như `hasSessionMarker`. Refresh đi qua cùng khoá Web Locks
 * `tubu_web_refresh` với client-api để các tab mở cùng lúc vẫn refresh lần lượt. Mọi lỗi đều nuốt: trang tự refresh như cũ.
 */
export function earlySessionScript(apiBase: string, paths: readonly string[]): string {
  return `(function(){try{
if(typeof fetch!=='function'||typeof Promise!=='function')return;
try{if(localStorage.getItem(${inline(SESSION_COOKIE)})!=='1')return}catch(e){return}
var api=${inline(apiBase.replace(/\/+$/, ''))},paths=${inline(paths)},at=Date.now(),token=null,gets={};
function call(url,init){var c=typeof AbortController==='function'?new AbortController():null,t=c?setTimeout(function(){c.abort()},${TIMEOUT_MS}):0;if(c)init.signal=c.signal;
return fetch(url,init).then(function(r){if(r.status===204)return{status:204,ok:r.ok,body:null};return r.text().then(function(x){var b=null;if(x!==''){try{b=JSON.parse(x)}catch(e){if(r.ok)throw e}}return{status:r.status,ok:r.ok,body:b}})})
.then(function(v){clearTimeout(t);return v},function(e){clearTimeout(t);throw e})}
function go(){return call(api+'/auth/refresh',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','x-client':'web'},body:'{}'})}
var L=navigator.locks,refresh=L&&typeof L.request==='function'?L.request('tubu_web_refresh',go):go();
refresh.then(function(r){var b=r&&r.ok&&r.body;if(b&&typeof b.accessToken==='string')token=b.accessToken},function(){});
paths.forEach(function(p){gets[p]=refresh.then(function(){return token?call(api+p,{method:'GET',credentials:'include',headers:{'Authorization':'Bearer '+token,'X-Client-Platform':'web'}}):null});gets[p].catch(function(){})});
window[${inline(EARLY_SESSION_GLOBAL)}]={
claim:function(){var r=refresh;refresh=null;return r&&Date.now()-at<=${EARLY_REFRESH_TTL_MS}?r:null},
take:function(p,k){var g=gets[p];if(!g||!token||k!==token)return null;delete gets[p];return Date.now()-at<=${PRIMED_TTL_MS}?g.then(null,function(){return null}):null}};
}catch(e){}})();`;
}
