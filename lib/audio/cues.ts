const MUTED_KEY = 'audio_muted'

export function isMuted(): boolean {
  try { return localStorage.getItem(MUTED_KEY) === '1' } catch { return false }
}

export function setMuted(muted: boolean): void {
  try { localStorage.setItem(MUTED_KEY, muted ? '1' : '0') } catch {}
}

function speak(text: string): void {
  if (isMuted() || typeof window === 'undefined' || !window.speechSynthesis) return
  const utt = new SpeechSynthesisUtterance(text)
  utt.rate = 0.9
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utt)
}

export function startReadyCue(): void {
  speak('three, two, one, begin')
}

export function repCue(): void {
  if (isMuted() || typeof window === 'undefined') return
  try {
    const Ctx =
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
      window.AudioContext
    if (!Ctx) return
    const actx = new Ctx()
    const osc = actx.createOscillator()
    const gain = actx.createGain()
    osc.connect(gain)
    gain.connect(actx.destination)
    osc.frequency.value = 600
    gain.gain.setValueAtTime(0.4, actx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.12)
    osc.start(actx.currentTime)
    osc.stop(actx.currentTime + 0.12)
  } catch { /* audio context not available */ }
}

export type PauseReason = 'hr_breach' | 'h10_disconnect' | 'out_of_frame' | 'multiple_people'

export function restCue(seconds: number): void { speak(`rest, ${seconds} seconds`) }
export function nextExerciseCue(name: string): void { speak(`next exercise: ${name}`) }

export function pauseCue(reason: PauseReason): void {
  const msgs: Record<PauseReason, string> = {
    hr_breach: 'Heart rate too high. Please rest.',
    h10_disconnect: 'Heart rate monitor disconnected.',
    out_of_frame: 'Body not fully visible. Please step into the camera frame.',
    multiple_people: 'Please exercise alone.',
  }
  speak(msgs[reason])
}

export function resumeReadyCue(): void { speak('show T-pose when ready to continue') }
export function sessionCompleteCue(): void { speak('session complete, well done') }
