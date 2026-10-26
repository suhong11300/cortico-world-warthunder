import type { KbEntry } from './kb-types.ts';

/** 内置词条的版本号;远程更新成功后会换成远程版本。 */
export const KB_SEED_VERSION = '1.0.0';

/** 内置基础认知:概念、载具与玩法。刻意保持精简,细节留给远程更新与模型回答。 */
export const KB_SEED: KbEntry[] = [
  {
    id: "veh-p51d30",
    kind: "vehicle",
    name: "P-51D-30 野马",
    aliases: ["野马", "Mustang", "P-51"],
    summary: "美系单发战斗机。高空性能好、平飞快,适合从高处俯冲打一轮再拉起;B 站翼根 6 挺 .50 机枪弹道平直但单发威力偏小,要多点命中。低速机动一般,别跟日系缠。",
    tags: ["美系", "战斗机"],
    br: "RB 5.0",
    nation: "美系",
    category: "战斗机"
  },
  {
    id: "veh-f4u4b",
    kind: "vehicle",
    name: "F4U-4B 海盗",
    aliases: ["海盗", "Corsair"],
    summary: "美系舰载战斗机,低空速度与滚转优秀,4 门 20mm 机炮毁伤强。机翼布局使它在高速俯冲时稳,但低速盘旋半径大,打法偏高速度掠袭。",
    tags: ["美系", "战斗机"],
    br: "RB 5.7",
    nation: "美系",
    category: "战斗机"
  },
  {
    id: "veh-bf109g6",
    kind: "vehicle",
    name: "Bf 109 G-6",
    aliases: ["109", "Me109", "G-6"],
    summary: "德系主力战斗机,爬升与能量保持出色,1 门 20mm 机炮 + 2 挺机枪。垂直机动强、水平盘旋一般,标准打法是保持高度俯冲打一轮再爬升。",
    tags: ["德系", "战斗机"],
    br: "RB 4.7",
    nation: "德系",
    category: "战斗机"
  },
  {
    id: "veh-fw190d9",
    kind: "vehicle",
    name: "Fw 190 D-9",
    aliases: ["190", "Dora", "多拉"],
    summary: "德系战斗机,火力集中在机首(2 门 20mm + 2 挺 13mm),滚转极快但转向半径大。擅长高速掠袭与一击脱离,缠斗时要靠滚转与剪刀。",
    tags: ["德系", "战斗机"],
    br: "RB 5.3",
    nation: "德系",
    category: "战斗机"
  },
  {
    id: "veh-spitfire9",
    kind: "vehicle",
    name: "Spitfire F Mk IXc",
    aliases: ["喷火", "Spitfire"],
    summary: "英系战斗机,盘旋与低速操控极佳,2 门 20mm 机炮。水平格斗强、极速偏低,面对德系要逼对方进低空盘旋;追不上时不要硬追。",
    tags: ["英系", "战斗机"],
    br: "RB 4.3",
    nation: "英系",
    category: "战斗机"
  },
  {
    id: "veh-a6m5",
    kind: "vehicle",
    name: "A6M5 零战五二型",
    aliases: ["零战", "Zero"],
    summary: "日系战斗机,盘旋半径极小、低速灵活,2 门 20mm + 2 挺 7.7mm。极速与俯冲速度差,被咬住时靠盘旋摆脱,但绝对速度不足,别追逃跑的对手。",
    tags: ["日系", "战斗机"],
    br: "RB 5.0",
    nation: "日系",
    category: "战斗机"
  },
  {
    id: "veh-ki84",
    kind: "vehicle",
    name: "Ki-84 疾风",
    aliases: ["疾风", "Frank"],
    summary: "日系战斗机,兼顾速度与盘旋,2 门 20mm + 2 挺 12.7mm,中低空表现全面。是日系里少数能在速度上跟住美系的机型。",
    tags: ["日系", "战斗机"],
    br: "RB 5.3",
    nation: "日系",
    category: "战斗机"
  },
  {
    id: "veh-la7",
    kind: "vehicle",
    name: "La-7",
    aliases: ["拉7"],
    summary: "苏系战斗机,低空速度快、加速好,3 门 20mm 机炮火力集中。适合低空掠袭与贴身缠斗;高空性能弱,别在高空跟德系周旋。",
    tags: ["苏系", "战斗机"],
    br: "RB 5.3",
    nation: "苏系",
    category: "战斗机"
  },
  {
    id: "veh-yak3",
    kind: "vehicle",
    name: "Yak-3",
    aliases: ["雅克3"],
    summary: "苏系轻型战斗机,推重比高、中低空机动灵活,1 门 20mm + 2 挺 12.7mm。结构强度一般,俯冲速度需留意,打法偏主动进攻。",
    tags: ["苏系", "战斗机"],
    br: "RB 4.3",
    nation: "苏系",
    category: "战斗机"
  },
  {
    id: "veh-mig15",
    kind: "vehicle",
    name: "MiG-15bis",
    aliases: ["米格15"],
    summary: "苏系早期喷气战斗机,爬升与高空性能好,1 门 37mm + 2 门 23mm 机炮单发毁伤大但备弹少、弹道弯。速度略低于 F-86,靠爬升与垂直机动取胜。",
    tags: ["苏系", "喷气"],
    br: "RB 8.3",
    nation: "苏系",
    category: "喷气战斗机"
  },
  {
    id: "veh-f86",
    kind: "vehicle",
    name: "F-86F-25 佩刀",
    aliases: ["佩刀", "Sabre"],
    summary: "美系早期喷气战斗机,6 挺 .50 机枪备弹充足、高速操控好。滚转与持续盘旋略优,适合与米格打高亚音速缠斗。",
    tags: ["美系", "喷气"],
    br: "RB 8.3",
    nation: "美系",
    category: "喷气战斗机"
  },
  {
    id: "veh-t3485",
    kind: "vehicle",
    name: "T-34-85 (ZIS-S-53)",
    aliases: ["T3485", "3485"],
    summary: "苏系中型坦克,85mm 炮穿深与后效均衡,前装甲倾斜、机动好。车体侧面薄,要正面接敌并保持移动;炮塔转速慢,注意预瞄。",
    tags: ["苏系", "中型坦克"],
    br: "RB 5.7",
    nation: "苏系",
    category: "中型坦克"
  },
  {
    id: "veh-is2",
    kind: "vehicle",
    name: "IS-2 (1944)",
    aliases: ["IS2", "斯大林2"],
    summary: "苏系重型坦克,122mm 炮单发毁伤极强但装填慢(约 20 秒以上)。前装甲厚、侧面弱,靠掩体打一发换一个位置,别在开阔地停住。",
    tags: ["苏系", "重型坦克"],
    br: "RB 6.7",
    nation: "苏系",
    category: "重型坦克"
  },
  {
    id: "veh-tiger2h",
    kind: "vehicle",
    name: "Tiger II (H)",
    aliases: ["虎王", "KT"],
    summary: "德系重型坦克,首上装甲极厚、88mm 炮精度高,正面几乎无解。弱点是侧面、后部与炮塔正面(部分弹药可穿);速度慢,怕被侧翼绕后。",
    tags: ["德系", "重型坦克"],
    br: "RB 6.7",
    nation: "德系",
    category: "重型坦克"
  },
  {
    id: "veh-panther-a",
    kind: "vehicle",
    name: "Panther A",
    aliases: ["黑豹", "豹式"],
    summary: "德系中型坦克,长身管 75mm 穿深高、首上倾斜装甲有效,机动与火力平衡。倒车极慢,炮塔转速一般,避免近距离被绕。",
    tags: ["德系", "中型坦克"],
    br: "RB 6.0",
    nation: "德系",
    category: "中型坦克"
  },
  {
    id: "veh-m4a3e2",
    kind: "vehicle",
    name: "M4A3E2 谢尔曼 (Jumbo)",
    aliases: ["酱爆", "Jumbo", "M4A3E2"],
    summary: "美系突击坦克,额外装甲板让正面极硬,但用的是短 75mm 炮穿透一般。定位是顶前排抗伤、掩护队友,别指望自己一发解决对手。",
    tags: ["美系", "中型坦克"],
    br: "RB 6.3",
    nation: "美系",
    category: "中型坦克"
  },
  {
    id: "veh-m18",
    kind: "vehicle",
    name: "M18 地狱猫",
    aliases: ["地狱猫", "Hellcat"],
    summary: "美系坦克歼击车,极速快、76mm 炮穿深好,装甲几乎为零。靠偷袭与转移阵地取胜,被发现后要立刻脱离,别对射。",
    tags: ["美系", "坦克歼击车"],
    br: "RB 5.7",
    nation: "美系",
    category: "坦克歼击车"
  },
  {
    id: "veh-centurion3",
    kind: "vehicle",
    name: "Centurion Mk 3",
    aliases: ["百夫长"],
    summary: "英系中型坦克,20 磅炮精度与穿深高、俯角好,适合卖头。车体机动一般,装填偏慢,靠地形与首下遮挡换取优势。",
    tags: ["英系", "中型坦克"],
    br: "RB 7.7",
    nation: "英系",
    category: "中型坦克"
  },
  {
    id: "veh-t72b",
    kind: "vehicle",
    name: "T-72B",
    aliases: ["T72"],
    summary: "苏系主战坦克,低矮车体、125mm 滑膛炮、复合装甲,正面抗穿好。自动装弹机把弹药集中车体,侧面中弹易殉爆;倒车与炮塔转速慢。",
    tags: ["苏系", "主战坦克"],
    br: "RB 10.3",
    nation: "苏系",
    category: "主战坦克"
  },
  {
    id: "veh-leo2a4",
    kind: "vehicle",
    name: "Leopard 2A4",
    aliases: ["豹2", "Leo2"],
    summary: "德系主战坦克,120mm 滑膛炮、机动与炮塔转速优秀,火控舒适。装甲对动能弹一般,靠机动与地形先手;常与 T 系列互为对手。",
    tags: ["德系", "主战坦克"],
    br: "RB 10.3",
    nation: "德系",
    category: "主战坦克"
  },
  {
    id: "con-br",
    kind: "concept",
    name: "战斗评级 (BR)",
    aliases: ["BR", "分房", "战斗评级"],
    summary: "每台载具的战斗评级,决定它会被分到哪个房间。分房按队列里最高的载具计算,带一台高 BR 载具会把整队拉高;±1.0 是常见的分房跨度。",
    tags: ["入门", "分房"]
  },
  {
    id: "con-sl",
    kind: "concept",
    name: "银狮 (SL)",
    aliases: ["银狮", "SL", "Silver Lions"],
    summary: "游戏内基础货币,用于购买载具、维修、补弹与培训乘员。战局结束按表现与胜负结算,维修费从这里面扣。",
    tags: ["经济"]
  },
  {
    id: "con-ge",
    kind: "concept",
    name: "金鹰 (GE)",
    aliases: ["金鹰", "GE", "Golden Eagles"],
    summary: "付费货币,可用于换银狮、买高级载具、加速研发、买备用载具与涂装。也可以通过活动与卖出交易所物品获得少量。",
    tags: ["经济"]
  },
  {
    id: "con-rp",
    kind: "concept",
    name: "研发点 (RP)",
    aliases: ["研发点", "RP"],
    summary: "用于解锁新载具与配件。载具有各自的研发树位置,RP 不会跨线转移;高级载具与护身符能提高 RP 收益倍率。",
    tags: ["经济"]
  },
  {
    id: "con-repair",
    kind: "concept",
    name: "维修费与免费维修",
    aliases: ["维修费", "修理费"],
    summary: "载具被击毁后需支付维修费,历史上高 BR 载具的维修费能吃掉整局收益。免费维修会在停放一段时间后逐步恢复,可用来省钱练车。",
    tags: ["经济"]
  },
  {
    id: "con-money",
    kind: "concept",
    name: "收益系数",
    aliases: ["收益倍率", "SL 系数", "RP 系数"],
    summary: "每台载具有各自的银狮与研发点收益倍率,写在载具卡里。收益还受胜负、活跃度、击杀与占点影响,高倍率载具是练线的关键。",
    tags: ["经济"]
  },
  {
    id: "con-effective-armor",
    kind: "concept",
    name: "等效装甲",
    aliases: ["等效厚度", "倾斜装甲"],
    summary: "倾斜装甲的实际抗弹能力高于其物理厚度,弹道越斜越容易被弹开。看防护时不能只看数字,要结合入射角与弹种(动能弹怕倾角,化学弹不吃倾角)。",
    tags: ["防护"]
  },
  {
    id: "con-penetration",
    kind: "concept",
    name: "穿甲深度",
    aliases: ["穿深", "penetration"],
    summary: "炮弹在特定距离与角度下能击穿的最大厚度。不同弹种随距离衰减不同:APFSDS 基本不衰减,APHE 与 AP 会随距离下降,HEAT 与距离无关但怕栅栏与间隙装甲。",
    tags: ["火力"]
  },
  {
    id: "con-ricochet",
    kind: "concept",
    name: "跳弹",
    aliases: ["跳弹", "ricochet"],
    summary: "入射角过大时动能弹会被弹开而不是击穿,通常超过约 60 度就明显。用大口径或高穿深弹可以降低跳弹概率;化学弹(HEAT/HE)一般不跳弹。",
    tags: ["火力"]
  },
  {
    id: "con-postpen",
    kind: "concept",
    name: "后效与破片",
    aliases: ["后效", "破片"],
    summary: "击穿后弹体与装甲碎片在车内造成的伤害。装药弹(APHE)有额外爆炸破片、后效最好;APFSDS 靠剩余动能与杆体碎片,打空车体可能只伤不毁。",
    tags: ["火力"]
  },
  {
    id: "con-aphe",
    kind: "concept",
    name: "APHE 装药穿甲弹",
    aliases: ["APHE", "装药弹"],
    summary: "带炸药的空腔穿甲弹,击穿后在车内爆炸,后效集中且杀伤强。缺点是初速与穿深通常不如同期的实心弹,远距离穿深衰减更明显。",
    tags: ["弹药"]
  },
  {
    id: "con-apfsds",
    kind: "concept",
    name: "APFSDS 尾翼稳定脱壳穿甲弹",
    aliases: ["APFSDS", "钢针", "脱壳穿甲"],
    summary: "现代坦克主力动能弹,细长钨/贫铀杆,初速高、穿深大且几乎不随距离衰减。后效偏窄,需要打要害(弹药架、炮塔乘员)才有决定效果。",
    tags: ["弹药"]
  },
  {
    id: "con-heat",
    kind: "concept",
    name: "HEAT 破甲弹",
    aliases: ["HEAT", "破甲弹", "聚能"],
    summary: "靠聚能装药形成金属射流穿透装甲,穿深与距离无关,不吃倾角。弱点是被栅栏、间隙装甲、复合装甲与反应装甲大幅削弱,常作为低穿深车的备用弹。",
    tags: ["弹药"]
  },
  {
    id: "con-ammorack",
    kind: "concept",
    name: "弹药架殉爆",
    aliases: ["殉爆", "弹药架"],
    summary: "弹药集中在车体或炮塔内,被击穿后可能整台车瞬间销毁。打对方车体侧面与后部通常更容易命中弹药;自己的弹药带少一些也能降低殉爆概率。",
    tags: ["防护", "技巧"]
  },
  {
    id: "con-stall",
    kind: "concept",
    name: "失速与尾旋",
    aliases: ["失速", "尾旋", "stall"],
    summary: "空速过低时升力不足,机翼失去操控并可能进入尾旋。爬升时注意速度表,低于机动速度要压机头换速度;进尾旋后反向蹬舵并推杆改出。",
    tags: ["空战"]
  },
  {
    id: "con-bnz",
    kind: "concept",
    name: "能量战 (Boom and Zoom)",
    aliases: ["BnZ", "能量战", "一击脱离"],
    summary: "靠高度换速度、俯冲打一轮再爬升脱离的空战思路。核心是永远保持比对手更高的能量,不在低空低速与人缠斗;缺点是耗时、怕被多人围。",
    tags: ["空战", "战术"]
  },
  {
    id: "con-scissors",
    kind: "concept",
    name: "剪刀机动",
    aliases: ["剪刀", "scissors"],
    summary: "两机反复交叉换向、靠滚转与升力消耗对方速度的格斗动作。滚转快的机型(如 Fw 190)占优;防守方用平剪刀拖时间等队友,进攻方要避免被拖入。",
    tags: ["空战", "战术"]
  },
  {
    id: "con-lead",
    kind: "concept",
    name: "提前量与弹道下坠",
    aliases: ["提前量", "弹道下坠", "lead"],
    summary: "机炮需要按目标速度与距离提前瞄准,子弹还有重力下坠。近距离(300m 内)最省事;远距离要抬高准星并多给提前量,别在 800m 外浪费弹药。",
    tags: ["空战", "技巧"]
  },
  {
    id: "con-mec",
    kind: "concept",
    name: "手动发动机控制 (MEC)",
    aliases: ["MEC", "手动控制"],
    summary: "可分别调节桨距、混合比、散热与增压。用散热全开换持续动力、收桨距提高爬升,是高手拉开性能差距的手段;操作失误会烧发动机。",
    tags: ["空战", "进阶"]
  },
  {
    id: "con-crew",
    kind: "concept",
    name: "乘员与精通",
    aliases: ["乘员", "精通", "Expert", "Ace"],
    summary: "乘员技能(装填、瞄准、修理、生命)直接影响实战表现,可用银狮或金鹰培训。载具达到「精通/王牌」还会给额外收益与性能加成。",
    tags: ["成长"]
  },
  {
    id: "con-scout",
    kind: "concept",
    name: "侦察标记",
    aliases: ["侦察", "Scout", "标记"],
    summary: "轻型车辆用望远镜标记敌人,被标记的目标对全队可见,自己还能拿到助攻收益。标记有冷却,优先标威胁大或藏在掩体后的目标。",
    tags: ["陆战", "支援"]
  },
  {
    id: "con-damage-model",
    kind: "concept",
    name: "损伤模型",
    aliases: ["损伤模型", "模块"],
    summary: "载具由车体、炮塔、发动机、传动、炮管、履带、乘员等模块组成,打坏哪个部件就失去对应能力。打发动机让它动不了、打炮管让它哑火,比硬啃装甲更划算。",
    tags: ["防护", "技巧"]
  },
  {
    id: "con-ap-shell",
    kind: "concept",
    name: "弹种选择",
    aliases: ["选弹", "弹药选择"],
    summary: "同一门炮常有好几种弹:穿深高的实心弹、后效好的装药弹、不怕倾角的破甲弹、打轻装甲的榴弹。按对手装甲与交战距离切换,是陆战最直接的收益点。",
    tags: ["火力", "技巧"]
  },
  {
    id: "play-aab",
    kind: "play",
    name: "空战街机 (AAB)",
    aliases: ["街机空战", "AAB"],
    summary: "节奏快的空战模式,有瞄准辅助、可多次复活、载具性能被平衡。适合练枪法与熟悉机型,收益倍率低于历史模式。",
    tags: ["模式", "空战"]
  },
  {
    id: "play-arb",
    kind: "play",
    name: "空战历史 (ARB)",
    aliases: ["历史空战", "ARB"],
    summary: "一次出击、无瞄准辅助、性能按史实,收益与风险都更高。核心是爬升抢高度、保持能量、判断何时进攻;单人乱冲很容易被围。",
    tags: ["模式", "空战"]
  },
  {
    id: "play-grb",
    kind: "play",
    name: "陆战历史 (GRB)",
    aliases: ["历史陆战", "GRB", "地面历史"],
    summary: "坦克为主、可带飞机与防空,需要自己索敌(无敌人标记)。考验地图熟悉度、听声辨位与阵地选择,是收益与练习价值最高的陆战模式。",
    tags: ["模式", "陆战"]
  },
  {
    id: "play-sb",
    kind: "play",
    name: "全真模式 (SB)",
    aliases: ["全真", "SB", "Simulator"],
    summary: "最拟真的模式:座舱视角、无辅助、友军识别靠自己判断。收益倍率最高,门槛也最高,适合想练拟真飞行的玩家。",
    tags: ["模式", "拟真"]
  },
  {
    id: "play-mixed",
    kind: "play",
    name: "混战模式",
    aliases: ["混战", "Mixed"],
    summary: "空地一体的模式,坦克、飞机、防空同场。需要同时处理空中威胁与地面目标,适合练多线判断与快速切载具。",
    tags: ["模式"]
  },
  {
    id: "play-cap",
    kind: "play",
    name: "占点与爆破",
    aliases: ["占点", "爆破", "cap"],
    summary: "陆战主要胜利条件是抢占控制点并守住,或摧毁对方基地。占点给持续收益,但别全员挤在一个点被一锅端;分兵守侧翼往往更稳。",
    tags: ["模式", "战术"]
  },
  {
    id: "play-cas",
    kind: "play",
    name: "空袭与炮击支援",
    aliases: ["空袭", "炮击", "CAS"],
    summary: "陆战里可以用飞机对地攻击或呼叫火炮覆盖。炮击适合压制固定点位,空袭适合清掉卡点的重装甲;用之前先确认队友位置,别误伤。",
    tags: ["陆战", "支援"]
  },
  {
    id: "play-bp",
    kind: "play",
    name: "战斗通行证与每日任务",
    aliases: ["通行证", "每日任务", "BP"],
    summary: "周期性任务给银狮、研发点、贴花与载具奖励。按任务要求选模式与载具能显著提高效率,别用高 BR 车去刷低 BR 任务。",
    tags: ["成长", "经济"]
  },
  {
    id: "play-squad",
    kind: "play",
    name: "小队与连击奖励",
    aliases: ["小队", "连击", "Squad"],
    summary: "组队打能共享侦察、分摊火力并获得小队奖励加成。连击(短时间内多次击杀)会额外提高收益,顺势推进比单打独斗划算。",
    tags: ["成长", "社交"]
  },
  {
    id: "play-map",
    kind: "play",
    name: "地图与阵位",
    aliases: ["地图", "阵位", "positioning"],
    summary: "同一张图的不同阵位价值差别极大:高台能压制通道但容易被飞机盯上,城内巷战适合机动好的车。记住常用卡点与绕后路线,比堆装甲更有效。",
    tags: ["陆战", "战术"]
  },
];
