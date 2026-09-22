import http.client
import json
import os
import ssl
import sys
from pathlib import Path

# test/manual/bodian-capture-test-client.py
# Trust the test CA only inside this disposable, anonymous test process.
print(json.dumps({'pid': os.getpid()}), flush=True)
sys.stdin.readline()
context = ssl.create_default_context()
context.load_verify_locations(str(Path('test-results/bodian-capture/mitmproxy-ca-cert.pem').resolve()))
connection = http.client.HTTPSConnection('bd-api.kuwo.cn', context=context, timeout=15)
try:
    connection.connect()
    issuer = str(connection.sock.getpeercert().get('issuer', ()))
    connection.request('GET', '/api/search/music/list?keyword=test&pn=0&rn=1&correct=1', headers={
        'User-Agent': 'Dart/3.3 (dart:io)', 'plat': 'win', 'channel': 'W1', 'ver': '1.1.7',
        'svrver': '13', 'api-ver': 'application/json', 'brand': 'Windows', 'net': 'wifi',
        'devid': '0123456789abcdef0123456789abcdef', 'qimei36': '0123456789abcdef0123456789abcdef'})
    response = connection.getresponse()
    body = json.loads(response.read(262144))
    print(json.dumps({'httpStatus': response.status, 'businessCode': body.get('code'),
                      'proxyCertificate': 'mitmproxy' in issuer.lower()}))
except Exception as error:
    print(json.dumps({'client_error': type(error).__name__}))
finally:
    connection.close()
