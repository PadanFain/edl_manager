"""
edl_conflict_handler.py
────────────────────────────────────────────────────────────────────────────
Allow/block conflict management handler.

A conflict exists when the same (type, value) pair appears on both a block
list and an allow list simultaneously. This handler:
  * Lists open/resolved conflicts
  * Provides resolution: block_wins, allow_wins, manual (keep both)
  * Updates conflict_state on the affected IOC documents
  * Runs the conflict scan on demand

Endpoints:
  GET    /edl_manager/conflicts           -- list conflicts
  GET    /edl_manager/conflicts/<key>     -- single conflict detail
  POST   /edl_manager/conflicts/<key>     -- resolve conflict
  POST   /edl_manager/conflicts           -- action=scan (full rescan)

v1.5.0: Migrated to PersistentServerConnectionApplication.
"""

import logging
import uuid
from edl_base_handler import SplunkRestHandler

logger    = logging.getLogger("edl_manager.conflict")
COLL_CONF = "edl_conflicts"
COLL_IOCS = "ioc_entries"


class ConflictHandler(SplunkRestHandler):

    def _dispatch_GET(self, request):
        service = self._get_service(request)
        key = self._path_part(request, 0)
        if key:
            doc = self._kv_get(service, COLL_CONF, key)
            if not doc:
                return self._error(404, f"Conflict '{key}' not found")
            return self._ok(self._enrich_conflict(service, doc))

        state_f = self._query_param(request, "state", "open")
        query   = {"state": state_f} if state_f and state_f != "all" else {}
        docs    = self._kv_list(service, COLL_CONF,
                                query=query if query else None,
                                sort=[("detected_at", -1)])
        return self._ok({"items": [self._enrich_conflict(service, d) for d in docs],
                         "total_count": len(docs)})

    def _dispatch_POST(self, request):
        service = self._get_service(request)
        key     = self._path_part(request, 0)
        body    = self._parse_body(request)
        actor   = self._get_actor(request)

        if not key:
            if body.get("action") == "scan":
                return self._run_full_scan(service, actor)
            return self._error(400, "POST to /conflicts requires a key or action=scan")
        return self._resolve_conflict(service, actor, key, body)

    def _resolve_conflict(self, service, actor, key, body):
        conflict = self._kv_get(service, COLL_CONF, key)
        if not conflict:
            return self._error(404, f"Conflict '{key}' not found")
        if conflict.get("state") == "resolved":
            return self._error(409, "Conflict is already resolved")

        resolution = (body.get("resolution") or "").strip().lower()
        if resolution not in ("block_wins", "allow_wins", "manual"):
            return self._error(400, "'resolution' must be block_wins, allow_wins, or manual")

        now       = self._now_iso()
        block_key = conflict.get("block_key")
        allow_key = conflict.get("allow_key")

        if resolution == "block_wins":
            self._disable_ioc(service, allow_key, actor, now)
        elif resolution == "allow_wins":
            self._disable_ioc(service, block_key, actor, now)

        for k in (block_key, allow_key):
            try:
                doc = self._kv_get(service, COLL_IOCS, k)
                if doc:
                    doc["conflict_state"]      = "resolved"
                    doc["conflict_resolution"] = resolution
                    doc["last_modified_by"]    = actor
                    doc["last_modified_at"]    = now
                    self._kv_update(service, COLL_IOCS, k, doc)
            except Exception as exc:
                logger.warning("Could not update conflict_state on %s: %s", k, exc)

        conflict["state"]       = "resolved"
        conflict["resolution"]  = resolution
        conflict["resolved_by"] = actor
        conflict["resolved_at"] = now
        self._kv_update(service, COLL_CONF, key, conflict)
        self._audit(service, actor, "update", "conflict", key,
                    f"{conflict.get('type')}:{conflict.get('value')}",
                    {"resolution": resolution})
        return self._ok({**conflict, "state": "resolved"})

    def _disable_ioc(self, service, ioc_key, actor, now):
        if not ioc_key:
            return
        doc = self._kv_get(service, COLL_IOCS, ioc_key)
        if doc:
            doc["status"]           = "inactive"
            doc["last_modified_by"] = actor
            doc["last_modified_at"] = now
            self._kv_update(service, COLL_IOCS, ioc_key, doc)

    def _run_full_scan(self, service, actor):
        docs  = self._kv_list(service, COLL_IOCS, query={"status": "active"})
        now   = self._now_iso()
        groups = {}
        for doc in docs:
            k = (doc.get("type"), doc.get("value"))
            groups.setdefault(k, []).append(doc)

        new_conflicts = 0
        for (ioc_type, value), entries in groups.items():
            list_types = {e.get("list_type") for e in entries}
            if "block" not in list_types or "allow" not in list_types:
                continue
            existing = self._kv_list(service, COLL_CONF,
                                     query={"type": ioc_type, "value": value, "state": "open"},
                                     limit=1)
            if existing:
                continue
            block_key = next((e["_key"] for e in entries if e.get("list_type") == "block"), "")
            allow_key = next((e["_key"] for e in entries if e.get("list_type") == "allow"), "")
            self._kv_create(service, COLL_CONF, {
                "_key": str(uuid.uuid4()), "type": ioc_type, "value": value,
                "block_key": block_key, "allow_key": allow_key,
                "state": "open", "resolution": "pending", "detected_at": now,
            })
            for k in (block_key, allow_key):
                if k:
                    try:
                        doc = self._kv_get(service, COLL_IOCS, k)
                        if doc:
                            doc["conflict_state"] = "conflict"
                            self._kv_update(service, COLL_IOCS, k, doc)
                    except Exception:
                        pass
            new_conflicts += 1

        self._audit(service, actor, "update", "conflict", "scan",
                    f"Scan found {new_conflicts} new conflicts")
        return self._ok({"scanned": len(docs),
                         "new_conflicts": new_conflicts, "scanned_at": now})

    def _enrich_conflict(self, service, doc):
        for side in ("block", "allow"):
            ioc_key = doc.get(f"{side}_key")
            if ioc_key:
                ioc = self._kv_get(service, COLL_IOCS, ioc_key)
                if ioc:
                    doc[f"{side}_ioc"] = {
                        "value": ioc.get("value"), "type": ioc.get("type"),
                        "list_type": ioc.get("list_type"), "status": ioc.get("status"),
                        "policy_names": ioc.get("policy_names"), "source": ioc.get("source"),
                    }
        return doc
