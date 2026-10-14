/** Mã địa giới hệ MỚI 2 cấp của Pancake (sau sáp nhập 2025), cả tỉnh lẫn phường/xã: "84_VN79", "84_VN7926743". */
const NEW_GEO_CODE = /^84_VN[0-9A-Za-z_]+$/;

export function isNewGeoCode(code: string | null | undefined): boolean {
  return typeof code === 'string' && NEW_GEO_CODE.test(code);
}
