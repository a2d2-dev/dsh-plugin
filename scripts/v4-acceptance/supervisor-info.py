"""Read-only Supervisor facts; never print transport credentials or log contents."""
import json
import sys
from supervisor.options import ClientOptions
from supervisor.xmlrpc import SupervisorTransport
from xmlrpc.client import ServerProxy

program = sys.argv[1]
if program not in ("dsh-dev-web-server", "dsh-a2d2-v3-preview"):
    raise SystemExit("only exact existing programs are allowed")
options = ClientOptions()
options.realize(args=[], progname="supervisorctl")
rpc = ServerProxy("http://127.0.0.1", transport=SupervisorTransport(options.username, options.password, options.serverurl))
value = rpc.supervisor.getProcessInfo(program)
result = {key: value[key] for key in ("name", "group", "statename", "pid", "exitstatus", "start", "stop", "now", "stdout_logfile")}
log = value.get("stdout_logfile")
result["stdoutUnique"] = bool(log) and all(row.get("stdout_logfile") != log and row.get("stderr_logfile") != log for row in rpc.supervisor.getAllProcessInfo() if (row["group"], row["name"]) != (value["group"], value["name"]))
print(json.dumps(result))
