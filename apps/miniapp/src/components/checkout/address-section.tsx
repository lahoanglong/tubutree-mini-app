import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus } from 'lucide-react';
import type { AddressDTO } from '../../services/shop-api';
import { vi } from '../../i18n/vi';
import { haptic } from '../../utils/haptic';
import { addressLine } from '../../utils/format';
import { isLegacyGeo } from '../../utils/address-memory';
import { AddressForm } from '../address-form';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';

interface AddressSectionProps {
  addresses: AddressDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function AddressSection({ addresses, selectedId, onSelect }: AddressSectionProps) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const editing = addresses.find((a) => a.id === editingId) ?? null;

  return (
    <div style={{ padding: 16, marginTop: 8, background: 'var(--color-bg-surface)' }}>
      <Text variant="body-sm" as="div" style={{ fontWeight: 600, marginBottom: 8 }}>
        {vi.checkout.address}
      </Text>

      {addresses.length === 0 && !adding && (
        <Text variant="body-sm" tone="tertiary" as="div">
          {vi.checkout.addressEmpty}
        </Text>
      )}

      {addresses.map((a) => {
        const active = selectedId === a.id;
        return (
          <AddressCard key={a.id} address={a} active={active} onClick={() => onSelect(a.id)}>
            {active && isLegacyGeo(a) && editing === null && (
              <LegacyGeoNotice
                onFix={() => {
                  haptic('light');
                  setAdding(false);
                  setEditingId(a.id);
                }}
              />
            )}
          </AddressCard>
        );
      })}

      {editing && (
        <div style={{ marginTop: 8 }}>
          <AddressForm
            initial={editing}
            onCancel={() => setEditingId(null)}
            onSaved={(a) => {
              void queryClient.invalidateQueries({ queryKey: ['addresses'] });
              void queryClient.invalidateQueries({ queryKey: ['quote'] });
              onSelect(a.id);
              setEditingId(null);
            }}
          />
        </div>
      )}

      {adding ? (
        <div style={{ marginTop: 8 }}>
          <AddressForm
            initial={null}
            askZaloProfile={addresses.length === 0}
            onCancel={() => setAdding(false)}
            onSaved={(a) => {
              void queryClient.invalidateQueries({ queryKey: ['addresses'] });
              onSelect(a.id);
              setAdding(false);
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          className="tubu-press"
          onClick={() => {
            haptic('light');
            setEditingId(null);
            setAdding(true);
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            marginTop: 8,
            padding: '12px 0',
            minHeight: 44,
            boxSizing: 'border-box',
            border: 'none',
            background: 'none',
            font: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              border: '1.5px dashed var(--color-action-primary-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon icon={Plus} size="sm" tone="brand" />
          </span>
          <Text variant="body-sm" style={{ fontWeight: 600, color: 'var(--color-text-brand)' }}>
            {vi.checkout.addAddress}
          </Text>
        </button>
      )}
    </div>
  );
}

/** Cảnh báo nằm trong chính thẻ địa chỉ đang chọn để khách biết địa chỉ nào cần chọn lại tỉnh/phường. */
function LegacyGeoNotice({ onFix }: { onFix: () => void }) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        margin: '0 12px 12px',
        borderRadius: 'var(--radius-control)',
        background: 'var(--color-status-warning-bg)',
      }}
    >
      <span style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <AlertTriangle size={16} color="var(--color-status-warning-fg)" aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
        <Text variant="body-sm" as="span" style={{ color: 'var(--color-status-warning-fg)' }}>
          {vi.checkout.addressLegacy}
        </Text>
      </span>
      <Button variant="secondary" onPress={onFix}>
        {vi.checkout.addressLegacyCta}
      </Button>
    </div>
  );
}

function AddressCard({
  address,
  active,
  onClick,
  children,
}: {
  address: AddressDTO;
  active: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        marginBottom: 8,
        border: `1.5px solid ${active ? 'var(--color-border-selected)' : 'var(--color-border-subtle)'}`,
        background: active ? 'var(--color-bg-subtle)' : 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-control)',
      }}
    >
      <button
        type="button"
        role="radio"
        aria-checked={active}
        className="tubu-press"
        onClick={() => {
          haptic('light');
          onClick();
        }}
        style={{
          display: 'block',
          width: '100%',
          padding: 12,
          minHeight: 44,
          boxSizing: 'border-box',
          border: 'none',
          background: 'transparent',
          borderRadius: 'var(--radius-control)',
          font: 'inherit',
          color: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Text variant="body-sm" style={{ fontWeight: 600 }}>
            {address.recipient} · {address.phone}
          </Text>
          {address.isDefault && <Badge tone="brand">{vi.checkout.addressDefault}</Badge>}
        </span>
        <Text variant="caption" tone="secondary" as="span" style={{ display: 'block', marginTop: 2 }}>
          {addressLine(address)}
        </Text>
      </button>
      {children}
    </div>
  );
}
