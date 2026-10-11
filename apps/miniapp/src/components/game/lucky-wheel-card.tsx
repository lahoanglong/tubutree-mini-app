import type { SpinResult } from '../../services/game-api';
import { WheelOfFortune } from '../wheel';
import { GameCard } from './game-card';

export function LuckyWheelCard({ cost, onSpin }: { cost: number; onSpin: () => Promise<SpinResult> }) {
  return (
    <GameCard title="🎡 Vòng quay may mắn">
      <WheelOfFortune cost={cost} onSpin={onSpin} />
    </GameCard>
  );
}
