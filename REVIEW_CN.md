# 插件整体审查与本轮修复

日期：2026-10-26。起点提交：`eea5d2f`（v0.3.0）。
本轮版本：v0.5.0，已提交并推送（`24d1dd6`），已发布 GitHub Release `v0.5.0`
（Windows/Linux amd64 安装包与 `checksums.txt`）；尚未部署到用户服务器。
上游同步：OFM `f9cdb664` → `7e3a1da`（v2.1.0），控制台随上游换成新面板。

后续：v0.5.1（2026-10-13）把上游再同步到 `ddb451c`（上游 v2.1.0 + v5.1 UI 精修）。
本次上游改动只有 `packages/standalone/web/app.css` 落在 vendored 范围内，是暗色主题
圆角覆盖的样式微调；`src/`、控制台 JS、渠道代码与 `assets.json` 均未变化。
新增的 Tauri 桌面版与未被引用的 `splash.html` 不进入本插件包。

## v0.5.16：同步上游 OFM v2.7.2

上游在 v2.5.9 之后发布了 v2.6.0、v2.7.0、v2.7.1 与 v2.7.2，本轮把 vendored
快照从 `f3ecb7a` 重取到 `e1b347a`。文件数由 94 增至 121，新增模型工作台、
Magpie 引擎载荷、订阅/Gemini 运行时、供应商/资源库/路由管理模块与免责声明。
前端资源重新生成为 `channels-CwUJPBXI.js`、`models-CCoW-2uM.js`、
`settings-CdBN6B3K.js` 与 `usage-JY1Fq3E5.js`。

- **模型工作台**：上游把独立端的 Magpie 工作台带入插件。引擎二进制由九个 gzip
  分片和固定 SHA-256 校验后还原到 CPA 私有目录；没有把平台二进制直接提交为
  vendored 文件。
- **沙箱兼容**：主控制台与工作台都是 opaque origin。没有放宽
  `allow-same-origin`，而是新增 `/engine` 静态代理和工作台桥：HTML/CSS/JS/SVG/
  字体请求经 CPA 白名单取回，API 请求只允许工作台所需的状态、供应商、路由和
  测试接口，响应不携带 Set-Cookie，消息只接受精确的 `contentWindow`。静态入口
  只接受根页和校验后的 `path`，拒绝目录穿越、API 路径、重定向与异常 MIME。
- **补丁重锚**：3 条 CPA 源码补丁仍各单次命中；控制台 bundle 的 12 条 EAC 补丁
  重新锚定后保留 10 条，17 条界面文案全部命中。新增的 engine 补丁单独计数，
  避免把两类补丁混在同一测试断言里。
- **许可与发布**：Magpie MIT 许可及 NOTICE 随源码和安装包分发；版本递增到
  `0.5.16`。前端资源、Go 服务、CPA smoke 和 provenance 审计全部通过后提交并
  创建 release tag。

## v0.5.15：同步上游 main 文档提交

上游在 v2.5.9 之后合并了两个仅涉及文档的 PR（共四个提交），最终 pin 为
`f3ecb7a`。变化只有
`README.md`、`README_EN.md` 与两张 QQ 交流群图片；vendored 源码、lockfile、前端
资源、2 条 CPA 补丁、12 条控制台补丁和 17 条界面文案锚点均未变化。许可采集
已重跑，依赖版本与许可正文不变，只更新记录的 lock 提交。上游尚无 v2.5.9 之后的
正式 tag，因此本轮不创建插件 release tag。

## v0.5.14：同步上游 OFM v2.5.9

上游发布了 v2.5.9（`eb2aaca`，自 v2.5.8 起共 23 个提交），本轮把 vendored 快照
从 `1f92730` 重取到该提交。文件数仍是 94，前端资源重新生成：渠道 bundle
`channels-HdJ7rqdl.js`，settings `settings-KkHf6c81.js`。

- **自动探测停用**：`src/core/runtime.js` 的 `refreshCatalog` 默认改为
  `probe: false`，启动、周期刷新与真实对话中的地区拒绝都不再触发后台探测；只有手动
  「探测可用性」显式传 `probe: true`。`packages/standalone/service.mjs` 的自动刷新
  固定传 `probe: false`，CLI `--probe` 保留兼容但不再产生请求。
- **出口变化隔离**：出口 IP/国家变化时递增 `egressGeneration`，把旧的
  `results`/`manualResults` 标记 `stale` 并清空 `at`，不再自动重探；上一代出口的
  迟到探测结果被丢弃，手动测速跨代完成也不写入。`src/model-test.js` 读取判定时
  忽略 `stale` 行。
- **聚合渠道**：`src/providers/registry.json` 新增 FleetRelay Gateway（76 家），
  公开 `deepseek-v4.1-flash-free` 与 `gpt-6-astra`，其第三方 T1 池保持禁用。
- **视觉特效开关**：控制台设置页新增「视觉特效」开关，默认关闭，鱼缸与业务功能
  保留；`app.css`/`app.js` 与 settings 分块同步更新。
- **共享存储中性化**：`src/store.js` 的偏好、锁定、统计与备份命名改为中性名称，旧
  文件仍可读取与导入。
- **控制台补丁重定位**：新 bundle 的压缩标识符再次整体重排，12 条
  `eacConsolePatches` 中有 10 条不再命中；已逐条重新定位，全部恢复单次命中。
  `tests/eac-ui.test.mjs` 的桩同步更新为新的工厂名（`xa`）与 React 辅助名
  （`w`/`B`/`ne`/`V`）。17 条 `consoleLabels` 全部继续命中。
