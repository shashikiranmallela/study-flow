"""
StudyFlow backend (optional).

The website talks to Firebase (Auth + Firestore) directly from the browser,
so this service no longer has any job to do besides answering health checks.
That is intentional:
  * no serviceAccountKey.json is needed anymore (you can delete it everywhere)
  * no Firebase secrets live on the server
  * the old /api/user/init route (which could wipe any user's todos without
    logging in) has been removed

You can keep this service running, or simply suspend it in the Render dashboard.
"""
from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


@app.route("/")
def home():
    return jsonify({"message": "Study Flow Backend Running"}), 200


@app.route("/health")
def health():
    return jsonify({"status": "ok"}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)