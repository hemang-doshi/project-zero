package identity

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"testing"
)

func TestEnrollmentDoesNotNeedDevicePrivateKey(t *testing.T) {
	ca, e := NewAuthority()
	if e != nil {
		t.Fatal(e)
	}
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	csr, _ := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{Subject: pkix.Name{CommonName: "desk"}}, key)
	cert, e := ca.Enroll("desk", pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csr}))
	if e != nil {
		t.Fatal(e)
	}
	der, _ := x509.MarshalPKCS8PrivateKey(key)
	if _, e = tls.X509KeyPair(cert, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})); e != nil {
		t.Fatal(e)
	}
	if _, e = ca.Enroll("other", pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csr})); e == nil {
		t.Fatal("changed CSR identity accepted")
	}
	b, _ := pem.Decode(cert)
	c, _ := x509.ParseCertificate(b.Bytes)
	if c.IsCA {
		t.Fatal("node issued CA authority")
	}
}
