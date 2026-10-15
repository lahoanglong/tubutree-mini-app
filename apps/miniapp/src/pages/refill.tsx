import { useRef, useState } from 'react';
import { Page, useSnackbar, useNavigate } from 'zmp-ui';
import { Clock, Droplets, MapPin, Phone, Sprout } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRefillSummary, returnBottles } from '../services/refill-api';
import { callPhone } from '../services/zmp-bridge';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { ErrorState } from '../components/ui/empty-state';
import { Skeleton } from '../components/ui/skeleton';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Icon } from '../components/ui/icon';
import { ListRow } from '../components/ui/list-row';
import { PageHeader } from '../components/ui/page-header';
import { RefillLocationInfo, RefillLocationPicker } from '../components/refill-location-picker';
import { SupportContact } from '../components/support-contact';
import { QuantitySelector } from '../components/ui/quantity-selector';
import { Heading, Text } from '../components/ui/text';
import { formatDate } from '../utils/format';
import { haptic } from '../utils/haptic';
import { newIdempotencyKey } from '../utils/idempotency';

export default function RefillPage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const authed = useAuthStore((s) => s.status) === 'authenticated';
  const [qty, setQty] = useState(1);
  const [chosenLocationId, setChosenLocationId] = useState<string | null>(null);
  // Key giữ nguyên khi lỗi để retry mạng thật không tạo thêm 1 yêu cầu đổi vỏ nữa; chỉ đổi
  // key mới sau khi đã đổi vỏ thành công (lệnh sau là lệnh mới) — mirror pattern checkout/wallet.
  // Key gắn với số vỏ và điểm nhận: server từ chối (409) cùng key khác số lượng/điểm nên đổi một trong hai = lệnh mới.
  const returnKey = useRef<{ key: string; qty: number; locationId: string | null }>({ key: newIdempotencyKey(), qty: 1, locationId: null });
  const keyFor = (n: number, locationId: string | null) => {
    if (returnKey.current.qty !== n || returnKey.current.locationId !== locationId) {
      returnKey.current = { key: newIdempotencyKey(), qty: n, locationId };
    }
    return returnKey.current.key;
  };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['refill'],
    queryFn: getRefillSummary,
    enabled: authed,
  });

  // Điểm nhận: một điểm thì mặc định luôn; nhiều điểm thì dùng lựa chọn của khách, hoặc điểm lần trước nếu còn mở. Điểm đã
  // chọn mà không còn trong danh sách (admin vừa tắt) thì coi như chưa chọn, không gửi id cũ.
  const locations = data?.pickupLocations ?? [];
  const lastUsedId = (data?.history ?? []).find((h) => h.pickupLocation && locations.some((l) => l.id === h.pickupLocation!.id))?.pickupLocation?.id;
  const locationId =
    locations.length === 1
      ? locations[0]!.id
      : chosenLocationId && locations.some((l) => l.id === chosenLocationId)
        ? chosenLocationId
        : (lastUsedId ?? null);
  const needsLocation = locations.length > 1 && !locationId;

  const returnM = useMutation({
    mutationFn: () => {
      const key = keyFor(qty, locationId);
      return locationId ? returnBottles(qty, key, locationId) : returnBottles(qty, key);
    },
    onSuccess: () => {
      haptic('heavy');
      openSnackbar({ text: 'Đã gửi yêu cầu! Mang vỏ chai đến điểm nhận để nhân viên đối chiếu và duyệt.', type: 'success' });
      setQty(1);
      returnKey.current = { key: newIdempotencyKey(), qty: 1, locationId };
      void queryClient.invalidateQueries({ queryKey: ['refill'] });
      void queryClient.invalidateQueries({ queryKey: ['garden'] });
      void queryClient.invalidateQueries({ queryKey: ['game'] });
    },
    onError: (e: unknown) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      // Điểm vừa bị tắt/xoá làm server từ chối: tải lại để danh sách điểm cho khách chọn lại là danh sách thật.
      void queryClient.invalidateQueries({ queryKey: ['refill'] });
    },
  });

  const remaining = data?.monthlyRemaining ?? 0;
  const pendingByLocation = new Map<string, number>();
  let pendingBottles = 0;
  for (const h of data?.history ?? []) {
    if (h.status !== 'PENDING') continue;
    pendingBottles += h.quantity;
    if (h.pickupLocation) pendingByLocation.set(h.pickupLocation.name, (pendingByLocation.get(h.pickupLocation.name) ?? 0) + h.quantity);
  }
  const pickup = data?.pickup;
  const hasPickup = Boolean(pickup?.address || pickup?.hours || pickup?.phone);
  const maxQty = Math.max(1, remaining);
  // Không gộp `isPending` vào disabled: Button tự chặn bấm lại khi loading, còn disabled sẽ tắt luôn spinner.
  const eligible = authed && remaining > 0 && qty >= 1 && qty <= remaining && !needsLocation;

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 80 }}>
      <PageHeader
        title="Đổi vỏ chai — Nhận nước"
        subtitle="Mang vỏ chai rỗng đến cửa hàng đổi lấy 💧 tưới Vườn Xanh. Tái chế vỏ → nuôi cây, góp quỹ trồng cây 🌳"
      />

      {isLoading ? (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <Skeleton height={70} radius="var(--radius-card)" style={{ flex: 1 }} />
            <Skeleton height={70} radius="var(--radius-card)" style={{ flex: 1 }} />
          </div>
          <Skeleton height={160} radius="var(--radius-card)" />
        </div>
      ) : isError ? (
        <ErrorState message={getErrorMessage(error)} onRetry={() => void refetch()} />
      ) : (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Tổng quan dấu chân xanh */}
          <div style={{ display: 'flex', gap: 12 }}>
            <Card padding={12} style={{ flex: 1, textAlign: 'center' }}>
              <Text variant="price-lg" tone="brand" as="div">{data?.totalRecycled ?? 0}</Text>
              <Text variant="caption" tone="tertiary" as="div">vỏ đã tái chế</Text>
            </Card>
            <Card padding={12} style={{ flex: 1, textAlign: 'center' }}>
              <Text variant="price-lg" tone="brand" as="div">{remaining}</Text>
              <Text variant="caption" tone="tertiary" as="div">còn đổi được tháng này</Text>
            </Card>
          </div>

          {/* Bộ đổi vỏ */}
          <Card padding={16}>
            <Heading variant="title-sm" as="h2">Bạn đang đổi mấy vỏ chai?</Heading>
            <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0' }}>
              <QuantitySelector value={qty} min={1} max={maxQty} onChange={setQty} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Icon icon={Droplets} size="sm" tone="brand" />
              <Text variant="body-sm" tone="secondary">
                Nhận <b>{qty * (data?.perBottle ?? 0)}💧</b> ({data?.perBottle ?? 0}💧 / vỏ)
              </Text>
            </div>
            {locations.length > 1 && (
              <div style={{ marginTop: 16 }}>
                <Heading variant="title-sm" as="h3" style={{ marginBottom: 8 }}>Mang vỏ đến điểm nào?</Heading>
                <RefillLocationPicker locations={locations} value={locationId} onChange={setChosenLocationId} onCall={callPhone} />
              </div>
            )}
            <Button
              fullWidth
              loading={returnM.isPending}
              disabled={!eligible}
              onPress={() => returnM.mutateAsync().catch(() => undefined)}
              style={{ marginTop: 14 }}
            >
              {remaining <= 0 ? 'Đã hết lượt đổi tháng này' : needsLocation ? 'Chọn điểm nhận vỏ để gửi yêu cầu' : 'Gửi yêu cầu đổi vỏ'}
            </Button>
            {!authed && (
              <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 8, textAlign: 'center' }}>
                Đăng nhập để đổi vỏ lấy nước.
              </Text>
            )}
          </Card>

          {/* Điểm nhận vỏ + bước tiếp theo: trước đây chỉ có "đến cửa hàng" không nói đâu, yêu cầu kẹt Chờ duyệt. */}
          {pendingBottles > 0 && (
            <Card variant="flat" padding={12}>
              <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
                Bạn có {pendingBottles} vỏ chai đang chờ duyệt
              </Text>
              <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 4 }}>
                Mang đúng số vỏ đã khai đến {pendingByLocation.size > 0 ? 'điểm nhận bạn đã chọn' : 'điểm nhận bên dưới'}, nhân viên đối chiếu số
                vỏ rồi duyệt — 💧 vào Vườn Xanh ngay sau khi duyệt.
              </Text>
              {[...pendingByLocation].map(([name, n]) => (
                <Text key={name} variant="caption" as="div" style={{ marginTop: 4, fontWeight: 600 }}>
                  {pendingByLocation.size > 1 ? `Mang đến: ${name} (${n} vỏ)` : `Mang đến: ${name}`}
                </Text>
              ))}
            </Card>
          )}

          {/* Từ hai điểm trở lên danh sách nằm trong ô chọn ở trên; một điểm hoặc điểm cũ (dự phòng) hiện thành thẻ riêng. */}
          {locations.length <= 1 && (
            <Card padding={16}>
              <Heading variant="title-sm" as="h2">Điểm nhận vỏ</Heading>
              {locations.length === 1 ? (
                <RefillLocationInfo location={locations[0]!} onCall={callPhone} />
              ) : hasPickup ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                  {pickup?.address && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <Icon icon={MapPin} size="sm" tone="brand" />
                      <Text variant="body-sm">{pickup.address}</Text>
                    </div>
                  )}
                  {pickup?.hours && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <Icon icon={Clock} size="sm" tone="brand" />
                      <Text variant="body-sm">{pickup.hours}</Text>
                    </div>
                  )}
                  {pickup?.phone && (
                    <div>
                      <Button variant="secondary" icon={Phone} onPress={() => void callPhone(pickup.phone!)}>
                        {`Gọi ${pickup.phone}`}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <Text variant="caption" tone="secondary" as="div" style={{ margin: '6px 0 10px' }}>
                    Chưa có địa chỉ điểm nhận trên app — hãy liên hệ Tubu để biết nơi mang vỏ chai đến gần bạn.
                  </Text>
                  <SupportContact />
                </>
              )}
            </Card>
          )}

          {/* Lịch sử */}
          {data && data.history.length > 0 && (
            <Card padding={16}>
              <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>Lịch sử đổi vỏ</Heading>
              {data.history.map((h) => {
                const statusKey = h.status ?? 'PENDING';
                const statusMeta = {
                  PENDING: { label: 'Chờ duyệt', tone: 'warning' },
                  APPROVED: { label: `+${h.seedsAwarded}💧`, tone: 'success' },
                  REJECTED: { label: 'Từ chối', tone: 'danger' },
                }[statusKey] as { label: string; tone: 'warning' | 'success' | 'danger' };

                return (
                  <div
                    key={h.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 0',
                      borderBottom: '1px solid var(--color-border-subtle)',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <Text variant="body-sm" tone="secondary" as="div">{h.quantity} vỏ · {formatDate(h.createdAt)}</Text>
                      {h.status === 'APPROVED' && h.declaredQuantity != null && h.declaredQuantity > h.quantity && (
                        <Text variant="caption" tone="tertiary" as="div">Nhận {h.quantity}/{h.declaredQuantity} vỏ</Text>
                      )}
                      {h.pickupLocation && (
                        <Text variant="caption" tone="tertiary" as="div">Điểm nhận: {h.pickupLocation.name}</Text>
                      )}
                      {h.status === 'REJECTED' && h.rejectionReason && (
                        <Text variant="caption" tone="tertiary" as="div">Lý do: {h.rejectionReason}</Text>
                      )}
                    </div>
                    <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                  </div>
                );
              })}
            </Card>
          )}

          {/* Liên kết sang Vườn Cây Tubu */}
          <Card variant="outline" padding={0}>
            <ListRow
              icon={
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 'var(--radius-control)',
                    background: 'var(--color-action-secondary-bg)',
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon icon={Sprout} size="md" tone="brand" />
                </div>
              }
              title="Vườn Cây Tubu"
              subtitle="Dùng giọt nước tích luỹ để chăm cây và đổi quà thật"
              trailing="chevron"
              onPress={() => navigate('/game')}
              style={{ padding: 12 }}
            />
          </Card>
        </div>
      )}
    </Page>
  );
}
