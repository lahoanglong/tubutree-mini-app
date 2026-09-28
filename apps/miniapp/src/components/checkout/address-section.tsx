import { useState } from 'react';
import { Box, Text } from 'zmp-ui';
import { useQueryClient } from '@tanstack/react-query';
import type { AddressDTO } from '../../services/shop-api';
import { vi } from '../../i18n/vi';
import { haptic } from '../../utils/haptic';
import { addressLine } from '../../utils/format';
import { AddressForm } from '../address-form';

interface AddressSectionProps {
  addresses: AddressDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function AddressSection({ addresses, selectedId, onSelect }: AddressSectionProps) {
  const [adding, setAdding] = useState(false);
  const queryClient = useQueryClient();

  return (
    <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
      <Text bold size="small" style={{ marginBottom: 8 }}>
        {vi.checkout.address}
      </Text>

      {addresses.length === 0 && !adding && (
        <Text size="small" style={{ color: 'var(--neutral-400)' }}>
          {vi.checkout.addressEmpty}
        </Text>
      )}

      {addresses.map((a) => (
        <AddressCard key={a.id} address={a} active={selectedId === a.id} onClick={() => onSelect(a.id)} />
      ))}

      {adding ? (
        <Box style={{ marginTop: 8 }}>
          <AddressForm
            initial={null}
            onCancel={() => setAdding(false)}
            onSaved={(a) => {
              void queryClient.invalidateQueries({ queryKey: ['addresses'] });
              onSelect(a.id);
              setAdding(false);
            }}
          />
        </Box>
      ) : (
        <Box
          role="button"
          className="tubu-press"
          onClick={() => {
            haptic('light');
            setAdding(true);
          }}
          style={{
            marginTop: 8,
            padding: '12px 0',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minHeight: 44,
            boxSizing: 'border-box',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              border: '1.5px dashed var(--primary-600)',
              color: 'var(--primary-600)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            +
          </span>
          <Text size="small" bold style={{ color: 'var(--primary-700)' }}>
            {vi.checkout.addAddress}
          </Text>
        </Box>
      )}
    </Box>
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
    <Box
      role="radio"
      aria-checked={active}
      className="tubu-press"
      onClick={() => {
        haptic('light');
        onClick();
      }}
      p={3}
      style={{
        border: `1.5px solid ${active ? 'var(--primary-600)' : 'var(--neutral-200)'}`,
        background: active ? 'var(--primary-50)' : 'var(--neutral-0)',
        borderRadius: 'var(--radius-md)',
        marginBottom: 8,
        minHeight: 44,
        boxSizing: 'border-box',
      }}
    >
      <Box flex alignItems="center" style={{ gap: 6 }}>
        <Text size="small" bold>
          {address.recipient} · {address.phone}
        </Text>
        {address.isDefault && (
          <Text
            size="xSmall"
            style={{
              background: 'var(--leaf-50)',
              color: 'var(--leaf-700)',
              padding: '1px 8px',
              borderRadius: 'var(--radius-full)',
            }}
          >
            {vi.checkout.addressDefault}
          </Text>
        )}
      </Box>
      <Text size="xSmall" style={{ color: 'var(--neutral-600)', marginTop: 2 }}>
        {addressLine(address)}
      </Text>
    </Box>
  );
}
