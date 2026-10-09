import React, { useRef } from 'react';
import { FONTS, TEMPLATES, fillTokens } from './certificateLib.js';
import './certificate_editor.css';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const renderText = (text, data) => {
  if (data) return fillTokens(text, data);
  // Editor mode: show {{fields}} highlighted so organisers can see where data goes.
  return String(text ?? '')
    .split(/(\{\{\w+\}\})/g)
    .map((p, i) => (/^\{\{\w+\}\}$/.test(p) ? <mark key={i}>{p}</mark> : p));
};

/**
 * Props
 *  template  'teal' | 'orange'
 *  layout    array of elements
 *  data      object of token values (omit in editor to show {{fields}})
 *  editable  enables drag / resize
 *  selectedId, onSelect(id|null), onPatch(id, patch)
 */
const CertificateCanvas = ({ template, layout, data = null, editable = false, selectedId = null, onSelect, onPatch }) => {
  const ref = useRef(null);
  const tpl = TEMPLATES[template] || TEMPLATES.teal;

  const startDrag = (ev, el) => {
    if (!editable) return;
    ev.preventDefault();
    ev.stopPropagation();
    onSelect?.(el.id);
    const rect = ref.current.getBoundingClientRect();
    const resize = ev.target.classList.contains('cc-rz');
    const sx = ev.clientX, sy = ev.clientY, o = { ...el };
    const move = (m) => {
      const dx = ((m.clientX - sx) / rect.width) * 100;
      const dy = ((m.clientY - sy) / rect.height) * 100;
      if (resize) onPatch?.(el.id, { w: Math.max(4, o.w + dx), h: Math.max(o.t === 'line' ? 0.8 : 3, o.h + dy) });
      else onPatch?.(el.id, { x: clamp(o.x + dx, -5, 95), y: clamp(o.y + dy, -5, 95) });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const body = (e) => {
    if (e.t === 'text') return <span>{renderText(e.text, data)}</span>;
    if (e.t === 'line') return <i className="cc-ln" style={{ background: e.color }} />;
    if (e.t === 'img') {
      if (e.src) return <img src={e.src} alt="" draggable={false} />;
      return data ? null : <span className="cc-ph">Logo</span>;
    }
    return (
      <div className="cc-sg">
        <div className="cc-sgi">
          {e.src ? <img src={e.src} alt="" draggable={false} /> : (data ? null : <span className="cc-ph">Upload signature</span>)}
        </div>
        <i className="cc-sl" />
        <div>{renderText(e.name, data)}</div>
        <small>{renderText(e.desig, data)}</small>
      </div>
    );
  };

  return (
    <div
      ref={ref}
      className={`cc-canvas${editable ? ' cc-live' : ''}`}
      style={{ backgroundImage: `url(${tpl.bg})` }}
      onPointerDown={() => editable && onSelect?.(null)}
    >
      {layout.map((e) => (
        <div
          key={e.id}
          className={`cc-el cc-${e.t}${editable && e.id === selectedId ? ' cc-sel' : ''}`}
          onPointerDown={(ev) => startDrag(ev, e)}
          style={{
            left: `${e.x}%`, top: `${e.y}%`, width: `${e.w}%`, height: `${e.h}%`,
            color: e.color || tpl.base,
            fontFamily: `'${(FONTS[e.font] || FONTS.Cormorant).css}', serif`,
            fontSize: `${e.size || 2}cqw`,
            textAlign: e.al || 'center',
          }}
        >
          {body(e)}
          {editable && <u className="cc-rz" />}
        </div>
      ))}
    </div>
  );
};

export default CertificateCanvas;
