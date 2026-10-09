import React, { useEffect, useRef, useState } from 'react';
import CertificateCanvas from './CertificateCanvas.jsx';
import {
  FONTS, TEMPLATES, FIELDS, SAMPLE_STUDENTS, defaultLayout, normalizeLayout, newId,
  buildCertData, fileToDataUrl, layoutSig, cloneLayout,
} from './certificateLib.js';
import { generateCertificatePdf } from './certificatePdf.js';
import './certificate_editor.css';

const MAX_LAYOUT_BYTES = 900 * 1024;
const NUM_KEYS = ['size', 'w', 'h'];

/**
 * Props
 *  template, layout   current values (layout may be null -> default)
 *  customText         event's "Certificate information" text ({{custom_text}})
 *  eventName          used in preview
 *  eventDate, points  optional, used in preview
 *  onSave({ template, layout })   called when the organiser clicks Save
 *  onClose()
 */
const CertificateEditor = ({ template = 'teal', layout, customText = '', eventName = '', eventDate, points = 5, volPoints = 5, volunteerMode = 'same', volunteerTemplate = null, volunteerLayout = null, onSave, onClose, backLabel = 'Back', saveLabel = 'Save' }) => {
  // 'p' = participants, 'v' = volunteers (only used when volunteers get a separate design)
  const [aud, setAud] = useState('p');
  const [volMode, setVolMode] = useState(['none', 'same', 'separate'].includes(volunteerMode) ? volunteerMode : 'same');
  const [volInit, setVolInit] = useState(!!volunteerLayout);
  const [tpls, setTpls] = useState({
    p: TEMPLATES[template] ? template : 'teal',
    v: TEMPLATES[volunteerTemplate] ? volunteerTemplate : (TEMPLATES[template] ? template : 'teal'),
  });
  const [sets, setSets] = useState(() => {
    const vt = TEMPLATES[volunteerTemplate] ? volunteerTemplate : template;
    return {
      p: { teal: normalizeLayout('teal', template === 'teal' ? layout : null), orange: normalizeLayout('orange', template === 'orange' ? layout : null) },
      v: { teal: normalizeLayout('teal', vt === 'teal' ? volunteerLayout : null), orange: normalizeLayout('orange', vt === 'orange' ? volunteerLayout : null) },
    };
  });
  const [previewRole, setPreviewRole] = useState('participant');
  const [info, setInfo] = useState(customText || '');
  const [sel, setSel] = useState(null);
  const [preview, setPreview] = useState(false);
  const [stu, setStu] = useState(0);
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);
  const stageRef = useRef(null);

  const curAud = volMode === 'separate' ? aud : 'p';
  const tpl = tpls[curAud];
  const els = sets[curAud][tpl];
  const cur = els.find((e) => e.id === sel) || null;
  const base = TEMPLATES[tpl].base;

  const say = (m) => { setToast(m); setTimeout(() => setToast(''), 2400); };
  const setEls = (fn) => setSets((S) => ({ ...S, [curAud]: { ...S[curAud], [tpl]: fn(S[curAud][tpl]) } }));
  const setTplFor = (k) => { setTpls((T) => ({ ...T, [curAud]: k })); setSel(null); };
  const patch = (id, p) => setEls((a) => a.map((e) => (e.id === id ? { ...e, ...p } : e)));

  // Delete key removes the selected element (unless typing in a field)
  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key === 'Delete' && sel && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
        setEls((a) => a.filter((e) => e.id !== sel)); setSel(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const add = (o) => { const e = { id: newId(), al: 'center', ...o }; setEls((a) => [...a, e]); setSel(e.id); };

  const addKind = (t) => {
    if (t === 'text') add({ t, x: 25, y: 46, w: 50, h: 6, text: 'Your text here', font: 'Cormorant', size: 2.4, color: base });
    if (t === 'img') add({ t, x: 10, y: 13, w: 12, h: 16, color: base, src: null });
    if (t === 'line') add({ t, x: 35, y: 62, w: 30, h: 1.5, color: base });
    if (t === 'sig') add({ t, x: 36, y: 70, w: 27, h: 14, name: 'Name', desig: 'Designation', font: 'Cormorant', size: 1.8, color: base, src: null });
  };

  const addField = (k) => {
    if (cur && cur.t === 'text') patch(cur.id, { text: `${cur.text} {{${k}}}`.trim() });
    else add({ t: 'text', x: 30, y: 46, w: 40, h: 6, text: `{{${k}}}`, font: 'Cormorant', size: 2.8, color: base });
  };

  const scale = (f) => {
    if (!cur) return;
    const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
    const w = Math.min(100, cur.w * f), h = cur.t === 'line' ? cur.h : cur.h * f;
    patch(cur.id, {
      w, h, x: cx - w / 2, y: cy - h / 2,
      ...(cur.size ? { size: Math.round(cur.size * f * 10) / 10 } : {}),
    });
  };

  const onInput = (k, v) => cur && patch(cur.id, { [k]: NUM_KEYS.includes(k) ? +v : v });

  const onFile = async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f || !cur) return;
    try { patch(cur.id, { src: await fileToDataUrl(f) }); } catch { say('Could not read that image'); }
  };

  const duplicate = () => cur && add({ ...cur, id: undefined, x: cur.x + 2, y: cur.y + 3 });
  const remove = () => { setEls((a) => a.filter((e) => e.id !== sel)); setSel(null); };
  const reset = () => { setEls(() => defaultLayout(tpl)); setSel(null); say('Reset to the default layout'); };

  const chooseVolMode = (m) => {
    setVolMode(m);
    if (m === 'separate') {
      if (!volInit) {                                  // first time: start from a copy of the participant design
        setSets((S) => ({ ...S, v: { ...S.v, [tpls.p]: cloneLayout(S.p[tpls.p]) } }));
        setTpls((T) => ({ ...T, v: T.p }));
        setVolInit(true);
      }
      setAud('v');
      setTimeout(() => stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } else { setAud('p'); if (m === 'none') setPreviewRole('participant'); }
    setSel(null);
  };

  const save = async () => {
    const pOut = sets.p[tpls.p].map((e) => ({ ...e }));
    const vOut = volMode === 'separate' ? sets.v[tpls.v].map((e) => ({ ...e })) : null;
    if (JSON.stringify(pOut).length > MAX_LAYOUT_BYTES || (vOut && JSON.stringify(vOut).length > MAX_LAYOUT_BYTES)) {
      say('Too many / too large images. Remove some and retry.'); return;
    }
    setSaving(true);
    try {
      await onSave?.({
        template: tpls.p, layout: pOut, customText: info,
        volunteerMode: volMode, volunteerTemplate: vOut ? tpls.v : null, volunteerLayout: vOut,
      });
    } finally { setSaving(false); }
  };

  const sample = SAMPLE_STUDENTS[stu];
  const pvVol = previewRole === 'volunteer' && volMode !== 'none';
  const pvSeparate = pvVol && volMode === 'separate';
  const pvTpl = pvSeparate ? tpls.v : tpls.p;
  const pvEls = pvSeparate ? sets.v[tpls.v] : sets.p[tpls.p];
  const previewData = buildCertData({ ...sample, event: eventName || 'Sample Event', date: eventDate || new Date(), points: pvVol ? volPoints : points, customText: info, role: pvVol ? 'volunteer' : 'participant' });

  const downloadSample = async () => {
    try {
      const bytes = await generateCertificatePdf({ template: pvTpl, layout: pvEls, data: previewData });
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a'); a.href = url; a.download = 'Sample_Certificate.pdf'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) { say(`PDF failed: ${err.message}`); }
  };

  const typeLabel = { text: 'Text', img: 'Image', sig: 'Signature', line: 'Line' };

  return (
    <div className="ce-root" role="dialog" aria-label="Certificate editor">
      <div className="ce-bar">
        <button className="ce-btn w" onClick={onClose}>← {backLabel}</button>
        <h2 className="ce-title">Certificate{eventName ? ` · ${eventName}` : ''}</h2>
        <span className="ce-sp" />
        <button className="ce-btn w" onClick={reset}>Reset to default</button>
        <button className="ce-btn w" onClick={() => setPreview(true)}>Preview</button>
        <button className="ce-btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : saveLabel}</button>
      </div>

      <div className="ce-work">
        <aside className="ce-pn">
          <h3>1 · Volunteers</h3>
          <div className="ce-volopts" style={{ marginBottom: 10 }}>
            {[['none', 'No certificate for volunteers'], ['same', 'Same design as participants'], ['separate', 'Separate design']].map(([k, label]) => (
              <button type="button" key={k} className={`ce-opt${volMode === k ? ' on' : ''}`} aria-pressed={volMode === k} onClick={() => chooseVolMode(k)}>
                <span className="ce-opt-dot" />{label}
              </button>
            ))}
          </div>
          {volMode === 'same' && <p className="ce-muted" style={{ marginBottom: 16 }}>Volunteers get this same design. The wording changes to “volunteered for”.</p>}
          {volMode === 'separate' && <p className="ce-muted" style={{ marginBottom: 16 }}>Use the switch above the certificate to design each one.</p>}
          {volMode === 'none' && <div style={{ marginBottom: 16 }} />}

          <h3>2 · Template</h3>
          <div className="ce-tpls">
            {Object.keys(TEMPLATES).map((k) => (
              <button key={k} className={`ce-tc${k === tpl ? ' on' : ''}`} onClick={() => setTplFor(k)} title={TEMPLATES[k].label}>
                <CertificateCanvas template={k} layout={sets[curAud][k]} data={buildCertData({ ...SAMPLE_STUDENTS[0], event: eventName, date: eventDate, points, customText: info, role: curAud === 'v' ? 'volunteer' : 'participant' })} />
              </button>
            ))}
          </div>
          <h3>3 · Certificate text</h3>
          <label style={{ marginBottom: 14 }}>
            <textarea rows={3} value={info} onChange={(e) => setInfo(e.target.value)} placeholder="Text to be displayed on the certificate…" />
            <span className="ce-muted">Place it with the “Custom text” field.</span>
          </label>
          <h3>4 · Design</h3>
          <div className="ce-adds">
            <button className="ce-btn w sm" onClick={() => addKind('text')}>Text</button>
            <button className="ce-btn w sm" onClick={() => addKind('sig')}>Signature</button>
            <button className="ce-btn w sm" onClick={() => addKind('img')}>Image</button>
            <button className="ce-btn w sm" onClick={() => addKind('line')}>Line</button>
          </div>
          <h3 style={{ fontSize: 12 }}>Student fields</h3>
          <div className="ce-chips">
            {Object.entries(FIELDS).map(([k, v]) => <button key={k} className="ce-chip" onClick={() => addField(k)}>{v}</button>)}
          </div>
          <p className="ce-muted">Fields fill in automatically for each student. Fonts are limited to four and colours to a small set per template.</p>
        </aside>

        <main className="ce-stage" ref={stageRef}>
          {volMode === 'separate' && (
            <div className="ce-row" style={{ marginBottom: 10 }}>
              {[['p', 'Participants'], ['v', 'Volunteers']].map(([k, label]) => (
                <button key={k} className={`ce-btn sm${curAud === k ? '' : ' w'}`} onClick={() => { setAud(k); setSel(null); }}>{label}</button>
              ))}
              <span className="ce-muted">You are designing the {curAud === 'v' ? 'volunteer' : 'participant'} certificate.</span>
            </div>
          )}
          <CertificateCanvas template={tpl} layout={els} editable selectedId={sel} onSelect={setSel} onPatch={patch} />
        </main>

        <aside className="ce-pn">
          {!cur ? (
            <>
              <h3>Properties</h3>
              <p className="ce-muted">Click anything on the certificate to edit it, or add something from the left. Drag to move and use the blue corner to resize.</p>
            </>
          ) : (
            <>
              <h3>{typeLabel[cur.t]}</h3>
              {cur.t === 'text' && (
                <label>Text<textarea rows={5} value={cur.text} onChange={(e) => onInput('text', e.target.value)} /></label>
              )}
              {cur.t === 'sig' && (
                <>
                  <label>Name<input value={cur.name} onChange={(e) => onInput('name', e.target.value)} /></label>
                  <label>Designation<input value={cur.desig} onChange={(e) => onInput('desig', e.target.value)} /></label>
                </>
              )}
              {(cur.t === 'img' || cur.t === 'sig') && (
                <>
                  <button className="ce-btn w sm" style={{ marginBottom: 12 }} onClick={() => fileRef.current.click()}>
                    {cur.src ? 'Replace' : 'Upload'} {cur.t === 'img' ? 'image' : 'signature'}
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
                </>
              )}
              {(cur.t === 'text' || cur.t === 'sig') && (
                <>
                  <label>Font
                    <select value={cur.font} onChange={(e) => onInput('font', e.target.value)}>
                      {Object.entries(FONTS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
                    </select>
                  </label>
                  <label>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Text size</span>
                      <span className="ce-muted">{cur.size}</span>
                    </div>
                    <input type="range" min="1" max="10" step=".1" value={cur.size} onChange={(e) => onInput('size', e.target.value)} />
                  </label>
                </>
              )}
              {cur.t === 'text' && (
                <div className="ce-row" style={{ marginBottom: 12 }}>
                  {['left', 'center', 'right'].map((a) => (
                    <button key={a} className={`ce-al${cur.al === a ? ' on' : ''}`} onClick={() => onInput('al', a)}>{a[0].toUpperCase()}</button>
                  ))}
                </div>
              )}

              <div style={{ fontWeight: 500, marginBottom: 6 }}>Box size</div>
              <div className="ce-row" style={{ marginBottom: 8 }}>
                <button className="ce-btn w sm" onClick={() => scale(0.9)} aria-label="Smaller">−</button>
                <button className="ce-btn w sm" onClick={() => scale(1.1)} aria-label="Bigger">+</button>
                <span className="ce-muted">scales box and text</span>
              </div>
              <label>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Width</span>
                  <span className="ce-muted">{cur.w}</span>
                </div>
                <input type="range" min="4" max="100" step=".5" value={cur.w} onChange={(e) => onInput('w', e.target.value)} />
              </label>
              {cur.t !== 'line' && (
                <label>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Height</span>
                    <span className="ce-muted">{cur.h}</span>
                  </div>
                  <input type="range" min="3" max="60" step=".5" value={cur.h} onChange={(e) => onInput('h', e.target.value)} />
                </label>
              )}

              {cur.t !== 'img' && (
                <>
                  <div style={{ fontWeight: 500, marginBottom: 6 }}>Colour</div>
                  <div className="ce-row" style={{ marginBottom: 14 }}>
                    {TEMPLATES[tpl].colors.map((c) => (
                      <button key={c} className={`ce-sw${cur.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => onInput('color', c)} aria-label={`Colour ${c}`} />
                    ))}
                  </div>
                </>
              )}
              <div className="ce-row">
                <button className="ce-btn w sm" onClick={() => patch(cur.id, { x: (100 - cur.w) / 2 })}>Centre</button>
                <button className="ce-btn w sm" onClick={duplicate}>Duplicate</button>
                <button className="ce-btn r sm" onClick={remove}>Delete</button>
              </div>
            </>
          )}
        </aside>
      </div>

      {preview && (
        <div className="ce-ov">
          <div className="ce-pn ce-big">
            <div className="ce-row">
              <b className="ce-title">Preview</b>
              {volMode !== 'none' && (
                <select value={previewRole} onChange={(e) => setPreviewRole(e.target.value)} style={{ width: 'auto', margin: 0, padding: 6, border: '3px solid #0a0a0a' }}>
                  <option value="participant">As participant</option>
                  <option value="volunteer">As volunteer</option>
                </select>
              )}
              <select value={stu} onChange={(e) => setStu(+e.target.value)} style={{ width: 'auto', margin: 0, padding: 6, border: '3px solid #0a0a0a' }}>
                {SAMPLE_STUDENTS.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
              </select>
              <span className="ce-sp" />
              <button className="ce-btn w" onClick={downloadSample}>Download sample PDF</button>
              <button className="ce-btn r" onClick={() => setPreview(false)}>Close</button>
            </div>
            <CertificateCanvas template={pvTpl} layout={pvEls} data={previewData} />
          </div>
        </div>
      )}
      {toast && <div className="ce-toast">{toast}</div>}
    </div>
  );
};

export { layoutSig };
export default CertificateEditor;
