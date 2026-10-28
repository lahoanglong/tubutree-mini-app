import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Page, Text, useParams, useNavigate, useSnackbar } from 'zmp-ui';
import { Check, Copy, CheckCircle2, Clock, TriangleAlert } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getBankQr } from '../services/payment-api';
import { getErrorCode, getErrorMessage, getLoadErrorMessage, isBusinessMessage } from '../services/api';
import { isHttpError } from '../services/http';
import { haptic } from '../utils/haptic';
import { formatDateTime } from '../utils/format';
import { Skeleton } from '../components/ui/skeleton';
import { copyText } from '../utils/clipboard';
import { Button } from '../components/ui/button';
import { Icon } from '../components/ui/icon';
import { IconButton } from '../components/ui/icon-button';
import { useRemaining } from '../hooks/use-remaining';
import { Money } from '../components/ui/price-tag';
import { PageHeader } from '../components/ui/page-header';
import { SR_ONLY } from '../components/ui/sr-only';
import { ErrorState } from '../components/ui/empty-state';
import { SupportHotline } from '../components/support-hotline';
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { platformBridge } from '../services/platform-bridge';
import { BANK_QR_HINT, BANK_QR_SAVED, BANK_QR_SAVE_FAILED } from '@tubutree/app-core/bank-payment-copy';
import type { SaveImageResult } from '@tubutree/app-core/bridge';

const PAGE_TITLE = 'Thanh toán chuyển khoản';
// Trạng thái "đã thanh toán" không có PageHeader nên chữ tiêu đề là h1 duy nhất. `font: inherit` bỏ cỡ chữ/đậm mặc định
// của h1, hình dáng vẫn do Text quyết định. Hai trạng thái chỉ có khung chờ/lỗi dùng h1 ẩn (SR_ONLY) cho đủ tiêu đề.
const H1_RESET_MT12 = { margin: '12px 0 0', font: 'inherit' } as const;

// Chỉ các mã cho biết đơn không còn chờ tiền: dò lại hay bấm Thử lại không ra kết quả khác. 401/403 là phiên hết hạn khi refresh
// chưa xong (đơn vẫn chờ, phiên khôi phục xong dò lại là ra), 408/429 tạm thời, mạng/5xx khách vẫn đang chờ tiền về: QR phải còn đó.
const FINAL_REJECTION_STATUSES = new Set([400, 404, 409, 410, 422]);
function isFinalRejection(error: unknown): boolean {
  if (!isHttpError(error)) return false;
  const status = error.response?.status;
  return status !== undefined && FINAL_REJECTION_STATUSES.has(status);
}

// 401/403 ở nút Kiểm tra: phiên đã hết và refresh bị từ chối. Không phải lỗi mạng nên không được báo "kiểm tra kết nối";
// đơn vẫn chờ tiền, khách chỉ cần vào lại phiên rồi bấm lại.
const SESSION_EXPIRED_MESSAGE = 'Phiên đăng nhập đã hết hạn. Bạn mở lại ứng dụng hoặc đăng nhập lại rồi bấm Kiểm tra nhé.';
function isSessionExpired(error: unknown): boolean {
  if (!isHttpError(error)) return false;
  const status = error.response?.status;
  return status === 401 || status === 403;
}
// Mã SESSION_EXPIRED của máy chủ: luôn câu của màn này. Lý do khác bằng tiếng Việt (vd. "Tài khoản đã bị khoá.") đáng hiện hơn câu chung về phiên.
function sessionExpiredText(error: unknown): string {
  const data = isHttpError(error) ? (error.response?.data as { message?: string | string[] } | undefined) : undefined;
  const message = Array.isArray(data?.message) ? data.message[0] : data?.message;
  return getErrorCode(error) !== 'SESSION_EXPIRED' && isBusinessMessage(message) ? (message as string) : SESSION_EXPIRED_MESSAGE;
}

