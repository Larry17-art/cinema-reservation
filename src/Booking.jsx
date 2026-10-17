import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase.js'
import { Stack, bestSeats } from './dsa.js'
import { ROWS, COLS, dayLabel, timeFmt, peso } from './util.js'

export function SeatPicker({ movie, showtime, profile, onBack, onBooked }) {
  const [taken, setTaken] = useState(new Set())        // Hash Set: O(1) "is seat taken?"
  const [picked, setPicked] = useState([])             // used as a Stack (undo = pop)
  const [qty, setQty] = useState(2)
  const [joined, setJoined] = useState(false)
  const [name, setName] = useState(profile.full_name || '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const loadTaken = async () => {
    const { data } = await supabase.from('taken_seats').select('seat').eq('showtime_id', showtime.id)
    setTaken(new Set((data || []).map((b) => b.seat)))
    const w = await supabase.from('waitlist').select('id').eq('showtime_id', showtime.id).eq('user_id', profile.id)
    setJoined(!!w.data?.length)
  }
  useEffect(() => { loadTaken() }, [showtime.id])

  // 2D array (matrix) of seat states
  const grid = useMemo(() => ROWS.map((r) => COLS.map((c) => taken.has(`${r}${c}`))), [taken])
  const soldOut = taken.size >= ROWS.length * COLS.length

  const toggle = (seat) => {
    if (taken.has(seat)) return
    const s = new Stack(picked)
    if (picked.includes(seat)) return setPicked(picked.filter((x) => x !== seat))
    if (s.size >= 8) return
    setPicked(s.push(seat).items)
  }
  const undo = () => { const s = new Stack(picked); s.pop(); setPicked(s.items) }
  const suggest = () => {
    const res = bestSeats(grid, qty)
    if (!res) return setMsg(`No ${qty} adjacent seats are free in one row.`)
    setMsg(''); setPicked(res.map(([r, c]) => `${ROWS[r]}${COLS[c]}`))
  }
  const joinWaitlist = async () => {
    const { error } = await supabase.from('waitlist').insert({ showtime_id: showtime.id, email: profile.email })
    if (error) setMsg(error.message); else setJoined(true)
  }

  const confirm = async (e) => {
    e.preventDefault(); setMsg('')
    if (name.trim().length < 2) return setMsg('Enter the name for the booking.')
    setBusy(true)
    const ref = 'VS-' + Math.random().toString(36).slice(2, 8).toUpperCase()
    const rows = picked.map((seat) => ({ showtime_id: showtime.id, seat, customer_name: name.trim(), customer_email: profile.email, booking_ref: ref }))
    const { error } = await supabase.from('bookings').insert(rows)
    if (error) {
      setBusy(false); setPicked([]); await loadTaken()
      return setMsg(error.code === '23505' ? 'Someone just booked one of those seats. The map is updated, so choose again.' : `Booking failed: ${error.message}`)
    }
    onBooked({ ref, movie, showtime, seats: picked, name: name.trim(), total: picked.length * showtime.price })
  }

  return (
    <section className="seats">
      <button className="link" onClick={onBack}>Back to showtimes</button>
      <h1>{movie.title}</h1>
      <p className="muted">{dayLabel(showtime.starts_at)} · {timeFmt(showtime.starts_at)} · {showtime.hall}</p>

      <div className="tools">
        <label className="inline-l">Seats needed
          <select value={qty} onChange={(e) => setQty(+e.target.value)}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}</select>
        </label>
        <button type="button" className="chip" onClick={suggest}>Suggest best seats</button>
        <button type="button" className="chip" onClick={undo} disabled={!picked.length}>Undo last pick</button>
      </div>

      <div className="screen" aria-hidden="true"><span>Screen</span></div>
      <div className="map" role="group" aria-label="Seat map">
        {ROWS.map((r, ri) => (
          <div className="row" key={r}>
            <span className="rl">{r}</span>
            {COLS.map((c, ci) => {
              const id = `${r}${c}`
              const state = grid[ri][ci] ? 'taken' : picked.includes(id) ? 'picked' : 'free'
              return <button key={id} className={`seat ${state} ${c === 5 ? 'gap' : ''}`} disabled={state === 'taken'}
                aria-label={`Seat ${id}, ${state}`} aria-pressed={state === 'picked'} onClick={() => toggle(id)} />
            })}
          </div>
        ))}
      </div>
      <div className="legend"><span><i className="seat free" /> Available</span><span><i className="seat picked" /> Yours</span><span><i className="seat taken" /> Taken</span></div>

      {soldOut && (
        <div className="banner">This show is sold out. {joined ? "You're on the waitlist; we'll contact you if a seat opens." :
          <button className="link" onClick={joinWaitlist}>Join the waitlist</button>}</div>
      )}

      <form className="checkout" onSubmit={confirm}>
        <div>
          <h3>Your seats</h3>
          <p className="big-seats">{picked.length ? [...picked].sort().join(', ') : 'Tap seats on the map'}</p>
          <p className="muted">{picked.length} × {peso(showtime.price)} = <strong>{peso(picked.length * showtime.price)}</strong></p>
        </div>
        <label>Name on booking<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Email<input value={profile.email} disabled /></label>
        {msg && <p className="banner err">{msg}</p>}
        <button className="primary" disabled={!picked.length || busy}>{busy ? 'Booking…' : `Book ${picked.length || ''} ticket${picked.length === 1 ? '' : 's'}`}</button>
      </form>
    </section>
  )
}

export function MyTickets({ onClose }) {
  const [groups, setGroups] = useState(null)
  const load = async () => {
    const { data } = await supabase.from('bookings').select('*, showtimes(starts_at, hall, movies(title))').order('created_at')
    const stack = new Stack()                      // Stack: push oldest → newest, read from the top = most recent first
    const byRef = {}
    ;(data || []).forEach((b) => { (byRef[b.booking_ref] ||= []).push(b) })
    Object.values(byRef).forEach((g) => stack.push(g))
    setGroups(stack.items.slice().reverse())
  }
  useEffect(() => { load() }, [])
  const cancel = async (g) => {
    if (!confirm(`Cancel booking ${g[0].booking_ref}?`)) return
    await supabase.from('bookings').delete().eq('booking_ref', g[0].booking_ref)
    load()
  }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="My tickets">
        <h2>My tickets</h2>
        {groups && !groups.length && <p className="muted">You have no bookings yet.</p>}
        {groups?.map((g) => (
          <div className="mini" key={g[0].booking_ref}>
            <strong>{g[0].showtimes?.movies?.title}</strong>
            <span>{dayLabel(g[0].showtimes.starts_at)} · {timeFmt(g[0].showtimes.starts_at)} · {g[0].showtimes.hall}</span>
            <span>Seats {g.map((x) => x.seat).sort().join(', ')} · Ref {g[0].booking_ref}</span>
            <button className="link" onClick={() => cancel(g)}>Cancel booking</button>
          </div>
        ))}
        <button className="link" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
