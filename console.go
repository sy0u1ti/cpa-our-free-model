package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const consoleResourceBase = "/v0/resource/plugins/our-free-model"

var assetNamePattern = regexp.MustCompile(`^[\w-]+\.(js|css)$`)
var consoleCallIDPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

func consoleAssetNames() []string {
	raw, err := serviceAssets.ReadFile("service/vendor/ofm/packages/standalone/web/assets.json")
	if err != nil {
		return nil
	}
	var names []string
	if json.Unmarshal(raw, &names) != nil {
		return nil
	}
	for _, name := range names {
		if !assetNamePattern.MatchString(name) {
			return nil
		}
	}
	return names
}

func consoleResourcePaths() []string {
	paths := []string{"/manager.js", "/updater.js", "/eac-feedback.js", "/console-layout.css", "/console-bridge.js", "/app"}
	for _, name := range consoleAssetNames() {
		paths = append(paths, "/app-assets/"+name)
	}
	return paths
}

func consoleResource(request managementRequest) (httpResponse, bool) {
	if request.Method != "GET" {
		return httpResponse{}, false
	}
	headers := pageHeaders()
	var body []byte
	switch request.Path {
	case consoleResourceBase + "/console":
		body = managementPage
	case consoleResourceBase + "/manager.js":
		body = managementScript
		headers.Set("Content-Type", "text/javascript; charset=utf-8")
	case consoleResourceBase + "/updater.js":
		body = updaterScript
		headers.Set("Content-Type", "text/javascript; charset=utf-8")
	case consoleResourceBase + "/eac-feedback.js":
		body = eacFeedbackScript
		headers.Set("Content-Type", "text/javascript; charset=utf-8")
	case consoleResourceBase + "/console-layout.css":
		body = consoleLayoutStyle
		headers.Set("Content-Type", "text/css; charset=utf-8")
	case consoleResourceBase + "/console-bridge.js":
		body = consoleBridgeScript
		headers.Set("Content-Type", "text/javascript; charset=utf-8")
	case consoleResourceBase + "/app":
		original, err := serviceAssets.ReadFile("service/vendor/ofm/packages/standalone/web/index.html")
		if err != nil {
			return jsonHTTP(500, map[string]string{"error": "控制台资源不可用"}), true
		}
		body = bytes.ReplaceAll(original, []byte(`="/assets/`), []byte(`="./app-assets/`))
		body = bytes.Replace(body, []byte("<head>"), []byte("<head>\n<script src=\"./eac-feedback.js\"></script>\n<script src=\"./console-bridge.js\"></script>"), 1)
		body = bytes.Replace(body, []byte("</head>"), []byte("<link rel=\"stylesheet\" href=\"./console-layout.css\">\n</head>"), 1)
		body = bytes.ReplaceAll(body, []byte("本地控制台"), []byte("CPA 管理控制台"))
		headers.Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https:; font-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'")
	default:
		name := strings.TrimPrefix(request.Path, consoleResourceBase+"/app-assets/")
		if name == request.Path {
			return httpResponse{}, false
		}
		found := false
		for _, asset := range consoleAssetNames() {
			if name == asset {
				found = true
				break
			}
		}
		if !found {
			return httpResponse{}, false
		}
		var err error
		body, err = serviceAssets.ReadFile("service/vendor/ofm/packages/standalone/web/" + name)
		if err != nil {
			return jsonHTTP(500, map[string]string{"error": "控制台资源不可用"}), true
		}
		if strings.HasSuffix(name, ".js") {
			// Adapt served bytes only. The original pinned vendor files remain intact.
			body = bytes.ReplaceAll(body, []byte(`"/assets/"`), []byte(`(new URL("./",import.meta.url).href)`))
			body = bytes.ReplaceAll(body, []byte(`href:"/"`), []byte(`href:"./app"`))
			for _, label := range consoleLabels {
				from, _ := json.Marshal(label[0])
				to, _ := json.Marshal(label[1])
				body = bytes.ReplaceAll(body, from, to)
			}
			for _, patch := range eacConsolePatches {
				body = bytes.ReplaceAll(body, []byte(patch[0]), []byte(patch[1]))
			}
			headers.Set("Content-Type", "text/javascript; charset=utf-8")
		} else {
			headers.Set("Content-Type", "text/css; charset=utf-8")
		}
	}
	return httpResponse{StatusCode: 200, Headers: headers, Body: body}, true
}

func jsonHTTP(status int, value any) httpResponse {
	raw, _ := json.Marshal(value)
	return httpResponse{StatusCode: status, Headers: http.Header{"Content-Type": {"application/json; charset=utf-8"}, "Cache-Control": {"no-store"}, "X-Content-Type-Options": {"nosniff"}}, Body: raw}
}

