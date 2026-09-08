import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('hook',Path(__file__).parents[1]/'tools/codex-status-hook.py')
hook=importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)
class HookTests(unittest.TestCase):
 def test_metadata_only_and_project_scope(self):
  root=str(Path(__file__).parents[1].resolve())
  event=hook.sanitize({'cwd':root,'hook_event_name':'Stop','session_id':'task-1','turn_id':'turn-1','last_assistant_message':'secret','transcript_path':'private'},root)
  self.assertEqual(set(event),{'event','task_id','turn_id'})
  self.assertIsNone(hook.sanitize({'cwd':'/unregistered','hook_event_name':'Stop','session_id':'task-1'},root))
  self.assertIsNone(hook.sanitize({'cwd':root,'hook_event_name':'PreToolUse','session_id':'task-1'},root))
