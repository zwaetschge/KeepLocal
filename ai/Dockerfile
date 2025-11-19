FROM python:3.9-slim

WORKDIR /app

# Install system dependencies (ffmpeg for audio, curl for healthcheck)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Pre-download the model to bake it into the image (optional but recommended for speed)
# This prevents downloading 75MB-1.5GB on every container start if the volume is missing
RUN python3 -c "from faster_whisper import WhisperModel; WhisperModel('tiny', device='cpu', compute_type='int8')"

EXPOSE 5000

# Use Gunicorn for production stability
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--timeout", "300", "app:app"]
