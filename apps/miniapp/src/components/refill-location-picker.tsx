import { Clock, MapPin, Phone } from 'lucide-react';
import type { RefillLocation } from '../services/refill-api';
import { haptic } from '../utils/haptic';
import { formatPhoneDisplay } from '../utils/phone';
import { Button } from './ui/button';
import { Icon } from './ui/icon';
import { Text } from './ui/text';

interface CallProps {
  onCall: (phone: string) => void | Promise<void>;
}

/** Phần thông tin hiện được của một điểm; trường nào trống thì không vẽ. */
type LocationInfoFields = { name: string; address?: string | null; hours?: string | null; phone?: string | null };

/** Tên (tuỳ chọn), địa chỉ, giờ của một điểm. Toàn <span> để dùng được cả trong nút chọn (nút chỉ chứa nội dung dạng chữ). */
function LocationLines({ location, showName = true }: { location: LocationInfoFields; showName?: boolean }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
      {showName && (
        <Text variant="body-sm" as="span" style={{ fontWeight: 600, display: 'block' }}>
          {location.name}
        </Text>
      )}
      {location.address && (
        <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <Icon icon={MapPin} size="sm" tone="brand" />
          <Text variant="body-sm" as="span" style={{ minWidth: 0 }}>
            {location.address}
          </Text>
        </span>
      )}
      {location.hours && (
        <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <Icon icon={Clock} size="sm" tone="brand" />
          <Text variant="body-sm" as="span" style={{ minWidth: 0 }}>
            {location.hours}
          </Text>
        </span>
      )}
    </span>
  );
}

function CallButton({ phone, onCall }: { phone: string } & CallProps) {
  return (
    <Button variant="secondary" icon={Phone} onPress={() => void onCall(phone)}>
      {`Gọi ${formatPhoneDisplay(phone)}`}
    </Button>
  );
}

/**
 * Địa chỉ, giờ và nút gọi của một điểm KHÔNG kèm tên (tên đã có ở dòng tiêu đề bên trên) — dùng cho yêu cầu đang chờ gắn với
 * điểm không còn trong danh sách chọn. Trường nào trống thì ẩn; không có gì để hiện thì không vẽ gì.
 */
export function RefillLocationDetails({ location, onCall }: { location: LocationInfoFields } & CallProps) {
  if (!location.address && !location.hours && !location.phone) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      <LocationLines location={location} showName={false} />
      {location.phone && (
        <div>
          <CallButton phone={location.phone} onCall={onCall} />
        </div>
      )}
    </div>
  );
}

/** Thông tin một điểm nhận (khi chỉ có một điểm nên không cần chọn): tên, địa chỉ, giờ và nút gọi. */
export function RefillLocationInfo({ location, onCall }: { location: RefillLocation } & CallProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
      <LocationLines location={location} />
      {location.phone && (
        <div>
          <CallButton phone={location.phone} onCall={onCall} />
        </div>
      )}
    </div>
  );
}

/**
 * Khách chọn điểm mang vỏ tới. Mỗi điểm là một ô chọn (role=radio) kèm nút gọi đặt NGOÀI ô chọn — nút không được lồng
 * trong radio vì trình đọc màn hình gộp phần tử con vào cha và bỏ rơi nút gọi.
 */
export function RefillLocationPicker({
  locations,
  value,
  onChange,
  onCall,
}: {
  locations: RefillLocation[];
  value: string | null;
  onChange: (id: string) => void;
} & CallProps) {
  return (
    <div role="radiogroup" aria-label="Chọn điểm nhận vỏ" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {locations.map((location) => {
        const selected = location.id === value;
        return (
          <div
            key={location.id}
            style={{
              border: `1.5px solid ${selected ? 'var(--color-border-selected)' : 'var(--color-border-subtle)'}`,
              background: selected ? 'var(--color-bg-subtle)' : 'var(--color-bg-surface)',
              borderRadius: 'var(--radius-control)',
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              className="tubu-press"
              onClick={() => {
                if (selected) return;
                haptic('light');
                onChange(location.id);
              }}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                width: '100%',
                minHeight: 44,
                padding: 12,
                boxSizing: 'border-box',
                border: 0,
                background: 'transparent',
                font: 'inherit',
                color: 'inherit',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <span
                aria-hidden
                style={{
                  flexShrink: 0,
                  width: 20,
                  height: 20,
                  marginTop: 1,
                  boxSizing: 'border-box',
                  borderRadius: '50%',
                  border: `2px solid ${selected ? 'var(--color-border-selected)' : 'var(--color-border-default)'}`,
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                {selected && <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--color-action-primary-bg)' }} />}
              </span>
              <LocationLines location={location} />
            </button>
            {location.phone && (
              <div style={{ padding: '0 12px 12px 42px' }}>
                <CallButton phone={location.phone} onCall={onCall} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
