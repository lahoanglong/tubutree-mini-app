/**
 * Vi phạm axe `serious`/`critical` có sẵn ở các màn mua sắm (P17b). Mỗi dòng ghi màn, luật và LÝ DO chưa sửa; không có dòng nào tắt luật cho cả màn:
 * chỉ luật nêu tên, ở màn nêu tên, ở nền tảng nêu tên. Vi phạm mới ngoài danh sách làm bài đỏ; sửa xong thì xoá dòng (bài nhắc dòng thừa).
 */
export interface AxeBaselineEntry {
  side: 'miniapp' | 'web';
  screen: string;
  rule: string;
  reason: string;
}

export const AXE_BASELINE: readonly AxeBaselineEntry[] = [];
