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
  speak('Make a circle above your head with both hands to start')
}

export function sessionCompleteCue(): void {
  speak('Recording complete')
}
