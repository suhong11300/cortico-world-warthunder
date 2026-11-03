import { describe, it, expect } from 'vitest';
import { battleLine, clampBroadcast, commentaryText, enterText, lengthLimit } from '../src/copy.ts';
import { presentBattleFacts } from '../src/speech.ts';
import type { BattleSnapshot } from '../src/battle.ts';

const tank: BattleSnapshot = {
  vehicle: 'us_hstv_l',
  mode: 'domination',
  army: 'tank',
  speed: 0,
  altitude: 0,
  enemies: 7,
  allies: 0,
  readings: {
    speed: { value: -14, kind: 'IAS', unit: 'unconfirmed', source: '/indicators' },
    altitude: { value: null, unit: 'unconfirmed', source: '/indicators' },
    mapKnown: true,
    observedAt: 1_000,
    vehiclePending: false,
  },
  vehicleState: { crewCurrent: 3, crewTotal: 3, gear: 1, ammo: 20, stabilizer: true, rpm: 2675 },
};

describe('播报详略：档位给要求，模板给骨架', () => {
  it('字数上限 0 表示按档位，正数覆盖除详细以外的档位', () => {
    expect(lengthLimit('full', 0)).toBe(0);
    expect(lengthLimit('key', 0)).toBe(160);
    expect(lengthLimit('brief', 0)).toBe(60);
    expect(lengthLimit('custom', 0)).toBe(160);
    expect(lengthLimit('key', 300)).toBe(300);
    expect(lengthLimit('brief', 40)).toBe(40);
    expect(lengthLimit('full', 300)).toBe(0);
    expect(lengthLimit('key', 900)).toBe(500);
  });

  it('简略档只留载具，重点档带状态读数', () => {
    const full = battleLine(tank, 'zh');
    expect(full).toContain('us_hstv_l');
    expect(full).toContain('速度未读到');
    expect(full).not.toContain('车组');
    expect(full).not.toContain('图上');
    const brief = battleLine(tank, 'zh', 'brief');
    expect(brief).toBe('us_hstv_l');
    expect(brief.length).toBeLessThan(full.length);
    expect(commentaryText(tank, 'zh', 'brief')).toBe('📡 ' + brief);
    expect(enterText(tank, 'zh', 'brief')).toBe('⚔️ 进战局：' + brief);
  });

  it('人格档素材不裁剪，字数写成一句要求', () => {
    const fact = '⚔️ 进战局：us_hstv_l · 速度未读到';
    const persona = presentBattleFacts(fact, '人格', 'zh', 60);
    expect(persona.startsWith(fact)).toBe(true);
    expect(persona).toContain('不超过 60 字');
    expect(persona).toContain('按你的口吻重讲');
    const unbounded = presentBattleFacts(fact, '人格', 'zh', 0);
    expect(unbounded.startsWith(fact)).toBe(true);
    expect(unbounded).toContain('长短随你');
    expect(presentBattleFacts(fact, '模板', 'zh', 60)).toBe(fact);
  });

  it('模板档先选骨架再兜底截断，不会留下半句', () => {
    const brief = battleLine(tank, 'zh', 'brief');
    expect(clampBroadcast(brief, 'brief', 0)).toBe(brief);
  });
});
