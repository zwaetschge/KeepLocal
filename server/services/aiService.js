/**
 * AI Service
 * Handles communication with the AI microservice (Whisper transcription)
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai:5000';
// Shared secret for the AI service. Read per call so tests (and a restart with a
// freshly generated token) do not need a module reload.
const aiServiceToken = () => (process.env.AI_SERVICE_TOKEN || '').trim();

/**
 * Transcribe audio file using Whisper AI service
 * @param {string} filePath - Path to audio file
 * @param {string} language - Language code (optional, e.g., 'de', 'en')
 * @param {string} [requestId] - Correlation id, logged by the AI service too
 * @returns {Promise<Object>} Transcription result with text, language, and probability
 */
async function transcribeAudio(filePath, language = null, requestId = null, signal = undefined) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error('Audio file not found on disk');
    }

    const form = new FormData();
    form.append('audio', fs.createReadStream(filePath));

    // Add language parameter if specified
    if (language) {
      form.append('language', language);
    }

    const response = await axios.post(`${AI_SERVICE_URL}/transcribe`, form, {
      headers: {
        ...form.getHeaders(),
        ...(requestId ? { 'X-Request-Id': requestId } : {}),
        ...(aiServiceToken() ? { Authorization: `Bearer ${aiServiceToken()}` } : {}),
      },
      timeout: 300000,
      maxBodyLength: 26 * 1024 * 1024,
      maxContentLength: 1024 * 1024,
      // v1.17.0: Abbruch-Signal der Route — ein disconnected Client stoppt
      // den Upstream-Call statt einen Geister-Job zu füttern.
      ...(signal ? { signal } : {})
    });

    return response.data;
  } catch (error) {
    const logger = require('../utils/logger');
    logger.error('AI service call failed', { requestId, message: error.message, code: error.code });
    if (error.code === 'ECONNREFUSED') {
      throw new Error('AI Service ist nicht erreichbar. Läuft der Container?');
    }
    if (error.response?.status === 401) {
      // The AI service rejected our shared token: misconfigured deployment, not
      // a user error. Never surface the token itself.
      throw new Error('AI Service lehnt die Anfrage ab (AI_SERVICE_TOKEN passt nicht)');
    }
    if (error.response?.status === 413) {
      // The audio exceeds the per-file length cap (MAX_AUDIO_SECONDS on the AI
      // service). This is a user-facing "shorten your recording", not a 500 —
      // carry status, stable code and the limit through for the route.
      const tooLong = new Error('Audio zu lang');
      tooLong.statusCode = 413;
      tooLong.code = error.response.data?.code || 'AUDIO_TOO_LONG';
      tooLong.maxSeconds = Number(error.response.data?.max_seconds) || undefined;
      throw tooLong;
    }
    if (error.response) {
      throw new Error(`AI Service error: ${error.response.data.error || error.response.statusText}`);
    }
    throw error;
  }
}

module.exports = {
  transcribeAudio
};