type consoleProxyRequest struct {
	ID     string          `json:"id"`
	Path   string          `json:"path"`
	Method string          `json:"method"`
	Body   json.RawMessage `json:"body,omitempty"`
}

var consoleAPIRoutes = map[string]bool{
	"GET /api/management/summary": true, "GET /api/management/stats": true,
	"POST /api/management/settings": true, "POST /api/management/models/refresh": true,
	"POST /api/management/models/test": true, "POST /api/management/channels/rpc": true,
	"GET /api/management/eac/status": true, "GET /api/management/eac/pool": true,
	"GET /api/management/eac/login/poll": true, "POST /api/management/eac/login/start": true,
	"POST /api/management/eac/login/cancel": true, "POST /api/management/eac/logout": true,
}

// consoleLabels rewrites upstream Chinese copy that implies a local-only DSH
// installation, so the embedded console reads as a CPA-hosted view. Each
// source literal is also asserted against the pinned web bundle by tests.
var consoleLabels = [][2]string{
	{"LOCAL", "同源访问"}, {"WORKSPACE / OVERVIEW", "工作空间 / 概览"}, {"WORKSPACE / MODELS", "工作空间 / 模型"},
	{"WORKSPACE / USAGE", "工作空间 / 用量"}, {"MANAGEMENT / SETTINGS", "管理 / 设置"}, {"API BASE URL", "客户端接入地址"},
	{"CONNECT YOUR TOOLS", "连接你的客户端"}, {"OUR FREE MODEL / LOCAL CONSOLE", "免费模型 / 管理控制台"},
	{"本地模型工作台", "模型管理工作台"}, {"独立本地服务", "CPA 内部服务"}, {"本机", "CPA 服务器"},
	{"本机运行 / 仅监听回环地址", "当前 CPA 域名访问 / 内部回环运行"}, {"本地服务在线", "OFM 服务在线"},
	{"管理会话：本机独立会话", "管理鉴权：CPA 管理密钥"}, {"推理鉴权：Bearer API Key", "推理鉴权：CPA 客户端密钥"},
	{"监听范围：仅回环地址", "访问方式：当前 CPA 域名"}, {" 本地运行 · 由你掌控", " · 数据保存在 CPA 服务器 · 由你掌控"},
}

