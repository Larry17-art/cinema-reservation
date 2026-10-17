import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { validEmail } from './util.js'

// Shows login -> Google Authenticator code -> app. A code is required on EVERY login.
export default function AuthGate({ children }) {
  const [step, setStep] = useState('loading') // loading | login | mfa | ready
  const [profile, setProfile] = useState(null)

  const evaluate = async (session) => {
    if (!session) { setProfile(null); return setStep('login') }
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (data?.currentLevel === 'aal2') {
      const { data: p } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      setProfile(p); setStep('ready')
    } else setStep('mfa')
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => evaluate(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((evt, s) => {
      if (evt === 'SIGNED_IN' || evt === 'SIGNED_OUT') setTimeout(() => evaluate(s), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const signOut = () => supabase.auth.signOut()

  if (step === 'loading') return <p className="muted pad center">Loading…</p>
  if (step === 'login') return <Login />
  if (step === 'mfa') return <Mfa onDone={async () => evaluate((await supabase.auth.getSession()).data.session)} onCancel={signOut} />
  return children({ profile, signOut })
}

function Login() {
  const [mode, setMode] = useState('login')
  const [f, setF] = useState({ name: '', email: '', password: '' })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault(); setMsg('')
    if (mode === 'signup' && f.name.trim().length < 2) return setMsg('Enter your full name.')
    if (!validEmail(f.email)) return setMsg('Enter a valid email address.')
    if (f.password.length < 8) return setMsg('Password must be at least 8 characters.')
    setBusy(true)
    const email = f.email.trim().toLowerCase()
    const { data, error } = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password: f.password })
      : await supabase.auth.signUp({ email, password: f.password, options: { data: { full_name: f.name.trim() } } })
    setBusy(false)
    if (error) return setMsg(error.message)
    if (mode === 'signup' && !data.session) setMsg('Account created. Check your email to confirm it, then log in.')
  }

  return (
    <main className="auth">
      <h1 className="brand-lg">Velvet Seat</h1>
      <form className="panel" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Log in' : 'Create account'}</h2>
        {mode === 'signup' && <label>Full name<input value={f.name} onChange={set('name')} autoComplete="name" /></label>}
        <label>Email<input type="email" value={f.email} onChange={set('email')} autoComplete="email" /></label>
        <label>Password<input type="password" value={f.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        {msg && <p className="banner err">{msg}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Continue' : 'Sign up'}</button>
        <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMsg('') }}>
          {mode === 'login' ? 'New here? Create an account' : 'Have an account? Log in'}
        </button>
      </form>
    </main>
  )
}

function Mfa({ onDone, onCancel }) {
  const [factorId, setFactorId] = useState(null)
  const [qr, setQr] = useState(null)
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) return setMsg(error.message)
      if (data.totp.length) return setFactorId(data.totp[0].id) // already set up: just ask for the code
      for (const f of data.all.filter((x) => x.status === 'unverified')) await supabase.auth.mfa.unenroll({ factorId: f.id })
      const en = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Google Authenticator ' + Date.now() })
      if (en.error) return setMsg(en.error.message)
      setFactorId(en.data.id); setQr(en.data.totp.qr_code); setSecret(en.data.totp.secret)
    })()
  }, [])

  const verify = async (e) => {
    e.preventDefault(); setMsg('')
    if (!/^\d{6}$/.test(code)) return setMsg('Enter the 6-digit code from the app.')
    setBusy(true)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
    setBusy(false)
    if (error) { setCode(''); return setMsg('That code is wrong or expired. Try the new one.') }
    onDone()
  }

  return (
    <main className="auth">
      <h1 className="brand-lg">Velvet Seat</h1>
      <form className="panel" onSubmit={verify}>
        <h2>{qr ? 'Set up Google Authenticator' : 'Enter your code'}</h2>
        {qr ? (
          <>
            <p className="muted">1. Open Google Authenticator and tap <strong>+</strong>, then <strong>Scan a QR code</strong>.</p>
            <img className="qr" src={qr} alt="Scan this QR code with Google Authenticator" />
            <p className="muted small">Can't scan? Enter this key manually: <code>{secret}</code></p>
            <p className="muted">2. Type the 6-digit code it shows.</p>
          </>
        ) : <p className="muted">Open Google Authenticator and type the 6-digit code for Velvet Seat.</p>}
        <input className="code" inputMode="numeric" maxLength={6} autoFocus placeholder="000000" value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label="6-digit code" />
        {msg && <p className="banner err">{msg}</p>}
        <button className="primary" disabled={busy || !factorId}>{busy ? 'Checking…' : 'Verify'}</button>
        <button type="button" className="link" onClick={onCancel}>Cancel and sign out</button>
      </form>
    </main>
  )
}
