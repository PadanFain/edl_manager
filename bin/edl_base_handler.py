"""
edl_base_handler.py
────────────────────────────────────────────────────────────────────────────
Base REST handler — v1.5.0

Migrated from splunk.rest.BaseRestHandler (Splunk's internal class, not
a public API) to splunk.persistconn.application.PersistentServerConnectionApplication
— the officially documented and supported class for custom REST endpoints
in Splunk apps.

Reference:
  https://github.com/splunk/splunk-app-examples/blob/master/
  custom_endpoints/hello-world/bin/hello_world.py

Key differences from BaseRestHandler:
  • __init__ takes (command_line, command_arg) not (method, requestInfo, ...)
  • handle(in_string) receives a JSON string — parse it to get method/path/body
  • Return a dict {'payload': str, 'status': int} — payload must be a string
  • No self.response / self.request objects — request context comes from in_string
  • KV Store calls use splunklib.client.Service built from session.authtoken

Works on: Splunk Enterprise 9.0+, Splunk Cloud (after AppInspect vetting)
"""

import json
import re
import uuid
import socket
import logging
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse, urlsplit

import splunklib.client as splunk_client

logger = logging.getLogger("edl_manager")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
APP_NAME         = "edl_manager"
VALID_TYPES      = {"ip", "url", "domain"}
VALID_LIST_TYPES = {"block", "allow"}
VALID_STATUSES   = {"active", "inactive"}
DEFAULT_SOURCE   = "manual"


