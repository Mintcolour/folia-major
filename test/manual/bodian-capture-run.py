import argparse
import asyncio
import importlib.util
import json
from pathlib import Path

from mitmproxy.options import Options
from mitmproxy.tools.dump import DumpMaster

# test/manual/bodian-capture-run.py
# Process-scoped capture, no system proxy changes, no raw flow/event logging.
async def main():
    parser = argparse.ArgumentParser()
    target_group = parser.add_mutually_exclusive_group()
    target_group.add_argument("--pid", type=int)
    target_group.add_argument("--official-process", action="store_true")
    parser.add_argument("--collections", action="store_true")
    args = parser.parse_args()
    if args.pid is not None and args.pid <= 0:
        raise ValueError("Invalid process id")
    capture_dir = Path("test-results/bodian-capture").resolve()
    capture_dir.mkdir(parents=True, exist_ok=True)
    # The readiness check targets a nonexistent executable, never all local processes.
    active_capture = bool(args.pid or args.official_process)
    target = 'bodian_pc.exe' if args.official_process else str(args.pid) if args.pid else "folia-bodian-no-such-process.exe"
    options = Options(mode=[f"local:{target}"], confdir=str(capture_dir),
                      allow_hosts=[r"^bd-api\.kuwo\.cn(?::443)?$"])
    master = DumpMaster(options, with_termlog=False, with_dumper=False)
    spec = importlib.util.spec_from_file_location("redacted", Path(__file__).with_name("bodian-capture-redacted.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    capture = module.RedactedCapture(collections=args.collections)
    master.addons.add(capture)

    class Lifecycle:
        def running(self):
            servers = list(master.addons.get('proxyserver').servers)
            ready = bool(servers) and all(server.is_running and not server.last_exception for server in servers)
            print(json.dumps({"capture_ready": ready, "check_only": not active_capture}), flush=True)
            if not ready:
                master.shutdown()
                return
            asyncio.get_running_loop().call_later(600 if active_capture else 3, master.shutdown)

        def response(self, flow):
            if not args.collections and capture.fresh_qr_seen and flow.request.host == module.HOST and flow.request.path.split('?')[0] == '/api/ucenter/users/login':
                print(json.dumps({"exchange_observed": True}), flush=True)
                asyncio.get_running_loop().call_later(1, master.shutdown)

    master.addons.add(Lifecycle())
    # Also bound startup if a local redirector permission prompt is left unanswered.
    asyncio.get_running_loop().call_later(660 if active_capture else 45, master.shutdown)
    await master.run()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(json.dumps({"capture_failed": type(error).__name__}), flush=True)
        raise SystemExit(1)
