"""
edl_geo_handler.py — v1.5
Geolocation enrichment for attack map.
Migrated to PersistentServerConnectionApplication.
"""
import json, logging
from edl_base_handler import SplunkRestHandler

logger = logging.getLogger("edl_manager.geo")

PRIVATE_RANGES = [
    ("10.0.0.0", "10.255.255.255"),
    ("172.16.0.0", "172.31.255.255"),
    ("192.168.0.0", "192.168.255.255"),
    ("127.0.0.0", "127.255.255.255"),
    ("100.64.0.0", "100.127.255.255"),
]


class GeoHandler(SplunkRestHandler):

    def _dispatch_GET(self, request):
        svc      = self._get_service(request)
        min_hits = int(self._query_param(request, "min_hits", 1) or 1)
        fmt      = (self._query_param(request, "format") or "clusters").lower()

        docs = self._kv_list(svc, "ioc_entries",
                             query={"type": "ip", "status": "active"})
        candidates = [d for d in docs
                      if int(d.get("hit_count", 0) or 0) >= min_hits
                      and not _is_private(d.get("value", ""))]
        enriched = _enrich_via_splunk(svc, candidates)

        if fmt == "map":
            return self._ok({"arcs": _build_arcs(enriched)})
        clusters = _build_clusters(enriched)
        return self._ok({"clusters": clusters, "total": len(enriched),
                         "generated_at": self._now_iso()})


def _is_private(ip):
    import socket, struct
    try:
        n = struct.unpack("!I", socket.inet_pton(socket.AF_INET, ip))[0]
        for lo, hi in PRIVATE_RANGES:
            l = struct.unpack("!I", socket.inet_pton(socket.AF_INET, lo))[0]
            h = struct.unpack("!I", socket.inet_pton(socket.AF_INET, hi))[0]
            if l <= n <= h:
                return True
    except Exception:
        pass
    return False


def _enrich_via_splunk(svc, docs):
    if not docs:
        return []
    values = list({d.get("value") for d in docs if d.get("value")})[:500]
    sep    = chr(7)
    spl    = (f'| makeresults count={len(values)} '
              f'| streamstats count as n '
              f'| eval value=mvindex(split("{sep.join(values)}","{sep}"),n-1) '
              f'| iplocation value '
              f'| table value, lat, lon, Country, City, Region')
    try:
        results = svc.jobs.oneshot(spl, output_mode="json")
        body    = results.body.read()
        if isinstance(body, bytes): body = body.decode()
        geo_rows = json.loads(body).get("results", [])
        geo_map  = {r["value"]: r for r in geo_rows if r.get("value")}
    except Exception as exc:
        logger.warning("iplocation search failed: %s", exc)
        geo_map = {}

    return [{**d, "lat": geo_map.get(d.get("value",""), {}).get("lat"),
             "lon": geo_map.get(d.get("value",""), {}).get("lon"),
             "country": geo_map.get(d.get("value",""), {}).get("Country",""),
             "city": geo_map.get(d.get("value",""), {}).get("City","")} for d in docs]


def _build_arcs(enriched):
    return [{"value": d["value"], "lat": d["lat"], "lon": d["lon"],
             "country": d["country"], "hit_count": d.get("hit_count", 1)}
            for d in enriched if d.get("lat") and d.get("lon")]


def _build_clusters(enriched):
    groups = {}
    for d in enriched:
        parts = d.get("value","").split(".")
        if len(parts) == 4:
            subnet = ".".join(parts[:3]) + ".0/24"
            groups.setdefault(subnet, []).append(d)
    clusters = []
    for subnet, entries in groups.items():
        hits = sum(int(e.get("hit_count", 0) or 0) for e in entries)
        uniq = len({e.get("value") for e in entries})
        conf = ("high" if uniq >= 3 and hits >= 10
                else "medium" if uniq >= 2 or hits >= 5 else "low")
        clusters.append({"cluster_key": subnet, "cluster_type": "subnet_24",
                         "cluster_label": subnet, "ioc_count": len(entries),
                         "total_hits": hits, "confidence": conf,
                         "country": entries[0].get("country",""),
                         "lat": entries[0].get("lat"),
                         "lon": entries[0].get("lon")})
    clusters.sort(key=lambda x: -x["total_hits"])
    return clusters
