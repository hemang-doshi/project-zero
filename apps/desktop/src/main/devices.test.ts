import { describe, expect, it, vi } from 'vitest'
import {
  classifyBt,
  classifyUsb,
  createDeviceLister,
  parseBluetoothProfiler,
  parseUsbIoreg
} from './devices'

// Fixture: synthetic sample of `ioreg -r -c IOUSBDevice` from the
// synthetic test fixture. Serials redacted; names, vendors, ids, classes
// and child-interface markers kept verbatim so the parser pins real shapes.
const USB_FIXTURE = `+-o USB 2.0 Hub@00100000  <class IOUSBHostDevice, id 0x10000471d, registered, matched, active, busy 0 (988 ms), retain 34>
  | {
  |   "idProduct" = 10
  |   "bDeviceClass" = 9
  |   "idVendor" = 100
  |   "USB Product Name" = "USB 2.0 Hub"
  |   "locationID" = 1024
  | }
  |
  +-o AppleUSB20HubPort@00140000  <class AppleUSB20HubPort, id 0x100004730, registered, matched, active, busy 0 (960 ms), retain 16>
  |   +-o USB2.0 Hub@00140000  <class IOUSBHostDevice, id 0x100004742, registered, matched, active, busy 0 (960 ms), retain 34>
  |     | {
  |     |   "idProduct" = 11
  |     |   "bDeviceClass" = 9
  |     |   "idVendor" = 101
  |     |   "USB Product Name" = "USB2.0 Hub"
  |     |   "USB Vendor Name" = "VIA Labs, Inc."
  |     |   "locationID" = 2048
  |     | }
  |     |
  |     +-o AppleUSB20HubPort@00141000  <class AppleUSB20HubPort, id 0x10000474a, registered, matched, active, busy 0 (769 ms), retain 15>
  |     | +-o Example Keyboard@00141000  <class IOUSBHostDevice, id 0x100004773, registered, matched, active, busy 0 (768 ms), retain 51>
  |     |   | {
  |     |   |   "idProduct" = 12
  |     |   |   "bDeviceClass" = 0
  |     |   |   "USB Product Name" = "Example Keyboard"
  |     |   |   "USB Vendor Name" = "Example Devices"
  |     |   |   "kUSBVendorString" = "Example Devices"
  |     |   |   "idVendor" = 102
  |     |   |   "locationID" = 4096
  |     |   | }
  |     |   |
  |     |   +-o IOUSBHostInterface@0  <class IOUSBHostInterface, id 0x10000477b, registered, matched, active, busy 0 (590 ms), retain 11>
  |     |   | +-o AppleUserUSBHostHIDDevice  <class AppleUserHIDDevice, id 0x100004782, registered, matched, active, busy 0 (557 ms), retain 16>
  |     |   +-o IOUSBHostInterface@1  <class IOUSBHostInterface, id 0x10000477c, registered, matched, active, busy 0 (712 ms), retain 11>
  |     |   | +-o AppleUserUSBHostHIDDevice  <class AppleUserHIDDevice, id 0x100004780, registered, matched, active, busy 0 (688 ms), retain 17>
  |     +-o AppleUSB20HubPort@00142000  <class AppleUSB20HubPort, id 0x10000474e, registered, matched, active, busy 0 (53 ms), retain 15>
  |     | +-o Example Serial Adapter@00142000  <class IOUSBHostDevice, id 0x1000047ce, registered, matched, active, busy 0 (52 ms), retain 41>
  |     |   | {
  |     |   |   "idProduct" = 13
  |     |   |   "bDeviceClass" = 255
  |     |   |   "USB Product Name" = "Example Serial Adapter"
  |     |   |   "idVendor" = 102
  |     |   |   "locationID" = 4100
  |     |   | }
  |     |   |
  |     |   +-o IOUSBHostInterface@0  <class IOUSBHostInterface, id 0x1000047d5, registered, matched, active, busy 0 (39 ms), retain 7>
  |     |   | +-o AppleUSBCHCOM  <class IOUserSerial, id 0x1000047dc, registered, matched, active, busy 0 (2 ms), retain 11>
  |     |   |   +-o IOSerialBSDClient  <class IOSerialBSDClient, id 0x1000047ee, registered, matched, active, busy 0 (1 ms), retain 5>
  |     +-o AppleUSB20HubPort@00144000  <class AppleUSB20HubPort, id 0x100004752, registered, matched, active, busy 0 (607 ms), retain 15>
  |     | +-o Example Receiver@00144000  <class IOUSBHostDevice, id 0x10000479f, registered, matched, active, busy 0 (608 ms), retain 58>
  |     |   | {
  |     |   |   "kUSBSerialNumberString" = "REDACTED-SERIAL"
  |     |   |   "idProduct" = 14
  |     |   |   "bDeviceClass" = 0
  |     |   |   "USB Product Name" = "Example Receiver"
  |     |   |   "USB Vendor Name" = "Example Devices"
  |     |   |   "idVendor" = 102
  |     |   |   "locationID" = 4104
  |     |   | }
  |     |   |
  |     |   +-o IOUSBHostInterface@0  <class IOUSBHostInterface, id 0x1000047a6, registered, matched, active, busy 0 (403 ms), retain 11>
  |     |   | +-o AppleUserUSBHostHIDDevice  <class AppleUserHIDDevice, id 0x1000047af, registered, matched, active, busy 0 (385 ms), retain 17>
  |     |   +-o IOUSBHostInterface@1  <class IOUSBHostInterface, id 0x1000047a8, registered, matched, active, busy 0 (279 ms), retain 12>
  |     |   | +-o AppleUserUSBHostHIDDevice  <class AppleUserHIDDevice, id 0x1000047ad, registered, matched, active, busy 0 (250 ms), retain 16>
  +-o USB3.0 Hub@00200000  <class IOUSBHostDevice, id 0x100004704, registered, matched, active, busy 0 (79 ms), retain 33>
  | {
  |   "idProduct" = 15
  |   "bDeviceClass" = 9
  |   "idVendor" = 101
  |   "USB Product Name" = "USB3.0 Hub"
  |   "locationID" = 8192
  | }
  |
  | +-o AppleUSB30HubPort@00230000  <class AppleUSB30HubPort, id 0x100004713, registered, matched, active, busy 0 (65 ms), retain 15>
  | | +-o USB 10/100/1000 LAN@00230000  <class IOUSBHostDevice, id 0x1000047d9, registered, matched, active, busy 0 (64 ms), retain 179>
  | |   | {
  | |   |   "kUSBSerialNumberString" = "REDACTED-SERIAL"
  | |   |   "idProduct" = 16
  | |   |   "bDeviceClass" = 0
  | |   |   "USB Product Name" = "Example Network Adapter"
  | |   |   "USB Vendor Name" = "Example Devices"
  | |   |   "idVendor" = 103
  | |   |   "locationID" = 8200
  | |   | }
  | |   |
  | |   +-o CDC Communications Control@0  <class IOUSBHostInterface, id 0x1000047e4, registered, matched, active, busy 0 (41 ms), retain 11>
  | |   | +-o AppleUserECM  <class IOUserNetworkEthernet, id 0x1000047e8, registered, matched, active, busy 0 (5 ms), retain 21>
  +-o Generic Billboard Device@01100000  <class IOUSBHostDevice, id 0x1000046ec, registered, matched, active, busy 0 (9 ms), retain 41>
  | {
  |   "idProduct" = 17
  |   "bDeviceClass" = 17
  |   "idVendor" = 104
  |   "USB Product Name" = "Generic Billboard Device"
  |   "USB Vendor Name" = "Fresco Logic, Inc"
  |   "locationID" = 8193
  | }
`

