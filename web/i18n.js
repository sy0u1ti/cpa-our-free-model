(() => {
  'use strict';
  // Message catalog for the plugin's own pages: the management page
  // (index.html, manager.js, updater.js) and the scripts injected into the
  // embedded console (eac-feedback.js, console-bridge.js). The vendored OFM
  // console keeps its own upstream copy.
  //
  // zh-CN is the source language and the fallback for any key missing from
  // another catalog. Keys under `server.` exist only in non-Chinese catalogs:
  // they translate fixed messages that the Go side returns in Chinese, so the
  // Chinese page keeps showing the server's own text unchanged.
  const fallback = 'zh-CN';
  const catalogs = {
    'zh-CN': {
      'page.title': '免费模型管理 · CPA',
      'landing.eyebrow': 'CPA 适配插件',
      'landing.heroLine1': '模型在此汇聚。',
      'landing.heroLine2': '远程也能直达。',
      'landing.embeddedTitle': '免费模型管理',
      'landing.intro': '通过当前 CPA 域名管理免费模型、账号渠道与用量。无需打开 VPS 的本机地址，也不用额外开放端口。',
      'access.keyLabel': 'CPA 管理密钥',
      'access.keyPlaceholder': '填写 CPA 管理密钥，不是模型客户端密钥',
      'access.keyNote': '密钥仅在当前页面内存中使用，只发送给当前 CPA，不写入网址、浏览器存储或日志。远程访问请使用 HTTPS。',
      'access.open': '打开账号控制台 →',
      'access.status': '查看服务状态',
      'access.refresh': '同步模型到 CPA',
      'access.chooseModels': '选择要同步的模型…',
      'access.forget': '清除密钥',
      'access.prompt': '输入管理密钥，即可通过当前 CPA 打开控制台。',
      'selection.heading': '同步到 CPA 的模型',
      'selection.note': '取消勾选的模型不会再出现在 CPA 的模型列表中，客户端直接请求也会被拒绝；控制台里的账号、额度与渠道设置不受影响。选择结果保存在插件的私有数据目录，升级插件不会丢失。',
      'selection.searchPlaceholder': '搜索模型名称或 ID…',
      'selection.searchLabel': '搜索模型',
      'selection.all': '全选',
      'selection.none': '全不选',
      'selection.invert': '反选',
      'selection.listLabel': '模型列表',
      'selection.save': '保存并同步 →',
      'selection.cancel': '取消',
      'update.heading': '更新插件',
      'update.note': '直接在这里更新，不必登录服务器敲命令。CPA 从正式 Release 下载对应平台安装包、校验 SHA-256 并尝试热加载；只有确认新版正在运行，才会显示更新成功。',
      'update.channel': '正式发布通道 · 由 CPA 原生安装器执行',
      'update.prompt': '点击检查更新，确认当前平台是否有可安装的新版本。',
      'update.progress': '插件更新进行中',
      'update.check': '检查更新',
      'update.install': '一键更新 →',
      'update.verify': '确认运行版本',
      'update.reload': '刷新管理页',
      'update.installNote': '安装前会再次确认。首次可能需要添加本插件更新源；保留账号数据和其他更新源。热加载可能中断当前请求，若宿主要求重启会明确提示，不会自动重启 CPA。',
      'source.summary': '源码更新（开发者备用）',
      'source.note': '仓库提交不等于正式安装包。没有 Release 或需要自行编译时，仍可在服务器的干净源码仓库执行更新命令。',
      'source.check': '检查源码提交',
      'source.copy': '复制源码更新命令',
      'source.notChecked': '尚未检查源码。',
      'source.command': 'node scripts/update.mjs --apply --plugin-dir /你的/CPA/plugins',
      'source.commandNote': '将路径改为实际插件目录，需要 Git、Go、Node 和 C 编译器。此备用命令会备份旧动态库，不自动重启 CPA。',
      'notes.heading': '连接说明',
      'notes.beforePrefix': '客户端仍连接 CPA，默认模型 ID 带',
      'notes.afterPrefix': '前缀。渠道登录或模型开关变更后，点击“同步模型到 CPA”。控制台的数据操作始终经过 CPA 管理鉴权。部分厂商使用自己的 OAuth 回调规则，可能仍需按厂商提示转发回调端口。',
      'footer.before': '直接基于',
      'footer.link': '原项目 Our Free Model',
      'footer.after': '，独立适配 CPA。参考二开不是源码依赖。原项目授权与上游服务限制仍然适用。',
      'workspace.label': '插件工作区',
      'workspace.back': '插件设置',
      'workspace.connection': '接入信息',
      'workspace.standalone': '独立打开 ↗',
      'workspace.logout': '退出管理',
      'workspace.copyBase': '复制 CPA 地址',
      'workspace.frameTitle': '免费模型账号控制台',

      'manager.keyRequired': '请先填写 CPA 管理密钥。',
      'manager.httpsRequired': '远程管理需要 HTTPS。请启用域名 TLS，或通过 SSH 转发后的 localhost 访问。',
      'manager.httpError': 'CPA 返回 HTTP {status}，请检查管理密钥、插件状态及远程管理设置。',
      'manager.working': '正在处理，请稍候……',
      'manager.timeout': '操作超时，请检查 CPA 服务。',
      'manager.loggedOut': '已退出管理，页面密钥已清除。',
      'manager.backToSettings': '已返回插件设置。',
      'manager.connectionNote': '客户端地址：{apiBase}；模型前缀：{prefix}。使用 CPA 客户端密钥，不是管理密钥。',
      'manager.noPrefix': '无',
      'status.pluginVersion': '插件版本',
      'status.service': '服务状态',
      'status.running': '运行中',
      'status.stopped': '未运行',
      'status.models': '模型数量',
      'status.channels': '账号渠道',
      'status.ready': '已就绪',
      'status.notReady': '未就绪',
      'status.consoleAccess': '控制台访问',
      'status.consoleAccessValue': '当前 CPA 域名，无需额外端口',
      'status.clientAddress': '客户端地址',
      'status.eacSource': 'EAC 来源',
      'status.eac.ready': '已就绪',
      'status.eac.disabled': '未启用',
      'status.eac.failed': '加载失败',
      'status.eac.unavailable': '不可用',
      'status.unknown': '未知',
      'status.line': '{name}：{value}',
      'manager.statusLoaded': '已获取服务状态。',
      'manager.preparing': '正在准备控制台与已启用的 EAC 来源；首次下载可能需要稍候，不会自动登录。',
      'manager.badConsoleURL': '控制台地址不符合当前 CPA 路由。',
      'manager.syncRequested': '已请求同步 {count} 个模型，CPA 会在几秒内重新载入目录。',
      'manager.syncRequestedExcluded': '已请求同步 {count} 个模型（另有 {excluded} 个已在同步范围外），CPA 会在几秒内重新载入目录。',
      'selection.context': '{k}K 上下文',
      'selection.noMatch': '没有匹配的模型。',
      'selection.empty': '上游目录暂时为空，请先刷新清单。',
      'selection.summary': '已选 {chosen} / {total} 个模型；未勾选的 {count} 个不会同步到 CPA。',
      'selection.stale': '另有 {count} 个已保存但当前目录中不存在的模型仍保持排除：{list}{more}。',
      'selection.staleMore': ' 等',
      'list.separator': '、',
      'selection.loading': '正在读取上游模型目录…',
      'selection.loaded': '已读取 {count} 个上游模型，取消勾选即可排除。',
      'selection.cancelled': '已取消选择，未改变同步范围。',
      'selection.nothingToSave': '没有可保存的模型目录，请先刷新清单。',
      'selection.saved': '已保存：同步 {synced} 个模型，排除 {excluded} 个。CPA 目录会在几秒内重新载入。',
      'source.result': '当前 {current} / 仓库 {latest}。{message}',
      'source.unavailable': '暂时无法检查更新。',
      'source.checked': '版本检查完成，未修改运行中的插件。',
      'copy.done': '已复制。',
      'copy.blocked': '浏览器不允许复制，请手动选中文字。',
      'manager.engineRequestFailed': '工作台请求失败、已取消或连接中断。',
      'manager.consoleRequestFailed': '控制台请求失败、已取消或连接中断。',

      'updater.badResponse': 'CPA 返回了无法识别的响应，请检查反向代理和 CPA 版本。',
      'updater.error.plugin_update_requires_restart': 'CPA 无法在运行时替换此插件，请在维护窗口重启后重新检查。',
      'updater.error.plugin_store_source_conflict': '插件由另一个商店源管理，已停止更新；请从原安装源更新。',
      'updater.error.plugin_store_installed_source_unknown': 'CPA 无法确认原安装源，已停止更新，请先检查插件商店配置。',
      'updater.error.plugin_install_failed': 'CPA 下载、校验或写入安装包失败，请检查服务器网络、目录权限和 CPA 日志。',
      'updater.error.plugin_not_found': '更新源尚未收录此插件，请确认 registry.json 已发布。',
      'updater.httpError': 'CPA 返回 HTTP {status}，请检查管理密钥、远程管理设置和 CPA 日志。',
      'updater.timeout': '操作超时，未确认更新成功。请检查网络后重试。',
      'updater.badContract': '正式版本响应不符合本插件的更新契约，已停止。',
      'updater.badRelease': '正式版本来源或版本号不合法，已停止。',
      'updater.storeUnsupported': 'CPA 不支持所需的插件商店接口，请使用已验证的 CPA 8.0.23 或兼容版本。',
      'updater.sourceMismatch': '插件的原安装源不匹配，已停止；不会卸载插件或覆盖原来源设置。',
      'updater.configUnsupported': 'CPA 缺少安全修改更新源的 v8 配置接口，请升级 CPA；不会覆盖整份配置文件。',
      'updater.badSources': 'CPA 的插件更新源配置格式不合法。',
      'updater.completed': '更新已生效：当前运行 v{version}。点击“刷新管理页”加载新版界面，之后需要重新输入管理密钥。',
      'updater.verifying': '正在核实 v{version} 是否已经运行……',
      'updater.notConfirmed': '尚未确认 v{version} 运行，不能判定更新成功。请检查 CPA 日志；若宿主要求重启，请重启后再点“确认运行版本”。',
      'updater.checking': '正在检查正式 Release 和当前服务器平台……',
      'updater.releaseLine': '当前 v{current} · 正式版 {latest} · {platform}',
      'updater.unpublished': '未发布',
      'updater.versionChanged': '可安装版本已变化，请重新检查后再更新。',
      'updater.checkingStore': '正在核对 CPA 原生更新能力和插件来源……',
      'updater.confirmHead': '确认更新到 v{version}（{platform}）？\n\n',
      'updater.confirmBody': 'CPA 将从本插件 GitHub Release 下载指定版本、校验 SHA-256 并安装，随后尝试热加载。切换时正在进行的模型请求可能中断。\n不会更改账号数据，不需要在服务器运行编译命令，也不会自动重启整个 CPA。\n',
      'updater.confirmSource': '\n首次使用会把下列地址加入 plugins.store-sources，保留已有更新源。CPA 保存配置时可能将旧布局规范化为 v8。\n{registry}',
      'updater.cancelled': '已取消，未下载或安装插件。',
      'updater.addingSource': '正在添加本插件更新源，保留其他源和插件配置……',
      'updater.sourcesChanged': '更新源配置刚刚发生变化，请重新检查；未覆盖其他修改。',
      'updater.sourceUnreadable': 'CPA 尚不能读取本插件更新源。请确认 registry.json 与正式 Release 已发布，并检查服务器访问 GitHub 的网络。',
      'updater.installing': 'CPA 正在下载、校验并安装 v{version}，请保持页面打开……',
      'updater.restartUnconfirmed': ' 尚未确认新版已安装；重启后请重新检查。',
      'updater.runningUnconfirmed': ' 尚未确认运行版本，请先点“确认运行版本”，不要重复安装。',
      'updater.installMismatch': 'CPA 安装响应与已确认版本不一致，请先核实运行版本，未判定成功。',
      'updater.restartRequired': 'v{version} 已安装，但 CPA 要求重启才能生效。请手动重启后点“确认运行版本”。',
      'updater.installed': 'v{version} 安装完成，正在确认 CPA 已加载新版……',
      'updater.installedUnconfirmed': '安装接口已完成，但尚未确认 v{version} 运行。请检查 CPA 日志或重启宿主，再点“确认运行版本”。',

      'eac.no-lane': 'EAC 渠道尚未准备好；这不是网关网络故障。请检查 auto-install-eac / eac-source-dir 与来源状态。',
      'eac.eac-disabled': 'EAC 来源未启用。请启用 auto-install-eac 或配置可信的 eac-source-dir，再重新打开控制台。',
      'eac.eac-loading': 'EAC 来源正在准备，请等待完成后再登录。',
      'eac.eac-source-failed': 'EAC 来源加载失败。请检查来源下载网络、缓存校验或源码路径；不是授权网关不可达。',
      'eac.eac-unavailable': 'EAC 来源已加载，但没有可用渠道。请检查来源配置，不需要反复重新授权。',
      'eac.unreachable': '授权网关暂不可达，请检查 CPA 服务器的网络后重试。',
      'eac.gateway-status': '授权网关应答异常，请稍后重试。',
      'eac.malformed': '授权网关返回的数据格式异常，请稍后重试。',
      'eac.not-writable': '授权已完成，但无法写入 CPA 私有数据目录。请检查目录权限和磁盘空间。',
      'eac.bad-link': '授权链接无效，请重新发起登录。',
      'eac.cancelled': '此次授权操作已取消。',
      'eac.timeout': '请求超时，请检查 CPA 服务器或授权网关后重试。',
      'eac.gatewayHTTP': '授权网关返回 HTTP {status}，请检查服务状态。',
      'eac.unknown': 'EAC 操作未完成，请检查插件状态或重试；尚不能判定为网络故障。',

      'bridge.badResponse': 'CPA 返回了无法识别的管理响应，请返回插件设置重新验证管理密钥。',
      'bridge.openFromSidebar': '请从 CPA 侧栏的“免费模型管理”进入控制台。',
      'bridge.unsupported': '不支持此操作。',
      'bridge.jsonRequired': '控制台请求必须是 JSON 对象。',
      'bridge.cancelled': '请求已取消',
    },
    en: {
      'page.title': 'Free Model Management · CPA',
      'landing.eyebrow': 'CPA ADAPTER PLUGIN',
      'landing.heroLine1': 'All your models, in one place.',
      'landing.heroLine2': 'Reachable from anywhere.',
      'landing.embeddedTitle': 'Free Model Management',
      'landing.intro': 'Manage free models, account channels and usage through your current CPA domain. No need to open the VPS localhost address or expose extra ports.',
      'access.keyLabel': 'CPA management key',
      'access.keyPlaceholder': 'Enter the CPA management key, not a client API key',
      'access.keyNote': 'The key stays in this page\'s memory and is sent only to this CPA. It is never written to URLs, browser storage or logs. Use HTTPS for remote access.',
      'access.open': 'Open account console →',
      'access.status': 'View service status',
      'access.refresh': 'Sync models to CPA',
      'access.chooseModels': 'Choose models to sync…',
      'access.forget': 'Clear key',
      'access.prompt': 'Enter the management key to open the console through this CPA.',
      'selection.heading': 'Models synced to CPA',
      'selection.note': 'Unchecked models leave the CPA model list, and direct client requests for them are refused. Accounts, quota and channel settings in the console are not affected. The selection is stored in the plugin\'s private data directory and survives plugin upgrades.',
      'selection.searchPlaceholder': 'Search model name or ID…',
      'selection.searchLabel': 'Search models',
      'selection.all': 'Select all',
      'selection.none': 'Select none',
      'selection.invert': 'Invert',
      'selection.listLabel': 'Model list',
      'selection.save': 'Save and sync →',
      'selection.cancel': 'Cancel',
      'update.heading': 'Update plugin',
      'update.note': 'Update right here, without signing in to the server to run commands. CPA downloads the package for this platform from the official Release, verifies its SHA-256 and attempts a hot reload. Success is reported only after the new version is confirmed running.',
      'update.channel': 'Stable release channel · installed by the CPA native installer',
      'update.prompt': 'Click Check for updates to see whether a new version is available for this platform.',
      'update.progress': 'Plugin update in progress',
      'update.check': 'Check for updates',
      'update.install': 'Update now →',
      'update.verify': 'Verify running version',
      'update.reload': 'Reload page',
      'update.installNote': 'You will be asked to confirm before installing. The first update may need to add this plugin\'s store source; account data and other sources are kept. A hot reload can interrupt requests in progress. If the host requires a restart, the page says so; CPA is never restarted automatically.',
      'source.summary': 'Source update (developer fallback)',
      'source.note': 'A repository commit is not a release package. Without a Release, or to build it yourself, you can still run the update command from a clean source checkout on the server.',
      'source.check': 'Check source commits',
      'source.copy': 'Copy source update command',
      'source.notChecked': 'Source not checked yet.',
      'source.command': 'node scripts/update.mjs --apply --plugin-dir /your/CPA/plugins',
      'source.commandNote': 'Replace the path with your actual plugins directory. Requires Git, Go, Node and a C compiler. This fallback command backs up the old library and does not restart CPA.',
      'notes.heading': 'Connection notes',
      'notes.beforePrefix': 'Clients still connect to CPA. By default, model IDs carry the',
      'notes.afterPrefix': 'prefix. After a channel login or a model toggle changes, click "Sync models to CPA". Console data operations always go through CPA management authentication. Some vendors use their own OAuth callback rules and may still require forwarding the callback port as they instruct.',
      'footer.before': 'Built directly on',
      'footer.link': 'the original Our Free Model project',
      'footer.after': ' and adapted independently for CPA. The referenced fork is not a source dependency. The original project\'s license and upstream service limits still apply.',
      'workspace.label': 'Plugin workspace',
      'workspace.back': 'Plugin settings',
      'workspace.connection': 'Connection info',
      'workspace.standalone': 'Open in new tab ↗',
      'workspace.logout': 'Log out',
      'workspace.copyBase': 'Copy CPA address',
      'workspace.frameTitle': 'Free model account console',

      'manager.keyRequired': 'Enter the CPA management key first.',
      'manager.httpsRequired': 'Remote management requires HTTPS. Enable TLS for the domain, or connect through localhost over an SSH tunnel.',
      'manager.httpError': 'CPA returned HTTP {status}. Check the management key, the plugin status and the remote management settings.',
      'manager.working': 'Working, please wait…',
      'manager.timeout': 'The operation timed out. Check the CPA service.',
      'manager.loggedOut': 'Logged out. The key was cleared from this page.',
      'manager.backToSettings': 'Back to plugin settings.',
      'manager.connectionNote': 'Client address: {apiBase}; model prefix: {prefix}. Use a CPA client API key, not the management key.',
      'manager.noPrefix': 'none',
      'status.pluginVersion': 'Plugin version',
      'status.service': 'Service status',
      'status.running': 'Running',
      'status.stopped': 'Not running',
      'status.models': 'Models',
      'status.channels': 'Account channels',
      'status.ready': 'Ready',
      'status.notReady': 'Not ready',
      'status.consoleAccess': 'Console access',
      'status.consoleAccessValue': 'Current CPA domain, no extra port needed',
      'status.clientAddress': 'Client address',
      'status.eacSource': 'EAC source',
      'status.eac.ready': 'Ready',
      'status.eac.disabled': 'Disabled',
      'status.eac.failed': 'Failed to load',
      'status.eac.unavailable': 'Unavailable',
      'status.unknown': 'Unknown',
      'status.line': '{name}: {value}',
      'manager.statusLoaded': 'Service status loaded.',
      'manager.preparing': 'Preparing the console and any enabled EAC source. The first download can take a moment; nothing signs in automatically.',
      'manager.badConsoleURL': 'The console address does not match the current CPA route.',
      'manager.syncRequested': 'Requested a sync of {count} models. CPA reloads the catalog within a few seconds.',
      'manager.syncRequested_one': 'Requested a sync of 1 model. CPA reloads the catalog within a few seconds.',
      'manager.syncRequestedExcluded': 'Requested a sync of {count} models (outside the sync scope: {excluded}). CPA reloads the catalog within a few seconds.',
      'manager.syncRequestedExcluded_one': 'Requested a sync of 1 model (outside the sync scope: {excluded}). CPA reloads the catalog within a few seconds.',
      'selection.context': '{k}K context',
      'selection.noMatch': 'No matching models.',
      'selection.empty': 'The upstream catalog is empty for now. Refresh the list first.',
      'selection.summary': 'Selected: {chosen} / {total}. {count} unchecked models will not sync to CPA.',
      'selection.summary_one': 'Selected: {chosen} / {total}. 1 unchecked model will not sync to CPA.',
      'selection.stale': '{count} saved models are missing from the current catalog and stay excluded: {list}{more}.',
      'selection.stale_one': '1 saved model is missing from the current catalog and stays excluded: {list}{more}.',
      'selection.staleMore': ' and others',
      'list.separator': ', ',
      'selection.loading': 'Loading the upstream model catalog…',
      'selection.loaded': 'Loaded {count} upstream models. Uncheck a model to exclude it.',
      'selection.loaded_one': 'Loaded 1 upstream model. Uncheck a model to exclude it.',
      'selection.cancelled': 'Selection cancelled. The sync scope is unchanged.',
      'selection.nothingToSave': 'There is no model catalog to save. Refresh the list first.',
      'selection.saved': 'Saved: {synced} synced, {excluded} excluded. CPA reloads the catalog within a few seconds.',
      'source.result': 'Current {current} / repository {latest}. {message}',
      'source.unavailable': 'Updates cannot be checked right now.',
      'source.checked': 'Version check complete. The running plugin was not changed.',
      'copy.done': 'Copied.',
      'copy.blocked': 'The browser blocked copying. Select the text manually.',
      'manager.engineRequestFailed': 'The workbench request failed, was cancelled or lost its connection.',
      'manager.consoleRequestFailed': 'The console request failed, was cancelled or lost its connection.',

      'updater.badResponse': 'CPA returned an unrecognized response. Check the reverse proxy and the CPA version.',
      'updater.error.plugin_update_requires_restart': 'CPA cannot replace this plugin while it is running. Restart during a maintenance window, then check again.',
      'updater.error.plugin_store_source_conflict': 'This plugin is managed by another store source, so the update stopped. Update it from its original source.',
      'updater.error.plugin_store_installed_source_unknown': 'CPA cannot confirm the original install source, so the update stopped. Check the plugin store configuration first.',
      'updater.error.plugin_install_failed': 'CPA failed to download, verify or write the package. Check the server network, directory permissions and CPA logs.',
      'updater.error.plugin_not_found': 'The store source does not list this plugin yet. Make sure registry.json is published.',
      'updater.httpError': 'CPA returned HTTP {status}. Check the management key, the remote management settings and CPA logs.',
      'updater.timeout': 'The operation timed out and the update was not confirmed. Check the network and try again.',
      'updater.badContract': 'The release response does not match this plugin\'s update contract. Stopped.',
      'updater.badRelease': 'The release source or version number is invalid. Stopped.',
      'updater.storeUnsupported': 'CPA does not support the required plugin store API. Use the verified CPA 8.0.23 or a compatible version.',
      'updater.sourceMismatch': 'The plugin\'s original install source does not match. Stopped; the plugin is not uninstalled and its source settings are not overwritten.',
      'updater.configUnsupported': 'CPA lacks the v8 configuration API needed to edit store sources safely. Upgrade CPA; the configuration file is never overwritten as a whole.',
      'updater.badSources': 'The CPA plugin store sources configuration is malformed.',
      'updater.completed': 'Update applied: v{version} is now running. Click "Reload page" to load the new interface, then enter the management key again.',
      'updater.verifying': 'Checking whether v{version} is running…',
      'updater.notConfirmed': 'v{version} is not confirmed as running, so the update cannot be considered successful. Check the CPA logs. If the host requires a restart, restart it, then click "Verify running version".',
      'updater.checking': 'Checking the official Release and this server\'s platform…',
      'updater.releaseLine': 'Current v{current} · Latest release {latest} · {platform}',
      'updater.unpublished': 'not published',
      'updater.versionChanged': 'The installable version changed. Check again before updating.',
      'updater.checkingStore': 'Checking CPA native update support and the plugin source…',
      'updater.confirmHead': 'Update to v{version} ({platform})?\n\n',
      'updater.confirmBody': 'CPA will download this version from the plugin\'s GitHub Release, verify its SHA-256, install it and then attempt a hot reload. Model requests in progress during the switch may be interrupted.\nAccount data is not changed, no build commands run on the server, and CPA itself is never restarted automatically.\n',
      'updater.confirmSource': '\nOn first use, the address below is added to plugins.store-sources; existing sources are kept. When CPA saves the configuration, it may normalize an older layout to v8.\n{registry}',
      'updater.cancelled': 'Cancelled. Nothing was downloaded or installed.',
      'updater.addingSource': 'Adding this plugin\'s store source; other sources and plugin settings are kept…',
      'updater.sourcesChanged': 'The store sources configuration just changed. Check again; no other changes were overwritten.',
      'updater.sourceUnreadable': 'CPA cannot read this plugin\'s store source yet. Make sure registry.json and the official Release are published, and check the server\'s network access to GitHub.',
      'updater.installing': 'CPA is downloading, verifying and installing v{version}. Keep this page open…',
      'updater.restartUnconfirmed': ' The new version is not confirmed as installed; check again after restarting.',
      'updater.runningUnconfirmed': ' The running version is not confirmed yet. Click "Verify running version" first and do not install again.',
      'updater.installMismatch': 'The CPA install response does not match the confirmed version. Verify the running version first; the update is not considered successful.',
      'updater.restartRequired': 'v{version} is installed, but CPA requires a restart for it to take effect. Restart manually, then click "Verify running version".',
      'updater.installed': 'v{version} installed. Confirming that CPA loaded the new version…',
      'updater.installedUnconfirmed': 'The install call finished, but v{version} is not confirmed as running. Check the CPA logs or restart the host, then click "Verify running version".',

      'eac.no-lane': 'The EAC channel is not ready yet; this is not a gateway network failure. Check auto-install-eac / eac-source-dir and the source status.',
      'eac.eac-disabled': 'The EAC source is not enabled. Enable auto-install-eac or configure a trusted eac-source-dir, then reopen the console.',
      'eac.eac-loading': 'The EAC source is still being prepared. Wait for it to finish before signing in.',
      'eac.eac-source-failed': 'The EAC source failed to load. Check the download network, the cache verification or the source path; the authorization gateway is not the cause.',
      'eac.eac-unavailable': 'The EAC source is loaded, but no channel is available. Check the source configuration; there is no need to authorize again.',
      'eac.unreachable': 'The authorization gateway cannot be reached. Check the CPA server network and try again.',
      'eac.gateway-status': 'The authorization gateway returned an unexpected answer. Try again later.',
      'eac.malformed': 'The authorization gateway returned malformed data. Try again later.',
      'eac.not-writable': 'Authorization finished, but the CPA private data directory is not writable. Check the directory permissions and disk space.',
      'eac.bad-link': 'The authorization link is invalid. Start the sign-in again.',
      'eac.cancelled': 'This authorization was cancelled.',
      'eac.timeout': 'The request timed out. Check the CPA server or the authorization gateway and try again.',
      'eac.gatewayHTTP': 'The authorization gateway returned HTTP {status}. Check the service status.',
      'eac.unknown': 'The EAC operation did not finish. Check the plugin status or try again; this is not known to be a network failure.',

      'bridge.badResponse': 'CPA returned an unrecognized management response. Go back to plugin settings and enter the management key again.',
      'bridge.openFromSidebar': 'Open the console from "免费模型管理" (Free Model Management) in the CPA sidebar.',
      'bridge.unsupported': 'This operation is not supported.',
      'bridge.jsonRequired': 'Console requests must be JSON objects.',
      'bridge.cancelled': 'The request was cancelled',

      'server.release.unavailable': 'Could not read the official release. Try again later; this does not mean you are on the latest version.',
      'server.release.unpublished': 'The repository has no official release package yet. One-click update waits for the first Release; a source commit cannot stand in for an installable version.',
      'server.release.development': 'This is a locally modified or newer development build, so one-click overwrite is disabled. Save and review the source first.',
      'server.release.current': 'The running version matches the latest official Release.',
      'server.release.unpackaged': 'This Release lacks a package for this platform or checksums.txt, so one-click update is not available yet.',
      'server.release.available': 'A new official version is available. CPA can download, verify and install it without Git, Go or a C compiler on the server.',
      'server.source.unavailable': 'Could not check GitHub for updates. Try again later; this does not mean you are on the latest version.',
      'server.source.development': 'This is a development build or a locally modified version. Review the source before updating; nothing is overwritten automatically.',
      'server.source.available': 'The repository has updates. Run the command below on the CPA server to pull, build and install them.',
      'server.source.version-match': 'The version matches the repository, but this build has no commit record, so it cannot confirm that all the latest fixes are included.',
      'server.source.current': 'The running plugin matches the repository main branch.',
    },
  };

  // Every Chinese tag (zh, zh-CN, zh-SG, zh-Hans, zh-TW, zh-HK, zh-Hant...) uses
  // the Simplified catalog; English and every other language use English.
  function normalize(tag) {
    const value = String(tag ?? '').trim().toLowerCase().replace(/_/g, '-');
    if (!value) return '';
    return value === 'zh' || value.startsWith('zh-') ? 'zh-CN' : 'en';
  }
  function queryLanguage() {
    try {
      const match = /[?&]lang=([^&#]*)/.exec(location.search);
      return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : '';
    } catch { return ''; }
  }
  // Same-origin parent, as inside the CPA Management Center. A cross-origin or
  // opaque parent (the sandboxed console frame) throws and is skipped. A
  // top-level page must not read its own static <html lang>.
  function parentLanguage() {
    try {
      if (window.parent === window) return '';
      return window.parent.document.documentElement.lang || '';
    } catch { return ''; }
  }
  function browserLanguages() {
    try {
      const list = navigator.languages?.length ? Array.from(navigator.languages) : [navigator.language];
      return list.filter(Boolean);
    } catch { return []; }
  }
  function detect() {
    for (const tag of [queryLanguage(), parentLanguage(), ...browserLanguages()]) {
      const locale = normalize(tag);
      if (locale) return locale;
    }
    // No language signal at all: keep the original Chinese page.
    return fallback;
  }

  const locale = detect();
  const own = (catalog, key) => Object.hasOwn(catalog, key) ? catalog[key] : undefined;
  function t(key, values) {
    const catalog = catalogs[locale];
    let text = (values?.count === 1 ? own(catalog, key + '_one') : undefined) ??
      own(catalog, key) ?? own(catalogs[fallback], key) ?? key;
    if (values) {
      text = text.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
    }
    return text;
  }
  // Fixed server messages arrive in Chinese. Show them as-is in Chinese, and
  // translate the known states elsewhere; an unknown state keeps the original.
  function fromServer(key, original) {
    return own(catalogs[locale], key) ?? original;
  }
  function apply(root = document) {
    try { document.documentElement.lang = locale; } catch { /* test doubles */ }
    const all = selector => (typeof root.querySelectorAll === 'function' ? Array.from(root.querySelectorAll(selector)) : []);
    for (const element of all('[data-i18n]')) element.textContent = t(element.getAttribute('data-i18n'));
    for (const [data, attribute] of [['data-i18n-placeholder', 'placeholder'], ['data-i18n-aria-label', 'aria-label'], ['data-i18n-title', 'title']]) {
      for (const element of all('[' + data + ']')) element.setAttribute(attribute, t(element.getAttribute(data)));
    }
  }

  window.ofmI18n = Object.freeze({ locale, t, fromServer, apply, normalize, catalogs });
})();
