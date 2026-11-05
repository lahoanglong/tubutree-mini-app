'use client';

import { useId } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getProvinces, getCommunes } from '@/lib/geo-client';
import { ui } from '@/lib/guest-ui';

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
  const provinceId = useId();
  const wardId = useId();
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
        <label htmlFor={provinceId} className="mb-1 block text-caption font-medium text-stone-700">
          Tỉnh/Thành phố
        </label>
        <select
          id={provinceId}
          aria-required="true"
          aria-invalid={errorProvince ? true : undefined}
          aria-describedby={errorProvince ? `${provinceId}-err` : undefined}
          value={value.provinceCode}
          onChange={(e) => {
            const code = e.target.value;
            const name = provincesQ.data?.find((p) => p.code === code)?.name ?? '';
            onChange({ province: name, provinceCode: code, ward: '', wardCode: '' });
          }}
          className={errorProvince ? ui.fieldError : ui.field}
        >
          <option value="">{provincesQ.isLoading ? 'Đang tải…' : 'Chọn tỉnh/thành'}</option>
          {(provincesQ.data ?? []).map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
        {errorProvince && (
          <p id={`${provinceId}-err`} className="mt-0.5 flex items-start gap-1 text-caption text-danger-fg">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
            {errorProvince}
          </p>
        )}
        {provincesQ.isError && !errorProvince && (
          <LoadFailed what="tỉnh/thành" onRetry={() => void provincesQ.refetch()} />
        )}
      </div>

      <div>
        <label htmlFor={wardId} className="mb-1 block text-caption font-medium text-stone-700">
          Phường/Xã
        </label>
        <select
          id={wardId}
          aria-required="true"
          aria-invalid={errorWard ? true : undefined}
          aria-describedby={errorWard ? `${wardId}-err` : undefined}
          value={value.wardCode}
          disabled={!value.provinceCode}
          onChange={(e) => {
            const code = e.target.value;
            const name = communesQ.data?.find((c) => c.code === code)?.name ?? '';
            onChange({ ...value, ward: name, wardCode: code });
          }}
          className={errorWard ? ui.fieldError : ui.field}
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
        {errorWard && (
          <p id={`${wardId}-err`} className="mt-0.5 flex items-start gap-1 text-caption text-danger-fg">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
            {errorWard}
          </p>
        )}
        {communesQ.isError && !errorWard && (
          <LoadFailed what="phường/xã" onRetry={() => void communesQ.refetch()} />
        )}
      </div>
    </>
  );
}

/** Danh mục lấy từ Pancake có thể lỗi tạm thời: không báo thì ô chọn đứng im ở placeholder và khách bỏ cuộc. */
function LoadFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mt-0.5 flex flex-wrap items-center gap-1 text-caption text-danger-fg">
      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
      <span>Không tải được danh sách {what}.</span>
      <button type="button" onClick={onRetry} className={ui.btnText}>
        Thử lại
      </button>
    </div>
  );
}
