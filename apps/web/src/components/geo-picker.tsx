'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getProvinces, getCommunes } from '@/lib/geo-client';
import { ui } from '@/lib/guest-ui';
import { AddressLocationSheet } from '@/components/address-location-sheet';

/** Giá trị địa giới: tên hiển thị + mã Pancake (gửi khi đặt đơn). Mirror miniapp geo-picker. */
export interface GeoValue {
  province: string;
  provinceCode: string;
  ward: string;
  wardCode: string;
}

export const EMPTY_GEO: GeoValue = { province: '', provinceCode: '', ward: '', wardCode: '' };

const TRIGGER = 'flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed';

/**
 * Picker địa giới 2 cấp Tỉnh → Phường/Xã, danh mục lấy TỪ Pancake (mã "84_VN*" chuẩn
 * → đặt đơn không bị đẩy sai mã vùng). Đổi tỉnh sẽ reset phường. Mỗi cấp là một nút mở `AddressLocationSheet`
 * (tìm không dấu); chọn tỉnh xong sheet Phường/Xã tự mở tiếp để khách khỏi bấm thêm một lần.
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
  const [open, setOpen] = useState<'province' | 'ward' | null>(null);
  const wardTrigger = useRef<HTMLButtonElement>(null);
  const prevOpen = useRef(open);
  useEffect(() => {
    // Sheet Phường/Xã mở từ sheet Tỉnh (đã gỡ khỏi DOM) nên bộ khôi phục focus của sheet không có nút để trả về: trả về ô Phường/Xã.
    if (prevOpen.current === 'ward' && open === null) wardTrigger.current?.focus();
    prevOpen.current = open;
  }, [open]);
  const provincesQ = useQuery({ queryKey: ['geo-provinces'], queryFn: getProvinces, staleTime: Infinity });
  const communesQ = useQuery({
    queryKey: ['geo-communes', value.provinceCode],
    queryFn: () => getCommunes(value.provinceCode),
    enabled: !!value.provinceCode,
    staleTime: Infinity,
  });
  const provinceName = provincesQ.data?.find((p) => p.code === value.provinceCode)?.name ?? value.province;
  const wardName = communesQ.data?.find((c) => c.code === value.wardCode)?.name ?? value.ward;
  const status = (q: { isLoading: boolean; isError: boolean }) => (q.isError ? 'error' : q.isLoading ? 'loading' : 'ready');

  return (
    <>
      <div>
        <label htmlFor={provinceId} className="mb-1 block text-field-label text-stone-700">
          Tỉnh/Thành phố
        </label>
        <button
          id={provinceId}
          type="button"
          role="combobox"
          aria-haspopup="dialog"
          aria-expanded={open === 'province'}
          aria-controls={`${provinceId}-list`}
          aria-required="true"
          aria-invalid={errorProvince ? true : undefined}
          aria-describedby={errorProvince ? `${provinceId}-err` : undefined}
          data-value={value.provinceCode}
          onClick={() => setOpen('province')}
          className={`${errorProvince ? ui.fieldError : ui.field} ${TRIGGER}`}
        >
          <span className={`min-w-0 truncate ${provinceName ? '' : 'text-stone-600'}`}>
            {provinceName || (provincesQ.isLoading ? 'Đang tải…' : 'Chọn tỉnh/thành')}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-stone-600" aria-hidden />
        </button>
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
        <label htmlFor={wardId} className="mb-1 block text-field-label text-stone-700">
          Phường/Xã
        </label>
        <button
          ref={wardTrigger}
          id={wardId}
          type="button"
          role="combobox"
          aria-haspopup="dialog"
          aria-expanded={open === 'ward'}
          aria-controls={`${wardId}-list`}
          aria-required="true"
          aria-invalid={errorWard ? true : undefined}
          aria-describedby={errorWard ? `${wardId}-err` : undefined}
          data-value={value.wardCode}
          disabled={!value.provinceCode}
          onClick={() => setOpen('ward')}
          className={`${errorWard ? ui.fieldError : ui.field} ${TRIGGER}`}
        >
          <span className={`min-w-0 truncate ${wardName ? '' : 'text-stone-600'}`}>
            {wardName || (!value.provinceCode ? 'Chọn tỉnh/thành trước' : communesQ.isLoading ? 'Đang tải…' : 'Chọn phường/xã')}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-stone-600" aria-hidden />
        </button>
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

      <AddressLocationSheet
        open={open === 'province'}
        onClose={() => setOpen((cur) => (cur === 'province' ? null : cur))}
        listId={`${provinceId}-list`}
        title="Tỉnh/Thành phố"
        options={provincesQ.data ?? []}
        value={value.provinceCode}
        status={status(provincesQ)}
        onRetry={() => void provincesQ.refetch()}
        onSelect={(o) => {
          if (o.code === value.provinceCode) return;
          onChange({ province: o.name, provinceCode: o.code, ward: '', wardCode: '' });
          // Sheet tỉnh gọi onClose ngay sau onSelect; onClose chỉ đóng khi vẫn đang ở bước tỉnh nên bước Phường/Xã giữ nguyên.
          setOpen('ward');
        }}
      />
      <AddressLocationSheet
        open={open === 'ward'}
        onClose={() => setOpen((cur) => (cur === 'ward' ? null : cur))}
        listId={`${wardId}-list`}
        title="Phường/Xã"
        options={communesQ.data ?? []}
        value={value.wardCode}
        status={status(communesQ)}
        onRetry={() => void communesQ.refetch()}
        onSelect={(o) => onChange({ ...value, ward: o.name, wardCode: o.code })}
      />
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
