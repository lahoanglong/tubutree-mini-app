import { trimInvisible } from '../../../common/text-trim';

/** Tên ca chuẩn lưu và so trùng: NFC (cùng chữ có dấu gõ hai cách là một), mọi dãy khoảng trắng thành một dấu cách, cắt hai đầu (kể cả ký tự vô hình U+200B...). */
export const normalizeTemplateName = (name: string): string => trimInvisible(name.normalize('NFC').replace(/\s+/g, ' '));
