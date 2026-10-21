"""Predict the same named program's spawn environment; emit hashes, never values."""
import hashlib
import json
import sys
from supervisor.options import ClientOptions, ServerOptions
from supervisor.xmlrpc import SupervisorTransport
from xmlrpc.client import ServerProxy

program = sys.argv[1]
if program not in ("dsh-dev-web-server", "dsh-a2d2-v3-preview"):
    raise SystemExit("only exact existing programs are allowed")
client = ClientOptions()
client.realize(args=[], progname="supervisorctl")
rpc = ServerProxy("http://127.0.0.1", transport=SupervisorTransport(client.username, client.password, client.serverurl))
pid = rpc.supervisor.getPID()
with open(f"/proc/{pid}/environ", "rb") as source:
    daemon = dict(row.decode("utf-8").split("=", 1) for row in source.read().split(b"\0") if row)
options = ServerOptions()
options.environ_expansions = {f"ENV_{key}": value for key, value in daemon.items()}
options.realize(args=["-c", client.configfile], progname="supervisord")
selected = [(group, proc) for group in options.process_group_configs for proc in group.process_configs if proc.name == program]
if len(selected) != 1:
    raise SystemExit("exact named program environment unavailable")
group, process = selected[0]
environment = dict(daemon)
environment.update({"SUPERVISOR_ENABLED": "1", "SUPERVISOR_PROCESS_NAME": process.name, "SUPERVISOR_GROUP_NAME": group.name})
serverurl = process.serverurl or options.serverurl
if serverurl:
    environment["SUPERVISOR_SERVER_URL"] = serverurl
environment.update(process.environment or {})
print(json.dumps({"program": program, "source": "installed-Supervisor-spawn-contract", "valueHashes": {key: hashlib.sha256(value.encode("utf-8")).hexdigest() for key, value in environment.items()}}))
