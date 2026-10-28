import type { Lang } from './copy.ts';
export type SpeechStyle = '人格' | '模板';

/** 只添加可信表达请求，事实正文逐字不动。最终Persona回复仍需桌宠实测，不保证模型零改写。 */
export function presentBattleFacts(factText: string, style: SpeechStyle, lang: Lang): string {
  const instruction = lang === 'en'
    ? style === '人格'
      ? '[Presentation: persona] Send the complete fact body below verbatim to the final speech/bubble/console channel, including every qualification. Do not paraphrase or omit it. Persona applies only to a separate short, non-factual encouragement. Never infer moving/stopped from unitless raw speed, or convert visible counts to whole-match totals.'
      : '[Presentation: template] Relay the facts below verbatim. Do not rephrase or add banter.'
    : style === '人格'
      ? '【表达模式：人格】使用现有Persona，但先把以下事实块正文逐字发送到最终语音/气泡/控制台渠道，包括全部括号限定，不改写、不省略。人格只用于正文之外一句不含新战况的简短鼓励；不得把单位未确认的原始速度推断成移动、停止或停下，不得将地图可见数说成全场总数。'
      : '【表达模式：模板】请原样转述以下事实块，不润色、不额外调侃或补充战况。';
  return instruction + '\n【事实开始】\n' + factText + '\n【事实结束】';
}

export const BATTLE_SPEECH_EVENTS = new Set(['wt.ready', 'wt.battle_started', 'wt.kill', 'wt.death', 'wt.behind', 'wt.commentary', 'wt.result']);