// Fixture: synthetic sample of `system_profiler SPBluetoothDataType -json`
// (deterministic test data). Addresses, device names, ids and vendors are synthetic; the
// connected/remembered split kept as representative parser input.
const BT_FIXTURE = JSON.stringify({
  SPBluetoothDataType: [
    {
      controller_properties: {
        controller_address: 'REDACTED-ADDR',
        controller_chipset: 'Example Controller'
      },
      device_connected: [
        {
          'Example Audio': {
            device_address: 'REDACTED-ADDR-1',
            device_minorType: 'Headset',
            device_services: '0x800019 < HFP AVRCP A2DP ACL >'
          }
        }
      ],
      device_not_connected: [
        { 'Example Mouse': { device_address: 'REDACTED-ADDR-2', device_minorType: 'Mouse' } },
        { 'Example Speaker': { device_address: 'REDACTED-ADDR-3', device_minorType: 'Headset' } },
        { 'Example Phone': { device_address: 'REDACTED-ADDR-4' } }
      ]
    }
  ]
})

describe('parseUsbIoreg', () => {
  it('yields product names with vendors, skipping hubs and billboards', () => {
    const devices = parseUsbIoreg(USB_FIXTURE)
    expect(devices).toEqual([
      {
        id: 'usb-102-12-4096',
        name: 'Example Keyboard',
        transport: 'usb',
        kind: 'keyboard',
        vendor: 'Example Devices'
      },
      {
        id: 'usb-102-13-4100',
        name: 'Example Serial Adapter',
        transport: 'usb',
        kind: 'serial'
      },
      {
        id: 'usb-102-14-4104',
        name: 'Example Receiver',
        transport: 'usb',
        kind: 'mouse',
        vendor: 'Example Devices'
      },
      {
        id: 'usb-103-16-8200',
        name: 'Example Network Adapter',
        transport: 'usb',
        kind: 'other',
        vendor: 'Example Devices'
      }
    ])
  })

  it('returns empty for empty or malformed input, never throws', () => {
    expect(parseUsbIoreg('')).toEqual([])
    expect(parseUsbIoreg('not ioreg output\n+-o broken')).toEqual([])
  })
})

