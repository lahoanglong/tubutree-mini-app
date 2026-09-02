import { Box, Select, Text } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { getProvinces, getCommunes } from '../services/geo-api';
import { vi } from '../i18n/vi';

/** Giá trị địa giới: tên hiển thị + mã Pancake (gửi khi đặt đơn). */
export interface GeoValue {
  province: string;
  provinceCode: string;
  ward: string;
  wardCode: string;
}

export const EMPTY_GEO: GeoValue = { province: '', provinceCode: '', ward: '', wardCode: '' };

const { Option } = Select;

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
      <Box>
        <Select
          label="Tỉnh/Thành phố"
          placeholder={
            provincesQ.isLoading ? 'Đang tải…' : provincesQ.isError ? vi.errors.loadFailed : 'Chọn tỉnh/thành'
          }
          value={value.provinceCode || undefined}
          closeOnSelect
          status={errorProvince ? 'error' : undefined}
          onChange={(v) => {
            const code = String(v ?? '');
            const name = provincesQ.data?.find((p) => p.code === code)?.name ?? '';
            onChange({ province: name, provinceCode: code, ward: '', wardCode: '' });
          }}
        >
          {(provincesQ.data ?? []).map((p) => (
            <Option key={p.code} value={p.code} title={p.name} />
          ))}
        </Select>
        {errorProvince && <ErrText>{errorProvince}</ErrText>}
        {/* API lỗi thì Select sẽ im lặng mãi ở placeholder nếu không có dòng này — cho user biết + retry */}
        {provincesQ.isError && !errorProvince && (
          <Text
            size="xSmall"
            onClick={() => void provincesQ.refetch()}
            style={{ color: 'var(--danger)', marginTop: 2, cursor: 'pointer' }}
          >
            ⚠ {vi.errors.loadFailed} · {vi.common.retry}
          </Text>
        )}
      </Box>

      <Box>
        <Select
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
          value={value.wardCode || undefined}
          closeOnSelect
          status={errorWard ? 'error' : undefined}
          onChange={(v) => {
            const code = String(v ?? '');
            const name = communesQ.data?.find((c) => c.code === code)?.name ?? '';
            onChange({ ...value, ward: name, wardCode: code });
          }}
        >
          {(communesQ.data ?? []).map((c) => (
            <Option key={c.code} value={c.code} title={c.name} />
          ))}
        </Select>
        {errorWard && <ErrText>{errorWard}</ErrText>}
        {communesQ.isError && !errorWard && (
          <Text
            size="xSmall"
            onClick={() => void communesQ.refetch()}
            style={{ color: 'var(--danger)', marginTop: 2, cursor: 'pointer' }}
          >
            ⚠ {vi.errors.loadFailed} · {vi.common.retry}
          </Text>
        )}
      </Box>
    </>
  );
}

function ErrText({ children }: { children: React.ReactNode }) {
  return (
    <Text size="xSmall" style={{ color: 'var(--danger)', marginTop: 2 }}>
      ⚠ {children}
    </Text>
  );
}
