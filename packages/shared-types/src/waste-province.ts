/**
 * Địa chỉ của khách lưu mã tỉnh dạng "84_VN79" (bộ chọn địa chỉ), còn điểm nhận và bảng phí có thể nhập "79". Hai dạng là cùng một
 * tỉnh, nên so bằng phần số cuối; mã không theo dạng nào thì so nguyên chuỗi.
 */
export const provinceKey = (code: string): string => /^84_VN(\d+)$/.exec(code)?.[1] ?? code;

export const sameProvince = (a: string, b: string): boolean => provinceKey(a) === provinceKey(b);
