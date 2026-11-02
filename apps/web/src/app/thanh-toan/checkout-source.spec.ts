import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// L2: chú thích bố cục và token của trang thanh toán phải khớp mã hiện tại (K2 đã bỏ cột dính và vùng cuộn riêng ở lg).
const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

describe('/thanh-toan: nguồn trang thanh toán', () => {
  it('không còn chú thích cột dính hay khung cuộn đã bỏ', () => {
    const src = read('./page.tsx');
    expect(src).not.toContain('từ lg giữ ở khung tóm tắt dính bên phải');
    expect(src).not.toContain('Con trực tiếp của khung cuộn');
    expect(src).not.toContain('khung tóm tắt cuộn được');
  });

  it.each(['./page.tsx', './invoice-section.tsx'])('%s không dùng lớp primitive stone/forest/clay/sage (accent-, text-, bg-, border-, ring-...)', (file) => {
    expect(read(file)).not.toMatch(/\b(?:accent|text|bg|border|ring|fill|stroke|caret|shadow|from|to|via)-(?:stone|forest|clay|sage)-\d/);
  });
});