# =============================================================================
# EDLBaseHandler
# =============================================================================
class EDLBaseHandler:
    """
    Abstract base for all EDL REST handlers.

    Uses PersistentServerConnectionApplication semantics:
      handle(in_string) → dict

    Subclasses implement _dispatch_GET, _dispatch_POST, _dispatch_DELETE.
    Each receives the parsed request dict as their only argument.
    """

    def __init__(self, command_line, command_arg):
        super().__init__()

    def handle(self, in_string):
        """
        Dispatch an incoming HTTP request to the appropriate method handler.
        """
        try:
            request = json.loads(in_string)
        except (json.JSONDecodeError, TypeError) as exc:
            return self._error(400, f"Could not parse request: {exc}")

        method = request.get("method", "GET").upper()
        try:
            if method == "GET":
                return self._dispatch_GET(request)
            elif method == "POST":
                return self._dispatch_POST(request)
            elif method == "DELETE":
                return self._dispatch_DELETE(request)
            else:
                return self._error(405, f"Method {method} not allowed")
        except Exception as exc:
            logger.exception("Unhandled exception in %s %s", method,
                             request.get("rest_path", ""))
            return self._error(500, str(exc))

    def _dispatch_GET(self, request):    return self._error(405, "Method not allowed")
    def _dispatch_POST(self, request):   return self._error(405, "Method not allowed")
    def _dispatch_DELETE(self, request): return self._error(405, "Method not allowed")

    # ── Response helpers ──────────────────────────────────────────────────

    def _ok(self, body):
        return {"payload": json.dumps(body), "status": 200,
                "headers": {"Content-Type": "application/json"}}

    def _created(self, body):
        return {"payload": json.dumps(body), "status": 201,
                "headers": {"Content-Type": "application/json"}}

    def _error(self, status, message, details=None):
        body = {"error": message}
        if details:
            body["details"] = details
        return {"payload": json.dumps(body), "status": status,
                "headers": {"Content-Type": "application/json"}}

    def _text_response(self, status, text, content_type="text/plain"):
        return {"payload": text, "status": status,
                "headers": {"Content-Type": content_type}}

    # ── Request parsing helpers ───────────────────────────────────────────

    def _query_param(self, request, name, default=None):
        return request.get("query", {}).get(name, default)

    def _parse_body(self, request):
        raw = request.get("payload") or "{}"
        if isinstance(raw, dict):
            return raw
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return {}

    def _path_part(self, request, index=0):
        handler_path = request.get("rest_path", "") or \
                       request.get("path", {}).get("handler", "")
        parts = [p for p in handler_path.split("/") if p and p not in (
            "edl_manager", "iocs", "policies", "audit", "import", "export",
            "stats", "feed", "tokens", "taxii", "conflicts", "ingest",
            "hits", "geo", "campaigns",
        )]
        return parts[index] if index < len(parts) else None

    # ── Splunk SDK service object ─────────────────────────────────────────

    def _get_service(self, request):
        """Build an authenticated splunklib.client.Service from the request session."""
        server_uri = (request.get("server_uri")
                      or request.get("server_rest_uri")
                      or "https://localhost:8089")
        session    = request.get("session", {})
        token      = session.get("authtoken", "")
        uri        = urlsplit(server_uri)
        return splunk_client.Service(
            scheme = uri.scheme or "https",
            host   = uri.hostname or "localhost",
            port   = uri.port    or 8089,
            app    = APP_NAME,
            token  = token,
        )

    # ── KV Store wrappers ─────────────────────────────────────────────────

    def _kv_endpoint(self, collection, key=None):
        base = f"/servicesNS/nobody/{APP_NAME}/storage/collections/data/{collection}"
        return f"{base}/{key}" if key else base

    def _kv_list(self, service, collection, query=None, limit=None,
                 skip=None, sort=None):
        params = {"output_mode": "json", "count": str(limit or 0)}
        if query: params["query"] = json.dumps(query)
        if skip:  params["skip"] = str(skip)
        # KV Store sort syntax: sort_key=<field>&sort_dir=asc|desc
        # (not a JSON array — that's a MongoDB driver concept, not the REST API)
        if sort:
            field, direction = sort[0]
            params["sort_key"] = field
            params["sort_dir"] = "asc" if direction >= 0 else "desc"
        response = service.get(self._kv_endpoint(collection), **params)
        body     = response.body.read()
        if isinstance(body, bytes):
            body = body.decode("utf-8")
        result = json.loads(body)
        # KV Store always returns a JSON array; a dict means an error response
        if isinstance(result, dict):
            logger.error("KV Store list error on %s: %s", collection, result)
            return []
        return result

    def _kv_get(self, service, collection, key):
        try:
            response = service.get(self._kv_endpoint(collection, key),
                                   output_mode="json")
            body = response.body.read()
            if isinstance(body, bytes):
                body = body.decode("utf-8")
            return json.loads(body)
        except Exception as exc:
            if "404" in str(exc) or "Not Found" in str(exc):
                return None
            raise

    def _kv_create(self, service, collection, doc):
        if "_key" not in doc:
            doc["_key"] = str(uuid.uuid4())
        response = service.post(
            self._kv_endpoint(collection),
            output_mode="json",
            body=json.dumps(doc),
            headers=[("Content-Type", "application/json")],
        )
        body = response.body.read()
        if isinstance(body, bytes):
            body = body.decode("utf-8")
        result = json.loads(body)
        doc["_key"] = result.get("_key", doc["_key"])
        return doc

    def _kv_update(self, service, collection, key, doc):
        doc["_key"] = key
        service.post(
            self._kv_endpoint(collection, key),
            output_mode="json",
            body=json.dumps(doc),
            headers=[("Content-Type", "application/json")],
        )
        return doc

    def _kv_delete(self, service, collection, key):
        service.delete(self._kv_endpoint(collection, key), output_mode="json")

    def _kv_batch_create(self, service, collection, docs):
        endpoint = f"{self._kv_endpoint(collection)}/batch_save"
        service.post(
            endpoint,
            output_mode="json",
            body=json.dumps(docs),
            headers=[("Content-Type", "application/json")],
        )
        return docs

    # ── Actor / auth helpers ──────────────────────────────────────────────

    def _get_actor(self, request):
        return request.get("session", {}).get("user", "unknown")

    def _check_token_auth(self, request):
        """Check for EDLToken in Authorization header. Returns (valid, owner)."""
        import hashlib
        auth_header = request.get("headers", {}).get("Authorization", "")
        if not auth_header.startswith("EDLToken "):
            return False, None
        raw_token  = auth_header[len("EDLToken "):].strip()
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        try:
            service = self._get_service(request)
            matches = self._kv_list(service, "edl_tokens",
                                    query={"token_hash": token_hash, "active": True},
                                    limit=1)
            if not matches:
                return False, None
            token_doc = matches[0]
            expires   = token_doc.get("expires_at", "")
            if expires and expires < self._now_iso():
                return False, None
            try:
                token_doc["last_used_at"] = self._now_iso()
                self._kv_update(service, "edl_tokens", token_doc["_key"], token_doc)
            except Exception:
                pass
            return True, token_doc.get("owner", "token-user")
        except Exception as exc:
            logger.warning("Token auth check failed: %s", exc)
            return False, None

    # ── Audit log ─────────────────────────────────────────────────────────

    def _audit(self, service, actor, action, target_type, target_key,
               target_value=None, changes=None):
        entry = {
            "_key":          str(uuid.uuid4()),
            "timestamp_iso": self._now_iso(),
            "actor":         actor,
            "action":        action,
            "target_type":   target_type,
            "target_key":    target_key,
            "target_value":  target_value or "",
            "changes":       json.dumps(changes or {}),
            "ip_address":    "",
            "session_id":    "",
        }
        try:
            self._kv_create(service, "edl_audit_log", entry)
        except Exception as exc:
            logger.warning("Audit log write failed: %s", exc)

    # ── Conflict detection ────────────────────────────────────────────────

    def _detect_and_record_conflict(self, service, ioc_type, value,
                                    new_list_type, new_key):
        """Check for block/allow conflict on same (type, value)."""
        opposite = "allow" if new_list_type == "block" else "block"
        try:
            existing = self._kv_list(service, "ioc_entries", query={
                "type": ioc_type, "value": value,
                "list_type": opposite, "status": "active",
            }, limit=1)
        except Exception:
            return
        if not existing:
            return

        other_key = existing[0].get("_key")
        block_key = new_key if new_list_type == "block" else other_key
        allow_key = new_key if new_list_type == "allow" else other_key
        now       = self._now_iso()

        try:
            existing_conflicts = self._kv_list(
                service, "edl_conflicts",
                query={"type": ioc_type, "value": value, "state": "open"},
                limit=1,
            )
            if existing_conflicts:
                conflict_doc = existing_conflicts[0]
                conflict_doc["block_key"] = block_key
                conflict_doc["allow_key"] = allow_key
                self._kv_update(service, "edl_conflicts",
                                conflict_doc["_key"], conflict_doc)
            else:
                self._kv_create(service, "edl_conflicts", {
                    "_key":        str(uuid.uuid4()),
                    "type":        ioc_type,
                    "value":       value,
                    "block_key":   block_key,
                    "allow_key":   allow_key,
                    "state":       "open",
                    "resolution":  "pending",
                    "detected_at": now,
                })
        except Exception as exc:
            logger.warning("Could not record conflict: %s", exc)

        for key in (new_key, other_key):
            try:
                doc = self._kv_get(service, "ioc_entries", key)
                if doc:
                    doc["conflict_state"] = "conflict"
                    self._kv_update(service, "ioc_entries", key, doc)
            except Exception as exc:
                logger.warning("Could not flag conflict_state on %s: %s", key, exc)

    # ── Time helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _now_iso():
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    @staticmethod
    def _compute_status(start_time, stop_time, current_status):
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        if stop_time  and stop_time  < now: return "inactive"
        if start_time and start_time > now: return "inactive"
        return current_status or "active"

    # ── IOC validation ────────────────────────────────────────────────────

    @staticmethod
    def _validate_ioc(data, require_all=True):
        errors  = []
        cleaned = {}

        ioc_type = (data.get("type") or "").strip().lower()
        if ioc_type not in VALID_TYPES:
            errors.append(f"'type' must be one of {sorted(VALID_TYPES)}; got '{ioc_type}'")
        cleaned["type"] = ioc_type

        value = (data.get("value") or "").strip()
        if not value:
            errors.append("'value' is required and must be non-empty")
        else:
            if ioc_type == "ip":
                err = IOCValidator.validate_ip_or_cidr(value)
                if err: errors.append(err)
            elif ioc_type == "url":
                err = IOCValidator.validate_url(value)
                if err: errors.append(err)
            elif ioc_type == "domain":
                err = IOCValidator.validate_domain(value)
                if err: errors.append(err)
        cleaned["value"] = value

        list_type = (data.get("list_type") or "").strip().lower()
        if list_type not in VALID_LIST_TYPES:
            errors.append(f"'list_type' must be one of {sorted(VALID_LIST_TYPES)}")
        cleaned["list_type"] = list_type

        pnames = data.get("policy_names", [])
        if isinstance(pnames, str):
            pnames = [p.strip() for p in pnames.split(",") if p.strip()]
        if require_all and not pnames:
            errors.append("'policy_names' must contain at least one policy name")
        cleaned["policy_names"] = pnames

        for field in ("start_time", "stop_time"):
            val = (data.get(field) or "").strip()
            if val and not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", val):
                errors.append(f"'{field}' must be ISO 8601 (YYYY-MM-DDTHH:MM:SSZ)")
            cleaned[field] = val

        ri = data.get("refresh_interval", "")
        if ri not in ("", None):
            try:
                ri_int = int(ri)
                if ri_int <= 0: raise ValueError
                cleaned["refresh_interval"] = ri_int
            except (ValueError, TypeError):
                errors.append("'refresh_interval' must be a positive integer (seconds)")
        else:
            cleaned["refresh_interval"] = ""

        status = (data.get("status") or "active").strip().lower()
        if status not in VALID_STATUSES:
            errors.append(f"'status' must be one of {sorted(VALID_STATUSES)}")
        cleaned["status"] = status

        cleaned["description"] = (data.get("description") or "").strip()
        cleaned["source"]      = (data.get("source") or DEFAULT_SOURCE).strip()
        cleaned["source_ref"]  = (data.get("source_ref") or "").strip()

        tags = data.get("tags", [])
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        cleaned["tags"] = tags if isinstance(tags, list) else []

        cleaned["conflict_state"]      = data.get("conflict_state", "none")
        cleaned["conflict_resolution"] = data.get("conflict_resolution", "")
        cleaned["hit_count"]           = data.get("hit_count", 0)
        cleaned["last_hit_at"]         = data.get("last_hit_at", "")

        return cleaned, errors


