#!/usr/bin/env python3
"""Collect bounded diagnostic evidence from the physical board for a timed soak."""
import argparse
import json
import os
from pathlib import Path
import time

def main():
    import serial
    p=argparse.ArgumentParser();p.add_argument("--port",required=True);p.add_argument("--hours",type=float,default=24);p.add_argument("--directory",default=".runtime/soak");a=p.parse_args()
    if a.hours<=0:raise SystemExit("positive duration required")
    os.umask(0o077);out=Path(a.directory);out.mkdir(parents=True,exist_ok=True,mode=0o700)
    start=time.time();deadline=time.monotonic()+a.hours*3600
    stats={"status":"RUNNING","started_at":start,"required_hours":a.hours,"health_samples":0,"reconnects":0,"serial_errors":0,"resets":0,"heaps":[],"last_sample_at":None}
    def save():
        data=dict(stats);heap=data.pop("heaps");data["elapsed_seconds"]=time.time()-start
        if heap:data.update(first_heap=heap[0],latest_heap=heap[-1],min_heap=min(heap),max_heap=max(heap))
        temp=out/"status.tmp";temp.write_text(json.dumps(data,indent=2)+"\n");temp.replace(out/"status.json")
    save()
    with (out/"samples.jsonl").open("a",buffering=1) as log:
        while time.monotonic()<deadline:
            try:
                link=serial.Serial(port=None,baudrate=115200,timeout=1);link.port=a.port;link.dtr=False;link.rts=False;link.open()
                with link:
                    while time.monotonic()<deadline:
                        line=link.readline(4096).decode(errors="replace").strip();event=None
                        if line.startswith("ZERO HEALTH "):
                            try:event={"type":"health",**json.loads(line[len("ZERO HEALTH "):])}
                            except json.JSONDecodeError:continue
                            stats["health_samples"]+=1;stats["heaps"].append(event["heap"])
                        elif line.startswith("ZERO ONLINE"):
                            stats["reconnects"]+=1;event={"type":"connected"}
                        elif line.startswith("ZERO READY"):
                            stats["resets"]+=1;event={"type":"boot"}
                        elif "Guru Meditation" in line or "abort()" in line:
                            stats["status"]="FAILED";event={"type":"crash"}
                        if event:
                            event["observed_at"]=time.time();stats["last_sample_at"]=event["observed_at"];log.write(json.dumps(event)+"\n")
                        save()
            except (serial.SerialException,OSError):
                stats["serial_errors"]+=1;save();time.sleep(1)
        if stats["status"]!="FAILED":stats["status"]="AWAITING_REVIEW" if stats["health_samples"]>=a.hours*60 else "INSUFFICIENT_SAMPLES"
        save()
if __name__=="__main__":main()
