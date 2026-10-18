/** Trạng thái rỗng gọn bên trong sheet/thẻ (không phải trang công khai). */
export function EmptyStateInline({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-stone-600">{text}</p>;
}
