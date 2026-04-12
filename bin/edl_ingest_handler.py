"""
edl_ingest_handler.py — v1.5
SPL macro ingest endpoint (delegates to ImportHandler).
"""
from edl_import_handler import ImportHandler

class IngestHandler(ImportHandler):
    """Thin alias — /ingest is the endpoint called by SPL macros."""
    pass
