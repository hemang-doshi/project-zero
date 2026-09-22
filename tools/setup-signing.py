#!/usr/bin/env python3
"""Create an owner-local signing identity once; private key stays in login Keychain."""
import json,secrets,subprocess,tempfile
from pathlib import Path
name='Project Zero Local Release'
def run(args):return subprocess.run(args,check=True,capture_output=True,text=True)
found=run(['security','find-certificate','-c',name]).returncode if subprocess.run(['security','find-certificate','-c',name],capture_output=True).returncode==0 else 1
if found==0:print('Existing local release certificate retained')
else:
 with tempfile.TemporaryDirectory(prefix='zero-signing-') as d:
  p=Path(d);password=secrets.token_hex(24);(p/'password').write_text(password);(p/'password').chmod(0o600)
  run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','3650','-subj','/CN='+name,'-addext','keyUsage=critical,digitalSignature','-addext','extendedKeyUsage=critical,codeSigning','-keyout',str(p/'key.pem'),'-out',str(p/'cert.pem')])
  run(['openssl','pkcs12','-export','-legacy','-inkey',str(p/'key.pem'),'-in',str(p/'cert.pem'),'-out',str(p/'identity.p12'),'-passout','file:'+str(p/'password')])
  run(['security','import',str(p/'identity.p12'),'-k',str(Path.home()/'Library/Keychains/login.keychain-db'),'-P',password,'-T','/usr/bin/codesign'])
 print('Created local release identity in login Keychain; no system trust settings changed')
