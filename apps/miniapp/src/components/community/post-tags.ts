import { foldVietnamese } from '../../utils/vn-fold';

interface HashTag {
  slug: string;
  name: string;
}
interface TaggedProduct {
  slug: string;
  name: string;
}

/** Các từ đã bỏ dấu, viết thường ("Nước rửa-chén" → nuoc, rua, chen). So khớp theo TỪ để không khớp vắt qua ranh giới từ. */
const words = (s: string) => foldVietnamese(s).split(/[^a-z0-9]+/).filter(Boolean);

/** Hashtag ngắn hơn ngưỡng này chỉ khớp khi trùng hẳn: "chén" là một đoạn của "Nước rửa chén", không phải cùng một thứ. */
const MIN_PREFIX_LENGTH = 6;

/**
 * Hashtag nhắc đúng sản phẩm: trùng hẳn tên/slug (không phân biệt dấu cách, gạch nối), hoặc là phần ĐẦU của tên gọi theo
 * nguyên từ ("Nước rửa chén" của "Nước rửa chén sinh học" là cách gọi tắt của chính sản phẩm). Đoạn giữa/cuối ("Sinh học")
 * hay đoạn vắt qua ranh giới từ ("Thương" trong "giặt hương") là chủ đề riêng, giữ lại.
 */
function namesProduct(tagWords: readonly string[], productWords: readonly string[]): boolean {
  if (tagWords.length === 0 || tagWords.length > productWords.length) return false;
  const tagKey = tagWords.join('');
  if (tagKey === productWords.join('')) return true;
  return tagKey.length >= MIN_PREFIX_LENGTH && tagWords.every((w, i) => w === productWords[i]);
}

/**
 * Bỏ hashtag nhắc đúng sản phẩm đã gắn thẻ — thẻ sản phẩm đã nói điều đó, thêm chip nữa chỉ tốn chỗ ở thẻ bài.
 */
export function dedupeTagsAgainstProducts<T extends HashTag>(tags: readonly T[], products: readonly TaggedProduct[]): T[] {
  if (products.length === 0) return [...tags];
  const productForms = products.flatMap((p) => [words(p.name), words(p.slug)]);
  return tags.filter((t) => {
    const forms = [words(t.name), words(t.slug)];
    return !forms.some((f) => productForms.some((pf) => namesProduct(f, pf)));
  });
}