- **CPA 语义**：`refresh-models` 仍表示重新拉取上游模型清单，不再隐含自动探测请求；
  手动重新探测入口保留。两个 CPA 补丁文件仍逐字节适用；EAC 密封材料未变，
  `service/upstream-eac.json` 的摘要与 v2.2.0 时一致。`collect-web-licenses.mjs`
  重跑后依赖版本无变化，只更新 commit。

## v0.5.13：同步上游 OFM v2.5.8

上游发布了 v2.5.8（`1f92730`，自 v2.5.7 起共 37 个提交），本轮把 vendored 快照
从 `4e44d45` 重取到该提交。文件数仍是 94，前端资源重新生成：渠道 bundle
`channels-DmI_2lp3.js`、models `models-DXpb3t6q.js`、settings
`settings-BbcpaUEV.js`，旧的 `_ofm-provider-list` 分块消失，新增
`sliders-horizontal-DNbjUrIs.js`。

- **渠道移除**：上游彻底移除 WorkBuddy（CodeBuddy）国内版与国际版渠道，以及华为云/
  CodeArts 渠道及其 `jose` 依赖，账号渠道剩十个；历史 WorkBuddy 凭据与用户数据保留
  在磁盘上，但不再有调用入口。`vendor/channel-pack` 删除了 `buddy-*.ts`、
  `codearts-credits.ts`、`direct-fetch.ts` 等实现，并新增 `credential-expiry.ts`、
  `credit-expiry-window.ts`、`open-browser.ts`、`rate-limit.ts` 等公共工具。
- **CPA 补丁调整**：WorkBuddy 适配器已不存在，原先「让 WorkBuddy 线缆首条消息为
  system」的补丁锚点消失，本轮从 `scripts/upstream-patches.mjs` 删除该逻辑，补丁 ID
  改为 `cpa-private-oauth-settings`；剩余部分仍移除内置 Google OAuth 默认值并外置
  Loomy app ID。`tests/buddy-system-prompt.test.mjs` 同步删除。
- **推理回传**：`src/core/completion.js` 在 Chat 历史中保留 assistant 的
  `reasoning_content`（含显式空字符串），`src/messages.js` 在投影到 OpenAI Chat 时
  同样保留该字段；本地网关的工具后续请求不再丢失推理内容。
- **更新器**：`src/updater.js` 的 `backupPackage` 改为异步，备份目录重命名走
  `renameWithRetry`，Windows 临时占用不再直接失败；`stageRelease` 复用已按当前
  manifest 校验通过的暂存副本，避免重试时重复下载。
- **其它**：Qoder 思考档位按强度排序并保留原始 ID，未知档位排末尾；EAC DeepSeek
  Flash 显示名与卡片标签带 `1017`；`packages/standalone/channels/runtime.mjs` 去掉
  CodeArts 缓存目录环境变量。
- **控制台补丁重定位**：新 bundle 的压缩标识符再次整体重排，12 条
  `eacConsolePatches` 中有 8 条不再命中；已逐条重新定位，全部恢复单次命中。
  `tests/eac-ui.test.mjs` 的桩同步更新为新的工厂名（`ba`）与 React 辅助名
  （`y`/`B`/`te`/`K`）。17 条 `consoleLabels` 全部继续命中。
- **密封与许可证**：两个 CPA 补丁文件仍逐字节适用；EAC 密封材料未变，
  `service/upstream-eac.json` 的摘要与 v2.2.0 时一致。`collect-web-licenses.mjs`
  重跑后依赖版本无变化，只更新 commit。

## v0.5.12：同步上游 OFM v2.5.7

上游发布了 v2.5.7（`4e44d45`，自 v2.5.6 起共 28 个提交），本轮把 vendored 快照
从 `49171b9` 重取到该提交。文件数由 93 增至 94（新增 `src/model-test.js`），前端
资源重新生成：渠道 bundle `channels-kEN3gKhj.js` → `channels-CfC6--A6.js`，
models bundle `models-ishsHIe7.js` → `models-CEvvPVd6.js`。

- **CodeArts 独立签名传输**：新增 `vendor/channel-pack/src/direct-fetch.ts` 与
  `src/egress.js` 的 `send` 参数，签名请求不再经过可能被其它插件改写的全局
  `fetch`；代理、超时、取消照旧，积分与签到绑定所属插件实例出口。字符串与数字形式的
  CodeArts `4004` 都可识别，最多去掉 `benefit` 请求头并重新签名重试一次。
- **手动测速重做**：新增 `src/model-test.js`，只有收到非空正文且正常结束才判成功；
  后台预算 300 秒、前端等待 330 秒。成功与失败结果写入 `availability.manualResults`，
  取消不覆盖旧结果，旧探测不能覆盖新实测；区分「清单已收录」「实测可用」「实测失败」。
  `src/core/runtime.js` 暴露 `testModel`，`management.mjs` 的 `/models/test` 改用它；
  CPA 白名单无需新增路由，返回结构随上游更新。
- **用量修正**：`src/stream.js` 新增 `sanitizeUsage`，`src/adapter.js` 只对
  `kilo-auto/free` 丢弃超过声明上下文窗口的输入/总量计数，保留输出与思考计数；
  一旦某次尝试的输入不可信，累计值不再拼出虚假的精确 prompt/total。
- **赞助与界面**：保留北辰 API PNG Logo 与赞助卡片，移除低性能模式；渠道包新增
  `channel-pack-rpc.ts`、`codearts-credits.ts`、`models.ts`、`service.ts` 等修正，
  EAC DeepSeek Flash 的显示名与卡片标签加上 `1017` 版本标记。