// Máy chủ 503 kèm lý do (vd. chưa cấu hình tài khoản nhận tiền): getErrorMessage giấu message của 5xx sau câu chung, nhưng ở đây
// lý do ấy là thứ khách cần đọc. Vẫn không phải lỗi cuối: dò nền và nút Thử lại cứ chạy, cấu hình xong là tự ra QR.
function loadErrorMessage(error: unknown): string {
  if (isHttpError(error) && error.response?.status === 503) {
    const data = error.response.data as { message?: string | string[] } | undefined;
    const message = Array.isArray(data?.message) ? data.message[0] : data?.message;
    if (isBusinessMessage(message)) return message as string;
  }
  return getLoadErrorMessage(error);
}

const EXPIRED_MESSAGE = 'Đơn đã quá hạn chuyển khoản. Nếu bạn đã chuyển tiền, Tubu sẽ hoàn lại cho bạn.';

export default function BankPaymentPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();

  const qc = useQueryClient();
  const [qrSaved, setQrSaved] = useState<SaveImageResult | null>(null);
  const { data, isLoading, refetch, isFetching, error } = useQuery({
    queryKey: ['bank-qr', code],
    queryFn: () => getBankQr(code!),
    enabled: !!code,
    // Tự dò trạng thái: Pancake/Bank đối soát chuyển khoản → webhook lật PAID; FE poll mỗi 4s.
    refetchInterval: (q) => (q.state.data?.paymentStatus === 'PAID' || isFinalRejection(q.state.error) ? false : 4000),
  });

  const remaining = useRemaining(data?.paymentDeadline);

  const copy = async (text: string, label: string): Promise<boolean> => {
    haptic('light');
    // Chỉ báo "Đã sao chép" SAU KHI ghi clipboard thật sự thành công — báo thành công giả ở đây là
    // khách dán nhầm số tài khoản cũ khi chuyển khoản.
    const ok = await copyText(text);
    openSnackbar(
      ok
        ? { text: `Đã sao chép ${label}`, type: 'success', position: 'top' }
        : { text: `Không thể sao chép ${label}. Vui lòng sao chép thủ công.`, type: 'error', position: 'top' },
    );
    return ok;
  };

  // Cờ RIÊNG cho thao tác bấm tay. Dùng `isFetching` của query sẽ bật/tắt theo nhịp poll nền 4
  // giây, nên nút vừa quay spinner liên tục vừa bị disable đúng lúc khách chạm — chạm vào không
  // có gì xảy ra, không có phản hồi, ngay ở bước phải trả tiền.
  const [checking, setChecking] = useState(false);

  const handleCheckPayment = async () => {
    haptic('medium');
    setChecking(true);
    try {
      const res = await refetch({ throwOnError: true });
      const status = res.data?.paymentStatus;
      if (status === 'PAID') {
        openSnackbar({
          text: 'Đã nhận được thanh toán thành công! Đơn hàng của bạn đã được xác nhận.',
          type: 'success',
          position: 'top',
        });
      } else if (status === 'UNPAID') {
        openSnackbar({
          text: 'Hệ thống chưa thấy tiền về. Ngân hàng thường xử lý từ 30s - 1 phút sau khi chuyển. Vui lòng kiểm tra lại sau ít phút nhé!',
          type: 'warning',
          position: 'top',
        });
      } else if (status === 'FAILED' || status === 'REFUNDED') {
        openSnackbar({
          text: 'Giao dịch không thành công hoặc đã được hoàn lại. Vui lòng liên hệ bộ phận hỗ trợ.',
          type: 'error',
          position: 'top',
        });
      } else {
        openSnackbar({
          text: 'Đã làm mới trạng thái. Đang chờ hệ thống ngân hàng xác nhận.',
          type: 'info',
          position: 'top',
        });
      }
    } catch (err) {
      openSnackbar({
        text: isFinalRejection(err)
          ? getErrorMessage(err)
          : isSessionExpired(err)
            ? sessionExpiredText(err)
            : 'Không thể kết nối tới máy chủ. Vui lòng kiểm tra lại kết nối mạng.',
        type: 'error',
        position: 'top',
      });
    } finally {
      setChecking(false);
    }
  };

  if (isLoading) {
    return (
      <Page style={{ background: 'var(--color-bg-canvas)', paddingTop: 'var(--safe-top)' }}>
        <h1 style={SR_ONLY}>{PAGE_TITLE}</h1>
        {/* Khung tiêu đề giả nằm đúng chỗ PageHeader (chừa 48px bên trái cho nút Quay lại) để màn không nhảy khi tải xong. */}
        <Box style={{ background: 'var(--color-bg-surface)', padding: '12px 16px 12px 64px' }}>
          <Skeleton width={200} height={20} />
          <Skeleton width={240} height={13} style={{ marginTop: 8 }} />
        </Box>
        <Box p={2}>
          <Box p={3} style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)' }}>
            <Skeleton width={240} height={240} style={{ margin: '0 auto' }} />
            <Skeleton width={140} height={24} style={{ margin: '10px auto 0' }} />
            <Box mt={3} flex flexDirection="column" style={{ gap: 8 }}>
              <Skeleton height={16} />
              <Skeleton height={16} />
              <Skeleton height={16} />
            </Box>
          </Box>
        </Box>
      </Page>
    );
  }

  const rejected = isFinalRejection(error);
  const closedMessage = data?.paymentStatus === 'PAID' ? null : rejected ? getLoadErrorMessage(error) : remaining.expired ? EXPIRED_MESSAGE : null;
  if (closedMessage) {
    return (
      <Page className="page" style={{ background: 'var(--color-bg-canvas)' }}>
        <h1 style={SR_ONLY}>{PAGE_TITLE}</h1>
        <Box style={{ textAlign: 'center', padding: '56px 24px' }}>
          <Icon icon={TriangleAlert} tone="danger" style={{ margin: '0 auto' }} />
          <Text bold size="large" style={{ marginTop: 12 }}>
            Đơn không còn chờ chuyển khoản
          </Text>
          <Text size="small" style={{ color: 'var(--color-text-secondary)', marginTop: 4 }}>
            {closedMessage}
          </Text>
          <Button fullWidth onPress={() => navigate(`/order/${code}`, { replace: true })} style={{ marginTop: 24 }}>
            Xem đơn hàng
          </Button>
        </Box>
      </Page>
    );
  }

  if (!data) {
    return (
      <Page className="page" style={{ background: 'var(--color-bg-canvas)' }}>
        <h1 style={SR_ONLY}>{PAGE_TITLE}</h1>
        {/* Cùng bộ phận lỗi với các màn khác để lỗi mạng nói "mất mạng" và có hotline; ErrorState chỉ có một nút nên "Xem đơn hàng"
            và hotline dựng ngay dưới (showSupport tắt để hotline không nằm trên nút phụ). */}
        <ErrorState
          title="Chưa tải được thông tin thanh toán"
          message={loadErrorMessage(error)}
          showSupport={false}
          retrying={isFetching}
          onRetry={() => void refetch()}
        />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: -24, padding: '0 32px 40px' }}>
          <Button variant="secondary" onPress={() => navigate(`/order/${code}`, { replace: true })}>
            Xem đơn hàng
          </Button>
          <SupportHotline />
        </div>
      </Page>
    );
  }

  // ── Đã thanh toán ──
  if (data.paymentStatus === 'PAID') {
    return (
      <Page className="page" style={{ background: 'var(--color-bg-canvas)' }}>
        <Box style={{ textAlign: 'center', padding: '56px 24px' }}>
          <CheckCircle2 size={64} color="var(--color-text-success)" style={{ margin: '0 auto' }} />
          <h1 style={H1_RESET_MT12}>
            <Text bold size="large">Đã nhận thanh toán!</Text>
          </h1>
          <Text size="small" style={{ color: 'var(--color-text-tertiary)', marginTop: 4 }}>
            Đơn {data.orderCode} đã được xác nhận. Cảm ơn bạn
          </Text>
          <Button
            fullWidth
            onPress={() => {
              // Không invalidate thì màn chi tiết/danh sách đơn đọc lại từ cache và vẫn hiện
              // "Chờ thanh toán" ngay sau khi khách vừa thấy "Đã nhận thanh toán" (P2-9 audit).
              void qc.invalidateQueries({ queryKey: ['order', data.orderCode] });
              void qc.invalidateQueries({ queryKey: ['orders'] });
              navigate(`/order/${data.orderCode}`, { replace: true });
            }}
            style={{ marginTop: 24 }}
          >
            Xem đơn hàng
          </Button>
          <Button fullWidth variant="secondary" onPress={() => navigate('/', { replace: true })} style={{ marginTop: 8 }}>
            Về trang chủ
          </Button>
        </Box>
      </Page>
    );
  }

  // ── Chờ thanh toán: hiển thị VietQR ──
  return (
    // Không dùng class "page": PageHeader đã chừa chỗ nút Quay lại và vùng an toàn, thêm .page sẽ cộng đệm 48px lần hai và tách tiêu đề khỏi nút.
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 90 }}>
      <PageHeader title="Quét QR để chuyển khoản" subtitle={BANK_QR_HINT} />

      <Box p={2}>
        <Box p={3} style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)', textAlign: 'center' }}>
          <img
            src={data.qrImageUrl}
            alt="VietQR"
            style={{ width: 240, height: 240, maxWidth: '70%', margin: '0 auto', display: 'block' }}
          />
          <Row hero label="Số tiền" value={<Money amount={data.amount} />} copyName="số tiền" onCopy={() => copy(String(data.amount), 'số tiền')} />
          <Button
            variant="secondary"
            fullWidth
            onPress={async () => {
              setQrSaved(await platformBridge.saveImage(data.qrImageUrl, `tubu-qr-${data.orderCode}.png`));
            }}
            style={{ marginTop: 8 }}
          >
            Lưu mã QR
          </Button>
          {qrSaved && (
            <div role="status" data-testid="bank-qr-saved" style={{ marginTop: 6 }}>
              <Text size="small" style={{ color: 'var(--color-text-secondary)' }}>
                {qrSaved === 'saved' ? BANK_QR_SAVED : BANK_QR_SAVE_FAILED}
              </Text>
            </div>
          )}
          {!!data.paidSoFar && data.paidSoFar > 0 && (
            <div data-testid="paid-so-far" style={{ marginTop: 4 }}>
              <Text size="small" style={{ color: 'var(--color-status-warning-fg)' }}>
                Đã nhận <Money amount={data.paidSoFar} />, còn thiếu <Money amount={data.amount} />. Mã QR đã trừ phần này.
              </Text>
            </div>
          )}

          {/* Thông tin chuyển khoản thủ công (phòng khi không quét được) */}
          <Box mt={2} style={{ textAlign: 'left' }}>
            <Row stacked label="Ngân hàng" value={data.bank.name} />
            <Row label="Số tài khoản" value={data.bank.accountNo} copyName="số tài khoản" onCopy={() => copy(data.bank.accountNo, 'số tài khoản')} />
            <Row stacked label="Chủ tài khoản" value={data.bank.accountName} />
            <Row
              label="Nội dung CK"
              value={data.memo}
              highlight
              copyName="nội dung chuyển khoản"
              onCopy={() => copy(data.memo, 'nội dung chuyển khoản')}
            />
          </Box>
          {/* Hướng dẫn trước khi chuyển, chưa phải lỗi: khối lưu ý cùng màu với khung hạn thay cho chữ đỏ nhỏ. */}
          <Box mt={2} p={3} data-testid="memo-note" style={{ background: 'var(--color-status-warning-bg)', borderRadius: 'var(--radius-control)', textAlign: 'left' }}>
            <Text size="small" style={{ color: 'var(--color-status-warning-fg)' }}>
              <Icon icon={TriangleAlert} size="sm" tone="current" style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />
              Giữ nguyên nội dung <b>{data.memo}</b> để hệ thống tự xác nhận.
            </Text>
          </Box>
        </Box>

        {data.paymentDeadline && (
          <Box mt={2} p={3} role="note" style={{ background: 'var(--color-status-warning-bg)', borderRadius: 'var(--radius-control)' }}>
            <Text size="small" style={{ color: 'var(--color-status-warning-fg)' }}>
              Vui lòng chuyển khoản trước <b>{formatDateTime(data.paymentDeadline)}</b>. Quá hạn đơn sẽ tự huỷ; tiền chuyển sau đó
              Tubu sẽ hoàn lại cho bạn.
            </Text>
            {/* Không phải vùng đọc tự động: đồng hồ đổi mỗi 15 giây, đọc lại liên tục sẽ làm phiền người dùng trình đọc màn hình. */}
            {remaining.text && (
              <div data-testid="payment-countdown" style={{ marginTop: 6 }}>
                <Text size="small" bold style={{ color: 'var(--color-status-warning-fg)' }}>
                  {`${remaining.text} để chuyển khoản`}
                </Text>
              </div>
            )}
          </Box>
        )}

        <Box flex alignItems="center" justifyContent="center" style={{ gap: 6, marginTop: 14, color: 'var(--color-text-tertiary)' }}>
          <Clock size={15} />
          <Text size="small">Đang chờ thanh toán… tự cập nhật khi nhận được tiền</Text>
        </Box>

        {/* loading+disabled tách khỏi cùng 1 biến `checking` — cùng lý do đã ghi ở nút "Thử lại"
            phía trên: giữ cả 2 sẽ làm spinner không bao giờ hiện đúng lúc khách đang chờ xác nhận
            thanh toán, ngay bước quan trọng nhất của luồng tiền. Button (Task 10) tự chặn bấm-2-lần
            khi loading, không cần disabled làm việc đó nữa. */}
        <Button fullWidth variant="secondary" onPress={() => navigate(`/order/${data.orderCode}`, { replace: true })} style={{ marginTop: 8 }}>
          Để sau / Xem đơn hàng
        </Button>
      </Box>
      <StickyActionBar
        primary={
          <Button fullWidth size="lg" loading={checking} onPress={handleCheckPayment}>
            Tôi đã chuyển khoản — Kiểm tra
          </Button>
        }
      />
    </Page>
  );
}

