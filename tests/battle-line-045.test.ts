import { describe, expect, it } from 'vitest';
import type { BattleSnapshot } from '../src/battle.ts';
import { battleLine, stateOnly, vehicleName } from '../src/copy.ts';

/** 0.4.5：播报只留载具与状态读数；车组、弹药、档位、稳定器、转速一律不进正文。 */
function snap(extra: Partial<BattleSnapshot> = {}): BattleSnapshot {
  return {
    vehicle: 'us_hstv_l',
    mode: 'domination',
    army: 'tank',
    speed: 0,
    altitude: 0,
    enemies: 5,
    allies: 0,
    ...extra,
  };
}

describe('战局读数只报载具与状态', () => {
  it('陆战：载具 + 速度，车组与弹药不再出现', () => {
    const line = battleLine(snap({ groundSpeedKmh: 41.6 }), 'zh');
    expect(line).toBe('us_hstv_l · 42 km/h');
    expect(line).not.toContain('车组');
    expect(line).not.toContain('待发弹');
    expect(line).not.toContain('稳定器');
    expect(line).not.toContain('图上');
  });

  it('陆战速度缺失就写未读到，不拿矢量原始值顶替', () => {
    const line = battleLine(snap({ readings: { speed: { value: -14, kind: 'IAS', unit: 'unconfirmed', source: '/indicators' }, altitude: { value: null, unit: 'm', source: '/state' }, mapKnown: true, observedAt: 1 } }), 'zh');
    expect(line).toBe('us_hstv_l · 速度未读到');
    expect(line).not.toContain('仪表');
  });

  it('空战：速度 + 高度 + 过载，过载来自 /state 的 Ny', () => {
    const line = battleLine(snap({
      vehicle: 'su_30mk2v',
      army: 'air',
      readings: {
        speed: { value: 512, kind: 'IAS', unit: 'km/h', source: '/state' },
        altitude: { value: 3240, unit: 'm', source: '/state.H, m' },
        load: { value: 7.24, source: '/state.Ny' },
        mapKnown: true,
        observedAt: 1,
      },
    }), 'zh');
    expect(line).toBe('su_30mk2v · IAS 512 km/h · H 3240 m · 过载 7.2G');
  });

  it('过载缺失就写未读到，不省略', () => {
    expect(stateOnly(snap({ army: 'air', readings: { speed: { value: 300, kind: 'IAS', unit: 'km/h', source: '/state' }, altitude: { value: 1000, unit: 'm', source: '/state.H, m' }, load: { value: null, source: '/state.Ny' }, mapKnown: true, observedAt: 1 } }), 'zh'))
      .toBe('IAS 300 km/h · H 1000 m · 过载未读到');
  });

  it('知识库给了中文名就优先用它', () => {
    expect(vehicleName(snap({ vehicleLabel: 'HSTV-L（us_hstv_l）' }), 'zh')).toBe('HSTV-L（us_hstv_l）');
    expect(battleLine(snap({ vehicleLabel: 'HSTV-L', groundSpeedKmh: 10 }), 'zh')).toBe('HSTV-L · 10 km/h');
  });
});
