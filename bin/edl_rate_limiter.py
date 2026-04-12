"""
edl_rate_limiter.py
——————————————————————————————————————————————————————————————————————————
Token-bucket rate limiter for the EDL feed endpoint.

Two levels:
  1. Per-client IP:  10-request burst, 1 req/s sustained
  2. Global:         300 req/min across all clients

State is kept in a module-level dict (in-process, not persisted).
For multi-process Splunk deployments the limit applies per-worker process.
"""

import time
import threading
import logging

logger = logging.getLogger("edl_manager.rate_limiter")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PER_CLIENT_BURST       = 10        # tokens in the bucket at full capacity
PER_CLIENT_RATE        = 1.0       # tokens added per second (sustained rate)
GLOBAL_LIMIT           = 300       # max requests per global window
GLOBAL_WINDOW_SECONDS  = 60        # window duration for global limit

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
_lock          = threading.Lock()
_clients: dict = {}          # {client_key: {"tokens": float, "last": float}}
_global_window = {"start": 0.0, "count": 0}


def _refill(bucket: dict, now: float) -> None:
    """Add tokens to a client bucket based on elapsed time."""
    elapsed = now - bucket["last"]
    bucket["tokens"] = min(
        PER_CLIENT_BURST,
        bucket["tokens"] + elapsed * PER_CLIENT_RATE,
    )
    bucket["last"] = now


def check_feed_rate_limit(client_key: str) -> tuple[bool, float]:
    """
    Check whether a request from client_key should be allowed.

    Returns:
        (allowed: bool, retry_after: float)
            allowed      — True if the request should proceed
            retry_after  — seconds until the client may retry (0 if allowed)
    """
    now = time.monotonic()

    with _lock:
        # --- Global limit ---
        if now - _global_window["start"] >= GLOBAL_WINDOW_SECONDS:
            _global_window["start"] = now
            _global_window["count"] = 0

        if _global_window["count"] >= GLOBAL_LIMIT:
            retry = GLOBAL_WINDOW_SECONDS - (now - _global_window["start"])
            logger.warning("Global rate limit exceeded; retry_after=%.1fs", retry)
            return False, max(0.0, retry)

        _global_window["count"] += 1

        # --- Per-client token bucket ---
        if client_key not in _clients:
            _clients[client_key] = {"tokens": float(PER_CLIENT_BURST), "last": now}

        bucket = _clients[client_key]
        _refill(bucket, now)

        if bucket["tokens"] < 1.0:
            # Calculate when the next token will be available
            retry = (1.0 - bucket["tokens"]) / PER_CLIENT_RATE
            logger.warning("Client %s rate limited; retry_after=%.1fs", client_key, retry)
            return False, retry

        bucket["tokens"] -= 1.0
        return True, 0.0


def reset_limits() -> None:
    """Reset all rate limit state. Intended for testing only."""
    with _lock:
        _clients.clear()
        _global_window["start"] = 0.0
        _global_window["count"] = 0