describe('classifyUsb', () => {
  it('needs HID children before calling a generic receiver a mouse', () => {
    expect(classifyUsb('Example Receiver', { hid: true, serial: false, net: false })).toBe('mouse')
    expect(classifyUsb('Example Receiver', { hid: false, serial: false, net: false })).toBe('other')
  })

  it('treats serial-driver children as serial even with a generic name', () => {
    expect(classifyUsb('Example Serial Adapter', { hid: false, serial: true, net: false })).toBe('serial')
  })
})

describe('classifyBt', () => {
  it('maps minor types to kinds, unknown to other', () => {
    expect(classifyBt('Headset')).toBe('audio')
    expect(classifyBt('Mouse')).toBe('mouse')
    expect(classifyBt('Keyboard')).toBe('keyboard')
    expect(classifyBt(null)).toBe('other')
    expect(classifyBt('')).toBe('other')
  })
})

describe('parseBluetoothProfiler', () => {
  it('lists connected devices only, with real names and kinds', () => {
    expect(parseBluetoothProfiler(BT_FIXTURE)).toEqual([
      {
        id: 'bt-REDACTED-ADDR-1',
        name: 'Example Audio',
        transport: 'bluetooth',
        kind: 'audio'
      }
    ])
  })

  it('returns empty for malformed JSON or missing sections, never throws', () => {
    expect(parseBluetoothProfiler('nope')).toEqual([])
    expect(parseBluetoothProfiler('{"SPBluetoothDataType": [{}]}')).toEqual([])
    expect(parseBluetoothProfiler('{"other": []}')).toEqual([])
  })
})

describe('createDeviceLister', () => {
  const usb = (): Promise<string | null> => Promise.resolve(USB_FIXTURE)
  const bt = (): Promise<string | null> => Promise.resolve(BT_FIXTURE)

  it('reads the slow Bluetooth path once per launch, then serves the cache', async () => {
    const spawnUsb = vi.fn(usb)
    const readBluetooth = vi.fn(bt)
    const lister = createDeviceLister({ spawnUsb, readBluetooth })
    const first = await lister.list(false)
    expect(first.note).toBeNull()
    expect(first.devices.map((d) => d.name)).toEqual([
      'Example Keyboard',
      'Example Serial Adapter',
      'Example Receiver',
      'Example Network Adapter',
      'Example Audio'
    ])
    const second = await lister.list(false)
    expect(second.devices).toEqual(first.devices)
    expect(spawnUsb).toHaveBeenCalledTimes(2)
    expect(readBluetooth).toHaveBeenCalledTimes(1)
  })

  it('re-reads Bluetooth on explicit refresh', async () => {
    const readBluetooth = vi.fn(bt)
    const lister = createDeviceLister({ spawnUsb: usb, readBluetooth })
    await lister.list(false)
    await lister.list(true)
    expect(readBluetooth).toHaveBeenCalledTimes(2)
  })

  it('keeps the stale Bluetooth cache when a refresh fails', async () => {
    let fail = false
    const readBluetooth = vi.fn(() => (fail ? Promise.resolve(null) : Promise.resolve(BT_FIXTURE)))
    const lister = createDeviceLister({ spawnUsb: usb, readBluetooth })
    const first = await lister.list(false)
    expect(first.devices.some((d) => d.name === 'Example Audio')).toBe(true)
    fail = true
    const second = await lister.list(true)
    expect(second.devices.some((d) => d.name === 'Example Audio')).toBe(true)
    expect(second.note).toBeNull()
  })

  it('fails soft to empty with an honest note when both sources fail', async () => {
    const lister = createDeviceLister({
      spawnUsb: () => Promise.resolve(null),
      readBluetooth: () => Promise.resolve(null)
    })
    const result = await lister.list(false)
    expect(result.devices).toEqual([])
    expect(result.note).toContain('USB enumeration unavailable')
    expect(result.note).toContain('Bluetooth names unavailable')
    expect(result.note).toContain('No local USB or Bluetooth devices seen.')
  })
})
