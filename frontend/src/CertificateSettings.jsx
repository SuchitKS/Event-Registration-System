import React, { useEffect, useState } from 'react';
import { apiFetch } from './api.js';
import CertificateEditor from './CertificateEditor.jsx';
import CertificateCanvas from './CertificateCanvas.jsx';
import { normalizeLayout, buildCertData, SAMPLE_STUDENTS } from './certificateLib.js';
import './certificate_editor.css';

const putJson = (eventId, body) =>
  apiFetch(`/api/events/${eventId}/certificate-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/** Organiser modal: turn certificates on, design them, and release them to students. */
const CertificateSettings = ({ event, onClose, onChanged }) => {
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [designing, setDesigning] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`/api/events/${event.eid}/certificate-settings`);
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
        setS(await res.json());
      } catch (e) { setErr(e.message); }
    })();
  }, [event.eid]);

  const flash = (m) => { setNote(m); setTimeout(() => setNote(''), 2500); };

  // `next` lets a button save a new value immediately (state updates are async)
  const saveSettings = async (next = s) => {
    setBusy(true); setErr('');
    try {
      const res = await putJson(event.eid, { enabled: next.enabled, released: next.released, releaseMode: next.releaseMode });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
      flash('Saved'); onChanged?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const toggleRelease = async () => {
    const next = { ...s, released: !s.released };
    setS(next);
    await saveSettings(next);
  };

  const saveDesign = async ({ template, layout, customText, volunteerMode, volunteerTemplate, volunteerLayout }) => {
    const res = await putJson(event.eid, { enabled: true, template, layout, certificateInfo: customText, volunteerMode, volunteerTemplate, volunteerLayout });
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error || 'Could not save the design'); return; }
    setS((p) => ({ ...p, enabled: true, template, layout, certificateInfo: customText, volunteerMode, volunteerTemplate, volunteerLayout }));
    setDesigning(false); flash('Design saved'); onChanged?.();
  };

  if (designing && s) {
    return (
      <CertificateEditor
        template={s.template}
        layout={s.layout}
        customText={s.certificateInfo}
        eventName={event.ename}
        eventDate={event.eventDate}
        points={s.points}
        volPoints={s.volPoints}
        volunteerMode={s.volunteerMode}
        volunteerTemplate={s.volunteerTemplate}
        volunteerLayout={s.volunteerLayout}
        backLabel="Back"
        saveLabel="Save & return"
        onSave={saveDesign}
        onClose={() => setDesigning(false)}
      />
    );
  }

  return (
    <div className="ce-root" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(10,10,10,.6)' }}>
      <div className="ce-pn" style={{ width: 'min(560px,100%)', maxHeight: '100%', overflow: 'auto', position: 'relative', top: 0 }}>
        <div className="ce-row" style={{ marginBottom: 12 }}>
          <h3 className="ce-title" style={{ margin: 0 }}>Certificates · {event.ename}</h3>
          <span className="ce-sp" />
          <button className="ce-btn r sm" onClick={onClose}>Close</button>
        </div>

        {err && <p style={{ color: '#b00020', fontWeight: 700, marginBottom: 8 }}>{err}</p>}
        {!s && !err && <p className="ce-muted">Loading…</p>}

        {s && (
          <>
            {/* Buttons instead of checkboxes: a global site style was hiding native checkboxes */}
            <button
              type="button"
              className={`ce-opt${s.enabled ? ' on' : ''}`}
              aria-pressed={s.enabled}
              onClick={() => setS({ ...s, enabled: !s.enabled })}
            >
              <span className="ce-opt-dot" />Provide a certificate for this event
            </button>

            {s.enabled && (
              <>
                <div style={{ maxWidth: 320, margin: '12px 0', border: '3px solid #0a0a0a' }}>
                  <CertificateCanvas
                    template={s.template}
                    layout={normalizeLayout(s.template, s.layout)}
                    data={buildCertData({ ...SAMPLE_STUDENTS[0], event: event.ename, date: event.eventDate, points: s.points, customText: s.certificateInfo })}
                  />
                </div>
                <button className="ce-btn b" onClick={() => setDesigning(true)}>Design certificate</button>

                <h3 style={{ margin: '18px 0 8px' }}>Release control</h3>
                <p className="ce-muted" style={{ marginBottom: 10 }}>Students can't download until you release. Do it after the event.</p>

                <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
                  {[['present', `Marked present only (${s.counts.present} participants)`], ['all', `All registered (${s.counts.registered})`]].map(([k, label]) => (
                    <button type="button" key={k} className={`ce-opt${s.releaseMode === k ? ' on' : ''}`} aria-pressed={s.releaseMode === k} onClick={() => setS({ ...s, releaseMode: k })}>
                      <span className="ce-opt-dot" />{label}
                    </button>
                  ))}
                </div>

                <div className="ce-row">
                  <button
                    type="button"
                    className={`ce-btn ${s.released ? 'r' : 'b'}`}
                    onClick={toggleRelease}
                    disabled={busy}
                  >
                    {s.released ? 'Withdraw certificates' : 'Release certificates now'}
                  </button>
                  <span className={`ce-pill${s.released ? ' ok' : ''}`}>{s.released ? 'Released' : 'Not released'}</span>
                </div>
                <p className="ce-muted" style={{ marginTop: 6 }}>Applies to participants and volunteers. Saves instantly.</p>
              </>
            )}

            <div className="ce-row" style={{ marginTop: 18 }}>
              <button className="ce-btn" onClick={() => saveSettings()} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
              {note && <span className="ce-pill ok">{note}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CertificateSettings;
