import os

from gevent import monkey
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from routes.chat import chat_bp
from routes.conversations import conversations_bp
from routes.metrics import metrics_bp

load_dotenv(override=True)  # always prefer .env over system environment variables
monkey.patch_all()

app = Flask(__name__)
CORS(
    app,
    origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_headers=["Content-Type", "X-Session-ID"],
    methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    supports_credentials=False,
)

app.register_blueprint(chat_bp)
app.register_blueprint(conversations_bp)
app.register_blueprint(metrics_bp)

@app.before_request
def log_request():
    print(f"{request.method} {request.path}", flush=True)


@app.errorhandler(400)
def handle_bad_request(_):
    return jsonify({"error": "bad request"}), 400


@app.errorhandler(404)
def handle_not_found(_):
    return jsonify({"error": "not found"}), 404


@app.errorhandler(405)
def handle_method_not_allowed(_):
    return jsonify({"error": "method not allowed"}), 405


@app.errorhandler(Exception)
def handle_exception(exc: Exception):
    app.logger.exception("Unhandled exception: %s", exc)
    return jsonify({"error": "internal server error"}), 500


if __name__ == "__main__":
    port = int(os.environ.get("FLASK_PORT", 5000))
    from gevent.pywsgi import WSGIServer
    server = WSGIServer(('0.0.0.0', port), app)
    print(f" * Running on http://0.0.0.0:{port} (gevent)", flush=True)
    server.serve_forever()
