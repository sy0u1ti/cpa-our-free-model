package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const sourceRepository = "https://github.com/sy0u1ti/cpa-our-free-model"

var sourceRevision = "unknown"
var sourceDirty = "false"
var commitPattern = regexp.MustCompile(`^[a-f0-9]{40}$`)
var versionPattern = regexp.MustCompile(`^\d+\.\d+\.\d+$`)

type updateInfo struct {
	CurrentVersion string    `json:"currentVersion"`
	CurrentCommit  string    `json:"currentCommit"`
	LatestVersion  string    `json:"latestVersion,omitempty"`
	LatestCommit   string    `json:"latestCommit,omitempty"`
	State          string    `json:"state"`
	Message        string    `json:"message"`
	Repository     string    `json:"repository"`
	CheckedAt      time.Time `json:"checkedAt"`
}

type updateCache struct {
	mu    sync.Mutex
	value updateInfo
	until time.Time
}

type updateHTTPClient interface {
	Do(*http.Request) (*http.Response, error)
}

func (p *plugin) checkUpdates() updateInfo {
	p.updates.mu.Lock()
	defer p.updates.mu.Unlock()
	if time.Now().Before(p.updates.until) {
		return p.updates.value
	}
	client := &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	p.updates.value = fetchUpdateInfo(ctx, client, version, sourceRevision, sourceDirty == "true")
	ttl := 5 * time.Minute
	if p.updates.value.State == "unavailable" {
		ttl = time.Minute
	}
	p.updates.until = time.Now().Add(ttl)
	return p.updates.value
}

func readUpdateJSON(ctx context.Context, client updateHTTPClient, endpoint string, target any) error {
	request, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "cpa-our-free-model/"+version)
	// Public metadata only: no CPA key, cookies, GitHub token or executable code.
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return fmt.Errorf("metadata HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 256*1024+1))
	if err != nil || len(body) > 256*1024 {
		return fmt.Errorf("invalid metadata size")
	}
	return json.Unmarshal(body, target)
}

func fetchUpdateInfo(ctx context.Context, client updateHTTPClient, current, revision string, dirty bool) updateInfo {
	result := updateInfo{CurrentVersion: current, CurrentCommit: revision, Repository: sourceRepository, CheckedAt: time.Now().UTC(),
		State: "unavailable", Message: "无法检查 GitHub 更新，请稍后重试；这不代表已经是最新版。"}
	var commit struct {
		SHA string `json:"sha"`
	}
	if readUpdateJSON(ctx, client, "https://api.github.com/repos/sy0u1ti/cpa-our-free-model/commits/main", &commit) != nil || !commitPattern.MatchString(commit.SHA) {
		return result
	}
	var pkg struct{ Name, Version string }
	if readUpdateJSON(ctx, client, "https://raw.githubusercontent.com/sy0u1ti/cpa-our-free-model/"+commit.SHA+"/package.json", &pkg) != nil ||
		pkg.Name != "cpa-our-free-model" || !versionPattern.MatchString(pkg.Version) {
		return result
	}
	result.LatestVersion, result.LatestCommit = pkg.Version, commit.SHA
	if compareVersion(current, pkg.Version) > 0 || dirty {
		result.State, result.Message = "development", "当前是开发构建或本地修改版本；请核对源码后更新，不会自动覆盖。"
	} else if current != pkg.Version || commitPattern.MatchString(revision) && revision != commit.SHA {
		result.State, result.Message = "available", "仓库有更新，可在 CPA 服务器执行下方一条命令完成拉取、构建和安装。"
	} else if !commitPattern.MatchString(revision) {
		result.State, result.Message = "version-match", "版本号与仓库一致，但此构建没有提交记录，无法确认是否包含全部最新修复。"
	} else {
		result.State, result.Message = "current", "当前运行的插件与仓库 main 分支一致。"
	}
	return result
}

func compareVersion(a, b string) int {
	left, right := strings.Split(a, "."), strings.Split(b, ".")
	if len(left) != 3 || len(right) != 3 {
		return 0
	}
	for index := range left {
		x, _ := strconv.Atoi(left[index])
		y, _ := strconv.Atoi(right[index])
		if x < y {
			return -1
		}
		if x > y {
			return 1
		}
	}
	return 0
}
