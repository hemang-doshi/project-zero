#!/usr/bin/env python3
"""Owner-local release installation. Database snapshots use SQLite backup, never raw WAL copies."""
import argparse,json,os,plistlib,shutil,sqlite3,subprocess,time,signal
from contextlib import closing
from pathlib import Path

def backup_database(source,target):
 source=Path(source);target=Path(target)
 if not source.is_file():raise FileNotFoundError(source)
 with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)) as src,closing(sqlite3.connect(target)) as dst:
  src.backup(dst)
  if dst.execute('pragma integrity_check').fetchone()[0]!='ok':raise RuntimeError('Database backup integrity failure')
 os.chmod(target,0o600)

def run(args,check=True):return subprocess.run([str(x) for x in args],check=check,capture_output=True,text=True)
def bootstrap(domain,plist):
 # launchd can briefly retain a booted-out service; retry only the same definition.
 for attempt in range(20):
  result=run(['launchctl','bootstrap',domain,plist],False)
  if result.returncode==0:return
  time.sleep(.25)
 raise RuntimeError('launchd could not load '+str(plist)+': '+result.stderr)

def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['install','upgrade','rollback']);p.add_argument('--dry-run',action='store_true');p.add_argument('--source',type=Path);p.add_argument('--source-data',type=Path);a=p.parse_args()
 home=Path.home();app=home/'Applications/Zero.app';data=home/'Library/Application Support/ProjectZero';agents=home/'Library/LaunchAgents';label='dev.projectzero.zerod';plist=agents/(label+'.plist');domain=f'gui/{os.getuid()}';recovery=data/'recovery';previous=recovery/'previous';receipt=data/'installation.json'
 source=a.source or Path(__file__).resolve().parents[1]/'.runtime/v02-build/Zero.app'
 plan={'action':a.action,'app':str(app),'data':str(data),'source':str(source),'source_data':str(a.source_data) if a.source_data else None,'service':label,'backup':str(previous),'dry_run':a.dry_run}
 print(json.dumps(plan,indent=2),flush=True)
 if a.dry_run:return
 if a.action!='rollback':
  for name in ['ZeroMenu','zerod','zero']:
   if not (source/'Contents/MacOS'/name).is_file():raise RuntimeError('Incomplete release bundle: '+name)
  run(['codesign','--verify','--deep','--strict',source])
  run([source/'Contents/MacOS/zerod','--check-identity'])
  if a.source_data and (data/'zero.db').exists():raise RuntimeError('Production data exists; refusing import')
 else:
  if not (previous/'Zero.app').exists() or not (previous/'zero.db').exists():raise RuntimeError('No complete rollback snapshot')
  source=previous/'Zero.app'
 data.mkdir(parents=True,exist_ok=True,mode=0o700);agents.mkdir(parents=True,exist_ok=True);app.parent.mkdir(parents=True,exist_ok=True)
 # Prepare and validate the complete replacement before interrupting the service.
 if source.resolve()==app.resolve():
  prepared=data/'prepared-release.app'
  if prepared.exists():shutil.rmtree(prepared)
  shutil.copytree(source,prepared,symlinks=True);source=prepared
 old_agent=None
 probe=run(['launchctl','print',domain+'/'+label],False)
 if probe.returncode==0:
  for line in probe.stdout.splitlines():
   if line.strip().startswith('path = '):old_agent=Path(line.strip()[7:]);break
 stamp=recovery/str(time.time_ns());stamp.mkdir(parents=True,mode=0o700)
 if old_agent and old_agent.exists():shutil.copy2(old_agent,stamp/'daemon.plist')
 elif plist.exists():shutil.copy2(plist,stamp/'daemon.plist')
 had_app=app.exists();had_db=(data/'zero.db').exists()
 if had_app:shutil.copytree(app,stamp/'Zero.app',symlinks=True)
 current_data=a.source_data or data
 staging=app.with_name('Zero.installing.app')
 if staging.exists():shutil.rmtree(staging)
 shutil.copytree(source,staging,symlinks=True)
 run(['codesign','--verify','--deep','--strict',staging])
 db_changed=False;app_changed=False
 try:
  # Stop the installed menu process so an upgrade opens the replacement executable.
  for line in run(['ps','-U',str(os.getuid()),'-o','pid=,comm=']).stdout.splitlines():
   parts=line.strip().split(None,1)
   if len(parts)==2 and parts[1]==str(app/'Contents/MacOS/ZeroMenu'):os.kill(int(parts[0]),signal.SIGTERM)
  for service in [label,'dev.projectzero.v02-development']:
   if run(['launchctl','print',domain+'/'+service],False).returncode==0:run(['launchctl','bootout',domain+'/'+service])
  if (current_data/'zero.db').exists():backup_database(current_data/'zero.db',stamp/'zero.db')
  if a.action=='rollback':
   db_changed=True
   for suffix in ['','-wal','-shm']:(data/('zero.db'+suffix)).unlink(missing_ok=True)
   backup_database(previous/'zero.db',data/'zero.db')
  elif a.source_data:
   db_changed=True;backup_database(stamp/'zero.db',data/'zero.db')
  app_changed=True
  if app.exists():shutil.rmtree(app)
  staging.rename(app)
  config={'Label':label,'ProgramArguments':[str(app/'Contents/MacOS/zerod'),'--data',str(data),'--listen',':7443','--mac-observer',str(app/'Contents/Helpers/Zero Observer.app/Contents/MacOS/ZeroMacObserve'),'--mac-audio',str(app/'Contents/Helpers/Zero Audio.app/Contents/MacOS/ZeroAudio')],'WorkingDirectory':str(data),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':5,'Umask':0o077,'StandardOutPath':str(data/'daemon.log'),'StandardErrorPath':str(data/'daemon.log')}
  with plist.open('wb') as f:plistlib.dump(config,f)
  os.chmod(plist,0o600);db_changed=True;bootstrap(domain,plist)
  healthy=False
  for _ in range(20):
   result=run([app/'Contents/MacOS/zero','doctor'],False)
   if result.returncode==0:healthy=True;break
   time.sleep(.25)
  if not healthy:raise RuntimeError('Installed daemon failed health check')
 except Exception:
  run(['launchctl','bootout',domain+'/'+label],False)
  if app_changed:
   if app.exists():shutil.rmtree(app)
   if had_app:shutil.copytree(stamp/'Zero.app',app,symlinks=True)
  if db_changed:
   for suffix in ['','-wal','-shm']:(data/('zero.db'+suffix)).unlink(missing_ok=True)
   if had_db and (stamp/'zero.db').exists():backup_database(stamp/'zero.db',data/'zero.db')
  if (stamp/'daemon.plist').exists():
   shutil.copy2(stamp/'daemon.plist',plist);bootstrap(domain,plist)
  raise
 if a.action!='rollback':
  previous.unlink(missing_ok=True);previous.symlink_to(stamp.name)
 cli_dir=Path('/opt/homebrew/bin')
 if not cli_dir.is_dir() or not os.access(cli_dir,os.W_OK):cli_dir=home/'.local/bin'
 cli_dir.mkdir(parents=True,exist_ok=True);cli=cli_dir/'zero';cli_target=app/'Contents/MacOS/zero'
 if not cli.exists() and not cli.is_symlink():cli.symlink_to(cli_target)
 elif not cli.is_symlink() or cli.resolve()!=cli_target.resolve():print('CLI path occupied; retained existing command: '+str(cli))
 menu_plist=agents/'dev.projectzero.menu.plist'
 with menu_plist.open('wb') as f:plistlib.dump({'Label':'dev.projectzero.menu','ProgramArguments':['/usr/bin/open',str(app)],'RunAtLoad':True},f)
 if run(['launchctl','print',domain+'/dev.projectzero.menu'],False).returncode==0:run(['launchctl','bootout',domain+'/dev.projectzero.menu'],False)
 bootstrap(domain,menu_plist)
 receipt.write_text(json.dumps({'app':str(app),'data':str(data),'backup':str(stamp)},indent=2));os.chmod(receipt,0o600)
 print('Installed and health checked. Snapshot: '+str(stamp))
if __name__=='__main__':main()
