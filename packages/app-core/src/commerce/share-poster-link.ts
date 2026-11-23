/**
 * Link web công khai mà ảnh chia sẻ của CTV in trong QR (`tubutree.com/s/<slug>`, `tubutree.com/san-pham/<slug>?ref=`), tách khỏi
 * `share-poster.ts` (phần vẽ) để bảng chia sẻ nạp sẵn file nhỏ này mà bộ vẽ vẫn nằm ở chunk nạp lười: Rollup gộp chunk dưới 2 KB
 * (`experimentalMinChunkSize` của Mini App), webpack chia theo file.
 */

/** Tên miền web công khai in trong QR (cùng gốc với trang đích link mời `INVITE_LANDING_ORIGIN`). */
export const PUBLIC_WEB_ORIGIN = 'https://tubutree.com';

const REF_CODE = /^[A-Za-z0-9_-]{1,64}$/;

/** Link web công khai cho QR. `path` là đường dẫn web ('/', '/s/<slug>', '/brand/<slug>', '/san-pham/<slug>'). Mã giới thiệu sai khuôn thì bỏ, không đưa chuỗi lạ vào URL. */
export function posterUrl(path: string, ref?: string | null, origin: string = PUBLIC_WEB_ORIGIN): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  const q = ref && REF_CODE.test(ref) ? `${p.includes('?') ? '&' : '?'}ref=${ref}` : '';
  return `${origin.replace(/\/+$/, '')}${p}${q}`;
}

/** Mã giới thiệu của bộ nội dung bán hàng: trường `referralCode` (API mới) hoặc `ref=` trong `shareLink` (API cũ); sai khuôn thì null. */
export function kitReferralCode(kit: { referralCode?: string | null; shareLink: string }): string | null {
  const code = kit.referralCode ?? /[?&]ref=([^&#]+)/.exec(kit.shareLink)?.[1] ?? null;
  return code && REF_CODE.test(code) ? code : null;
}

/** Ảnh gian hàng/trang chủ/thương hiệu (`path` là đường dẫn web cùng tên với route Mini App) hoặc thẻ một sản phẩm của bộ nội dung bán hàng. */
export type PosterInput =
  | { kind: 'store'; title: string; path: string; referralCode?: string | null }
  | {
      kind: 'product';
      name: string;
      slug: string;
      brandName?: string | null;
      priceVnd?: number;
      referralCode?: string | null;
      /** `shareLink` của API cũ (chưa trả `referralCode`): đọc mã giới thiệu từ đây. */
      shareLink?: string;
    };

/** Link web công khai mà QR trỏ tới, kèm mã giới thiệu hợp lệ. Bảng chia sẻ cũng dùng để vẫn hiện QR thường khi không nạp được bộ vẽ. */
export function posterTarget(input: PosterInput, origin: string = PUBLIC_WEB_ORIGIN): { url: string; ref: string | null } {
  if (input.kind === 'store') {
    const ref = input.referralCode && REF_CODE.test(input.referralCode) ? input.referralCode : null;
    return { url: posterUrl(input.path, ref, origin), ref };
  }
  const ref = kitReferralCode({ referralCode: input.referralCode, shareLink: input.shareLink ?? '' });
  return { url: posterUrl(`/san-pham/${encodeURIComponent(input.slug)}`, ref, origin), ref };
}
