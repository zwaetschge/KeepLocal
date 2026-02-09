const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'KeepLocal API',
      version: '1.0.0',
      description: `
## KeepLocal REST API

Externe API für den Zugriff auf deine KeepLocal-Notizen von Scripts, Apps und Automatisierungen.

### Authentifizierung

Alle API-Endpunkte erfordern einen **API-Key**. Erstelle einen Key über die Web-Oberfläche unter Einstellungen → API-Keys, oder nutze den JWT-authentifizierten Endpunkt \`POST /api/api-keys\`.

Sende den Key im \`X-API-Key\` Header:

\`\`\`
curl -H "X-API-Key: kl_dein_api_key_hier" https://dein-server/api/v1/notes
\`\`\`

### Rate Limiting

- 500 Requests pro 15 Minuten pro IP
- Bei Überschreitung: HTTP 429

### Fehlerformat

Alle Fehler folgen dem gleichen Format:
\`\`\`json
{
  "success": false,
  "error": "Fehlerbeschreibung"
}
\`\`\`
`,
      contact: {
        name: 'KeepLocal',
      },
      license: {
        name: 'MIT',
      }
    },
    servers: [
      {
        url: '/',
        description: 'Aktueller Server'
      }
    ],
    components: {
      securitySchemes: {
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API-Key für externen Zugriff. Erstelle einen Key unter Einstellungen → API-Keys.'
        },
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT-Token aus dem Login-Endpunkt'
        }
      }
    },
    tags: [
      {
        name: 'Notes',
        description: 'Notizen erstellen, lesen, aktualisieren und löschen'
      },
      {
        name: 'Tags',
        description: 'Tags der eigenen Notizen abrufen'
      },
      {
        name: 'User',
        description: 'Benutzer-Profil'
      },
      {
        name: 'API Keys',
        description: 'API-Keys verwalten (erfordert JWT-Auth aus der Web-Oberfläche)'
      }
    ]
  },
  apis: [
    './routes/v1/*.js',
    './routes/apiKeys.js'
  ]
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
