/** 知识库词条的公共形状,种子与远程更新共用。 */
export type KbKind = 'concept' | 'vehicle' | 'play';

export interface KbEntry {
  id: string;
  kind: KbKind;
  name: string;
  aliases?: string[];
  summary: string;
  tags?: string[];
  /** 战斗评级,只对载具有意义。 */
  br?: string;
  /** 国家线,只对载具有意义。 */
  nation?: string;
  /** 载具类别或概念分类。 */
  category?: string;
}
