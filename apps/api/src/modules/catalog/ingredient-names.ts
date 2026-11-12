import { foldVietnamese } from './search-text';

/**
 * Tên thành phần thật trong cột `ingredients` (Json). Admin lưu mảng `[{ name }]`, nhưng dữ liệu cũ và nhập tay còn có mảng chuỗi
 * hay một chuỗi tách bằng dấu phẩy/chấm phẩy/xuống dòng (cùng cách `readIngredients` của chữ dự phòng đọc).
 * Tên trống và "[object Object]" (đồng bộ Pancake từng ghi) không phải tên thật nên bị bỏ.
 */
const garbled = (name: string): boolean => name === '' || name.includes('[object Object]');

export function ingredientNames(raw: unknown): string[] {
  const names: string[] = [];
  const add = (v: unknown) => {
    if (typeof v !== 'string') return;
    const name = v.trim();
    if (!garbled(name)) names.push(name);
  };
  if (typeof raw === 'string') {
    for (const part of raw.split(/[,;\n]/)) add(part);
  } else if (Array.isArray(raw)) {
    for (const item of raw) add(typeof item === 'object' && item !== null ? (item as { name?: unknown }).name : item);
  }
  return names;
}

const foldName = (s: string): string => foldVietnamese(s).replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Cột `ingredients` sau khi duyệt bản nháp: giữ NGUYÊN các dòng hiện có (kể cả `percentage`/`benefit` mà trang sản phẩm vẫn vẽ) và chỉ nối thêm
 * tên mới chưa có. Bản nháp chỉ mang tên, nên ghi đè cả cột sẽ xoá phần trăm, lợi ích và thành phần mà AI bỏ sót. Muốn bỏ một thành phần thì sửa ở trang sản phẩm.
 */
export function mergeIngredients(existing: unknown, approved: readonly string[]): Record<string, unknown>[] {
  const kept: Record<string, unknown>[] = [];
  if (Array.isArray(existing)) {
    for (const item of existing) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) kept.push(item as Record<string, unknown>);
      else if (typeof item === 'string' && item.trim() !== '') kept.push({ name: item.trim() });
    }
  } else {
    for (const name of ingredientNames(existing)) kept.push({ name });
  }
  const seen = new Set(ingredientNames(kept).map(foldName));
  for (const name of approved) {
    const key = foldName(name);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    kept.push({ name });
  }
  return kept;
}
