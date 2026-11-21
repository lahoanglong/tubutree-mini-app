import type { CSSProperties, HTMLAttributes } from 'react';

/** Bậc khoảng cách 0–10, mỗi bậc 4px (đúng thang của zmp-ui Box mà component này thay). */
type Space = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
const SPACE_KEYS = ['m', 'p', 'mt', 'ml', 'mb', 'mr', 'mx', 'my', 'pt', 'pl', 'pb', 'pr', 'px', 'py'] as const;
type SpaceKey = (typeof SPACE_KEYS)[number];

export interface BoxProps extends HTMLAttributes<HTMLDivElement>, Partial<Record<SpaceKey, Space>> {
  /** `display: flex`. */
  flex?: boolean;
  /** Đặt hướng cũng bật `display: flex` (như zmp-ui). */
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  alignItems?: 'flex-start' | 'flex-end' | 'stretch' | 'baseline' | 'center';
  justifyContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
}

type Sides = [top: number | undefined, right: number | undefined, bottom: number | undefined, left: number | undefined];

/** Thuộc tính viết đủ theo thứ tự trên, phải, dưới, trái (cùng thứ tự với `Sides`). */
const LONGHANDS = {
  margin: ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'],
  padding: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
} as const;

/**
 * Khoảng cách của zmp-ui Box tính lại thành style inline, GIỮ cả thứ tự đè nhau của zaui.css: lớp sắp theo bậc (0 → 10) rồi theo thuộc tính
 * (m, p, mt, ml, mb, mr, mx, my, pt, pl, pb, pr, px, py), nên `p={3} pt={2}` ra đệm trên 12px (p-3 đứng sau pt-2 trong tệp), không phải 8px.
 */
export function boxSpacing(props: Partial<Record<SpaceKey, number>>): CSSProperties {
  const margin: Sides = [undefined, undefined, undefined, undefined];
  const padding: Sides = [undefined, undefined, undefined, undefined];
  const sides: Record<string, number[]> = { '': [0, 1, 2, 3], t: [0], l: [3], b: [2], r: [1], x: [1, 3], y: [0, 2] };
  for (let level = 0; level <= 10; level++) {
    for (const key of SPACE_KEYS) {
      if (props[key] !== level) continue;
      const target = key[0] === 'm' ? margin : padding;
      for (const i of sides[key.slice(1)]!) target[i] = level * 4;
    }
  }
  const style: CSSProperties = {};
  LONGHANDS.margin.forEach((prop, i) => {
    if (margin[i] !== undefined) style[prop] = margin[i];
  });
  LONGHANDS.padding.forEach((prop, i) => {
    if (padding[i] !== undefined) style[prop] = padding[i];
  });
  return style;
}

/** Khung `<div>` có khoảng cách theo bậc 4px và flex, thay `Box` của zmp-ui (bản build bỏ được ~8 KB CSS Box của zaui.css, xem build-zaui-prune.ts). */
export function Box({ flex, flexDirection, alignItems, justifyContent, style, m, p, mt, ml, mb, mr, mx, my, pt, pl, pb, pr, px, py, ...rest }: BoxProps) {
  const spacing = boxSpacing({ m, p, mt, ml, mb, mr, mx, my, pt, pl, pb, pr, px, py });
  // style inline của nơi gọi luôn thắng lớp của zmp-ui; bỏ cạnh lẻ khi nơi gọi đặt cả cụm (`padding`, `margin`) để React không trộn viết tắt với viết đủ.
  for (const group of ['margin', 'padding'] as const) {
    if (style?.[group] === undefined) continue;
    for (const prop of LONGHANDS[group]) delete spacing[prop];
  }
  return (
    <div
      {...rest}
      style={{
        ...(flex || flexDirection ? { display: 'flex' } : null),
        ...(flexDirection ? { flexDirection } : null),
        ...(alignItems ? { alignItems } : null),
        ...(justifyContent ? { justifyContent } : null),
        ...spacing,
        ...style,
      }}
    />
  );
}
