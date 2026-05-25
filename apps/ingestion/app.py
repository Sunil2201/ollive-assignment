from __future__ import annotations

import logging
import os
import threading

from dotenv import load_dotenv
from flask import Flask
from consumer import run_consumer
from routes import ingest_bp

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)


app = Flask(__name__)
app.register_blueprint(ingest_bp)


def _start_consumer() -> threading.Thread:
    t = threading.Thread(target=run_consumer, name="ingestion-consumer", daemon=True)
    t.start()
    return t


if __name__ == "__main__":
    port = int(os.environ.get("INGESTION_PORT", 5001))
    _start_consumer()
    print(f" * Ingestion service running on http://0.0.0.0:{port}", flush=True)
    app.run(host="0.0.0.0", port=port, threaded=True)
