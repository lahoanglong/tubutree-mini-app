import { claimsIn, normalizeCopyText, sanitizeCopyText, withProductCopyFallback } from '@tubutree/shared-types';
import { sortVariationsByPrice } from '../catalog/variation-order';

const MAX_DESCRIPTION_CHARS = 400;
const MAX_INGREDIENTS = 8;
const MAX_VARIANT_LINES = 6;
const MAX_VARIANT_NAME_CHARS = 60;

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

/** Gập khoảng trắng và cắt ở mức vừa đủ cho prompt. KHÔNG giải mã gì thêm: chữ vào đây phải đã qua `normalizeCopyText` đúng một lần (giải mã hai lần biến `&amp;#7919;` thành "ữ" sau bộ chặn). */
function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Chữ lưu HTML (từ trình soạn của admin hay Pancake) chưa qua bộ chặn: chuẩn hoá như trang web hiện chữ (thẻ, thực thể, NBSP, NFD, ký tự rộng 0) rồi cắt cho prompt. */
const plainText = (html: string, max: number): string => clip(normalizeCopyText(html), max);

/**
 * `ingredients` là cột Json: danh sách `{name, ...}` (admin) hoặc chuỗi tách bằng dấu phẩy/chấm phẩy (Pancake). Chỉ lấy tên: phần trăm và công dụng không đưa vào để AI không nhắc lại con số nó không kiểm chứng được.
 * Tên nguồn ngoài (DB) được chuẩn hoá một lần rồi lọc tuyên bố bằng chính bản đó, trước khi cắt còn 8 tên để tên sạch phía sau được lên thay chỗ.
 */
function ingredientNames(raw: unknown): string[] {
  // Chuẩn hoá CẢ chuỗi trước khi tách: dấu ";" của thực thể (`Ch&#7919;a`) sẽ bị tách nhầm làm đôi nếu tách trước, và hai nửa đều qua bộ chặn.
  const names =
    typeof raw === 'string'
      ? normalizeCopyText(raw).split(/[,;\n]/)
      : Array.isArray(raw)
        ? raw.map((i) => (i && typeof i === 'object' && typeof (i as { name?: unknown }).name === 'string' ? normalizeCopyText((i as { name: string }).name) : ''))
        : [];
  // "[object Object]" là tên hỏng do nhập sai từ nguồn ngoài; AI sẽ đọc lại nguyên văn cho khách nếu để lọt vào.
  return names
    .map((n) => clip(n, 80))
    .filter((n) => n !== '' && !n.includes('[object Object]') && claimsIn(n, 'claims').length === 0)
    .slice(0, MAX_INGREDIENTS);
}

/** Tên thành phần cuối cùng của prompt: DB đã chuẩn hoá và lọc ở `ingredientNames`, chữ dự phòng là chữ dựng sẵn đã duyệt (cho phép con số %), nên chỉ gập và cắt, không giải mã thêm. */
const finalIngredientNames = (list: readonly { name?: unknown }[]): string[] =>
  list
    .map((i) => (typeof i.name === 'string' ? clip(i.name, 80) : ''))
    .filter((n) => n !== '' && !n.includes('[object Object]'))
    .slice(0, MAX_INGREDIENTS);

/**
 * Mô tả và thành phần trong DB luôn thắng, từng trường độc lập. Trường nào trống (mô tả rỗng/chỉ thẻ HTML trống, thành phần rỗng) thì bù chữ dự phòng của slug từ
 * `@tubutree/shared-types`, cùng bảng mà trang sản phẩm web và Mini đang hiện, nên AI không nói khác trang sản phẩm. Slug ngoài bảng thì không bù gì (vẫn "chưa có").
 * Thành phần DB được làm sạch trước khi vào hàm bù vì cột là Json tuỳ ý (đối tượng lạ làm `readIngredients` của hàm bù ném lỗi).
 * Chữ bù vẫn đi qua `clip` nên chịu cùng trần ký tự với chữ DB.
 * Chữ DB (Pancake, admin) là nguồn ngoài chưa ai duyệt nên bị bộ chặn tuyên bố bỏ câu y tế/chứng nhận/con số TRƯỚC khi cắt độ dài và TRƯỚC khi bù:
 * mô tả chỉ còn câu cấm thì coi như trống và rơi về chữ dự phòng. Chữ dự phòng đã được duyệt từng câu (chép lại điều bao bì ghi) nên không qua bộ chặn: bộ chặn mức này chặn cả con số %, nên lọc lại sẽ làm mất câu đã duyệt.
 */
export function productFacts(row: FactsRow): ProductFacts {
  const own = ingredientNames(row.ingredients);
  const filled = withProductCopyFallback({
    slug: row.slug,
    description: typeof row.description === 'string' ? sanitizeCopyText(row.description, 'claims').text : '',
    ingredients: own.map((name) => ({ name })),
  });
  return { description: clip(filled.description, MAX_DESCRIPTION_CHARS), ingredients: finalIngredientNames(filled.ingredients) };
}

/** Các dòng thụt vào dưới tên sản phẩm. Không có gì để nói thì ghi rõ "chưa có", để AI trả lời "chưa có thông tin" thay vì đoán. */
export function factLines(facts: ProductFacts): string[] {
  const lines: string[] = [];
  if (facts.description) lines.push(`  Mô tả: ${facts.description}`);
  if (facts.ingredients.length > 0) lines.push(`  Thành phần: ${facts.ingredients.join(', ')}`);
  if (lines.length === 0) lines.push('  (chưa có mô tả hay thành phần chi tiết)');
  return lines;
}

/** `shortDesc` là dữ liệu cửa hàng nên khách vẫn thấy nguyên văn ở thẻ gợi ý; riêng bản đưa vào prompt phải qua cùng bộ chặn với mô tả để AI không nhắc lại lời y tế/chứng nhận. */
export function promptShortDesc(shortDesc: string | null | undefined): string | null {
  if (typeof shortDesc !== 'string') return null;
  const clean = sanitizeCopyText(shortDesc, 'claims').text;
  return clean === '' ? null : clean;
}

/**
 * Dòng "tên quy cách — giá" của các phân loại đang bán, rẻ trước, tối đa 6. Tên trống/toàn khoảng trắng hay "[object Object]" (đồng bộ Pancake từng ghi sai)
 * bị bỏ: AI sẽ đọc lại nguyên văn cho khách. Giá là giá đang bán (`salePrice` nếu có), cùng cách ghi giá ở dòng sản phẩm.
 */
export function variantSpecs(variations: readonly { id: string; sku: string; name?: string | null; retailPrice: number; salePrice: number | null }[] | null | undefined): string[] {
  const lines: string[] = [];
  for (const v of sortVariationsByPrice([...(variations ?? [])])) {
    const name = plainText(typeof v.name === 'string' ? v.name : '', MAX_VARIANT_NAME_CHARS);
    if (name === '' || name.includes('[object Object]')) continue;
    lines.push(`${name} — ${(v.salePrice ?? v.retailPrice).toLocaleString('vi-VN')}đ`);
    if (lines.length === MAX_VARIANT_LINES) break;
  }
  return lines;
}
