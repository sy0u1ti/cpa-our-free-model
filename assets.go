package main

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Keep private or ignored files in service/ out of published binaries.
//
//go:embed service/package.json service/runner.mjs service/src/catalog.mjs service/src/console-tickets.mjs service/src/eac-provider.mjs
//go:embed service/upstream-eac.json service/vendor/CPA_LICENSE service/vendor/WEB_LICENSES.txt service/vendor/WEB_LICENSE_SOURCES.json
//go:embed service/vendor/ofm/UPSTREAM.json
//go:embed service/vendor/YAML_LICENSE service/vendor/ofm/LICENSE service/vendor/ofm/package.json service/vendor/ofm/packages/standalone/README.md
//go:embed service/vendor/ofm/packages/standalone/channels/business.mjs service/vendor/ofm/packages/standalone/channels/contracts.mjs
//go:embed service/vendor/ofm/packages/standalone/channels/credentials.mjs service/vendor/ofm/packages/standalone/channels/images.mjs
//go:embed service/vendor/ofm/packages/standalone/channels/runtime.mjs service/vendor/ofm/packages/standalone/channels/worker.mjs
//go:embed service/vendor/ofm/packages/standalone/cli.mjs service/vendor/ofm/packages/standalone/eac.mjs
//go:embed service/vendor/ofm/packages/standalone/login-terminal.mjs service/vendor/ofm/packages/standalone/management.mjs
//go:embed service/vendor/ofm/packages/standalone/package.json service/vendor/ofm/packages/standalone/service.mjs
//go:embed service/vendor/ofm/packages/standalone/web/_ofm-provider-list-D9WP3xjp.js service/vendor/ofm/packages/standalone/web/app.css
//go:embed service/vendor/ofm/packages/standalone/web/app.js service/vendor/ofm/packages/standalone/web/assets.json
//go:embed service/vendor/ofm/packages/standalone/web/channels-Dyod_rQn.js service/vendor/ofm/packages/standalone/web/index.html
//go:embed service/vendor/ofm/packages/standalone/web/loader-circle-BGKf-mYU.js service/vendor/ofm/packages/standalone/web/models-8lE4ufFd.js
//go:embed service/vendor/ofm/packages/standalone/web/search-RZVy3Eoo.js service/vendor/ofm/packages/standalone/web/settings-Cq1Y-v4k.js
//go:embed service/vendor/ofm/packages/standalone/web/usage-SUrY-tWU.js service/vendor/ofm/packages/standalone/web/x-CzfajR1e.js
//go:embed service/vendor/ofm/scripts/standalone-third-party.txt service/vendor/ofm/src/adapter.js service/vendor/ofm/src/aggregate.js
//go:embed service/vendor/ofm/src/anthropic.js service/vendor/ofm/src/catalog.js service/vendor/ofm/src/chan-relay.js
//go:embed service/vendor/ofm/src/channel.js service/vendor/ofm/src/combos.js service/vendor/ofm/src/core/completion.js
//go:embed service/vendor/ofm/src/core/runtime.js service/vendor/ofm/src/core/stats.js service/vendor/ofm/src/eac-login.js
//go:embed service/vendor/ofm/src/eac-user.js service/vendor/ofm/src/eac.js service/vendor/ofm/src/effort.js service/vendor/ofm/src/egress.js
//go:embed service/vendor/ofm/src/feed.js service/vendor/ofm/src/forward.js service/vendor/ofm/src/http.js service/vendor/ofm/src/image-pricing.js
//go:embed service/vendor/ofm/src/kilo.js service/vendor/ofm/src/local-optimize.js service/vendor/ofm/src/messages.js
//go:embed service/vendor/ofm/src/picks.js service/vendor/ofm/src/probe.js service/vendor/ofm/src/providers/index.js service/vendor/ofm/src/providers/registry.json
//go:embed service/vendor/ofm/src/push.js service/vendor/ofm/src/recovery.js service/vendor/ofm/src/reload.js
//go:embed service/vendor/ofm/src/route/classify.js service/vendor/ofm/src/store.js service/vendor/ofm/src/stream.js
//go:embed service/vendor/ofm/src/token-saver/index.js service/vendor/ofm/src/token-saver/inject.js service/vendor/ofm/src/token-saver/prompts.js
//go:embed service/vendor/ofm/src/token-saver/rtk/applyFilter.js service/vendor/ofm/src/token-saver/rtk/autodetect.js
//go:embed service/vendor/ofm/src/token-saver/rtk/constants.js service/vendor/ofm/src/token-saver/rtk/filters/buildOutput.js
//go:embed service/vendor/ofm/src/token-saver/rtk/hitLine.js
//go:embed service/vendor/ofm/src/token-saver/rtk/filters/dedupLog.js service/vendor/ofm/src/token-saver/rtk/filters/find.js
//go:embed service/vendor/ofm/src/token-saver/rtk/filters/gitDiff.js service/vendor/ofm/src/token-saver/rtk/filters/gitLog.js
//go:embed service/vendor/ofm/src/token-saver/rtk/filters/gitStatus.js service/vendor/ofm/src/token-saver/rtk/filters/grep.js
//go:embed service/vendor/ofm/src/token-saver/rtk/filters/ls.js service/vendor/ofm/src/token-saver/rtk/filters/readNumbered.js
//go:embed service/vendor/ofm/src/token-saver/rtk/filters/searchList.js service/vendor/ofm/src/token-saver/rtk/filters/smartTruncate.js
//go:embed service/vendor/ofm/src/token-saver/rtk/filters/tree.js service/vendor/ofm/src/token-saver/rtk/index.js
//go:embed service/vendor/ofm/src/token-saver/rtk/registry.js service/vendor/ofm/src/trust.js service/vendor/ofm/src/updater.js
//go:embed service/vendor/ofm/src/upstream.js service/vendor/ofm/vendor/channel-pack/LICENSE service/vendor/ofm/vendor/channel-pack/NOTICE.md
//go:embed service/vendor/ofm/vendor/channel-pack/qoder-auth-wasm.wasm
var serviceAssets embed.FS

