import { useState } from 'react';
import { Box, Page, Text, Button, Spinner, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getGameProfile,
  checkIn,
  collectDew,
  buyStreakFreeze,
  spin,
  getTodayQuiz,
  answerQuiz,
  waterTree,
  getLeaderboard,
  getMissions,
  getForest,
  getCommunity,
  getCollection,
  getSeason,
  getSeasonLeaderboard,
  getFriends,
  giftWater,
  type MissionItem,
  type AnswerResult,
  type HarvestSpecies,
  type CodexEntry,
} from '../services/game-api';
import { useAuthStore } from '../store/auth';
import { WheelOfFortune } from '../components/wheel';

const FREEZE_COST = 80; // khớp default game.streak_freeze_cost (BE là nguồn chân lý)

// Cùng ngày theo giờ VN (UTC+7) — khớp dayKey backend, để khoá nút đã dùng trong ngày.
function isSameVNDay(iso: string | null): boolean {
  if (!iso) return false;
  const key = (d: Date) => new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  return key(new Date(iso)) === key(new Date());
}

export default function GamePage() {
  const status = useAuthStore((s) => s.status);
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
  const { data: community } = useQuery({ queryKey: ['game', 'community'], queryFn: getCommunity, enabled: authed });
  const { data: codex } = useQuery({ queryKey: ['game', 'collection'], queryFn: getCollection, enabled: authed });
  const { data: season } = useQuery({ queryKey: ['game', 'season'], queryFn: getSeason });
  const { data: seasonBoard } = useQuery({ queryKey: ['game', 'seasonBoard'], queryFn: getSeasonLeaderboard });
  const { data: friends } = useQuery({ queryKey: ['game', 'friends'], queryFn: getFriends, enabled: authed });

  // Quiz nhiều câu/ngày: theo dõi câu đã trả lời client-side để hiện câu kế tiếp (§6.7.8).
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const currentQuiz = quiz?.find((q) => !answeredIds.has(q.id));
  // Reveal "Bạn có biết…" sau khi trả lời, trước khi sang câu kế.
  const [reveal, setReveal] = useState<(AnswerResult & { quizId: string; choice: number }) | null>(null);
  const [harvested, setHarvested] = useState(false);
  const [harvestCoupon, setHarvestCoupon] = useState<string | null>(null);
  const [harvestCert, setHarvestCert] = useState<string | null>(null);
  const [harvestSpecies, setHarvestSpecies] = useState<HarvestSpecies | null>(null);

  const dewCollectedToday = isSameVNDay(profile?.lastDewAt ?? null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['game'] });
    void queryClient.invalidateQueries({ queryKey: ['me'] });
  };

  const checkInM = useMutation({
    mutationFn: checkIn,
    onSuccess: (r) => {
      const parts = [`+${r.seedsEarned}💧`];
      if (r.streakFrozeUsed) parts.push('🧊 đã dùng vé giữ lửa');
      if (r.bonusNote) parts.push(r.bonusNote);
      openSnackbar({ text: parts.join(' · '), type: 'success' });
      refresh();
    },
    onError: (e: unknown) => openSnackbar({ text: msg(e), type: 'error' }),
  });
  const dewM = useMutation({
    mutationFn: collectDew,
    onSuccess: (r) => {
      openSnackbar({ text: `Hứng được +${r.seedsEarned}💧 từ giọt sương sáng 💦`, type: 'success' });
      refresh();
    },
    onError: (e: unknown) => openSnackbar({ text: msg(e), type: 'error' }),
  });
  const freezeM = useMutation({
    mutationFn: buyStreakFreeze,
    onSuccess: (r) => {
      openSnackbar({ text: `Đã mua vé giữ lửa 🧊 (còn ${r.streakFreezes} vé)`, type: 'success' });
      refresh();
    },
    onError: (e: unknown) => openSnackbar({ text: msg(e), type: 'error' }),
  });
  const giftM = useMutation({
    mutationFn: (recipientId: string) => giftWater(recipientId),
    onSuccess: (r) => {
      openSnackbar({ text: `Đã tặng ${r.amount}💧 cho bạn 🎁`, type: 'success' });
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
        setHarvestSpecies(r.reward?.species ?? null);
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
      // Hiện reveal "Bạn có biết…"; chỉ sang câu kế khi user bấm "Câu tiếp theo".
      setReveal({ ...r, quizId: vars.id, choice: vars.choice });
      void queryClient.invalidateQueries({ queryKey: ['game', 'profile'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e: unknown) => openSnackbar({ text: msg(e), type: 'error' }),
  });
  const nextQuiz = () => {
    if (reveal) setAnsweredIds((prev) => new Set(prev).add(reveal.quizId));
    setReveal(null);
  };

  if (isLoading || !authed) {
    return (
      <Page>
        <Box flex justifyContent="center" p={6}>
          <Spinner />
        </Box>
      </Page>
    );
  }

  const eco = profile?.ecoImpact;
  const pct = eco && eco.target > 0 ? Math.min(100, Math.round((eco.progress / eco.target) * 100)) : 0;

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 80 }}>

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

      {/* Banner mùa/sự kiện (Phase 4) */}
      {season && (
        <Box mx={3} mt={2} p={3} style={{ background: 'linear-gradient(120deg, var(--leaf-50, #eef7ee), var(--sun-50, #fdf6e3))', borderRadius: 'var(--radius-lg)', border: '1px solid var(--leaf-400)' }}>
          <Box flex alignItems="center" justifyContent="space-between">
            <Text size="small" bold style={{ color: 'var(--leaf-700)' }}>
              🍃 {season.name}
            </Text>
            <Text style={{ fontSize: 18 }}>
              {season.featuredSpecies.map((s) => s.emoji).join(' ')}
            </Text>
          </Box>
          {(season.theme || season.region) && (
            <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
              {[season.theme, season.region].filter(Boolean).join(' · ')}
            </Text>
          )}
          {season.featuredSpecies.length > 0 && (
            <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 2 }}>
              Loài nổi bật mùa này: {season.featuredSpecies.map((s) => s.name).join(', ')}
            </Text>
          )}
        </Box>
      )}

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

        {/* Vé giữ lửa (streak-freeze) + giọt sương sáng (dew) */}
        <Box flex alignItems="center" justifyContent="space-between" style={{ gap: 8, marginTop: 12 }}>
          <Box flex alignItems="center" style={{ gap: 6 }}>
            <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
              🧊 Vé giữ lửa: <b>{profile?.streakFreezes ?? 0}</b>
            </Text>
            <Button
              size="small"
              variant="tertiary"
              loading={freezeM.isPending}
              onClick={() => freezeM.mutate()}
              style={{ color: 'var(--leaf-700)' }}
            >
              Mua ({FREEZE_COST}💧)
            </Button>
          </Box>
          <Button
            size="small"
            variant="secondary"
            disabled={dewCollectedToday}
            loading={dewM.isPending}
            onClick={() => dewM.mutate()}
          >
            {dewCollectedToday ? '💦 Đã hứng sương' : '💦 Hứng giọt sương'}
          </Button>
        </Box>
        <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
          Vé giữ lửa giúp chuỗi không đứt khi bạn lỡ 1 ngày. Giọt sương sáng tặng 💧 mỗi ngày.
        </Text>
      </Box>

      {/* Cảnh báo héo/chết (§6.7.3) */}
      {profile?.treeHealth === 'WILTED' && (
        <Box mx={3} mt={2} p={3} style={{ background: 'var(--sun-50, #fdf6e3)', borderRadius: 'var(--radius-md)' }}>
          <Text size="xSmall" style={{ color: 'var(--clay-700, #92400e)' }}>
            🥀 Cây đang héo vì lâu chưa tưới — tưới ngay để hồi phục nhé!
          </Text>
        </Box>
      )}
      {profile?.treeHealth === 'DEAD' && (
        <Box mx={3} mt={2} p={3} style={{ background: 'var(--danger-50, #fee2e2)', borderRadius: 'var(--radius-md)' }}>
          <Text size="xSmall" style={{ color: 'var(--danger, #b91c1c)' }}>
            🍂 Cây đã héo úa do quá 7 ngày không tưới. Tưới lại sẽ trồng cây mới từ đầu.
          </Text>
        </Box>
      )}

      <Box p={3}>
        <Button fullWidth loading={waterM.isPending} variant="secondary" onClick={() => waterM.mutate()}>
          🚿 Tưới cây (20💧)
        </Button>
      </Box>

      {/* Mốc cộng đồng cây thật (Phase 2) — hồ giọt nước toàn cộng đồng */}
      {community?.goal && (
        <Card title="🌍 Mục tiêu cộng đồng">
          <Text size="small" bold style={{ color: 'var(--leaf-700)' }}>
            {community.goal.title}
          </Text>
          <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
            📍 {community.goal.region} · mục tiêu {community.goal.treesToPlant} cây thật
          </Text>
          <Box style={{ background: 'var(--neutral-100)', borderRadius: 99, height: 12, margin: '10px 0 6px', overflow: 'hidden' }}>
            <Box
              style={{
                width: `${community.pct}%`,
                height: 12,
                background: 'linear-gradient(90deg, var(--leaf-400), var(--leaf-600))',
                borderRadius: 99,
                transition: 'width var(--dur-slow) var(--ease-out)',
              }}
            />
          </Box>
          <Box flex justifyContent="space-between">
            <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
              {community.goal.currentDrops.toLocaleString('vi-VN')}/{community.goal.targetDrops.toLocaleString('vi-VN')}💧 ({community.pct}%)
            </Text>
            <Text size="xSmall" bold style={{ color: 'var(--leaf-700)' }}>
              Bạn đã góp {community.myDrops.toLocaleString('vi-VN')}💧
            </Text>
          </Box>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 6 }}>
            Mỗi lần thu hoạch cây ảo, toàn bộ 💧 đã tưới sẽ góp vào hồ chung. Đủ mốc, Tubu trồng cây thật cùng PanNature 🌿
          </Text>
        </Card>
      )}

      {/* Sổ tay loài cây (Phase 3) — sưu tập khi thu hoạch */}
      {codex && codex.length > 0 && (
        <Card title={`📒 Sổ tay loài cây (${codex.filter((c) => c.owned).length}/${codex.length})`}>
          <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {codex.map((c: CodexEntry) => (
              <Box
                key={c.id}
                p={2}
                style={{
                  textAlign: 'center',
                  background: c.owned ? 'var(--leaf-50, #eef7ee)' : 'var(--neutral-100)',
                  borderRadius: 'var(--radius-md)',
                  border: c.owned ? `1px solid ${rarityColor(c.rarity)}` : '1px solid transparent',
                  opacity: c.owned ? 1 : 0.55,
                }}
              >
                <Text style={{ fontSize: 26, filter: c.owned ? 'none' : 'grayscale(1)' }}>
                  {c.owned ? c.emoji : '❔'}
                </Text>
                <Text size="xSmall" bold style={{ color: c.owned ? 'var(--neutral-900)' : 'var(--neutral-400)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.owned ? c.name : '???'}
                </Text>
                {c.owned && c.count > 1 && (
                  <Text size="xSmall" style={{ color: 'var(--leaf-700)' }}>×{c.count}</Text>
                )}
              </Box>
            ))}
          </Box>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 8 }}>
            Thu hoạch cây để sưu tập đủ loài cây Việt Nam — loài hiếm khó gặp hơn!
          </Text>
        </Card>
      )}

      {/* Tặng nước bạn bè (social) */}
      {friends && friends.length > 0 && (
        <Card title="🎁 Tặng nước cho bạn bè">
          {friends.map((f) => (
            <Box key={f.id} flex alignItems="center" justifyContent="space-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--neutral-100)' }}>
              <Text size="small">🌿 {f.nickname}</Text>
              <Button
                size="small"
                variant="secondary"
                disabled={f.giftedToday || (giftM.isPending && giftM.variables === f.id)}
                loading={giftM.isPending && giftM.variables === f.id}
                onClick={() => giftM.mutate(f.id)}
              >
                {f.giftedToday ? 'Đã tặng hôm nay' : 'Tặng 💧'}
              </Button>
            </Box>
          ))}
          <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 8 }}>
            Tặng nước cho bạn bè (người bạn mời hoặc người mời bạn) — mỗi người 1 lần/ngày 🌿
          </Text>
        </Card>
      )}

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
            <Box flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 6 }}>
              <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                {categoryLabel(currentQuiz.category)} · {difficultyLabel(currentQuiz.difficulty)}
                {quiz && quiz.length > 1 ? ` · Câu ${answeredIds.size + 1}/${quiz.length}` : ''}
              </Text>
              <Text size="xSmall" bold style={{ color: 'var(--leaf-700)' }}>
                +{currentQuiz.waterReward}💧
              </Text>
            </Box>
            <QuizBlock
              q={currentQuiz}
              reveal={reveal && reveal.quizId === currentQuiz.id ? reveal : null}
              onAnswer={(choice) => answerM.mutate({ id: currentQuiz.id, choice })}
              pending={answerM.isPending}
            />
            {reveal && reveal.quizId === currentQuiz.id && (
              <Box
                mt={3}
                p={3}
                style={{
                  background: reveal.isCorrect ? 'var(--leaf-50, #eef7ee)' : 'var(--sun-50, #fdf6e3)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <Text size="small" bold style={{ color: reveal.isCorrect ? 'var(--leaf-700)' : 'var(--clay-700, #92400e)' }}>
                  {reveal.isCorrect ? `Chính xác! +${reveal.waterEarned}💧` : 'Chưa đúng — cùng học nhé 🌿'}
                </Text>
                {reveal.explanation && (
                  <Text size="xSmall" style={{ color: 'var(--neutral-600)', marginTop: 4 }}>
                    💡 Bạn có biết: {reveal.explanation}
                  </Text>
                )}
                <Button fullWidth size="small" onClick={nextQuiz} style={{ marginTop: 10, background: 'var(--leaf-600)' }}>
                  {answeredIds.size + 1 >= (quiz?.length ?? 1) ? 'Hoàn thành' : 'Câu tiếp theo'}
                </Button>
              </Box>
            )}
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

      {seasonBoard && seasonBoard.length > 0 && (
        <Card title="💧 Top góp nước mùa này">
          {seasonBoard.map((r) => (
            <Box key={r.rank} flex justifyContent="space-between" style={{ padding: '4px 0', borderTop: r.rank > 1 ? '1px solid var(--neutral-100)' : 'none' }}>
              <Text size="small">
                {r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `#${r.rank}`} {r.nickname}
              </Text>
              <Text size="xSmall" bold style={{ color: 'var(--leaf-700)' }}>
                {r.drops.toLocaleString('vi-VN')}💧
              </Text>
            </Box>
          ))}
        </Card>
      )}

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
            {harvestSpecies && (
              <Box mt={3} p={3} style={{ background: 'var(--leaf-50, #eef7ee)', borderRadius: 'var(--radius-md)', border: `1px solid ${rarityColor(harvestSpecies.rarity)}` }}>
                <Text size="xSmall" style={{ color: rarityColor(harvestSpecies.rarity), fontWeight: 700 }}>
                  {rarityLabel(harvestSpecies.rarity)} · Sưu tập mới!
                </Text>
                <Text bold style={{ marginTop: 2 }}>
                  {harvestSpecies.emoji} {harvestSpecies.name}
                </Text>
                {harvestSpecies.ecoFact && (
                  <Text size="xSmall" style={{ color: 'var(--neutral-600)', marginTop: 4 }}>
                    💡 {harvestSpecies.ecoFact}
                  </Text>
                )}
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
  reveal,
  onAnswer,
  pending,
}: {
  q: { question: string; options: string[] };
  reveal: (AnswerResult & { choice: number }) | null;
  onAnswer: (choice: number) => void;
  pending: boolean;
}) {
  return (
    <Box>
      <Text size="small" style={{ marginBottom: 8 }}>
        {q.question}
      </Text>
      <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {q.options.map((opt, i) => {
          // Sau khi reveal: tô xanh đáp án đúng, tô đỏ lựa chọn sai của user.
          let bg: string | undefined;
          let color: string | undefined;
          if (reveal) {
            if (i === reveal.correct) {
              bg = 'var(--leaf-600)';
              color = '#fff';
            } else if (i === reveal.choice) {
              bg = 'var(--danger-50, #fee2e2)';
              color = 'var(--danger, #b91c1c)';
            }
          }
          return (
            <Button
              key={i}
              size="small"
              variant="secondary"
              disabled={pending || !!reveal}
              onClick={() => onAnswer(i)}
              style={bg ? { background: bg, color } : undefined}
            >
              {opt}
            </Button>
          );
        })}
      </Box>
    </Box>
  );
}

function categoryLabel(cat: string): string {
  const map: Record<string, string> = {
    cay: '🌳 Cây cối',
    nuoc: '💧 Nước',
    dat: '🌍 Đất',
    khong_khi: '🌬️ Không khí',
    dong_vat: '🐾 Động vật',
    tai_che: '♻️ Tái chế',
    nang_luong: '⚡ Năng lượng',
    nature: '🌿 Thiên nhiên',
  };
  return map[cat] ?? '🌿 Thiên nhiên';
}

function difficultyLabel(d: number): string {
  return d >= 3 ? 'Khó' : d === 2 ? 'Vừa' : 'Dễ';
}

function rarityColor(r: 'COMMON' | 'RARE' | 'LEGENDARY'): string {
  return r === 'LEGENDARY' ? '#b8860b' : r === 'RARE' ? 'var(--leaf-600)' : 'var(--neutral-400)';
}

function rarityLabel(r: 'COMMON' | 'RARE' | 'LEGENDARY'): string {
  return r === 'LEGENDARY' ? '🌟 Huyền thoại' : r === 'RARE' ? '💎 Hiếm' : '🍃 Thường';
}

function msg(e: unknown): string {
  const ax = e as { response?: { data?: { message?: string } }; message?: string };
  return ax?.response?.data?.message ?? ax?.message ?? 'Có lỗi xảy ra';
}
