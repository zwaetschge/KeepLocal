import io
import sys
import types
import unittest


class FakeWhisperModel:
    def __init__(self, *args, **kwargs):
        pass

    def transcribe(self, _path, **_options):
        segments = [types.SimpleNamespace(text="x" * 10001)]
        info = types.SimpleNamespace(language="de", language_probability=0.99)
        return segments, info


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


if __name__ == "__main__":
    unittest.main()
