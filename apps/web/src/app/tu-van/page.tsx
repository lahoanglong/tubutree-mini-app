'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { ChevronRight, Sparkles, Sprout } from 'lucide-react';
import { aiChat, type AiChatTurn, type AiProduct } from '@tubutree/app-core/api/ai';
import { coreHttp } from '@/lib/core-http';
import { useAuthPhase } from '@/lib/auth-phase';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { usePublicConfig } from '@/lib/use-public-config';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { GameNoticeBar, useGameNotice } from '@/components/game/game-notice';
import { PageHeader } from '@/components/ui/page-header';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  products?: AiProduct[];
  /** Tin xin lỗi do lần gọi trước thất bại: không đưa vào lịch sử khi thử lại, và là chỗ gắn nút "Thử lại". */
  failed?: boolean;
}

const SUGGESTIONS = [
  'Nước rửa chén nào an toàn cho bé?',
  'Mình cần sản phẩm tẩy rửa nhà bếp xanh',
  'Gợi ý quà tặng sống xanh',
];

const SORRY = 'Xin lỗi, mình chưa trả lời được lúc này 🌿';

// BE (ChatDto.history) chỉ cho tối đa 200 lượt và chỉ thực dùng 6 lượt gần nhất (AiAdvisorService
// MAX_HISTORY) — gửi cả lịch sử chat vừa tốn băng thông vừa có thể vượt cap sau phiên chat dài,
// khiến MỌI tin nhắn sau đó bị 400 và tính năng hỏng hẳn cho tới khi reload. Cắt còn cửa sổ gần nhất.
const MAX_HISTORY_TURNS = 20;

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

const toHistory = (list: ChatMessage[]): AiChatTurn[] =>
  list.slice(-MAX_HISTORY_TURNS).map((m) => ({ role: m.role, content: m.content }));

