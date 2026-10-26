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
//go:embed service/package.json
//go:embed service/runner.mjs
//go:embed service/src/catalog.mjs
//go:embed service/src/console-tickets.mjs
//go:embed service/src/eac-provider.mjs
//go:embed service/upstream-eac.json
//go:embed service/vendor/CPA_LICENSE
//go:embed service/vendor/WEB_LICENSES.txt
//go:embed service/vendor/WEB_LICENSE_SOURCES.json
//go:embed service/vendor/YAML_LICENSE
//go:embed service/vendor/ofm/LICENSE
//go:embed service/vendor/ofm/UPSTREAM.json
//go:embed service/vendor/ofm/icon.svg
//go:embed service/vendor/ofm/package.json
//go:embed service/vendor/ofm/packages/standalone/README.md
//go:embed service/vendor/ofm/packages/standalone/channels/business.mjs
//go:embed service/vendor/ofm/packages/standalone/channels/contracts.mjs
//go:embed service/vendor/ofm/packages/standalone/channels/credentials.mjs
//go:embed service/vendor/ofm/packages/standalone/channels/images.mjs
//go:embed service/vendor/ofm/packages/standalone/channels/runtime.mjs
//go:embed service/vendor/ofm/packages/standalone/channels/worker.mjs
//go:embed service/vendor/ofm/packages/standalone/cli.mjs
//go:embed service/vendor/ofm/packages/standalone/client-terminal.mjs
//go:embed service/vendor/ofm/packages/standalone/eac.mjs
//go:embed service/vendor/ofm/packages/standalone/library.mjs
//go:embed service/vendor/ofm/packages/standalone/login-terminal.mjs
//go:embed service/vendor/ofm/packages/standalone/management.mjs
//go:embed service/vendor/ofm/packages/standalone/open-external.mjs
//go:embed service/vendor/ofm/packages/standalone/package.json
//go:embed service/vendor/ofm/packages/standalone/providers.mjs
//go:embed service/vendor/ofm/packages/standalone/routing.mjs
//go:embed service/vendor/ofm/packages/standalone/service.mjs
//go:embed service/vendor/ofm/packages/standalone/web/app.css
//go:embed service/vendor/ofm/packages/standalone/web/app.js
//go:embed service/vendor/ofm/packages/standalone/web/assets.json
//go:embed service/vendor/ofm/packages/standalone/web/channels-CwUJPBXI.js
//go:embed service/vendor/ofm/packages/standalone/web/index.html
//go:embed service/vendor/ofm/packages/standalone/web/models-CCoW-2uM.js
//go:embed service/vendor/ofm/packages/standalone/web/settings-CdBN6B3K.js
//go:embed service/vendor/ofm/packages/standalone/web/sliders-horizontal-DNbjUrIs.js
//go:embed service/vendor/ofm/packages/standalone/web/usage-JY1Fq3E5.js
//go:embed service/vendor/ofm/packages/standalone/web/visibility-data-9WWAmLOB.js
//go:embed service/vendor/ofm/packages/standalone/workbench.mjs
//go:embed service/vendor/ofm/scripts/standalone-third-party.txt
//go:embed service/vendor/ofm/src/adapter.js
//go:embed service/vendor/ofm/src/aggregate.js
//go:embed service/vendor/ofm/src/anthropic.js
//go:embed service/vendor/ofm/src/catalog.js
//go:embed service/vendor/ofm/src/chan-relay.js
//go:embed service/vendor/ofm/src/channel.js
//go:embed service/vendor/ofm/src/combos.js
//go:embed service/vendor/ofm/src/core/completion.js
//go:embed service/vendor/ofm/src/core/runtime.js
//go:embed service/vendor/ofm/src/core/stats.js
//go:embed service/vendor/ofm/src/deferred-response.js
//go:embed service/vendor/ofm/src/disclaimer.js
//go:embed service/vendor/ofm/src/eac-login.js
//go:embed service/vendor/ofm/src/eac-user.js
//go:embed service/vendor/ofm/src/eac.js
//go:embed service/vendor/ofm/src/effort.js
//go:embed service/vendor/ofm/src/egress.js
//go:embed service/vendor/ofm/src/engine-parts/win32-x64.000.part
//go:embed service/vendor/ofm/src/engine-parts/win32-x64.001.part
//go:embed service/vendor/ofm/src/engine-parts/win32-x64.002.part
//go:embed service/vendor/ofm/src/engine-parts/win32-x64.003.part
//go:embed service/vendor/ofm/src/engine-parts/win32-x64.004.part
//go:embed service/vendor/ofm/src/engine-parts/win32-x64.005.part
//go:embed service/vendor/ofm/src/engine-parts/win32-x64.006.part
//go:embed service/vendor/ofm/src/engine-parts/win32-x64.007.part
//go:embed service/vendor/ofm/src/engine-parts/win32-x64.008.part
//go:embed service/vendor/ofm/src/engine-payload.js
//go:embed service/vendor/ofm/src/failure.js
//go:embed service/vendor/ofm/src/feed.js
//go:embed service/vendor/ofm/src/forward.js
//go:embed service/vendor/ofm/src/gemini.js
//go:embed service/vendor/ofm/src/http.js
//go:embed service/vendor/ofm/src/image-pricing.js
//go:embed service/vendor/ofm/src/kilo.js
//go:embed service/vendor/ofm/src/local-optimize.js
//go:embed service/vendor/ofm/src/loopback-fetch.js
//go:embed service/vendor/ofm/src/magpie-engine.js
//go:embed service/vendor/ofm/src/magpie-models.js
//go:embed service/vendor/ofm/src/magpie-policy.js
//go:embed service/vendor/ofm/src/messages.js
//go:embed service/vendor/ofm/src/model-test.js
//go:embed service/vendor/ofm/src/open-external.js
//go:embed service/vendor/ofm/src/picks.js
//go:embed service/vendor/ofm/src/probe.js
//go:embed service/vendor/ofm/src/providers/index.js
//go:embed service/vendor/ofm/src/providers/registry.json
//go:embed service/vendor/ofm/src/push.js
//go:embed service/vendor/ofm/src/recovery.js
//go:embed service/vendor/ofm/src/reload.js
//go:embed service/vendor/ofm/src/route/classify.js
//go:embed service/vendor/ofm/src/sponsor.css
//go:embed service/vendor/ofm/src/sponsor.js
//go:embed service/vendor/ofm/src/store.js
//go:embed service/vendor/ofm/src/stream.js
//go:embed service/vendor/ofm/src/subscription-adapter.js
//go:embed service/vendor/ofm/src/subscription-completion.js
//go:embed service/vendor/ofm/src/subscriptions.js
//go:embed service/vendor/ofm/src/token-saver.js
//go:embed service/vendor/ofm/src/token-saver/index.js
//go:embed service/vendor/ofm/src/token-saver/inject.js
//go:embed service/vendor/ofm/src/token-saver/prompts.js
//go:embed service/vendor/ofm/src/token-saver/rtk/applyFilter.js
//go:embed service/vendor/ofm/src/token-saver/rtk/autodetect.js
//go:embed service/vendor/ofm/src/token-saver/rtk/constants.js
//go:embed service/vendor/ofm/src/token-saver/rtk/filters/buildOutput.js
//go:embed service/vendor/ofm/src/token-saver/rtk/filters/dedupLog.js
//go:embed service/vendor/ofm/src/token-saver/rtk/filters/find.js
//go:embed service/vendor/ofm/src/token-saver/rtk/filters/gitDiff.js
//go:embed service/vendor/ofm/src/token-saver/rtk/filters/gitLog.js
//go:embed service/vendor/ofm/src/token-saver/rtk/filters/gitStatus.js
//go:embed service/vendor/ofm/src/token-saver/rtk/filters/grep.js
//go:embed service/vendor/ofm/src/token-saver/rtk/filters/ls.js
//go:embed service/vendor/ofm/src/token-saver/rtk/filters/readNumbered.js
//go:embed service/vendor/ofm/src/token-saver/rtk/filters/searchList.js
//go:embed service/vendor/ofm/src/token-saver/rtk/filters/smartTruncate.js
//go:embed service/vendor/ofm/src/token-saver/rtk/filters/tree.js
//go:embed service/vendor/ofm/src/token-saver/rtk/hitLine.js
//go:embed service/vendor/ofm/src/token-saver/rtk/index.js
//go:embed service/vendor/ofm/src/token-saver/rtk/registry.js
//go:embed service/vendor/ofm/src/trust.js
//go:embed service/vendor/ofm/src/updater.js
//go:embed service/vendor/ofm/src/upstream.js
//go:embed service/vendor/ofm/vendor/channel-pack/LICENSE
//go:embed service/vendor/ofm/vendor/channel-pack/NOTICE.md
//go:embed service/vendor/ofm/vendor/channel-pack/qoder-auth-wasm.wasm
//go:embed service/vendor/ofm/vendor/magpie/LICENSE
//go:embed service/vendor/ofm/vendor/magpie/NOTICE.md
//go:embed service/vendor/ofm/vendor/magpie/engine.json
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

//go:embed web/engine-bridge.js
var engineBridgeScript []byte

//go:embed web/engine-workspace.css
var engineWorkspaceStyle []byte

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
