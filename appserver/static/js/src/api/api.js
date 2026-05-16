/**
 * api/api.js — EDL Manager v1.5.0
 *
 * Unified API client. Uses @splunk/splunk-utils/fetch defaultFetchInit for
 * auth (official SUIT pattern — design decision #12). Falls back to manual
 * X-Splunk-Form-Key construction if splunk-utils is unavailable.
 *
 * All calls return { data, error } — never throw.
 */

let _fetchInit = null;

function getFetchInit() {
  if (_fetchInit !== null) return _fetchInit;
  try {
    const { defaultFetchInit } = require('@splunk/splunk-utils/fetch');
    _fetchInit = defaultFetchInit;
  } catch (_) {
    _fetchInit = () => {
      const token = document.cookie
        .split('; ')
        .find(c => c.startsWith('splunkweb_csrf_token_'))
        ?.split('=')[1] || '';
      return {
        credentials: 'include',
        headers: {
          'Content-Type':      'application/json',
          'X-Splunk-Form-Key': token,
          'X-Requested-With':  'XMLHttpRequest',
        },
      };
    };
  }
  return _fetchInit;
}

function getBase() {
  const loc   = window.location;
  const match = loc.pathname.match(/^(\/[a-z]{2}-[A-Z]{2}\/)/);
  const pfx   = match ? match[1] : '/en-US/';
  return `${loc.protocol}//${loc.host}${pfx}splunkd/servicesNS/nobody/edl_manager/edl_manager`;
}

async function request(method, path, params, body) {
  try {
    let url = `${getBase()}${path}`;
    if (params && Object.keys(params).length) {
      const qs = new URLSearchParams(
        Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== '' && v != null)
        )
      ).toString();
      if (qs) url += `?${qs}`;
    }
    const init = getFetchInit()();
    const opts = { ...init, method, headers: { ...init.headers, 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res  = await fetch(url, opts);
    const ct   = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) return { data: null, error: data?.error || `HTTP ${res.status}` };
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message || 'Network error' };
  }
}

const g  = (path, p)    => request('GET',    path, p,         undefined);
const po = (path, b, p) => request('POST',   path, p,         b);
const de = (path, p)    => request('DELETE', path, p,         undefined);

const api = {
  iocs: {
    list:   p          => g('/iocs', p),
    get:    k          => g(`/iocs/${k}`),
    create: d          => po('/iocs', d),
    update: (k, d)     => po(`/iocs/${k}`, d),
    delete: k          => de(`/iocs/${k}`),
    bulk:   (a, ks, x) => po('/iocs', { action: a, keys: ks, ...x }),
  },
  policies: {
    list:   p      => g('/policies', p),
    get:    k      => g(`/policies/${k}`),
    create: d      => po('/policies', d),
    update: (k, d) => po(`/policies/${k}`, d),
    delete: k      => de(`/policies/${k}`),
  },
  conflicts: {
    list:    p      => g('/conflicts', p),
    get:     k      => g(`/conflicts/${k}`),
    resolve: (k, d) => po(`/conflicts/${k}`, d),
  },
  tokens: {
    list:   p      => g('/tokens', p),
    get:    k      => g(`/tokens/${k}`),
    create: d      => po('/tokens', d),
    revoke: k      => po(`/tokens/${k}`, { action: 'revoke' }),
    delete: k      => de(`/tokens/${k}`),
  },
  audit: {
    list: p => g('/audit', p),
  },
  taxii: {
    list:   p      => g('/taxii', p),
    get:    k      => g(`/taxii/${k}`),
    create: d      => po('/taxii', d),
    update: (k, d) => po(`/taxii/${k}`, d),
    delete: k      => de(`/taxii/${k}`),
    poll:   k      => po(`/taxii/${k}`, { action: 'poll' }),
  },
  feed: {
    url: (type, listType, fmt = 'text') =>
      `${getBase()}/feed?type=${type}&list_type=${listType}&format=${fmt}`,
  },
  stats:     { get: ()  => g('/stats') },
  geo:       { get: p   => g('/geo', p) },
  campaigns: { list: p  => g('/campaigns', p), get: k => g(`/campaigns/${k}`) },
  export:    { download: p => g('/export', p) },
  import:    { submit:   d => po('/import', d) },
};

export default api;
