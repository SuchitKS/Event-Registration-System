// QueueStatus.jsx — Drop-in replacement
// Handles: holding (seat reserved), queued (waiting in line), promoted (moved up)
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from './api.js';

export default function QueueStatus({ eventId, initialData, onSeatAvailable, onExpired }) {
  const [data, setData]         = useState(initialData || null);
  const [secondsLeft, setSecondsLeft] = useState(initialData?.expiresIn || 0);
  const pollRef   = useRef(null);
  const timerRef  = useRef(null);
  const mountedRef = useRef(true);

  // ── countdown tick ──────────────────────────────────────────
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) return 0;
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  // ── reset countdown whenever we get fresh data from server ──
  useEffect(() => {
    if (data?.expiresIn != null) {
      setSecondsLeft(data.expiresIn);
    }
  }, [data]);

  // ── poll server every 8s ────────────────────────────────────
  const poll = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const res = await apiFetch(`/api/events/${eventId}/queue-position`);
      if (!res.ok) return;
      const d = await res.json();
      if (!mountedRef.current) return;

      if (d.status === 'expired') {
        onExpired?.();
        return;
      }
      if (d.status === 'submitted') {
        return;
      }
      // Promoted from queue to holding
      if (d.status === 'holding' && d.promoted) {
        setData(d);
        setSecondsLeft(d.expiresIn);
        onSeatAvailable?.();
        return;
      }
      setData(d);
    } catch (_) {}
  }, [eventId, onSeatAvailable, onExpired]);

  useEffect(() => {
    mountedRef.current = true;
    // Poll immediately, then every 8 seconds
    poll();
    pollRef.current = setInterval(poll, 8000);
    return () => {
      mountedRef.current = false;
      clearInterval(pollRef.current);
    };
  }, [poll]);

  // ── expired via countdown ───────────────────────────────────
  useEffect(() => {
    if (secondsLeft === 0 && data && data.status !== 'holding') {
      // Give it one more server check before declaring expired
      poll();
    }
  }, [secondsLeft]);

  // ── format timer ───────────────────────────────────────────
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  if (!data) {
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

  // ── HOLDING: seat is reserved for this user ─────────────────
  if (data.status === 'holding') {
    return (
      <div className="queue-status holding">
        <div className="queue-status-icon">🎟️</div>
        <div className="queue-status-body">
          <div className="queue-status-title">SEAT RESERVED</div>
          <div className="queue-status-sub">
            Complete payment within <strong>{timeStr}</strong> or your seat will be released.
          </div>
          <div className="queue-status-timer">{timeStr}</div>
        </div>
      </div>
    );
  }

  // ── QUEUED: waiting in line ─────────────────────────────────
  if (data.status === 'queued') {
    const pos = data.queuePosition ?? '…';
    return (
      <div className="queue-status queued">
        <div className="queue-status-icon">🔢</div>
        <div className="queue-status-body">
          <div className="queue-status-title">
            YOU ARE <span className="queue-pos">#{pos}</span> IN QUEUE
          </div>
          <div className="queue-status-sub">
            The event is currently full. You'll be automatically moved up as seats open.
            Keep this window open. Queue expires in <strong>{timeStr}</strong>.
          </div>
          <div className="queue-status-progress">
            <div className="queue-status-progress-label">
              <span>Position</span>
              <span className="queue-pos-big">#{pos}</span>
            </div>
            <div className="queue-bar-track">
              <div
                className="queue-bar-fill"
                style={{ width: pos === 1 ? '90%' : `${Math.max(5, 100 - (pos - 1) * 15)}%` }}
              />
            </div>
            <div className="queue-status-hint">
              Polling for updates every few seconds…
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
