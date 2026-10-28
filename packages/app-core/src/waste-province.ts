// Bản sao của packages/shared-types/src/waste-province.ts (API dùng bản kia): shared-types phát hành CJS nên một import giá trị từ nó
// kéo cả thư viện vào bundle web (+5 KB First Load ở /doi-rac/tao).
export const provinceKey = (code: string): string => /^84_VN(\d+)$/.exec(code)?.[1] ?? code;

export const sameProvince = (a: string, b: string): boolean => provinceKey(a) === provinceKey(b);
