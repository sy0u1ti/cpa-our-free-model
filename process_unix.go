//go:build !windows

package main

import "os/exec"

func hideProcess(cmd *exec.Cmd) {}
