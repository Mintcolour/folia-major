import asyncio
import json
import sys
from pathlib import Path

from mitmproxy.options import Options
from mitmproxy.tools.dump import DumpMaster

# test/manual/bodian-capture-network-test.py
# Anonymous end-to-end capture test. No official-client process or global trust changes.
async def main():
    child = await asyncio.create_subprocess_exec(
        sys.executable, str(Path(__file__).with_name('bodian-capture-test-client.py')),
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    actual_pid = json.loads(await child.stdout.readline())['pid']
    master = DumpMaster(Options(mode=[f'local:{actual_pid}'],
        confdir=str(Path('test-results/bodian-capture').resolve()),
        allow_hosts=[r'^bd-api\.kuwo\.cn(?::443)?$']), with_termlog=False, with_dumper=False)
    counts = dict(requests=0, responses=0, tls_failed=0)

    class Probe:
        def request(self, flow):
            counts['requests'] += 1

        def response(self, flow):
            counts['responses'] += 1

        def tls_failed_client(self, data):
            counts['tls_failed'] += 1

        async def running(self):
            await asyncio.sleep(2)
            print(json.dumps({'servers': [{'running': server.is_running, 'error': str(server.last_exception) if server.last_exception else None}
                                           for server in master.addons.get('proxyserver').servers]}))
            child.stdin.write(b'go\n')
            await child.stdin.drain()

    master.addons.add(Probe())
    task = asyncio.create_task(master.run())
    try:
        stdout = await asyncio.wait_for(child.stdout.read(), timeout=40)
        stderr = await child.stderr.read()
        await child.wait()
        print(stdout.decode().strip())
        print(json.dumps({'capture': counts, 'client_exit': child.returncode,
                          'client_stderr_present': bool(stderr)}))
    finally:
        if child.returncode is None:
            child.kill()
            await child.wait()
        master.shutdown()
        await task


if __name__ == '__main__':
    asyncio.run(main())
