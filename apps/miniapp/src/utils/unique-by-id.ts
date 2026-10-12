/**
 * Bỏ dòng trùng `id`, giữ lần xuất hiện đầu. Danh sách nối từ nhiều trang theo SỐ TRANG (page/limit) bị lệch khi dữ liệu
 * đổi giữa hai lần tải (giao dịch mới chen vào, bán chạy xếp lại): dòng cuối trang 1 lặp lại ở đầu trang 2. Không bỏ thì
 * khách thấy một dòng hai lần và React báo "two children with the same key".
 */
export function uniqueById<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}
