'use client';

import '@tubutree/design-tokens/src/seasonal-christmas.css';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { GIFT_ART, GIFT_VIEWBOX, ICON_VIEWBOX, SNOWFLAKES, TREE_ART, XMAS_ICONS } from '@tubutree/app-core/seasonal/christmas-art';
import { drawXmasCard, XMAS_CARD_PALETTE_VARS, XMAS_CARD_SIZE, type XmasCardPalette } from '@tubutree/app-core/seasonal/xmas-card';
import {
  ORNAMENT_ART,
  ORNAMENTS,
  readTreeState,
  slotState,
  tapMessage,
  tapOrnament,
  writeTreeState,
  XMAS_GARDEN_VIEWBOX,
  xmasTreeCopy as c,
  type OrnamentId,
  type OrnamentProgress,
} from '@tubutree/app-core/seasonal/xmas-tree';
import { ornamentActionProps, SHARE_ACTION_PROPS } from '@tubutree/app-core/seasonal/xmas-track';
import { BottomSheet, Button } from '@/components/mini';
import { trackWebEvent } from '@/lib/analytics';
import { useAuth } from '@/lib/auth-context';
import { browserStorage } from '@/lib/recently-viewed';
import { sfx } from '@/lib/sfx';
import { Burst } from '../burst';

const HERO_FLAKES = SNOWFLAKES.slice(0, 12);
const GARDEN_PATH = '/vuon-xanh';

export interface ChristmasGardenProps {
  progress: OrnamentProgress;
  /** Cây thường của thẻ: GardenHero vẽ nó khi chunk này tải lỗi (chunk tải được thì không dùng). */
  plain: ReactNode;
}

/** Ảnh thiệp PNG vẽ bằng canvas, màu lấy từ biến `--xmas-*` của khối thiệp; trình duyệt không có canvas thì null. */
function cardBlob(el: Element, name: string, on: readonly OrnamentId[], link: string): Promise<Blob | null> {
  const css = getComputedStyle(el);
  const palette = Object.fromEntries(Object.entries(XMAS_CARD_PALETTE_VARS).map(([k, v]) => [k, css.getPropertyValue(v).trim()])) as unknown as XmasCardPalette;
  const canvas = document.createElement('canvas');
  canvas.width = XMAS_CARD_SIZE.w;
  canvas.height = XMAS_CARD_SIZE.h;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof Path2D === 'undefined') return Promise.resolve(null);
  drawXmasCard(ctx, (d) => new Path2D(d), { name, on, link, palette });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/**
 * Cây Thông Noel Tự Trang Trí ở thẻ đầu tab Chăm vườn (chunk riêng, chỉ tải khi `theme.seasonal` là "christmas"), cùng hình và số đo với Mini App.
 * Web chia sẻ thiệp bằng ảnh PNG: Web Share kèm tệp khi trình duyệt cho, không thì chia sẻ link, không có cả hai thì tải ảnh về máy.
 */
