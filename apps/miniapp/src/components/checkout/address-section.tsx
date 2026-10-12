import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { AddressDTO } from '../../services/shop-api';
import { vi } from '../../i18n/vi';
import { haptic } from '../../utils/haptic';
import { addressLine } from '../../utils/format';
import { AddressForm } from '../address-form';
import { Badge } from '../ui/badge';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';

interface AddressSectionProps {
  addresses: AddressDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function AddressSection({ addresses, selectedId, onSelect }: AddressSectionProps) {
  const [adding, setAdding] = useState(false);
  const queryClient = useQueryClient();

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

      {addresses.map((a) => (
        <AddressCard key={a.id} address={a} active={selectedId === a.id} onClick={() => onSelect(a.id)} />
      ))}

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

function AddressCard({
  address,
  active,
  onClick,
}: {
  address: AddressDTO;
  active: boolean;
  onClick: () => void;
}) {
  return (
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
        marginBottom: 8,
        minHeight: 44,
        boxSizing: 'border-box',
        border: `1.5px solid ${active ? 'var(--color-border-selected)' : 'var(--color-border-subtle)'}`,
        background: active ? 'var(--color-bg-subtle)' : 'var(--color-bg-surface)',
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
  );
}
