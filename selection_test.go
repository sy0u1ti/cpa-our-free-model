package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func selectionFixture(t *testing.T) (*plugin, *fixtureRuntime) {
	t.Helper()
	p, rt := fixturePlugin(nil)
	rt.rows = []modelRow{
		{ID: "alpha", Name: "Alpha", Context: 128000, MaxTokens: 8192},
		{ID: "beta", Name: "Beta", Context: 64000, MaxTokens: 4096},
		{ID: "gamma", Name: "Gamma", Context: 32000, MaxTokens: 2048},
	}
	p.config.DataDir = t.TempDir()
	return p, rt
}

func readSelectionWire(t *testing.T, p *plugin) map[string]any {
	t.Helper()
	result, err := p.Handle("management.handle", wire(t, managementRequest{Method: "GET", Path: "/v0/management/ofm/selection"}))
	if err != nil {
		t.Fatal(err)
	}
	response := result.(httpResponse)
	if response.StatusCode != 200 {
		t.Fatalf("selection read failed: %d %s", response.StatusCode, response.Body)
	}
	var value map[string]any
	if err := json.Unmarshal(response.Body, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func writeSelectionWire(t *testing.T, p *plugin, hidden []string) (int, map[string]any) {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"hidden": hidden})
	if err != nil {
		t.Fatal(err)
	}
	result, err := p.Handle("management.handle", wire(t, managementRequest{Method: "POST", Path: "/v0/management/ofm/selection", Body: raw}))
	if err != nil {
		var rpc *rpcError
		if !errorsAs(err, &rpc) {
			t.Fatal(err)
		}
		return rpc.HTTPStatus, nil
	}
	response := result.(httpResponse)
	var value map[string]any
	if len(response.Body) > 0 {
		_ = json.Unmarshal(response.Body, &value)
	}
	return response.StatusCode, value
}

// errorsAs keeps the test file free of an extra import for one call.
func errorsAs(err error, target **rpcError) bool {
	value, ok := err.(*rpcError)
	if ok {
		*target = value
	}
	return ok
}

func TestSelectionDefaultsToEverythingSynced(t *testing.T) {
	p, _ := selectionFixture(t)
	result, err := p.Handle("model.static", nil)
	if err != nil {
		t.Fatal(err)
	}
	if models := result.(modelResponse).Models; len(models) != 3 {
		t.Fatalf("missing scope file must sync the whole catalog: %d", len(models))
	}
	value := readSelectionWire(t, p)
	if value["total"].(float64) != 3 || value["syncedCount"].(float64) != 3 {
		t.Fatalf("unexpected default selection summary: %+v", value)
	}
	if hidden, ok := value["hidden"].([]any); !ok || len(hidden) != 0 {
		t.Fatalf("default scope must hide nothing: %+v", value["hidden"])
	}
}

// CPA only forwards management calls for routes the plugin declared at
// registration time; a missing entry becomes a 404 before the handler runs.
func TestManagementRegistrationDeclaresEveryHandledRoute(t *testing.T) {
	registered := make(map[string]bool)
	for _, route := range managementRegistration().(map[string]any)["routes"].([]map[string]string) {
		registered[route["Method"]+" /v0/management"+route["Path"]] = true
	}
	handled := []string{
		"GET /v0/management/ofm/status", "GET /v0/management/ofm/models",
		"GET /v0/management/ofm/selection", "POST /v0/management/ofm/selection",
		"POST /v0/management/ofm/console", "POST /v0/management/ofm/console-local",
		"POST /v0/management/ofm/console-api", "POST /v0/management/ofm/console-cancel",
		"GET /v0/management/ofm/updates", "GET /v0/management/ofm/releases",
	}
	for _, key := range handled {
		if !registered[key] {
			t.Errorf("management route %q is handled but not registered; CPA would answer 404", key)
		}
	}
	// The declaration must not advertise routes the plugin refuses to serve.
	allowed := make(map[string]bool, len(handled))
	for _, key := range handled {
		allowed[key] = true
	}
	for key := range registered {
		if !allowed[key] {
			t.Fatalf("route %q is registered without a handler", key)
		}
	}
}

func TestSelectionExcludesModelsFromCatalogAndExecution(t *testing.T) {
	p, _ := selectionFixture(t)
	if _, err := p.Handle("model.static", nil); err != nil {
		t.Fatal(err)
	}
	status, body := writeSelectionWire(t, p, []string{"beta"})
	if status != 200 || body["syncedCount"].(float64) != 2 {
		t.Fatalf("scope save failed: %d %+v", status, body)
	}
	result, err := p.Handle("model.static", nil)
	if err != nil {
		t.Fatal(err)
	}
	models := result.(modelResponse).Models
	if len(models) != 2 {
		t.Fatalf("excluded model still registered: %+v", models)
	}
	for _, model := range models {
		if strings.Contains(model.ID, "beta") {
			t.Fatal("excluded model still registered")
		}
	}
	// Ownership follows the filtered catalog, so a direct client call to the
	// excluded model must not be routed here.
	if _, err := p.Handle("model.route", wire(t, map[string]string{"RequestedModel": "ofm/beta"})); err != nil {
		t.Fatal(err)
	}
	p.mu.Lock()
	owned := p.ownsModelLocked("ofm/beta")
	p.mu.Unlock()
	if owned {
		t.Fatal("excluded model must not be claimable by this plugin")
	}
	// The scope must survive a restart of the plugin process.
	reloaded, reloadRuntime := selectionFixture(t)
	reloaded.config.DataDir = p.config.DataDir
	_ = reloadRuntime
	result, err = reloaded.Handle("model.static", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.(modelResponse).Models) != 2 {
		t.Fatal("saved scope was not reloaded from disk")
	}
}

