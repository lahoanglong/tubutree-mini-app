import { useState } from 'react';
import { Page, Input, Spinner, useNavigate, useSnackbar } from 'zmp-ui';
import { useMutation } from '@tanstack/react-query';
import { aiChat, type AiChatTurn, type AiProduct } from '../services/ai-api';
import { getErrorMessage } from '../services/api';
import { formatVnd } from '../utils/format';
import { Sparkles, Sprout } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Icon } from '../components/ui/icon';
import { ListRow } from '../components/ui/list-row';
import { PageHeader } from '../components/ui/page-header';
import { Heading, Text } from '../components/ui/text';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  products?: AiProduct[];
}

const SUGGESTIONS = [
  'Nước rửa chén nào an toàn cho bé?',
  'Mình cần sản phẩm tẩy rửa nhà bếp xanh',
  'Gợi ý quà tặng sống xanh',
];

// BE (ChatDto.history) chỉ cho tối đa 200 lượt và chỉ thực dùng 6 lượt gần nhất (AiAdvisorService
// MAX_HISTORY) — gửi cả lịch sử chat vừa tốn băng thông vừa có thể vượt cap sau phiên chat dài,
// khiến MỌI tin nhắn sau đó bị 400 và tính năng hỏng hẳn cho tới khi reload. Cắt còn cửa sổ gần nhất.
const MAX_HISTORY_TURNS = 20;

export default function AiAdvisorPage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');

  const chatM = useMutation({
    mutationFn: (text: string) => {
      const history: AiChatTurn[] = messages
        .slice(-MAX_HISTORY_TURNS)
        .map((m) => ({ role: m.role, content: m.content }));
      return aiChat(text, history);
    },
    onSuccess: (r) => {
      setMessages((prev) => [...prev, { role: 'assistant', content: r.reply, products: r.products }]);
    },
    onError: (e: unknown) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Xin lỗi, mình chưa trả lời được lúc này 🌿' }]);
    },
  });

  const send = (text: string) => {
    const t = text.trim();
    if (!t || chatM.isPending) return;
    setMessages((prev) => [...prev, { role: 'user', content: t }]);
    setDraft('');
    chatM.mutate(t);
  };

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', display: 'flex', flexDirection: 'column', paddingBottom: 0 }}>
      <PageHeader title="Trợ lý AI Tubu" subtitle="Tư vấn sản phẩm tiêu dùng xanh 24/7" />

      <div
        role="log"
        aria-label="Cuộc trò chuyện"
        style={{ flex: 1, overflowY: 'auto', padding: 12 }}
      >
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px 12px' }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: 'var(--color-action-secondary-bg)',
                border: '1px solid var(--color-border-subtle)',
                boxShadow: 'var(--elevation-1)',
                display: 'grid',
                placeItems: 'center',
                margin: '0 auto 12px',
              }}
            >
              <Icon icon={Sparkles} size="lg" tone="brand" />
            </div>
            <Heading variant="title-md" as="h2">Chào bạn! Mình là Trợ lý Tubu</Heading>
            <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 4 }}>
              Bạn đang tìm giải pháp hay sản phẩm sinh học an lành nào cho gia đình?
            </Text>
            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
              {SUGGESTIONS.map((s) => (
                <Card key={s} variant="outline" padding={0}>
                  <ListRow title={s} onPress={() => send(s)} style={{ padding: '12px 16px' }} />
                </Card>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 12, textAlign: m.role === 'user' ? 'right' : 'left' }}>
            <div
              style={{
                display: 'inline-block',
                maxWidth: '85%',
                textAlign: 'left',
                padding: '8px 12px',
                borderRadius: 'var(--radius-card)',
                background: m.role === 'user' ? 'var(--color-action-primary-bg)' : 'var(--color-bg-surface)',
              }}
            >
              <Text
                variant="body-sm"
                tone={m.role === 'user' ? 'inverse' : 'primary'}
                as="div"
                style={{ whiteSpace: 'pre-wrap' }}
              >
                {m.content}
              </Text>
            </div>
            {m.products && m.products.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left' }}>
                {m.products.map((p) => (
                  <Card key={p.id} variant="outline" padding={0}>
                    <ListRow
                      icon={
                        p.thumbnail ? (
                          <img
                            src={p.thumbnail}
                            alt={p.name}
                            style={{ width: 44, height: 44, borderRadius: 'var(--radius-control)', objectFit: 'cover', flexShrink: 0 }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 'var(--radius-control)',
                              background: 'var(--color-action-secondary-bg)',
                              display: 'grid',
                              placeItems: 'center',
                              flexShrink: 0,
                            }}
                          >
                            <Icon icon={Sprout} size="md" tone="brand" />
                          </div>
                        )
                      }
                      title={
                        <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {p.name}
                        </span>
                      }
                      subtitle={<Text variant="caption" tone="brand">{formatVnd(p.salePrice ?? p.basePrice)}</Text>}
                      trailing="chevron"
                      onPress={() => navigate(`/product/${p.slug}`)}
                      style={{ padding: 8 }}
                    />
                  </Card>
                ))}
              </div>
            )}
          </div>
        ))}

        {chatM.isPending && (
          <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Spinner /> <Text variant="caption" tone="tertiary">Trợ lý đang soạn…</Text>
          </div>
        )}
      </div>

      <div
        style={{
          padding: 8,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          background: 'var(--color-bg-surface)',
          borderTop: '1px solid var(--color-border-subtle)',
        }}
      >
        <Input
          placeholder="Nhập câu hỏi…"
          aria-label="Nhập câu hỏi"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
        />
        {/* Không gộp isPending vào disabled: Button tự chặn bấm lại khi loading, còn disabled sẽ tắt luôn spinner. */}
        <Button disabled={!draft.trim()} loading={chatM.isPending} onPress={() => send(draft)}>
          Gửi
        </Button>
      </div>
    </Page>
  );
}
