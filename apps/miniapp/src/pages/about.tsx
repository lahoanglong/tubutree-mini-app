import { useState } from 'react';
import { Page, useNavigate, useSnackbar } from 'zmp-ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ExternalLink, TreePine } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { usePublicConfig } from '../hooks/use-public-config';
import { haptic } from '../utils/haptic';
import { formatPhoneDisplay } from '../utils/phone';
import { requestAccountDeletion } from '../services/account-api';
import { getErrorMessage } from '../services/api';
import type { PublicConfig } from '../services/shop-api';
import { openOAChat, hasOA, callPhone, openExternal } from '../services/zmp-bridge';
import { openWebPolicyPage, type WebPolicySlug } from '../utils/web-policy';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Chip } from '../components/ui/chip';
import { Icon } from '../components/ui/icon';
import { KeyValueRow } from '../components/ui/key-value-row';
import { ListRow } from '../components/ui/list-row';
import { PageHeader } from '../components/ui/page-header';
import { ScrollRow } from '../components/ui/scroll-row';
import { Skeleton } from '../components/ui/skeleton';
import { Heading, Text } from '../components/ui/text';
import { DEFAULT_SUPPORT, fallbackFaq, fetchFaqs, fetchSupportContact } from './about-data';

const ALL_CATS = 'Tất cả';

const POLICIES = {
  terms: {
    title: 'Điều khoản sử dụng',
    body: 'Khi sử dụng Tubu Tree, bạn đồng ý mua sắm đúng mục đích cá nhân, cung cấp thông tin chính xác và không lạm dụng ưu đãi/điểm thưởng. Tubu Tree có quyền tạm khoá tài khoản có dấu hiệu gian lận. Giá và khuyến mãi có thể thay đổi theo thời điểm; đơn hàng chỉ được xác nhận sau khi thanh toán/được duyệt.',
  },
  privacy: {
    title: 'Chính sách bảo mật',
    body: 'Tubu Tree thu thập tên, số điện thoại và địa chỉ nhận hàng để xử lý đơn và chăm sóc khách hàng. Chúng tôi KHÔNG bán hay chia sẻ dữ liệu cho bên thứ ba ngoài đối tác vận chuyển/thanh toán cần thiết. Bạn có thể yêu cầu xoá tài khoản & dữ liệu bất kỳ lúc nào trong mục Tài khoản.',
  },
} as const;
/** "Đơn vị vận hành: tên · MST mã · địa chỉ"; ẩn phần chưa nhập, null khi không còn gì. */
function operatorLine(company: PublicConfig['company']): string | null {
  const parts = [company?.legalName, company?.taxCode ? `MST ${company.taxCode}` : null, company?.address].filter(Boolean);
  return parts.length > 0 ? `Đơn vị vận hành: ${parts.join(' · ')}` : null;
}
type PolicyKey = keyof typeof POLICIES | 'returns';

/** Số ngày đổi trả đọc từ cấu hình công khai (cùng nguồn với FAQ ở about-data); chưa có thì không nêu con số. */
function returnsPolicy(returnWindowDays: unknown): { title: string; body: string } {
  const days = typeof returnWindowDays === 'number' && Number.isFinite(returnWindowDays) && returnWindowDays > 0 ? returnWindowDays : null;
  const window = days ? `trong ${days} ngày kể từ khi nhận` : 'trong thời hạn đổi/trả kể từ khi nhận';
  return {
    title: 'Chính sách đổi trả',
    body: `Đổi/trả áp dụng ${window}, với sản phẩm lỗi nhà sản xuất (hỏng bao bì, sai HSD, sai mã, không đúng mô tả). Gửi yêu cầu kèm ảnh minh chứng trong chi tiết đơn hàng. Tubu chịu phí ship 2 chiều cho lỗi từ nhà sản xuất; hoàn tiền vào Ví Tubu hoặc tài khoản ngân hàng bạn chọn sau khi duyệt.`,
  };
}

// Bản đầy đủ do admin quản lý nằm ở web (/chinh-sach/[loai]); bản tóm tắt trong app chỉ để đọc nhanh.
const WEB_POLICY_SLUG: Record<PolicyKey | 'shipping', WebPolicySlug> = {
  terms: 'dieu-khoan',
  privacy: 'bao-mat',
  returns: 'doi-tra',
  shipping: 'van-chuyen',
};
const openWebPolicy = (key: PolicyKey | 'shipping') => openWebPolicyPage(WEB_POLICY_SLUG[key]);

const FAQ_SKELETON_ROWS = 4;

function HotlineButton({ phone }: { phone: string }) {
  return (
    <button
      type="button"
      aria-label={`Hotline ${phone}, chạm để gọi`}
      onClick={() => void callPhone(phone)}
      style={{
        minHeight: 44,
        padding: '0 0 0 12px',
        border: 'none',
        background: 'none',
        font: 'inherit',
        fontWeight: 600,
        color: 'var(--color-text-brand)',
        cursor: 'pointer',
      }}
    >
      {phone}
    </button>
  );
}

