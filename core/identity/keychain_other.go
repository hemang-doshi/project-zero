//go:build !darwin || !cgo

package identity

import "fmt"

func keychainRead(string) ([]byte, bool, error) {
	return nil, false, fmt.Errorf("production runtime identity requires macOS Keychain and CGO")
}
func keychainWrite(string, []byte) error { return fmt.Errorf("macOS Keychain required") }
