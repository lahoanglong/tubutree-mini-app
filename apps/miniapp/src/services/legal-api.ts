import { api } from './api';

export type LegalSlug = 'dieu-khoan' | 'bao-mat' | 'doi-tra' | 'van-chuyen';

/** Nội dung đã duyệt do admin nhập (cùng nguồn với web /chinh-sach/<loại>); null khi chưa nhập. */
export async function fetchLegalDoc(slug: LegalSlug): Promise<{ content: string | null }> {
  const { data } = await api.get<{ content?: unknown }>(`/config/legal/${slug}`);
  return { content: typeof data?.content === 'string' && data.content.trim() !== '' ? data.content : null };
}
