"""
edl_ioc_handler.py
────────────────────────────────────────────────────────────────────────────
REST handler for IOC CRUD + bulk operations.

Endpoints:
  GET    /edl_manager/iocs              -- list (paginated, filtered)
  GET    /edl_manager/iocs/<key>        -- single IOC
  POST   /edl_manager/iocs              -- create | bulk action
  POST   /edl_manager/iocs/<key>        -- update
  DELETE /edl_manager/iocs/<key>        -- delete

v1.5.0: Migrated to PersistentServerConnectionApplication.
All sub-methods now receive (service, actor, request) explicitly.
"""

import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from edl_base_handler import SplunkRestHandler

logger     = logging.getLogger("edl_manager.ioc")
COLLECTION = "ioc_entries"

_ETAG_PATH = os.path.join(
    os.environ.get("SPLUNK_HOME", "/opt/splunk"),
    "etc", "apps", "edl_manager", "lookups", "edl_active_export.etag",
)


def _invalidate_etag():
    try:
        if os.path.exists(_ETAG_PATH):
            os.remove(_ETAG_PATH)
    except Exception as exc:
        logger.warning("Could not invalidate ETag: %s", exc)


class IOCHandler(SplunkRestHandler):

    # ----------------------------------------------------------------- GET

    def _dispatch_GET(self, request):
        service = self._get_service(request)
        key = self._path_part(request, 0)
        if key:
            doc = self._kv_get(service, COLLECTION, key)
            if doc is None:
                return self._error(404, f"IOC '{key}' not found")
            return self._ok(self._enrich(doc))
        return self._list_iocs(request, service)

    def _list_iocs(self, request, service):
        query = {}
        for field, param in [("type","type"),("list_type","list_type"),
                              ("status","status"),("conflict_state","conflict_state")]:
            v = self._query_param(request, param)
            if v: query[field] = v
        if self._query_param(request, "policy"):
            query["policy_names"] = {"$regex": self._query_param(request, "policy")}
        if self._query_param(request, "source"):
            query["source"] = {"$regex": f"(?i)^{self._query_param(request, 'source')}"}
        if self._query_param(request, "search"):
            query["value"] = {"$regex": f"(?i){self._query_param(request, 'search')}"}

        expiry_warning = self._query_param(request, "expiry_warning")
        has_hits  = self._query_param(request, "has_hits") == "1"
        zero_hits = self._query_param(request, "zero_hits") == "1"

        try:
            page      = max(1, int(self._query_param(request, "page", 1) or 1))
            page_size = min(500, max(1, int(self._query_param(request, "page_size", 50) or 50)))
        except (ValueError, TypeError):
            page, page_size = 1, 50

        sort_field = self._query_param(request, "sort_field", "created_at")
        sort_dir   = 1 if self._query_param(request, "sort_dir", "desc") == "asc" else -1
        all_docs   = self._kv_list(service, COLLECTION,
                                   query=query if query else None,
                                   sort=[(sort_field, sort_dir)])

        now_iso   = self._now_iso()
        in24h_iso = (datetime.now(timezone.utc) + timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")

        enriched = []
        for doc in all_docs:
            doc = self._enrich(doc)
            if expiry_warning == "1":
                stop = doc.get("stop_time", "")
                if not (stop and now_iso < stop <= in24h_iso):
                    continue
            if has_hits  and not int(doc.get("hit_count", 0) or 0): continue
            if zero_hits and     int(doc.get("hit_count", 0) or 0): continue
            enriched.append(doc)

        skip         = (page - 1) * page_size
        total        = len(enriched)
        page_results = enriched[skip: skip + page_size]
        return self._ok({"items": page_results, "total_count": total,
                         "page": page, "page_size": page_size,
                         "total_pages": max(1, (total + page_size - 1) // page_size)})

    # ---------------------------------------------------------------- POST

    def _dispatch_POST(self, request):
        service = self._get_service(request)
        actor   = self._get_actor(request)
        key     = self._path_part(request, 0)
        body    = self._parse_body(request)
        action  = body.get("action", "")
        if action.startswith("bulk_"):
            return self._handle_bulk(request, service, actor, action, body)
        if key:
            return self._update_ioc(service, actor, key, body)
        return self._create_ioc(service, actor, body)

    def _create_ioc(self, service, actor, body):
        cleaned, errors = self._validate_ioc(body)
        if errors:
            return self._error(400, "Validation failed", errors)
        existing = self._kv_list(service, COLLECTION,
                                 query={"type": cleaned["type"], "value": cleaned["value"],
                                        "list_type": cleaned["list_type"]}, limit=1)
        if existing:
            return self._error(409,
                f"Duplicate: ({cleaned['type']}, {cleaned['value']}, "
                f"{cleaned['list_type']}) already exists",
                {"existing_key": existing[0].get("_key")})
        now = self._now_iso()
        created = self._kv_create(service, COLLECTION, {
            **cleaned, "created_by": actor, "created_at": now,
            "last_modified_by": actor, "last_modified_at": now,
        })
        self._detect_and_record_conflict(service, cleaned["type"], cleaned["value"],
                                         cleaned["list_type"], created["_key"])
        _invalidate_etag()
        self._audit(service, actor, "create", "ioc", created["_key"], cleaned["value"])
        return self._created(created)

    def _update_ioc(self, service, actor, key, body):
        existing = self._kv_get(service, COLLECTION, key)
        if existing is None:
            return self._error(404, f"IOC '{key}' not found")
        merged = {**existing, **body, "_key": key}
        cleaned, errors = self._validate_ioc(merged)
        if errors:
            return self._error(400, "Validation failed", errors)
        changes = self._diff(existing, merged)
        now     = self._now_iso()
        updated = self._kv_update(service, COLLECTION, key, {
            **cleaned, "_key": key,
            "created_by":       existing.get("created_by"),
            "created_at":       existing.get("created_at"),
            "last_modified_by": actor,
            "last_modified_at": now,
        })
        if changes.get("list_type"):
            self._detect_and_record_conflict(service, cleaned["type"], cleaned["value"],
                                             cleaned["list_type"], key)
        _invalidate_etag()
        self._audit(service, actor, "update", "ioc", key, cleaned["value"], changes)
        return self._ok(updated)

    # -------------------------------------------------------------- DELETE

    def _dispatch_DELETE(self, request):
        service = self._get_service(request)
        actor   = self._get_actor(request)
        key     = self._path_part(request, 0)
        if not key:
            return self._error(400, "DELETE requires an IOC key")
        doc = self._kv_get(service, COLLECTION, key)
        if doc is None:
            return self._error(404, f"IOC '{key}' not found")
        self._kv_delete(service, COLLECTION, key)
        _invalidate_etag()
        self._audit(service, actor, "delete", "ioc", key, doc.get("value"))
        return self._ok({"deleted": True, "_key": key})

    # --------------------------------------------------------- Bulk ops

    def _handle_bulk(self, request, service, actor, action, body):
        keys = body.get("keys", [])
        if not keys or not isinstance(keys, list):
            return self._error(400, "Bulk actions require a 'keys' list")
        if len(keys) > 1000:
            return self._error(400, "Bulk operations limited to 1000 keys")

        results = {"success": [], "failed": []}

        def _try(key, fn):
            try:
                fn(); results["success"].append(key)
            except Exception as exc:
                results["failed"].append({"key": key, "reason": str(exc)})

        now = self._now_iso()

        if action == "bulk_delete":
            for key in keys:
                doc = self._kv_get(service, COLLECTION, key)
                if doc:
                    _try(key, lambda k=key, d=doc: (
                        self._kv_delete(service, COLLECTION, k),
                        self._audit(service, actor, "delete", "ioc", k, d.get("value"))))
                else:
                    results["failed"].append({"key": key, "reason": "not found"})

        elif action in ("bulk_enable", "bulk_disable"):
            new_status = "active" if action == "bulk_enable" else "inactive"
            for key in keys:
                doc = self._kv_get(service, COLLECTION, key)
                if not doc: results["failed"].append({"key": key, "reason": "not found"}); continue
                old = doc.get("status")
                doc.update(status=new_status, last_modified_by=actor, last_modified_at=now)
                _try(key, lambda k=key, d=dict(doc), o=old: (
                    self._kv_update(service, COLLECTION, k, d),
                    self._audit(service, actor, "update", "ioc", k, d.get("value"),
                                {"status": {"before": o, "after": new_status}})))

        elif action == "bulk_set_policy":
            policy_names = body.get("policy_names", [])
            if not policy_names:
                return self._error(400, "bulk_set_policy requires 'policy_names'")
            for key in keys:
                doc = self._kv_get(service, COLLECTION, key)
                if not doc: results["failed"].append({"key": key, "reason": "not found"}); continue
                old = doc.get("policy_names")
                doc.update(policy_names=policy_names, last_modified_by=actor, last_modified_at=now)
                _try(key, lambda k=key, d=dict(doc), o=old: (
                    self._kv_update(service, COLLECTION, k, d),
                    self._audit(service, actor, "update", "ioc", k, d.get("value"),
                                {"policy_names": {"before": o, "after": policy_names}})))

        elif action == "bulk_extend":
            try:
                delta_secs = int(float(body.get("delta_hours", 0))) * 3600
            except (ValueError, TypeError):
                return self._error(400, "delta_hours must be a number")
            for key in keys:
                doc = self._kv_get(service, COLLECTION, key)
                if not doc: results["failed"].append({"key": key, "reason": "not found"}); continue
                old_stop = doc.get("stop_time", "")
                try:
                    base_dt = (datetime.strptime(old_stop, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                               if old_stop else datetime.now(timezone.utc))
                    new_stop = (base_dt + timedelta(seconds=delta_secs)).strftime("%Y-%m-%dT%H:%M:%SZ")
                except Exception as exc:
                    results["failed"].append({"key": key, "reason": str(exc)}); continue
                doc.update(stop_time=new_stop, status="active",
                           last_modified_by=actor, last_modified_at=now)
                _try(key, lambda k=key, d=dict(doc), os_=old_stop, ns=new_stop: (
                    self._kv_update(service, COLLECTION, k, d),
                    self._audit(service, actor, "update", "ioc", k, d.get("value"),
                                {"stop_time": {"before": os_, "after": ns}})))
        else:
            return self._error(400, f"Unknown bulk action: {action}")

        _invalidate_etag()
        return self._ok({"action": action, "total": len(keys),
                         "success_count": len(results["success"]),
                         "failed_count":  len(results["failed"]),
                         "results": results})

    # ------------------------------------------------------------ helpers

    def _enrich(self, doc):
        doc["status"] = self._compute_status(
            doc.get("start_time"), doc.get("stop_time"), doc.get("status"))
        now_iso   = self._now_iso()
        in24h_iso = (datetime.now(timezone.utc) + timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
        stop = doc.get("stop_time", "")
        doc["expiry_warning"] = bool(stop and now_iso < stop <= in24h_iso)
        return doc

    @staticmethod
    def _diff(before, after):
        return {k: {"before": before.get(k), "after": after.get(k)}
                for k in set(list(before) + list(after))
                if not k.startswith("_") and before.get(k) != after.get(k)}


def _apply_policy_ttl(cleaned, service):
    """Auto-set stop_time from policy default_ttl_hours if not already set."""
    import json
    from datetime import datetime, timezone, timedelta
    if cleaned.get("stop_time"):
        return cleaned
    policy_names = cleaned.get("policy_names", [])
    if not policy_names:
        return cleaned
    best_ttl = None
    for name in policy_names:
        try:
            endpoint = "/servicesNS/nobody/edl_manager/storage/collections/data/edl_policies"
            response = service.get(endpoint, output_mode="json",
                                   query=json.dumps({"name": name}), count="1")
            body = response.body.read()
            if isinstance(body, bytes): body = body.decode()
            docs = json.loads(body)
            if docs:
                ttl = docs[0].get("default_ttl_hours")
                if ttl:
                    v = float(ttl)
                    if best_ttl is None or v < best_ttl:
                        best_ttl = v
        except Exception:
            pass
    if best_ttl is not None:
        cleaned["stop_time"] = (datetime.now(timezone.utc)
                                 + timedelta(hours=best_ttl)
                                 ).strftime("%Y-%m-%dT%H:%M:%SZ")
    return cleaned
