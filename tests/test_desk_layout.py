"""Pixel-level checks use the actual firmware renderer, not a mock layout."""
import base64,json,os,subprocess,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class DeskLayout(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory();cls.binary=Path(cls.tmp.name)/'preview'
  source=os.environ.get('ZERO_DISPLAY_SOURCE','nodes/esp32-desk/main/display.c')
  subprocess.run(['cc','-std=c11','-DZERO_DISPLAY_PREVIEW','-I','nodes/esp32-desk/main','-I','.runtime/toolchains/esp-idf/components/json/cJSON','tools/desk-preview.c',source,'nodes/esp32-desk/main/desk_protocol.c','.runtime/toolchains/esp-idf/components/json/cJSON/cJSON.c','-o',str(cls.binary)],cwd=ROOT,check=True)
 @classmethod
 def tearDownClass(cls):cls.tmp.cleanup()
 def render(self):
  view={'project':'Project Zero','state':'PAUSED','track':'Jaded','artist':'Drake','media':'playing','artwork_rgb565':base64.b64encode(bytes([248,0])*1024).decode()}
  raw=subprocess.check_output([str(self.binary)],input=json.dumps(view).encode()).split(b'\n',3)[3]
  return lambda x,y:raw[(y*128+x)*3:(y*128+x)*3+3]
 def test_artwork_is_centered_and_text_is_left(self):
  pixel=self.render()
  self.assertTrue(all(pixel(x,y)==b'\xff\x00\x00' for x in range(48,80) for y in range(85,117)))
  self.assertTrue(any(pixel(x,86)==b'\xff\xff\xff' for x in range(4,45)))
 def test_header_has_ink_in_every_glyph_row(self):
  pixel=self.render()
  for y in range(7,14):self.assertTrue(any(pixel(x,y)==b'\xff\xff\xff' for x in range(6,78)),f'blank header row {y}')
if __name__=='__main__':unittest.main()
