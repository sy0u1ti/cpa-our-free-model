# Our Free Model 的 CPA 适配插件

这是适用于 **CLIProxyAPI / CPA 原生插件系统**的独立适配，不是简单添加一个
`openai-compatibility` 服务商，也不能按 Magpie 的方式直接加载 JavaScript 目录。

原项目：[Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model)。
仅供思路参考：[mu-zi-lee/magpie-our-free-model](https://github.com/mu-zi-lee/magpie-our-free-model)。
模型运行时、账号渠道、管理控制台和用量统计来自原作者；本项目新增 CPA 原生接入、
服务生命周期、安全边界及宿主兼容测试，不把上游功能声明为独立原创。

**v0.2.0 的唯一产品源码上游是原项目，不使用参考项目的源码快照或辅助模块。**
通过 `git show` 直接读取原仓库固定提交的 53 个文件，其中 51 个逐字节不变（包括独立服务
与完整控制台），2 个应用独立可追溯的 CPA 补丁：接入私有 EAC 来源、外置内置 OAuth 配置。
来源、原始 Git blob、前后 SHA-256、补丁说明均记录在 `service/vendor/ofm/UPSTREAM.json`。
`scripts/import-upstream.mjs` 和 `scripts/upstream-patches.mjs` 可以重现整个取源过程。

**当前版本 v0.5.0**：上游同步到 OFM **v2.1.0**（`7e3a1da`），控制台随上游换成新的
六页毛玻璃面板，并带来聚合渠道、省 Token、降级链与原生 Anthropic `/v1/messages`。
本轮修复三个已确认问题：

- **WorkBuddy 国际版全部模型不可用**：腾讯网关要求请求的首条消息必须是 `system`，
  而 OpenAI 网关路径只在调用方自带 system 消息时才转发；控制台的“测试”按钮不带，
  于是每个模型都拿到 `400 + code 11128`。现在适配器会在缺失时补一条 system 消息。
- **备份导入语义**：页面原写“合并”，服务端实际整体替换。确认框改为明确说明
  “整体替换”、提示先导出当前备份，并在导入后显示写入的账号与凭据数量。
- **管理密钥隔离**：控制台 iframe 改为 `sandbox` 且**不含** `allow-same-origin`，
  子页面读取父页面密钥会抛 `SecurityError`；跨窗口消息改由帧对象身份校验。

同时：关闭标签页现在会真正通知 CPA 取消进行中的管理调用（此前只放弃浏览器等待）；
Linux 源码备用更新器创建的安装目录改为可遍历权限，备份目录仍保持私有。

继承 **v0.4.0** 的页面一键更新（CPA 原生安装器、校验清单与更新源），以及 **v0.3.0**
的中文化管理界面、CPA 同域控制台与命令式更新工具。插件 ID、原 `config.yaml` 和数据
目录保持不变，无需重新登录账号。更新方法见第 7 节。

## 1. 安装

已使用 **官方 CPA 8.0.23 的 Windows x64 与 Linux x64 发行版**验证。请使用支持插件的 CPA
发行版，不要使用文件名含 `no-plugin` 的构建。其他 CPA 版本需自行验证 ABI 与功能支持。

**v0.5.0 起提供预编译 Release（Windows x64 / Linux x64），也可从源码构建。**
`dist/` 不随源码提交：优先从 [Releases](https://github.com/sy0u1ti/cpa-our-free-model/releases)
下载 `our-free-model_0.5.0_<系统>_amd64.zip` 并核对 `checksums.txt`；从仓库克隆后
也可按第 7 节自行构建，产物位于：

| 系统 | 文件 |
| --- | --- |
| Windows x64 | `dist/windows/amd64/our-free-model-v0.5.0.dll` |
| Linux x64 | `dist/linux/amd64/our-free-model-v0.5.0.so` |
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
v0.5.0 已发布二进制 Release；尚未上架公共插件商店，首次安装请手动放置动态库，
之后可直接用页面一键更新（见第 7 节）。

## 2. 打开管理界面

CPA 侧栏会出现 **免费模型管理**。也可以在自己的 CPA 域名下访问：

```text
https://你的CPA域名/v0/resource/plugins/our-free-model/console
```

进入页面后输入 **CPA 管理密钥**，点击 **打开账号控制台**。原项目控制台在当前页面中打开，
地址、协议、端口和反代路径前缀跟随当前 CPA 页面，不再生成指向 VPS 回环地址的链接。
模型地址可在顶部直接复制，模型清单复制的 ID 会加上配置的前缀。

在 CPA 管理台内部打开时会自动启用内嵌布局：顶部操作集中靠左、为宿主操作区留白；
原 OFM 侧栏变为横向分区导航，不叠加第二条纵向侧栏。“接入信息”展开后可复制 CPA 地址，
“独立打开”使用新标签页并要求重新输入密钥。直接访问插件入口仍保留独立导航布局。
工具栏跟随控制台主题，内部滚动由内容页承载，不假定固定工具栏高度。

这里有三种不同密钥，不能混用：

| 密钥 | 用途 |
| --- | --- |
| CPA 客户端 API Key | 你的模型客户端调用 CPA 的 `/v1/*` |
| CPA 管理密钥 | 此插件入口操作，以及 CPA 自身管理 |
| OFM 本地服务 Key | 由插件自动生成和使用，不需要填进 CPA 或客户端 |

页面只在当前内存中使用管理密钥，不写入浏览器存储或网址，也不会传给嵌入的原控制台。
CPA 插件资源路径仅提供静态代码；每次读取账号、修改设置等操作都走 CPA 已鉴权管理接口。
服务端只转发白名单内的回环管理路径，并换用 OFM 内部密钥，不转发调用方 Cookie 或密钥。
远程页面请使用 HTTPS；这不是免鉴权的公开管理台。刷新页面或退出后需重新输入 CPA 管理密钥。

控制台运行在**不含 `allow-same-origin` 的沙箱 iframe** 中，因此其脚本处于不透明来源：
读取父页面密钥会抛 `SecurityError`，父页面也只接受来自该 iframe 对象本身的消息。
控制台不需要其它来源（请求都是同源管理路径，经父页面转发），因此没有能力损失。
其余仍未处理的加固项见 `REVIEW_CN.md`。

控制台“API 接入”中的内部密钥读取/轮换在远程模式下不开放，页面会说明应使用 **CPA 客户端密钥**。
厂商账号的登录及授权仍按原项目流程进行。不要将 CPA 管理密钥当作模型客户端密钥使用。

启用模型：

1. 匿名 Zen / Kilo 模型池可以直接使用，不需要账号。
2. 其他渠道在原项目控制台里完成相应登录。
3. 回到 CPA 的插件入口，点击 **同步模型到 CPA**。
4. 在模型客户端选择 CPA `/v1/models` 实际返回的 `ofm/...` 模型。

CPA 原生静态模型目录不会在 OFM 账号变动后自动重建，本插件通过更新
`catalog-revision` 触发 CPA 重载目录；不重启 OFM 服务。单纯在客户端刷新 `/v1/models`
不会触发原生插件重新注册。即使目录未刷新，实际请求仍会检查当前模型及账号启用状态，
不会用旧缓存重新启用已禁用的账号或模型。

## 3. 模型客户端

客户端仍然只连接 **CPA**，不是 OFM 子服务：

```text
Base URL: https://你的CPA域名/v1
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
| `console-port` | 仅供显式本机直连备用入口；默认 0，日常同域名管理不会启动交接监听器 |
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

来源准备在子服务开放之前完成，不需要先点击登录。首次打开控制台会等待初始化；如果已经
明确启用的来源在启动时加载失败，会额外尝试一次，并把失败原因显示为来源准备问题。
并发打开多个页面共用这一尝试，后续轮询不会循环下载。准备成功不表示已授权，不会代替
用户发起 GitHub OAuth；只有真正的网关连接失败才显示“授权网关暂不可达”。

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

默认无需改插件监听地址，也无需开放 OFM 或交接端口。只要现有 CPA HTTPS 域名可访问，
并且 CPA 自身允许此客户端进行管理，就能通过同域名打开控制台。插件不会修改 CPA 的
`allow-remote` 设置，也不会绕过 CPA 管理鉴权。

Nginx/Caddy 等反向代理需要将以下路径交给 CPA：

- `/v0/resource/plugins/our-free-model/`：静态入口、原控制台及资源。
- `/v0/management/ofm/`：已鉴权的控制台数据与更新检查。
- `/v0/management/plugins/our-free-model/config`：同步模型时触发配置修订。
- `/v8/management/`：一键更新使用的原生插件商店与更新源配置接口。

若 CPA 发布在 `/cpa/` 等路径下，保持整套路径前缀一致，并由反代移除前缀后转发至 CPA。
页面会使用当前浏览器域名、HTTPS、端口和路径前缀，不信任外部提交的 Host 作为转发目标。
Docker 只需暴露原有 CPA 端口，无需暴露 OFM 内部端口。

部分厂商 OAuth 仍注册为 localhost 回调，那是厂商的登录规则，可能需要单独转发那个回调端口。
这种情况不会改变控制台的同域名访问方式。高级用户仍可通过已鉴权的
`POST /v0/management/ofm/console-local` 获取旧的十分钟一次性本机链接，必要时自行 SSH 转发；
它不再是页面的默认入口。

## 7. 方便更新

### 页面一键更新

在插件入口填写 CPA 管理密钥，点击 **检查更新 → 一键更新**，确认后由 CPA：

1. 从本插件的正式 GitHub Release 下载当前平台的安装包，校验 `checksums.txt` 中的 SHA-256。
2. 安装已确认的固定版本，不在服务器执行 Git、Go、C 编译器或远程安装脚本。
3. 保存原生商店版本记录，尝试热加载新插件。页面会再次核对正在运行的插件版本和服务状态。
4. 只有运行版本确认一致才显示成功；安装后未确认生效时可以重试核验，不会盲目重复安装。

首次使用可能需要添加以下插件更新源，页面会先确认，保留原有 `store-sources`：

```text
https://raw.githubusercontent.com/sy0u1ti/cpa-our-free-model/main/registry.json
```

这一步只调用 CPA 的 `/v8/management/config/plugins/store-sources` 窄路径接口，不上传替换
整份配置。**CPA 保存时可能将旧配置布局规范化为 v8**；原生安装器也会在插件配置中记录
商店来源和目标版本。其他插件选项、客户端密钥和账号数据不变。

热加载期间当前模型请求可能中断，请选择合适的时机。宿主如果要求重启，页面会明确提示；
不会自动重启整个 CPA，也不声称所有 CPA 版本都支持无中断热更新。使用反代路径前缀时，
要把同前缀下的 `/v8/management/` 也转发到 CPA。

**v0.5.0 是首个正式 Release**，根目录 `registry.json` 已发布。v0.5.0 之前的版本不含更新器，
需要手动安装一次 v0.5.0；从 v0.5.0 起可直接在页面更新到后续正式版本。尚无 Release、
平台安装包缺失、GitHub 请求失败或本地开发构建，都会显示对应状态并禁用安装按钮。

### 源码更新备用

在 CPA 服务器的插件源码仓库目录执行：

```sh
# 只检查远端是否有新提交
node scripts/update.mjs --check

# 拉取、测试、构建、备份并安装；路径换成 CPA 实际的 plugins 根目录
node scripts/update.mjs --apply --plugin-dir /opt/cli-proxy-api/plugins
```

Windows 例如：

```powershell
node scripts/update.mjs --apply --plugin-dir 'D:\CPA\plugins'
```

第一次从 v0.2.x 升级，需要先 `git pull --ff-only` 获取更新脚本。之后通常只需第二条命令，
完成后通过你原来的 systemd/Docker/进程管理方式重启 CPA。仍需要 Go、C 编译器、Node，
这属于源码更新工具，不是已经发布了预编译安装包。

工具会：

- 核对 `origin` 是本插件仓库，只允许干净的 `main` 分支快进；不会 reset、覆盖修改或自动合并冲突。
- 固定本次远端提交，重新执行新提交中的更新脚本，运行测试和构建。
- 将旧动态库和校验清单备份到 `<plugins>/.ofm-backups/`，不会在原文件上直接截断写入。
- 通过同目录原子替换安装新版本，不修改 CPA 配置、账号目录，也不擅自重启服务。
- 安装失败时保留旧文件。构建失败时源码可能已经更新，但运行中的动态库未替换，可修复工具链后重跑。

安装完成后必须重启 CPA 以确认加载新构建。若需回退，在停止 CPA 后根据备份目录
`manifest.json` 中的原路径恢复旧插件，并移开新版本文件；恢复前保留当前账号数据。
CPA 可能清理未选用的旧版本，因此回退请使用独立备份，不依赖扫描目录里的旧文件。

页面折叠区的 **检查源码提交** 比较版本与源码提交，五分钟缓存，不会下载执行远程代码；
检查失败只显示“无法检查”，不会误报“已是最新”。自动构建会记录源码提交；带未提交修改的
开发构建会明确标记，不会建议盲目覆盖。安装包/源码 ZIP 没有 Git 元数据时，无法确认同版本的新提交。

### 正式版本发布

`.github/workflows/release.yml` 会在版本标签与 `package.json` 匹配时测试、构建 Windows /
Linux x64 产物，先上传完整草稿，再发布 Release；手动运行工作流只构建，不发布。
ZIP 命名为 `our-free-model_<版本>_<系统>_<架构>.zip`，动态库放在 ZIP 根目录，并提供 CPA
要求的 `checksums.txt`。同一个已发布版本的内容不应被覆盖替换。

```sh
npm run build
npm run package
npm run release:checksums
# 使用真实 CPA 与一个旧版插件，在隔离目录中验证更新
CPA_BIN=/path/to/cli-proxy-api CPA_UPDATE_PREVIOUS=/path/to/old-plugin.so npm run smoke:update
```

## 8. 构建、验证和边界

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
- 请求体（包括内联图片）上限为 8 MiB，超出返回 413。长时间思考时建议在 CPA 的
  `streaming` 配置下设置 `keepalive-seconds: 15`。SSE 外壳由 CPA 生成，上游注释心跳不会作为 JSON 数据转发。
- DSH 公告、自更新、热重载、宿主自动续跑、局域网中继没有迁移；通过更新动态库升级。
- 同域名代理仅承载管理 JSON，不开放任意 HTTP 请求、本机终端启动和 OFM 内部密钥读取。
  单次管理操作最长两分钟；退出页面会尽力取消等待，厂商端已完成的操作不能回滚。
- 免费额度、模型清单、地区可用性和登录接口由上游决定。对话、图片及工具信息会发给对应厂商；
  免费池可能记录提示词，不要发送敏感内容。本插件不自动注册账号、不绕过付费或授权限制。

源码及许可证清单见 `NOTICE.md`；原始及适配文件哈希见
`service/vendor/ofm/UPSTREAM.json`。该插件是独立第三方适配，不代表原项目或 CPA 维护者。
