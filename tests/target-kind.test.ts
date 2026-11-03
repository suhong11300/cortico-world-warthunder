import { describe, expect, it } from 'vitest';
import { classifyTarget, computeSelfDeaths, computeSelfKills, parseKillLine } from '../src/battle.ts';

const ZW = '\u200b';
function row(id: number, time: number, msg: string) {
  return { id, time, msg, sender: '', enemy: false, mode: '', type: 'damage' };
}

describe('目标分类：玩家、AI、弹药与辅助单位', () => {
  it('带载具标注的是玩家', () => {
    expect(classifyTarget('昔涟 是爱 是桃子', true)).toBe('player');
  });

  it('武器路径归为弹药', () => {
    expect(classifyTarget('weapons/us_aim_120c_5/short', false)).toBe('ammo');
    expect(classifyTarget('weapons/cn_pl12/short', false)).toBe('ammo');
  });

  it('无人机的名字归为无人机', () => {
    expect(classifyTarget('🔺 侦察无人机', false)).toBe('drone');
    expect(classifyTarget('Recon Drone', false)).toBe('drone');
  });

  it('发射车不按名字剔除：带载具标注算玩家，裸名称算 AI', () => {
    expect(classifyTarget('羽丘千早丰川祥', true, '羽丘千早丰川祥 (S-75 发射车)')).toBe('player');
    expect(classifyTarget('S-75 发射车', false)).toBe('ai');
  });

  it('玩家开着辅助载具时靠未去后缀的原文识别', () => {
    // stripVehicleTag 之后只剩玩家名，必须靠 raw 才看得出他开的是无人机。
    expect(classifyTarget('羽丘千早丰川祥', true, '羽丘千早丰川祥 (微型侦察无人机)')).toBe('drone');
    expect(classifyTarget('羽丘千早丰川祥', true, '羽丘千早丰川祥 (▄苏-30MK2 AMV “侧卫-G”)')).toBe('player');
    expect(classifyTarget('羽丘千早丰川祥', true)).toBe('player');
  });

  it('只有载具名没有标注的归为 AI', () => {
    expect(classifyTarget('IPM1', false)).toBe('ai');
    expect(classifyTarget('AIA-4B', false)).toBe('ai');
  });
});

describe('击杀归属：剔除 AI 与弹药误报', () => {
  it('击毁 AI 单位不计入个人击杀', () => {
    const damage = [row(1, 10, '^MyGO^ 羽丘千早丰川祥 (▄苏-30MK2 AMV “侧卫-G”) 击毁了 IPM1')];
    expect(computeSelfKills(damage, { afterId: -1, playerName: '羽丘千早丰川祥' })).toHaveLength(0);
  });

  it('拦截弹药的播报不计入个人击杀', () => {
    const damage = [row(2, 11, '^MyGO^ 羽丘千早丰川祥 (▄苏-30MK2 AMV “侧卫-G”) 击毁了 weapons/cn_pl12/short')];
    expect(computeSelfKills(damage, { afterId: -1, playerName: '羽丘千早丰川祥' })).toHaveLength(0);
  });

  it('击毁玩家仍然计入', () => {
    const damage = [row(3, 12, '^MyGO^ 羽丘千早丰川祥 (▄苏-30MK2 AMV “侧卫-G”) 击毁了 昔涟 是爱 是桃子 (␗Su-30MKK “侧卫-G”)')];
    const kills = computeSelfKills(damage, { afterId: -1, playerName: '羽丘千早丰川祥' });
    expect(kills).toHaveLength(1);
    expect(kills[0].victim).toBe('昔涟 是爱 是桃子');
  });

  it('嵌套括号的载具名不影响玩家识别', () => {
    const line = parseKillLine('[youzi] 你站在桌角干嘛 (F-15E “攻击鹰”) 击落了 Kapitan Haddock (▄F-14A (伊朗) “雄猫”)');
    expect(line).not.toBeNull();
    expect(line?.victim).toBe('Kapitan Haddock');
    expect(line?.victimTagged).toBe(true);
  });

  it('无人机当发起者：击毁敌机照常计入，那是玩家的战功', () => {
    const damage = [row(6, 15, '^MyGO^ 羽丘千早丰川祥 (微型侦察无人机) 击毁了 Kapitan Haddock (▄F-14A “雄猫”)')];
    const kills = computeSelfKills(damage, { afterId: -1, playerName: '羽丘千早丰川祥' });
    expect(kills).toHaveLength(1);
    expect(kills[0].victim).toBe('Kapitan Haddock');
  });

  it('无人机当受害者：坠毁不计玩家阵亡', () => {
    const damage = [row(4, 13, '[youzi] 你站在桌角干嘛 (F-16C) 击落了 ^MyGO^ 羽丘千早丰川祥 (微型侦察无人机)')];
    expect(computeSelfDeaths(damage, { afterId: -1, playerName: '羽丘千早丰川祥' })).toHaveLength(0);
  });

  it('玩家开的防空车：它的击杀照常计入', () => {
    const damage = [row(7, 16, '^MyGO^ 羽丘千早丰川祥 (S-75 发射车) 击落了 Kapitan Haddock (▄F-14A “雄猫”)')];
    const kills = computeSelfKills(damage, { afterId: -1, playerName: '羽丘千早丰川祥' });
    expect(kills).toHaveLength(1);
    expect(kills[0].victim).toBe('Kapitan Haddock');
  });

  it('裸名称的发射车当受害者：不是玩家，不计阵亡', () => {
    const damage = [row(8, 17, 'Kapitan Haddock (▄F-14A “雄猫”) 击毁了 S-75 发射车')];
    expect(computeSelfDeaths(damage, { afterId: -1, playerName: '羽丘千早丰川祥' })).toHaveLength(0);
  });

  it('被玩家击毁计入阵亡，零宽字符不影响判定', () => {
    const msg = '-JPSP- まえる (F-2A “零' + ZW + '式' + ZW + '蝰' + ZW + '蛇”) 击' + ZW + '落' + ZW + '了 ^MyGO^ 羽丘千早丰川祥 (▄苏-30MK2 AMV “侧' + ZW + '卫-G”)';
    const damage = [row(5, 14, msg)];
    const deaths = computeSelfDeaths(damage, { afterId: -1, playerName: '羽丘千早丰川祥' });
    expect(deaths).toHaveLength(1);
    expect(deaths[0].killer).toBe('-JPSP- まえる');
  });
});
