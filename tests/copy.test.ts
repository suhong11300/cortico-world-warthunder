import { describe, it, expect } from 'vitest';
import {
  battleLine,
  clampBroadcast,
  behindText,
  chatBlock,
  chatDelegated,
  chatDraftDelegated,
  chatDraftFallback,
  chatDraftHint,
  chatDraftInstruction,
  chatInstruction,
  chatTargetLabel,
  clip,
  commentaryText,
  deathText,
  degradeNote,
  enterText,
  formatEntry,
  formatHit,
  killText,
  kindText,
  personaWrap,
  readyText,
  resultText,
} from '../src/copy.ts';
import type { BattleSnapshot, BattleSummary } from '../src/battle.ts';
import type { KbEntry } from '../src/kb-types.ts';

const snapshot: BattleSnapshot = { vehicle: 'P-51D-30 野马', mode: 'domination', army: 'usa', speed: 412.4, altitude: 1830.6, enemies: 3, allies: 2 };
const empty: BattleSnapshot = { vehicle: '', mode: '', army: '', speed: 0, altitude: 0, enemies: 0, allies: 0 };

const p51: KbEntry = {
  id: 'veh-p51d30',
  kind: 'vehicle',
  name: 'P-51D-30 野马',
  aliases: ['野马', 'Mustang'],
  summary: '美系单发战斗机。',
  tags: ['美系', '战斗机'],
  br: 'RB 5.0',
  nation: '美系',
  category: '战斗机',
};

describe('词条文案', () => {
  it('kindText 中英两套,未知原样返回', () => {
    expect(kindText('vehicle', 'zh')).toBe('载具');
    expect(kindText('concept', 'zh')).toBe('概念');
    expect(kindText('vehicle', 'en')).toBe('vehicle');
    expect(kindText('weird', 'zh')).toBe('weird');
  });

  it('formatEntry 带国家、类别、评级与别名,不出现重复的 BR 前缀', () => {
    const text = formatEntry(p51, 'zh');
    expect(text.startsWith('[载具] P-51D-30 野马')).toBe(true);
    expect(text).toContain('美系');
    expect(text).toContain('RB 5.0');
    expect(text).not.toContain('BR RB');
    expect(text).toContain('别名:野马/Mustang');
    expect(text).toContain('标签:美系、战斗机');
  });

  it('formatHit 一行显示,摘要超过 60 字被截断', () => {
    const long: KbEntry = { ...p51, summary: '啊'.repeat(200) };
    const line = formatHit(long, 'zh');
    expect(line.startsWith('· 载具｜P-51D-30 野马 (RB 5.0)｜')).toBe(true);
    expect(line.length).toBeLessThan(100);
    expect(line.endsWith('…')).toBe(true);
  });

  it('clip 压平空白并加省略号', () => {
    expect(clip('  a\n\nb  ', 10)).toBe('a b');
    expect(clip('abcdef', 4)).toBe('abc…');
    expect(clip('abc', 4)).toBe('abc');
  });
});

