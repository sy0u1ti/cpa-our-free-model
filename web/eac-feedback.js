(() => {
  'use strict';
  const reasons = {
    'no-lane': 'EAC 渠道尚未准备好；这不是网关网络故障。请检查 auto-install-eac / eac-source-dir 与来源状态。',
    'eac-disabled': 'EAC 来源未启用。请启用 auto-install-eac 或配置可信的 eac-source-dir，再重新打开控制台。',
    'eac-loading': 'EAC 来源正在准备，请等待完成后再登录。',
    'eac-source-failed': 'EAC 来源加载失败。请检查来源下载网络、缓存校验或源码路径；不是授权网关不可达。',
    'eac-unavailable': 'EAC 来源已加载，但没有可用渠道。请检查来源配置，不需要反复重新授权。',
    unreachable: '授权网关暂不可达，请检查 CPA 服务器的网络后重试。',
    'gateway-status': '授权网关应答异常，请稍后重试。',
    malformed: '授权网关返回的数据格式异常，请稍后重试。',
    'not-writable': '授权已完成，但无法写入 CPA 私有数据目录。请检查目录权限和磁盘空间。',
    'bad-link': '授权链接无效，请重新发起登录。',
    cancelled: '此次授权操作已取消。',
    timeout: '请求超时，请检查 CPA 服务器或授权网关后重试。',
  };
  function reason(error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return reasons.timeout;
    const code = String(error?.message ?? error ?? '');
    if (Object.hasOwn(reasons, code)) return reasons[code];
    if (/^gateway-http-\d{3}$/.test(code)) return '授权网关返回 HTTP ' + code.slice(-3) + '，请检查服务状态。';
    return 'EAC 操作未完成，请检查插件状态或重试；尚不能判定为网络故障。';
  }
  window.ofmEacFeedback = Object.freeze({ reason });
})();
