FROM ubuntu:22.04

ARG WHISPER_MODEL=tiny
ENV DEBIAN_FRONTEND=noninteractive \
    WHISPER_MODEL=${WHISPER_MODEL} \
    HF_HOME=/home/keeplocal/.cache/huggingface

WORKDIR /app

# Install system dependencies (ffmpeg for audio, curl for healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ffmpeg \
    curl \
    python3 \
    python3-pip \
    python3-dev \
    pkg-config \
    libavformat-dev \
    libavcodec-dev \
    libavdevice-dev \
    libavutil-dev \
    libavfilter-dev \
    libswscale-dev \
    libswresample-dev \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip3 install --no-cache-dir --upgrade pip setuptools wheel \
    && pip3 install --no-cache-dir -r requirements.txt

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin keeplocal \
    && mkdir -p "$HF_HOME" \
    && chown -R keeplocal:keeplocal /app /home/keeplocal

# Copy application
COPY --chown=keeplocal:keeplocal . .

USER keeplocal

# Pre-download the model to bake it into the image (optional but recommended for speed)
# This prevents downloading 75MB-1.5GB on every container start if the volume is missing
RUN python3 -c "import os; from faster_whisper import download_model; download_model(os.environ['WHISPER_MODEL'])"

EXPOSE 5000

# Use Gunicorn for production stability
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--timeout", "300", "app:app"]
