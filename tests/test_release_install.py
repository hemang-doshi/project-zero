import importlib.util,tempfile,unittest,sqlite3
from pathlib import Path
spec=importlib.util.spec_from_file_location('install',Path(__file__).parents[1]/'tools/install-release.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class InstallTest(unittest.TestCase):
 def test_backup_includes_wal_commits(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);c=sqlite3.connect(p/'source.db');c.execute('pragma journal_mode=wal');c.execute('create table value(x)');c.execute('insert into value values (42)');c.commit();m.backup_database(p/'source.db',p/'backup.db');b=sqlite3.connect(p/'backup.db');self.assertEqual(b.execute('select x from value').fetchone()[0],42);b.close();c.close()
 def test_refuse_missing_source(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)
   with self.assertRaises(FileNotFoundError):m.backup_database(p/'missing.db',p/'backup.db')
   self.assertFalse((p/'missing.db').exists())
 def test_failed_health_restores_existing_database_and_app(self):
  from unittest.mock import patch
  from types import SimpleNamespace
  import sys
  with tempfile.TemporaryDirectory() as d:
   home=Path(d);data=home/'Library/Application Support/ProjectZero';data.mkdir(parents=True)
   app=home/'Applications/Zero.app';(app/'Contents/MacOS').mkdir(parents=True);(app/'old').write_text('retained')
   src=home/'source.app';(src/'Contents/MacOS').mkdir(parents=True)
   for n in ['zero','zerod','ZeroMenu']:(src/'Contents/MacOS'/n).write_text('new')
   c=sqlite3.connect(data/'zero.db');c.execute('create table value(x)');c.execute('insert into value values (42)');c.commit();c.close()
   def fake(args,check=True):
    args=[str(x) for x in args]
    if 'print' in args:return SimpleNamespace(returncode=1,stdout='')
    if args[-1]=='doctor':return SimpleNamespace(returncode=1,stdout='')
    return SimpleNamespace(returncode=0,stdout='')
   with patch.object(Path,'home',return_value=home),patch.object(m,'run',side_effect=fake),patch.object(m.time,'sleep'),patch.object(sys,'argv',['install','upgrade','--source',str(src)]):
    with self.assertRaisesRegex(RuntimeError,'health check'):m.main()
   self.assertTrue((app/'old').exists())
   c=sqlite3.connect(data/'zero.db');self.assertEqual(c.execute('select x from value').fetchone()[0],42);c.close()
