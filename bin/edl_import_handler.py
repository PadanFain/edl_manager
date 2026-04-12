"""
edl_import_handler.py — v1.5
CSV bulk import. Migrated to PersistentServerConnectionApplication.
"""
import json, logging, uuid
from edl_base_handler import SplunkRestHandler

logger = logging.getLogger("edl_manager.import")
MAX_IMPORT_ROWS = 10_000


class ImportHandler(SplunkRestHandler):

    def _dispatch_POST(self, request):
        svc   = self._get_service(request)
        body  = self._parse_body(request)
        actor = self._get_actor(request)

        rows        = body.get("rows", [])
        commit      = bool(body.get("commit", False))
        default_pol = body.get("policy_names", [])
        skip_dupes  = bool(body.get("skip_duplicates", True))

        if not isinstance(rows, list):
            return self._error(400, "'rows' must be a list")
        if len(rows) > MAX_IMPORT_ROWS:
            return self._error(400, f"Max {MAX_IMPORT_ROWS} rows per import")

        # Phase 1 — validate
        validated = []
        for idx, row in enumerate(rows):
            if not row.get("policy_names"): row["policy_names"] = default_pol
            if not row.get("source"):       row["source"] = "csv-import"
            cleaned, errors = self._validate_ioc(row, require_all=True)
            validated.append({"row_num": idx+1, "cleaned": cleaned, "errors": errors,
                               "status": "error" if errors else "valid", "duplicate": False})

        # Phase 2 — dedup
        existing = {(d.get("type"), d.get("value"), d.get("list_type")): d.get("_key")
                    for d in self._kv_list(svc, "ioc_entries")}
        batch_seen = {}
        for entry in validated:
            if entry["status"] == "error": continue
            c   = entry["cleaned"]
            key = (c.get("type"), c.get("value"), c.get("list_type"))
            if key in existing:
                entry["duplicate"] = True
                entry["status"]    = "skipped" if skip_dupes else "error"
            elif key in batch_seen:
                entry["duplicate"] = True; entry["status"] = "skipped"
            else:
                batch_seen[key] = entry["row_num"]

        valid_rows = [e for e in validated if e["status"] == "valid"]
        summary = {"total": len(rows), "valid": len(valid_rows),
                   "errors": sum(1 for e in validated if e["status"]=="error"),
                   "skipped": sum(1 for e in validated if e["status"]=="skipped"),
                   "commit": commit, "rows": validated}

        if not commit or not valid_rows:
            return self._ok(summary)

        # Phase 3 — insert
        now  = self._now_iso()
        docs = [{**e["cleaned"], "_key": str(uuid.uuid4()),
                 "created_by": actor, "created_at": now,
                 "last_modified_by": actor, "last_modified_at": now}
                for e in valid_rows]
        committed = 0
        for i in range(0, len(docs), 500):
            try:
                self._kv_batch_create(svc, "ioc_entries", docs[i:i+500])
                committed += min(500, len(docs)-i)
            except Exception as exc:
                logger.error("Batch insert failed at %d: %s", i, exc)

        self._audit(svc, actor, "import", "ioc", "batch", f"{committed} IOCs",
                    {"committed": committed})
        summary["committed"] = committed
        if summary["errors"]:
            return {"payload": json.dumps(summary), "status": 207,
                    "headers": {"Content-Type": "application/json"}}
        return self._ok(summary)