const COPIED_FEEDBACK_MS = 2000;

function Row({
  label,
  value,
  onCopy,
  copyName,
  highlight,
  stacked,
  hero,
}: {
  label: string;
  value: ReactNode;
  /** Trả về việc có chép được thật không; chỉ khi chép được dòng này mới hiện xác nhận "Đã sao chép". */
  onCopy?: () => Promise<boolean>;
  copyName?: string;
  highlight?: boolean;
  /** Nhãn một dòng, giá trị dưới nhãn: tên ngân hàng/chủ tài khoản dài không chen sát nhãn. */
  stacked?: boolean;
  /** Số tiền lớn ở giữa, chỉ còn nút chép bên cạnh. */
  hero?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const press = () => {
    void onCopy?.().then((ok) => {
      if (!ok) return;
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    });
  };

  return (
    <Box
      flex
      alignItems={stacked ? 'flex-start' : 'center'}
      flexDirection={stacked ? 'column' : undefined}
      justifyContent={hero ? 'center' : 'space-between'}
      style={{ padding: '6px 0', borderTop: hero ? 'none' : '1px solid var(--color-border-subtle)', marginTop: hero ? 8 : 0 }}
    >
      {!hero && <Text size="small" style={{ color: 'var(--color-text-tertiary)' }}>{label}</Text>}
      <Box flex alignItems="center" style={{ gap: 6, minWidth: 0 }}>
        {hero ? (
          <Text bold size="large" style={{ color: 'var(--color-text-success)' }}>{value}</Text>
        ) : (
          <Text size="small" bold style={highlight ? { color: 'var(--color-text-success)' } : undefined}>{value}</Text>
        )}
        {onCopy && (
          <>
            {/* Nút giữ vùng chạm 44px nhưng lề âm để dòng không cao hơn 44px. */}
            <IconButton
              icon={copied ? Check : Copy}
              label={`Sao chép ${copyName ?? label}`}
              size="sm"
              onPress={press}
              style={{ margin: '-6px -10px -6px 0' }}
            />
            {copied && (
              <span role="status" style={SR_ONLY}>
                Đã sao chép {copyName ?? label}
              </span>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
