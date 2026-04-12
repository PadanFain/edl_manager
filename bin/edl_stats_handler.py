"""
edl_stats_handler.py
——————————————————————————————————————————————————————————————————————————
Dashboard statistics endpoint.
v1.5.0: Migrated from EDLBaseHandler(BaseRestHandler) → SplunkRestHandler(PSCA).
"""

import logging
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from edl_base_handler import SplunkRestHandler

logger = logging.getLogger("edl_manager.stats")


class StatsHandler(SplunkRestHandler):

    def _dispatch_GET(self, request):
        service   = self._get_service(request)
        docs      = self._kv_list(service, "ioc_entries")
        now_iso   = self._now_iso()
        in24h     = (datetime.now(timezone.utc) + timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
        ago7d     = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
        ago30d    = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
        ago90d    = (datetime.now(timezone.utc) - timedelta(days=90)).strftime("%Y-%m-%dT%H:%M:%SZ")

        by_type = defaultdict(int); by_list = defaultdict(int)
        by_status = defaultdict(int); by_policy = defaultdict(int)
        by_source = defaultdict(int)
        expiring_24h = added_7d = added_30d = stale = 0
        top_hits = []

        for doc in docs:
            live = self._compute_status(doc.get("start_time"), doc.get("stop_time"), doc.get("status"))
            by_type[doc.get("type","unknown")] += 1
            by_list[doc.get("list_type","unknown")] += 1
            by_status[live] += 1
            src = doc.get("source") or "manual"
            by_source["taxii" if src.startswith("taxii:") else src] += 1
            for p in (doc.get("policy_names") or []):
                by_policy[p] += 1
            stop = doc.get("stop_time","")
            if stop and now_iso < stop <= in24h: expiring_24h += 1
            created = doc.get("created_at","")
            if created >= ago7d:  added_7d  += 1
            if created >= ago30d: added_30d += 1
            if live == "active" and not int(doc.get("hit_count",0) or 0) and created and created < ago90d:
                stale += 1
            hc = int(doc.get("hit_count",0) or 0)
            if hc > 0:
                top_hits.append({"_key": doc.get("_key"), "value": doc.get("value"),
                                  "type": doc.get("type"), "hit_count": hc,
                                  "last_hit_at": doc.get("last_hit_at","")})

        top_hits.sort(key=lambda x: -x["hit_count"])

        try: open_conflicts = len(self._kv_list(service, "edl_conflicts", query={"state": "open"}))
        except Exception: open_conflicts = 0
        try: active_tokens = len(self._kv_list(service, "edl_tokens", query={"active": True}))
        except Exception: active_tokens = 0
        try: active_taxii = len(self._kv_list(service, "edl_taxii_sources", query={"enabled": True}))
        except Exception: active_taxii = 0

        return self._ok({
            "total": len(docs), "by_type": dict(by_type), "by_list_type": dict(by_list),
            "by_status": dict(by_status), "by_policy": sorted(
                [{"policy": k, "count": v} for k, v in by_policy.items()], key=lambda x: -x["count"]),
            "by_source": sorted(
                [{"source": k, "count": v} for k, v in by_source.items()], key=lambda x: -x["count"]),
            "expiring_24h": expiring_24h, "added_last_7d": added_7d, "added_last_30d": added_30d,
            "stale_iocs": stale, "open_conflicts": open_conflicts, "active_tokens": active_tokens,
            "active_taxii_sources": active_taxii, "top_iocs_by_hits": top_hits[:10],
            "generated_at": now_iso,
        })