- **控制台补丁重定位**：新 bundle 的压缩标识符再次整体重排，12 条
  `eacConsolePatches` 中有 10 条不再命中；已逐条重新定位，全部恢复单次命中。
  `tests/eac-ui.test.mjs` 的桩同步更新为新的工厂名（`ba`）与 React 辅助名
  （`y`/`F`/`te`/`Q`）。17 条 `consoleLabels` 全部继续命中。
- **补丁与密封**：两个 CPA 补丁文件（`eac.mjs`、`business.mjs`）锚点仍各单次命中。
  EAC 密封材料未变，`service/upstream-eac.json` 的摘要与 v2.2.0 时一致；
  `collect-web-licenses.mjs` 重跑后依赖版本无变化，只更新 commit。

## v0.5.11：同步上游 OFM v2.5.6

上游发布了 v2.5.6（`49171b9`，5 个提交），本轮把 vendored 快照从 `25151ba`
重取到该提交。文件数仍是 93，前端资源完全未变，因此 12 条 `eacConsolePatches`
与 17 条 `consoleLabels` 全部继续单次命中，无需重新定位。vendored 范围内实际只有
`src/reload.js` 变化。

- **赞助卡片改版（DSH 入口）**：v2.5.6 把北辰 API 赞助卡片统一放到免费模型页与 EAC
  页上方，缩小尺寸并精简间距、图标与文字，品牌统一为「北辰 API × OFM」、优惠说明
  改为「邀请可获百分之十的返现」，同时移除「来自赞助商的广告」导航与详情路由，只保留
  卡片和「立即查看」链接。该逻辑位于上游 `client.js`（DSH 插件入口），本适配器不
  vendor 该文件，因此不会进入 CPA 嵌入控制台；v0.5.10 引入的独立控制台赞助页仍保持
  上游 v2.5.5 的形态。
- **热重载真实路径**：`src/reload.js` 原先按 URL 前缀判断依赖是否属于当前插件包，
  macOS 临时目录（如 `/var` → `/private/var`）下前后 URL 形式不一致，导致旧一代模块
  继续运行。现在父模块与解析结果都先 `realpathSync` 再比较真实路径前缀。
- **补丁与密封**：两个 CPA 补丁文件（`eac.mjs`、`business.mjs`）本轮上游未改动，
  锚点仍各单次命中。EAC 密封材料未变，`service/upstream-eac.json` 的摘要与
  v2.2.0 时一致；`collect-web-licenses.mjs` 重跑后依赖版本无变化，只更新 commit。

## v0.5.10：同步上游 OFM v2.5.5

上游发布了 v2.5.4 与 v2.5.5（`25151ba`，自 v2.5.3 起共 14 个提交），本轮把
vendored 快照从 `f0b979f` 重取到该提交。文件数由 91 增至 93：新增
`src/sponsor.js` 与 `src/sponsor.css`；前端资源整体重新生成，渠道 bundle
`channels-Bo15uddV.js` → `channels-kEN3gKhj.js`，`app.js` / `app.css` 同步变化。

- **赞助页与每日公告**：v2.5.4 在独立控制台新增「来自赞助商的广告」页面与每日一次
  的公告弹窗，并重做桌面端围绕它的导航、深浅色与窄窗口表现；v2.5.5 删掉赞助说明里
  的交流群、群号与复制按钮，关闭桌面插件启动时自动弹出的开屏，保留页面入口与邀请码。
  本适配器嵌入上游控制台，因此页面与菜单入口随之上线；外链在既有沙盒
  （`allow-popups`）内可正常打开，管理密钥仍不会进入该帧。
- **赞助样式纳入取源**：导入脚本原先只选取 `src/` 下的 `.js|.json`，本轮把 `.css`
  一并纳入，确保 `src/sponsor.css` 可复现；`assets.go` 的 embed 清单同步加入该文件。
- **控制台补丁重定位**：新 bundle 的压缩标识符又一次整体重排，12 条
  `eacConsolePatches` 中有 10 条不再命中；已按新 bundle 逐条重新定位，全部恢复单次
  命中。`tests/eac-ui.test.mjs` 的桩同步更新为新的工厂名（`Na`）与 React 辅助名
  （`A`/`L`/`ee`/`Z`），断言改用新的变量名。17 条 `consoleLabels` 全部继续命中，
  无需修改。Go 侧 `TestEACUIHooksMatchOnlyThePinnedBundle` 仍要求每条补丁恰好命中一次。
- **补丁与密封**：两个 CPA 补丁文件（`eac.mjs`、`business.mjs`）本轮上游未改动，
  锚点仍各单次命中。`src/vault.js` 未变，EAC 密封材料 `vault-data` / `vault-anchor`
  摘要与 v2.2.0 时一致；`collect-web-licenses.mjs` 重跑后依赖版本无变化，只更新 commit。

## v0.5.9：同步上游 OFM v2.5.3

上游发布了 v2.5.3 热修（`f0b979f`，自 v2.5.2 起共 7 个提交），本轮把 vendored
快照从 `8c2c0f1` 重取到该提交。文件数仍是 91，前端资源完全未变，因此 12 条
`eacConsolePatches` 与 17 条 `consoleLabels` 全部继续单次命中，无需重新定位。
实际变化只有 `src/adapter.js`、`src/recovery.js`、`src/updater.js` 与上游包清单。

