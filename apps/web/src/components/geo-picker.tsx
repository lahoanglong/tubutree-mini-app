'use client';

import { useQuery } from '@tanstack/react-query';
import { getProvinces, getCommunes } from '@/lib/geo-client';

/** Giá trị địa giới: tên hiển thị + mã Pancake (gửi khi đặt đơn). Mirror miniapp geo-picker. */
export interface GeoValue {
  province: string;
  provinceCode: string;
  ward: string;
  wardCode: string;
}

export const EMPTY_GEO: GeoValue = { province: '', provinceCode: '', ward: '', wardCode: '' };

/**
 * Picker địa giới 2 cấp Tỉnh → Phường/Xã, danh mục lấy TỪ Pancake (mã "84_VN*" chuẩn
 * → đặt đơn không bị đẩy sai mã vùng). Đổi tỉnh sẽ reset phường.
 */
export function GeoPicker({
  value,
  onChange,
  errorProvince,
  errorWard,
}: {
  value: GeoValue;
  onChange: (v: GeoValue) => void;
  errorProvince?: string;
  errorWard?: string;
}) {
  const provincesQ = useQuery({ queryKey: ['geo-provinces'], queryFn: getProvinces, staleTime: Infinity });
  const communesQ = useQuery({
    queryKey: ['geo-communes', value.provinceCode],
    queryFn: () => getCommunes(value.provinceCode),
    enabled: !!value.provinceCode,
    staleTime: Infinity,
  });

  return (
    <>
      <div>
        <select
          value={value.provinceCode}
          onChange={(e) => {
            const code = e.target.value;
            const name = provincesQ.data?.find((p) => p.code === code)?.name ?? '';
            onChange({ province: name, provinceCode: code, ward: '', wardCode: '' });
          }}
          className={`w-full rounded border px-3 py-2 text-sm ${errorProvince ? 'border-red-400' : 'border-neutral-200'}`}
        >
          <option value="">{provincesQ.isLoading ? 'Đang tải…' : 'Chọn tỉnh/thành'}</option>
          {(provincesQ.data ?? []).map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
        {errorProvince && <p className="mt-0.5 text-xs text-red-600">⚠ {errorProvince}</p>}
      </div>

      <div>
        <select
          value={value.wardCode}
          disabled={!value.provinceCode}
          onChange={(e) => {
            const code = e.target.value;
            const name = communesQ.data?.find((c) => c.code === code)?.name ?? '';
            onChange({ ...value, ward: name, wardCode: code });
          }}
          className={`w-full rounded border px-3 py-2 text-sm disabled:bg-neutral-100 ${
            errorWard ? 'border-red-400' : 'border-neutral-200'
          }`}
        >
          <option value="">
            {!value.provinceCode ? 'Chọn tỉnh/thành trước' : communesQ.isLoading ? 'Đang tải…' : 'Chọn phường/xã'}
          </option>
          {(communesQ.data ?? []).map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        {errorWard && <p className="mt-0.5 text-xs text-red-600">⚠ {errorWard}</p>}
      </div>
    </>
  );
}
