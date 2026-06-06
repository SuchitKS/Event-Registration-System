import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from './api.js';

export default function QueueStatus({ eventId, initialData, onSeatAvailable, onExpired }) {
  const [data, setData]               = useState(initialData || null);
  const [secondsLeft, setSecondsLeft] = useState(initialData?.expiresIn || 0);
  const pollRef    = useRef(null);
  const timerRef   = useRef(null);
  const mountedRef = useRef(true);
  // ── tracks latest status so the unmount closure can read it ──
  const dataRef    = useRef(initialData || null);

  // ── countdown tick ────────────────────────────────────────────
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setSecondsLeft(s => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  // ── keep dataRef in sync + reset countdown on fresh server data
  useEffect(() => {
    dataRef.current = data;
    if (data?.expiresIn != null) setSecondsLeft(data.expiresIn);
  }, [data]);

  // ── poll server every 8s ──────────────────────────────────────
  const poll = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const res = await apiFetch(`/api/events/${eventId}/queue-position`);
      if (!res.ok) return;
      const d = await res.json();
      if (!mountedRef.current) return;

      if (d.status === 'expired') { onExpired?.(); return; }
      if (d.status === 'submitted') return;

      if (d.status === 'holding' && d.promoted) {
        setData(d);
        setSecondsLeft(d.expiresIn);
        onSeatAvailable?.();
        return;
      }
      setData(d);
    } catch (_) {}
  }, [eventId, onSeatAvailable, onExpired]);

  // ── mount: start polling  |  unmount: smart cleanup ───────────
  useEffect(() => {
    mountedRef.current = true;
    poll();
    pollRef.current = setInterval(poll, 8000);

    return () => {
      mountedRef.current = false;
      clearInterval(pollRef.current);
      clearInterval(timerRef.current);   // ← was missing before

      const current = dataRef.current;

      // If user was only QUEUED (no seat held), release their spot
      // immediately so the person behind them moves up right away.
      // If they were HOLDING, do nothing — the UPI modal is about to
      // open and they still need the 15-min window to pay.
      if (current?.status === 'queued') {
        apiFetch(`/api/events/${eventId}/release-queue`, { method: 'DELETE' })
          .catch(() => {});            // fire-and-forget, ignore errors
      }
    };
  }, [poll, eventId]);

  // ── expired via countdown ─────────────────────────────────────
  useEffect(() => {
    if (secondsLeft === 0 && data && data.status !== 'holding') {
      poll();
    }
  }, [secondsLeft]);

  // ── format timer ──────────────────────────────────────────────
  const mins    = Math.floor(secondsLeft / 60);
  const secs    = secondsLeft % 60;
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

  // ── HOLDING ───────────────────────────────────────────────────
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

  // ── QUEUED ────────────────────────────────────────────────────
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
