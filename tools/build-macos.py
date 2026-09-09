#!/usr/bin/env python3
"""Build unsigned development app bundles without installing or launching them."""
import os
import json
from pathlib import Path
import plistlib
import shutil
import subprocess
root=Path(__file__).resolve().parents[1]
subprocess.run(['python3',str(root/'tools/release-gen.py'),'--check'],check=True)
release=json.loads((root/'core/release/manifest.json').read_text())
subprocess.run(['swift','build','--package-path',str(root/'apps/macos'),'-c','release'],check=True)
binaries=Path(subprocess.check_output(['swift','build','--package-path',str(root/'apps/macos'),'-c','release','--show-bin-path'],text=True).strip())
for executable,name,identifier in [('ZeroMenu','Zero','dev.projectzero.menu'),('ZeroMacObserve','Zero Observer','dev.projectzero.observer')]:
 app=root/'.runtime/v02-build'/f'{name}.app';contents=app/'Contents';(contents/'MacOS').mkdir(parents=True,exist_ok=True)
 shutil.copy2(binaries/executable,contents/'MacOS'/executable)
 info={'CFBundleName':name,'CFBundleIdentifier':identifier,'CFBundleExecutable':executable,'CFBundlePackageType':'APPL','CFBundleVersion':release['version'],'CFBundleShortVersionString':release['version'],'ZeroBuild':release['build'],'LSUIElement':True,'NSAppleEventsUsageDescription':'Read Spotify track, artist and playback state for your Zero status display. Playback is never controlled.'}
 with (contents/'Info.plist').open('wb') as f:plistlib.dump(info,f)
 subprocess.run(['codesign','--force','--sign','Project Zero Local Release',str(app)],check=True)
 print(app)

app=root/'.runtime/v02-build/Zero.app'
for executable,package in [('zero','./cli/cmd/zero'),('zerod','./core/cmd/zerod')]:
 subprocess.run(['go','build','-o',str(app/'Contents/MacOS'/executable),package],cwd=root,check=True)
helpers=app/'Contents/Helpers';helpers.mkdir(exist_ok=True)
shutil.copytree(root/'.runtime/v02-build/Zero Observer.app',helpers/'Zero Observer.app',dirs_exist_ok=True)
resources=app/'Contents/Resources';resources.mkdir(exist_ok=True)
shutil.copy2(root/'tools/install-release.py',resources/'install-release.py')
subprocess.run(['codesign','--force','--deep','--sign','Project Zero Local Release',str(app)],check=True)
