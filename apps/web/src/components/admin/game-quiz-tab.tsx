'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ADMIN_QUIZ_PAGE_SIZE,
  createAdminQuiz,
  listAdminQuizzes,
  pageRange,
  QUIZ_CATEGORY_KEYS,
  QUIZ_DIFFICULTY_OPTIONS,
  updateAdminQuiz,
  type AdminQuiz,
  type AdminQuizInput,
} from '@/lib/admin-client';
import { categoryLabel } from '@/components/game/game-utils';
import { BTN_PRIMARY, BTN_SMALL, BTN_XS_SECONDARY, INPUT_CLASS, LoadError } from './ui';

const OPTION_SLOTS = 4;
const QUERY_KEY = ['admin-game-quiz'];

interface FormState {
  question: string;
  options: string[];
  correctSlot: number;
  category: string;
  difficulty: number;
  explanation: string;
}

const BLANK: FormState = { question: '', options: ['', '', '', ''], correctSlot: 0, category: 'nature', difficulty: 1, explanation: '' };

const fromQuiz = (q: AdminQuiz): FormState => ({
  question: q.question,
  options: Array.from({ length: OPTION_SLOTS }, (_, i) => q.options[i] ?? ''),
  correctSlot: q.correct,
  category: q.category,
  difficulty: q.difficulty,
  explanation: q.explanation ?? '',
});

/** Ô đáp án để trống bị bỏ qua; vị trí đáp án đúng đếm lại trên danh sách đã bỏ ô trống. */
function toInput(f: FormState): AdminQuizInput {
  const filled = f.options.map((o, slot) => ({ text: o.trim(), slot })).filter((o) => o.text !== '');
  return {
    question: f.question.trim(),
    options: filled.map((o) => o.text),
    correct: filled.findIndex((o) => o.slot === f.correctSlot),
    category: f.category,
    difficulty: f.difficulty,
    explanation: f.explanation.trim(),
  };
}

function problemOf(f: FormState): string | null {
  const input = toInput(f);
  if (!input.question) return 'Nhập câu hỏi.';
  if (input.options.length < 2) return 'Cần ít nhất 2 đáp án.';
  if (input.correct < 0) return 'Chọn đáp án đúng trong các đáp án đã nhập.';
  if (new Set(input.options.map((o) => o.toLowerCase())).size !== input.options.length) return 'Các đáp án không được trùng nhau.';
  return null;
}

