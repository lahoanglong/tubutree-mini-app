/**
 * Cỡ chữ của số trong ô thống kê trang Cá nhân (Điểm Xanh, Ví Tubu, Mã giảm giá), chọn theo độ dài CẢ chuỗi và bề ngang thật của ô.
 * Ba ô chia đều nên ở 320px mỗi ô chỉ 93px: "1.000 điểm" ở 16px dài ~89px và gãy "điểm" xuống dòng, "10.000.000đ" ở 14px dài
 * ~89px và tràn khỏi ô. Ô rộng hơn (Mini 375–414px, web từ md) thì giữ cỡ lớn, không thu nhỏ khi còn chỗ.
 * Chữ Inter 600 (số tabular) rộng tối đa chừng 0,58em mỗi ký tự, label khít -0,02em còn 0,56em (đo trong trình duyệt, E2E
 * account-stat-320); chọn cỡ lớn nhất mà chuỗi vẫn cách mép ô ít nhất 6px mỗi bên (4px đệm của ô cộng 2px).
 * Ở 320px ra: tới 8 ký tự price-md, 9–10 ký tự price-sm, từ 11 ký tự label.
 */
export type StatValueVariant = 'price-md' | 'price-sm' | 'label';

/** Cỡ chữ (px) của ba biến thể, khớp `--type-price-md-size`, `--type-price-sm-size`, `--type-label-size` ở tokens.css. */
export const STAT_VALUE_SIZE_PX: Record<StatValueVariant, number> = { 'price-md': 16, 'price-sm': 14, label: 12 };
const EM_PER_CHAR: Record<StatValueVariant, number> = { 'price-md': 0.58, 'price-sm': 0.58, label: 0.56 };
const EDGE_GAP = 6;
/** Bề ngang một ô ở màn 320px (đo E2E). Chưa đo được ô (máy chủ dựng trang, lần vẽ đầu, jsdom) thì chọn cỡ theo ô hẹp nhất này. */
export const STAT_NARROW_CELL_PX = 93.33;

export function statValueVariant(value: string, cellWidth?: number): StatValueVariant {
  const length = Array.from(value.trim()).length;
  const room = (cellWidth && cellWidth > 0 ? cellWidth : STAT_NARROW_CELL_PX) - 2 * EDGE_GAP;
  for (const variant of ['price-md', 'price-sm'] as const) {
    if (length * EM_PER_CHAR[variant] * STAT_VALUE_SIZE_PX[variant] <= room) return variant;
  }
  return 'label';
}

/** Cách hiện số trong ô: cỡ chữ và khoảng chữ. */
export interface StatValueLook {
  variant: StatValueVariant;
  letterSpacing?: string;
}

/**
 * Các bước từ lớn tới nhỏ. Cỡ label khít chữ lại 0,02em (~3px với 12 ký tự); bước cuối khít 0,04em cho số rất dài ở ô hẹp trên máy
 * dựng chữ rộng (Chrome Linux, ~0,6em mỗi ký tự). Bước cuối vẫn chưa vừa (ví từ một tỷ) thì số xuống dòng trong ô.
 */
export const STAT_VALUE_LOOKS: readonly StatValueLook[] = [
  { variant: 'price-md' },
  { variant: 'price-sm' },
  { variant: 'label', letterSpacing: '-0.02em' },
  { variant: 'label', letterSpacing: '-0.04em' },
];

/**
 * Bước bắt đầu (chỉ số trong STAT_VALUE_LOOKS) ước theo độ dài và bề ngang ô. Ước lượng theo chữ của macOS nên có máy dựng rộng hơn:
 * app đo chữ thật (không xuống dòng) trước khi vẽ và lùi bước tới khi `statValueFits`.
 */
export function statValueStart(value: string, cellWidth?: number): number {
  return STAT_VALUE_LOOKS.findIndex((look) => look.variant === statValueVariant(value, cellWidth));
}

/** Chữ rộng `textWidth` (đo trên một dòng) cách mép ô bề ngang `cellWidth` ít nhất 6px mỗi bên. */
export function statValueFits(textWidth: number, cellWidth: number): boolean {
  return textWidth <= cellWidth - 2 * EDGE_GAP;
}

/**
 * Chiều cao dòng cố định bằng dòng price-md (22px) cho mọi cỡ: số nhỏ hơn vẫn cùng hàng với ô bên cạnh, nhãn dưới số thẳng hàng.
 * Kèm `overflow-wrap: anywhere` ở app để số quá dài (ví từ một tỷ) xuống dòng trong ô thay vì tràn ngang trang.
 */
export const STAT_VALUE_LINE_HEIGHT = 'calc(var(--type-price-md-size) * var(--type-price-md-lh))';
