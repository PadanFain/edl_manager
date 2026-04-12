"""
edl_hits_handler.py — v1.5
IOC hit recording. Migrated to PersistentServerConnectionApplication.
"""
import logging
from edl_base_handler import SplunkRestHandler

logger = logging.getLogger("edl_manager.hits")


class HitsHandler(SplunkRestHandler):

    def _dispatch_POST(self, request):
        svc  = self._get_service(request)
        body = self._parse_body(request)
        hits = body.get("hits", [])
        now  = self._now_iso()
        updated, failed = 0, 0
        for hit in hits:
            key = hit.get("_key") or hit.get("key")
            if not key:
                failed += 1; continue
            try:
                doc = self._kv_get(svc, "ioc_entries", key)
                if not doc:
                    failed += 1; continue
                doc["hit_count"]   = int(doc.get("hit_count", 0) or 0) + int(hit.get("count", 1))
                doc["last_hit_at"] = hit.get("last_seen") or now
                self._kv_update(svc, "ioc_entries", key, doc)
                updated += 1
            except Exception as exc:
                logger.warning("Hit update failed %s: %s", key, exc)
                failed += 1
        return self._ok({"updated": updated, "failed": failed})
