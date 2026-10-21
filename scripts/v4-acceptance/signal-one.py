"""Single PID-bound TERM for the exact original preview launcher; never signal a group."""
import json
import os
import signal
import sys
from supervisor.options import ClientOptions
from supervisor.xmlrpc import SupervisorTransport
from xmlrpc.client import ServerProxy

if len(sys.argv) != 5 or sys.argv[1] != "--execute":
    raise SystemExit("usage: signal-one.py --execute RUN_ID PID START_TICKS")
run_id, pid, expected = sys.argv[2], int(sys.argv[3]), sys.argv[4]
with open("/proc/self/cgroup") as source:
    if f"/a2d2-v4-141-{run_id}.service" not in source.read():
        raise SystemExit("single signal must run inside its reviewed external one-shot")
options = ClientOptions()
options.realize(args=[], progname="supervisorctl")
rpc = ServerProxy("http://127.0.0.1", transport=SupervisorTransport(options.username, options.password, options.serverurl))
info = rpc.supervisor.getProcessInfo("dsh-a2d2-v3-preview")
if info["pid"] != pid:
    print(json.dumps({"sent": False, "reason": "original supervisor generation already changed"}))
    raise SystemExit(0)
fd = os.pidfd_open(pid)
try:
    with open(f"/proc/{pid}/stat") as source:
        text = source.read()
    if text[text.rfind(")") + 2:].split()[19] != expected:
        raise SystemExit("original process identity changed")
    signal.pidfd_send_signal(fd, signal.SIGTERM, None, 0)
    print(json.dumps({"sent": True, "signal": "SIGTERM", "pid": pid, "source": "kernel-pidfd-single-target"}))
finally:
    os.close(fd)
