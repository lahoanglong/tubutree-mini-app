export interface MiniappRedirect {
  source: string;
  destination: string;
  /** false (307) cho mọi đường, trừ các đường trùng URL WooCommerce cũ (`MINIAPP_PERMANENT_SOURCES`) khai `statusCode: 301` thay vì `permanent`. */
  permanent?: false;
  statusCode?: 301;
}
export const MINIAPP_PERMANENT_SOURCES: readonly string[];
export function buildMiniappRedirects(
  groups: ReadonlyArray<{ items: ReadonlyArray<{ miniapp: string; web?: string }> }>,
): MiniappRedirect[];
