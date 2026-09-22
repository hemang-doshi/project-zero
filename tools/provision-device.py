#!/usr/bin/env python3
"""Owner-controlled USB CSR capture and provisioning; never reads device keys."""
import argparse
import base64
import json
import os
from pathlib import Path
import time

def payload(enrollment,wifi,endpoint,epoch):
    if not endpoint.startswith("wss://") or len(endpoint)>190:
        raise ValueError("TLS endpoint required")
    if len(wifi["ssid"].encode())>32 or len(wifi["password"].encode())>64:
        raise ValueError("Wi-Fi field bounds")
    body={"op":"provision","ssid":wifi["ssid"],"password":wifi["password"],
          "endpoint":endpoint,"time":epoch,
          "certificate":base64.b64decode(enrollment["certificate"],validate=True).decode(),
          "ca":base64.b64decode(enrollment["ca"],validate=True).decode()}
    result=json.dumps(body,separators=(",",":")).encode()+b"\n"
    if len(result)>8192:raise ValueError("USB payload exceeds bound")
    return result

def main():
    import serial
    p=argparse.ArgumentParser()
    p.add_argument("--port",required=True)
    p.add_argument("--capture",action="store_true")
    p.add_argument("--output",default=".runtime/hardware/node.csr")
    p.add_argument("--enrollment")
    p.add_argument("--wifi-file")
    p.add_argument("--endpoint")
    a=p.parse_args();os.umask(0o077)
    link=serial.Serial(port=None,baudrate=115200,timeout=1)
    link.port=a.port;link.dtr=False;link.rts=False;link.open()
    with link:
        time.sleep(3)
        if a.capture:
            link.write(b"\nCSR\n");deadline=time.monotonic()+15;recording=False;lines=[]
            while time.monotonic()<deadline:
                line=link.readline().decode(errors="replace")
                if line.startswith("ZERO FINGERPRINT "):print(line.strip())
                elif "ZERO CSR BEGIN" in line:recording=True
                elif "ZERO CSR END" in line:
                    out=Path(a.output);out.parent.mkdir(parents=True,exist_ok=True,mode=0o700);out.write_text("".join(lines));print("CSR saved to",out);return
                elif recording:lines.append(line)
            raise SystemExit("Device did not return a CSR; no provisioning performed")
        if not all([a.enrollment,a.wifi_file,a.endpoint]):raise SystemExit("enrollment, Wi-Fi file, endpoint required")
        # Establish application readiness after serial-open may reset the board.
        link.write(b"\nCSR\n")
        deadline=time.monotonic()+15
        while time.monotonic()<deadline:
            if b"ZERO CSR END" in link.readline():break
        else:raise SystemExit("Firmware not ready; credentials not transmitted")
        data=payload(json.loads(Path(a.enrollment).read_text()),json.loads(Path(a.wifi_file).read_text()),a.endpoint,int(time.time()))
        link.write(data);link.flush();deadline=time.monotonic()+15
        while time.monotonic()<deadline:
            line=link.readline()
            if b"ZERO PROVISIONED" in line:print("Device acknowledged provisioning");return
            if b"ZERO PROVISION REJECTED" in line:raise SystemExit("Device rejected provisioning")
        raise SystemExit("No provisioning acknowledgement; inspect device before retrying")
if __name__=="__main__":main()
