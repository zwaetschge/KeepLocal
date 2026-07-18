# Unraid files

The canonical Unraid template is
[`/unraid-template.xml`](../unraid-template.xml). It installs the published
all-in-one image and persists both MongoDB and private uploads.

The former `client.xml`, `server.xml`, and `mongodb.xml` templates were removed:
their client/server images are not published by the current release workflow,
and their runtime `REACT_APP_API_URL` setting cannot configure a Vite bundle
after it has been built. The former compose wrapper was also removed because it
was an XML description, not an executable Compose contract.

Use one of these supported paths:

- [All-in-one Unraid template](../unraid-template.xml)
- [Unraid installation and backup guide](../docs/unraid.md)
- [Split Docker Compose stack](../docker-compose.yml)
- [Docker build and rollback guide](../docs/docker.md)

Do not reintroduce split templates unless their images are published,
multi-architecture tested, and configured through a same-origin reverse proxy.
