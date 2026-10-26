/** 包入口:默认导出 `WorldDefinition`,加载器按 `cortico.kind === 'world'` 认它。 */
import { WT } from './definition.ts';

export default WT;
export { WT };
export { WtWorld } from './world.ts';
export type { WtConfigSection } from './config.ts';
