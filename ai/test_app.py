import io
import os
import sys
import types
import unittest
from unittest import mock


class FakeWhisperModel:
    def __init__(self, *args, **kwargs):
        pass

    def transcribe(self, _path, **options):
        RECORDED_OPTIONS.append(options)
        segments = [types.SimpleNamespace(text="x" * 10001)]
        info = types.SimpleNamespace(language="de", language_probability=0.99)
        return segments, info


RECORDED_OPTIONS = []


fake_whisper = types.ModuleType("faster_whisper")
fake_whisper.WhisperModel = FakeWhisperModel
sys.modules["faster_whisper"] = fake_whisper

from app import app  # noqa: E402


class TranscriptionApiTest(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_health_reports_loaded_model(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "ok")

    def test_transcription_requires_audio(self):
        response = self.client.post("/transcribe")
        self.assertEqual(response.status_code, 400)

    def test_language_codes_are_validated(self):
        response = self.client.post(
            "/transcribe",
            data={"audio": (io.BytesIO(b"audio"), "sample.webm"), "language": "../../etc"},
            content_type="multipart/form-data"
        )
        self.assertEqual(response.status_code, 400)

    def test_transcription_output_is_bounded(self):
        response = self.client.post(
            "/transcribe",
            data={"audio": (io.BytesIO(b"audio"), "sample.webm"), "language": "de"},
            content_type="multipart/form-data"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.get_json()["text"]), 10000)

    def test_auto_language_means_no_hint(self):
        # "auto" is what the web app stores for "detect automatically"; it must
        # not be rejected as an invalid code nor passed to Whisper as a hint.
        RECORDED_OPTIONS.clear()
        response = self.client.post(
            "/transcribe",
            data={"audio": (io.BytesIO(b"audio"), "sample.webm"), "language": "auto"},
            content_type="multipart/form-data"
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("language", RECORDED_OPTIONS[-1])
        self.assertEqual(RECORDED_OPTIONS[-1]["beam_size"], 5)


class ServiceTokenTest(unittest.TestCase):
    """Audit 2026-09-12 (Top-30 Nr. 9): /transcribe ran without any credential.

    Whoever could reach the service (a published AI port in a split compose, or
    anything else on the backend network) could transcribe audio on this host's
    CPU for free. A shared bearer token between the Node server and Flask closes
    that; /health deliberately stays open for the container healthchecks.
    """

    def setUp(self):
        self.client = app.test_client()

    def post(self, headers=None):
        # Fresh BytesIO per request: werkzeug consumes (and closes) the stream.
        return self.client.post(
            "/transcribe",
            data={"audio": (io.BytesIO(b"audio"), "sample.webm")},
            content_type="multipart/form-data",
            headers=headers or {}
        )

    def test_without_token_the_service_stays_reachable(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("AI_SERVICE_TOKEN", None)
            self.assertEqual(self.post().status_code, 200)

    def test_with_token_anonymous_requests_are_rejected(self):
        with mock.patch.dict(os.environ, {"AI_SERVICE_TOKEN": "s3cret-token"}):
            self.assertEqual(self.post().status_code, 401)
            self.assertEqual(self.post().get_json()["code"], "AI_UNAUTHORIZED")
            self.assertEqual(self.post({"Authorization": "Bearer wrong"}).status_code, 401)
            self.assertEqual(self.post({"Authorization": "s3cret-token"}).status_code, 401)

    def test_with_token_the_server_header_is_accepted(self):
        with mock.patch.dict(os.environ, {"AI_SERVICE_TOKEN": "s3cret-token"}):
            self.assertEqual(self.post({"Authorization": "Bearer s3cret-token"}).status_code, 200)

    def test_health_never_requires_the_token(self):
        with mock.patch.dict(os.environ, {"AI_SERVICE_TOKEN": "s3cret-token"}):
            self.assertEqual(self.client.get("/health").status_code, 200)


if __name__ == "__main__":
    unittest.main()