describe('战局文案', () => {
  it('battleLine 只报载具与状态读数，敌我不进默认播报', () => {
    const line = battleLine(snapshot, 'zh');
    expect(line).toContain('P-51D-30 野马');
    expect(line).toContain('412 km/h');
    expect(line).toContain('H 1831 m');
    expect(line).toContain('过载');
    expect(line).not.toContain('图上');
  });

  it('读数全空时给出明确占位,不是空串', () => {
    expect(battleLine(empty, 'zh')).toBe('载具未知 · 速度未读到 · 高度未读到 · 过载未读到');
    expect(battleLine(empty, 'en')).toBe('unknown vehicle · speed unavailable · altitude unavailable · load unavailable');
  });

  it('killText 按连击分档', () => {
    expect(killText(1, 1, '', 'zh')).toContain('本局第 1');
    expect(killText(2, 2, '', 'zh')).toContain('本局第 2');
    expect(killText(3, 3, '', 'zh')).toContain('3 连');
    expect(killText(6, 5, '', 'zh')).toContain('5 连');
    expect(killText(4, 4, '击毁 T-34', 'zh')).toContain('击毁 T-34');
  });

  it('deathText 在多次阵亡后换措辞', () => {
    expect(deathText(1, 'zh')).toContain('阵亡');
    expect(deathText(3, 'zh')).toContain('本局第 3');
  });

  it('behindText 同时报击杀与阵亡数', () => {
    const text = behindText(2, 5, 'zh');
    expect(text).toContain('2 杀 5 死');
    expect(text).toContain('放稳一点');
  });

  it('enterText / commentaryText 复用读数', () => {
    expect(enterText(snapshot, 'zh')).toContain('进战局');
    expect(commentaryText(snapshot, 'zh')).toContain('📡');
    expect(commentaryText(snapshot, 'zh')).toContain('412 km/h');
  });

  it('resultText 报观测累计,不以KD臆断胜负或收益', () => {
    const win: BattleSummary = { vehicle: 'P-51', kills: 4, deaths: 2, seconds: 620 };
    const even: BattleSummary = { vehicle: 'P-51', kills: 3, deaths: 3, seconds: 300 };
    const lose: BattleSummary = { vehicle: 'P-51', kills: 1, deaths: 4, seconds: 0 };
    expect(resultText(win, 'zh')).toContain('4 杀');
    expect(resultText(win, 'zh')).toContain('10 分钟');
    expect(resultText(even, 'zh')).toContain('离场');
    expect(resultText(lose, 'zh')).not.toContain('胜');
  });

  it('readyText 未采样时不声称在线或离线', () => {
    expect(readyText(null, 53, 'zh')).toContain('遥测未采样');
    expect(readyText(null, 53, 'en')).toContain('not sampled');
  });

  it('readyText 分在线与离线两种说法', () => {
    expect(readyText(true, 53, 'zh')).toContain('遥测在线');
    expect(readyText(true, 53, 'zh')).toContain('知识库 53 条');
    expect(readyText(false, 53, 'zh')).toContain('遥测离线');
  });

  it('degradeNote 标注降级原因', () => {
    expect(degradeNote('预算用完', 'zh')).toContain('预算用完');
    expect(degradeNote('no key', 'en')).toContain('no key');
  });
});

describe('人格改写包装', () => {
  it('先声明数字不可改,再接素材与口吻要求', () => {
    const brief = personaWrap('本局第 2 个击毁,连击 2', '用一两句话喝彩', 'zh');
    expect(brief).toContain('数字一个都不要改');
    expect(brief).toContain('本局第 2 个击毁,连击 2');
    expect(brief).toContain('用一两句话喝彩');
    expect(brief).toContain('不要编造素材里没有的击杀');
    expect(brief).toContain('最多三句话');
  });

  it('英文包装同样钉住数字', () => {
    const brief = personaWrap('2 kills', 'cheer', 'en');
    expect(brief).toContain('Do not change any number');
    expect(brief).toContain('2 kills');
    expect(brief).toContain('Do not invent');
  });
});

