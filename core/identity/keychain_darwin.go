//go:build darwin && cgo

package identity

/*
#cgo LDFLAGS: -framework Security -framework CoreFoundation
#include <Security/Security.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdlib.h>
#include <string.h>
static CFMutableDictionaryRef query(const char *service) {
 CFMutableDictionaryRef q=CFDictionaryCreateMutable(NULL,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
 CFStringRef s=CFStringCreateWithCString(NULL,service,kCFStringEncodingUTF8);
 CFDictionarySetValue(q,kSecClass,kSecClassGenericPassword);
 CFDictionarySetValue(q,kSecAttrService,s);
 CFDictionarySetValue(q,kSecAttrAccount,CFSTR("runtime-authority"));
 CFRelease(s);return q;
}
static int readkey(const char *s, void **out, long *size) {
 CFMutableDictionaryRef q=query(s);CFDictionarySetValue(q,kSecReturnData,kCFBooleanTrue);
 CFTypeRef result=NULL;OSStatus st=SecItemCopyMatching(q,&result);CFRelease(q);
 if(st!=errSecSuccess)return (int)st;
 *size=CFDataGetLength((CFDataRef)result);*out=malloc(*size);
 if(!*out){CFRelease(result);return -1;}
 memcpy(*out,CFDataGetBytePtr((CFDataRef)result),*size);CFRelease(result);return 0;
}
static int writekey(const char *s,void *bytes,long size){
 CFMutableDictionaryRef q=query(s);CFDataRef d=CFDataCreate(NULL,bytes,size);
 CFDictionarySetValue(q,kSecValueData,d);
 CFDictionarySetValue(q,kSecAttrAccessible,kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly);
 OSStatus st=SecItemAdd(q,NULL);CFRelease(d);CFRelease(q);return (int)st;
}
*/
import "C"
import (
	"fmt"
	"unsafe"
)

func keychainRead(service string) ([]byte, bool, error) {
	s := C.CString(service)
	defer C.free(unsafe.Pointer(s))
	var p unsafe.Pointer
	var n C.long
	code := C.readkey(s, &p, &n)
	if code == C.errSecItemNotFound {
		return nil, false, nil
	}
	if code != 0 {
		return nil, false, fmt.Errorf("Keychain read failed (%d)", int(code))
	}
	defer C.free(p)
	return C.GoBytes(p, C.int(n)), true, nil
}
func keychainWrite(service string, b []byte) error {
	s := C.CString(service)
	defer C.free(unsafe.Pointer(s))
	p := C.CBytes(b)
	defer C.free(p)
	if c := C.writekey(s, p, C.long(len(b))); c != 0 {
		return fmt.Errorf("Keychain write failed (%d)", int(c))
	}
	return nil
}
