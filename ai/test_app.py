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

# Audit 2026-09-12 (Top-30 Nr. 18): the duration probe reads the container
# header via PyAV (a direct dependency of faster-whisper). The fake below makes
# the probed duration configurable per test without any real media file.
PROBE_STATE = {"duration": None, "error": None}


class FakeStream:
    def __init__(self, duration):
        self.type = "audio"
        self.duration = duration  # in time_base units
        self.time_base = 1 / 1000.0  # milliseconds


class FakeContainer:
    def __init__(self, duration):
        self.streams = [FakeStream(duration)]
        self.duration = None  # container duration in microseconds

    def close(self):
        pass


def fake_av_open(_path):
    if PROBE_STATE["error"]:
        raise PROBE_STATE["error"]
    return FakeContainer(PROBE_STATE["duration"] * 1000 if PROBE_STATE["duration"] is not None else None)


fake_av = types.ModuleType("av")
fake_av.open = fake_av_open
sys.modules["av"] = fake_av

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


class AudioDurationLimitTest(unittest.TestCase):
    """Audit 2026-09-12 (Top-30 Nr. 18): budgets counted requests, not minutes.

    One multi-hour recording blocked the single Whisper worker far beyond any
    legitimate use. The service now probes the duration from the container
    header and refuses oversized audio with a stable 413 before decoding.
    """

    def setUp(self):
        self.client = app.test_client()
        PROBE_STATE["duration"] = None
        PROBE_STATE["error"] = None
        RECORDED_OPTIONS.clear()

    def post(self):
        return self.client.post(
            "/transcribe",
            data={"audio": (io.BytesIO(b"audio"), "sample.webm")},
            content_type="multipart/form-data"
        )

    def test_audio_within_the_limit_is_transcribed_and_reports_duration(self):
        PROBE_STATE["duration"] = 120.0  # 2 minutes — well under the 900 s default
        response = self.post()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["duration"], 120.0)
        self.assertEqual(len(RECORDED_OPTIONS), 1, "the model must have run")

    def test_audio_over_the_limit_is_rejected_before_the_model_runs(self):
        PROBE_STATE["duration"] = 5400.0  # 90 minutes
        response = self.post()
        self.assertEqual(response.status_code, 413)
        body = response.get_json()
        self.assertEqual(body["code"], "AUDIO_TOO_LONG")
        self.assertEqual(body["max_seconds"], 900)
        self.assertEqual(len(RECORDED_OPTIONS), 0, "no decoding for oversized audio")

    def test_the_limit_is_configurable_and_reports_minutes(self):
        with mock.patch.dict(os.environ, {"MAX_AUDIO_SECONDS": "60"}):
            PROBE_STATE["duration"] = 100.0
            response = self.post()
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.get_json()["max_seconds"], 60)
        self.assertEqual(response.get_json()["error"], "Audio is longer than 1 minutes")
        self.assertEqual(len(RECORDED_OPTIONS), 0)

    def test_invalid_limit_values_fall_back_to_the_default(self):
        from app import max_audio_seconds
        with mock.patch.dict(os.environ, {"MAX_AUDIO_SECONDS": "not-a-number"}):
            self.assertEqual(max_audio_seconds(), 900)
        with mock.patch.dict(os.environ, {"MAX_AUDIO_SECONDS": "-5"}):
            self.assertEqual(max_audio_seconds(), 900)

    def test_unknown_duration_is_allowed(self):
        # Chrome's MediaRecorder writes WebM without a header duration. Those
        # are legitimate recordings — they must not be rejected, only noted.
        PROBE_STATE["duration"] = None
        response = self.post()
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.get_json()["duration"])
        self.assertEqual(len(RECORDED_OPTIONS), 1)

    def test_a_failing_probe_does_not_block_transcription(self):
        PROBE_STATE["error"] = RuntimeError("no decodable header")
        response = self.post()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(RECORDED_OPTIONS), 1)


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
