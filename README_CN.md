# Our Free Model 的 CPA 适配插件

这是适用于 **CLIProxyAPI / CPA 原生插件系统**的独立适配，不是简单添加一个
`openai-compatibility` 服务商，也不能按 Magpie 的方式直接加载 JavaScript 目录。

原项目：[Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model)。
仅供思路参考：[mu-zi-lee/magpie-our-free-model](https://github.com/mu-zi-lee/magpie-our-free-model)。
模型运行时、账号渠道、管理控制台和用量统计来自原作者；本项目新增 CPA 原生接入、
服务生命周期、安全边界及宿主兼容测试，不把上游功能声明为独立原创。

**v0.2.0 的唯一产品源码上游是原项目，不使用参考项目的源码快照或辅助模块。**
通过 `git show` 直接读取原仓库固定提交的 51 个文件，其中 49 个逐字节不变（包括独立服务
与完整控制台），2 个应用独立可追溯的 CPA 补丁：接入私有 EAC 来源、外置内置 OAuth 配置。
来源、原始 Git blob、前后 SHA-256、补丁说明均记录在 `service/vendor/ofm/UPSTREAM.json`。
`scripts/import-upstream.mjs` 和 `scripts/upstream-patches.mjs` 可以重现整个取源过程。

## 1. 安装

已使用 **官方 CPA 8.0.23 的 Windows x64 与 Linux x64 发行版**验证。请使用支持插件的 CPA
发行版，不要使用文件名含 `no-plugin` 的构建。其他 CPA 版本需自行验证 ABI 与功能支持。

**当前 GitHub 仓库只提供源码，尚未发布预编译 Release，`dist/` 不随源码提交。**
从仓库克隆后，请先按第 7 节构建，再在 `dist/` 找到对应平台产物：

| 系统 | 文件 |
| --- | --- |
| Windows x64 | `dist/windows/amd64/our-free-model-v0.2.0.dll` |
| Linux x64 | `dist/linux/amd64/our-free-model-v0.2.0.so` |
| macOS / ARM64 | 从源码在相应平台构建；不将未实测平台宣称为已验证 |

1. 把对应动态库复制到 CPA 配置的插件目录，例如 `plugins/` 或 `plugins/windows/amd64/`。
   **不要改掉 `our-free-model` 这一文件名 ID**；文件名和配置键必须一致。
2. 将以下配置合并到现有 CPA 配置中，保留你原来的端口、客户端密钥和其他插件。
3. 重启 CPA；后续也可以在 CPA 插件管理页启停、修改配置。

```yaml
plugins:
  enabled: true
  dir: plugins
  configs:
    our-free-model:
      enabled: true
      model-prefix: "ofm/"
```

完整示例见 `config.example.yaml`。只需要安装动态库，不需要另外安装 DSH、Magpie，
也不需要复制 `service/` 文件夹：约 4 MB 的 OFM 源码、界面和许可都已嵌入动态库。
首次使用时释放到私有数据目录，以内容哈希命名并逐文件校验，损坏时拒绝执行。

CPA 适配源码仓库为 [sy0u1ti/cpa-our-free-model](https://github.com/sy0u1ti/cpa-our-free-model)。
目前没有发布二进制 Release，也未上架插件商店；商店一键安装还需要各平台 Release 和商店注册表条目。

## 2. 打开管理界面

CPA 侧栏会出现 **Our Free Model**。也可以访问：

```text
http://127.0.0.1:8317/v0/resource/plugins/our-free-model/console
```

端口按你的 CPA 实际设置修改。进入页面后输入 **CPA 管理密钥**，点击
**Open OFM console**，再打开生成的一次性链接，即可进入原项目完整账号控制台。
该链接十分钟内有效、只能兑换一次，兑换后使用 HttpOnly 会话。

这里有三种不同密钥，不能混用：

| 密钥 | 用途 |
| --- | --- |
| CPA 客户端 API Key | 你的模型客户端调用 CPA 的 `/v1/*` |
| CPA 管理密钥 | 此插件入口操作，以及 CPA 自身管理 |
| OFM 本地服务 Key | 由插件自动生成和使用，不需要填进 CPA 或客户端 |

页面只在当前内存中使用管理密钥，不写入浏览器存储。CPA 的插件资源页面本身是公开的，
因此页面不会自动签发管理链接或显示私有路径；私有操作通过 CPA 已鉴权管理接口完成。
远程页面请使用 HTTPS，或先建立 SSH 转发再通过 localhost 访问；不要明文传送管理密钥。

启用模型：

1. 匿名 Zen / Kilo 模型池可以直接使用，不需要账号。
2. 其他渠道在原项目控制台里完成相应登录。
3. 回到 CPA 的插件入口，点击 **Sync models to CPA**。
4. 在模型客户端选择 CPA `/v1/models` 实际返回的 `ofm/...` 模型。

CPA 原生静态模型目录不会在 OFM 账号变动后自动重建，本插件通过更新
`catalog-revision` 触发 CPA 重载目录；不重启 OFM 服务。单纯在客户端刷新 `/v1/models`
不会触发原生插件重新注册。即使目录未刷新，实际请求仍会检查当前模型及账号启用状态，
不会用旧缓存重新启用已禁用的账号或模型。

## 3. 模型客户端

客户端仍然只连接 **CPA**，不是 OFM 子服务：

```text
Base URL: http://127.0.0.1:8317/v1
API Key: 你的 CPA 客户端 API Key
Model: 从 CPA /v1/models 返回值选择，默认以 ofm/ 开头
```

支持路径：

- Chat Completions：流式、非流式、工具调用、用量。
- Responses：由 CPA 做客户端协议转换，含流式输出；不是原生持久 Responses 会话。
- Anthropic Messages 和 Gemini generateContent：由 CPA 内置转换器处理。
- 流式思考内容和推理档位；匿名车道 `low/medium/high` 映射到原项目
  `light/balanced/deep` 真实预算，账号渠道保留自身档位。关闭思考不是所有模型都支持。
- 模型后缀如 `ofm/模型ID(high)` 优先于请求体推理参数，符合 CPA 后缀优先约定。

`max_completion_tokens` 在 `max_tokens` 未提供时转换为后者。原项目本身还会应用模型上限、
默认输出限制及最低预算。工具执行权仍在客户端，不在插件服务器。

## 4. 配置与数据

| 配置 | 默认值 / 含义 |
| --- | --- |
| `data-dir` | 系统用户配置目录下 `cli-proxy-api/our-free-model`；显式填写时必须为绝对路径 |
| `node-path` | 空：搜索 PATH，再使用私有缓存 / 自动安装；设置后无效路径会明确报错，不偷偷替换 |
| `auto-install-node` | `true`，缺少合适的 Node 时下载固定官方版本 |
| `auto-install-eac` | `false`；明确启用后才下载固定的原项目 EAC 来源模块 |
| `eac-source-dir` | 可选可信本机原项目源码路径，优先于下载 |
| `port` | `0`，OFM 本地服务选择空闲端口 |
| `console-port` | `0`，一次性交接服务选择空闲端口；固定时不能与 `port` 相同 |
| `model-prefix` | `ofm/`；防止与 CPA 其他供应商模型 ID 冲突 |
| `refresh-models` | `true`，允许 OFM 周期刷新上游模型目录 |
| `catalog-revision` | 改成任意不同整数，触发 CPA 重新注册模型，不重启子服务 |

也可用 `OFM_CPA_HOME` 指定默认数据目录，`OFM_CPA_NODE` 指定默认 Node 路径。
账号、Key、统计与控制台设置都位于 `data-dir`，与 DSH / Magpie 默认数据分离。
升级动态库不会删除账号数据。不要将该目录提交到 GitHub。

插件正常停用或 CPA 退出会关闭子服务。CPA 被强制结束时，控制管道关闭及父进程检查
负责退出。只有识别为本产品且 PID 已不存在的锁文件才会自动恢复；存活或未知锁不会被删除。
更改端口、数据目录等运行配置会重建服务，正在进行的请求可能被取消。

### Node 自动准备

原项目的渠道 Worker 需要 **Node.js 22.19+ 或 24+**，不能用 Bun 代替。
优先使用已安装 Node；缺少时从 nodejs.org 下载固定 **24.21.0**，校验代码中固定的官方
SHA-256，再放入 `data-dir/runtime/`。不需要管理员权限，不改全局 PATH，不运行远程安装脚本。
自动下载可支持 Windows / macOS / Linux 的 x64、arm64，Alpine 仅 x64；实际支持仍取决于
所用系统及动态库构建。Unix 解压需要 `tar`。不允许下载时关闭此选项。

### CPA 全局代理

CPA 8.0.23 的原生 HTTP 回调对回环请求也继承全局代理。为避免把 OFM 私有 Key 发给
外部代理，插件检测到 CPA 全局代理时，改用直接回环 IPC，并通过 CPA 请求生命周期通知取消。
正常情况下仍使用 CPA 的原生 HTTP 回调。两条路径均有真实宿主测试。

这只处理 **CPA → OFM 本机服务**这一跳，不自动改变 **OFM → 厂商**的网络出口。
OFM 厂商访问沿用其原有网络实现和系统环境。CPA 的代理配置不会自动迁移到各账号渠道。
使用直接 IPC 时，CPA 仍记录请求用量，但其原生上游 HTTP 日志不包含这一段本机传输。

## 5. 原项目授权

### EAC

默认不下载 EAC 来源，也不打包其加密凭据文件。需要时设置：

```yaml
auto-install-eac: true
```

插件只下载原仓库固定提交的来源模块、依赖及 MIT 许可，并校验固定 SHA-256，保存到私有缓存。
之后仍需在原控制台完成原项目的 GitHub 登录与 Star 校验。**安装来源不等于已授权**。
不会伪装 DSH 桌面宿主、绕过服务器校验、公开解密结果或获取别人的登录信息。
你也可以通过 `eac-source-dir` 指定可信原项目源码；该目录的模块会在本机执行。

### Gemini 与 Loomy

为避免在独立 CPA 包里分发原项目的内置客户端凭据，本适配通过明确的 CPA 补丁将
Google OAuth 默认值及 Loomy 微信 App ID 改为私有配置，不从参考项目获取修改后的产物。
Gemini 需要你自己的、被相应服务接受的 OAuth 客户端；在数据目录保存 `gemini-oauth.json`：

```json
{ "clientId": "YOUR_GOOGLE_OAUTH_CLIENT_ID", "clientSecret": "YOUR_GOOGLE_OAUTH_CLIENT_SECRET" }
```

Loomy 微信扫码需要合法匹配的 App ID；保存 `loomy-wechat.json`：

```json
{ "appId": "YOUR_AUTHORIZED_LOOMY_WECHAT_APP_ID" }
```

修改后重启插件。也可使用原接口的 `CMDC_PAK_GOOGLE_CLIENT_ID`、
`CMDC_PAK_GOOGLE_CLIENT_SECRET`、`OFM_LOOMY_WECHAT_APP_ID` 环境变量。
这些文件是本地私有配置，不应放入源码或发布包。未对真实个人账号逐家登录验收。

## 6. 远程 CPA / Docker

OFM 的两个服务始终只监听 CPA 所在机器的回环地址。远程服务器可固定配置：

```yaml
port: 18900
console-port: 18901
```

在自己电脑建立转发：

```sh
ssh -N -L 8317:127.0.0.1:8317 -L 18900:127.0.0.1:18900 -L 18901:127.0.0.1:18901 user@server
```

通过自己电脑的 localhost 打开 CPA 和一次性链接。模型服务端口若冲突，原项目可能选择
其他端口，以 **Service status** 实际显示为准。部分厂商 OAuth 另有回调端口，需额外转发。

Docker 中仅做 `-p 18900:18900` 不会把容器内回环监听变成可访问监听。请使用容器内
受控 SSH/端口转发或合适的网络方案；不要为了方便将原控制台无鉴权暴露公网。
该版本不迁移参考项目的 Tailscale 临时公网控制台。

## 7. 构建、验证和边界

```powershell
npm run check
npm test
go test ./...
go vet ./...
npm run build
$env:CPA_BIN = 'C:\path\to\cli-proxy-api.exe'
npm run smoke
$env:CPA_TEST_PROXY = '1'
npm run smoke
```

构建需要 Go 1.24+、C 编译器和 Node；Windows 使用 MinGW-w64 或 Zig，不是 MSVC。
可设置 `GO_BIN`、`CC`。没有 npm 运行时依赖。实际执行的版本和结果见 `VALIDATION.md`。

已知边界：

- CPA 8.0.23 不允许在 Home 模式使用这种直接插件执行路由；此版本支持独立 CPA。
- `/messages/count_tokens` 不返回伪造值：OFM 没有精确计数接口，插件明确返回 501。
- 不支持图片生成、原生 Responses 服务端会话恢复或厂商专有工具语义的完全一致转换。
- 非流式思考字段、原厂错误码等信息可能在原 OFM 转发层已被折叠；插件不臆造丢失信息。
  接收到的 OFM HTTP 错误状态保留，流开始后的失败用 SSE 错误表达。
- DSH 公告、自更新、热重载、宿主自动续跑、局域网中继没有迁移；通过更新动态库升级。
- 免费额度、模型清单、地区可用性和登录接口由上游决定。对话、图片及工具信息会发给对应厂商；
  免费池可能记录提示词，不要发送敏感内容。本插件不自动注册账号、不绕过付费或授权限制。

源码及许可证清单见 `NOTICE.md`；原始及适配文件哈希见
`service/vendor/ofm/UPSTREAM.json`。该插件是独立第三方适配，不代表原项目或 CPA 维护者。
