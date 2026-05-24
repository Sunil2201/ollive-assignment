"""
Ingestion service entry point.

Responsibilities
----------------
1. Load environment variables from .env.
2. Create the Flask application and register the /ingest blueprint.
3. Start the Redis Streams consumer in a background daemon thread so that
   it runs alongside Flask and the process exits cleanly when Flask stops.
4. Serve HTTP on INGESTION_PORT (default 5001).

The consumer thread is a daemon so it does not prevent process exit — if
Flask's main thread finishes (e.g. KeyboardInterrupt), the consumer is
automatically torn down.
"""

from __future__ import annotations

import logging
import os
import threading

from dotenv import load_dotenv
from flask import Flask

load_dotenv()

from consumer import run_consumer  # noqa: E402 — must follow load_dotenv
from routes import ingest_bp       # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)

# ── Flask app ────────────────────────────────────────────────────────────────────

app = Flask(__name__)
app.register_blueprint(ingest_bp)


# ── Background consumer ──────────────────────────────────────────────────────────

def _start_consumer() -> threading.Thread:
    """Spawn the XREADGROUP loop as a daemon thread and return it."""
    t = threading.Thread(target=run_consumer, name="ingestion-consumer", daemon=True)
    t.start()
    return t


# ── Entry point ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("INGESTION_PORT", 5001))

    _start_consumer()

    print(f" * Ingestion service running on http://0.0.0.0:{port}", flush=True)
    app.run(host="0.0.0.0", port=port, threaded=True)