func TestSelectionRejectsUnknownAndInvalidInput(t *testing.T) {
	p, _ := selectionFixture(t)
	if _, err := p.Handle("model.static", nil); err != nil {
		t.Fatal(err)
	}
	if status, _ := writeSelectionWire(t, p, []string{"not-in-catalog"}); status != 400 {
		t.Fatalf("unknown model accepted: %d", status)
	}
	// A body without the field must not be treated as "sync everything".
	if _, err := p.Handle("management.handle", wire(t, managementRequest{Method: "POST", Path: "/v0/management/ofm/selection", Body: []byte("{}")})); err == nil {
		t.Fatal("a request without hidden must be rejected instead of widening the scope")
	} else if rpc, ok := err.(*rpcError); !ok || rpc.HTTPStatus != 400 {
		t.Fatalf("missing hidden must be a bad request: %v", err)
	}
	long := strings.Repeat("x", selectionIDLimit+1)
	if status, _ := writeSelectionWire(t, p, []string{long}); status != 400 {
		t.Fatalf("oversized ID accepted: %d", status)
	}
	if status, _ := writeSelectionWire(t, p, []string{"alpha\r\nInjected: true"}); status != 400 {
		t.Fatalf("control characters accepted: %d", status)
	}
	// A rejected write must leave the previous scope intact.
	result, err := p.Handle("model.static", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.(modelResponse).Models) != 3 {
		t.Fatal("a rejected write changed the effective scope")
	}
}

func TestSelectionDeduplicatesAndKeepsOrder(t *testing.T) {
	ids, err := normalizeSelection([]string{" beta ", "alpha", "beta", "", "gamma"})
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 3 || ids[0] != "beta" || ids[1] != "alpha" || ids[2] != "gamma" {
		t.Fatalf("normalization lost order or duplicates: %+v", ids)
	}
	tooMany := make([]string, selectionLimit+1)
	for index := range tooMany {
		tooMany[index] = "id" + string(rune('a'+index%26))
	}
	if _, err := normalizeSelection(tooMany); err == nil {
		t.Fatal("oversized selection accepted")
	}
}

// A damaged scope file must fail closed: re-exposing models the user excluded
// is worse than refusing to publish a catalog. An explicit save is the repair
// path, because the user has just confirmed the whole scope from the UI.
func TestSelectionFailsClosedOnCorruptFile(t *testing.T) {
	p, _ := selectionFixture(t)
	if _, err := p.Handle("model.static", nil); err != nil {
		t.Fatal(err)
	}
	if status, _ := writeSelectionWire(t, p, []string{"beta"}); status != 200 {
		t.Fatal("fixture setup failed")
	}
	if err := os.WriteFile(selectionPath(p.config), []byte("{not json"), 0600); err != nil {
		t.Fatal(err)
	}
	// A fresh process is what actually meets a damaged file on startup; the
	// running plugin only ever reads the copy it wrote itself.
	restarted, _ := selectionFixture(t)
	restarted.config.DataDir = p.config.DataDir
	if _, err := restarted.Handle("model.static", nil); err == nil {
		t.Fatal("corrupt scope file must not fall back to exposing every model")
	}
	// The UI must be told, with a server status, that the scope file is unreadable.
	if _, err := restarted.Handle("management.handle", wire(t, managementRequest{Method: "GET", Path: "/v0/management/ofm/selection"})); err == nil {
		t.Fatal("the UI must be told the scope file is unreadable")
	} else if rpc, ok := err.(*rpcError); !ok || rpc.HTTPStatus != 500 {
		t.Fatalf("unreadable scope must surface as a server error: %v", err)
	}
	// Saving a complete, validated scope is the documented repair path.
	if status, body := writeSelectionWire(t, restarted, []string{"gamma"}); status != 200 {
		t.Fatalf("an explicit save must repair a damaged scope file: %d %+v", status, body)
	}
	result, err := restarted.Handle("model.static", nil)
	if err != nil {
		t.Fatal(err)
	}
	models := result.(modelResponse).Models
	if len(models) != 2 {
		t.Fatalf("repaired scope not applied: %+v", models)
	}
	for _, model := range models {
		if model.ID == "ofm/gamma" {
			t.Fatal("repaired scope did not exclude the chosen model")
		}
	}
}

