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
