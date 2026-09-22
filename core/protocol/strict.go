package protocol

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"unicode/utf8"
)

// ValidateJSON rejects duplicate keys and bounded-depth violations before decoding.
func ValidateJSON(b []byte) error {
	if !utf8.Valid(b) {
		return fmt.Errorf("VALIDATION: invalid UTF-8")
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	var value func(int) error
	value = func(depth int) error {
		if depth > 8 {
			return fmt.Errorf("VALIDATION: JSON depth")
		}
		t, e := d.Token()
		if e != nil {
			return e
		}
		delimiter, ok := t.(json.Delim)
		if !ok {
			return nil
		}
		switch delimiter {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				key, e := d.Token()
				if e != nil {
					return e
				}
				name, ok := key.(string)
				if !ok || seen[name] {
					return fmt.Errorf("VALIDATION: duplicate object key")
				}
				seen[name] = true
				if e = value(depth + 1); e != nil {
					return e
				}
			}
		case '[':
			for d.More() {
				if e = value(depth + 1); e != nil {
					return e
				}
			}
		default:
			return fmt.Errorf("VALIDATION: unexpected delimiter")
		}
		_, e = d.Token()
		return e
	}
	if e := value(0); e != nil {
		return e
	}
	if _, e := d.Token(); e != io.EOF {
		return fmt.Errorf("VALIDATION: trailing JSON")
	}
	return nil
}