export default function AboutPage() {
  const { openSnackbar } = useSnackbar();
  const { logout } = useAuthStore();
  const [open, setOpen] = useState<number | null>(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [faqCat, setFaqCat] = useState<string>(ALL_CATS);
  // FAQ do admin nhập (tab Câu hỏi thường gặp); chưa có dòng nào hoặc lỗi mạng thì dùng bản dự phòng.
  const faqQ = useQuery({ queryKey: ['faqs'], queryFn: fetchFaqs, staleTime: 10 * 60_000 });
  const publicConfig = usePublicConfig();
  const navigate = useNavigate();
  const supportQ = useQuery({ queryKey: ['support-contact'], queryFn: fetchSupportContact, staleTime: 10 * 60_000 });
  const faq = faqQ.data && faqQ.data.length > 0 ? faqQ.data : faqQ.isLoading ? [] : fallbackFaq(publicConfig);
  const faqCats = [ALL_CATS, ...new Set(faq.map((f) => f.cat))];
  const support = supportQ.isError ? DEFAULT_SUPPORT : supportQ.data;
  // Dòng chưa có giá trị thì ẩn hẳn (Q-17), không hiện nhãn trống.
  const supportRows = [
    { label: 'Hotline', value: support?.hotline ? formatPhoneDisplay(support.hotline) : support?.hotline },
    { label: 'Zalo OA', value: support?.zaloOaName },
    { label: 'Email', value: support?.email },
  ].filter((r): r is { label: string; value: string } => Boolean(r.value));

  // A1-03: nút này trước đây chỉ hiện snackbar giả, không gọi API nào. Giờ ghi nhận yêu cầu THẬT
  // (KHÔNG xoá ngay — CSKH xử lý thủ công) + mở sẵn Zalo OA để khách có thể trao đổi trực tiếp
  // luôn, thay vì chỉ chờ hotline gọi lại.
  const deleteM = useMutation({
    mutationFn: () => requestAccountDeletion(),
    onSuccess: (res) => {
      openSnackbar({ text: res.message, type: 'info' });
      if (hasOA) void openOAChat('Tôi muốn xoá tài khoản Tubu Tree');
      setConfirmDelete(false);
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  // Giữ policy sau khi đóng để nội dung sheet còn nguyên trong lúc trượt xuống (BottomSheet gỡ sau animation).
  const [policy, setPolicy] = useState<PolicyKey>('terms');
  const [policyOpen, setPolicyOpen] = useState(false);
  const showPolicy = (key: PolicyKey) => {
    setPolicy(key);
    setPolicyOpen(true);
  };
  const policyContent = policy === 'returns' ? returnsPolicy(publicConfig.returnWindowDays) : POLICIES[policy];
  const operator = operatorLine(publicConfig.company);
  const bctUrl = publicConfig.company?.bctNoticeUrl ?? null;
  const shownFaq = faq.filter((f) => faqCat === ALL_CATS || f.cat === faqCat);

  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Về Tubu Tree" />

      {/* Brand story */}
      <div style={{ margin: '12px 16px 0' }}>
        <div
          style={{
            background: 'linear-gradient(135deg, var(--color-action-primary-bg), var(--color-action-primary-bg-pressed))',
            borderRadius: 'var(--radius-card)',
            padding: 20,
          }}
        >
          <Icon icon={TreePine} size="lg" tone="inverse" />
          <Heading variant="title-md" as="h2" tone="inverse" style={{ marginTop: 8 }}>
            Sống Xanh An Lành
          </Heading>
          <Text variant="body-sm" tone="inverse" as="p" style={{ marginTop: 8 }}>
            Tubu Tree tin rằng mỗi lựa chọn tiêu dùng nhỏ đều là một hạt mầm cho thiên nhiên. Chúng
            tôi kết nối bạn với những thương hiệu Việt tử tế — minh bạch nguồn gốc, lành cho da, nhẹ
            với đất.
          </Text>
        </div>
      </div>

      {/* FAQ */}
      <Section title="Câu hỏi thường gặp">
        {/* Lọc theo nhóm */}
        <ScrollRow label="Nhóm câu hỏi" style={{ gap: 8, padding: '6px 0', marginBottom: 4 }}>
          {faqCats.map((c) => (
            <Chip
              key={c}
              selected={faqCat === c}
              onPress={() => {
                haptic('light');
                setFaqCat(c);
                setOpen(null);
              }}
              style={{ flex: '0 0 auto' }}
            >
              {c}
            </Chip>
          ))}
        </ScrollRow>
        {faqQ.isLoading && (
          <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '12px 0' }}>
            {Array.from({ length: FAQ_SKELETON_ROWS }, (_, i) => (
              <Skeleton key={i} height={16} width={i % 2 ? '70%' : '90%'} />
            ))}
          </div>
        )}
        {shownFaq.map((item, i) => {
          const expanded = open === i;
          return (
            <div
              key={item.q}
              style={{ borderBottom: i < shownFaq.length - 1 ? '1px solid var(--color-border-subtle)' : 'none' }}
            >
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`faq-answer-${i}`}
                className="tubu-press"
                onClick={() => {
                  haptic('light');
                  setOpen(expanded ? null : i);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  width: '100%',
                  minHeight: 44,
                  padding: '12px 0',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                <Text variant="body-sm" style={{ flex: 1, fontWeight: 600 }}>
                  {item.q}
                </Text>
                <Icon
                  icon={ChevronDown}
                  size="sm"
                  tone="muted"
                  style={{
                    transform: expanded ? 'rotate(180deg)' : 'none',
                    transition: 'transform var(--motion-enter)',
                    flexShrink: 0,
                  }}
                />
              </button>
              {expanded && (
                <div id={`faq-answer-${i}`} style={{ paddingBottom: 12 }}>
                  <Text variant="body-sm" tone="secondary" as="p">
                    {item.a}
                  </Text>
                </div>
              )}
            </div>
          );
        })}
      </Section>

      {/* Hỗ trợ */}
      {(supportRows.length > 0 || publicConfig.chat?.enabled === true) && (
        <Section title="Hỗ trợ khách hàng">
          {publicConfig.chat?.enabled === true && <LinkRow label="Chat với Tubu Tree" onClick={() => navigate('/chat')} last={supportRows.length === 0} />}
          {supportRows.map((r, i) => (
            <KeyValueRow
              key={r.label}
              label={r.label}
              value={r.label === 'Hotline' ? <HotlineButton phone={r.value} /> : r.value}
              style={{
                padding: '10px 0',
                borderBottom: i < supportRows.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
              }}
            />
          ))}
        </Section>
      )}

      {/* Pháp lý */}
      <Section title="Điều khoản & Chính sách">
        <LinkRow label="Điều khoản sử dụng" onClick={() => showPolicy('terms')} />
        <LinkRow label="Chính sách bảo mật" onClick={() => showPolicy('privacy')} />
        <LinkRow label="Chính sách đổi trả" onClick={() => showPolicy('returns')} />
        <LinkRow label="Chính sách vận chuyển" onClick={() => openWebPolicy('shipping')} external last={!operator && !bctUrl} />
        {bctUrl && <LinkRow label="Đã thông báo Bộ Công Thương" onClick={() => void openExternal(bctUrl)} external last={!operator} />}
        {operator && (
          <Text variant="caption" tone="tertiary" as="p" style={{ marginTop: 8 }}>
            {operator}
          </Text>
        )}
      </Section>

      {/* Nội dung điều khoản hiển thị ngay trong app (không rời mini app) */}
      <BottomSheet
        open={policyOpen}
        onClose={() => setPolicyOpen(false)}
        title={policyContent.title}
        footer={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Button fullWidth variant="secondary" onPress={() => openWebPolicy(policy)}>
              Xem bản đầy đủ trên web
            </Button>
            <Button fullWidth onPress={() => setPolicyOpen(false)}>
              Đã hiểu
            </Button>
          </div>
        }
      >
        <Text variant="body-sm" tone="secondary" as="p">
          {policyContent.body}
        </Text>
      </BottomSheet>

      {/* Xoá tài khoản */}
      <div style={{ margin: '12px 16px 0' }}>
        {!confirmDelete ? (
          <ListRow destructive title="Xoá tài khoản" onPress={() => setConfirmDelete(true)} style={{ justifyContent: 'center', textAlign: 'center' }} />
        ) : (
          <Card padding={16} style={{ background: 'var(--color-status-danger-bg)' }}>
            <Text variant="body-sm" tone="danger" as="p" style={{ fontWeight: 700 }}>
              Xoá tài khoản vĩnh viễn?
            </Text>
            <Text variant="caption" tone="secondary" as="p" style={{ marginTop: 4 }}>
              Gửi yêu cầu để CSKH liên hệ xác minh và xử lý xoá tài khoản theo quy định — tài khoản
              CHƯA bị xoá ngay khi bạn bấm nút này.
            </Text>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button variant="secondary" onPress={() => setConfirmDelete(false)} style={{ flex: 1 }}>
                Huỷ
              </Button>
              <Button variant="danger" loading={deleteM.isPending} onPress={() => deleteM.mutate()} style={{ flex: 1 }}>
                Gửi yêu cầu xoá
              </Button>
            </div>
          </Card>
        )}
      </div>

      <Text variant="caption" tone="tertiary" as="p" style={{ textAlign: 'center', marginTop: 12 }}>
        Tubu Tree Mini App · phiên bản 1.0.0
      </Text>

      <div style={{ padding: 16 }}>
        <Button fullWidth variant="secondary" onPress={() => void logout()}>
          Đăng xuất
        </Button>
      </div>
    </Page>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ margin: '12px 16px 0' }}>
      <Card padding={16}>
        <Text as="h2" style={{ fontWeight: 700, marginBottom: 8 }}>
          {title}
        </Text>
        {children}
      </Card>
    </div>
  );
}

function LinkRow({ label, onClick, last, external }: { label: string; onClick: () => void; last?: boolean; external?: boolean }) {
  return (
    <ListRow
      title={label}
      trailing={external ? <Icon icon={ExternalLink} size="sm" tone="muted" /> : 'chevron'}
      onPress={onClick}
      style={{ borderBottom: last ? 'none' : '1px solid var(--color-border-subtle)' }}
    />
  );
}
