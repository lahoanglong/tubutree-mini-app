/** Tên ca chuẩn lưu và so trùng: NFC (cùng chữ có dấu gõ hai cách là một), mọi dãy khoảng trắng thành một dấu cách, cắt hai đầu. */
export const normalizeTemplateName = (name: string): string => name.normalize('NFC').replace(/\s+/g, ' ').trim();
