// Web Bluetooth wrapper for Polar H10 HR chest strap.
// BLE Heart Rate Service: 0x180D, HR Measurement characteristic: 0x2A37
// Flags byte bit 0: 0=8-bit HR value, 1=16-bit HR value (little-endian)

export type HRSample = { timestamp_ms: number; hr_bpm: number }
export type H10Status = 'idle' | 'connected' | 'disconnected' | 'reconnecting'

type HRCallback = (sample: HRSample) => void
type StatusCallback = (status: H10Status) => void

const HR_SERVICE = 0x180d
const HR_CHARACTERISTIC = 0x2a37
const RECONNECT_DELAY_MS = 2000
const MAX_RECONNECT_ATTEMPTS = 5

export class PolarH10 {
  private device: BluetoothDevice | null = null
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null
  private hrCallbacks: HRCallback[] = []
  private statusCallbacks: StatusCallback[] = []
  private reconnectAttempts = 0
  private destroyed = false

  onHR(cb: HRCallback) { this.hrCallbacks.push(cb) }
  onStatus(cb: StatusCallback) { this.statusCallbacks.push(cb) }
  offHR(cb: HRCallback) { this.hrCallbacks = this.hrCallbacks.filter(f => f !== cb) }
  offStatus(cb: StatusCallback) { this.statusCallbacks = this.statusCallbacks.filter(f => f !== cb) }

  async connect(): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth not supported — use Chrome on Android')
    }
    this.destroyed = false
    this.reconnectAttempts = 0
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [HR_SERVICE] }],
    })
    this.device.addEventListener('gattserverdisconnected', this.handleDisconnect)
    await this.connectGATT()
  }

  private async connectGATT(): Promise<void> {
    if (!this.device?.gatt) throw new Error('No GATT server')
    const server = await this.device.gatt.connect()
    const service = await server.getPrimaryService(HR_SERVICE)
    this.characteristic = await service.getCharacteristic(HR_CHARACTERISTIC)
    this.characteristic.addEventListener('characteristicvaluechanged', this.handleHRNotification)
    await this.characteristic.startNotifications()
    this.reconnectAttempts = 0
    this.emitStatus('connected')
  }

  private handleHRNotification = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value
    if (!value) return
    const flags = value.getUint8(0)
    const is16bit = (flags & 0x01) !== 0
    const hr_bpm = is16bit ? value.getUint16(1, true) : value.getUint8(1)
    this.hrCallbacks.forEach(cb => cb({ timestamp_ms: Date.now(), hr_bpm }))
  }

  private handleDisconnect = () => {
    this.emitStatus('disconnected')
    if (!this.destroyed) this.scheduleReconnect()
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return
    this.emitStatus('reconnecting')
    this.reconnectAttempts++
    setTimeout(() => {
      if (!this.destroyed) {
        this.connectGATT().catch(() => this.scheduleReconnect())
      }
    }, RECONNECT_DELAY_MS * this.reconnectAttempts)
  }

  disconnect() {
    this.destroyed = true
    if (this.characteristic) {
      this.characteristic.stopNotifications().catch(() => {})
      this.characteristic.removeEventListener('characteristicvaluechanged', this.handleHRNotification)
      this.characteristic = null
    }
    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this.handleDisconnect)
      this.device.gatt?.disconnect()
      this.device = null
    }
    this.emitStatus('idle')
  }

  private emitStatus(status: H10Status) {
    this.statusCallbacks.forEach(cb => cb(status))
  }
}
