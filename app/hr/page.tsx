import HrPatientClient from './HrPatientClient'

// Public, no-auth page. Identification is by Polar H10 device name; the strap
// IS the credential. Mirrors the cardiac-vsm-app /hr/p flow.
export default function HrPatientPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-md p-4 pb-12">
        <HrPatientClient />
      </main>
    </div>
  )
}
