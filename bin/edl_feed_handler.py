"""
edl_feed_handler.py
────────────────────────────────────────────────────────────────────────────
Firewall EDL feed endpoint.
ETag/304 caching, per-IP rate limiting, EDLToken auth, precedence resolution.

GET /edl_manager/feed

Query parameters:
  format            text (default) | json | csv
  type              ip | url | domain
  list_type         block | allow
  policy            policy name substring filter
  status            active (default) | inactive | all
  exclude_conflicts 1 to omit IOCs with conflict_state=conflict
  precedence        block_wins (default) | allow_wins

v1.5.0: Migrated to PersistentServerConnectionApplication.
"""

import csv
import hashlib
import io
import json
import logging
import os
from edl_base_handler import SplunkRestHandler
from edl_rate_limiter  import check_feed_rate_limit

logger = logging.getLogger("edl_manager.feed")

_ETAG_PATH = os.path.join(
    os.environ.get("SPLUNK_HOME", "/opt/splunk"),
    "etc", "apps", "edl_manager", "lookups", "edl_active_export.etag",
)
_CSV_PATH = os.path.join(
    os.environ.get("SPLUNK_HOME", "/opt/splunk"),
    "etc", "apps", "edl_manager", "lookups", "edl_active_export.csv",
)


class EDLFeedHandler(SplunkRestHandler):

    def _dispatch_GET(self, request):
        # Rate limit fires before auth
        client_ip = (request.get("connection", {}).get("src_ip")
                     or request.get("headers", {}).get("X-Forwarded-For", "127.0.0.1")
                     or "127.0.0.1")
        allowed, retry_after = check_feed_rate_limit(client_ip)
        if not allowed:
            return {
                "payload": json.dumps({"error": "Rate limit exceeded",
                                       "retry_after": int(retry_after) + 1}),
                "status":  429,
                "headers": {"Content-Type": "application/json",
                             "Retry-After": str(int(retry_after) + 1)},
            }

        service = self._get_service(request)
        tok_valid, tok_owner = self._check_token_auth(request)

        fmt           = (self._query_param(request, "format")   or "text").lower()
        ioc_type      = self._query_param(request, "type")
        list_type     = self._query_param(request, "list_type")
        policy_filter = self._query_param(request, "policy")
        status_filter = (self._query_param(request, "status")   or "active")
        excl_conf     = self._query_param(request, "exclude_conflicts") == "1"
        precedence    = (self._query_param(request, "precedence") or "block_wins")

        # Fast path: unfiltered text -> serve materialised CSV with ETag
        if (fmt == "text" and not ioc_type and not list_type
                and not policy_filter and not excl_conf
                and status_filter == "active"):
            return self._serve_csv(request)

        # Filtered path: live KV Store query
        kv_query = {}
        if ioc_type:                          kv_query["type"]      = ioc_type
        if list_type:                         kv_query["list_type"] = list_type
        if status_filter and status_filter != "all":
            kv_query["status"] = status_filter

        docs = self._kv_list(service, "ioc_entries", query=kv_query or None)
        now  = self._now_iso()

        live = []
        for d in docs:
            if self._compute_status(d.get("start_time"),
                                    d.get("stop_time"), d.get("status")) != "active":
                continue
            if excl_conf and d.get("conflict_state") == "conflict":
                continue
            if policy_filter and not any(
                policy_filter.lower() in (p or "").lower()
                for p in (d.get("policy_names") or [])
            ):
                continue
            live.append(d)

        # Precedence resolution when both block + allow present for same value
        if not list_type:
            winner = "block" if precedence == "block_wins" else "allow"
            groups = {}
            for d in live:
                groups.setdefault((d.get("type"), d.get("value")), set()).add(d.get("list_type"))
            live = [d for d in live
                    if len(groups.get((d.get("type"), d.get("value")), set())) == 1
                    or d.get("list_type") == winner]

        if fmt == "json":
            return self._ok({
                "count": len(live), "generated_at": now,
                "items": [{"value": d.get("value"), "type": d.get("type"),
                            "list_type": d.get("list_type"),
                            "policy_names": d.get("policy_names")}
                           for d in live],
            })
        if fmt == "csv":
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(["value", "type", "list_type", "policy_names"])
            for d in live:
                w.writerow([d.get("value",""), d.get("type",""), d.get("list_type",""),
                             ",".join(d.get("policy_names") or [])])
            return {"payload": buf.getvalue(), "status": 200,
                    "headers": {"Content-Type": "text/csv"}}

        # Default: plain text
        values  = [d.get("value","") for d in live if d.get("value")]
        return self._text_response(200, "\n".join(values) + "\n")

    def _serve_csv(self, request):
        """Fast path: materialised CSV with ETag/304 support."""
        if_none_match = (request.get("headers", {}).get("If-None-Match", "")
                         or request.get("headers", {}).get("if-none-match", ""))
        try:
            with open(_ETAG_PATH) as f:
                stored_etag = f.read().strip()
        except Exception:
            stored_etag = ""

        if if_none_match and stored_etag and if_none_match.strip('"') == stored_etag:
            return {"payload": "", "status": 304,
                    "headers": {"ETag": f'"{stored_etag}"',
                                "Cache-Control": "max-age=300, must-revalidate"}}
        try:
            with open(_CSV_PATH) as f:
                lines   = f.readlines()
                values  = [l.strip() for l in lines[1:] if l.strip()]
                content = "\n".join(values) + "\n"
                etag    = hashlib.sha256(content.encode()).hexdigest()[:16]
        except FileNotFoundError:
            content = ""
            etag    = hashlib.sha256(b"").hexdigest()[:16]
        try:
            with open(_ETAG_PATH, "w") as f:
                f.write(etag)
        except Exception:
            pass
        return {
            "payload": content,
            "status":  200,
            "headers": {"Content-Type": "text/plain",
                        "ETag": f'"{etag}"',
                        "Cache-Control": "max-age=300, must-revalidate"},
        }
