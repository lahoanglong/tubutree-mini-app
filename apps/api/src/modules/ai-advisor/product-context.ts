const MAX_DESCRIPTION_CHARS = 400;
const MAX_INGREDIENTS = 8;

/** Chỉ phần dữ liệu thật của sản phẩm mà AI được phép nói tới ngoài tên và giá. */
export interface ProductFacts {
  description: string;
  ingredients: string[];
}

interface FactsRow {
  description?: string | null;
  ingredients?: unknown;
}

/** Mô tả lưu HTML (từ trình soạn của admin hay Pancake): bỏ thẻ và thực thể rồi gập khoảng trắng, cắt ở mức vừa đủ cho prompt. */
function plainText(html: string, max: number): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** `ingredients` là cột Json: danh sách `{name, ...}` (admin) hoặc chuỗi tách bằng dấu phẩy/chấm phẩy (Pancake). Chỉ lấy tên: phần trăm và công dụng không đưa vào để AI không nhắc lại con số nó không kiểm chứng được. */
function ingredientNames(raw: unknown): string[] {
  const names =
    typeof raw === 'string'
      ? raw.split(/[,;\n]/)
      : Array.isArray(raw)
        ? raw.map((i) => (i && typeof i === 'object' && typeof (i as { name?: unknown }).name === 'string' ? (i as { name: string }).name : ''))
        : [];
  // "[object Object]" là tên hỏng do nhập sai từ nguồn ngoài; AI sẽ đọc lại nguyên văn cho khách nếu để lọt vào.
  return names.map((n) => plainText(n, 80)).filter((n) => n !== '' && !n.includes('[object Object]')).slice(0, MAX_INGREDIENTS);
}

export function productFacts(row: FactsRow): ProductFacts {
  return { description: typeof row.description === 'string' ? plainText(row.description, MAX_DESCRIPTION_CHARS) : '', ingredients: ingredientNames(row.ingredients) };
}

/** Các dòng thụt vào dưới tên sản phẩm. Không có gì để nói thì ghi rõ "chưa có", để AI trả lời "chưa có thông tin" thay vì đoán. */
export function factLines(facts: ProductFacts): string[] {
  const lines: string[] = [];
  if (facts.description) lines.push(`  Mô tả: ${facts.description}`);
  if (facts.ingredients.length > 0) lines.push(`  Thành phần: ${facts.ingredients.join(', ')}`);
  if (lines.length === 0) lines.push('  (chưa có mô tả hay thành phần chi tiết)');
  return lines;
}
