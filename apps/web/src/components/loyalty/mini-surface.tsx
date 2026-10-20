import { ui } from '@/lib/guest-ui';

/** Thẻ như `Card` raised của Mini App ở điện thoại (trắng, không viền, chỉ đổ bóng); từ md giữ viền của giao diện máy tính. */
export const miniSurface = 'rounded-card shadow-card md:border md:border-stone-200';
export const miniCard = `${miniSurface} bg-stone-0`;

/** Thẻ viền như `Card` outline của Mini App ở điện thoại (viền mảnh, không bóng); từ md giữ bóng của giao diện máy tính. */
export const miniOutline = 'rounded-card border border-stone-200 bg-stone-0 shadow-card max-md:shadow-none';

/** Khối trắng tràn ngang không viền không bo như bài viết của Mini App ở điện thoại; thêm sau lớp thẻ (`ui.card`) để ghi đè. Cha có `px-4`. */
export const miniBleed = 'max-md:-mx-4 max-md:rounded-none max-md:border-0 max-md:shadow-none';

/** Tiêu đề khối cỡ title-sm như `Heading` của Mini App ở điện thoại. */
export const miniSectionTitle = 'max-md:text-[length:var(--type-title-sm-size)] max-md:leading-[var(--type-title-sm-lh)]';

/** Nút phụ như nút secondary ZaUI của Mini App ở điện thoại (nền xanh nhạt, không viền, chữ brand); từ md giữ nút viền. */
export const miniBtnSecondary = `${ui.btnSecondary} max-md:border-transparent max-md:bg-forest-50 max-md:text-forest-700 max-md:hover:bg-forest-100 max-md:disabled:bg-stone-200 max-md:disabled:text-stone-400`;