- **移除 EAC 无进度截止**：v2.5.2 新增的规则会在 EAC 连续 60 秒没有正文、思考或
  工具增量时终止请求并报 `NO_PROGRESS`，误伤了排队、静默思考、只有心跳/用量帧的
  等待，以及正文输出后的长静默。v2.5.3 把 `progressTimeoutMs` 从
  `RECOVERY_DEFAULTS` 删除，适配器不再启动或续期进度计时器，也不再在失败路径上
  合成 `NO_PROGRESS`；旧配置里的该字段不再生效。用户取消、传输层空闲检测与恢复
  总时限保持原行为。
- **升级备份缓存排除**：上游自己的更新器把 `packages` 加入
  `REPOSITORY_SCAFFOLDING`，并在恢复旧回滚凭据时过滤掉 `packages/` 下的文件，
  避免把独立产品源码与 Rust `target` 编译缓存复制进回滚目录占满系统盘。该逻辑位于
  `src/updater.js`，CPA 使用 `scripts/update.mjs` 自己的安装器，因此仅作为
  vendored 代码保留，在 CPA 下不生效。
- **补丁与密封**：两个 CPA 补丁文件（`eac.mjs`、`business.mjs`）本轮上游未改动，
  锚点仍各单次命中。EAC 密封材料未变，`service/upstream-eac.json` 的摘要与
  v2.2.0 时一致；`collect-web-licenses.mjs` 重跑后依赖版本无变化，只更新 commit。

## v0.5.8：同步上游 OFM v2.5.2

上游发布了 v2.5.0 / v2.5.1 / v2.5.2（自 v2.4.0 起共 35 个提交），本轮把 vendored
快照从 `0b712bc` 重取到 `8c2c0f1`。文件数由 87 增至 91：新增
`src/deferred-response.js`、`src/failure.js`、`src/open-external.js` 与
`packages/standalone/open-external.mjs`；前端资源整体重新生成，渠道 bundle
`channels-Dyod_rQn.js` → `channels-Bo15uddV.js`，models / settings / usage 三个
bundle 改名，新增 `visibility-data-9WWAmLOB.js` 分块。

- **免费车道会话编码门禁（最关键）**：上游 2026-10-17 起解码 `ses_` 后十二位
  十六进制，只接受官方客户端的降序布局 `~(毫秒 << 12 | 计数器)`（计数器 1–63，
  第十位固定为 `f`）。升序 `毫秒 << 12` 或哈希摘要即使 `ses_` 形状完全正确，也一律
  `403 FreeTierError`。`src/upstream.js` 新增 `SESSION_DESCENDING_RE`、
  `isCanonicalSession()` 与 `canonicalizeSession()`：合规 id 原样透传，其余确定性
  重编码，同一对话仍映射同一上游会话；`session-map.json` 中的旧 id 读到时同样重编码。
  `scripts/cpa-smoke.mjs` 的线路断言新增会话 id 降序编码校验。
- **模型可见性**：支持按单个模型或整组（匿名 / Kilo / EAC）隐藏，隐藏只影响模型
  选择器与网关清单，不影响通过已保存 ID 发起的历史会话请求。管理页新增
  `visibility-data` 分块与对应设置字段。
- **独立服务 LAN 中继**：新增 `--lan` / `--no-lan` / `--lan-port` 与独立密钥，
  `startStandalone` 增加 `lanEnabled` / `lanPort` 参数（默认关闭）。本适配器不传
  这两个参数，CPA 下行为不变，也不会额外监听局域网端口。
- **升级与公告源**：升级清单新增国内可达镜像，链路为 raw → jsDelivr → 镜像 →
  master 兜底；镜像同样先解析到完整 commit SHA 再取件，签名与逐文件 SHA-256
  校验照常执行。公告订阅同样加入镜像。
- **渠道与协议修复**：WorkBuddy 补齐会话头与初始 system，区分 11128 / 11140；
  Gemini、MiniMax 保留消息内的 system；Raccoon、Loomy 对明确额度不足做有界轮换；
  聚合渠道发送真实模型 ID；三种转发协议保留上游错误分类、HTTP 状态与重试提示；
  SSE 在终止标记停止读取。`vendor/channel-pack` 与 `src/` 对应文件同步更新。
- **导入清单修复**：新版 `packages/standalone/eac.mjs` 新增
  `import { openExternal } from './open-external.mjs'`，而导入脚本的 standalone
  白名单原先没有该文件。本轮把 `open-external.mjs` 加入 `scripts/import-upstream.mjs`
  与 `assets.go` 的 embed 清单；否则插件二进制启动时会因缺少模块而失败。
- **控制台补丁重定位**：新 bundle 的压缩标识符再次整体重排，12 条
  `eacConsolePatches` 中有 8 条不再命中；已按新 bundle 逐条重新定位，全部恢复单次
  命中。`tests/eac-ui.test.mjs` 的桩同步更新为新的工厂名（`ba`）与 React 辅助名
  （`y`/`P`/`te`/`K`），断言改用新的变量名。Go 侧
  `TestEACUIHooksMatchOnlyThePinnedBundle` 仍要求每条补丁恰好命中一次。
- **补丁与密封**：两个 CPA 补丁文件（`eac.mjs`、`business.mjs`）本轮上游有改动，
  但补丁锚点仍各单次命中，`patchOriginal` 逐字节适用。`src/vault.js` 只增加了
  `tauri` profile 判定；EAC 密封材料 `vault-data` / `vault-anchor` 摘要未变。
  `collect-web-licenses.mjs` 重跑后依赖版本无变化，只更新记录的 commit。

## v0.5.7：同步上游 OFM v2.4.0

