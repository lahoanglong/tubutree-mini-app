/** Từ khoá một dải dài không dấu cách (tối đa 100 ký tự) tràn khung 375px ở tiêu đề "Không tìm thấy": chèn điểm ngắt vô hình để xuống dòng được. */
export function softBreakLongWords(q: string): string {
  return q.replace(/\S{14,}/g, (w) => {
    // Cắt theo cụm grapheme (emoji ZWJ, chữ + dấu NFD không bị tách); runtime thiếu Intl.Segmenter thì lùi về điểm mã.
    const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: 'grapheme' }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
    const units = Seg ? Array.from(new Seg('vi', { granularity: 'grapheme' }).segment(w), (x) => x.segment) : Array.from(w);
    return units.map((u, i) => ((i + 1) % 12 === 0 && i + 1 < units.length ? `${u}\u200B` : u)).join('');
  });
}
