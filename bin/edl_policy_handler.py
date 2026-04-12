"""
edl_policy_handler.py
────────────────────────────────────────────────────────────────────────────
REST handler for Policy CRUD operations.

Endpoints:
  GET    /edl_manager/policies           -- list all policies
  POST   /edl_manager/policies           -- create policy
  GET    /edl_manager/policies/<key>     -- get single policy
  POST   /edl_manager/policies/<key>     -- update policy
  DELETE /edl_manager/policies/<key>     -- delete policy

v1.5.0: Migrated to PersistentServerConnectionApplication.
"""

import logging
from edl_base_handler import SplunkRestHandler

logger     = logging.getLogger("edl_manager.policy")
COLLECTION = "edl_policies"


class PolicyHandler(SplunkRestHandler):

    def _dispatch_GET(self, request):
        service = self._get_service(request)
        key = self._path_part(request, 0)
        if key:
            doc = self._kv_get(service, COLLECTION, key)
            if doc is None:
                return self._error(404, f"Policy '{key}' not found")
            return self._ok(doc)
        docs = self._kv_list(service, COLLECTION, sort=[("name", 1)])
        return self._ok({"items": docs, "total_count": len(docs)})

    def _dispatch_POST(self, request):
        service = self._get_service(request)
        actor   = self._get_actor(request)
        key     = self._path_part(request, 0)
        body    = self._parse_body(request)
        if key:
            return self._update_policy(service, actor, key, body)
        return self._create_policy(service, actor, body)

    def _create_policy(self, service, actor, body):
        cleaned, errors = self._validate_policy(body)
        if errors:
            return self._error(400, "Validation failed", errors)
        existing = self._kv_list(service, COLLECTION,
                                 query={"name": cleaned["name"]}, limit=1)
        if existing:
            return self._error(409, f"Policy '{cleaned['name']}' already exists",
                               {"existing_key": existing[0].get("_key")})
        now = self._now_iso()
        created = self._kv_create(service, COLLECTION,
                                  {**cleaned, "created_by": actor,
                                   "created_at": now, "last_modified_at": now})
        self._audit(service, actor, "create", "policy", created["_key"], cleaned["name"])
        return self._created(created)

    def _update_policy(self, service, actor, key, body):
        existing = self._kv_get(service, COLLECTION, key)
        if existing is None:
            return self._error(404, f"Policy '{key}' not found")
        cleaned, errors = self._validate_policy({**existing, **body, "_key": key})
        if errors:
            return self._error(400, "Validation failed", errors)
        same_name = self._kv_list(service, COLLECTION,
                                  query={"name": cleaned["name"]}, limit=1)
        if same_name and same_name[0].get("_key") != key:
            return self._error(409, f"Another policy named '{cleaned['name']}' already exists")
        now = self._now_iso()
        updated = self._kv_update(service, COLLECTION, key,
                                  {**cleaned, "_key": key,
                                   "created_by": existing.get("created_by"),
                                   "created_at": existing.get("created_at"),
                                   "last_modified_at": now})
        self._audit(service, actor, "update", "policy", key, cleaned["name"])
        return self._ok(updated)

    def _dispatch_DELETE(self, request):
        service = self._get_service(request)
        actor   = self._get_actor(request)
        key     = self._path_part(request, 0)
        if not key:
            return self._error(400, "DELETE requires a policy key")
        doc = self._kv_get(service, COLLECTION, key)
        if doc is None:
            return self._error(404, f"Policy '{key}' not found")
        name = doc.get("name", "")
        refs = self._kv_list(service, "ioc_entries",
                             query={"policy_names": {"$regex": name}}, limit=1)
        if refs:
            return self._error(409,
                f"Cannot delete '{name}': IOC entries still reference it. "
                "Reassign those IOCs first.")
        self._kv_delete(service, COLLECTION, key)
        self._audit(service, actor, "delete", "policy", key, name)
        return self._ok({"deleted": True, "_key": key})

    @staticmethod
    def _validate_policy(data):
        errors, cleaned = [], {}
        name = (data.get("name") or "").strip()
        if not name:          errors.append("name is required")
        elif len(name) > 128: errors.append("name must be <= 128 characters")
        cleaned["name"] = name
        cleaned["description"] = (data.get("description") or "").strip()
        ttl = data.get("default_ttl_hours")
        if ttl not in (None, ""):
            try:
                v = float(ttl)
                if v <= 0: raise ValueError
                cleaned["default_ttl_hours"] = v
            except (ValueError, TypeError):
                errors.append("default_ttl_hours must be a positive number")
        else:
            cleaned["default_ttl_hours"] = None
        ltd = (data.get("list_type_default") or "block").strip().lower()
        if ltd not in ("block", "allow", ""):  errors.append("list_type_default must be block or allow")
        cleaned["list_type_default"] = ltd or "block"
        rb = (data.get("refresh_behavior") or "static").strip().lower()
        if rb not in ("static", "rolling", "pinned"): errors.append("refresh_behavior must be static, rolling, or pinned")
        cleaned["refresh_behavior"] = rb
        ade = data.get("auto_disable_on_expiry", True)
        if isinstance(ade, str): ade = ade.lower() in ("true", "1", "yes")
        cleaned["auto_disable_on_expiry"] = bool(ade)
        return cleaned, errors