上游发布了 v2.4.0（`0b712bc`，自 v2.3.0 起共 3 个提交），本轮把 vendored
快照从 `e937077` 重取到该提交。文件数由 86 增至 87（新增 `src/picks.js`），
前端渠道 bundle 更名（`channels-BNNYYkX2.js` → `channels-Dyod_rQn.js`），
因此 `assets.go` 的 embed 清单、`console_test.go`、`tests/eac-ui.test.mjs` 与
`tests/provenance.test.mjs` 同步改名与增补。

- **免费车道换 v2 指纹**：上游按 2026-10-14 起生效的 OpenCode v2 客户端重做
  指纹（`docs/free-lane-wire.md` 末节），四项特征一起变、缺一即 `403 FreeTierError`：
  UA 换成 `opencode/latest/2.0.26/cli`（旧 `opencode/1.18.x` 被按名字拒）；
  会话头补齐 `x-session-affinity` / `x-session-id`，与 `x-opencode-session` /
  `x-opencode-session-id` 四头同值，并去掉 v1 专用的 `x-opencode-request`；
  工具闸门从 `bash`/`glob`/`grep`/`read` 桩改为 `read` 与 `shell`，且描述与
  schema 必须与官方客户端逐字一致；`tool_choice: 'none'` 一律不下发。
  `src/upstream.js`、`src/http.js`、`src/probe.js`、`src/adapter.js`、
  `src/forward.js`、`src/messages.js`、`src/core/runtime.js` 与 vendored 渠道包
  的 `opencode*.ts` 同步更新，属逐字节保真的上游代码。
- **调用方工具别名**：调用方工具原样保留；若正好用了 `read`/`shell` 且定义与官方
  不同，则改名成 `<name>_client`，并同步改写历史里的同名调用与 `tool_choice`，
  响应侧再还原。`scripts/cpa-smoke.mjs` 的线路断言随之更新为 v2 形状：
  `/inference/v1`、四会话头同值、无 `x-opencode-request`、UA 为
  `opencode/<channel>/2.x.y/<client>`、`read`/`shell` 齐备且 `tool_choice` 不为
  `none`。
- **推荐项目页**：新增 `src/picks.js`，两张卡片实时读取 EAC-Desktop 与 EAC-Pack
  的 Star / Fork / 最近提交数，取不到就整块不显示，绝不用占位数字；该页同时加入
  标签持久化列表。CPA 内部服务未实现 `/picks`（属 DSH 宿主路由），
  `consoleAPIRoutes` 也不放行，因此该页在 CPA 下失败关闭，数字区域不显示，
  不影响其余页面。
- **聚合渠道注册表**：移除 OpenCode 免密池一行（它要求每请求的会话 id、v2 UA 与
  官方工具声明，聚合车道的通用传输承载不了），注册表为 75 家；这 10 个模型仍由
  免费车道原生提供。
- **控制台补丁重定位**：新 bundle 的压缩标识符再次整体重排，原 12 条
  `eacConsolePatches` 中有 9 条不再命中；已按新 bundle 逐条重新定位，全部恢复为
  单次命中：登录/登出的「unreachable」兜底、结构化启动错误、轮询原因映射、
  资源池原因、无车道原因、EAC 页初始状态、导入确认文案与导入结果汇总。
  `tests/eac-ui.test.mjs` 的桩（`ma` 工厂、`V.useState` 等新压缩名）与断言同步
  更新，Go 侧 `TestEACUIHooksMatchOnlyThePinnedBundle` 仍要求每条补丁恰好命中一次。
- **补丁与密封**：两个 CPA 补丁文件（`eac.mjs`、`business.mjs`）本轮上游未改动，
  `patchOriginal` 的单次匹配断言仍然成立，补丁逐字节适用。EAC 密封材料未变，
  `service/upstream-eac.json` 的四个摘要与 v2.2.0 时一致；`collect-web-licenses.mjs`
  重跑后依赖版本无变化，只更新了记录的 commit。

## v0.5.6：同步上游 OFM v2.3.0

上游发布了 v2.3.0（`e937077`，自 v2.2.0 起共 37 个提交），本轮把 vendored
快照从 `9e61218` 重取到该提交。文件数仍是 86，只有前端渠道 bundle 更名
（`channels-CQJ5sFg_.js` → `channels-BNNYYkX2.js`），因此 `assets.go` 的 embed
清单、`console_test.go` 与 `tests/provenance.test.mjs` 同步改名。

- **免费车道换线**：匿名车道从 `/zen/v1` 迁到 `/inference/v1`。上游实测
  （`docs/free-lane-wire.md`）旧路径对插件全线返回 `403 FreeTierError`，同时新增四项
  闸门：必须带 `x-opencode-session-id`；会话 id 必须是 `mintSessionId()` 的铸造形状
  （sha256 派生或随机 hex 会被拒）；`bash` 与 `read` 必须同时声明且各自
  `properties` 非空；User-Agent 含 `deepseek-harness` 会被点名拒绝。
  `src/catalog.js`、`src/core/runtime.js`、`src/probe.js`、`src/http.js`、
  `src/upstream.js` 随之更新，属于逐字节保真的上游代码。
- **会话映射落盘**：`src/upstream.js` 新增 `session-map.json`，把「一个下游会话映射到
  一个上游会话」持久化，重启后继续复用，避免每请求新开会话耗尽免费配额。
  它经 `resolveDshHome()` 解析，即 `$DSH_HOME/our-free-model/`。
  **这是本轮唯一的 CPA 集成改动**：宿主环境从不提供 `DSH_HOME`
  （`childEnvironment` 明确剥离），若不处理，状态文件会落到运行 CPA 的系统账号主目录。
  现在 `service/runner.mjs` 在初始化时把 `DSH_HOME` 固定为插件数据目录，
  所有新状态文件都在 `data-dir` 内，同机多实例也不会串用；
  `tests/runtime.test.mjs` 新增断言，验证 `session-map.json` 确实写在数据目录里。
