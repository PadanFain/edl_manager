"""
edl_export_handler.py — v1.5
CSV/text export. Migrated to PersistentServerConnectionApplication.
"""
import csv, io, logging
from edl_base_handler import SplunkRestHandler

logger = logging.getLogger("edl_manager.export")
EXPORT_FIELDS = ["type","value","list_type","policy_names","status",
                 "start_time","stop_time","description","source",
                 "source_ref","tags","hit_count","created_by","created_at"]


class ExportHandler(SplunkRestHandler):

    def _dispatch_GET(self, request):
        svc   = self._get_service(request)
        query = {}
        for f, p in [("type","type"),("list_type","list_type"),
                     ("status","status"),("conflict_state","conflict_state")]:
            v = self._query_param(request, p)
            if v: query[f] = v
        if self._query_param(request, "policy"):
            query["policy_names"] = {"$regex": self._query_param(request, "policy")}

        docs = self._kv_list(svc, "ioc_entries", query=query or None)
        fmt  = (self._query_param(request, "format") or "csv").lower()
        now  = self._now_iso()[:10]

        if fmt == "text":
            content  = "\n".join(d.get("value","") for d in docs if d.get("value")) + "\n"
            mime     = "text/plain"
            filename = f"edl_export_{now}.txt"
        else:
            buf = io.StringIO()
            csv.writer(buf).writerow(EXPORT_FIELDS)
            writer = csv.writer(buf)
            for d in docs:
                writer.writerow([
                    ",".join(d.get(f, []) if isinstance(d.get(f), list) else [str(d.get(f, ""))])
                    if f in ("policy_names", "tags") else str(d.get(f, ""))
                    for f in EXPORT_FIELDS
                ])
            content  = buf.getvalue()
            mime     = "text/csv"
            filename = f"edl_export_{now}.csv"

        return {
            "payload": content,
            "status":  200,
            "headers": {"Content-Type": mime,
                        "Content-Disposition": f'attachment; filename="{filename}"'},
        }
