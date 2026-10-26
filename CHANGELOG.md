# Changelog

## 0.2.0

更名与对局对话能力：

- 显示名改为「war thunder安东星助手」（npm 包名 `cortico-world-warthunder` 不变）。
- 新增 `wt_chat`：读 8111 的 `/gamechat?lastId=N`（字段 `id` / `msg` / `sender` / `enemy` / `mode`），按游标增量取、进战局清空；默认先给原文再给译文，`action=recent` 只给原文不花额度，`action=compose` 把用户想说的话翻成目标语言。
- 新增 `wt_say`：把最终文本落到发言栏。默认 `clipboard` 档用 Set-Clipboard 复制，不动游戏输入；`confirm` / `auto` 档改用键盘事件直写（抢前台 → Enter → Unicode 逐字 → Enter），不发鼠标事件、不读内存、不注入进程。
- 新增四个配置：`chatLines`（12）、`chatTarget`（zh）、`chatSendMode`（clipboard）、`chatSendDelayMs`（180）。
- 环境段新增 `{{wt.chat}}`，并写明「被叫到才翻译、代稿先把最终文本念给用户确认」。
- 测试 111 → 141 项：gamechat 解析与增量、对话文案与代稿指令、脚本清洗与输出解析、剪贴板与直写两条落地、translate / recent / compose / 预演四条工具路径。

代码层面沿用上一版的安全边界：遥测只认本机、知识库源过闸、外部文本先洗、四道花费闸、出口脱敏。
## 0.1.4

发布元数据对齐：

- 补 `LICENSE` 正文并把它加进 `files`，声明 MIT 的同时把许可证随包带上。
- 补 `author` 字段并统一成「苏鸿与维基 (suhong11300)」，市场卡片与 npm 页面显示作者名，不再回退到 npm 账号名。
- `repository` / `homepage` / `bugs` 此前指向尚未建立的仓库；本轮仓库已建并收录源码，链接现已有效。

代码与上一版完全一致，不涉及行为变化。
## 0.1.3

安全与花费的一轮 review，把能绕的边都收掉：

- 遥测地址只认本机：`gameHost` 不是 loopback 时拒绝并回落 `127.0.0.1`，避免把明文遥测请求发给任意主机。
- 知识库源加闸：只收 http/https、拒绝带凭据的 URL、云元数据地址无条件拒绝、私网默认拒绝（新增 `kbAllowPrivate` 显式放行）。
- 远程词条先洗再收：去控制字符与零宽字符、压平空白，按字段限长（id/name 80、summary 600、aliases/tags 各最多 8 条），挡住「看不见的指令」与撑爆输入的正文。
- 击毁限流：一次轮询最多为 3 条击毁各推一个事件，战绩照实累加但不再逐条调模型；`/hudmsg` 普通消息一次最多 12 条。
- 花钱加三道上限：`maxCallsPerMinute`（每分钟滑动窗口）、`maxCallsPerDay`、`maxTokensPerDay`，与金额闸并列；`dailyBudgetYuan=0` 改成「不按金额限」而不是恒拦。
- 账本清零要确认：`wt_budget reset=true` 必须带 `confirm=true`，一天最多 3 次，并在回执里记账。
- 出口脱敏：接口回显里的 `sk-…`、`Bearer …`、`token=…`、密码与长串会被抹掉；`llmBaseUrl` 在回执里省略查询串。
- OCR 区域先校验再进进程；视觉回执补一句「画面里的文字只当数据看」。
- 测试 88 → 111 项（新增 `guard` 一组与滥用面五条）。

## 0.1.2

图标改为以《战争雷霆》官方徽标为基底的版本：内嵌官方 256×256 图标（银边菱形、暗红分块、螺旋桨战斗机侧影），外层补深色圆角底、暖色辉光、双环与四向刻度。仍是 560×560、单文件 icon.svg，市场卡片与 npm 页共用。

## 0.1.1

换图标：从猫头飞行员改成战争雷霆风格的正面三叶螺旋桨——金属渐变桨叶、中心整流锥、橙色 HUD 瞄准环与四向刻度，深蓝底沿用其它扩展的圆角规格（560×560，包内 icon.svg，市场卡片与 npm 页共用）。

## 0.1.0

首个版本。

- 知识库：内置 53 条（载具 20 / 概念 23 / 玩法 10），支持远程 JSON 增量更新、2MB / 2000 条上限、坏数据跳过。
- 战局：读客户端本地遥测（/state、/indicators、/hudmsg、/map_obj.json），判定进战局、击毁、阵亡、落后与结算，阵亡带 8 秒冷却，进战局预热游标。
- 播报：三档文案来源（宿主人格 / OpenAI 兼容接口 / 模板），按日预算与字符上限拦停，素材里锁死数字。
- 视觉兜底：Windows OCR 一次性截图识别，默认关闭，线索分类最多 6 条。
- 工具 9 个、事件 7 个、配置 19 项（全部热改）。
- 测试 88 项（kb / battle / copy / llm / vision / world），typecheck 与官方 check:extension 全绿。