- **线路锁定分类**：`403 FreeTierError` 现在归类为 `LANE_LOCKED`（`src/http.js`），
  可用性探测把它读成「网关不会路由这个模型」（`src/probe.js`），
  不再当成 `INVALID_CREDENTIAL` 去清空模型目录、诱导用户重新登录。
- **控制台补丁重定位**：上游把「插件升级」独立成导航页（新 `nav.tab.upgrade`、
  `/update/status|check|apply`），并在渠道页新增「供应商与备份」。新 bundle 的
  压缩标识符整体重排，原 12 条 `eacConsolePatches` 中有 7 条不再命中；
  已按新 bundle 逐条重新定位，全部恢复为单次命中：登录/登出的「unreachable」
  兜底、结构化启动错误、轮询原因映射、资源池原因、无车道原因、EAC 页初始状态、
  导入确认文案与导入结果汇总。`tests/eac-ui.test.mjs` 的桩与断言同步更新，
  Go 侧 `TestEACUIHooksMatchOnlyThePinnedBundle` 仍要求每条补丁恰好命中一次。
- **升级页边界**：新导航页调用的 `/update/*` 属于 DSH 宿主路由，CPA 内部服务不提供，
  `consoleAPIRoutes` 白名单也不放行，因此该页在 CPA 下失败关闭，不会误报成功；
  这与既有的 `/token-saver`、`/combos`、`/chan-gateway` 等宿主专属标签页一致。
- **许可证与摘要**：`collect-web-licenses.mjs` 重跑后依赖版本无变化，只更新了记录的
  commit；EAC 密封材料本轮未变，`service/upstream-eac.json` 的四个摘要与 v2.2.0 相同。

## v0.5.5：同步上游 OFM v2.2.0

上游发布了 v2.2.0（`9e61218`，共 12 个提交），本轮把 vendored 快照从 `ddb451c`
整体重取到该提交，文件数由 85 增至 86（新增 `src/token-saver/rtk/hitLine.js`）。

- **EAC 服务迁移**：上游把协付渠道迁到新服务器，并随发布替换了密封对
  `src/vault-data.js`（677 → 566 字节）与 `src/vault-anchor.js`（262 → 192 字节）。
  本插件不随包分发密封材料，而是按 pin 的提交下载并逐文件校验 SHA-256，
  因此只需同步 `scripts/import-upstream.mjs` 的提交号；`service/upstream-eac.json`
  已记录新摘要。本地实测新密封解开为 `mode=worker`，指向
  `https://ourfreemodel.beichenapi.com/eac/v1`，与上游迁移文档一致。
- **RTK grep 误判修复**：旧逻辑只看前 5 行非空内容里是否出现 `文件:行号:内容`，
  网页时间戳或源码引用会被误判成 grep 输出并整段压缩。新逻辑先用完整输出验证
  候选行（`parseGrepOutput`），散文不再被有损改写；候选不成立时直接返回原文。
- **版本号统一**：上游 `package.json` 与 `packages/standalone/package.json`
  都变为 2.2.0。
- **补丁适用性**：两个 CPA 补丁的目标文件（`packages/standalone/eac.mjs`、
  `packages/standalone/channels/business.mjs`）本轮上游未改动，
  `patchOriginal` 的单次匹配断言仍然成立，补丁逐字节适用。

## v0.5.4：模型同步范围可选

用户反馈：「同步模型到 CPA」此前只能整体同步，无法挑选。上游 OFM 到 `ddb451c`
为止没有这个能力（控制台模型页的「未公开」是上游自己的 `routable` 状态，
不是用户可控开关），因此本轮自研实现。

- 新增 `data-dir/model-selection.json`（0600）保存**排除列表**，与 CPA 插件配置分离。
  文件不存在即「全部同步」，与旧行为完全一致，老用户升级后不需要任何操作。
- 管理页新增「选择要同步的模型…」：搜索、全选/全不选/反选、逐项勾选，保存后
  自动 bump `catalog-revision` 让 CPA 重载目录。
- 同步范围同时作用于**目录**与**执行**：`discover` 过滤注册表，`prepare` 在转发前
  再查一次。后者是必须的——CPA 的静态目录只在 `catalog-revision` 变化时重建，
  被排除的模型在重载前仍在宿主目录里；端到端测试确认这一窗口内请求会被拒绝
  （宿主以 503 拒绝，插件自身以 404 拒绝），绝不会真的转发。
- 失败关闭：范围文件损坏时拒绝发布目录并让管理页报错，不静默回退成「全部同步」
  （回退等于重新暴露用户主动排除的模型）。用户重新保存一次即为修复路径。
- 上游临时下架的模型保留在排除列表中，重新出现时继续排除；管理页单独列出这类条目。
- 每次推理都会读取范围，因此内存缓存按 `data-dir` 分键，唯一写入方保存后立即刷新。

验证：`npm run check`（109 文件）、44 个 JS 测试、`go test`、`go vet`，以及
`scripts/selection-smoke.mjs` 对官方 CPA 8.0.23 的 11 项端到端检查（排除生效、
重载前拒绝、目录消失、前缀变更后仍生效、插件重载后仍生效、清空后恢复）。

## v0.5.3：补全商店要求的平台产物

