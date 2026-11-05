/**
 * Ô bắt buộc của màn quản trị chỉ coi là đã nhập khi có ít nhất một ký tự nhìn thấy được. `String.trim` bỏ khoảng trắng nhưng
 * để lại ký tự rộng 0 (U+200B, U+2060, U+FEFF...), nên ô chỉ chứa chúng từng làm nút Tạo/Lưu mở và đẩy lỗi xuống API.
 * Cùng tập ký tự với `trimInvisible` của API (apps/api/src/common/text-trim.ts); phía API vẫn là nơi quyết định cuối cùng.
 */
const INVISIBLE_OR_SPACE = /^[\s­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]*$/;

export const hasVisibleText = (text: string): boolean => !INVISIBLE_OR_SPACE.test(text);
