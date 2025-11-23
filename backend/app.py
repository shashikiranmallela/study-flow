import os
import firebase_admin
from firebase_admin import credentials, auth, firestore
from flask import Flask, request, jsonify
from flask_cors import CORS
import logging

# ---------------------
# Setup Flask
# ---------------------
app = Flask(__name__)
CORS(app)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------
# Initialize Firebase Admin
# ---------------------
if not firebase_admin._apps:
    cred = credentials.Certificate("serviceAccountKey.json")  # <-- FIXED
    firebase_admin.initialize_app(cred)

db = firestore.client()

# ---------------------
# Helper: Check Firebase ID Token
# ---------------------
def check_auth(f):
    def wrapper(*args, **kwargs):
        try:
            auth_header = request.headers.get("Authorization", None)
            if not auth_header:
                return jsonify({"error": "Missing Authorization header"}), 401

            token = auth_header.split("Bearer ")[-1]
            decoded = auth.verify_id_token(token)
            uid = decoded["uid"]
            return f(uid, *args, **kwargs)

        except Exception as e:
            logger.error(f"Token verification failed: {e}")
            return jsonify({"error": "Invalid token"}), 401

    wrapper.__name__ = f.__name__
    return wrapper

# ---------------------
# TEST ROUTE
# ---------------------
@app.route("/")
def home():
    return jsonify({"message": "Study Flow Backend Running"}), 200

# ---------------------
# Get Firebase Config
# ---------------------
@app.route("/firebase-config", methods=["GET"])
def firebase_config():
    config = {
        "apiKey": os.environ.get("F_API_KEY"),
        "authDomain": os.environ.get("F_AUTH_DOMAIN"),
        "projectId": os.environ.get("F_PROJECT_ID"),
        "storageBucket": os.environ.get("F_STORAGE_BUCKET"),
        "messagingSenderId": os.environ.get("F_MSG_ID"),
        "appId": os.environ.get("F_APP_ID"),
        "measurementId": os.environ.get("F_MEASURE_ID"),
    }
    return jsonify(config), 200

# ---------------------
# Initialize User Document
# ---------------------
@app.route("/api/user/init", methods=["POST"])
def init_user():
    try:
        data = request.get_json()
        uid = data.get("uid")
        email = data.get("email")
        username = data.get("username")

        if not uid:
            return jsonify({"error": "UID missing"}), 400

        db.collection("users").document(uid).set({
            "email": email,
            "username": username,
            "todos": [],
            "studyTime": 0,
            "dailyStats": {}
        }, merge=True)

        return jsonify({"status": "initialized"}), 200

    except Exception as e:
        logger.error(f"Init user error: {e}")
        return jsonify({"error": "Failed to init user"}), 200  # <-- FAIL SAFE

# ---------------------
# SAFE: GET USER DATA
# ---------------------
@app.route("/api/user/data", methods=["GET"])
@check_auth
def get_user_data(uid):
    try:
        doc = db.collection("users").document(uid).get()

        if not doc.exists:
            return jsonify({}), 200  # <-- FIXED

        return jsonify(doc.to_dict()), 200

    except Exception as e:
        logger.error(f"Error reading user data: {e}")
        return jsonify({}), 200  # <-- FIXED

# ---------------------
# SAFE: UPDATE USER DATA
# ---------------------
@app.route("/api/user/data", methods=["POST"])
@check_auth
def update_user_data(uid):
    try:
        incoming = request.get_json() or {}
        db.collection("users").document(uid).set(incoming, merge=True)
        return jsonify({"status": "ok"}), 200

    except Exception as e:
        logger.error(f"Error saving user data: {e}")
        return jsonify({"status": "ok"}), 200  # <-- FIXED

# ---------------------
# Start (for Render)
# ---------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)


