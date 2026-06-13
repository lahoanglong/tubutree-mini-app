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
  getForest,
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
  const { data: forest } = useQuery({ queryKey: ['game', 'forest'], queryFn: getForest, enabled: authed });

  // Quiz nhiều câu/ngày: theo dõi câu đã trả lời client-side để hiện câu kế tiếp (§6.7.8).
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const currentQuiz = quiz?.find((q) => !answeredIds.has(q.id));
  const [harvested, setHarvested] = useState(false);
  const [harvestCoupon, setHarvestCoupon] = useState<string | null>(null);
  const [harvestCert, setHarvestCert] = useState<string | null>(null);

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
      if (r.harvested) {
        setHarvestCoupon(r.reward?.coupon ?? null);
        setHarvestCert(r.reward?.certificate ?? null);
        setHarvested(true); // mở modal celebration
      } else {
        openSnackbar({ text: `Đã tưới · ${r.progress}/${r.target}💧`, type: 'success' });
      }
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['game', 'forest'] });
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
        <Text style={{ fontSize: 72 }} className="tubu-sway">{pct >= 100 ? '🌳' : pct > 50 ? '🌿' : '🌱'}</Text>
        <Text style={{ color: 'white' }} bold>
          {eco?.treeType ?? 'Vườn của bạn'}
        </Text>
        <Box style={{ background: 'rgba(255,255,255,0.3)', borderRadius: 99, height: 8, margin: '10px 24px' }}>
          <Box style={{ width: `${pct}%`, height: 8, background: 'white', borderRadius: 99, transition: 'width var(--dur-slow) var(--ease-out)' }} />
        </Box>
        <Text size="xSmall" style={{ color: 'white' }}>
          {eco?.progress ?? 0}/{eco?.target ?? 0}💧 · 💧 {profile?.totalSeeds ?? 0} · 🔥 {profile?.streakDays ?? 0} ngày · 🌳 thật: {eco?.treesPlanted ?? 0}
        </Text>
      </Box>

      {/* Điểm danh — chuỗi 7 ngày (§6.7.2) */}
      <Box p={3} style={{ background: 'var(--neutral-0)' }}>
        <Box flex alignItems="center" justifyContent="space-between" mb={2}>
          <Text size="small" bold>
            🔥 Điểm danh chuỗi {profile?.streakDays ?? 0} ngày
          </Text>
          <Button size="small" loading={checkInM.isPending} onClick={() => checkInM.mutate()} style={{ background: 'var(--leaf-600)' }}>
            Điểm danh
          </Button>
        </Box>
        <Box flex style={{ gap: 6 }}>
          {Array.from({ length: 7 }, (_, i) => {
            const day = i + 1;
            const done = (profile?.streakDays ?? 0) % 7 === 0 && (profile?.streakDays ?? 0) > 0 ? true : day <= ((profile?.streakDays ?? 0) % 7);
            const bonus = day === 3 || day === 7;
            return (
              <Box key={i} style={{ flex: 1, textAlign: 'center' }}>
                <Box
                  style={{
                    height: 32,
                    borderRadius: 'var(--radius-md)',
                    background: done ? 'var(--leaf-600)' : 'var(--neutral-100)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: done ? '#fff' : 'var(--neutral-400)',
                    fontSize: 13,
                  }}
                >
                  {done ? '💧' : bonus ? '🎁' : day}
                </Box>
                <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                  N{day}
                </Text>
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box p={3}>
        <Button fullWidth loading={waterM.isPending} variant="secondary" onClick={() => waterM.mutate()}>
          🚿 Tưới cây (20💧)
        </Button>
      </Box>

      {/* Tác động xanh (§6.7.7 — phần khả thi từ treesPlanted) */}
      <Card title="🌍 Tác động xanh của bạn">
        <Box flex style={{ gap: 10 }}>
          <EcoStat icon="🌳" value={String(eco?.treesPlanted ?? 0)} label="Cây thật đã trồng" />
          <EcoStat icon="💨" value={`~${(eco?.treesPlanted ?? 0) * 21}kg`} label="CO₂ hấp thụ/năm (ước tính)" />
          <EcoStat icon="💧" value={String(profile?.totalSeeds ?? 0)} label="Giọt nước đã góp" />
        </Box>
        {(forest?.count ?? 0) > 0 ? (
          <>
            <Text size="xSmall" style={{ color: 'var(--leaf-700)', marginTop: 8 }}>
              Cảm ơn bạn! Tubu đã cam kết góp {forest?.count} cây thật vào "Rừng Xanh Lên" cùng PanNature 🌿
            </Text>
            {/* Khu rừng của tôi — chứng nhận từng cây (§6.7.7) */}
            <Box mt={3} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Text size="xSmall" bold>🌲 Khu rừng của tôi — chứng nhận</Text>
              {forest!.trees.slice(0, 5).map((t) => (
                <Box
                  key={t.certificateCode}
                  flex
                  alignItems="center"
                  justifyContent="space-between"
                  p={2}
                  style={{ background: 'var(--leaf-50, #eef7ee)', borderRadius: 'var(--radius-sm)' }}
                >
                  <Box>
                    <Text size="xSmall" bold style={{ color: 'var(--leaf-700)', letterSpacing: 0.5 }}>
                      {t.certificateCode}
                    </Text>
                    <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>{t.treeType}</Text>
                  </Box>
                  <Text size="xSmall" style={{ color: t.status === 'PLANTED' ? 'var(--leaf-700)' : 'var(--neutral-500)' }}>
                    {t.status === 'PLANTED' ? '✅ Đã trồng' : '🌱 Đã cam kết'}
                  </Text>
                </Box>
              ))}
              {forest!.count > 5 && (
                <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>…và {forest!.count - 5} cây khác</Text>
              )}
            </Box>
          </>
        ) : (
          <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 8 }}>
            Chăm cây ảo đến khi thu hoạch để Tubu góp 1 cây thật cho rừng Việt Nam.
          </Text>
        )}
      </Card>

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
        {board && board.length > 0 ? (
          <>
            {/* Podium top 3 */}
            <Box flex alignItems="flex-end" justifyContent="center" style={{ gap: 8, marginBottom: 12 }}>
              {[board[1], board[0], board[2]].map((r, idx) => {
                if (!r) return <Box key={idx} style={{ flex: 1 }} />;
                const isFirst = r.rank === 1;
                const h = isFirst ? 64 : r.rank === 2 ? 48 : 38;
                const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : '🥉';
                return (
                  <Box key={r.rank} style={{ flex: 1, textAlign: 'center' }}>
                    <Text style={{ fontSize: isFirst ? 28 : 22 }}>{medal}</Text>
                    <Text size="xSmall" bold style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.nickname}
                    </Text>
                    <Box
                      style={{
                        height: h,
                        borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
                        background: isFirst ? 'var(--primary-600)' : 'var(--leaf-400)',
                        marginTop: 4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      🌳{r.treesPlanted}
                    </Box>
                  </Box>
                );
              })}
            </Box>
            {/* Hạng 4+ */}
            {board.slice(3).map((r) => (
              <Box key={r.rank} flex justifyContent="space-between" style={{ padding: '4px 0', borderTop: '1px solid var(--neutral-100)' }}>
                <Text size="small">
                  #{r.rank} {r.nickname}
                </Text>
                <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                  🔥{r.streak} · 🌳{r.treesPlanted}
                </Text>
              </Box>
            ))}
          </>
        ) : (
          <Text size="small" style={{ color: 'var(--neutral-400)' }}>
            Chưa có dữ liệu xếp hạng.
          </Text>
        )}
      </Card>

      {/* Harvest celebration */}
      {harvested && (
        <Box
          onClick={() => setHarvested(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}
        >
          <Box
            onClick={(e) => e.stopPropagation()}
            p={5}
            style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-xl)', textAlign: 'center', maxWidth: 320, width: '100%' }}
          >
            <Text style={{ fontSize: 64 }}>🌳</Text>
            <Text bold size="large" style={{ marginTop: 8 }}>
              Thu hoạch thành công!
            </Text>
            <Text size="small" style={{ color: 'var(--neutral-600)', marginTop: 6 }}>
              Cây ảo của bạn đã lớn — Tubu sẽ góp <b>1 cây thật</b> vào rừng "Rừng Xanh Lên" cùng PanNature 🌿
            </Text>
            {harvestCoupon && (
              <Box
                className="tubu-press"
                mt={3}
                p={3}
                onClick={() => {
                  if (navigator.clipboard) {
                    void navigator.clipboard.writeText(harvestCoupon);
                    openSnackbar({ text: 'Đã sao chép mã giảm giá', type: 'success' });
                  }
                }}
                style={{ background: 'var(--leaf-50, #eef7ee)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--leaf-600)' }}
              >
                <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
                  Quà thu hoạch — mã giảm giá (chạm để sao chép)
                </Text>
                <Text bold style={{ color: 'var(--leaf-700)', letterSpacing: 1 }}>
                  {harvestCoupon}
                </Text>
              </Box>
            )}
            {harvestCert && (
              <Box mt={2} p={3} style={{ background: 'var(--leaf-50, #eef7ee)', borderRadius: 'var(--radius-md)' }}>
                <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
                  Mã chứng nhận cây thật
                </Text>
                <Text bold style={{ color: 'var(--leaf-700)', letterSpacing: 1 }}>
                  {harvestCert}
                </Text>
              </Box>
            )}
            <Button fullWidth onClick={() => setHarvested(false)} style={{ marginTop: 20, background: 'var(--leaf-600)' }}>
              Tuyệt vời!
            </Button>
          </Box>
        </Box>
      )}
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

function EcoStat({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <Box
      p={2}
      style={{ flex: 1, background: 'var(--leaf-50)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}
    >
      <Text style={{ fontSize: 20 }}>{icon}</Text>
      <Text bold size="small" style={{ color: 'var(--leaf-700)' }}>
        {value}
      </Text>
      <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
        {label}
      </Text>
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
