# EDL Manager — Changelog

## v1.5.0

### Python REST Handler Migration (PSCA)
All 14 concrete handlers + base class migrated from `splunk.rest.BaseRestHandler`
(Splunk's internal class) to `PersistentServerConnectionApplication` — the officially
documented and AppInspect-compliant public API.

- `edl_base_handler.py` rewritten — `SplunkRestHandler = make_handler_base()` combines
  `EDLBaseHandler` with PSCA, wrapped in try/except for test environments without Splunk
- `edl_feed_handler.py` rewritten — all `self.response.*` replaced with return dicts
- `edl_ioc_handler.py` — `_apply_policy_ttl()` now takes `service` not `session_key`
- `edl_geo_handler.py` — oneshot SPL search uses `service.post()` not `simpleRequest()`
- All other 10 handlers — mechanical migration (import, class, method signatures)

AppInspect checks now pass. App eligible for Splunk Cloud submission and Splunkbase.

---

## v1.4.0

### Critical Bug Fix — | edl_feed returned zero results
`commands.conf` was missing two settings required by the Splunk SDK `service` property:
- `chunked = true` — enables SCP v2, required for auth token injection
- `requires_srinfo = true` — passes search results info file, required for self.service

Without these, `self.service` returns `None` and KV Store reads silently fail.
Verified against `splunk-sdk-python` source: `splunklib/searchcommands/search_command.py`.

Also added `service is None` guard in `edl_feed.py` with a clear error message.

### Frontend Auth
Switched `api.js` to `defaultFetchInit` from `@splunk/splunk-utils/fetch`.
Added `@splunk/splunk-utils` to `package.json`.

---

## v1.3.0

### | edl_feed SPL Generating Command
New `edl_feed.py` — custom generating command using `splunklib.searchcommands.GeneratingCommand`.
Works on Splunk Cloud and Enterprise.

New `commands.conf` registration. New `FeedManager` React component.
6 per-type materialised CSV feed files generated every 5 minutes.

---

## v1.2.2

### Splunk Cloud Compatibility
- `api.js` rewritten to use native KV Store REST API
- `macros.conf` rewritten to use `inputlookup`/`outputlookup` only
- `restmap.conf.cloud` added

---

## v1.2.1

- Export-current-filter button on IOC table toolbar

---

## v1.2.0

- Attack Map (D3 globe), Campaign Report, Geo Handler, Campaign Handler, Rate Limiter
- Policy TTL inheritance, ETag sidecar fix

---

## v1.1.0

- Token Manager, TAXII 2.1 Integration, Conflict Manager, SPL Macros
- Hit Tracking, ETag/304 caching, conflict-aware feed
- New collections: edl_taxii_sources, edl_taxii_runs, edl_tokens, edl_conflicts

---

## v1.0.0 — Initial Release

- IOC CRUD, Policy management, Bulk import, EDL feed endpoint
- Scheduled export, Auto-expiry, Audit log, Dashboard, Bulk ops
- Collections: ioc_entries, edl_policies, edl_audit_log
