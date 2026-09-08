#!/usr/bin/env python3
"""Build unsigned development app bundles without installing or launching them."""
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
root=Path(__file__).resolve().parents[1]
subprocess.run(['swift','build','--package-path',str(root/'apps/macos'),'-c','release'],check=True)
binaries=Path(subprocess.check_output(['swift','build','--package-path',str(root/'apps/macos'),'-c','release','--show-bin-path'],text=True).strip())
for executable,name,identifier in [('ZeroMenu','Zero','dev.projectzero.menu'),('ZeroMacObserve','Zero Observer','dev.projectzero.observer')]:
 app=root/'.runtime/v02-build'/f'{name}.app';contents=app/'Contents';(contents/'MacOS').mkdir(parents=True,exist_ok=True)
 shutil.copy2(binaries/executable,contents/'MacOS'/executable)
 info={'CFBundleName':name,'CFBundleIdentifier':identifier,'CFBundleExecutable':executable,'CFBundlePackageType':'APPL','CFBundleVersion':'0.2.0','CFBundleShortVersionString':'0.2.0','LSUIElement':True,'NSAppleEventsUsageDescription':'Read Spotify track, artist and playback state for your Zero status display. Playback is never controlled.'}
 with (contents/'Info.plist').open('wb') as f:plistlib.dump(info,f)
 subprocess.run(['codesign','--force','--sign','-',str(app)],check=True)
 print(app)
