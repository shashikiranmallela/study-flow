import os
import json
from flask import Flask, request, jsonify
from functools import wraps
import firebase_admin
from firebase_admin import auth as firebase_auth, credentials, firestore
from flask_cors import CORS
import logging

app = Flask(__name__)

# Enable CORS for frontend requests
CORS(app, resources={
    r"/*": {
        "origins": os.environ.get('FRONTEND_ORIGIN', '*'),
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Firebase Admin
SERVICE_ACCOUNT_PATH = os.path.join(os.path.dirname(__file__), "serviceAccountKey.json")

if not firebase_admin._apps:
    try:
        cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
        firebase_admin.initialize_app(cred)
        db = firestore.client()
        logger.info("Firebase Admin initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize Firebase: {e}")
        raise
else:
    db = firestore.client()

@app.route('/firebase-config')
def firebase_config():
    """Serve Firebase config to frontend"""
    try:
        return jsonify({
            "apiKey": os.environ.get("F_API_KEY", ""),
            "authDomain": os.environ.get("F_AUTH_DOMAIN", ""),
            "projectId": os.environ.get("F_PROJECT_ID", ""),
            "storageBucket": os.environ.get("F_STORAGE_BUCKET", ""),
            "messagingSenderId": os.environ.get("F_MSG_ID", ""),
            "appId": os.environ.get("F_APP_ID", ""),
            "measurementId": os.environ.get("F_MEASURE_ID", "")
        })
    except Exception as e:
        logger.error(f"Error serving Firebase config: {e}")
        return jsonify({"error": "Failed to load Firebase config"}), 500

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        try:
            header = request.headers.get('Authorization', '')
            if not header.startswith('Bearer '):
                return jsonify({'error': 'Authorization header missing'}), 401
            id_token = header.split('Bearer ')[1]
            decoded = firebase_auth.verify_id_token(id_token)
            request.user = decoded
            return f(*args, **kwargs)
        except firebase_auth.InvalidIdTokenError:
            return jsonify({'error': 'Invalid or expired token'}), 401
        except firebase_auth.ExpiredIdTokenError:
            return jsonify({'error': 'Token has expired'}), 401
        except Exception as e:
            logger.error(f"Auth error: {e}")
            return jsonify({'error': 'Authentication failed'}), 401
    return decorated

@app.route('/api/profile', methods=['GET'])
@require_auth
def profile():
    """Get user profile from Firestore"""
    try:
        uid = request.user.get("uid")
        email = request.user.get("email")
        
        user_doc = db.collection('users').document(uid).get()
        user_data = user_doc.to_dict() if user_doc.exists else {}
        
        return jsonify({
            "uid": uid,
            "email": email,
            "username": user_data.get("username", "User"),
            "theme": user_data.get("theme", "light")
        })
    except Exception as e:
        logger.error(f"Error fetching profile: {e}")
        return jsonify({"error": "Failed to fetch profile"}), 500

@app.route('/api/user/data', methods=['GET'])
@require_auth
def get_user_data():
    """Get all user app data from Firestore"""
    try:
        uid = request.user.get("uid")
        user_doc = db.collection('users').document(uid).get()
        
        if not user_doc.exists:
            return jsonify({
                "todos": [],
                "timeSessions": [],
                "routine": [],
                "username": "User",
                "theme": "light"
            })
        
        return jsonify(user_doc.to_dict())
    except Exception as e:
        logger.error(f"Error fetching user data: {e}")
        return jsonify({"error": "Failed to fetch user data"}), 500

@app.route('/api/user/data', methods=['POST'])
@require_auth
def save_user_data():
    """Save/update all user app data to Firestore"""
    try:
        uid = request.user.get("uid")
        data = request.get_json()
        
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        db.collection('users').document(uid).set(data, merge=True)
        return jsonify({"success": True, "message": "Data saved successfully"})
    except Exception as e:
        logger.error(f"Error saving user data: {e}")
        return jsonify({"error": "Failed to save user data"}), 500

@app.route('/api/user/init', methods=['POST'])
def init_user():
    """Initialize new user document"""
    try:
        data = request.get_json()
        uid = data.get('uid')
        email = data.get('email')
        username = data.get('username', 'User')
        
        if not uid or not email:
            return jsonify({"error": "Missing uid or email"}), 400
        
        user_data = {
            "uid": uid,
            "email": email,
            "username": username,
            "theme": "light",
            "todos": [],
            "timeSessions": [],
            "routine": [],
            "createdAt": firestore.SERVER_TIMESTAMP
        }
        
        db.collection('users').document(uid).set(user_data, merge=True)
        return jsonify({"success": True, "message": "User initialized"})
    except Exception as e:
        logger.error(f"Error initializing user: {e}")
        return jsonify({"error": "Failed to initialize user"}), 500

@app.route('/health')
def health():
    """Health check endpoint"""
    try:
        return jsonify({"status": "ok"})
    except Exception as e:
        logger.error(f"Health check error: {e}")
        return jsonify({"status": "error"}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Endpoint not found"}), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal server error: {error}")
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
