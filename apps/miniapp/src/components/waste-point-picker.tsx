import { useState } from 'react';
import { Clock, Copy, MapPin, Phone } from 'lucide-react';
import type { WastePointDTO } from '@tubutree/shared-types';
import { callPhone } from '../services/zmp-bridge';
import { copyText } from '../utils/clipboard';
import { haptic } from '../utils/haptic';
import { formatNumber } from '../utils/format';
import { formatPhoneDisplay } from '../utils/phone';
import { missingItemsReason } from '@tubutree/app-core/waste-copy';
import { openingStatus } from '@tubutree/app-core/waste-hours';
import { pointAddress } from '../utils/waste-labels';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Icon } from './ui/icon';
import { Text } from './ui/text';

export interface WastePointPickerProps {
  points: readonly WastePointDTO[];
  value: string | null;
  onChange: (pointId: string) => void;
  /** Các món đang bật, liệt kê trên từng thẻ. */
  items: readonly { id: string; name: string; warehouseOnly?: boolean }[];
  selectedItemIds: readonly string[];
  showDistance: boolean;
  now?: Date;
}

/** Thẻ khoá chỉ mờ phần chọn và tên; lý do, chỉ đường và gọi vẫn dùng được nên giữ nguyên độ đậm. */
const DIMMED = 0.55;

function missingItemIds(p: WastePointDTO, selectedItemIds: readonly string[]): string[] {
  return selectedItemIds.filter((id) => !p.acceptedItemIds.includes(id));
}

/** Điểm nhận đủ món đã chọn trước, rồi gần trước xa sau (không có khoảng cách xếp cuối), cuối cùng giữ thứ tự đầu vào. */
export function sortWastePoints(points: readonly WastePointDTO[], selectedItemIds: readonly string[]): WastePointDTO[] {
  return points
    .map((p, index) => ({ p, index, partial: missingItemIds(p, selectedItemIds).length > 0 }))
    .sort((a, b) => {
      if (a.partial !== b.partial) return a.partial ? 1 : -1;
      const da = a.p.distanceKm ?? Number.POSITIVE_INFINITY;
      const db = b.p.distanceKm ?? Number.POSITIVE_INFINITY;
      if (da !== db) return da < db ? -1 : 1;
      return a.index - b.index;
    })
    .map((x) => x.p);
}

/**
 * Khách chọn điểm nhận. Mỗi điểm là một ô chọn (role=radio) toàn chữ; dòng khoá, ưu đãi riêng và nút gọi, chỉ đường
 * nằm NGOÀI ô chọn vì trình đọc màn hình gộp phần tử con vào radio và bỏ rơi nút.
 */
export function WastePointPicker({ points, value, onChange, items, selectedItemIds, showDistance, now }: WastePointPickerProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const sorted = sortWastePoints(points, selectedItemIds);
  const clock = now ?? new Date();
  const isLocked = (p: WastePointDTO) => p.quotaFull || missingItemIds(p, selectedItemIds).length > 0;
  const nearestId = showDistance ? sorted.find((p) => !isLocked(p) && p.distanceKm != null)?.id : undefined;

  return (
    <div role="radiogroup" aria-label="Chọn điểm nhận" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sorted.map((p) => {
        const selected = p.id === value;
        const locked = isLocked(p);
        const missing = missingItemIds(p, selectedItemIds);
        const missingItems = items.filter((it) => missing.includes(it.id));
        const hours = openingStatus(p.openingHours, clock);
        return (
          <div
            key={p.id}
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
              aria-disabled={locked}
              className="tubu-press"
              onClick={() => {
                if (locked || selected) return;
                haptic('light');
                onChange(p.id);
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
                cursor: locked ? 'not-allowed' : 'pointer',
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
                  opacity: locked ? DIMMED : 1,
                }}
              >
                {selected && <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--color-action-primary-bg)' }} />}
              </span>
              <span data-point-body style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1, opacity: locked ? DIMMED : 1 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text variant="body-sm" as="span" style={{ fontWeight: 600 }}>
                    {p.name}
                  </Text>
                  <Badge tone={p.kind === 'WAREHOUSE' ? 'info' : 'brand'} size="sm">
                    {p.kind === 'WAREHOUSE' ? 'Kho Tubu' : 'Đại lý'}
                  </Badge>
                  {p.id === nearestId && (
                    <Badge tone="success" size="sm">
                      Gần nhất
                    </Badge>
                  )}
                </span>
                <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <Icon icon={MapPin} size="sm" tone="brand" />
                  <Text variant="body-sm" as="span" style={{ minWidth: 0 }}>
                    {pointAddress(p)}
                  </Text>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Icon icon={Clock} size="sm" tone="brand" />
                  <Text variant="body-sm" as="span" tone={hours.open === null ? 'tertiary' : 'primary'}>
                    {hours.text}
                  </Text>
                  {showDistance && p.distanceKm != null && (
                    <Text variant="body-sm" as="span">{`${formatNumber(Math.round(p.distanceKm * 10) / 10)} km`}</Text>
                  )}
                </span>
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {items.map((it) =>
                    p.acceptedItemIds.includes(it.id) ? (
                      <Badge key={it.id} tone="neutral" size="sm">
                        {it.name}
                      </Badge>
                    ) : (
                      <span key={it.id} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <Text variant="body-sm" as="span">
                          <s>{it.name}</s>
                        </Text>
                        <Badge tone="neutral" size="sm">
                          Không nhận
                        </Badge>
                      </span>
                    ),
                  )}
                </span>
              </span>
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 12px 12px 42px' }}>
              {locked && (
                <div>
                  <Badge tone="warning" style={{ whiteSpace: 'normal', display: 'inline-block' }}>{p.quotaFull ? 'Tạm hết hạn mức tháng này' : missingItemsReason(missingItems)}</Badge>
                </div>
              )}
              {p.perkText && (
                <Text variant="body-sm" as="p" style={{ margin: 0 }}>
                  {`Ưu đãi của cửa hàng (không dùng Điểm Xanh): ${p.perkText}`}
                </Text>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <Button
                  variant="secondary"
                  icon={Copy}
                  onPress={() => {
                    haptic('light');
                    void copyText(pointAddress(p)).then((ok) => setCopiedId(ok ? p.id : null));
                  }}
                >
                  {copiedId === p.id ? 'Đã chép địa chỉ' : 'Chép địa chỉ'}
                </Button>
                {p.phone && (
                  <Button variant="secondary" icon={Phone} onPress={() => void callPhone(p.phone as string)}>
                    {`Gọi ${formatPhoneDisplay(p.phone)}`}
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
