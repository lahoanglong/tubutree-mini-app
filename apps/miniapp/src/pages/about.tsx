import { useState } from 'react';
import { Page, useNavigate, useSnackbar } from 'zmp-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, TreePine } from 'lucide-react';
import { usePublicConfig } from '../hooks/use-public-config';
import { haptic } from '../utils/haptic';
import { formatPhoneDisplay } from '../utils/phone';
import { formatVnd } from '../utils/format';
import { getWallet, requestAccountDeletion } from '../services/account-api';
import {
  WALLET_FORFEIT_AGREE,
  WALLET_FORFEIT_LOADING,
  WALLET_FORFEIT_UNKNOWN,
  canSubmitDeletion,
  walletForfeitConsent,
  walletForfeitNotice,
} from '../utils/account-deletion-copy';
import { getErrorMessage } from '../services/api';
import type { PublicConfig } from '../services/shop-api';
import { openOAChat, hasOA, callPhone } from '../services/zmp-bridge';
import type { WebPolicySlug } from '../utils/web-policy';
import { PolicySheet } from '../components/policy-sheet';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Chip } from '../components/ui/chip';
import { Checkbox } from '../components/ui/form';
import { Icon } from '../components/ui/icon';
import { KeyValueRow } from '../components/ui/key-value-row';
import { ListRow } from '../components/ui/list-row';
import { PageHeader } from '../components/ui/page-header';
import { ScrollRow } from '../components/ui/scroll-row';
import { Skeleton } from '../components/ui/skeleton';
import { Heading, Text } from '../components/ui/text';
import { DEFAULT_SUPPORT, fallbackFaq, fetchFaqs, fetchSupportContact } from './about-data';

const ALL_CATS = 'Tất cả';

/** "Đơn vị vận hành: tên · MST mã · địa chỉ"; ẩn phần chưa nhập, null khi không còn gì. */
function operatorLine(company: PublicConfig['company']): string | null {
  const parts = [company?.legalName, company?.taxCode ? `MST ${company.taxCode}` : null, company?.address].filter(Boolean);
  return parts.length > 0 ? `Đơn vị vận hành: ${parts.join(' · ')}` : null;
}
const FAQ_SKELETON_ROWS = 4;

function HotlineButton({ phone }: { phone: string }) {
  return (
    <button
      type="button"
      aria-label={`Hotline ${phone}, chạm để gọi`}
      onClick={() => void callPhone(phone)}
      style={{
        minHeight: 44,
        padding: 0,
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
  const [open, setOpen] = useState<number | null>(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [forfeitAgreed, setForfeitAgreed] = useState(false);
  const qc = useQueryClient();
  const walletQ = useQuery({ queryKey: ['wallet'], queryFn: getWallet, enabled: confirmDelete });
  const walletBalance = walletQ.data?.walletBalance;
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
    mutationFn: () => requestAccountDeletion(undefined, walletForfeitConsent(walletBalance, forfeitAgreed)),
    onSuccess: (res) => {
      openSnackbar({ text: res.message, type: 'info' });
      if (hasOA) void openOAChat('Tôi muốn xoá tài khoản Tubu Tree');
      setConfirmDelete(false);
    },
    onError: (e: unknown) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      setForfeitAgreed(false);
      void qc.invalidateQueries({ queryKey: ['wallet'] });
    },
  });
  const [policy, setPolicy] = useState<WebPolicySlug | null>(null);
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
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: i < supportRows.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
              }}
            />
          ))}
        </Section>
      )}

      {/* Pháp lý */}
      <Section title="Điều khoản & Chính sách">
        <LinkRow label="Điều khoản sử dụng" onClick={() => setPolicy('dieu-khoan')} />
        <LinkRow label="Chính sách bảo mật" onClick={() => setPolicy('bao-mat')} />
        <LinkRow label="Chính sách đổi trả" onClick={() => setPolicy('doi-tra')} />
        <LinkRow label="Chính sách vận chuyển" onClick={() => setPolicy('van-chuyen')} last={!operator && !bctUrl} />
        {bctUrl && (
          <Text variant="body-sm" tone="secondary" as="p" style={{ margin: '12px 0 0' }}>
            Đã thông báo Bộ Công Thương
          </Text>
        )}
        {operator && (
          <Text variant="caption" tone="tertiary" as="p" style={{ marginTop: 8 }}>
            {operator}
          </Text>
        )}
      </Section>

      {/* Nội dung điều khoản hiển thị ngay trong app (không rời mini app) */}
      <PolicySheet slug={policy} onClose={() => setPolicy(null)} />

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
            {walletQ.isLoading && (
              <Text variant="caption" tone="secondary" as="p" style={{ marginTop: 8 }}>
                {WALLET_FORFEIT_LOADING}
              </Text>
            )}
            {walletQ.isError && (
              <div role="alert" style={{ marginTop: 8 }}>
                <Text variant="caption" tone="danger" as="p">
                  {WALLET_FORFEIT_UNKNOWN}
                </Text>
              </div>
            )}
            {walletBalance !== undefined && walletBalance > 0 && (
              <div style={{ marginTop: 12 }}>
                <Text variant="body-sm" as="p" style={{ fontWeight: 700 }}>
                  {walletForfeitNotice(formatVnd(walletBalance))}
                </Text>
                <div style={{ marginTop: 8 }}>
                  <Checkbox checked={forfeitAgreed} onChange={() => setForfeitAgreed((v) => !v)} label={WALLET_FORFEIT_AGREE} />
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button
                variant="secondary"
                onPress={() => {
                  setConfirmDelete(false);
                  setForfeitAgreed(false);
                }}
                style={{ flex: '0 0 96px' }}
              >
                Huỷ
              </Button>
              <Button
                variant="danger"
                loading={deleteM.isPending}
                disabled={!canSubmitDeletion(walletBalance, forfeitAgreed)}
                onPress={() => deleteM.mutate()}
                style={{ flex: 1 }}
              >
                Gửi yêu cầu xoá
              </Button>
            </div>
          </Card>
        )}
      </div>

      <div style={{ height: 16 }} />
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

function LinkRow({ label, onClick, last }: { label: string; onClick: () => void; last?: boolean }) {
  return (
    <ListRow
      title={label}
      trailing="chevron"
      onPress={onClick}
      style={{ borderBottom: last ? 'none' : '1px solid var(--color-border-subtle)' }}
    />
  );
}
