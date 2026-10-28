/**
 * Loài cây mặc định mà máy chủ ghi cho mọi cây mới (khoá lưu trữ, không phải loài khách chọn). Hiện nó như tên thật làm
 * khách tưởng đang trồng đúng giống ấy.
 */
const DEFAULT_TREE_TYPE = 'Cây Dứa Fuwa3e';

export const GENERIC_TREE_TITLE = 'Cây của bạn';

/** Tên hiện trên thẻ vườn: loài đang trồng nếu có, còn lại (trống hoặc giá trị mặc định) thì "Cây của bạn". */
export function treeTitle(treeType: string | null | undefined): string {
  const name = treeType?.trim();
  return !name || name === DEFAULT_TREE_TYPE ? GENERIC_TREE_TITLE : name;
}