//go:embed web/index.html
var managementPage []byte

//go:embed web/manager.js
var managementScript []byte

//go:embed web/updater.js
var updaterScript []byte

//go:embed web/eac-feedback.js
var eacFeedbackScript []byte

//go:embed web/console-layout.css
var consoleLayoutStyle []byte

//go:embed web/console-bridge.js
var consoleBridgeScript []byte

func assetFiles() ([]string, string, error) {
	var files []string
	hash := sha256.New()
	err := fs.WalkDir(serviceAssets, "service", func(name string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		raw, err := serviceAssets.ReadFile(name)
		if err != nil {
			return err
		}
		files = append(files, name)
		_, _ = fmt.Fprintf(hash, "%s\x00%d\x00", name, len(raw))
		_, _ = hash.Write(raw)
		return nil
	})
	return files, hex.EncodeToString(hash.Sum(nil))[:20], err
}

func safeRemoveAll(target, parent string) error {
	abs, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	root, err := filepath.Abs(parent)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(root, abs)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return fmt.Errorf("refusing to remove a path outside the private staging directory")
	}
	return os.RemoveAll(abs)
}

func verifyAssets(directory string, files []string) bool {
	for _, name := range files {
		rel := strings.TrimPrefix(name, "service/")
		expected, err := serviceAssets.ReadFile(name)
		if err != nil {
			return false
		}
		file := filepath.Join(directory, filepath.FromSlash(rel))
		for part := file; ; part = filepath.Dir(part) {
			info, err := os.Lstat(part)
			if err != nil || info.Mode()&os.ModeSymlink != 0 {
				return false
			}
			if part == file {
				if !info.Mode().IsRegular() || info.Size() != int64(len(expected)) {
					return false
				}
			} else if !info.IsDir() {
				return false
			}
			if part == directory {
				break
			}
		}
		actual, err := os.ReadFile(file)
		if err != nil || sha256.Sum256(expected) != sha256.Sum256(actual) {
			return false
		}
	}
	return true
}

func extractService(dataDir string) (string, error) {
	files, digest, err := assetFiles()
	if err != nil {
		return "", err
	}
	root := filepath.Join(dataDir, "runtime")
	if err := os.MkdirAll(root, 0700); err != nil {
		return "", err
	}
	destination := filepath.Join(root, "cpa-service-"+digest)
	if _, err := os.Lstat(destination); err == nil {
		if verifyAssets(destination, files) {
			return destination, nil
		}
		return "", fmt.Errorf("embedded service cache failed integrity verification; remove only %s while CPA is stopped", destination)
	} else if !os.IsNotExist(err) {
		return "", err
	}
	stage, err := os.MkdirTemp(root, ".cpa-service-")
	if err != nil {
		return "", err
	}
	defer func() { _ = safeRemoveAll(stage, root) }()
	for _, name := range files {
		raw, err := serviceAssets.ReadFile(name)
		if err != nil {
			return "", err
		}
		file := filepath.Join(stage, filepath.FromSlash(strings.TrimPrefix(name, "service/")))
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			return "", err
		}
		if err := os.WriteFile(file, raw, 0600); err != nil {
			return "", err
		}
	}
	if err := renameAssetDirectory(stage, destination, os.Rename, time.Sleep); err != nil && !verifyAssets(destination, files) {
		return "", fmt.Errorf("install embedded service: %w", err)
	}
	return destination, nil
}

func renameAssetDirectory(stage, destination string, rename func(string, string) error, wait func(time.Duration)) error {
	var err error
	for attempt := 0; attempt < 6; attempt++ {
		err = rename(stage, destination)
		if err == nil || !errors.Is(err, os.ErrPermission) || attempt == 5 {
			return err
		}
		// Windows scanners can briefly hold extracted files open. Retry only a
		// permission/share denial, never remove or overwrite another cache.
		wait(50 * time.Millisecond * time.Duration(1<<attempt))
	}
	return err
}