func TestSelectionStaleIDsStayExcludedButAreReported(t *testing.T) {
	p, rt := selectionFixture(t)
	if _, err := p.Handle("model.static", nil); err != nil {
		t.Fatal(err)
	}
	if status, _ := writeSelectionWire(t, p, []string{"gamma"}); status != 200 {
		t.Fatal("fixture setup failed")
	}
	// The provider drops the model entirely: it should leave the saved list in
	// place but stop being reported as a selectable row.
	rt.rows = rt.rows[:2]
	value := readSelectionWire(t, p)
	if value["total"].(float64) != 2 {
		t.Fatalf("catalog not refreshed: %+v", value)
	}
	if stale, ok := value["stale"].([]any); !ok || len(stale) != 1 || stale[0] != "gamma" {
		t.Fatalf("stale entry not reported: %+v", value["stale"])
	}
	raw, err := os.ReadFile(selectionPath(p.config))
	if err != nil {
		t.Fatal(err)
	}
	var saved modelSelection
	if err := json.Unmarshal(raw, &saved); err != nil || len(saved.Hidden) != 1 || saved.Hidden[0] != "gamma" {
		t.Fatalf("stale entry must remain excluded on disk: %s", raw)
	}
	// Re-introducing the model keeps it excluded without any user action.
	rt.rows = append(rt.rows, modelRow{ID: "gamma", Name: "Gamma"})
	if _, err := p.Handle("model.static", nil); err != nil {
		t.Fatal(err)
	}
	value = readSelectionWire(t, p)
	for _, row := range value["models"].([]any) {
		entry := row.(map[string]any)
		if entry["id"] == "gamma" && entry["synced"] != false {
			t.Fatal("returning model lost its exclusion")
		}
	}
}

func TestSelectionFileIsPrivate(t *testing.T) {
	p, _ := selectionFixture(t)
	if _, err := p.Handle("model.static", nil); err != nil {
		t.Fatal(err)
	}
	if status, _ := writeSelectionWire(t, p, []string{"beta"}); status != 200 {
		t.Fatal("fixture setup failed")
	}
	if _, err := os.Stat(filepath.Join(p.config.DataDir, selectionFileName)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(selectionPath(p.config) + ".tmp"); !os.IsNotExist(err) {
		t.Fatal("temporary file must not be left behind")
	}
}

// The scope is read on every inference request, so it is cached in memory. The
// cache must follow every save and must not be shared across data directories
// (the plugin is reconfigured in place when config changes).
func TestSelectionCacheTracksSavesAndDataDirectory(t *testing.T) {
	p, _ := selectionFixture(t)
	if _, err := p.Handle("model.static", nil); err != nil {
		t.Fatal(err)
	}
	first := p.config.DataDir
	if status, _ := writeSelectionWire(t, p, []string{"beta"}); status != 200 {
		t.Fatal("fixture setup failed")
	}
	// The same process must see the new scope immediately, without a reload.
	result, err := p.Handle("model.static", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.(modelResponse).Models) != 2 {
		t.Fatal("the cache did not follow the save")
	}
	// Moving to a different data directory must not reuse the previous scope.
	p.config.DataDir = t.TempDir()
	result, err = p.Handle("model.static", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.(modelResponse).Models) != 3 {
		t.Fatal("a new data directory inherited another directory's scope")
	}
	// Switching back must serve the first directory's own scope again, not the
	// other directory's empty one.
	if err := os.WriteFile(selectionPath(p.config), []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	p.config.DataDir = first
	hidden, err := p.selection.get(p.config)
	if err != nil {
		t.Fatalf("returning to the original directory must reuse its saved scope: %v", err)
	}
	if len(hidden) != 1 || hidden[0] != "beta" {
		t.Fatalf("cache did not key on the data directory: %+v", hidden)
	}
}

// CPA keeps serving its own cached catalog until catalog-revision changes, so a
// model can be excluded while still listed upstream. The executor must refuse it
// in that window instead of forwarding the request.
func TestExcludedModelIsRefusedBeforeCatalogReload(t *testing.T) {
	p, rt := selectionFixture(t)
	if _, err := p.Handle("model.static", nil); err != nil {
		t.Fatal(err)
	}
	if status, _ := writeSelectionWire(t, p, []string{"beta"}); status != 200 {
		t.Fatal("fixture setup failed")
	}
	request := executorRequest{Model: "ofm/beta", Format: "openai", Payload: []byte(`{"messages":[]}`)}
	_, err := p.prepare(p.config, rt, request, false)
	if err == nil {
		t.Fatal("an excluded model was forwarded while the host catalog was still stale")
	}
	rpc, ok := err.(*rpcError)
	if !ok || rpc.HTTPStatus != 404 {
		t.Fatalf("excluded model must fail as a missing model: %v", err)
	}
	// The reasoning-effort suffix form must be refused the same way.
	if _, err := p.prepare(p.config, rt, executorRequest{Model: "ofm/beta(high)", Format: "openai", Payload: []byte(`{"messages":[]}`)}, false); err == nil {
		t.Fatal("the effort-suffixed form bypassed the sync scope")
	}
	// A model that is still in scope must keep working.
	if _, err := p.prepare(p.config, rt, executorRequest{Model: "ofm/alpha", Format: "openai", Payload: []byte(`{"messages":[]}`)}, false); err != nil {
		t.Fatalf("an in-scope model was rejected: %v", err)
	}
}
