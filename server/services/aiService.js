/**
 * AI Service
 * Handles communication with the AI microservice (Whisper transcription)
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai:5000';

/**
 * Transcribe audio file using Whisper AI service
 * @param {string} filePath - Path to audio file
 * @returns {Promise<Object>} Transcription result with text, language, and probability
 */
async function transcribeAudio(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error('Audio file not found on disk');
    }

    const form = new FormData();
    form.append('audio', fs.createReadStream(filePath));

    console.log(`[AI] Sending audio to ${AI_SERVICE_URL}/transcribe...`);
    const response = await axios.post(`${AI_SERVICE_URL}/transcribe`, form, {
      headers: {
        ...form.getHeaders(),
      },
      timeout: 300000 // 5 minutes timeout, transcription can take time
    });

    console.log(`[AI] Transcription successful: "${response.data.text.substring(0, 100)}..."`);
    return response.data;
  } catch (error) {
    console.error('[AI Service Error]', error.message);
    if (error.code === 'ECONNREFUSED') {
      throw new Error('AI Service ist nicht erreichbar. Läuft der Container?');
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
