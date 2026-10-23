// ZaloApiError (node_modules/zca-js/dist/Errors/ZaloApiError.d.ts) là lỗi Zalo đã trả lời và từ chối phiên. Dò theo tên lớp
// trên chuỗi prototype vì zca-js có hai bản (ESM và CJS), instanceof qua bản kia sẽ sai.
function isZaloApiError(e: unknown): boolean {
  for (let p = e as object | null; p; p = Object.getPrototypeOf(p)) {
    if (p.constructor?.name === 'ZaloApiError') return true;
  }
  return false;
}

// Lỗi mạng, hết giờ 60 giây, DNS: chưa có câu trả lời của Zalo nên phiên có thể vẫn còn dùng được, thử lại.
export function classifyLoginError(e: unknown): 'retry' | 'need-qr' {
  return isZaloApiError(e) ? 'need-qr' : 'retry';
}
