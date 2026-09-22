#!/usr/bin/env python3
"""Read a recoverable private flash image in independently retried chunks."""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess

p = argparse.ArgumentParser()
p.add_argument("--esptool", required=True)
p.add_argument("--port", required=True)
p.add_argument("--output", required=True)
a = p.parse_args()
os.umask(0o077)
dest = Path(a.output)
chunks = dest.parent / "chunks"
chunks.mkdir(parents=True, exist_ok=True)
size, step = 4 * 1024 * 1024, 256 * 1024
for offset in range(0, size, step):
    part = chunks / f"{offset:08x}.bin"
    if part.exists() and part.stat().st_size == step:
        continue
    for attempt in range(5):
        result = subprocess.run([a.esptool, "--port", a.port, "--baud", "115200",
                                 "read-flash", str(offset), str(step), str(part)],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        if result.returncode == 0 and part.exists() and part.stat().st_size == step:
            print(f"Backed up {offset + step}/{size} bytes", flush=True)
            break
        print(f"Retry chunk {offset:x}, attempt {attempt + 1}", flush=True)
    else:
        raise SystemExit("Serial backup failed; firmware remains unchanged.")
with dest.open("wb") as out:
    for offset in range(0, size, step):
        out.write((chunks / f"{offset:08x}.bin").read_bytes())
digest = hashlib.sha256(dest.read_bytes()).hexdigest()
dest.with_suffix(".sha256").write_text(digest + "  " + dest.name + "\n")
print("Complete flash backup verified for size; SHA256", digest)
