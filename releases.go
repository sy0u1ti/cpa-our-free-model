package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"runtime"
	"strings"
	"sync"
	"time"
)

const updateRegistryURL = "https://raw.githubusercontent.com/sy0u1ti/cpa-our-free-model/main/registry.json"

type releaseInfo struct {
	CurrentVersion string    `json:"currentVersion"`
	LatestVersion  string    `json:"latestVersion,omitempty"`
	Tag            string    `json:"tag,omitempty"`
	Platform       string    `json:"platform"`
	State          string    `json:"state"`
	Message        string    `json:"message"`
	ReleaseURL     string    `json:"releaseUrl,omitempty"`
	RegistryURL    string    `json:"registryUrl"`
	Archive        string    `json:"archive,omitempty"`
	ArchiveBytes   int64     `json:"archiveBytes,omitempty"`
	CheckedAt      time.Time `json:"checkedAt"`
}

type releaseCache struct {
	mu    sync.Mutex
	value releaseInfo
	until time.Time
}

func (p *plugin) checkRelease() releaseInfo {
	p.releases.mu.Lock()
	defer p.releases.mu.Unlock()
	if time.Now().Before(p.releases.until) {
		return p.releases.value
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	client := &http.Client{
		Timeout:       12 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	p.releases.value = fetchReleaseInfo(ctx, client, version, sourceDirty == "true", runtime.GOOS, runtime.GOARCH)
	p.releases.until = time.Now().Add(time.Minute)
	return p.releases.value
}

func fetchReleaseInfo(ctx context.Context, client updateHTTPClient, current string, dirty bool, goos, goarch string) releaseInfo {
	result := releaseInfo{
		CurrentVersion: current, Platform: goos + "/" + goarch, RegistryURL: updateRegistryURL, CheckedAt: time.Now().UTC(),
		State: "unavailable", Message: "无法读取正式版本，请稍后重试；这不代表已经是最新版。",
	}
	request, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/repos/sy0u1ti/cpa-our-free-model/releases/latest", nil)
	if err != nil {
		return result
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "cpa-our-free-model/"+current)
	response, err := client.Do(request)
	if err != nil {
		return result
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		result.State, result.Message = "unpublished", "仓库尚未发布正式安装包。一键更新需等待首个 Release，不能用源码提交冒充可安装版本。"
		return result
	}
	if response.StatusCode != http.StatusOK {
		return result
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 1024*1024+1))
	if err != nil || len(body) > 1024*1024 {
		return result
	}
	var release struct {
		Tag        string `json:"tag_name"`
		URL        string `json:"html_url"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
		Assets     []struct {
			Name  string `json:"name"`
			URL   string `json:"browser_download_url"`
			State string `json:"state"`
			Size  int64  `json:"size"`
		} `json:"assets"`
	}
	if json.Unmarshal(body, &release) != nil || release.Draft || release.Prerelease {
		return result
	}
	latest := strings.TrimPrefix(release.Tag, "v")
	if !versionPattern.MatchString(latest) || release.URL != sourceRepository+"/releases/tag/"+release.Tag {
		return result
	}
	result.LatestVersion, result.Tag, result.ReleaseURL = latest, release.Tag, release.URL
	if dirty || compareVersion(current, latest) > 0 {
		result.State, result.Message = "development", "当前为本地修改或较新的开发构建，已禁用一键覆盖。请先保存并核对源码。"
		return result
	}
	if current == latest {
		result.State, result.Message = "current", "当前运行版本与最新正式 Release 一致。"
		return result
	}
	archive := pluginID + "_" + latest + "_" + goos + "_" + goarch + ".zip"
	foundArchive, foundChecksums := false, false
	for _, asset := range release.Assets {
		if asset.Name != archive && asset.Name != "checksums.txt" {
			continue
		}
		if asset.State != "uploaded" || asset.Size <= 0 || asset.Size > 128*1024*1024 ||
			asset.URL != sourceRepository+"/releases/download/"+release.Tag+"/"+asset.Name {
			return result
		}
		if asset.Name == archive {
			if foundArchive {
				return result
			}
			foundArchive, result.ArchiveBytes = true, asset.Size
		} else {
			if foundChecksums || asset.Size > 64*1024 {
				return result
			}
			foundChecksums = true
		}
	}
	if !foundArchive || !foundChecksums {
		result.State, result.Message = "unpackaged", "此 Release 缺少当前平台的安装包或 checksums.txt，暂不能一键更新。"
		return result
	}
	result.Archive, result.State = archive, "available"
	result.Message = "有新的正式版本，可由 CPA 下载、校验并安装，无需服务器上的 Git、Go 或 C 编译器。"
	return result
}