// These patches target the pinned upstream UI only at the served-byte boundary.
// Keep the original source hashes intact and fail tests if upstream hooks change.
var eacConsolePatches = [][2]string{
	// Login start: the pinned UI discards the cause and prints "unreachable".
	{`catch{R===u.current&&r(n("eac.startFailed").replace("{reason}","unreachable"))}finally{x.current=!1,s(!1)}}`,
		`catch(error){R===u.current&&r(n("eac.startFailed").replace("{reason}",window.ofmEacFeedback.reason(error)))}finally{x.current=!1,s(!1)}}`},
	// Logout: same blanket catch, same fix.
	{`catch{r(n("eac.startFailed").replace("{reason}","unreachable"))}finally{s(!1)}},cancel:async()=>{`,
		`catch(error){r(n("eac.startFailed").replace("{reason}",window.ofmEacFeedback.reason(error)))}finally{s(!1)}},cancel:async()=>{`},
	// Login start with a structured error object from the gateway.
	{`r(n("eac.startFailed").replace("{reason}",A.error))`,
		`r(n("eac.startFailed").replace("{reason}",window.ofmEacFeedback.reason(A.error)))`},
	// Polling: the pinned UI narrows every failure to a fixed vocabulary and
	// labels anything unrecognised as a network fault.
	{`const c=/\(([^)]+)\)\s*$/.exec(String(l?.message??""))?.[1]??"";o(c)`,
		`o(window.ofmEacFeedback.reason(l))`},
	// Login polling builds the same "unreachable" fallback, which is why a
	// source-preparation failure during polling used to read as a gateway
	// network fault. `not-writable` keeps its dedicated message.
	{`r(_==="not-writable"?U("eac.saveFailed"):U("eac.pollFailed").replace("{reason}",B))`,
		`r(_==="not-writable"?U("eac.saveFailed"):U("eac.pollFailed").replace("{reason}",window.ofmEacFeedback.reason(z)))`},
	// The pool hook already stores a human-readable reason (the poll hook above
	// maps it at the source), so the badge needs no further translation.
	// The EAC page, however, discarded that reason and printed its own hardcoded
	// "cannot query right now", which made a disabled source look like a
	// transient gateway problem. Surface the hook's reason there too.
	{`{pool:ie}=Kn(),e=ie==null?null:Jn(ie)`, `{pool:ie,poolError:eacPoolError}=Kn(),e=ie==null?null:Jn(ie)`},
	{`ie==null?L("p",null,ie===void 0?"正在查询资源池…":"资源池暂时无法查询，请稍后刷新。")`,
		`ie==null?L("p",null,ie===void 0?"正在查询资源池…":eacPoolError||"资源池暂时无法查询，请稍后刷新。")`},
	// "No lane" is a composition state, not a network failure.
	{`if(t.available!==!0)return e("p",{className:"ofm_note"},a("eac.noLane"))`,
		`if(t.available!==!0)return e("p",{className:"ofm_note"},window.ofmEacFeedback.reason(t.reason||"no-lane"))`},
	// The EAC page must not paint the summary's stale authorization state before
	// its own query answers.
	{`function oo({summary:Z}){const[ee,$]=Y.useState(Z.eacAuth)`,
		`function oo({summary:Z}){const[ee,$]=Y.useState(void 0)`},
	// The pinned UI says importing "merges", but the service replaces the whole
	// account pool, model blacklist and permanent-lock table. Say what happens and
	// report how much was written, so an old backup cannot silently drop newer
	// accounts or lock settings.
	{`window.confirm("导入会合并备份中的账号凭据、模型开关和积分锁定设置，确认继续吗？")`,
		`window.confirm("导入会【整体替换】当前账号列表、模型开关和积分锁定设置（不是合并）。备份中缺少的账号与设置会被移除，建议先导出当前备份。确认继续吗？")`},
	// The shared action wrapper appends "已保存。" after every action, which
	// immediately overwrote the import summary. Let an action that reports its
	// own result (by resolving `true`) suppress that generic line.
	{`const j=async H=>{F(!0),Q("");try{await H(),await le(),window.dispatchEvent(new CustomEvent("ofm:channels")),Z.reload?.(),Q("已保存。")}catch(K){Q(K.message)}finally{F(!1)}}`,
		`const j=async H=>{F(!0),Q("");try{const dt=await H();await le(),window.dispatchEvent(new CustomEvent("ofm:channels")),Z.reload?.(),dt!==!0&&Q("已保存。")}catch(K){Q(K.message)}finally{F(!1)}}`},
	{`&&await j(async()=>{await Ae("backup.import",{payload:JSON.parse(await K.text())})})}};`,
		`&&await j(async()=>{const dt=await Ae("backup.import",{payload:JSON.parse(await K.text())});const gt=Number(dt?.accountsImported??0),Rt=Number(dt?.credentialsImported??0),wt=Number(dt?.missingCredentials??0),Re=Number(dt?.expiredAccounts??0),Te=["已整体替换：写入 "+gt+" 个账号、"+Rt+" 条凭据。"];wt>0&&Te.push(wt+" 个账号缺少凭据，需重新登录。");Re>0&&Te.push(Re+" 个账号的凭据已过期，使用时可能自动续期。");dt?.skipped?.length>0&&Te.push("跳过 "+dt.skipped.length+" 条无效凭据。");Q(Te.join(""));return!0})}};`},
}

func validateConsoleRequest(request consoleProxyRequest) bool {
	if !consoleCallIDPattern.MatchString(request.ID) || len(request.Path) > 2048 {
		return false
	}
	u, err := url.ParseRequestURI(request.Path)
	if err != nil || u.IsAbs() || u.Host != "" || u.Fragment != "" || u.RawPath != "" {
		return false
	}
	if !consoleAPIRoutes[request.Method+" "+u.Path] {
		return false
	}
	if len(request.Body) > maxInferenceBodyBytes {
		return false
	}
	if request.Method == "POST" && (len(bytes.TrimSpace(request.Body)) == 0 || bytes.TrimSpace(request.Body)[0] != '{' || !json.Valid(request.Body)) {
		return false
	}
	if request.Method == "GET" && len(request.Body) != 0 {
		return false
	}
	query, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return false
	}
	for key, values := range query {
		if key != "link" || len(values) != 1 || len(values[0]) > 256 ||
			(u.Path != "/api/management/eac/login/poll" && u.Path != "/api/management/eac/login/cancel") {
			return false
		}
	}
	return true
}

