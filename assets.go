package main

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

//go:embed all:service
var serviceAssets embed.FS

//go:embed web/index.html
var managementPage []byte

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
		for part := filepath.Join(directory, filepath.FromSlash(rel)); ; part = filepath.Dir(part) {
			info, err := os.Lstat(part)
			if err != nil || info.Mode()&os.ModeSymlink != 0 {
				return false
			}
			if part == directory {
				break
			}
		}
		expected, _ := serviceAssets.ReadFile(name)
		actual, err := os.ReadFile(filepath.Join(directory, filepath.FromSlash(rel)))
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
	if err := os.Rename(stage, destination); err != nil && !verifyAssets(destination, files) {
		return "", fmt.Errorf("install embedded service: %w", err)
	}
	return destination, nil
}
