package identity

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"strings"
	"time"
)

type Authority struct {
	Cert []byte `json:"cert"`
	Key  []byte `json:"key"`
}

func serial() *big.Int {
	n, e := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if e != nil {
		panic(e)
	}
	return n
}
func NewAuthority() (*Authority, error) {
	key, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		return nil, e
	}
	now := time.Now()
	tpl := &x509.Certificate{SerialNumber: serial(), Subject: pkix.Name{CommonName: "Zero personal runtime CA"}, NotBefore: now.Add(-time.Hour), NotAfter: now.AddDate(5, 0, 0), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign}
	der, e := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if e != nil {
		return nil, e
	}
	kd, e := x509.MarshalPKCS8PrivateKey(key)
	if e != nil {
		return nil, e
	}
	return &Authority{pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: kd})}, nil
}
func (a *Authority) parts() (*x509.Certificate, any, error) {
	b, _ := pem.Decode(a.Cert)
	k, _ := pem.Decode(a.Key)
	if b == nil || k == nil {
		return nil, nil, fmt.Errorf("invalid authority")
	}
	c, e := x509.ParseCertificate(b.Bytes)
	if e != nil {
		return nil, nil, e
	}
	key, e := x509.ParsePKCS8PrivateKey(k.Bytes)
	return c, key, e
}
func ValidNode(s string) bool {
	if len(s) < 1 || len(s) > 48 {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-') {
			return false
		}
	}
	return true
}
func FingerprintCSR(b []byte) (string, error) {
	p, _ := pem.Decode(b)
	if p == nil {
		return "", fmt.Errorf("invalid CSR")
	}
	c, e := x509.ParseCertificateRequest(p.Bytes)
	if e != nil {
		return "", e
	}
	if e = c.CheckSignature(); e != nil {
		return "", e
	}
	h := sha256.Sum256(c.RawSubjectPublicKeyInfo)
	return hex.EncodeToString(h[:]), nil
}
func Fingerprint(c *x509.Certificate) string {
	h := sha256.Sum256(c.RawSubjectPublicKeyInfo)
	return hex.EncodeToString(h[:])
}
func (a *Authority) Enroll(node string, csr []byte) ([]byte, error) {
	if !ValidNode(node) {
		return nil, fmt.Errorf("invalid node ID")
	}
	b, _ := pem.Decode(csr)
	if b == nil {
		return nil, fmt.Errorf("invalid CSR")
	}
	c, e := x509.ParseCertificateRequest(b.Bytes)
	if e != nil {
		return nil, e
	}
	if e = c.CheckSignature(); e != nil {
		return nil, e
	}
	if c.Subject.CommonName != node {
		return nil, fmt.Errorf("CSR identity mismatch")
	}
	key, ok := c.PublicKey.(*ecdsa.PublicKey)
	if !ok || key.Curve != elliptic.P256() {
		return nil, fmt.Errorf("P-256 device key required")
	}
	ca, signer, e := a.parts()
	if e != nil {
		return nil, e
	}
	tpl := &x509.Certificate{SerialNumber: serial(), Subject: pkix.Name{CommonName: node}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().AddDate(1, 0, 0), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}, BasicConstraintsValid: true}
	der, e := x509.CreateCertificate(rand.Reader, tpl, ca, c.PublicKey, signer)
	if e != nil {
		return nil, e
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), nil
}
func (a *Authority) ServerTLS() (*tls.Config, error) {
	ca, signer, e := a.parts()
	if e != nil {
		return nil, e
	}
	key, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		return nil, e
	}
	tpl := &x509.Certificate{SerialNumber: serial(), Subject: pkix.Name{CommonName: "zero.local"}, DNSNames: []string{"zero.local"}, NotBefore: ca.NotBefore, NotAfter: time.Now().AddDate(1, 0, 0), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, e := x509.CreateCertificate(rand.Reader, tpl, ca, &key.PublicKey, signer)
	if e != nil {
		return nil, e
	}
	pool := x509.NewCertPool()
	pool.AddCert(ca)
	return &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}, ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: pool}, nil
}
func Load(service string) (*Authority, error) {
	if !strings.HasPrefix(service, "project-zero.") {
		return nil, fmt.Errorf("invalid keychain service")
	}
	b, found, e := keychainRead(service)
	if e != nil {
		return nil, e
	}
	if found {
		var a Authority
		if e = json.Unmarshal(b, &a); e != nil {
			return nil, e
		}
		_, _, e = a.parts()
		return &a, e
	}
	a, e := NewAuthority()
	if e != nil {
		return nil, e
	}
	b, e = json.Marshal(a)
	if e != nil {
		return nil, e
	}
	if e = keychainWrite(service, b); e != nil {
		return nil, e
	}
	return a, nil
}
