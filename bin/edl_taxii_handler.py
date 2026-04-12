"""
edl_taxii_handler.py
────────────────────────────────────────────────────────────────────────────
TAXII 2.1 source management and polling.

Supports:
  * CRUD for TAXII 2.1 source configurations
  * Manual and scheduled polling
  * STIX 2.1 indicator extraction (ipv4-addr, ipv6-addr, domain-name, url)
  * Cursor-based incremental fetching (added_after)
  * Per-source run state in edl_taxii_runs

Note: Credential storage uses XOR obfuscation as a stub.
Replace with Splunk storage/passwords for production.

Endpoints:
  GET    /edl_manager/taxii           -- list sources
  POST   /edl_manager/taxii           -- create source | action=poll_all
  GET    /edl_manager/taxii/<key>     -- get source
  POST   /edl_manager/taxii/<key>     -- update source | action=poll
  DELETE /edl_manager/taxii/<key>     -- delete source

v1.5.0: Migrated to PersistentServerConnectionApplication.
"""

import base64
import json
import logging
import re
import ssl
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone, timedelta
from edl_base_handler import SplunkRestHandler

logger      = logging.getLogger("edl_manager.taxii")
SOURCES_COL = "edl_taxii_sources"
RUNS_COL    = "edl_taxii_runs"
IOCS_COL    = "ioc_entries"

_KEY = 0x5A
def _obfuscate(s):   return base64.b64encode(bytes(c ^ _KEY for c in s.encode())).decode()
def _deobfuscate(s):
    try: return bytes(c ^ _KEY for c in base64.b64decode(s)).decode()
    except Exception: return ""
def _safe(doc): return {k: v for k, v in doc.items() if k != "password_encrypted"}


