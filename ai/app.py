from flask import Flask, request, jsonify
from faster_whisper import WhisperModel
import hmac
import os
import tempfile
import re

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 26 * 1024 * 1024

# Configuration
MODEL_SIZE = os.environ.get("WHISPER_MODEL", "tiny")  # tiny, base, small, medium, large
DEVICE = "cpu"
COMPUTE_TYPE = "int8"  # Quantization for CPU speed


def service_token():
    """Shared secret between the Node server and this service.

    Read per request (not at import time) so tests and reloads can change it.
    Unset means "deployment did not configure one" — the service stays open,
    which is only acceptable while it is reachable on loopback (all-in-one) or
    on a private backend network (split compose).
    """
    return os.environ.get("AI_SERVICE_TOKEN", "").strip()


def is_authorized():
    expected = service_token()
    if not expected:
        return True
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[len("Bearer "):].strip(), expected)


if not service_token():
    print("WARNING: AI_SERVICE_TOKEN is not set - /transcribe accepts requests "
          "from anyone who can reach this service.")

print(f"Loading Whisper Model: {MODEL_SIZE} on {DEVICE} ({COMPUTE_TYPE})...")
# Load model once at startup
model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
print("Model loaded successfully.")

@app.route('/health', methods=['GET'])
def health():
    # Health stays unauthenticated: container healthchecks and the server's
    # readiness probe call it, and it reveals nothing but the model size.
    return jsonify({"status": "ok", "model": MODEL_SIZE})

@app.route('/transcribe', methods=['POST'])
def transcribe():
    # Correlation id from the Node server (middleware/requestId.js), so one user
    # action can be followed across both services.
    request_id = request.headers.get('X-Request-Id', '-')
    if not is_authorized():
        app.logger.warning("Unauthorized transcription attempt request_id=%s", request_id)
        return jsonify({'error': 'Unauthorized', 'code': 'AI_UNAUTHORIZED'}), 401
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400

    audio_file = request.files['audio']

    # Get optional language parameter. 'auto' is what the app stores for
    # "detect automatically" - treat it as "no hint" instead of rejecting it.
    language = request.form.get('language', None)
    if language == 'auto':
        language = None
    if language and not re.fullmatch(r'[a-z]{2,3}(?:-[A-Z]{2})?', language):
        return jsonify({'error': 'Invalid language code'}), 400

    # faster-whisper needs a file path
    with tempfile.NamedTemporaryFile(suffix=".tmp", delete=True) as temp:
        audio_file.save(temp.name)

        try:
            # Beam size 5 is standard for accuracy
            # Pass language as a hint if provided
            transcribe_options = {'beam_size': 5}
            if language:
                transcribe_options['language'] = language

            segments, info = model.transcribe(temp.name, **transcribe_options)

            # Convert generator to list to get full text
            # This blocks until transcription is done
            text_segments = [segment.text for segment in segments]
            full_text = " ".join(text_segments).strip()[:10000]

            app.logger.info(
                "Transcribed request_id=%s language=%s chars=%d",
                request_id, info.language, len(full_text)
            )
            return jsonify({
                'text': full_text,
                'language': info.language,
                'probability': info.language_probability
            })
        except Exception:
            app.logger.exception("Transcription failed request_id=%s", request_id)
            return jsonify({'error': 'Transcription failed'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
