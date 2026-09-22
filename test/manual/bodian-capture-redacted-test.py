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

    def test_collection_mode_redacts_ids_and_ignores_auth_bodies(self):
        capture = module.RedactedCapture(collections=True)
        captured = []
        capture.emit = captured.append
        capture.response(SimpleNamespace(request=SimpleNamespace(host=module.HOST, path='/api/ucenter/login/qrCode')))
        self.assertTrue(capture.fresh_qr_seen)
        self.assertEqual(captured, [])
        request = SimpleNamespace(host=module.HOST, path='/api/service/collect/4/123456789', method='POST',
                                  query={'token': 'SECRET'}, content=b'{}', get_text=lambda **kwargs: '{"id":123456789,"type":4}')
        response = SimpleNamespace(status_code=200, content=b'{}', get_text=lambda **kwargs: '{"code":200}')
        capture.response(SimpleNamespace(request=request, response=response))
        self.assertEqual(captured[0]['path'], '/api/service/collect/4/:id')
        self.assertEqual(captured[0]['requestBody']['type'], 4)
        self.assertNotIn('123456789', json.dumps(captured))
        self.assertNotIn('SECRET', json.dumps(captured))


if __name__ == "__main__":
    unittest.main()
