import importlib.util
from pathlib import Path
import unittest
import base64

class Provisioning(unittest.TestCase):
    def test_no_private_material_or_oversized_usb_payload(self):
        spec=importlib.util.spec_from_file_location("provision",Path(__file__).resolve().parents[1]/"tools/provision-device.py")
        mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
        cert=base64.b64encode(b"-----BEGIN CERTIFICATE-----\nexample\n-----END CERTIFICATE-----\n").decode()
        payload=mod.payload({"certificate":cert,"ca":cert,"key":"must-not-travel"},{"ssid":"local","password":"test"},"wss://zero.local:7443/zero",1800000000)
        self.assertNotIn(b"must-not-travel",payload)
        self.assertLess(len(payload),8192)
        with self.assertRaises(ValueError):mod.payload({"certificate":cert,"ca":cert},{"ssid":"x"*33,"password":"test"},"wss://zero.local/zero",1800000000)
if __name__=="__main__":unittest.main()