func (p *plugin) proxyConsole(rt controlRuntime, raw []byte) httpResponse {
	bad := func(status int, message string) httpResponse {
		return jsonHTTP(status, map[string]string{"error": message})
	}
	if len(raw) > maxInferenceBodyBytes+4096 {
		return bad(413, "请求内容超过 8 MiB 限制")
	}
	var request consoleProxyRequest
	if json.Unmarshal(raw, &request) != nil {
		return bad(400, "控制台请求格式错误")
	}
	if request.Path == "/api/management/key" || request.Path == "/api/management/key/rotate" {
		return bad(409, "远程访问请使用页面顶部的 CPA 地址及 CPA 客户端密钥，无需读取或轮换 OFM 内部密钥。")
	}
	if !validateConsoleRequest(request) {
		return bad(400, "不支持的控制台操作或路径")
	}
	eacPath := strings.HasPrefix(request.Path, "/api/management/eac/")
	if eacPath {
		var state struct {
			Source struct {
				State string `json:"state"`
			} `json:"eacSource"`
		}
		if err := rt.command("status", nil, &state); err != nil {
			return bad(503, "eac-loading")
		}
		reason := map[string]string{
			"disabled": "eac-disabled", "loading": "eac-loading",
			"failed": "eac-source-failed", "unavailable": "eac-unavailable",
		}[state.Source.State]
		// Logout/cancel must remain usable for existing local authorization.
		if reason != "" && request.Path != "/api/management/eac/logout" &&
			!strings.HasPrefix(request.Path, "/api/management/eac/login/cancel") {
			if request.Path == "/api/management/eac/status" {
				return jsonHTTP(200, map[string]any{"available": false, "authorized": false, "login": "", "reason": reason, "sourceState": state.Source.State})
			}
			return bad(503, reason)
		}
	}
	if request.Path == "/api/management/models/test" {
		var body map[string]json.RawMessage
		_ = json.Unmarshal(request.Body, &body)
		var model string
		_ = json.Unmarshal(body["model"], &model)
		p.mu.Lock()
		prefix := p.config.ModelPrefix
		p.mu.Unlock()
		if prefix != "" && strings.HasPrefix(model, prefix) {
			body["model"], _ = json.Marshal(strings.TrimPrefix(model, prefix))
			request.Body, _ = json.Marshal(body)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	p.mu.Lock()
	if !p.accepting || len(p.consoleCalls) >= 32 || p.consoleCalls[request.ID] != nil {
		p.mu.Unlock()
		cancel()
		return bad(429, "控制台正在停止或请求过多，请稍后重试")
	}
	p.consoleCalls[request.ID] = cancel
	p.mu.Unlock()
	defer func() { cancel(); p.mu.Lock(); delete(p.consoleCalls, request.ID); p.mu.Unlock() }()
	var conn connection
	if err := rt.command("connection", nil, &conn); err != nil {
		return bad(503, "无法连接 OFM 内部服务，请检查插件状态")
	}
	u, err := url.Parse(conn.Base)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.Port() == "" || u.User != nil ||
		u.Path != "" || u.RawQuery != "" || u.Fragment != "" || conn.Key == "" {
		return bad(502, "OFM 内部服务地址不合法")
	}
	upstream, err := http.NewRequestWithContext(ctx, request.Method, conn.Base+request.Path, bytes.NewReader(request.Body))
	if err != nil {
		return bad(400, "无效的控制台请求")
	}
	// The caller's management key, cookies and forwarding headers never cross this hop.
	upstream.Header = http.Header{"Authorization": {"Bearer " + conn.Key}, "Content-Type": {"application/json"}, "Origin": {conn.Base}, "Sec-Fetch-Site": {"same-origin"}}
	response, err := loopbackClient.Do(upstream)
	if err != nil {
		return bad(502, "控制台请求失败、超时或已取消")
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 16*1024*1024+1))
	if err != nil || len(body) > 16*1024*1024 || !json.Valid(body) {
		return bad(502, "控制台返回了无效或过大的响应")
	}
	if response.StatusCode >= 300 && response.StatusCode < 400 {
		return bad(502, "控制台不允许重定向到其他地址")
	}
	if request.Path == "/api/management/channels/rpc" {
		var action struct {
			Method string `json:"method"`
		}
		_ = json.Unmarshal(request.Body, &action)
		if action.Method == "gateway.getEnabled" || action.Method == "gateway.setEnabled" {
			var result map[string]any
			if json.Unmarshal(body, &result) == nil {
				if value, ok := result["value"].(map[string]any); ok {
					value["apiKey"] = map[string]any{"value": "", "path": "由 CPA 管理，不向浏览器提供内部密钥", "fromEnv": true}
					body, _ = json.Marshal(result)
				}
			}
		}
	}
	return httpResponse{StatusCode: response.StatusCode, Headers: jsonHTTP(200, nil).Headers, Body: body}
}
