import type { Lang } from './copy.ts';
export type SpeechStyle = '人格' | '模板';

/**
 * 人格档附在事实后面的短引导。
 *
 * 字数上限在这里是一句「要求」，不是裁剪：素材原样交给桌宠，由它自己压到要求以内。
 * 0.4.3 之前人格档也被 clampBroadcast 裁过一遍，等于插件先替桌宠写完，人格没得发挥。
 */
function retell(lang: Lang, limit: number): string {
  if (lang === 'en') {
    const size = limit > 0 ? ' within ' + limit + ' characters' : ' at whatever length fits';
    return '\n\n(The lines above are readings, not a message to send: retell them in your own voice' + size +
      ', you may add one line of reaction or a follow-up question, but do not repeat field names. Talk only about the items present above: never mention an item that was not asked for' +
      ' (if the user asked about status, do not bring up position, enemies or kills). Add no fact outside these lines; keep every number, unit, ownership, name and "unknown" as given, and never abbreviate a player or vehicle name.)';
  }
  const size = limit > 0 ? '不超过 ' + limit + ' 字' : '长短随你';
  return '\n\n（以上是读数素材，不是要发出去的正文：按你的口吻重讲，' + size +
    '，可以加一句反应或追问，但别逐字复读字段名。只讲上面已经出现的项，用户没问的项一个字都不提' +
    '（比如只问状态就别提位置、敌我或战绩）；素材之外的事实一律不加；数字、单位、归属、名称与「未知」照原样，玩家名与载具全称不缩写不省略。）';
}
/**
 * 事件正文的表达约定。
 *
 * 0.3.x 在这里塞过一段四行长指令（「使用现有Persona…逐字发送…不改写不省略…」），结果是每次播报
 * 正文前面都顶着一份提示词。0.3.2 把它整段删掉，却删过头：人格档收到的正文与事实清单逐字相同，
 * 模型于是照抄清单，播报退化成模板。
 *
 * 现在的分工：人格档＝完整素材＋一句含字数的引导，由桌宠自己组织；模板档＝插件按档位选好详略的
 * 定稿正文，不加任何前后缀。
 */
export function presentBattleFacts(factText: string, style: SpeechStyle, lang: Lang, limitChars = 0): string {
  const body = factText.trim();
  if (!body) return body;
  if (style !== '人格') return body;
  return body + retell(lang, limitChars);
}

export const BATTLE_SPEECH_EVENTS = new Set(['wt.ready', 'wt.battle_started', 'wt.kill', 'wt.death', 'wt.behind', 'wt.commentary', 'wt.result']);

/** 写进环境段的一句话口吻约定：数字不改、限定不删，其余交给现有 Persona。 */
export const PERSONA_HINT_ZH = '播报事实由你用自己的口吻讲，可以带情绪或补一句追问；只讲素材里已有的项，用户没声明查询的项一律不提，素材之外的事实不加；数字、单位、归属与「未知」四样照原样。';
export const PERSONA_HINT_EN = 'Speak the facts in your own voice; reactions and a follow-up question are welcome. Mention only the items present in the material, never an item the user did not ask for, and add no fact outside it; numbers, units, ownership and every "unknown" stay as given.';

export function personaHint(lang: Lang): string {
  return lang === 'en' ? PERSONA_HINT_EN : PERSONA_HINT_ZH;
}
