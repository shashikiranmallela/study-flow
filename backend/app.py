# app.py - Flask backend that verifies Firebase ID tokens
import os
from flask import Flask, request, jsonify
from functools import wraps
import firebase_admin
from firebase_admin import auth as firebase_auth, credentials

app = Flask(__name__)

SERVICE_ACCOUNT_PATH = os.environ.get('FIREBASE_SERVICE_ACCOUNT_JSON', 'serviceAccountKey.json')
if not firebase_admin._apps:
    cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
    firebase_admin.initialize_app(cred)

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        header = request.headers.get('Authorization', '')
        if not header.startswith('Bearer '):
            return jsonify({'error': 'Authorization header missing or malformed'}), 401
        id_token = header.split('Bearer ')[1]
        try:
            decoded_token = firebase_auth.verify_id_token(id_token)
            request.user = decoded_token
            return f(*args, **kwargs)
        except Exception as e:
            return jsonify({'error': 'Invalid auth token', 'details': str(e)}), 401
    return decorated

@app.route('/api/profile', methods=['GET'])
@require_auth
def profile():
    user = request.user
    return jsonify({
        'uid': user.get('uid'),
        'email': user.get('email'),
        'name': user.get('name') or user.get('email','').split('@')[0]
    })

@app.route('/api/backup-data', methods=['POST'])
@require_auth
def backup_data():
    payload = request.json.get('appData', {})
    return jsonify({'status':'ok','receivedKeys': list(payload.keys())})

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status':'ok'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