/** Câu đố hằng ngày của Vườn Xanh: xem, thêm, sửa. Không xoá được vì khách đã trả lời các câu này. */
export function GameQuizAdmin() {
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: [...QUERY_KEY, page], queryFn: () => listAdminQuizzes(page), placeholderData: (prev) => prev });
  const rows = q.data?.data ?? [];
  const range = q.data ? pageRange(q.data.meta, q.data.meta.total, rows.length) : null;

  return (
    <section aria-labelledby="quiz-h" className="space-y-3">
      <h2 id="quiz-h" className="font-display text-lg font-semibold text-stone-900">Câu đố hằng ngày</h2>
      <p className="text-xs text-stone-600">
        Mỗi ngày khách nhận một bộ câu đố xoay vòng trong danh sách này. Câu mới vào vòng xoay ngay khi lưu nên có thể làm bộ câu của hôm nay đổi.
        Nước thưởng theo độ khó, không có thưởng điểm. Câu đố không xoá được; câu cần bỏ thì sửa lại nội dung.
      </p>
      {adding ? (
        <QuizForm
          title="Thêm câu đố"
          submitLabel="Thêm câu đố"
          initial={BLANK}
          save={(f) => createAdminQuiz(toInput(f))}
          onDone={() => {
            setAdding(false);
            setPage(1);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={BTN_XS_SECONDARY}>
          Thêm câu đố
        </button>
      )}
      {q.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {q.isError && <LoadError onRetry={() => void q.refetch()} retrying={q.isFetching}>Không tải được danh sách câu đố.</LoadError>}
      {q.data && rows.length === 0 && <p className="text-sm text-stone-500">Chưa có câu đố nào.</p>}
      <ul className="space-y-2">
        {rows.map((r) => (
          <QuizRow key={r.id} item={r} />
        ))}
      </ul>
      {range && q.data!.meta.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
          <span>{range.label}</span>
          {range.totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setPage(page - 1)} disabled={!range.hasPrev || q.isFetching} className={BTN_SMALL}>
                ← Trang trước
              </button>
              <span>
                Trang {page}/{range.totalPages}
              </span>
              <button type="button" onClick={() => setPage(page + 1)} disabled={!range.hasNext || q.isFetching} className={BTN_SMALL}>
                Trang sau →
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function QuizRow({ item }: { item: AdminQuiz }) {
  const [editing, setEditing] = useState(false);
  const diff = QUIZ_DIFFICULTY_OPTIONS.find((d) => d.value === item.difficulty);
  if (editing) {
    return (
      <li data-quiz={item.id}>
        <QuizForm
          title="Sửa câu đố"
          submitLabel="Lưu"
          initial={fromQuiz(item)}
          save={(f) => updateAdminQuiz(item.id, toInput(f))}
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }
  return (
    <li data-quiz={item.id} className="rounded-card border border-stone-200 bg-stone-0 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 break-words font-medium text-stone-900">{item.question}</p>
        <button type="button" onClick={() => setEditing(true)} className={BTN_XS_SECONDARY} aria-label={`Sửa câu đố: ${item.question}`}>
          Sửa
        </button>
      </div>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs text-stone-700">
        {item.options.map((o, i) => (
          <li key={i} className={i === item.correct ? 'font-semibold text-success-fg' : undefined}>
            {o}
            {i === item.correct ? ' (đáp án đúng)' : ''}
          </li>
        ))}
      </ol>
      <p className="mt-1 text-xs text-stone-500">
        {categoryLabel(item.category)} · {diff?.label ?? `Độ khó ${item.difficulty}`} · thưởng {item.waterReward} nước
      </p>
      {item.explanation && <p className="mt-1 break-words text-xs text-stone-600">{item.explanation}</p>}
    </li>
  );
}

function QuizForm({
  title,
  submitLabel,
  initial,
  save,
  onDone,
  onCancel,
}: {
  title: string;
  submitLabel: string;
  initial: FormState;
  save: (f: FormState) => Promise<unknown>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const problem = problemOf(f);
  const submit = useMutation({
    mutationFn: () => save(f),
    onSuccess: () => {
      setErr(null);
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
      onDone();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Không lưu được câu đố.'),
  });
  const water = QUIZ_DIFFICULTY_OPTIONS.find((d) => d.value === f.difficulty)?.water;

  return (
    <form
      aria-label={title}
      className="space-y-2 rounded-card border border-stone-200 bg-stone-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem) submit.mutate();
      }}
    >
      <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
      <label className="block text-xs text-stone-600">
        <span className="mb-1 block">Câu hỏi</span>
        <textarea name="question" rows={2} maxLength={300} value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} className={INPUT_CLASS} />
      </label>
      <fieldset className="space-y-1">
        <legend className="text-xs text-stone-600">Đáp án (2 đến 4, chọn nút tròn ở đáp án đúng)</legend>
        {f.options.map((o, slot) => (
          <div key={slot} className="flex items-center gap-2">
            <input
              type="radio"
              name="correct"
              checked={f.correctSlot === slot}
              onChange={() => setF({ ...f, correctSlot: slot })}
              aria-label={`Đáp án ${slot + 1} là đáp án đúng`}
              className="h-5 w-5 shrink-0"
            />
            <input
              name={`option-${slot + 1}`}
              aria-label={`Đáp án ${slot + 1}`}
              maxLength={120}
              value={o}
              onChange={(e) => setF({ ...f, options: f.options.map((x, i) => (i === slot ? e.target.value : x)) })}
              className={INPUT_CLASS}
            />
          </div>
        ))}
      </fieldset>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-stone-600">
          <span className="mb-1 block">Chủ đề</span>
          <select name="category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={`${INPUT_CLASS} min-h-[44px] sm:min-h-0`}>
            {QUIZ_CATEGORY_KEYS.map((k) => (
              <option key={k} value={k}>
                {categoryLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-stone-600">
          <span className="mb-1 block">Độ khó</span>
          <select name="difficulty" value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: Number(e.target.value) })} className={`${INPUT_CLASS} min-h-[44px] sm:min-h-0`}>
            {QUIZ_DIFFICULTY_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label} (thưởng {d.water} nước)
              </option>
            ))}
          </select>
        </label>
      </div>
      {water !== undefined && <p className="text-xs text-stone-600">Khách đáp đúng nhận {water} nước, không nhận điểm.</p>}
      <label className="block text-xs text-stone-600">
        <span className="mb-1 block">Giải thích sau khi trả lời (không bắt buộc)</span>
        <textarea name="explanation" rows={2} maxLength={500} value={f.explanation} onChange={(e) => setF({ ...f, explanation: e.target.value })} className={INPUT_CLASS} />
      </label>
      {problem && <p className="text-xs text-warning-fg">{problem}</p>}
      {err && <p role="alert" className="text-xs text-danger-fg">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!!problem || submit.isPending} className={BTN_PRIMARY}>
          {submit.isPending ? 'Đang lưu…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className={BTN_XS_SECONDARY}>
          Đóng
        </button>
      </div>
    </form>
  );
}