商店上架申请（PR #240）的阻塞项是平台覆盖：审计明确要求
`darwin/amd64`、`darwin/arm64`、`linux/amd64`、`linux/arm64`、`windows/amd64`
五个平台的预编译产物，而 v0.5.2 只有 Linux/Windows amd64。本轮只动发布流程。

- 矩阵由 `os: [ubuntu-22.04, windows-2022]` 改为显式 include，每个目标用对应架构的
  runner：`ubuntu-22.04`、`ubuntu-22.04-arm`、`macos-15-intel`、`macos-15`、
  `windows-2025`。选择与已通过审核的 `client-guard` 一致。
- 顺带修掉一个隐藏缺陷：上传产物名原为 `native-${{ runner.os }}`，两个 Linux runner
  会重名，`upload-artifact@v4` 会直接报错；现改为 `native-<goos>-<goarch>`。
- `release-checksums.mjs` 与 `package.mjs` 本就接受三个系统与两种架构，
  `releases.go` 的平台匹配用 `runtime.GOOS`/`GOARCH`，无需改动。

本地已交叉验证：`linux/arm64` 用 zig 完整构建成功（19.9 MB `.so`）；
`darwin/amd64`、`darwin/arm64` 的 `go vet` 通过（macOS 链接需要真实 SDK，
只能由 CI 的 macOS runner 完成）。未改运行时代码、渠道逻辑与配置格式。

## v0.5.2：主题按钮只能切换一次

用户报告：暗色模式点击一次切到浅色后，再点击无法切回暗色。

**已复现**。在真实 CPA 隔离实例中量到：初始 `theme=dark`，第一次点击后
DOM 变为 `light` 但按钮标签仍是「切换到浅色主题」，第二次点击后主题仍是 `light`；
控制台报 `SecurityError: ... document is sandboxed and lacks the 'allow-same-origin' flag`，
位置正是 `localStorage.setItem`。

- 根因：v0.5.0 的安全加固移除了控制台 iframe 的 `allow-same-origin`，其源变为
  不透明，读写 `localStorage` 会抛 `SecurityError`。上游读取处包了 `try/catch`，
  写入处没有；而主题切换的写入在 React `setState` 之前，异常中断后状态停在初值，
  按钮永远算出同一个目标主题。
- 修复：`web/console-bridge.js` 在不透明来源的帧里安装内存版 `Storage`，
  不削弱 sandbox、不写入任何凭据。同一处理覆盖渠道页签与重载提示这两处
  同样直接写存储的代码。
- 验证：真实浏览器中连续 8 次往返切换全部正确（主题与按钮标签同步），零页面错误；
  新增 JS 回归测试直接执行桥接脚本的垫片并断言写入不再抛错。

## 本轮已修复

下列条目在 v0.5.0 中已处理，保留原始记录以便对照。

### P1：备份导入提示“合并”，实际整体替换

- 位置：控制台渠道页的导入确认文案；`channels/business.mjs` 的 `importBackup()` 调用
  `pool.replaceAll`。
- 原控制台提示“导入会合并备份中的账号凭据、模型开关和积分锁定设置”，但服务端替换
  整个账号池、模型禁用表，以及备份中提供的积分锁定表。
- 已在真实 CPA 隔离目录中复现：先写入一个禁用的假账号与积分锁，导入空备份后，
  `account.list` 从一个账号变为零，积分锁从开启变为关闭。不涉及真实账号。
- 风险：用户按“合并”理解导入旧备份，可能失去新账号的索引和现有保护设置。
  并非已证明所有凭据文件被删除，不能将账号索引替换夸大为所有 Token 均不可恢复。
- **已修复**：确认框改为明确说明“整体替换”并提示先导出当前备份；导入后显示写入的
  账号数与凭据数，以及缺失凭据/过期凭据/被跳过凭据的数量。服务端替换语义未改
  （与上游一致），改的是不再让文案误导用户。

### P2：同源 iframe 没有形成管理密钥隔离

- 位置：`web/index.html:123`；管理密钥仍在父页面的 `#key` 输入框中。
- 验证：在真实浏览器的子控制台上下文执行只返回布尔值的检测，确认可以通过
  `parent.document` 读取父页面管理密钥。测试只使用虚构管理密钥，没有输出真实密钥。
- 不经 `postMessage` 发送密钥，不等于子页面无法读取密钥。当前 CSP 和
  `event.source` 检查能限制消息来源，但不能阻止同源脚本读父 DOM。
- 这是未成立的隔离边界，不是已经发现远程盗取密钥、XSS 或上游恶意代码。
- **已修复**：控制台 iframe 改为 `sandbox`，授予脚本、表单、模态、弹窗与下载能力，
  但**不含** `allow-same-origin`，因此子页面拿到的是不透明来源。在真实浏览器中实测，
  子页面读取 `parent.document` 的密钥抛 `SecurityError`。父页面收消息时改以
  `event.source === frame.contentWindow` 作身份校验，并只接受 `"null"` 或自身来源；
  回包使用 `'*'`（无法向不透明来源寻址），投递范围由帧对象本身限定。

### P2：源码备用更新器创建的目录不适合跨用户服务

- 位置：`scripts/update-lib.mjs:60`、`scripts/update-lib.mjs:67`。
- Linux 实测新建 `<plugins>/linux` 和 `amd64` 的权限为 `0700`。若管理员执行更新，
  CPA 以专用非 root 用户运行，即使动态库本身可读，CPA 也无法穿过父目录加载插件。
- 已用 WSL/Linux 原生文件系统上的隔离目录验证。以同一用户运行 CPA 和更新器时不会触发。
- **已修复**：安装目录与平台目录改用 `0755`（可遍历），备份目录显式保持 `0700`。
  新增的 Linux 断言覆盖三者的实际权限位。一键更新走 CPA 自己的安装器，不经过此函数。

