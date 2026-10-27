import { describe, it, expect } from 'vitest';
import {
  battleLine,
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
  it('battleLine 把速度高度与敌我数量拼成一行', () => {
    const line = battleLine(snapshot, 'zh');
    expect(line).toContain('P-51D-30 野马');
    expect(line).toContain('速度 412 km/h');
    expect(line).toContain('高度 1831 m');
    expect(line).toContain('地图可见 3 敌 / 2 友');
  });

  it('读数全空时给出明确占位,不是空串', () => {
    expect(battleLine(empty, 'zh')).toBe('载具数据还没读全');
    expect(battleLine(empty, 'en')).toBe('unknown vehicle');
  });

  it('killText 按连击分档', () => {
    expect(killText(1, 1, '', 'zh')).toContain('击毁一个');
    expect(killText(2, 2, '', 'zh')).toContain('两连击');
    expect(killText(3, 3, '', 'zh')).toContain('连拿 3 个');
    expect(killText(6, 5, '', 'zh')).toContain('五连以上');
    expect(killText(4, 4, '击毁 T-34', 'zh')).toContain('击毁 T-34');
  });

  it('deathText 在多次阵亡后换措辞', () => {
    expect(deathText(1, 'zh')).toContain('别上头');
    expect(deathText(3, 'zh')).toContain('第 3 次');
  });

  it('behindText 同时报击杀与阵亡数', () => {
    const text = behindText(2, 5, 'zh');
    expect(text).toContain('2 杀 5 死');
    expect(text).toContain('逆风');
  });

  it('enterText / commentaryText 复用读数', () => {
    expect(enterText(snapshot, 'zh')).toContain('进战局了');
    expect(commentaryText(snapshot, 'zh')).toContain('战况');
    expect(commentaryText(snapshot, 'zh')).toContain('速度 412 km/h');
  });

  it('resultText 按击杀减阵亡给出赚平亏判断', () => {
    const win: BattleSummary = { vehicle: 'P-51', kills: 4, deaths: 2, seconds: 620 };
    const even: BattleSummary = { vehicle: 'P-51', kills: 3, deaths: 3, seconds: 300 };
    const lose: BattleSummary = { vehicle: 'P-51', kills: 1, deaths: 4, seconds: 0 };
    expect(resultText(win, 'zh')).toContain('这局是赚的');
    expect(resultText(win, 'zh')).toContain('打了约 10 分钟');
    expect(resultText(even, 'zh')).toContain('势均力敌');
    expect(resultText(lose, 'zh')).toContain('换条线路');
  });

  it('readyText 分在线与离线两种说法', () => {
    expect(readyText(true, 53, 'zh')).toContain('遥测已连上');
    expect(readyText(true, 53, 'zh')).toContain('知识库 53 条');
    expect(readyText(false, 53, 'zh')).toContain('遥测没连上');
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