class TAXIIHandler(SplunkRestHandler):

    # ----------------------------------------------------------------- GET

    def _dispatch_GET(self, request):
        svc = self._get_service(request)
        key = self._path_part(request, 0)
        if key:
            doc = self._kv_get(svc, SOURCES_COL, key)
            if doc is None:
                return self._error(404, f"TAXII source '{key}' not found")
            return self._ok(_safe(doc))
        docs = self._kv_list(svc, SOURCES_COL, sort=[("name", 1)])
        return self._ok({"items": [_safe(d) for d in docs], "total_count": len(docs)})

    # ---------------------------------------------------------------- POST

    def _dispatch_POST(self, request):
        svc   = self._get_service(request)
        actor = self._get_actor(request)
        key   = self._path_part(request, 0)
        body  = self._parse_body(request)
        now   = self._now_iso()

        action = body.get("action", "")
        if action == "poll_all":
            return self._poll_all(svc, actor)
        if action == "poll":
            return self._poll_source(svc, actor, key or body.get("source_key", ""))

        if key:
            existing = self._kv_get(svc, SOURCES_COL, key)
            if existing is None:
                return self._error(404, f"Source '{key}' not found")
            if "password" in body:
                body["password_encrypted"] = _obfuscate(body.pop("password"))
            updated = {**existing, **body, "_key": key}
            self._kv_update(svc, SOURCES_COL, key, updated)
            return self._ok(_safe(updated))

        name = (body.get("name") or "").strip()
        if not name:
            return self._error(400, "'name' is required")
        if "password" in body:
            body["password_encrypted"] = _obfuscate(body.pop("password"))
        doc = {**body, "_key": str(uuid.uuid4()), "created_by": actor, "created_at": now,
               "last_polled_at": "", "last_poll_count": 0, "last_poll_status": "never_polled"}
        created = self._kv_create(svc, SOURCES_COL, doc)
        self._audit(svc, actor, "create", "taxii_source", created["_key"], name)
        return self._created(_safe(created))

    # -------------------------------------------------------------- DELETE

    def _dispatch_DELETE(self, request):
        svc = self._get_service(request)
        key = self._path_part(request, 0)
        if not key:
            return self._error(400, "DELETE requires a source key")
        doc = self._kv_get(svc, SOURCES_COL, key)
        if doc is None:
            return self._error(404, f"Source '{key}' not found")
        self._kv_delete(svc, SOURCES_COL, key)
        try:
            self._kv_delete(svc, RUNS_COL, doc.get("name", ""))
        except Exception:
            pass
        return self._ok({"deleted": True, "_key": key})

    # ---------------------------------------------------------------- Poll

    def _poll_all(self, svc, actor):
        sources = self._kv_list(svc, SOURCES_COL, query={"enabled": True})
        results = []
        for src in sources:
            r = self._poll_source(svc, actor, src["_key"])
            results.append(r.get("payload", "{}"))
        return self._ok({"polled": len(sources), "results": results})

    def _poll_source(self, svc, actor, source_key):
        if not source_key:
            return self._error(400, "source_key required for poll")
        src = self._kv_get(svc, SOURCES_COL, source_key)
        if not src:
            return self._error(404, f"Source '{source_key}' not found")

        name      = src.get("name", source_key)
        base_url  = src.get("taxii_server_url", "").rstrip("/")
        api_root  = src.get("api_root", "api/v21").strip("/")
        coll_id   = src.get("collection_id", "")
        username  = src.get("username", "")
        password  = _deobfuscate(src.get("password_encrypted", ""))
        policy    = src.get("default_policy", "default")
        list_type = src.get("default_list_type", "block")
        ttl       = src.get("default_ttl_hours")

        run_doc  = self._kv_get(svc, RUNS_COL, name) or {}
        cursor   = run_doc.get("cursor", "")
        endpoint = f"{base_url}/{api_root}/collections/{coll_id}/objects/"
        params   = "?match[type]=indicator"
        if cursor:
            params += f"&added_after={cursor}"

        now = self._now_iso()
        try:
            req = urllib.request.Request(endpoint + params)
            req.add_header("Accept", "application/taxii+json;version=2.1")
            if username:
                creds = base64.b64encode(f"{username}:{password}".encode()).decode()
                req.add_header("Authorization", f"Basic {creds}")
            ctx = ssl.create_default_context()
            with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
                data = json.loads(resp.read().decode())
        except Exception as exc:
            src.update(last_polled_at=now, last_poll_status="error")
            self._kv_update(svc, SOURCES_COL, source_key, src)
            return self._error(502, f"TAXII fetch failed: {exc}")

        indicators = [o for o in data.get("objects", []) if o.get("type") == "indicator"]
        existing   = {(d.get("type"), d.get("value"), d.get("list_type"))
                      for d in self._kv_list(svc, IOCS_COL)}
        batch      = []
        skipped    = 0

        for ind in indicators:
            for ioc_type, value in _parse_stix_pattern(ind.get("pattern", "")):
                if (ioc_type, value, list_type) in existing:
                    skipped += 1
                    continue
                stop_time = ""
                if ttl:
                    stop_time = (datetime.now(timezone.utc)
                                 + timedelta(hours=float(ttl))
                                 ).strftime("%Y-%m-%dT%H:%M:%SZ")
                batch.append({
                    "_key": str(uuid.uuid4()), "type": ioc_type, "value": value,
                    "list_type": list_type, "policy_names": [policy],
                    "status": "active", "source": f"taxii:{name}",
                    "source_ref": ind.get("id", ""), "stop_time": stop_time,
                    "description": "", "tags": [], "hit_count": 0,
                    "conflict_state": "none", "conflict_resolution": "",
                    "created_by": f"taxii:{name}", "created_at": now,
                    "last_modified_by": f"taxii:{name}", "last_modified_at": now,
                })

        inserted = 0
        for i in range(0, len(batch), 500):
            try:
                self._kv_batch_create(svc, IOCS_COL, batch[i:i + 500])
                inserted += min(500, len(batch) - i)
            except Exception as exc:
                logger.error("TAXII batch insert failed: %s", exc)

        run_update = {"_key": name, "source_name": name, "cursor": now,
                      "last_added": now, "objects_fetched": len(indicators), "errors": ""}
        try:
            if run_doc:
                self._kv_update(svc, RUNS_COL, name, run_update)
            else:
                self._kv_create(svc, RUNS_COL, run_update)
        except Exception:
            pass

        src.update(last_polled_at=now, last_poll_count=inserted, last_poll_status="ok")
        self._kv_update(svc, SOURCES_COL, source_key, src)
        self._audit(svc, actor, "poll", "taxii_source", source_key, name,
                    {"inserted": inserted, "skipped": skipped})
        return self._ok({"source": name, "inserted": inserted,
                         "skipped": skipped, "polled_at": now})


def _parse_stix_pattern(pattern):
    """Extract (edl_type, value) pairs from a STIX 2.1 indicator pattern."""
    OBJECT_MAP = {
        "ipv4-addr": "ip", "ipv6-addr": "ip",
        "domain-name": "domain", "url": "url",
    }
    results = []
    for match in re.finditer(r"\[([\w-]+):value\s*=\s*'([^']+)'\]", pattern):
        obj_type, value = match.group(1), match.group(2)
        if obj_type in OBJECT_MAP:
            results.append((OBJECT_MAP[obj_type], value))
    return results
