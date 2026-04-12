"""
edl_audit_handler.py
——————————————————————————————————————————————————————————————————————————
Read-only audit log endpoint.

GET /edl_manager/audit

Query parameters:
  actor      — filter by username
  action     — create|update|delete|import|export
  target_key — filter by affected document key
  start      — ISO 8601 start timestamp
  end        — ISO 8601 end timestamp
  page       — page number
  page_size  — results per page (default 100)

v1.5.0: Migrated from EDLBaseHandler(BaseRestHandler) → SplunkRestHandler(PSCA).
"""

import logging
from edl_base_handler import SplunkRestHandler

logger     = logging.getLogger("edl_manager.audit")
COLLECTION = "edl_audit_log"


class AuditHandler(SplunkRestHandler):

    def _dispatch_GET(self, request):
        service = self._get_service(request)
        query = {}

        actor = self._query_param(request, "actor")
        if actor:
            query["actor"] = actor

        action = self._query_param(request, "action")
        if action:
            query["action"] = action

        target_key = self._query_param(request, "target_key")
        if target_key:
            query["target_key"] = target_key

        start = self._query_param(request, "start")
        end   = self._query_param(request, "end")
        if start or end:
            ts_filter = {}
            if start: ts_filter["$gte"] = start
            if end:   ts_filter["$lte"] = end
            query["timestamp_iso"] = ts_filter

        try:
            page      = max(1, int(self._query_param(request, "page", 1)))
            page_size = min(500, max(1, int(self._query_param(request, "page_size", 100))))
        except (ValueError, TypeError):
            page, page_size = 1, 100

        skip = (page - 1) * page_size
        all_docs = self._kv_list(service, COLLECTION,
                                 query=query if query else None,
                                 sort=[("timestamp_iso", -1)])
        total        = len(all_docs)
        page_results = all_docs[skip: skip + page_size]

        return self._ok({
            "items":       page_results,
            "total_count": total,
            "page":        page,
            "page_size":   page_size,
            "total_pages": max(1, (total + page_size - 1) // page_size),
        })
