import { BadRequestException } from '@nestjs/common';
import { splitSkuCsvLine } from '../../common/sku-csv';
import { HEADER_SKU_CELLS, parseWholeNumber } from './dealer-price-import';

export type SoldExternalCsvRow = { line: number; sku: string; count: number | null; problem: string | null };

/**
 * CSV "sku,số đã bán" (gom từ sàn ngoài) dán từ Excel, tách cột như CSV giá sỉ. Số đọc chặt như giá sỉ: `1.250` là 1250 chứ
 * không phải 1, `1.25` là lỗi dòng. 0 hợp lệ (đặt lại số đã bán ngoài). Dòng tiêu đề đầu tiên bị bỏ.
 */
export function parseSoldExternalCsv(csv: string): SoldExternalCsvRow[] {
  const rows: SoldExternalCsvRow[] = [];
  let seenData = false;
  csv.split(/\r?\n/).forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) return;
    const { delim, cells } = splitSkuCsvLine(line);
    const sku = cells[0] ?? '';
    const isFirst = !seenData;
    seenData = true;
    if (isFirst && HEADER_SKU_CELLS.has(sku.toLowerCase()) && !/^\d/.test(cells[1] ?? '')) return;

    const row: SoldExternalCsvRow = { line: idx + 1, sku, count: null, problem: null };
    if (!sku) row.problem = 'thiếu SKU ở cột đầu';
    else if (cells.length < 2 || cells[1] === '') row.problem = 'thiếu cột số đã bán (dạng "sku,1250")';
    else {
      const count = parseWholeNumber(cells.slice(1).join(delim));
      if (count !== null) row.count = count;
      else row.problem = cells.length > 2 && delim !== ',' ? 'thừa cột — mỗi dòng chỉ gồm "sku,số"' : 'số đã bán không đọc được — ghi số nguyên ≥ 0, vd 1250 hoặc 1.250';
    }
    rows.push(row);
  });
  return rows;
}

/** Còn dòng lỗi thì 400 và không ghi dòng nào, như nhập giá sỉ — không bỏ im lặng một dòng có dữ liệu. */
export function soldExternalRowsOrThrow(csv: string): { sku: string; count: number }[] {
  const rows = parseSoldExternalCsv(csv);
  const bad = rows.filter((r) => r.problem !== null);
  if (bad.length > 0) {
    const shown = bad.slice(0, 10).map((r) => `dòng ${r.line}${r.sku ? ` (${r.sku})` : ''}: ${r.problem}`);
    throw new BadRequestException(
      `Có ${bad.length} dòng lỗi — ${shown.join('; ')}${bad.length > shown.length ? '; …' : ''}. Chưa ghi dòng nào.`,
    );
  }
  return rows.map((r) => ({ sku: r.sku, count: r.count as number }));
}