### P2：直接关闭网页只取消浏览器等待，未取消管理端工作

- 位置：`web/manager.js:140` 的 `pagehide`；`console.go` 的代理使用独立超时上下文。
- 在真实 CPA 假上游模型测试中：断开浏览器 HTTP 请求后，上游取消计数仍为零；
  调用既有 `console-cancel` 后才变为一。页面上的显式退出会调用取消接口，
  但关闭标签页/导航离开的 `pagehide` 只执行本地 `AbortController.abort()`。
- 已有两分钟代理上限，部分模型测试自身还有一分钟上限，所以不是无限泄漏；仍可能
  在用户离开后继续消耗额度或执行管理操作。
- **已修复**：`pagehide` 改为对每个在途调用发送 `ofm/console-cancel`，不再只做本地
  `abort()`。回归测试在调用仍未结束时触发 `pagehide`，断言取消请求确实带上了对应 id。

## 用户指定问题：核实与修复

### EAC 错误码误映射：真实存在，已修复

原始固定版本前端在登录启动 HTTP 失败时使用没有错误参数的 `catch`，统一显示
`unreachable`。回归测试直接执行原始前端登录钩子，输入 `no-lane`，得到
`Unable to start (unreachable)`；同一测试执行适配后的代码，显示来源准备原因。

- 新增独立的 `web/eac-feedback.js`，区分来源未启用、准备中、加载失败、无可用渠道、
  网关不可达、网关 HTTP 错误、数据异常和无法写入授权。
- 代理在来源不可用时返回结构化原因，不向授权网关发出无意义请求。
- 资源池保留真实原因；未知错误不会回显任意服务端字符串或被武断归为网络故障。
- 原始 vendored 文件没有改动。服务端只在提供前端资源时应用精确替换；
  Go 测试要求每个挂接点对固定版本恰好出现一次，并检查替换后 JavaScript 语法。

### “先点登录才初始化”：当前 CPA 版未复现，补充首开防御

当前 `service/runner.mjs` 本来就在 `startStandalone` 之前
`await configureEac(settings)`，控制命令也等待初始化。使用延迟加载的假来源复现，
不进行任何登录，第一次 `status` 已是 `ready`。因此不能把截图中的完整因果链
直接认定为当前版本事实，也没有证据能确认截图中远端账号的实际授权状态。

为处理真实存在的启动失败和旧摘要闪现，仍补充以下保护：

- 打开控制台先执行来源预检；已经准备好的来源不重复初始化。
- 仅对明确配置启用、且启动加载失败的来源，首开时最多额外尝试一次。
- 并发首开共用准备过程，后续轮询不循环下载。
- EAC 页面先显示加载态，再使用新查询的状态，不先展示摘要中旧的授权/可用性状态。
- 不自动启用 EAC，不自动发起 GitHub 登录、不修改用户 Token、不绕过 Star/授权校验。

## 一键更新

本轮实现“检查正式 Release → 确认版本 → CPA 原生安装 → 核实运行版本”。
这不是将源码构建命令包装为网页上的远程命令执行接口。

- 新增正式发布元数据接口，与旧的源码提交检查分开。
- 只有当前平台 ZIP 和 `checksums.txt` 都存在才开放安装；版本、仓库和资源来源固定。
- 首次经确认后可通过 CPA v8 的单字段接口加入更新源，保留原有来源。
- CPA 原生保存可能将旧配置格式规范化到 v8；安装器会写入商店来源和版本记录。
  这项行为在确认提示与说明书中明确告知。
- 断线或只收到安装成功响应，不立即显示“更新成功”，会检查实际运行版本。
- 补齐 CPA 要求的 ZIP 命名、校验清单、`registry.json` 和 GitHub Actions 发布工作流。
- 真实 CPA 隔离热更新验证包含校验失败保护、保留数据/配置、运行版本变化和更新后推理。
- GitHub 仓库此前没有任何 Release；本轮已发布 `v0.5.0`。旧版本仍需手动安装一次
  v0.5.0，之后可在页面更新到后续正式版本。本轮未执行生产部署。

## 小功能建议

1. **目录同步提示**：对比 OFM 与 CPA 模型指纹，提示新增/移除数量，提供一键同步；
   先解决“登录成功但客户端看不到模型”，而不是再堆一个模型列表。
2. **脱敏诊断卡**：显示来源准备、网关访问、授权、模型注册四个独立状态；
   导出版本/错误码/耗时，不导出密钥、对话或完整账号数据。
3. **客户端接入向导**：按客户端生成可复制的 Base URL、带前缀模型 ID 和占位 Key 配置，
   不要求用户将 CPA 管理密钥填进模型客户端。
4. **低额度保护与冷却提示**：展示账号预计重试时间、近期开销和失败原因；
   默认沿用上游账号选择，避免重复实现或悄悄改变现有轮转策略。
5. **安全备份预览**：展示即将导入的账号数、重复项和锁定变化；默认加密导出，
   导入前先预览和确认，优先修复当前“合并/替换”语义错误。

## 验证边界

审查覆盖 CPA 自有 Go/JS、控制管道、关键上游调用边界、管理页面、发布与更新脚本。
上游渠道业务包含大量生成代码，不将本轮结果宣称为每一行或每个供应商的安全认证。
所有模型与账号变更验证均在 `.test-output` 隔离目录进行，没有使用个人 Token 或额度。
详细执行结果记录在 `VALIDATION.md`，机器报告位于未提交的 `dist/`。
