import { effortsFor } from '../vendor/ofm/src/effort.js';

export function modelRows(service) {
  if (service.runtime.state().settings.enabled === false) return [];
  const allowed = new Set(service.runtime.publicModelRows().map(row => row.id));
  return service.runtime.catalog.filter(row => allowed.has(row.id)).map(row => {
    const raw = row.reasoning?.efforts ?? effortsFor(row);
    const efforts = Array.isArray(raw) ? raw.map(value => typeof value === 'string' ? value : value.id)
      .filter(value => typeof value === 'string' && /^[a-z][a-z0-9_-]*$/i.test(value)) : [];
    return {
      id: row.id, name: row.name || row.id,
      context_window: row.contextWindow ?? row.context_window ?? 0,
      max_tokens: row.maxOutput ?? row.max_tokens ?? 0,
      input: Array.isArray(row.input) ? row.input : row.vision ? ['text', 'image'] : ['text'],
      efforts: [...new Set(efforts)],
    };
  });
}

export function normalizeBody(body, row, suffix) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid chat request');
  const next = { ...body, model: row.id };
  if (next.max_tokens === undefined && Number.isFinite(next.max_completion_tokens)) next.max_tokens = next.max_completion_tokens;
  let effort = suffix ?? next.reasoning_effort ?? next.reasoning?.effort;
  if (row.efforts.includes('balanced')) {
    effort = ({ minimal: 'light', low: 'light', medium: 'balanced', high: 'deep', xhigh: 'deep' })[effort] ?? effort;
  } else if (effort === 'none' || effort === 'disabled') {
    effort = row.efforts.includes('off') ? 'off' : effort;
  }
  if (effort !== undefined) {
    if (row.efforts.length && !row.efforts.includes(effort)) throw new Error('Unsupported reasoning effort for this model');
    next.reasoning_effort = effort;
  }
  return next;
}

export async function admitModel(service, id) {
  if (service.runtime.state().settings.enabled === false) return false;
  if (service.channels.handles(id)) {
    const slash = id.indexOf('/');
    const provider = id.slice(0, slash);
    const model = id.slice(slash + 1);
    const [models, accounts] = await Promise.all([
      service.channels.rpc({ method: 'model.list', payload: { provider } }),
      service.channels.rpc({ method: 'account.list', payload: { provider } }),
    ]);
    return models.ok === true && accounts.ok === true &&
      accounts.value.accounts.some(account => account.enabled !== false) &&
      models.value.models.some(row => row.id === model && !row.disabled && !row.dead);
  }
  return service.runtime.publicModelRows().some(row => row.id === id);
}
