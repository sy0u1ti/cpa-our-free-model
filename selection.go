package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode"
)

// The sync scope lives in the private data directory rather than in the CPA
// plugin config: it is a growing list, and CPA config fields are scalar.
// IDs are stored exactly as the OFM service reports them, without the CPA
// model prefix, so changing the prefix never invalidates a saved scope.
const (
	selectionFileName = "model-selection.json"
	selectionVersion  = 1
	selectionLimit    = 4096
	selectionIDLimit  = 300
)

type modelSelection struct {
	Version int      `json:"version"`
	Hidden  []string `json:"hidden"`
}

func selectionPath(cfg config) string {
	return filepath.Join(cfg.DataDir, selectionFileName)
}

// normalizeSelection validates caller-supplied model IDs and removes
// duplicates while preserving order.
func normalizeSelection(ids []string) ([]string, error) {
	if len(ids) > selectionLimit {
		return nil, problem(400, "invalid_selection", "同步范围一次最多保存 4096 个模型。")
	}
	seen := make(map[string]bool, len(ids))
	out := make([]string, 0, len(ids))
	for _, raw := range ids {
		id := strings.TrimSpace(raw)
		if id == "" {
			continue
		}
		if len(id) > selectionIDLimit {
			return nil, problem(400, "invalid_selection", "模型 ID 过长，最多 300 个字符。")
		}
		if strings.ContainsFunc(id, unicode.IsControl) {
			return nil, problem(400, "invalid_selection", "模型 ID 不能包含控制字符。")
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out, nil
}

func selectionSet(hidden []string) map[string]bool {
	if len(hidden) == 0 {
		return nil
	}
	set := make(map[string]bool, len(hidden))
	for _, id := range hidden {
		set[id] = true
	}
	return set
}

// loadSelection returns the saved scope. A missing file means "sync everything",
// which keeps the pre-scope behaviour for existing installations. A file that
// cannot be trusted is an error rather than a silent fallback, because falling
// back would expose models the user deliberately stopped syncing.
func loadSelection(cfg config) ([]string, error) {
	raw, err := os.ReadFile(selectionPath(cfg))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, problem(500, "selection_unavailable", "无法读取模型同步范围文件。")
	}
	var value modelSelection
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, problem(500, "invalid_selection", "模型同步范围文件已损坏；请重新保存同步范围。")
	}
	if value.Version != 0 && value.Version != selectionVersion {
		return nil, problem(500, "invalid_selection", "模型同步范围文件版本不受支持；请重新保存同步范围。")
	}
	hidden, err := normalizeSelection(value.Hidden)
	if err != nil {
		return nil, problem(500, "invalid_selection", "模型同步范围文件包含无效条目；请重新保存同步范围。")
	}
	return hidden, nil
}

// saveSelection writes the scope atomically and returns the normalized list it
// persisted, so the caller can refresh its cache without re-validating.
func saveSelection(cfg config, hidden []string) ([]string, error) {
	normalized, err := normalizeSelection(hidden)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(cfg.DataDir, 0700); err != nil {
		return nil, problem(500, "selection_unavailable", "无法创建私有数据目录以保存同步范围。")
	}
	body, err := json.MarshalIndent(modelSelection{Version: selectionVersion, Hidden: normalized}, "", "  ")
	if err != nil {
		return nil, problem(500, "selection_unavailable", "无法序列化模型同步范围。")
	}
	path := selectionPath(cfg)
	stage := path + ".tmp"
	if err := os.WriteFile(stage, append(body, '\n'), 0600); err != nil {
		return nil, problem(500, "selection_unavailable", "无法写入模型同步范围文件。")
	}
	if err := os.Rename(stage, path); err != nil {
		_ = os.Remove(stage)
		return nil, problem(500, "selection_unavailable", "无法保存模型同步范围文件。")
	}
	return normalized, nil
}

type selectionCache struct {
	mu     sync.Mutex
	path   string
	loaded bool
	hidden []string
}

// selectionFor serves the scope from memory. Every inference request consults
// it, and re-reading plus re-parsing a file on that path is pure overhead; the
// only writer is saveSelectionFor, which invalidates this cache.
func (c *selectionCache) get(cfg config) ([]string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	path := selectionPath(cfg)
	if c.loaded && c.path == path {
		return c.hidden, nil
	}
	hidden, err := loadSelection(cfg)
	if err != nil {
		return nil, err
	}
	c.path, c.hidden, c.loaded = path, hidden, true
	return hidden, nil
}

func (c *selectionCache) set(cfg config, hidden []string) {
	c.mu.Lock()
	c.path, c.hidden, c.loaded = selectionPath(cfg), hidden, true
	c.mu.Unlock()
}

// saveSelectionFor writes the scope and refreshes the in-memory copy, so the
// change is visible to the very next request without another file read.
func (c *selectionCache) save(cfg config, hidden []string) error {
	normalized, err := saveSelection(cfg, hidden)
	if err != nil {
		return err
	}
	c.set(cfg, normalized)
	return nil
}
