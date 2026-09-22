import hashlib
import hmac
import json
import re
import secrets
import time
from pathlib import Path
from urllib.parse import urlsplit

# test/manual/bodian-capture-redacted.py
# Only fresh-login protocol structure is recorded; never write raw flows or credentials.
HOST = "bd-api.kuwo.cn"
PATHS = {
    "/api/ucenter/login/qrCode",
    "/api/ucenter/login/qrCodeStatus",
    "/api/ucenter/users/login",
}
SENSITIVE = ("token", "secret", "password", "phone", "mobile", "cookie", "sign", "avatar", "nickname", "headimg")


class RedactedCapture:
    def __init__(self, output=None, collections=False):
        self.collections = collections
        default_name = "collections-redacted.jsonl" if collections else "redacted.jsonl"
        self.output = Path(output or f"test-results/bodian-capture/{default_name}")
        self.key = secrets.token_bytes(32)
        self.started = time.monotonic()
        self.fresh_qr_seen = False

    def shape(self, value, field="", depth=0):
        # Per-run HMAC correlates opaque exchange fields without retaining their values.
        if any(part in field.lower() for part in SENSITIVE):
            return "[redacted]"
        if depth > 6:
            return "[depth-limit]"
        if isinstance(value, dict):
            return {str(k): self.shape(v, str(k), depth + 1) for k, v in list(value.items())[:80]}
        if isinstance(value, list):
            return {"type": "array", "length": len(value), "sample": [self.shape(v, depth=depth + 1) for v in value[:1]]}
        if value is None or isinstance(value, bool):
            return value
        if field in {"authType", "status"} and isinstance(value, int):
            return value
        if self.collections and field in {"type", "source", "sourceType", "collectType"} and isinstance(value, int) and 0 <= value <= 10:
            return value
        digest = hmac.new(self.key, str(value).encode(), hashlib.sha256).hexdigest()[:20]
        return {"type": type(value).__name__, "match": digest}

    def emit(self, record):
        self.output.parent.mkdir(parents=True, exist_ok=True)
        with self.output.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, ensure_ascii=True) + "\n")

    def response(self, flow):
        path = urlsplit(flow.request.path).path
        collection_path = bool(re.fullmatch(r"/api/service/collect(?:/[A-Za-z0-9_-]+)*", path))
        if flow.request.host != HOST or not (path in PATHS or self.collections and collection_path):
            return
        if time.monotonic() - self.started > 600:
            return
        # Ignore restore/login traffic until a new QR has actually been requested.
        if path.endswith("/qrCode"):
            self.fresh_qr_seen = True
        if not self.fresh_qr_seen:
            return
        if self.collections and not collection_path:
            return
        if self.collections:
            # Keep the resource type (4/6/7), but never record playlist/album/user IDs in URLs.
            parts = path.split('/')
            path = '/'.join(':id' if part.isdigit() and (index != 4 or part not in {'4', '6', '7'}) else part
                            for index, part in enumerate(parts))
        record = {"path": path, "method": flow.request.method, "httpStatus": flow.response.status_code}
        record["query"] = self.shape(dict(flow.request.query))
        for label, message in (("requestBody", flow.request), ("responseBody", flow.response)):
            try:
                if len(message.content or b"") > 262144:
                    record[label] = "[size-limit]"
                else:
                    parsed = json.loads(message.get_text(strict=False) or "null")
                    record[label] = self.shape(parsed)
                    if label == "responseBody" and isinstance(parsed, dict) and isinstance(parsed.get("code"), int):
                        record["businessCode"] = parsed["code"]
            except (ValueError, TypeError):
                record[label] = "[non-json]"
        self.emit(record)


addons = [RedactedCapture()]
