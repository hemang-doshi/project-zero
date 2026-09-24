# Hardware recovery

Original source: `/Users/hemangdoshi/Developer/times-gate`, commit
`94845470783cea4395af7f11e30a86f79d55e1ad`.

The USB chip probe verified classic ESP32-D0WD-V3 revision 3.1, 4MB flash.
The firmware uses the documented GPIO18/23/5/16/17 display wiring; fixed backlight.

Before flashing, require a completed 4,194,304-byte private flash backup and its
SHA256 in `.runtime/recovery/`. The backup includes Wi-Fi configuration and must
never be committed, uploaded, or attached to diagnostics. The chunked backup
tool verifies each chunk's size and retries serial errors; esptool verifies
transfer integrity. Keep a second owner-controlled copy before daily use.

With the actual serial port substituted, restore the complete backup with the
installed esptool executable:

```sh
esptool --chip esp32 --port "$ZERO_PORT" --baud 115200 write-flash 0 .runtime/recovery/auxdeck-original.bin
```

Do not erase flash first. Do not burn security eFuses. Close serial monitors
before reading or writing. If transport fails, leave the board recoverable in
the bootloader and retry with a reliable direct USB data connection.

Source-build fallback is documented in Times Gate's getting-started guide:
Arduino core esp32:esp32 3.3.11, board esp32:esp32:esp32, upload 115200, with
the AUXDECK_WIFI and AUXDECK_BLUETOOTH flags. Existing compiled artifacts are
under its ignored firmware build directory. Never overwrite that repository.

The current board's native BOOT input is GPIO0. It may be used after boot as an
active-low input; holding it during reset enters the bootloader. The EN/reset
button is not a Zero action input. Physical BOOT pause behavior was user-confirmed on 2026-09-08.

Prototype limitation: unique device keys persist in NVS, but physical flash
extraction is not prevented because irreversible flash-encryption/secure-boot
eFuses are intentionally untouched. Revoke a lost or compromised node.
