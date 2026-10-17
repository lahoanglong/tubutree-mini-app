import { foldVietnamese } from '../../utils/vn-fold';

interface HashTag {
  slug: string;
  name: string;
}
interface TaggedProduct {
  slug: string;
  name: string;
}

/** Chữ so khớp: bỏ dấu, hoa/thường, dấu cách và ký tự lạ ("Nước rửa-chén" = "nuoc rua chen"). */
const key = (s: string) => foldVietnamese(s).replace(/[^a-z0-9]/g, '');

/** Hashtag ngắn hơn ngưỡng này chỉ khớp khi trùng hẳn: "chén" là một đoạn của "Nước rửa chén", không phải cùng một thứ. */
const MIN_CONTAINED_LENGTH = 6;

/**
 * Bỏ hashtag nhắc đúng sản phẩm đã gắn thẻ (trùng tên, trùng slug, hoặc nằm trọn trong tên sản phẩm) — thẻ sản phẩm đã
 * nói điều đó, thêm chip nữa chỉ tốn chỗ ở thẻ bài.
 */
export function dedupeTagsAgainstProducts<T extends HashTag>(tags: readonly T[], products: readonly TaggedProduct[]): T[] {
  if (products.length === 0) return [...tags];
  const names = products.map((p) => key(p.name));
  const slugs = products.map((p) => key(p.slug));
  return tags.filter((t) => {
    const forms = [key(t.name), key(t.slug)].filter((k) => k.length > 0);
    return !forms.some(
      (f) => slugs.includes(f) || names.some((n) => n === f || (f.length >= MIN_CONTAINED_LENGTH && n.includes(f))),
    );
  });
}
