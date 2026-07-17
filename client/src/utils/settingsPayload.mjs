export const DEFAULT_SETTINGS = {
  aiFeatures: {
    voiceTranscription: false
  },
  transcriptionLanguage: 'auto'
};

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeSettings(value) {
  const source = isRecord(value) ? value : {};
  const aiFeatures = isRecord(source.aiFeatures) ? source.aiFeatures : {};
  const transcriptionLanguage = typeof source.transcriptionLanguage === 'string'
    && source.transcriptionLanguage.length <= 20
    ? source.transcriptionLanguage
    : DEFAULT_SETTINGS.transcriptionLanguage;

  return {
    ...DEFAULT_SETTINGS,
    ...source,
    aiFeatures: {
      ...DEFAULT_SETTINGS.aiFeatures,
      voiceTranscription: aiFeatures.voiceTranscription === true
    },
    transcriptionLanguage
  };
}
