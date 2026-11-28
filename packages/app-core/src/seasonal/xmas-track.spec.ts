import { describe, expect, it } from 'vitest';
import { NOEL_ACTIONS as API_ACTIONS, CLIENT_EVENT_RULES } from '../../../../apps/api/src/modules/analytics/event-props';
import { NOEL_ORNAMENT_SLOTS as API_SLOTS } from '../../../../apps/api/src/modules/analytics/noel-metrics-window';
import { NOEL_ACTIONS, ornamentActionProps, SHARE_ACTION_PROPS, snowActionProps } from './xmas-track';
import { ORNAMENTS, tapOrnament, type OrnamentProgress, type TreeState } from './xmas-tree';

describe('xmas-track', () => {
  it('danh sách thao tác và sáu món trùng với luật nhận sự kiện của API', () => {
    expect([...NOEL_ACTIONS]).toEqual([...API_ACTIONS]);
    expect([...ORNAMENTS]).toEqual([...API_SLOTS]);
  });

  it('API có luật cho noel_action và nhận đúng từng thao tác của app', () => {
    const rule = CLIENT_EVENT_RULES.noel_action;
    expect(rule.required).toEqual(['action']);
    for (const a of NOEL_ACTIONS) expect(rule.props.action!(a)).toBe(true);
    for (const id of ORNAMENTS) expect(rule.props.slot!(id)).toBe(true);
    expect(rule.props.action!('tree_shake')).toBe(false);
  });

  it('chạm món: mở khoá lần đầu, treo lại, gỡ; món khoá không ghi gì', () => {
    const ready: OrnamentProgress = { streakDays: 3, activeToday: true, drops: 0, harvested: 0 };
    const empty: TreeState = { u: [], on: [] };
    const first = tapOrnament(empty, 'baubles', ready);
    expect(first.event).toBe('unlocked');
    expect(ornamentActionProps(first.event, 'baubles')).toEqual({ action: 'ornament_unlock', slot: 'baubles' });

    const off = tapOrnament(first.next, 'baubles', ready);
    expect(off.event).toBe('off');
    expect(ornamentActionProps(off.event, 'baubles')).toEqual({ action: 'ornament_off', slot: 'baubles' });

    const again = tapOrnament(off.next, 'baubles', ready);
    expect(again.event).toBe('on');
    expect(ornamentActionProps(again.event, 'baubles')).toEqual({ action: 'ornament_on', slot: 'baubles' });

    const locked = tapOrnament(empty, 'reindeer', { streakDays: 1, activeToday: false, drops: 0, harvested: 0 });
    expect(locked.event).toBe('locked');
    expect(ornamentActionProps(locked.event, 'reindeer')).toBeNull();
  });

  it('tuyết: gửi trạng thái sau khi bấm; chia sẻ không mang món', () => {
    expect(snowActionProps(false)).toEqual({ action: 'snow_off' });
    expect(snowActionProps(true)).toEqual({ action: 'snow_on' });
    expect(SHARE_ACTION_PROPS).toEqual({ action: 'share_tap' });
  });
});
