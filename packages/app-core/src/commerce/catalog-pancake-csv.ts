import { vnDayKey } from '../waste-copy';
import { CATALOG_ISSUE_KINDS, isUnnamedVariation, type AuditProduct, type CatalogAuditResult, type CatalogIssueKind } from './catalog-quality-audit';

/**
 * CSV để ops sửa biến thể trong Pancake: mỗi dòng một biến thể dính lỗi cấp biến thể (giá sai, tồn giả, chưa đặt tên), kể cả biến thể và sản phẩm đang ẩn.
 * Module thuần; web tự tải file. Chuỗi bắt đầu bằng BOM UTF-8 để Excel đọc đúng tiếng Việt, nên nơi tải file KHÔNG được thêm BOM lần nữa.
 */
export const PANCAKE_FIX_CSV_HEADERS = ['pancakeId', 'sku', 'name', 'issueCodes', 'currentStock', 'retailPrice'] as const;

const BOM = '﻿';

const VARIATION_KINDS: readonly CatalogIssueKind[] = CATALOG_ISSUE_KINDS.filter(
  (k) => k === 'invalid_retail_price' || k === 'placeholder_stock' || k === 'unnamed_variation',
);

/** Ký tự mở đầu khiến Excel/Google Sheets coi ô là công thức. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Tên, SKU và mã Pancake do hệ thống ngoài nhập, nên ô mở đầu bằng ký tự công thức được thêm dấu nháy đơn để Excel đọc như chữ (cùng cách
 * `export-csv.ts` của web; app-core không import được từ web). Số hữu hạn ghi thô, không phải công thức nên không thêm dấu nháy: giá `-1` vẫn là số.
 */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  let str = String(value);
  if (FORMULA_START.test(str)) str = `'${str}`;
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/**
 * Chỉ cần `slug`, `name`, `variations` của sản phẩm nên truyền thẳng `AuditProduct[]` hay `CatalogAuditProductDto[]` đều được.
 * Dòng của `result` ghép với sản phẩm theo slug; sản phẩm thiếu trong `products` thì bỏ qua.
 */
export function buildPancakeFixCsv(result: CatalogAuditResult, products: readonly Pick<AuditProduct, 'slug' | 'name' | 'variations'>[]): string {
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const lines: string[] = [PANCAKE_FIX_CSV_HEADERS.join(',')];
  for (const row of result.rows) {
    const product = bySlug.get(row.slug);
    if (!product?.variations) continue;
    const codesByVariation = new Map<string, CatalogIssueKind[]>();
    for (const issue of row.issues) {
      if (!VARIATION_KINDS.includes(issue.kind)) continue;
      for (const id of issue.variationIds ?? []) codesByVariation.set(id, [...(codesByVariation.get(id) ?? []), issue.kind]);
    }
    for (const v of product.variations) {
      const kinds = codesByVariation.get(v.id);
      if (!kinds) continue;
      const codes = VARIATION_KINDS.filter((k) => kinds.includes(k));
      lines.push(
        [cell(v.pancakeId), cell(v.sku), cell(isUnnamedVariation(v) ? product.name : v.name), cell(codes.join('|')), cell(v.stock), cell(v.retailPrice)].join(','),
      );
    }
  }
  return BOM + lines.join('\r\n');
}

/** Tên file gợi ý theo ngày giờ Việt Nam (UTC+7): `tubutree-sua-pancake-20261112.csv`. */
export function pancakeFixCsvFilename(date: Date = new Date()): string {
  return `tubutree-sua-pancake-${vnDayKey(date).replace(/-/g, '')}.csv`;
}
