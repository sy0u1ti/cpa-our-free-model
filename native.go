package main

/*
#include <stdint.h>
#include <stdlib.h>
typedef struct { void* ptr; size_t len; } cliproxy_buffer;
typedef int (*cliproxy_host_call_fn)(void*, const char*, const uint8_t*, size_t, cliproxy_buffer*);
typedef void (*cliproxy_host_free_fn)(void*, size_t);
typedef struct {
    uint32_t abi_version;
    void* host_ctx;
    cliproxy_host_call_fn call;
    cliproxy_host_free_fn free_buffer;
} cliproxy_host_api;
typedef int (*cliproxy_plugin_call_fn)(char*, uint8_t*, size_t, cliproxy_buffer*);
typedef void (*cliproxy_plugin_free_fn)(void*, size_t);
typedef void (*cliproxy_plugin_shutdown_fn)(void);
typedef struct {
    uint32_t abi_version;
    cliproxy_plugin_call_fn call;
    cliproxy_plugin_free_fn free_buffer;
    cliproxy_plugin_shutdown_fn shutdown;
} cliproxy_plugin_api;
extern int cliproxyPluginCall(char*, uint8_t*, size_t, cliproxy_buffer*);
extern void cliproxyPluginFree(void*, size_t);
extern void cliproxyPluginShutdown(void);
static cliproxy_host_api stored_host;
static void set_host(const cliproxy_host_api* host) { stored_host = *host; }
static int call_host(const char* method, const uint8_t* request, size_t length, cliproxy_buffer* response) {
    if (!stored_host.call) return 1;
    return stored_host.call(stored_host.host_ctx, method, request, length, response);
}
static void free_host(cliproxy_buffer buffer) {
    if (buffer.ptr && stored_host.free_buffer) stored_host.free_buffer(buffer.ptr, buffer.len);
}
*/
import "C"

import (
	"encoding/json"
	"errors"
	"fmt"
	"unsafe"
)

var nativePlugin = newPlugin(callNativeHost)

func main() {}

//export cliproxy_plugin_init
func cliproxy_plugin_init(host *C.cliproxy_host_api, api *C.cliproxy_plugin_api) C.int {
	if host == nil || api == nil || host.abi_version != 1 {
		return 1
	}
	C.set_host(host)
	api.abi_version = 1
	api.call = C.cliproxy_plugin_call_fn(C.cliproxyPluginCall)
	api.free_buffer = C.cliproxy_plugin_free_fn(C.cliproxyPluginFree)
	api.shutdown = C.cliproxy_plugin_shutdown_fn(C.cliproxyPluginShutdown)
	return 0
}

//export cliproxyPluginCall
func cliproxyPluginCall(method *C.char, request *C.uint8_t, length C.size_t, response *C.cliproxy_buffer) (code C.int) {
	if response == nil {
		return 1
	}
	response.ptr, response.len = nil, 0
	defer func() {
		if recover() != nil {
			writeNativeError(response, problem(500, "plugin_error", "Our Free Model plugin failed internally"))
			code = 1
		}
	}()
	if method == nil || length > 64*1024*1024 || request == nil && length != 0 {
		writeNativeError(response, problem(400, "invalid_request", "Invalid or oversized native plugin request"))
		return 1
	}
	raw := C.GoBytes(unsafe.Pointer(request), C.int(length))
	result, err := nativePlugin.Handle(C.GoString(method), raw)
	if err != nil {
		writeNativeError(response, err)
		return 1
	}
	encoded, err := encodeResult(result)
	if err != nil {
		writeNativeError(response, err)
		return 1
	}
	writeNative(response, encoded)
	return 0
}

//export cliproxyPluginFree
func cliproxyPluginFree(ptr unsafe.Pointer, length C.size_t) {
	if ptr != nil {
		C.free(ptr)
	}
}

//export cliproxyPluginShutdown
func cliproxyPluginShutdown() { nativePlugin.Close() }

func writeNative(response *C.cliproxy_buffer, raw []byte) {
	response.ptr = C.CBytes(raw)
	response.len = C.size_t(len(raw))
}

func writeNativeError(response *C.cliproxy_buffer, err error) {
	failure := &rpcError{Code: "plugin_error", Message: err.Error(), HTTPStatus: 502}
	var known *rpcError
	if errors.As(err, &known) {
		failure = known
	}
	raw, _ := json.Marshal(envelope{Error: failure})
	writeNative(response, raw)
}

func callNativeHost(method string, request any, result any) error {
	raw, err := json.Marshal(request)
	if err != nil {
		return err
	}
	cMethod := C.CString(method)
	cRequest := C.CBytes(raw)
	defer C.free(unsafe.Pointer(cMethod))
	defer C.free(cRequest)
	var response C.cliproxy_buffer
	code := C.call_host(cMethod, (*C.uint8_t)(cRequest), C.size_t(len(raw)), &response)
	defer C.free_host(response)
	if response.ptr == nil || response.len > 64*1024*1024 {
		return fmt.Errorf("CPA host callback %s returned an invalid response", method)
	}
	var reply envelope
	if err := json.Unmarshal(C.GoBytes(response.ptr, C.int(response.len)), &reply); err != nil {
		return fmt.Errorf("CPA host callback %s returned invalid JSON", method)
	}
	if !reply.OK || code != 0 {
		// Host error text may contain credentials or upstream response bodies.
		return fmt.Errorf("CPA host callback %s failed or was cancelled", method)
	}
	if result != nil {
		return json.Unmarshal(reply.Result, result)
	}
	return nil
}