function ProductRow({ p }: { p: AiProduct }) {
  return (
    <Link href={`/san-pham/${p.slug}`} className={`${ui.card} flex min-h-11 items-center gap-3 p-2 hover:bg-stone-50`}>
      {p.thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element -- ảnh do server tư vấn trả về, miền không cố định
        <img src={p.thumbnail} alt={p.name} className="h-11 w-11 shrink-0 rounded-control object-cover" />
      ) : (
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-forest-50 text-forest-600">
          <Sprout className="h-5 w-5" aria-hidden="true" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-stone-900">{p.name}</div>
        <div className="text-xs font-semibold text-forest-700">{formatVnd(p.salePrice ?? p.basePrice)}</div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-stone-500" aria-hidden="true" />
    </Link>
  );
}

function Advisor() {
  const { notice, notify } = useGameNotice();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const chatM = useMutation({
    mutationFn: ({ text, history }: { text: string; history: AiChatTurn[] }) => aiChat(coreHttp, text, history),
    onSuccess: (r) => {
      setMessages((prev) => [...prev, { role: 'assistant', content: r.reply, products: r.products }]);
    },
    onError: (e: unknown) => {
      notify(errText(e), 'error');
      setMessages((prev) => [...prev, { role: 'assistant', content: SORRY, failed: true }]);
    },
  });

  // Tin mới (của bạn, trả lời, hay trạng thái "đang soạn") phải hiện trong tầm nhìn mà khách không phải tự kéo xuống.
  useEffect(() => {
    if (messages.length === 0) return;
    const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    endRef.current?.scrollIntoView?.({ block: 'end', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [messages.length, chatM.isPending]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || chatM.isPending) return;
    setMessages((prev) => [...prev, { role: 'user', content: t }]);
    setDraft('');
    chatM.mutate({ text: t, history: toHistory(messages) });
  };

  // Gửi lại đúng câu hỏi vừa lỗi: bỏ tin xin lỗi, giữ tin của khách (không nhân đôi), lịch sử là các lượt trước câu đó.
  const retry = (failedIndex: number) => {
    const question = messages[failedIndex - 1];
    if (chatM.isPending || question?.role !== 'user') return;
    setMessages(messages.slice(0, failedIndex));
    chatM.mutate({ text: question.content, history: toHistory(messages.slice(0, failedIndex - 1)) });
  };

  // Enter gửi, Shift+Enter xuống dòng. Bộ gõ tiếng Việt dùng Enter để chốt chữ đang gõ dở (isComposing / keyCode 229): không gửi lúc đó.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    send(draft);
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col">
      <div role="log" aria-label="Cuộc trò chuyện" className="min-h-[50vh] py-3">
        {messages.length === 0 && (
          <div className="px-3 py-8 text-center">
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full border border-stone-200 bg-forest-50 text-forest-600 shadow-card">
              <Sparkles className="h-6 w-6" aria-hidden="true" />
            </div>
            <h2 className={ui.sectionTitle}>Chào bạn! Mình là Trợ lý Tubu</h2>
            <p className="mt-1 text-sm text-stone-600">Bạn đang tìm giải pháp hay sản phẩm sinh học an lành nào cho gia đình?</p>
            <div className="mt-5 flex flex-col gap-2.5 text-left">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className={`${ui.card} min-h-11 px-4 py-3 text-left text-sm text-stone-900 hover:bg-stone-50`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`mb-3 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
            <div
              className={`inline-block max-w-[85%] whitespace-pre-wrap break-words rounded-card px-3 py-2 text-left text-sm ${
                m.role === 'user' ? 'bg-forest-600 text-stone-0' : 'bg-stone-0 text-stone-900 shadow-card'
              }`}
            >
              {m.content}
            </div>
            {m.failed && i === messages.length - 1 && !chatM.isPending && (
              <div className="mt-1.5">
                <button type="button" className={ui.btnSecondary} onClick={() => retry(i)}>
                  Thử lại
                </button>
              </div>
            )}
            {m.products && m.products.length > 0 && (
              <div className="mt-2 flex max-w-md flex-col gap-1.5 text-left">
                {m.products.map((p) => (
                  <ProductRow key={p.id} p={p} />
                ))}
              </div>
            )}
          </div>
        ))}

        {chatM.isPending && (
          <div role="status" className="text-xs text-stone-600">
            Trợ lý đang soạn…
          </div>
        )}
        <div ref={endRef} aria-hidden="true" />
      </div>

      <p className="py-1 text-center text-xs text-stone-600">Gợi ý chỉ để tham khảo.</p>

      <div className="sticky bottom-16 flex items-end gap-2 border-t border-stone-200 bg-stone-0 p-2 md:bottom-0">
        <textarea
          className={`${ui.field} min-w-0 flex-1 resize-none py-2`}
          placeholder="Nhập câu hỏi…"
          aria-label="Nhập câu hỏi"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={500}
        />
        {/* Không gộp isPending vào disabled: nút báo đang bận bằng aria-busy, bấm lại thì send() tự chặn. */}
        <button type="button" className={ui.btnPrimary} disabled={!draft.trim()} aria-busy={chatM.isPending} onClick={() => send(draft)}>
          Gửi
        </button>
      </div>
      <GameNoticeBar notice={notice} />
    </div>
  );
}

export default function AdvisorPage() {
  const phase = useAuthPhase();
  const router = useRouter();
  const cfg = usePublicConfig();
  const aiOff = cfg.isLoaded && cfg.aiAdvisorEnabled !== true;

  // Link cũ/đã lưu tới trang khi AI bị tắt: đưa về Trang chủ thay vì để khách gõ rồi nhận lỗi.
  useEffect(() => {
    if (aiOff) router.replace('/');
  }, [aiOff, router]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 pb-24">
      <PageHeader title="Trợ lý AI Tubu" subtitle="Tư vấn sản phẩm tiêu dùng xanh 24/7" />
      <div className="mt-4">
        {aiOff ? null : (
          <>
            {phase === 'loading' && <AuthLoading />}
            {phase === 'unavailable' && <SessionUnavailable />}
            {phase === 'guest' && <LoginRequired message="Đăng nhập để hỏi Trợ lý AI" returnTo="/tu-van" />}
            {phase === 'authenticated' && <Advisor />}
          </>
        )}
      </div>
    </main>
  );
}
