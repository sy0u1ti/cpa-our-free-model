(() => {
  'use strict';
  // Messages live in i18n.js under `eac.<code>`. Only these known codes are
  // looked up, so an arbitrary upstream error string can never select an
  // unrelated catalog entry or be echoed to the user.
  const reasons = new Set([
    'no-lane', 'eac-disabled', 'eac-loading', 'eac-source-failed', 'eac-unavailable', 'unreachable',
    'gateway-status', 'malformed', 'not-writable', 'bad-link', 'cancelled', 'timeout',
  ]);
  function reason(error) {
    const { t } = window.ofmI18n;
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return t('eac.timeout');
    const code = String(error?.message ?? error ?? '');
    if (reasons.has(code)) return t('eac.' + code);
    if (/^gateway-http-\d{3}$/.test(code)) return t('eac.gatewayHTTP', { status: code.slice(-3) });
    return t('eac.unknown');
  }
  window.ofmEacFeedback = Object.freeze({ reason });
})();