export default function ChristmasGarden({ progress }: ChristmasGardenProps) {
  const [tree, setTree] = useState(() => readTreeState(browserStorage()));
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [pop, setPop] = useState<{ id: OrnamentId; n: number } | null>(null);
  const [sharing, setSharing] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const { user } = useAuth();
  const name = user?.fullName?.trim() || c.me;
  const ready = ORNAMENTS.some((id) => slotState(tree, id, progress) === 'ready');

  const tap = (id: OrnamentId) => {
    const { next, event } = tapOrnament(tree, id, progress);
    setMsg(tapMessage(event, id));
    if (next === tree) return;
    setTree(next);
    writeTreeState(browserStorage(), next);
    const noel = ornamentActionProps(event, id);
    if (noel) trackWebEvent('noel_action', noel);
    if (event === 'off') {
      sfx.play('pop');
      return;
    }
    setPop((p) => ({ id, n: (p?.n ?? 0) + 1 }));
    sfx.play('bell');
  };

  const ref = user?.referralCode;
  const shareUrl = () => `${window.location.origin}${GARDEN_PATH}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
  const cardKey = (url: string) => `${name}|${tree.on.join(',')}|${url}`;

  // Dựng sẵn ảnh thiệp khi sheet mở (và mỗi lần đổi món): Safari iOS chỉ cho `navigator.share` trong lượt chạm, một `await toBlob` trước đó làm nó từ chối.
  const [card, setCard] = useState<{ key: string; blob: Blob | null } | null>(null);
  useEffect(() => {
    if (!open || !cardRef.current) return;
    let live = true;
    const url = shareUrl();
    const key = cardKey(url);
    cardBlob(cardRef.current, name, tree.on, url).then(
      (blob) => live && setCard({ key, blob }),
      () => live && setCard({ key, blob: null }),
    );
    return () => {
      live = false;
    };
    // shareUrl/cardKey chỉ đọc `ref`, `name`, `tree.on` đã nằm trong deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, name, tree.on, ref]);

  const saveBlob = (blob: Blob) => {
    const a = document.createElement('a');
    const href = URL.createObjectURL(blob);
    a.href = href;
    a.download = 'cay-thong-noel-xanh.png';
    a.click();
    // Safari đọc blob sau khi `click()` trả về: thu hồi ngay thì tệp tải về rỗng.
    window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
    setMsg(c.saved);
  };

  const share = async () => {
    if (sharing || !cardRef.current) return;
    setSharing(true);
    trackWebEvent('noel_action', SHARE_ACTION_PROPS);
    const url = shareUrl();
    const key = cardKey(url);
    const title = c.zaloTitle(name);
    const text = c.zaloText(tree.on.length);
    let blob: Blob | null = null;
    try {
      blob = card?.key === key ? card.blob : await cardBlob(cardRef.current, name, tree.on, url);
      const file = blob ? new File([blob], 'cay-thong-noel-xanh.png', { type: 'image/png' }) : null;
      if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title, text: `${text} ${url}` });
      else if (typeof navigator.share === 'function') await navigator.share({ title, text, url });
      else if (blob) saveBlob(blob);
      else {
        await navigator.clipboard.writeText(url);
        setMsg(c.copied);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      // Trình duyệt từ chối mở bảng chia sẻ (hết lượt chạm, chính sách): vẫn còn ảnh thì tải về thay vì báo lỗi.
      if (e instanceof DOMException && e.name === 'NotAllowedError' && blob) saveBlob(blob);
      else setMsg(c.shareFailed);
    } finally {
      setSharing(false);
    }
  };

  return (
    <>
      <span className="tubu-xgd-snow" aria-hidden="true">
        {HERO_FLAKES.map((f, i) => (
          <span
            key={i}
            className={f.needle ? 'tubu-xmas-flake is-needle' : 'tubu-xmas-flake'}
            style={{ '--x': f.x, '--s': f.size, '--d': f.dur, '--delay': f.delay, '--drift': f.drift, '--o': f.opacity } as CSSProperties}
          />
        ))}
      </span>
      <XmasTree on={tree.on} />
      <button type="button" className="tubu-xgd-open" aria-haspopup="dialog" data-ready={ready || undefined} onClick={() => setOpen(true)} data-testid="xmas-decorate">
        <span>{c.decorate}</span>
        <span className="tubu-xgd-open-count">{c.count(tree.on.length)}</span>
      </button>
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={c.sheetTitle}
        footer={
          <Button fullWidth size="lg" loading={sharing} onPress={share}>
            {c.shareCtaWeb}
          </Button>
        }
      >
        <div className="tubu-xgd-sheet" data-season="christmas" data-testid="xmas-garden-sheet">
          <figure className="tubu-xgd-card" ref={cardRef} data-testid="xmas-card">
            <div className="tubu-xgd-card-tree">
              <XmasTree on={tree.on} pop={pop?.id} />
              {pop && <Burst key={pop.n} />}
            </div>
            <figcaption className="tubu-xgd-card-text">
              <strong>{c.greeting}</strong>
              <span>{c.cardLine(name, tree.on.length)}</span>
              <span>{c.cardInvite}</span>
            </figcaption>
          </figure>
          <div className="tubu-xgd-tray" role="group" aria-label={c.trayLabel(tree.on.length)}>
            {ORNAMENTS.map((id) => {
              const state = slotState(tree, id, progress);
              const owned = state === 'on' || state === 'off';
              return (
                <button
                  key={id}
                  type="button"
                  className="tubu-xgd-slot"
                  data-state={state}
                  aria-pressed={owned ? state === 'on' : undefined}
                  aria-label={c.slotAria(c.names[id], state, c.hints[id])}
                  onClick={() => tap(id)}
                  data-testid={`xmas-slot-${id}`}
                >
                  <OrnamentIcon id={id} />
                  <span className="tubu-xgd-slot-name">{c.names[id]}</span>
                  {state === 'locked' && (
                    <svg className="tubu-xmas-icon tubu-xgd-lock" viewBox={ICON_VIEWBOX} aria-hidden="true" focusable="false">
                      <path d={XMAS_ICONS.lock} />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
          <p className="tubu-xgd-msg" aria-live="polite" data-testid="xmas-msg">
            {msg}
          </p>
        </div>
      </BottomSheet>
    </>
  );
}

function XmasTree({ on, pop }: { on: readonly OrnamentId[]; pop?: OrnamentId }) {
  return (
    <svg className="tubu-xgd-tree" viewBox={XMAS_GARDEN_VIEWBOX} role="img" aria-label={c.treeAria(on.length)} data-testid="xmas-tree">
      <path className="tubu-xmas-trunk" d={TREE_ART.trunk} />
      {[2, 1, 0].map((i) => (
        <g key={i}>
          <path className={`tubu-xmas-tier-${i + 1}`} d={TREE_ART.tiers[i]} />
          <path className="tubu-xmas-snowline" d={TREE_ART.snow[i]} />
        </g>
      ))}
      <path className="tubu-xmas-pot-rim" d={TREE_ART.potRim} />
      <path className="tubu-xmas-pot" d={TREE_ART.pot} />
      <path className="tubu-xmas-leaf" d={TREE_ART.leaf} />
      {ORNAMENTS.filter((id) => on.includes(id)).map((id) => (
        <g key={id} className="tubu-xgd-orn" data-pop={pop === id || undefined} data-orn={id}>
          <Ornament id={id} />
        </g>
      ))}
    </svg>
  );
}

/** Hình một món trên cây (khung `XMAS_GARDEN_VIEWBOX`); khay cắt đúng vùng này làm biểu tượng. */
function Ornament({ id }: { id: OrnamentId }) {
  switch (id) {
    case 'star':
      return <path className="tubu-xmas-star" d={TREE_ART.star} />;
    case 'lights':
      return (
        <>
          {TREE_ART.lights.map(([x, y], i) => (
            <circle key={i} className="tubu-xmas-light" cx={x} cy={y} r={1.8} style={{ '--i': i } as CSSProperties} />
          ))}
        </>
      );
    case 'baubles':
      return (
        <>
          {TREE_ART.berries.map(([x, y], i) => (
            <circle key={i} className="tubu-xmas-berry" cx={x} cy={y} r={2.4} />
          ))}
        </>
      );
    case 'gifts':
      return (
        <>
          {ORNAMENT_ART.gifts.map(([x, y, s]) => (
            <svg key={x} x={x} y={y} width={s} height={s} viewBox={GIFT_VIEWBOX}>
              <path className="tubu-xmas-gift-body" d={GIFT_ART.body} />
              <path className="tubu-xmas-gift-ribbon" d={GIFT_ART.ribbonBody} />
              <path className="tubu-xmas-gift-lid" d={GIFT_ART.lid} />
              <path className="tubu-xmas-gift-ribbon" d={GIFT_ART.ribbonLid} />
              <path className="tubu-xmas-gift-bow" d={GIFT_ART.bow} />
            </svg>
          ))}
        </>
      );
    case 'reindeer': {
      const r = ORNAMENT_ART.reindeer;
      return (
        <>
          <path className="tubu-xgd-deer-line" d={r.legs} />
          <path className="tubu-xgd-deer" d={r.body} />
          <path className="tubu-xgd-antler" d={r.antlers} />
          <circle className="tubu-xgd-deer" cx={r.head[0]} cy={r.head[1]} r={r.head[2]} />
          <circle className="tubu-xmas-berry" cx={r.nose[0]} cy={r.nose[1]} r={r.nose[2]} />
        </>
      );
    }
    case 'wreath': {
      const w = ORNAMENT_ART.wreath;
      return (
        <>
          <circle className="tubu-xgd-wreath" cx={w.ring[0]} cy={w.ring[1]} r={w.ring[2]} />
          <path className="tubu-xmas-berry" d={w.bow} />
        </>
      );
    }
  }
}

function OrnamentIcon({ id }: { id: OrnamentId }) {
  const crop = ORNAMENT_ART.tray[id];
  const { lights, baubles } = ORNAMENT_ART.icons;
  return (
    <svg className="tubu-xgd-icon" viewBox={crop ?? ICON_VIEWBOX} aria-hidden="true" focusable="false">
      {crop ? (
        <Ornament id={id} />
      ) : id === 'lights' ? (
        <>
          <path className="tubu-xgd-wire" d={lights.wire} />
          {lights.dots.map(([x, y], i) => (
            <circle key={i} className="tubu-xmas-light" cx={x} cy={y} r={1.6} style={{ '--i': i } as CSSProperties} />
          ))}
        </>
      ) : (
        <>
          <path className="tubu-xgd-cap" d={baubles.cap} />
          <circle className="tubu-xmas-berry" cx={baubles.ball[0]} cy={baubles.ball[1]} r={baubles.ball[2]} />
        </>
      )}
    </svg>
  );
}
