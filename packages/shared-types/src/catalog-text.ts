/**
 * Hai hàm nhỏ dùng chung cho chữ catalog (kịch bản câu chuyện, chữ dự phòng, kiểm tra chất lượng catalog). Tách riêng để module chỉ cần slug hay kiểm
 * "mô tả trống" không phải nạp cả bảng kịch bản hay bảng chữ dự phòng.
 */

/** Slug đồng bộ Pancake trên PROD có hậu tố băm 6–8 ký tự hex ở cuối; chuẩn hoá rồi bỏ hậu tố để khớp slug gốc. */
export const baseSlug = (slug: string): string =>
  slug
    .trim()
    .toLowerCase()
    .replace(/-[0-9a-f]{6,8}$/i, '');

/**
 * Mô tả chưa điền theo kiểu Pancake: rỗng, khoảng trắng, thẻ HTML trống (`<p></p>`, `<br/>`) hoặc chỉ có khoảng trắng viết bằng thực thể (`&nbsp;`, `&#160;`, `&#xa0;`)
 * hay ký tự rộng 0. `String.trim` bỏ NBSP và BOM nhưng để lại U+200B-200D, mà trang web vẽ chúng ra như trống.
 */
export const isBlankHtmlText = (v: string | null | undefined): boolean =>
  !v || v.replace(/<[^>]*>|&nbsp;|&#0*160;|&#x0*a0;|[\u00a0\u200b-\u200d\ufeff]/gi, ' ').trim() === '';
