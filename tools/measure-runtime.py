#!/usr/bin/env python3
"""Measure real Unix API latency and optional LaunchAgent crash recovery."""
import argparse
import http.client
import json
import os
from pathlib import Path
import socket
import statistics
import subprocess
import time

class UnixHTTP(http.client.HTTPConnection):
    def __init__(self,path):super().__init__("localhost",timeout=2);self.path=path
    def connect(self):self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.settimeout(2);self.sock.connect(self.path)
def get(path,route):
    c=UnixHTTP(path)
    try:c.request("GET","/v0.1/"+route);r=c.getresponse();body=json.loads(r.read());assert r.status==200;return body
    finally:c.close()
def main():
    p=argparse.ArgumentParser();p.add_argument("--socket",required=True);p.add_argument("--output",required=True);p.add_argument("--crash-recovery",action="store_true");a=p.parse_args()
    times=[]
    for _ in range(200):
        start=time.perf_counter();status=get(a.socket,"status");times.append((time.perf_counter()-start)*1000)
    rss=int(subprocess.check_output(["ps","-o","rss=","-p",str(status["pid"])],text=True).strip())
    out={"status_samples":len(times),"status_p95_ms":sorted(times)[189],"status_median_ms":statistics.median(times),"rss_mib":rss/1024,"measured_at":time.time()}
    if a.crash_recovery:
        before=get(a.socket,"session");start=time.monotonic();subprocess.run(["launchctl","kill","SIGKILL",f"gui/{os.getuid()}/dev.projectzero.zerod"],check=True)
        while time.monotonic()-start<30:
            try:
                after=get(a.socket,"session")
                if get(a.socket,"status")["pid"]!=status["pid"]:break
            except (OSError,AssertionError,json.JSONDecodeError):pass
            time.sleep(.2)
        else:raise SystemExit("Runtime did not recover")
        assert before["revision"]==after["revision"] and before["state"]==after["state"]
        out["process_crash_recovery_seconds"]=time.monotonic()-start
        out["session_revision_preserved"]=after["revision"]
    path=Path(a.output);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(out,indent=2)+"\n");print(json.dumps(out,indent=2))
if __name__=="__main__":main()
