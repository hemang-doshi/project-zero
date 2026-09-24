// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DEVICE_KIND_GLYPH, TRANSPORT_CHIP, matchDeviceByKind, parseDevices } from './devices.model'

describe('parseDevices', () => {
  it('parses the devices.list wire shape leniently', () => {
    const parsed = parseDevices({
      devices: [
        {
          id: 'usb-1',
          name: 'Gaming Keyboard',
          transport: 'usb',
          kind: 'keyboard',
          vendor: 'BY Tech'
        },
        { id: 'bt-1', name: 'Spykar Sound', transport: 'bluetooth', kind: 'audio' },
        { id: 'bad', name: '', transport: 'usb', kind: 'keyboard' },
        { id: 'bad2', name: 'X', transport: 'wifi', kind: 'keyboard' },
        { id: 'bad3', name: 'Y', transport: 'usb', kind: 'printer' },
        'nonsense'
      ],
      note: 'hi'
    })
    expect(parsed.devices).toEqual([
      {
        id: 'usb-1',
        name: 'Gaming Keyboard',
        transport: 'usb',
        kind: 'keyboard',
        vendor: 'BY Tech'
      },
      { id: 'bt-1', name: 'Spykar Sound', transport: 'bluetooth', kind: 'audio' }
    ])
    expect(parsed.note).toBe('hi')
  })

  it('fails soft to empty on malformed payloads', () => {
    expect(parseDevices(null)).toEqual({ devices: [], note: null })
    expect(parseDevices({})).toEqual({ devices: [], note: null })
    expect(parseDevices({ devices: [], note: 42 })).toEqual({ devices: [], note: null })
  })
})

describe('matchDeviceByKind', () => {
  const devices = [
    { id: 'usb-kb', name: 'Gaming Keyboard', transport: 'usb' as const, kind: 'keyboard' as const },
    { id: 'usb-ms', name: 'USB Receiver', transport: 'usb' as const, kind: 'mouse' as const },
    { id: 'bt-au', name: 'Spykar Sound', transport: 'bluetooth' as const, kind: 'audio' as const }
  ]
  it('matches keyboard to keyboard and mouse to mouse', () => {
    expect(matchDeviceByKind(devices, 'keyboard')?.name).toBe('Gaming Keyboard')
    expect(matchDeviceByKind(devices, 'mouse')?.name).toBe('USB Receiver')
  })

  it('returns null when no device of that kind is connected', () => {
    expect(matchDeviceByKind([], 'keyboard')).toBeNull()
    expect(
      matchDeviceByKind(
        devices.filter((d) => d.kind !== 'mouse'),
        'mouse'
      )
    ).toBeNull()
  })

  it('prefers USB over Bluetooth for the same kind', () => {
    const both = [
      { id: 'bt-kb', name: 'BT Keys', transport: 'bluetooth' as const, kind: 'keyboard' as const },
      ...devices
    ]
    expect(matchDeviceByKind(both, 'keyboard')?.name).toBe('Gaming Keyboard')
  })
})

describe('device chips', () => {
  it('maps every kind to a text glyph and every transport to a chip', () => {
    expect(DEVICE_KIND_GLYPH).toEqual({
      keyboard: '⌨',
      mouse: '◉',
      audio: '♪',
      serial: '⇄',
      other: '○'
    })
    expect(TRANSPORT_CHIP).toEqual({ usb: 'USB', bluetooth: 'BT' })
  })
})
