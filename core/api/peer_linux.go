//go:build linux

package api

import (
	"golang.org/x/sys/unix"
	"net"
	"os"
)

func sameOwner(c *net.UnixConn) bool {
	raw, e := c.SyscallConn()
	if e != nil {
		return false
	}
	ok := false
	e = raw.Control(func(fd uintptr) {
		cred, e := unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED)
		ok = e == nil && cred.Uid == uint32(os.Getuid())
	})
	return e == nil && ok
}
