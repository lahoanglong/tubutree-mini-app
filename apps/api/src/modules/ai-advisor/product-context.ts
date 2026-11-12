import { withProductCopyFallback } from '@tubutree/shared-types';

const MAX_DESCRIPTION_CHARS = 400;
const MAX_INGREDIENTS = 8;

/** Chỉ phần dữ liệu thật của sản phẩm mà AI được phép nói tới ngoài tên và giá. */
export interface ProductFacts {
  description: string;
  ingredients: string[];
}

interface FactsRow {
  slug: string;
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

/**
 * Mô tả và thành phần trong DB luôn thắng, từng trường độc lập. Trường nào trống (mô tả rỗng/chỉ thẻ HTML trống, thành phần rỗng) thì bù chữ dự phòng của slug từ
 * `@tubutree/shared-types`, cùng bảng mà trang sản phẩm web và Mini đang hiện, nên AI không nói khác trang sản phẩm. Slug ngoài bảng thì không bù gì (vẫn "chưa có").
 * Thành phần DB được làm sạch trước khi vào hàm bù vì cột là Json tuỳ ý (đối tượng lạ làm `readIngredients` của hàm bù ném lỗi).
 * Chữ bù vẫn đi qua `plainText` nên chịu cùng trần ký tự với chữ DB.
 */
export function productFacts(row: FactsRow): ProductFacts {
  const own = ingredientNames(row.ingredients);
  const filled = withProductCopyFallback({
    slug: row.slug,
    description: typeof row.description === 'string' ? row.description : '',
    ingredients: own.map((name) => ({ name })),
  });
  return { description: plainText(filled.description, MAX_DESCRIPTION_CHARS), ingredients: ingredientNames(filled.ingredients) };
}

/** Các dòng thụt vào dưới tên sản phẩm. Không có gì để nói thì ghi rõ "chưa có", để AI trả lời "chưa có thông tin" thay vì đoán. */
export function factLines(facts: ProductFacts): string[] {
  const lines: string[] = [];
  if (facts.description) lines.push(`  Mô tả: ${facts.description}`);
  if (facts.ingredients.length > 0) lines.push(`  Thành phần: ${facts.ingredients.join(', ')}`);
  if (lines.length === 0) lines.push('  (chưa có mô tả hay thành phần chi tiết)');
  return lines;
}
