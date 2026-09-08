#!/usr/bin/env python3
"""Generate an owner development LaunchAgent; --install explicitly loads it."""
import argparse
import os
from pathlib import Path
import plistlib
import subprocess

p=argparse.ArgumentParser()
p.add_argument("--data",default=".runtime/live")
p.add_argument("--listen",default="127.0.0.1:7443")
p.add_argument("--install",action="store_true")
a=p.parse_args()
root=Path(__file__).resolve().parents[1]
data=Path(a.data).resolve(); data.mkdir(parents=True,exist_ok=True,mode=0o700)
label="dev.projectzero.zerod"
target=data / (label+".plist")
with target.open("wb") as f:
    plistlib.dump({"Label":label,"ProgramArguments":[str(root/"bin/zerod"),"--data",str(data),"--listen",a.listen],
                  "RunAtLoad":True,"KeepAlive":True,"ThrottleInterval":5,
                  "StandardOutPath":str(data/"daemon.log"),"StandardErrorPath":str(data/"daemon.log"),
                  "WorkingDirectory":str(root),"Umask":0o077},f)
os.chmod(target,0o600)
if a.install:
    subprocess.run(["launchctl","bootstrap",f"gui/{os.getuid()}",str(target)],check=True)
print(target)
