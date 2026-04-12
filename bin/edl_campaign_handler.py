"""
edl_campaign_handler.py — v1.5
Campaign clustering and analysis. Migrated to PersistentServerConnectionApplication.
"""
import logging
from edl_base_handler import SplunkRestHandler
from edl_geo_handler   import _build_clusters, _enrich_via_splunk, _is_private

logger = logging.getLogger("edl_manager.campaigns")


class CampaignHandler(SplunkRestHandler):

    def _dispatch_GET(self, request):
        svc      = self._get_service(request)
        min_hits = int(self._query_param(request, "min_hits", 1) or 1)
        conf_f   = self._query_param(request, "confidence")

        docs = self._kv_list(svc, "ioc_entries",
                             query={"type": "ip", "status": "active"})
        candidates = [d for d in docs
                      if int(d.get("hit_count", 0) or 0) >= min_hits
                      and not _is_private(d.get("value", ""))]
        enriched = _enrich_via_splunk(svc, candidates)
        clusters = _build_clusters(enriched)
        if conf_f:
            clusters = [c for c in clusters if c.get("confidence") == conf_f]

        return self._ok({
            "clusters":       clusters,
            "total_clusters": len(clusters),
            "total_iocs":     len(enriched),
            "generated_at":   self._now_iso(),
        })
