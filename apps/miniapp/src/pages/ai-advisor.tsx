import { useState } from 'react';
import { Box, Page, Text, Button, Input, Spinner, useNavigate, useSnackbar } from 'zmp-ui';
import { useMutation } from '@tanstack/react-query';
import { aiChat, type AiChatTurn, type AiProduct } from '../services/ai-api';

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

function msg(e: unknown): string {
  const ax = e as { response?: { data?: { message?: string } }; message?: string };
  return ax?.response?.data?.message ?? ax?.message ?? 'Có lỗi xảy ra';
}

export default function AiAdvisorPage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');

  const chatM = useMutation({
    mutationFn: (text: string) => {
      const history: AiChatTurn[] = messages.map((m) => ({ role: m.role, content: m.content }));
      return aiChat(text, history);
    },
    onSuccess: (r) => {
      setMessages((prev) => [...prev, { role: 'assistant', content: r.reply, products: r.products }]);
    },
    onError: (e: unknown) => {
      openSnackbar({ text: msg(e), type: 'error' });
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
    <Page className="page" style={{ background: 'var(--neutral-50)', display: 'flex', flexDirection: 'column', paddingBottom: 0 }}>
      <Box p={3} style={{ background: 'var(--neutral-0)' }}>
        <Text bold size="large">✨ Trợ lý Tubu</Text>
        <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
          Tư vấn sản phẩm tiêu dùng xanh 24/7
        </Text>
      </Box>

      <Box style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {messages.length === 0 && (
          <Box style={{ textAlign: 'center', padding: '24px 12px' }}>
            <Text style={{ fontSize: 48 }}>🌿</Text>
            <Text size="small" style={{ color: 'var(--neutral-600)', marginTop: 8 }}>
              Chào bạn! Mình là trợ lý của Tubu Tree. Bạn cần tư vấn gì nào?
            </Text>
            <Box mt={3} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {SUGGESTIONS.map((s) => (
                <Box
                  key={s}
                  className="tubu-press"
                  onClick={() => send(s)}
                  p={2}
                  style={{ background: 'var(--leaf-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--leaf-400)' }}
                >
                  <Text size="small" style={{ color: 'var(--leaf-700)' }}>{s}</Text>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {messages.map((m, i) => (
          <Box key={i} style={{ marginBottom: 12, textAlign: m.role === 'user' ? 'right' : 'left' }}>
            <Box
              style={{
                display: 'inline-block',
                maxWidth: '85%',
                textAlign: 'left',
                padding: '8px 12px',
                borderRadius: 'var(--radius-lg)',
                background: m.role === 'user' ? 'var(--leaf-600)' : 'var(--neutral-0)',
                color: m.role === 'user' ? 'var(--neutral-0)' : 'var(--neutral-900)',
              }}
            >
              <Text size="small" style={{ color: m.role === 'user' ? 'var(--neutral-0)' : 'var(--neutral-900)', whiteSpace: 'pre-wrap' }}>
                {m.content}
              </Text>
            </Box>
            {m.products && m.products.length > 0 && (
              <Box mt={2} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {m.products.map((p) => (
                  <Box
                    key={p.id}
                    className="tubu-press"
                    onClick={() => navigate(`/product/${p.slug}`)}
                    flex
                    alignItems="center"
                    style={{ gap: 8, background: 'var(--neutral-0)', borderRadius: 'var(--radius-md)', padding: 8, border: '1px solid var(--neutral-100)' }}
                  >
                    {p.thumbnail ? (
                      <img src={p.thumbnail} alt={p.name} style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover' }} />
                    ) : (
                      <Box style={{ width: 44, height: 44, borderRadius: 8, background: 'var(--leaf-50)', display: 'grid', placeItems: 'center' }}>🌿</Box>
                    )}
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Text size="xSmall" bold style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</Text>
                      <Text size="xSmall" style={{ color: 'var(--leaf-700)' }}>
                        {(p.salePrice ?? p.basePrice).toLocaleString('vi-VN')}đ
                      </Text>
                    </Box>
                    <Text style={{ color: 'var(--neutral-400)' }}>›</Text>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        ))}

        {chatM.isPending && (
          <Box flex alignItems="center" style={{ gap: 8 }}>
            <Spinner /> <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>Trợ lý đang soạn…</Text>
          </Box>
        )}
      </Box>

      <Box p={2} flex style={{ gap: 8, background: 'var(--neutral-0)', borderTop: '1px solid var(--neutral-100)' }}>
        <Input
          placeholder="Nhập câu hỏi…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
        />
        <Button
          size="small"
          disabled={!draft.trim() || chatM.isPending}
          loading={chatM.isPending}
          onClick={() => send(draft)}
          style={{ background: 'var(--leaf-600)' }}
        >
          Gửi
        </Button>
      </Box>
    </Page>
  );
}
