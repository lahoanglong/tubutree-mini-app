import { Zalo } from 'zca-js';
import type { ZaloCredentials } from './types';
import type { ZaloLike, ZcaApiLike, ZcaQrEvent } from './zalo-client';

// selfListen để nhận cả tin do chính tài khoản này gõ trên điện thoại; EchoFilter lọc phần cầu nối tự gửi.
export function createRealZalo(): ZaloLike {
  const make = () => new Zalo({ selfListen: true, logging: false });
  return {
    async login(c: ZaloCredentials) {
      const api = await make().login({ cookie: c.cookie, imei: c.imei, userAgent: c.userAgent } as Parameters<Zalo['login']>[0]);
      return api as unknown as ZcaApiLike;
    },
    async loginQR(cb: (e: ZcaQrEvent) => void) {
      const api = await make().loginQR({}, (e) => cb(e as unknown as ZcaQrEvent));
      return api as unknown as ZcaApiLike;
    },
  };
}
