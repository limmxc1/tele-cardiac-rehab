// Live-monitoring BLE HR client. Distinct from lib/hr/polarH10.ts because the
// live dashboard flow needs:
//   - contact-bit validation (Polar H10 reports skin-contact in the flags byte;
//     readings without contact must be suppressed, not surfaced as 0 bpm)
//   - a 5-second watchdog that nulls out the live HR if notifications stop
//     flowing (the strap can stay GATT-connected while the elastic loosens)
//   - silent reconnect to a previously-permitted device via getDevices() +
//     watchAdvertisements(), so refreshing the patient page doesn't force a
//     chooser prompt
// Mirrors the cardiac-vsm-app's HRMonitor class in TS.

export type HrEvent = 'hr' | 'status' | 'disconnect'
export type HrStatusKind = 'idle' | 'connected' | 'error'
export type HrStatusPayload = { kind: HrStatusKind; text: string }

type HrCallback = (hr: number | null) => void
type StatusCallback = (s: HrStatusPayload) => void
type DisconnectCallback = () => void

export class HRMonitor {
  device: BluetoothDevice | null = null
  private server: BluetoothRemoteGATTServer | null = null
  private char: BluetoothRemoteGATTCharacteristic | null = null
  connected = false
  liveHr: number | null = null
  lastHrAt = 0

  private hrHandlers: HrCallback[] = []
  private statusHandlers: StatusCallback[] = []
  private disconnectHandlers: DisconnectCallback[] = []
  private watchdog: ReturnType<typeof setInterval> | null = null

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth
  }

  // List devices the user already granted permission to in a prior visit.
  // Requires the chrome://flags/#enable-web-bluetooth-new-permissions-backend
  // experiment (default ON in modern Chrome).
  static async knownDevices(): Promise<BluetoothDevice[]> {
    if (!HRMonitor.isSupported() || !navigator.bluetooth.getDevices) return []
    try {
      return await navigator.bluetooth.getDevices()
    } catch {
      return []
    }
  }

  on(event: 'hr', fn: HrCallback): void
  on(event: 'status', fn: StatusCallback): void
  on(event: 'disconnect', fn: DisconnectCallback): void
  on(event: HrEvent, fn: HrCallback | StatusCallback | DisconnectCallback): void {
    if (event === 'hr') this.hrHandlers.push(fn as HrCallback)
    else if (event === 'status') this.statusHandlers.push(fn as StatusCallback)
    else if (event === 'disconnect') this.disconnectHandlers.push(fn as DisconnectCallback)
  }

  private emitHr(hr: number | null) {
    this.hrHandlers.forEach((fn) => fn(hr))
  }
  private emitStatus(payload: HrStatusPayload) {
    this.statusHandlers.forEach((fn) => fn(payload))
  }
  private emitDisconnect() {
    this.disconnectHandlers.forEach((fn) => fn())
  }

  // Try to silently reconnect to a device the browser already permitted.
  // Returns true on success, false if the device isn't reachable — the caller
  // can fall back to the chooser-driven connect() path.
  async reconnect(device: BluetoothDevice): Promise<boolean> {
    if (!device) return false
    this.emitStatus({ kind: 'idle', text: 'reconnecting…' })
    try {
      // Some platforms don't expose watchAdvertisements; that's fine — the
      // gatt.connect() below will simply wait for the strap to be in range.
      type WithAdvertisements = BluetoothDevice & { watchAdvertisements?: () => Promise<void> }
      const dev = device as WithAdvertisements
      if (dev.watchAdvertisements) {
        try {
          await dev.watchAdvertisements()
        } catch {
          // ignore — best effort
        }
      }
      device.addEventListener('gattserverdisconnected', this.handleDisconnect)
      const server = await device.gatt!.connect()
      const service = await server.getPrimaryService('heart_rate')
      const char = await service.getCharacteristic('heart_rate_measurement')
      char.addEventListener('characteristicvaluechanged', this.handleTick)
      await char.startNotifications()
      this.device = device
      this.server = server
      this.char = char
      this.connected = true
      this.emitStatus({
        kind: 'connected',
        text: `${device.name || 'connected'} · waiting…`,
      })
      this.startWatchdog()
      return true
    } catch {
      this.emitStatus({ kind: 'error', text: 'reconnect failed' })
      return false
    }
  }

  async connect(): Promise<void> {
    if (!HRMonitor.isSupported()) {
      this.emitStatus({ kind: 'error', text: 'Web Bluetooth not supported' })
      throw new Error('Web Bluetooth not supported')
    }
    this.emitStatus({ kind: 'idle', text: 'requesting device…' })
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['heart_rate'] }],
      optionalServices: ['battery_service'],
    })
    device.addEventListener('gattserverdisconnected', this.handleDisconnect)
    this.emitStatus({ kind: 'idle', text: 'connecting…' })
    const server = await device.gatt!.connect()
    const service = await server.getPrimaryService('heart_rate')
    const char = await service.getCharacteristic('heart_rate_measurement')
    char.addEventListener('characteristicvaluechanged', this.handleTick)
    await char.startNotifications()
    this.device = device
    this.server = server
    this.char = char
    this.connected = true
    this.emitStatus({
      kind: 'connected',
      text: `${device.name || 'connected'} · waiting…`,
    })
    this.startWatchdog()
  }

  disconnect(): void {
    this.stopWatchdog()
    try {
      if (this.char) this.char.removeEventListener('characteristicvaluechanged', this.handleTick)
      if (this.device && this.device.gatt?.connected) this.device.gatt.disconnect()
    } catch {
      // ignore
    }
    this.device = null
    this.server = null
    this.char = null
    this.connected = false
    this.liveHr = null
    this.emitStatus({ kind: 'idle', text: 'not connected' })
  }

  private handleTick = (event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic
    const v = target.value
    if (!v) return
    const flags = v.getUint8(0)
    const is16 = (flags & 0x01) !== 0
    const hr = is16 ? v.getUint16(1, true) : v.getUint8(1)
    const contactBits = (flags & 0x06) >>> 1
    const contactSupported = contactBits >= 2
    const hasContact = contactBits === 3
    const valid = hr > 0 && hr < 300 && (!contactSupported || hasContact)
    if (valid) {
      this.liveHr = hr
      this.lastHrAt = Date.now()
      this.emitHr(hr)
      if (this.connected && this.device) {
        this.emitStatus({
          kind: 'connected',
          text: this.device.name || 'connected',
        })
      }
    } else {
      this.liveHr = null
      if (this.connected && this.device) {
        this.emitStatus({
          kind: 'connected',
          text: `${this.device.name || 'connected'} · no contact`,
        })
      }
    }
  }

  private handleDisconnect = () => {
    this.stopWatchdog()
    this.connected = false
    this.liveHr = null
    this.emitStatus({ kind: 'error', text: 'disconnected' })
    this.emitDisconnect()
  }

  private startWatchdog() {
    this.stopWatchdog()
    this.watchdog = setInterval(() => {
      const since = Date.now() - (this.lastHrAt || 0)
      if (since > 5000 && this.liveHr != null) {
        this.liveHr = null
        this.emitHr(null)
        if (this.connected && this.device) {
          this.emitStatus({
            kind: 'connected',
            text: `${this.device.name || 'connected'} · no data`,
          })
        }
      }
    }, 1000)
  }
  private stopWatchdog() {
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = null
  }
}
