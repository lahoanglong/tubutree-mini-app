import { useState } from 'react';
import { Box, Page, Text, Button, Header, Spinner, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getGameProfile,
  checkIn,
  spin,
  getTodayQuiz,
  answerQuiz,
  waterTree,
  getLeaderboard,
  getMissions,
  type MissionItem,
} from '../services/game-api';
import { useAuthStore } from '../store/auth';
import { WheelOfFortune } from '../components/wheel';

export default function GamePage() {
  const { status, login } = useAuthStore();
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const authed = status === 'authenticated';

  const { data: profile, isLoading } = useQuery({
    queryKey: ['game', 'profile'],
    queryFn: getGameProfile,
    enabled: authed,
  });
  const { data: quiz } = useQuery({ queryKey: ['game', 'quiz'], queryFn: getTodayQuiz, enabled: authed });
  const { data: board } = useQuery({ queryKey: ['game', 'board'], queryFn: getLeaderboard });
  const { data: missions } = useQuery({ queryKey: ['game', 'missions'], queryFn: getMissions, enabled: authed });

  // Quiz nhiều câu/ngày: theo dõi câu đã trả lời client-side để hiện câu kế tiếp (§6.7.8).
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const currentQuiz = quiz?.find((q) => !answeredIds.has(q.id));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['game'] });
    void queryClient.invalidateQueries({ queryKey: ['me'] });
  };

  const checkInM = useMutation({
    mutationFn: checkIn,
    onSuccess: (r) => {
      openSnackbar({ text: `+${r.seedsEarned}💧 +${r.pointsEarned}đ ${r.bonusNote}`, type: 'success' });
      refresh();
    },
    onError: (e: unknown) => openSnackbar({ text: msg(e), type: 'error' }),
  });
  const handleSpin = async () => {
    try {
      const r = await spin();
      refresh();
      return r;
    } catch (e) {
      openSnackbar({ text: msg(e), type: 'error' });
      throw e;
    }
  };
  const waterM = useMutation({
    mutationFn: () => waterTree(20),
    onSuccess: (r) => {
      openSnackbar({
        text: r.harvested ? '🎉 Thu hoạch! Tubu trồng 1 cây thật 🌳' : `Đã tưới · ${r.progress}/${r.target}💧`,
        type: 'success',
      });
      refresh();
    },
    onError: (e: unknown) => openSnackbar({ text: msg(e), type: 'error' }),
  });
  const answerM = useMutation({
    mutationFn: ({ id, choice }: { id: string; choice: number }) => answerQuiz(id, choice),
    onSuccess: (r, vars) => {
      setAnsweredIds((prev) => new Set(prev).add(vars.id)); // sang câu kế tiếp
      openSnackbar({ text: r.isCorrect ? `Đúng! +${r.pointsEarned}đ` : 'Chưa đúng 😅', type: r.isCorrect ? 'success' : 'warning' });
      void queryClient.invalidateQueries({ queryKey: ['game', 'profile'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e: unknown) => openSnackbar({ text: msg(e), type: 'error' }),
  });

  if (!authed) {
    return (
      <Page className="page">
        <Header title="Vườn Xanh" showBackIcon={false} />
        <Box flex flexDirection="column" alignItems="center" p={8} style={{ gap: 12 }}>
          <Text style={{ fontSize: 56 }}>🌱</Text>
          <Text style={{ color: 'var(--neutral-600)' }}>Đăng nhập để chăm vườn & nhận thưởng</Text>
          <Button onClick={() => void login()} style={{ background: 'var(--green-600)' }}>
            Đăng nhập với Zalo
          </Button>
        </Box>
      </Page>
    );
  }

  if (isLoading) {
    return (
      <Page>
        <Header title="Vườn Xanh" showBackIcon={false} />
        <Box flex justifyContent="center" p={6}>
          <Spinner />
        </Box>
      </Page>
    );
  }

  const eco = profile?.ecoImpact;
  const pct = eco ? Math.min(100, Math.round((eco.progress / eco.target) * 100)) : 0;

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 80 }}>
      <Header title="Vườn Xanh Tubu" showBackIcon={false} />

      {/* Garden */}
      <Box
        p={5}
        style={{
          background: 'linear-gradient(160deg, var(--green-400), var(--green-700))',
          color: 'white',
          textAlign: 'center',
        }}
      >
        <Text style={{ fontSize: 72 }}>{pct >= 100 ? '🌳' : pct > 50 ? '🌿' : '🌱'}</Text>
        <Text style={{ color: 'white' }} bold>
          {eco?.treeType ?? 'Cây Dứa Fuwa3e'}
        </Text>
        <Box style={{ background: 'rgba(255,255,255,0.3)', borderRadius: 99, height: 8, margin: '10px 24px' }}>
          <Box style={{ width: `${pct}%`, height: 8, background: 'white', borderRadius: 99 }} />
        </Box>
        <Text size="xSmall" style={{ color: 'white' }}>
          {eco?.progress ?? 0}/{eco?.target ?? 600}💧 · 💧 {profile?.totalSeeds ?? 0} · 🔥 {profile?.streakDays ?? 0} ngày · 🌳 thật: {eco?.treesPlanted ?? 0}
        </Text>
      </Box>

      <Box p={3} style={{ display: 'flex', gap: 8 }}>
        <Button fullWidth loading={checkInM.isPending} onClick={() => checkInM.mutate()} style={{ background: 'var(--green-600)' }}>
          Điểm danh
        </Button>
        <Button fullWidth loading={waterM.isPending} variant="secondary" onClick={() => waterM.mutate()}>
          Tưới 20💧
        </Button>
      </Box>

      <Card title="🎡 Vòng quay may mắn">
        <WheelOfFortune cost={10} onSpin={handleSpin} />
      </Card>

      <Card title="🧠 Quiz Sống Xanh hôm nay">
        {currentQuiz ? (
          <>
            {quiz && quiz.length > 1 && (
              <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginBottom: 6 }}>
                Câu {answeredIds.size + 1}/{quiz.length}
              </Text>
            )}
            <QuizBlock
              q={currentQuiz}
              onAnswer={(choice) => answerM.mutate({ id: currentQuiz.id, choice })}
              pending={answerM.isPending}
            />
          </>
        ) : (
          <Text size="small" style={{ color: 'var(--neutral-400)' }}>
            Bạn đã hoàn thành quiz hôm nay 🎉
          </Text>
        )}
      </Card>

      <Card title="🎯 Nhiệm vụ">
        {missions && missions.length > 0 ? (
          missions.map((m: MissionItem) => (
            <Box key={m.code} style={{ padding: '8px 0', borderBottom: '1px solid var(--neutral-100)' }}>
              <Box flex alignItems="center" justifyContent="space-between">
                <Text size="small" bold={!m.completed} style={{ color: m.completed ? 'var(--neutral-400)' : 'var(--neutral-900)' }}>
                  {m.completed ? '✓ ' : ''}{m.title}
                </Text>
                <Text size="xSmall" style={{ color: 'var(--leaf-700)' }}>
                  +{m.rewardPoints}đ
                </Text>
              </Box>
              {m.description && (
                <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                  {m.description}
                </Text>
              )}
              <Box style={{ height: 6, background: 'var(--neutral-100)', borderRadius: 99, marginTop: 4, overflow: 'hidden' }}>
                <Box
                  style={{
                    width: `${Math.min(100, Math.round((m.progress / Math.max(1, m.goal)) * 100))}%`,
                    height: '100%',
                    background: m.completed ? 'var(--leaf-600)' : 'var(--primary-600)',
                  }}
                />
              </Box>
              <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 2 }}>
                {m.progress}/{m.goal}
              </Text>
            </Box>
          ))
        ) : (
          <Text size="small" style={{ color: 'var(--neutral-400)' }}>
            Chưa có nhiệm vụ.
          </Text>
        )}
      </Card>

      <Card title="🏆 Bảng xếp hạng tuần">
        {board?.map((r) => (
          <Box key={r.rank} flex justifyContent="space-between" style={{ padding: '4px 0' }}>
            <Text size="small">
              #{r.rank} {r.nickname}
            </Text>
            <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
              🔥{r.streak} · 🌳{r.treesPlanted}
            </Text>
          </Box>
        ))}
      </Card>
    </Page>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
      <Text bold size="small" style={{ marginBottom: 8 }}>
        {title}
      </Text>
      {children}
    </Box>
  );
}

function QuizBlock({
  q,
  onAnswer,
  pending,
}: {
  q: { question: string; options: string[] };
  onAnswer: (choice: number) => void;
  pending: boolean;
}) {
  return (
    <Box>
      <Text size="small" style={{ marginBottom: 8 }}>
        {q.question}
      </Text>
      <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {q.options.map((opt, i) => (
          <Button key={i} size="small" variant="secondary" disabled={pending} onClick={() => onAnswer(i)}>
            {opt}
          </Button>
        ))}
      </Box>
    </Box>
  );
}

function msg(e: unknown): string {
  const ax = e as { response?: { data?: { message?: string } }; message?: string };
  return ax?.response?.data?.message ?? ax?.message ?? 'Có lỗi xảy ra';
}
