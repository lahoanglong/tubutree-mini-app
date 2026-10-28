import { useSnackbar } from 'zmp-ui';
import { useQueryClient } from '@tanstack/react-query';
import { wasteGuestCopy } from '@tubutree/app-core/waste-copy';
import { getErrorMessage } from '../services/api';
import { isHttpError } from '../services/http';
import { useAuthStore } from '../store/auth';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Text } from './ui/text';

/** API Đổi rác trả 403 cho khách vãng lai chưa cho số điện thoại: không phải lỗi tải, nên không có "Thử lại". */
export const isWasteForbidden = (e: unknown): boolean => isHttpError(e) && e.response?.status === 403;

export function WastePhoneNeeded({ text }: { text: string }) {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const ensurePhone = useAuthStore((s) => s.ensurePhone);
  const share = async () => {
    try {
      if (await ensurePhone()) await qc.invalidateQueries({ queryKey: ['waste'] });
    } catch (e) {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
    }
  };
  return (
    <Card variant="outline">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Text variant="body-md" as="div" style={{ fontWeight: 600 }}>
          {text}
        </Text>
        <Text variant="body-sm" tone="secondary" as="div">
          {wasteGuestCopy.whyPhone}
        </Text>
        <Button fullWidth onPress={() => void share()}>
          Cho Tubu số điện thoại
        </Button>
      </div>
    </Card>
  );
}
