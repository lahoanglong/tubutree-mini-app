import { useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, TriangleAlert } from 'lucide-react';
import { getProvinces, getCommunes, type GeoOption } from '../services/geo-api';
import { includesFolded } from '../utils/vn-fold';
import { vi } from '../i18n/vi';
import { BottomSheet } from './ui/bottom-sheet';
import { Icon } from './ui/icon';
import { SearchField } from './ui/search-field';
import { Text } from './ui/text';

/** Giá trị địa giới: tên hiển thị + mã Pancake (gửi khi đặt đơn). */
export interface GeoValue {
  province: string;
  provinceCode: string;
  ward: string;
  wardCode: string;
}

export const EMPTY_GEO: GeoValue = { province: '', provinceCode: '', ward: '', wardCode: '' };

/** Lọc không dấu, không phân biệt hoa/thường; ô tìm trống giữ nguyên toàn bộ danh sách. */
export function filterGeoOptions(options: readonly GeoOption[], query: string): GeoOption[] {
  return query.trim() ? options.filter((o) => includesFolded(o.name, query)) : [...options];
}

const RETRY_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 44,
  marginTop: 2,
  padding: 0,
  border: 'none',
  background: 'none',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};

/**
 * Picker địa giới 2 cấp Tỉnh → Phường/Xã, danh mục lấy TỪ Pancake (mã "84_VN*" chuẩn
 * → đặt đơn không lỗi). Đổi tỉnh sẽ reset phường.
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
        <GeoSelect
          label="Tỉnh/Thành phố"
          placeholder={
            provincesQ.isLoading ? 'Đang tải…' : provincesQ.isError ? vi.errors.loadFailed : 'Chọn tỉnh/thành'
          }
          options={provincesQ.data ?? []}
          value={value.provinceCode}
          invalid={!!errorProvince}
          onSelect={(code) => {
            const name = provincesQ.data?.find((p) => p.code === code)?.name ?? '';
            onChange({ province: name, provinceCode: code, ward: '', wardCode: '' });
          }}
        />
        {errorProvince && <ErrText>{errorProvince}</ErrText>}
        {/* API lỗi thì Select sẽ im lặng mãi ở placeholder nếu không có dòng này — cho user biết + retry */}
        {provincesQ.isError && !errorProvince && (
          <button type="button" onClick={() => void provincesQ.refetch()} style={RETRY_STYLE}>
            <Icon icon={TriangleAlert} size="sm" tone="danger" />
            <Text variant="caption" tone="danger">
              {vi.errors.loadFailed} · {vi.common.retry}
            </Text>
          </button>
        )}
      </div>

      <div>
        <GeoSelect
          label="Phường/Xã"
          placeholder={
            !value.provinceCode
              ? 'Chọn tỉnh/thành trước'
              : communesQ.isLoading
                ? 'Đang tải…'
                : communesQ.isError
                  ? vi.errors.loadFailed
                  : 'Chọn phường/xã'
          }
          options={communesQ.data ?? []}
          value={value.wardCode}
          invalid={!!errorWard}
          disabled={!value.provinceCode}
          onSelect={(code) => {
            const name = communesQ.data?.find((c) => c.code === code)?.name ?? '';
            onChange({ ...value, ward: name, wardCode: code });
          }}
        />
        {errorWard && <ErrText>{errorWard}</ErrText>}
        {communesQ.isError && !errorWard && (
          <button type="button" onClick={() => void communesQ.refetch()} style={RETRY_STYLE}>
            <Icon icon={TriangleAlert} size="sm" tone="danger" />
            <Text variant="caption" tone="danger">
              {vi.errors.loadFailed} · {vi.common.retry}
            </Text>
          </button>
        )}
      </div>
    </>
  );
}

/** Ô chọn mở bảng có ô tìm không dấu — danh sách phường của thành phố lớn dài hàng trăm mục. */
function GeoSelect({
  label,
  placeholder,
  options,
  value,
  invalid,
  disabled,
  onSelect,
}: {
  label: string;
  placeholder: string;
  options: readonly GeoOption[];
  value: string;
  invalid: boolean;
  disabled?: boolean;
  onSelect: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.code === value);
  const shown = filterGeoOptions(options, query);

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const pick = (code: string) => {
    onSelect(code);
    close();
  };

  return (
    <>
      <Text variant="caption" tone="secondary" as="div" style={{ marginBottom: 4 }}>
        {label}
      </Text>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          width: '100%',
          minHeight: 44,
          padding: '0 12px',
          boxSizing: 'border-box',
          font: 'inherit',
          textAlign: 'left',
          background: 'var(--color-bg-surface)',
          border: `1px solid ${invalid ? 'var(--color-text-danger)' : 'var(--color-border-default)'}`,
          borderRadius: 'var(--radius-control)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <Text variant="body-md" tone={selected ? 'primary' : 'tertiary'}>
          {selected?.name ?? placeholder}
        </Text>
        <Icon icon={ChevronDown} size="sm" tone="muted" />
      </button>
      <BottomSheet open={open} onClose={close} title={label} size="full">
        <SearchField
          value={query}
          onChange={setQuery}
          onSubmit={() => {
            if (shown.length === 1) pick(shown[0]!.code);
          }}
          label={`Tìm ${label.toLowerCase()}`}
          clearLabel="Xoá từ khoá"
          placeholder="Tìm theo tên, không cần gõ dấu"
        />
        <div
          role="listbox"
          aria-label={label}
          style={{ marginTop: 8, maxHeight: 'calc(92vh - 200px)', overflowY: 'auto' }}
        >
          {shown.length === 0 && (
            <Text variant="body-sm" tone="secondary" as="div" style={{ padding: '12px 4px' }}>
              Không tìm thấy kết quả phù hợp
            </Text>
          )}
          {shown.map((o) => (
            <button
              key={o.code}
              type="button"
              role="option"
              aria-selected={o.code === value}
              onClick={() => pick(o.code)}
              style={{
                display: 'block',
                width: '100%',
                minHeight: 44,
                padding: '10px 4px',
                font: 'inherit',
                textAlign: 'left',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid var(--color-border-subtle)',
                cursor: 'pointer',
              }}
            >
              <Text variant="body-md" style={o.code === value ? { fontWeight: 600 } : undefined}>
                {o.name}
              </Text>
            </button>
          ))}
        </div>
      </BottomSheet>
    </>
  );
}

function ErrText({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
      <Icon icon={TriangleAlert} size="sm" tone="danger" />
      <Text variant="caption" tone="danger">
        {children}
      </Text>
    </div>
  );
}
