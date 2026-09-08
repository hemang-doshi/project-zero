#!/usr/bin/env python3
"""Bounded metadata-only compatibility probe; does not steer a Codex turn."""
import json
import os
from pathlib import Path
import sys
import time

def sanitize(payload, root):
    if not isinstance(payload, dict) or payload.get('cwd') != root:
        return None
    event=payload.get('hook_event_name')
    if event not in ('UserPromptSubmit','Stop','Interrupt','SessionStart','SessionEnd'):
        return None
    task=payload.get('session_id');turn=payload.get('turn_id','')
    if not isinstance(task,str) or not task or len(task)>128 or not isinstance(turn,str) or len(turn)>128:
        return None
    return {'event':event,'task_id':task,'turn_id':turn}

def main():
    root=Path(__file__).resolve().parents[1]
    try:
        raw=sys.stdin.buffer.read(65537)
        if len(raw)>65536:return
        event=sanitize(json.loads(raw),str(root))
        if event is None:return
        out=root/'.runtime/codex-hook';out.mkdir(parents=True,exist_ok=True,mode=0o700)
        target=out/'events.jsonl'
        # A full probe log is a reason to stop recording, never grow unbounded.
        if target.exists() and target.stat().st_size>1048576:return
        fd=os.open(target,os.O_WRONLY|os.O_APPEND|os.O_CREAT|os.O_NOFOLLOW,0o600)
        try:os.write(fd,(json.dumps({**event,'observed_at':time.time()})+'\n').encode())
        finally:os.close(fd)
    except (ValueError,OSError,TypeError):
        pass
    finally:
        print('{}')
if __name__=='__main__':main()