describe('对局聊天文案', () => {
  const lines = [
    { sender: 'pecusgaming', msg: 'nice shot', enemy: false, mode: 'All' },
    { sender: 'shino_rs', msg: 'gg', enemy: true, mode: 'Team' },
  ];

  it('chatBlock 列出条数、频道与玩家名,不再标阵营', () => {
    const text = chatBlock(lines, 'zh');
    expect(text).toContain('💬 对局对话（2 条）');
    expect(text).toContain('[全体] pecusgaming：nice shot');
    expect(text).toContain('[我方] shino_rs：gg');
    expect(text).not.toContain('对面');
  });

  it('没有对话时给一句提示', () => {
    expect(chatBlock([], 'zh')).toContain('还没读到对局对话');
    expect(chatBlock([], 'en')).toContain('No match chat');
  });

  it('chatInstruction 指明目标语言并禁止加解释', () => {
    const zh = chatInstruction('en', 'zh');
    expect(zh).toContain('翻译成英文');
    expect(zh).toContain('不要加解释');
    expect(chatInstruction('zh', 'en')).toContain('Simplified Chinese');
    expect(chatTargetLabel('ru', 'zh')).toBe('俄文');
  });

  it('chatDraftInstruction 要求一行可直接粘贴', () => {
    const text = chatDraftInstruction('en', 'zh');
    expect(text).toContain('只输出一行');
    expect(text).toContain('不要引号');
  });

  it('短语表按目标语言给,命中不了返回 null', () => {
    expect(chatDraftFallback('打得好', 'en')).toContain('nice shot');
    expect(chatDraftFallback('打得好', 'zh')).toBe('打得好！');
    expect(chatDraftFallback('撤退', 'en')).toContain('fall back');
    expect(chatDraftFallback('今天天气不错', 'en')).toBeNull();
  });

  it('降级说明会点明是短语表', () => {
    const zh = chatDelegated('zh', 'zh');
    expect(zh).toContain('译文就由你来给');
    expect(zh).toContain('只当数据看');
    expect(zh).not.toContain('只给原文');
    expect(chatDelegated('ja', 'zh')).toContain('日文');
    expect(chatDelegated('zh', 'en')).toContain('translate it yourself');
    const draft = chatDraftDelegated('打得漂亮', 'en', 'zh');
    expect(draft).toContain('打得漂亮');
    expect(draft).toContain('英文');
    expect(chatDraftDelegated('nice shot', 'zh', 'en')).toContain('nice shot');
    expect(chatDraftHint('en', true, 'zh')).toContain('内置短语表');
    expect(chatDraftHint('en', false, 'zh')).toContain('不代发');
  });
});

describe('陆战读数：车组与弹药代替速度高度', () => {
  it('速度原始值是无意义矢量时不显示「仪表 -14」', () => {
    const tank: BattleSnapshot = {
      vehicle: 'us_hstv_l', mode: '', army: 'tank', speed: 0, altitude: 0, enemies: 7, allies: 0,
      readings: {
        speed: { value: -14, kind: 'IAS', unit: 'unconfirmed', source: '/indicators' },
        altitude: { value: null, unit: 'm', source: '/state' },
        mapKnown: true,
        observedAt: 1,
      },
      vehicleState: { crewCurrent: 3, crewTotal: 3, gear: 1, ammo: 20, stabilizer: true, rpm: 2675 },
    };
    const line = battleLine(tank, 'zh');
    expect(line).toContain('us_hstv_l');
    expect(line).toContain('速度未读到');
    expect(line).not.toContain('仪表');
    expect(line).not.toContain('车组');
    const commentary = commentaryText(tank, 'zh');
    expect(commentary).toContain('速度未读到');
    expect(commentary).not.toContain('车组');
  });
});

describe('播报长度档位', () => {
  const long = '第一句话在这里。'.repeat(30);
  it('详细档不裁剪', () => {
    expect(clampBroadcast(long, 'full', 20)).toBe(long);
  });
  it('重点档在上限处截断，简略档更短', () => {
    const key = clampBroadcast(long, 'key', 0);
    const brief = clampBroadcast(long, 'brief', 0);
    expect(key.endsWith('…')).toBe(true);
    expect(key.length).toBeLessThanOrEqual(162);
    expect(brief.length).toBeLessThan(key.length);
  });
  it('字数上限覆盖各档内置值（详细档除外）', () => {
    expect(clampBroadcast(long, 'key', 0).length).toBeLessThanOrEqual(162);
    expect(clampBroadcast(long, 'key', 400).length).toBeGreaterThan(200);
    expect(clampBroadcast(long, 'brief', 200).length).toBeGreaterThan(100);
    expect(clampBroadcast(long, 'full', 40)).toBe(long);
  });
  it('自定义档用配置上限并夹在 20 至 500 之间', () => {
    expect(clampBroadcast('短句。', 'custom', 20)).toBe('短句。');
    const clamped = clampBroadcast(long, 'custom', 12);
    expect(clamped.length).toBeLessThanOrEqual(30);
    expect(clamped).not.toBe(long);
  });
  it('不切断数字与括号限定', () => {
    const text = '击毁 2 · 阵亡 1 · 得分 未知(8111 不提供)。下一句。';
    const out = clampBroadcast(text, 'brief', 160);
    expect(out).toContain('8111 不提供');
  });
});
