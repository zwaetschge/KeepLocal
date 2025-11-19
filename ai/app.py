from flask import Flask, request, jsonify
from faster_whisper import WhisperModel
import os
import tempfile

app = Flask(__name__)

# Configuration
MODEL_SIZE = os.environ.get("WHISPER_MODEL", "tiny")  # tiny, base, small, medium, large
DEVICE = "cpu"
COMPUTE_TYPE = "int8"  # Quantization for CPU speed

print(f"Loading Whisper Model: {MODEL_SIZE} on {DEVICE} ({COMPUTE_TYPE})...")
# Load model once at startup
model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
print("Model loaded successfully.")

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "model": MODEL_SIZE})

@app.route('/transcribe', methods=['POST'])
def transcribe():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400

    audio_file = request.files['audio']

    # Get optional language parameter
    language = request.form.get('language', None)
    if language:
        print(f"Language hint provided: {language}")

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
            full_text = " ".join(text_segments).strip()

            return jsonify({
                'text': full_text,
                'language': info.language,
                'probability': info.language_probability
            })
        except Exception as e:
            print(f"Error during transcription: {e}")
            return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