# =============================================================================
# SplunkRestHandler — pure Python base, no PSCA inheritance
#
# Each concrete handler does:
#   from edl_base_handler import SplunkRestHandler, get_psca_base
#   class FooHandler(SplunkRestHandler, get_psca_base()): ...
#
# This ensures only ONE class per handler file inherits PSCA.
# =============================================================================
class SplunkRestHandler(EDLBaseHandler):
    """Pure-Python base. Concrete handlers also inherit PSCA directly."""
    def __init__(self, command_line=None, command_arg=None):
        super().__init__(command_line, command_arg)  # goes to EDLBaseHandler → super().__init__() → PSCA()


def get_psca_base():
    """Returns PersistentServerConnectionApplication, or object in test envs."""
    try:
        from splunk.persistconn.application import PersistentServerConnectionApplication
        return PersistentServerConnectionApplication
    except ImportError:
        return object


# =============================================================================
# IOCValidator
# =============================================================================
class IOCValidator:
    """Comprehensive IOC format validators. Returns None if valid, error string if not."""

    @staticmethod
    def validate_ip_or_cidr(value):
        if "/" in value:
            host, prefix = value.rsplit("/", 1)
            err = IOCValidator._validate_ip_host(host)
            if err: return err
            try:
                prefix_int = int(prefix)
                max_prefix = 128 if ":" in host else 32
                if not (0 <= prefix_int <= max_prefix):
                    return f"CIDR prefix /{prefix_int} out of range (0-{max_prefix})"
            except ValueError:
                return f"Invalid CIDR prefix '/{prefix}'"
            return None
        return IOCValidator._validate_ip_host(value)

    @staticmethod
    def _validate_ip_host(value):
        try:
            socket.inet_pton(socket.AF_INET, value)
            return None
        except (socket.error, OSError):
            pass
        try:
            socket.inet_pton(socket.AF_INET6, value)
            return None
        except (socket.error, OSError):
            pass
        return f"'{value}' is not a valid IPv4 or IPv6 address"

    @staticmethod
    def validate_url(value):
        parse_val = value if "://" in value else f"https://{value}"
        try:
            parsed = urlparse(parse_val)
        except Exception:
            return f"Could not parse URL '{value}'"
        if parsed.scheme not in ("http", "https", "ftp"):
            return f"URL scheme '{parsed.scheme}' not supported; use http, https, or ftp"
        if not parsed.netloc:
            return f"URL '{value}' has no hostname"
        host = parsed.hostname or ""
        if not host:
            return f"URL '{value}' has an empty hostname"
        if re.match(r"^[\d.:]+$", host):
            err = IOCValidator._validate_ip_host(host)
            if err: return f"URL hostname {err}"
        return None

    @staticmethod
    def validate_domain(value):
        if "://" in value:
            return f"Domain '{value}' contains a URL scheme -- use type='url'"
        if "/" in value.lstrip("*"):
            return f"Domain '{value}' contains a path separator -- use type='url'"
        stripped = value.rstrip(".")
        if stripped.startswith("*."):
            stripped = stripped[2:]
            if not stripped:
                return "Wildcard domain '*.' has no base domain"
        if len(stripped) > 253:
            return f"Domain '{value}' exceeds 253-character limit"
        label_re = re.compile(
            r"^(?:[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?|xn--[a-zA-Z0-9\-]+)$"
        )
        for label in stripped.split("."):
            if not label:
                return f"Domain '{value}' has an empty label (double dot?)"
            if len(label) > 63:
                return f"Domain label '{label}' exceeds 63-character limit"
            if not label_re.match(label):
                return (f"Domain label '{label}' contains invalid characters. "
                        f"Use punycode (xn--...) for internationalized domains")
        return None
