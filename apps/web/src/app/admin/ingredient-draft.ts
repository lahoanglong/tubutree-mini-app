/** Khớp COPY_INGREDIENTS_MAX và COPY_INGREDIENT_NAME_MAX của apps/api (modules/ai-advisor/copy-draft.ts); máy chủ kiểm lại khi lưu. */
export const INGREDIENTS_MAX = 8;
export const INGREDIENT_NAME_MAX = 80;

const OPEN = '([{';
const CLOSE = ')]}';

/**
 * Ô nhập thành phần thành danh sách tên: xuống dòng luôn là ranh giới; dấu phẩy và chấm phẩy chỉ tách khi đứng NGOÀI ngoặc, để cụm
 * "Dầu thực vật (dầu cọ, dầu dừa)" trên nhãn vẫn là một thành phần. Ngoặc mở thiếu không kéo sang dòng sau (mỗi dòng đếm lại từ 0).
 * Gập khoảng trắng, bỏ tên trống và tên trùng (không phân biệt hoa thường, giữ bản đầu).
 */
export function parseIngredientDraft(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  const push = () => {
    parts.push(current);
    current = '';
  };
  for (const ch of text) {
    if (ch === '\n' || ch === '\r') {
      push();
      depth = 0;
    } else if ((ch === ',' || ch === ';') && depth === 0) {
      push();
    } else {
      if (OPEN.includes(ch)) depth += 1;
      else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
      current += ch;
    }
  }
  push();

  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of parts) {
    const name = raw.replace(/\s+/g, ' ').trim();
    const key = name.toLocaleLowerCase('vi');
    if (name === '' || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** Mỗi tên một dòng, để `parseIngredientDraft` đọc lại đúng danh sách (kể cả tên có dấu phẩy trong ngoặc). */
export const ingredientsToText = (names: readonly string[]): string => names.join('\n');
