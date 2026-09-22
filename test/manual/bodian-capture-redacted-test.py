import importlib.util
import json
import unittest
from pathlib import Path
from types import SimpleNamespace

# test/manual/bodian-capture-redacted-test.py
# Offline checks: do not connect to any proxy or account.
spec = importlib.util.spec_from_file_location("capture", Path(__file__).with_name("bodian-capture-redacted.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CaptureTests(unittest.TestCase):
    def test_redaction_and_correlation(self):
        capture = module.RedactedCapture()
        result = capture.shape({"token": "SECRET", "nickname": "PERSON", "authType": 4,
                                "qrCode": "QR_SECRET", "nested": {"code": "QR_SECRET"}})
        text = json.dumps(result)
        for secret in ("SECRET", "PERSON", "QR_SECRET"):
            self.assertNotIn(secret, text)
        self.assertEqual(result["authType"], 4)
        self.assertEqual(result["qrCode"], result["nested"]["code"])
        self.assertNotEqual(result["qrCode"], module.RedactedCapture().shape("QR_SECRET"))

    def test_ignores_other_paths_and_preexisting_login(self):
        capture = module.RedactedCapture()
        captured = []
        capture.emit = captured.append
        for host, path in ((module.HOST, "/api/ucenter/users/login"),
                           (module.HOST, "/api/service/playlist/userCreate"),
                           ("example.org", "/api/ucenter/login/qrCode")):
            capture.response(SimpleNamespace(request=SimpleNamespace(host=host, path=path)))
        self.assertEqual(captured, [])


if __name__ == "__main__":
    unittest.main()
