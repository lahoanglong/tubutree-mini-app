import { useRef, useState } from 'react';
import { useNavigate } from 'zmp-ui';
import { useQueryClient } from '@tanstack/react-query';
import type { WasteItemDTO, WasteMethod, WasteRequestSummaryDTO } from '@tubutree/shared-types';
import { buildRepeatDraft, repeatCardView } from '@tubutree/app-core/refill/repeat-waste';
import type { WasteWizardDraft } from '../../pages/recycle-new';
import { useNotify } from '../../hooks/use-notify';
import { getErrorMessage } from '../../services/api';
import { getWastePoints, getWasteRequest, WASTE_QUERY_KEYS } from '../../services/waste-api';
import { Button } from '../ui/button';
import { Text } from '../ui/text';

export interface RepeatWasteCardProps {
  /** Yêu cầu hoàn tất gần nhất (`lastCompletedRequest`). */
  request: WasteRequestSummaryDTO;
  methodLabel: string;
  items: readonly WasteItemDTO[];
  /** Cách gửi đang mở với khách này (đã lọc theo cấu hình và khoá đường kho). */
  methods: readonly WasteMethod[];
  /** Lối vào cũ (bước chọn loại rác trống). */
  newHref: string;
}

/**
 * "Gửi lại như lần trước" ở trang Đổi rác (cờ `waste.repeat_request_enabled`): một nút dựng nháp từ yêu cầu hoàn tất gần nhất rồi mở bước chọn loại rác;
 * phần không còn hợp lệ bị bỏ và nói ở đúng bước, ô đồng ý thể lệ khách tích lại. "Tạo yêu cầu mới" thành lối phụ.
 */
export function RepeatWasteCard({ request, methodLabel, items, methods, newHref }: RepeatWasteCardProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { notify } = useNotify();
  const [busy, setBusy] = useState(false);
  // Khoá đồng bộ: hai cú chạm trong cùng một nhịp vẽ không dựng nháp và chuyển trang hai lần.
  const lock = useRef(false);
  const view = repeatCardView(request, methodLabel);
  const start = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const [detail, points] = await Promise.all([
        qc.fetchQuery({ queryKey: WASTE_QUERY_KEYS.request(request.id), queryFn: () => getWasteRequest(request.id) }),
        request.method === 'DROP_OFF' ? qc.fetchQuery({ queryKey: WASTE_QUERY_KEYS.points(null), queryFn: () => getWastePoints() }).catch(() => null) : null,
      ]);
      const d = buildRepeatDraft({ detail, items, enabledMethods: methods, points });
      const draft: WasteWizardDraft = {
        lines: d.lines,
        method: d.method,
        pointId: d.pointId,
        pickedPoint: d.pickedPoint,
        provinceCode: null,
        nearby: null,
        ...(d.homePickupWeight ? { homePickup: { addressId: null, weightGrams: d.homePickupWeight, payment: null } } : {}),
        repeat: { items: d.itemsNote, method: d.methodNote },
      };
      navigate(newHref, { state: { draft } });
    } catch (e) {
      notify({ text: getErrorMessage(e), type: 'error' });
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <div data-testid="waste-repeat" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-sm)' }}>
      <div>
        <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
          {view.title}
        </Text>
        <Text variant="caption" tone="secondary" as="div">
          {view.subtitle}
        </Text>
      </div>
      <Button fullWidth loading={busy} onPress={start}>
        {view.cta}
      </Button>
      <Button variant="ghost" fullWidth onPress={() => navigate(newHref)}>
        {view.newRequest}
      </Button>
    </div>
  );
}
