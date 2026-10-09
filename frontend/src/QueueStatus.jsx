import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from './api.js';
import './QueueStatus.css';

export default function QueueStatus({ eventId, initialData, onSeatAvailable, onExpired, contactPhone, contactName }) {
  const [data, setData] = useState(initialData || null);
  const [secondsLeft, setSecondsLeft] = useState(initialData?.expiresIn || 0);
  const pollRef = useRef(null);
  const mountedRef = useRef(true);
  const dataRef = useRef(initialData || null);
  // pending "leave the queue" call (so React StrictMode's fake unmount can cancel it)
  const releaseRef = useRef({ timer: null, eventId: null });

  // Parent passes new inline functions on every render. Keep them in a ref so they
  // never change `poll`, otherwise the effect below re-runs on every parent render
  // and its cleanup used to call DELETE /release-queue (removing you from the queue).
  const cbRef = useRef({ onSeatAvailable, onExpired });
  cbRef.current = { onSeatAvailable, onExpired };

  // ── countdown tick ────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setSecondsLeft(s => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  // ── keep dataRef in sync + reset countdown on fresh server data
  useEffect(() => {
    dataRef.current = data;
    if (data?.expiresIn != null) setSecondsLeft(data.expiresIn);
  }, [data]);

  // ── poll server ───────────────────────────────────────────────
  const poll = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const res = await apiFetch(`/api/events/${eventId}/queue-position`);
      if (!res.ok) return;
      const d = await res.json();
      if (!mountedRef.current) return;

      // Anything other than queued/holding means we no longer have a place in line.
      if (['expired', 'registered', 'available', 'full', 'seat_taken'].includes(d.status)) {
        cbRef.current.onExpired?.();
        return;
      }
      if (d.status === 'submitted' || d.status === 'rejected') return;

      if (d.status === 'holding') {
        cbRef.current.onSeatAvailable?.(d.expiresIn);
        return;
      }
      setData(d);
    } catch (_) { }
  }, [eventId]);

  // ── mount: start polling | real unmount: leave queue ──────────
  useEffect(() => {
    mountedRef.current = true;

    // StrictMode (dev) mounts, unmounts and re-mounts instantly. Cancel the pending release.
    if (releaseRef.current.timer && releaseRef.current.eventId === eventId) {
      clearTimeout(releaseRef.current.timer);
      releaseRef.current.timer = null;
    }

    poll();
    const loop = () => {
      // every 15s plus a random 0-5s so thousands of students never poll in the same second
      pollRef.current = setTimeout(async () => {
        await poll();
        if (mountedRef.current) loop();
      }, 15000 + Math.random() * 5000);
    };
    loop();

    return () => {
      mountedRef.current = false;
      clearTimeout(pollRef.current);

      // Only release if the person was merely QUEUED. If HOLDING, keep the seat for payment.
      // Delay by one tick: a fake StrictMode unmount is cancelled by the effect above.
      if (dataRef.current?.status === 'queued') {
        releaseRef.current.eventId = eventId;
        releaseRef.current.timer = setTimeout(() => {
          releaseRef.current.timer = null;
          apiFetch(`/api/events/${eventId}/release-queue`, { method: 'DELETE' }).catch(() => { });
        }, 0);
      }
    };
  }, [poll, eventId]);

  // ── hold timer reached 0 → ask the server what happened ───────
  useEffect(() => {
    if (secondsLeft === 0 && data?.status === 'holding') poll();
  }, [secondsLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  const help = contactPhone ? (
    <div className="queue-status-hint" style={{ marginTop: 10, color: '#0a0a0a', fontWeight: 600 }}>
      Need help? Call {contactName ? `${contactName} ` : 'the organiser '}
      <a href={`tel:${contactPhone}`} style={{ color: '#0047FF' }}>{contactPhone}</a>
    </div>
  ) : null;

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  // ── HOLDING ───────────────────────────────────────────────────
  if (data?.status === 'holding') {
    return (
      <div className="queue-status holding">
        <div className="queue-status-icon">🎟️</div>
        <div className="queue-status-body">
          <div className="queue-status-title">SEAT RESERVED</div>
          <div className="queue-status-sub">
            Complete payment within <strong>{timeStr}</strong> or your seat will be released.
          </div>
          <div className="queue-status-timer">{timeStr}</div>
          <button 
            style={{ 
              marginTop: '12px', padding: '10px 16px', background: '#0a0a0a', 
              color: '#FFE500', fontWeight: 'bold', border: 'none', 
              cursor: 'pointer', display: 'block', width: '100%', fontSize: '16px' 
            }} 
            onClick={() => cbRef.current.onSeatAvailable?.(secondsLeft)}
          >
            PAY NOW
          </button>
          {help}
        </div>
      </div>
    );
  }

  // ── QUEUED ────────────────────────────────────────────────────
  if (data?.status === 'queued') {
    const pos = data.queuePosition ?? '…';
    const posNum = typeof pos === 'number' ? pos : 1;
    return (
      <div className="queue-status queued">
        <div className="queue-status-icon">🔢</div>
        <div className="queue-status-body">
          <div className="queue-status-title">
            YOU ARE <span className="queue-pos">#{pos}</span> IN QUEUE
          </div>
          <div className="queue-status-sub">
            The event is currently full. You keep your place in line and move up as seats open.
            When it is your turn you get <strong>15 minutes</strong> to pay. Keep this window open.
          </div>
          <div className="queue-status-progress">
            <div className="queue-status-progress-label">
              <span>Position</span>
              <span className="queue-pos-big">#{pos}</span>
            </div>
            <div className="queue-bar-track">
              <div
                className="queue-bar-fill"
                style={{ width: posNum === 1 ? '90%' : `${Math.max(5, 100 - (posNum - 1) * 15)}%` }}
              />
            </div>
            <div className="queue-status-hint">This updates automatically every few seconds.</div>
          </div>
          {help}
        </div>
      </div>
    );
  }

  // ── CONNECTING / anything else (never render a blank box) ─────
  return (
    <div className="queue-status holding">
      <div className="queue-status-icon">⏳</div>
      <div className="queue-status-body">
        <div className="queue-status-title">CONNECTING…</div>
        <div className="queue-status-sub">Checking your position…</div>
      </div>
    </div>
  );
}
