import { useEffect, useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Recycle } from 'lucide-react';
import { Box, useNavigate } from 'zmp-ui';
import {
  SECOND_ORDER_METHOD,
  secondOrderInviteCopyFor,
  secondOrderInviteDecision,
  secondOrderInvitePath,
  secondOrderOrderGate,
  type SecondOrderInviteOrder,
} from '@tubutree/app-core/second-order-invite';
import { usePublicConfig } from '../../hooks/use-public-config';
import { trackRecycleStep } from '../../services/recycle-funnel';
import { WASTE_QUERY_KEYS, getReturnPackaging, getWasteMe } from '../../services/waste-api';
import { haptic } from '../../utils/haptic';
import { Icon } from '../ui/icon';
import { ListRow } from '../ui/list-row';

/**
 * Chi tiết đơn đã giao: một thẻ mời giữ bao bì gửi kèm đơn kế tiếp (miễn ship 100%, tích Điểm Xanh). Luật hiện/ẩn ở app-core
 * (`secondOrderInviteDecision`), gồm trần yêu cầu mở của W179. Cả thẻ là một nút, không có CTA thứ hai trên màn.
 * `fallback` hiện ở chỗ thẻ khi đã biết chắc thẻ không hiện (cấu hình và /waste/me đã về), để màn không nhảy từ dòng thay thế sang thẻ.
 * Cờ `checkout.return_packaging_nudge_enabled` bật: thẻ nêu đúng bao bì của đơn và điểm dự kiến, chạm vào thì màn tạo yêu cầu điền sẵn số lượng.
 */
export function SecondOrderInvite({ order, fallback }: { order: SecondOrderInviteOrder; fallback?: ReactNode }) {
  const navigate = useNavigate();
  const cfg = usePublicConfig();
  // Chỉ hỏi /waste/me khi đơn đủ điều kiện và đường kèm đơn đang bật: đơn đang giao, đã kèm rác hay cổng đóng không tốn thêm lời gọi nào.
  const orderOk = secondOrderOrderGate(order) === null && cfg.isLoaded && cfg.waste.pickup;
  const meQ = useQuery({ queryKey: WASTE_QUERY_KEYS.me, queryFn: getWasteMe, enabled: orderOk });
  const code = order.code ?? '';
  const packQ = useQuery({
    queryKey: WASTE_QUERY_KEYS.returnPackaging(code),
    queryFn: () => getReturnPackaging(code),
    enabled: orderOk && cfg.returnPackagingNudgeEnabled === true && code !== '',
    staleTime: 60_000,
  });
  const decision = secondOrderInviteDecision({ order, cfgPickup: cfg.waste.pickup, me: meQ.data });
  const packaging = packQ.data?.suggestion ?? null;
  const shown = useRef(false);
  useEffect(() => {
    if (!decision.show || shown.current) return;
    shown.current = true;
    trackRecycleStep('second_order_shown', SECOND_ORDER_METHOD);
  }, [decision.show]);
  if (!decision.show) return cfg.isLoaded && !meQ.isLoading ? (fallback ?? null) : null;
  // Chờ bao bì về rồi mới vẽ để chữ thẻ không đổi ngay dưới tay khách; lỗi thì giữ chữ cũ.
  if (packQ.isLoading) return null;
  const copy = secondOrderInviteCopyFor(packaging);

  return (
    <Box id="order-second-order-invite" mt={2} p={4} style={{ background: 'var(--color-bg-surface)' }}>
      <ListRow
        icon={<Icon icon={Recycle} tone="brand" />}
        title={copy.title}
        subtitle={copy.subtitle}
        trailing="chevron"
        style={{ padding: 0 }}
        onPress={() => {
          haptic('light');
          trackRecycleStep('second_order_click', SECOND_ORDER_METHOD);
          navigate(secondOrderInvitePath('/recycle/new', order.code, packaging !== null));
        }}
      />
    </Box>
  );
}
