import os
from flask import Flask, request, jsonify
from functools import wraps
import firebase_admin
from firebase_admin import auth as firebase_auth, credentials

app = Flask(__name__)

# Option A: Load serviceAccountKey.json directly
SERVICE_ACCOUNT_PATH = os.path.join(os.path.dirname(__file__), "serviceAccountKey.json")

if not firebase_admin._apps:
    cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
    firebase_admin.initialize_app(cred)

@app.route('/firebase-config')
def firebase_config():
    return {
        "apiKey": os.environ.get("F_API_KEY"),
        "authDomain": os.environ.get("F_AUTH_DOMAIN"),
        "projectId": os.environ.get("F_PROJECT_ID"),
        "storageBucket": os.environ.get("F_STORAGE_BUCKET"),
        "messagingSenderId": os.environ.get("F_MSG_ID"),
        "appId": os.environ.get("F_APP_ID"),
        "measurementId": os.environ.get("F_MEASURE_ID")
    }

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        header = request.headers.get('Authorization', '')
        if not header.startswith('Bearer '):
            return jsonify({'error': 'Authorization header missing'}), 401
        id_token = header.split('Bearer ')[1]
        try:
            decoded = firebase_auth.verify_id_token(id_token)
            request.user = decoded
            return f(*args, **kwargs)
        except Exception as e:
            return jsonify({'error': 'Invalid token', 'details': str(e)}), 401
    return decorated

@app.route('/api/profile', methods=['GET'])
@require_auth
def profile():
    u = request.user
    return jsonify({"uid": u.get("uid"), "email": u.get("email")})

@app.route('/health')
def health():
    return {"status": "ok"}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
