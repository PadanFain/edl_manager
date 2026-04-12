"""
edl_token_handler.py
────────────────────────────────────────────────────────────────────────────
Long-lived API token management for firewall service accounts.

Tokens are SHA-256 hashed before storage -- the raw token is returned once
on creation only. Firewalls present: Authorization: EDLToken <raw_token>

Endpoints:
  GET    /edl_manager/tokens           -- list tokens (hashes redacted)
  POST   /edl_manager/tokens           -- create token
  POST   /edl_manager/tokens/<key>     -- update (enable/disable/description)
  DELETE /edl_manager/tokens/<key>     -- revoke token

v1.5.0: Migrated to PersistentServerConnectionApplication.
"""

import base64
import hashlib
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from edl_base_handler import SplunkRestHandler

logger     = logging.getLogger("edl_manager.token")
COLLECTION = "edl_tokens"
TOKEN_BYTES = 32


class TokenHandler(SplunkRestHandler):

    def _dispatch_GET(self, request):
        service = self._get_service(request)
        docs    = self._kv_list(service, COLLECTION, sort=[("created_at", -1)])
        safe = []
        for d in docs:
            d["token_hash_preview"] = d.get("token_hash", "")[:12] + "..."
            d.pop("token_hash", None)
            safe.append(d)
        return self._ok({"items": safe, "total_count": len(safe)})

    def _dispatch_POST(self, request):
        service = self._get_service(request)
        actor   = self._get_actor(request)
        key     = self._path_part(request, 0)
        body    = self._parse_body(request)
        if key:
            return self._update_token(service, actor, key, body)
        return self._create_token(service, actor, body)

    def _create_token(self, service, actor, body):
        name        = (body.get("name") or "").strip()
        description = (body.get("description") or "").strip()
        owner       = (body.get("owner") or actor).strip()
        capabilities = body.get("capabilities", ["edl_read"])
        expires_in_days = body.get("expires_in_days")

        if not name:
            return self._error(400, "'name' is required")
        if self._kv_list(service, COLLECTION, query={"name": name}, limit=1):
            return self._error(409, f"Token '{name}' already exists")

        raw_token  = base64.urlsafe_b64encode(os.urandom(TOKEN_BYTES)).rstrip(b"=").decode()
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        now        = self._now_iso()
        expires_at = ""
        if expires_in_days:
            try:
                expires_at = (datetime.now(timezone.utc)
                              + timedelta(days=int(expires_in_days))
                              ).strftime("%Y-%m-%dT%H:%M:%SZ")
            except (ValueError, TypeError):
                return self._error(400, "'expires_in_days' must be a positive integer")

        doc = {
            "_key": str(uuid.uuid4()), "name": name, "description": description,
            "owner": owner, "token_hash": token_hash,
            "capabilities": capabilities if isinstance(capabilities, list) else [capabilities],
            "created_at": now, "expires_at": expires_at,
            "last_used_at": "", "active": True,
        }
        created = self._kv_create(service, COLLECTION, doc)
        self._audit(service, actor, "create", "token", created["_key"], name)
        result = {k: v for k, v in created.items() if k != "token_hash"}
        result["token"]   = raw_token
        result["warning"] = ("Store this token securely. It will not be shown again. "
                             "Present as: Authorization: EDLToken <token>")
        return self._created(result)

    def _update_token(self, service, actor, key, body):
        doc = self._kv_get(service, COLLECTION, key)
        if not doc:
            return self._error(404, f"Token '{key}' not found")
        if "active"      in body: doc["active"]      = bool(body["active"])
        if "description" in body: doc["description"] = str(body["description"])
        if "expires_at"  in body: doc["expires_at"]  = str(body["expires_at"])
        self._kv_update(service, COLLECTION, key, doc)
        self._audit(service, actor, "update", "token", key, doc.get("name"))
        return self._ok({k: v for k, v in doc.items() if k != "token_hash"})

    def _dispatch_DELETE(self, request):
        service = self._get_service(request)
        actor   = self._get_actor(request)
        key     = self._path_part(request, 0)
        if not key:
            return self._error(400, "DELETE requires a token key")
        doc = self._kv_get(service, COLLECTION, key)
        if not doc:
            return self._error(404, f"Token '{key}' not found")
        self._kv_delete(service, COLLECTION, key)
        self._audit(service, actor, "delete", "token", key, doc.get("name"))
        return self._ok({"deleted": True, "_key": key})
