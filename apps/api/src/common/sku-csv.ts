export type CsvDelimiter = '\t' | ';' | ',';

/**
 * Tách một dòng "sku,giá trị" dán từ Excel/Google Sheets. Cột tách bằng tab, `;` hoặc `,` (xét từng dòng, bỏ qua ký tự nằm
 * trong ngoặc kép). Ô xuất kiểu CSV chuẩn (`"A2","185,000"`, `""` là một dấu ngoặc) được bỏ ngoặc, để SKU không thành `"A2"`
 * rồi bị coi là không khớp. Ô cắt khoảng trắng hai đầu; ô trống thừa ở cuối dòng (Excel xuất `A1,10,,`) bị bỏ.
 */
export function splitSkuCsvLine(line: string): { delim: CsvDelimiter; cells: string[] } {
  const outside = line.replace(/"(?:[^"]|"")*"/g, '');
  const delim: CsvDelimiter = outside.includes('\t') ? '\t' : outside.includes(';') ? ';' : ',';
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (line[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === delim) {
      cells.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  cells.push(cell.trim());
  while (cells.length > 2 && cells[cells.length - 1] === '') cells.pop();
  return { delim, cells };
}
