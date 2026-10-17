import type { CSSProperties } from 'react';

/**
 * Trang xin viewport-fit=cover nên iPhone xoay ngang cho nội dung chạy dưới tai thỏ. Padding của <body> không áp vào
 * phần tử fixed, nên các thanh/lớp phủ dính mép tự chừa inset bằng helper này. max() giữ nguyên lề cũ trên máy không có tai thỏ.
 */
export type SafeAreaEdge = 'left' | 'right';

export function safeAreaPad(edge: SafeAreaEdge, base: string): CSSProperties {
  const value = `max(${base}, env(safe-area-inset-${edge}, 0px))`;
  return edge === 'left' ? { paddingLeft: value } : { paddingRight: value };
}

export function safeAreaPadX(base: string): CSSProperties {
  return { ...safeAreaPad('left', base), ...safeAreaPad('right', base) };
}
