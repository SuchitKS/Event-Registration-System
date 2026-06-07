"use client"
import { useEffect, useMemo, useState, useRef, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import QRCode from "qrcode"
import "./registerevent.css"
import TicketAnimation from './TicketAnimation';
import QueueStatus from './QueueStatus';
import { apiFetch } from "./api.js";

// ============================================================================
// CONSTANTS
// ============================================================================

const FALLBACK_BANNER = "https://ik.imagekit.io/flopass/Aura.png";

const SLIDER_CONSTANTS = {
  AXIS_LOCK_THRESHOLD: 10,
  AXIS_DOMINANCE_RATIO: 1.8,
  SWIPE_THRESHOLD_PERCENT: 0.08,
  VELOCITY_THRESHOLD: 0.3,
  WHEEL_DEBOUNCE_MS: 80,
  WHEEL_MIN_DELTA: 8,
};

const DEFAULT_COLORS = ["#1a1a2e", "#16213e", "#0f3460"];
const MAX_VISIBLE_DOTS = 7;

// ============================================================================
// HELPERS
// ============================================================================

function formatTime12h(timeString) {
  if (!timeString) return "Time TBA"
  const [hours, minutes] = String(timeString).split(":")
  const hour24 = Number.parseInt(hours, 10)
  if (Number.isNaN(hour24)) return "Time TBA"
  const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24
  const ampm = hour24 >= 12 ? "PM" : "AM"
  return `${hour12}:${minutes} ${ampm}`
}

function resolveBanner(event) {
  return event?.bannerUrl || FALLBACK_BANNER;
}

// ============================================================================
// COLOR EXTRACTION
// ============================================================================

function toCloudinaryThumb(url) {
  if (!url || !url.includes('res.cloudinary.com')) return url;
  return url.replace('/upload/', '/upload/w_50,h_50,c_fill,q_10,f_jpg/');
}

async function extractColors(imageUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(DEFAULT_COLORS); return; }
      const sampleSize = 50;
      canvas.width = sampleSize; canvas.height = sampleSize;
      ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
      try {
        const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
        const pixels = imageData.data;
        const colorMap = new Map();
        for (let i = 0; i < pixels.length; i += 4) {
          const r = Math.min(255, Math.round(pixels[i] / 32) * 32);
          const g = Math.min(255, Math.round(pixels[i + 1] / 32) * 32);
          const b = Math.min(255, Math.round(pixels[i + 2] / 32) * 32);
          const brightness = (r + g + b) / 3;
          if (brightness < 20 || brightness > 240) continue;
          const key = `${r},${g},${b}`;
          const existing = colorMap.get(key);
          if (existing) { existing.count++; } else { colorMap.set(key, { count: 1, r, g, b }); }
        }
        const sortedColors = Array.from(colorMap.values()).sort((a, b) => b.count - a.count).slice(0, 10);
        const distinctColors = [];
        for (const color of sortedColors) {
          const hex = rgbToHex(color.r, color.g, color.b);
          const isDistinct = distinctColors.every((existing) => {
            const existingRgb = hexToRgb(existing);
            if (!existingRgb) return true;
            return Math.sqrt(Math.pow(color.r - existingRgb.r, 2) + Math.pow(color.g - existingRgb.g, 2) + Math.pow(color.b - existingRgb.b, 2)) > 40;
          });
          if (isDistinct && distinctColors.length < 3) { distinctColors.push(hex); }
        }
        if (distinctColors.length === 0 && sortedColors.length > 0) {
          const topColor = sortedColors[0];
          distinctColors.push(rgbToHex(Math.max(0, topColor.r - 60), Math.max(0, topColor.g - 60), Math.max(0, topColor.b - 60)));
        }
        while (distinctColors.length < 3) {
          const baseColor = hexToRgb(distinctColors[0] || "#1a1a2e");
          if (baseColor) {
            const shift = distinctColors.length === 1 ? -40 : 40;
            distinctColors.push(rgbToHex(Math.min(255, Math.max(0, baseColor.r + shift)), Math.min(255, Math.max(0, baseColor.g + shift)), Math.min(255, Math.max(0, baseColor.b + shift))));
          } else { distinctColors.push("#1a1a2e"); }
        }
        resolve(distinctColors);
      } catch (e) { resolve(DEFAULT_COLORS); }
    };
    img.onerror = () => { resolve(DEFAULT_COLORS); };
    img.src = toCloudinaryThumb(imageUrl) || imageUrl;
  });
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(x => { const hex = x.toString(16); return hex.length === 1 ? "0" + hex : hex; }).join("");
}
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
}

// ============================================================================
// HOOKS
// ============================================================================

function useSliderNavigation({ totalSlides, enableKeyboard = true }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const goToNext = useCallback(() => { setCurrentIndex(prev => Math.min(prev + 1, totalSlides - 1)); }, [totalSlides]);
  const goToPrev = useCallback(() => { setCurrentIndex(prev => Math.max(prev - 1, 0)); }, []);
  const goToSlide = useCallback((index) => { setCurrentIndex(Math.max(0, Math.min(index, totalSlides - 1))); }, [totalSlides]);
  useEffect(() => {
    if (!enableKeyboard || totalSlides === 0) return;
    const handleKeyDown = (e) => {
      switch (e.key) {
        case "ArrowRight": case "d": case "D": goToNext(); break;
        case "ArrowLeft":  case "a": case "A": goToPrev(); break;
        case "Home": setCurrentIndex(0); break;
        case "End":  setCurrentIndex(totalSlides - 1); break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enableKeyboard, goToNext, goToPrev, totalSlides]);
  return { currentIndex, setCurrentIndex, goToNext, goToPrev, goToSlide };
}

function useSliderDrag({ trackRef, snapPointsRef, currentIndexRef, onSwipeLeft, onSwipeRight }) {
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef    = useRef(false);
  const startXRef        = useRef(0);
  const startYRef        = useRef(0);
  const dragXRef         = useRef(0);
  const velocityRef      = useRef(0);
  const lastXRef         = useRef(0);
  const lastTimeRef      = useRef(0);
  const directionLockedRef = useRef(null);
  const rafRef           = useRef(null);
  const sliderNodeRef    = useRef(null);
  const onSwipeLeftRef   = useRef(onSwipeLeft);
  const onSwipeRightRef  = useRef(onSwipeRight);
  useEffect(() => { onSwipeLeftRef.current  = onSwipeLeft;  }, [onSwipeLeft]);
  useEffect(() => { onSwipeRightRef.current = onSwipeRight; }, [onSwipeRight]);

  const applyTransform = useCallback((dragOffset, animated) => {
    const el = trackRef.current;
    if (!el) return;
    const snapPoints = snapPointsRef.current;
    const idx = currentIndexRef.current;
    const base = (snapPoints && snapPoints[idx]) ?? 0;
    el.style.transition = animated ? 'transform 0.45s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none';
    el.style.transform  = `translateX(${base + dragOffset}px) translateZ(0)`;
  }, [trackRef, snapPointsRef, currentIndexRef]);

  const applyTransformRef = useRef(applyTransform);
  useEffect(() => { applyTransformRef.current = applyTransform; }, [applyTransform]);

  const setTouchAction = useCallback((value) => {
    if (sliderNodeRef.current) sliderNodeRef.current.style.touchAction = value;
  }, []);

  const handleStart = useCallback((clientX, clientY) => {
    startXRef.current = clientX; startYRef.current = clientY;
    dragXRef.current = 0; lastXRef.current = clientX;
    lastTimeRef.current = Date.now(); velocityRef.current = 0;
    directionLockedRef.current = null; isDraggingRef.current = true;
    setIsDragging(true); setTouchAction('pan-y');
    applyTransformRef.current(0, false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, [setTouchAction]);

  const handleMove = useCallback((clientX, clientY, event) => {
    if (!isDraggingRef.current) return;
    const dx = Math.abs(clientX - startXRef.current);
    const dy = Math.abs(clientY - startYRef.current);
    if (directionLockedRef.current === null) {
      if (dx < SLIDER_CONSTANTS.AXIS_LOCK_THRESHOLD && dy < SLIDER_CONSTANTS.AXIS_LOCK_THRESHOLD) return;
      directionLockedRef.current = dx > dy ? 'x' : 'y';
      if (directionLockedRef.current === 'x') {
        setTouchAction('none');
        if (event) { try { event.preventDefault(); } catch (e) {} }
      } else {
        setTouchAction('pan-y'); isDraggingRef.current = false;
        setIsDragging(false); applyTransformRef.current(0, true); return;
      }
    }
    if (directionLockedRef.current === 'y') return;
    if (event) { try { event.preventDefault(); } catch (e) {} }
    const now = Date.now(); const dt = now - lastTimeRef.current;
    const rawDelta = clientX - startXRef.current; const maxPull = 150;
    const sign = rawDelta > 0 ? 1 : -1; const abs = Math.abs(rawDelta);
    const resisted = abs > maxPull ? maxPull + (abs - maxPull) * 0.15 : abs;
    const resistedDragX = sign * resisted;
    if (dt > 0) velocityRef.current = (clientX - lastXRef.current) / dt;
    lastXRef.current = clientX; lastTimeRef.current = now; dragXRef.current = resistedDragX;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => { applyTransformRef.current(dragXRef.current, false); });
  }, [setTouchAction]);

  const handleEnd = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false; setIsDragging(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setTouchAction('pan-y');
    const dragX = dragXRef.current; const velocity = velocityRef.current;
    const threshold = window.innerWidth * SLIDER_CONSTANTS.SWIPE_THRESHOLD_PERCENT;
    dragXRef.current = 0;
    const swipedLeft  = dragX < -threshold || velocity < -SLIDER_CONSTANTS.VELOCITY_THRESHOLD;
    const swipedRight = dragX >  threshold || velocity >  SLIDER_CONSTANTS.VELOCITY_THRESHOLD;
    if      (swipedLeft)  onSwipeLeftRef.current();
    else if (swipedRight) onSwipeRightRef.current();
    else                  applyTransformRef.current(0, true);
  }, [setTouchAction]);

  const handleMouseDown  = useCallback((e) => { handleStart(e.clientX, e.clientY); }, [handleStart]);
  const handleMouseMove  = useCallback((e) => { handleMove(e.clientX, e.clientY, null); }, [handleMove]);
  const handleMouseUp    = useCallback(() => handleEnd(), [handleEnd]);
  const handleMouseLeave = useCallback(() => handleEnd(), [handleEnd]);

  const sliderCallbackRef = useCallback((node) => {
    if (sliderNodeRef.current) {
      const old = sliderNodeRef.current;
      old.removeEventListener('touchstart',  old._onTouchStart);
      old.removeEventListener('touchmove',   old._onTouchMove);
      old.removeEventListener('touchend',    old._onTouchEnd);
      old.removeEventListener('touchcancel', old._onTouchEnd);
    }
    sliderNodeRef.current = node;
    if (!node) return;
    node.style.touchAction = 'pan-y';
    const onTouchStart = (e) => { if (e.touches.length > 1) return; handleStart(e.touches[0].clientX, e.touches[0].clientY); };
    const onTouchMove  = (e) => { if (e.touches.length > 1) return; handleMove(e.touches[0].clientX, e.touches[0].clientY, e); };
    const onTouchEnd   = () => handleEnd();
    node._onTouchStart = onTouchStart; node._onTouchMove = onTouchMove; node._onTouchEnd = onTouchEnd;
    node.addEventListener('touchstart',  onTouchStart, { passive: false });
    node.addEventListener('touchmove',   onTouchMove,  { passive: false });
    node.addEventListener('touchend',    onTouchEnd,   { passive: true  });
    node.addEventListener('touchcancel', onTouchEnd,   { passive: true  });
  }, [handleStart, handleMove, handleEnd]);

  return { isDragging, sliderCallbackRef, handleMouseDown, handleMouseMove, handleMouseUp, handleMouseLeave };
}

function useSliderWheel({ sliderRef, onScrollLeft, onScrollRight, enabled }) {
  const cooldownRef      = useRef(false);
  const cooldownTimerRef = useRef(null);
  useEffect(() => {
    if (!enabled) return;
    const slider = sliderRef.current;
    if (!slider) return;
    const handleWheel = (e) => {
      e.preventDefault();
      const absDx = Math.abs(e.deltaX); const absDy = Math.abs(e.deltaY);
      if (absDx < SLIDER_CONSTANTS.WHEEL_MIN_DELTA && absDy < SLIDER_CONSTANTS.WHEEL_MIN_DELTA) return;
      const isHorizontallyDominant = absDx > absDy * SLIDER_CONSTANTS.AXIS_DOMINANCE_RATIO;
      const isPureHorizontal       = absDx > SLIDER_CONSTANTS.WHEEL_MIN_DELTA && absDy < 3;
      if (!isHorizontallyDominant && !isPureHorizontal) return;
      if (cooldownRef.current) return;
      cooldownRef.current = true;
      if (e.deltaX > 0) onScrollLeft(); else onScrollRight();
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = setTimeout(() => { cooldownRef.current = false; }, SLIDER_CONSTANTS.WHEEL_DEBOUNCE_MS);
    };
    slider.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      slider.removeEventListener("wheel", handleWheel);
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    };
  }, [sliderRef, onScrollLeft, onScrollRight, enabled]);
}

function useColorExtraction(events) {
  const [colors, setColors] = useState({});
  useEffect(() => {
    events.forEach(event => {
      extractColors(resolveBanner(event)).then(extracted => {
        setColors(prev => ({ ...prev, [event.eid]: extracted }));
      });
    });
  }, [events]);
  return colors;
}

function useSnapPoints(trackRef, cardCount) {
  const [snapPoints, setSnapPoints] = useState([]);
  useEffect(() => {
    function measure() {
      const track = trackRef.current;
      if (!track) return;
      const cards = Array.from(track.querySelectorAll('.re-gallery-card'));
      if (cards.length === 0) return;
      const prevTransition = track.style.transition;
      const prevTransform  = track.style.transform;
      track.style.transition = 'none'; track.style.transform = 'none';
      track.getBoundingClientRect();
      const vcx = window.innerWidth / 2;
      const points = cards.map(card => { const rect = card.getBoundingClientRect(); return vcx - (rect.left + rect.width / 2); });
      setSnapPoints(points);
      track.style.transition = prevTransition; track.style.transform = prevTransform;
    }
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', measure); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackRef, cardCount]);
  return snapPoints;
}

// ============================================================================
// GALLERY COMPONENTS
// ============================================================================

function NavigationDots({ total, current, onSelect }) {
  if (total <= 1) return null;
  const showAll = total <= MAX_VISIBLE_DOTS;
  let visibleDots = [];
  if (showAll) {
    visibleDots = Array.from({ length: total }, (_, i) => i);
  } else {
    const half = Math.floor(MAX_VISIBLE_DOTS / 2);
    let start = Math.max(0, current - half);
    let end = start + MAX_VISIBLE_DOTS - 1;
    if (end >= total) { end = total - 1; start = Math.max(0, end - MAX_VISIBLE_DOTS + 1); }
    visibleDots = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }
  return (
    <div className="re-gallery-dots">
      {!showAll && visibleDots[0] > 0 && <button className="re-gallery-dot re-gallery-dot-ellipsis" onClick={() => onSelect(0)} />}
      {visibleDots.map(i => (
        <button key={i} onClick={() => onSelect(i)} className={`re-gallery-dot ${i === current ? 'active' : ''}`}
          style={{ backgroundColor: i === current ? 'var(--nb-black)' : 'rgba(10,10,10,0.2)', width: i === current ? '28px' : '8px' }}
          aria-label={`Go to event ${i + 1}`} />
      ))}
      {!showAll && visibleDots[visibleDots.length - 1] < total - 1 && <button className="re-gallery-dot re-gallery-dot-ellipsis" onClick={() => onSelect(total - 1)} />}
    </div>
  );
}

function JumpCounter({ current, total, onJump }) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const inputRef = useRef(null);
  const handleCommit = () => {
    const num = parseInt(inputVal, 10);
    if (!isNaN(num) && num >= 1 && num <= total) onJump(num - 1);
    setEditing(false); setInputVal("");
  };
  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleCommit();
    if (e.key === "Escape") { setEditing(false); setInputVal(""); }
    e.stopPropagation();
  };
  return (
    <div className={`re-gallery-counter ${editing ? 'editing' : ''}`}
      onClick={!editing ? () => { setEditing(true); setInputVal(""); setTimeout(() => inputRef.current?.select(), 0); } : undefined}
      title={editing ? "" : "Click to jump"}>
      {editing
        ? <><input ref={inputRef} className="re-counter-input" type="number" min={1} max={total} value={inputVal} onChange={e => setInputVal(e.target.value)} onBlur={handleCommit} onKeyDown={handleKeyDown} placeholder={String(current + 1)} autoFocus /><span className="divider">/</span><span>{String(total).padStart(2,"0")}</span></>
        : <><span>{String(current + 1).padStart(2,"0")}</span><span className="divider">/</span><span>{String(total).padStart(2,"0")}</span></>
      }
    </div>
  );
}

function SearchBar({ events, onSelect, currentIndex }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);
  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return events.map((e, i) => ({ event: e, index: i }))
      .filter(({ event }) => event.ename?.toLowerCase().includes(q) || event.eventLoc?.toLowerCase().includes(q) || event.organizerName?.toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, events]);
  const handleSelect = (index) => { onSelect(index); setQuery(""); setFocused(false); inputRef.current?.blur(); };
  return (
    <div className={`re-search-wrap ${focused ? 'expanded' : ''}`}>
      <button className="re-search-icon-btn" onClick={() => { setFocused(true); setTimeout(() => inputRef.current?.focus(), 50); }} tabIndex={focused ? -1 : 0} aria-label="Search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
      </button>
      <input ref={inputRef} className="re-search-inline-input" placeholder="Search…" value={query}
        onChange={e => setQuery(e.target.value)} onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => { setFocused(false); setQuery(""); }, 160)}
        onKeyDown={e => { if (e.key === "Escape") { setQuery(""); setFocused(false); } e.stopPropagation(); }}
        autoComplete="off" tabIndex={focused ? 0 : -1} />
      {query && focused && <button className="re-search-clear-inline" onMouseDown={e => { e.preventDefault(); setQuery(""); }}>×</button>}
      {focused && results.length > 0 && (
        <div className="re-search-dropdown">
          {results.map(({ event, index }) => (
            <button key={event.eid} className={`re-search-result ${index === currentIndex ? 'current' : ''}`} onMouseDown={e => { e.preventDefault(); handleSelect(index); }}>
              <div className="re-search-result-img"><img src={resolveBanner(event)} alt={event.ename} /></div>
              <div className="re-search-result-info"><span className="re-search-result-name">{event.ename}</span><span className="re-search-result-meta">{event.eventLoc} · <span className={`re-search-badge ${event.status}`}>{event.status}</span></span></div>
              <span className="re-search-result-num">#{index + 1}</span>
            </button>
          ))}
        </div>
      )}
      {focused && query && results.length === 0 && <div className="re-search-dropdown"><div className="re-search-no-result">No matches for "{query}"</div></div>}
    </div>
  );
}

function BentoGridCard({ event, onOpen, renderControls }) {
  return (
    <div className="re-bento-card" onClick={() => onOpen(event)}>
      <div className="re-bento-img"><img src={resolveBanner(event)} alt={event.ename} loading="lazy" /></div>
      <div className="re-bento-scrim" />
      <div className="re-bento-top">
        <span className={`re-bento-status ${event.status}`}>{event.status}</span>
        {event.is_team && <span className="re-bento-team-badge">Team</span>}
        {event.regFee > 0 ? <span className="re-bento-fee">₹{event.regFee}</span> : <span className="re-bento-free">Free</span>}
      </div>
      <div className="re-bento-bottom">
        <p className="re-bento-date">{new Date(event.eventDate).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}{' · '}{formatTime12h(event.eventTime)}</p>
        <h3 className="re-bento-name">{event.ename}</h3>
        <p className="re-bento-loc">📍 {event.eventLoc}</p>
        <div className="re-bento-actions" onClick={e => e.stopPropagation()}>
          {renderControls(event, false)}
          <button className="re-bento-detail-btn" onClick={e => { e.stopPropagation(); onOpen(event); }}>Details ↗</button>
        </div>
      </div>
    </div>
  );
}
function BentoGrid({ events, onOpen, renderControls }) {
  return <div className="re-bento-grid-container"><div className="re-bento-grid">{events.map(e => <BentoGridCard key={e.eid} event={e} onOpen={onOpen} renderControls={renderControls} />)}</div></div>;
}

function EventGalleryCard({ event, isActive, index, currentIndex, onOpen, renderControls }) {
  const scale   = isActive ? 1 : 0.84;
  const opacity = isActive ? 1 : Math.max(0.3, 1 - Math.abs(index - currentIndex) * 0.25);
  return (
    <div className={`re-gallery-card ${isActive ? 'active' : ''}`} style={{ transform:`scale(${scale}) translateZ(0)`, opacity, WebkitTransform:`scale(${scale}) translateZ(0)` }}>
      <div className="re-gallery-card-frame">
        <div className="re-gallery-image-container">
          <img src={resolveBanner(event)} alt={event.ename} draggable={false} loading="lazy" />
          <div className={`re-gallery-status-badge ${event.status}`}>{event.status}</div>
          {event.is_team && <div className="re-gallery-team-badge">Team</div>}
          <div className="re-gallery-gradient" style={{ opacity:isActive?1:0.4, height:isActive?'75%':'40%' }} />
          {isActive && (
            <div className="re-gallery-info">
              <p className="re-gallery-year">{new Date(event.eventDate).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}{' · '}{formatTime12h(event.eventTime)}</p>
              <h2 className="re-gallery-title">{event.ename}</h2>
              <p className="re-gallery-artist">📍 {event.eventLoc}{event.regFee>0?<span className="re-gallery-fee"> · ₹{event.regFee}</span>:<span className="re-gallery-free"> · Free</span>}</p>
              <div className="re-gallery-card-actions">
                {renderControls(event, false)}
                <button className="re-gallery-details-btn" onClick={e=>{e.stopPropagation();onOpen(event);}}>Details ↗</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {!isActive && <div className="re-gallery-click-hint" onClick={() => onOpen(event)}><span>{event.ename}</span></div>}
      <div className="re-gallery-reflection" style={{ opacity:isActive?0.12:0.04 }} />
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function Registerevent() {
  const navigate = useNavigate()
  const [eventsData, setEventsData]             = useState({ upcoming:[], ongoing:[], completed:[] })
  const [loading, setLoading]                   = useState(true)
  const [filter, setFilter]                     = useState("all")
  const [viewMode, setViewMode]                 = useState("gallery")
  const [teamStates, setTeamStates]             = useState({})
  const [registeredEvents, setRegisteredEvents] = useState(new Set())
  const [flash, setFlash]                       = useState({ type:"", message:"" })
  const [modalFlash, setModalFlash]             = useState({ type:"", message:"" })
  const [selectedEvent, setSelectedEvent]       = useState(null)
  const [ticketInfo, setTicketInfo]             = useState(null)
  const [showTeamModal, setShowTeamModal]       = useState(null)
  const [teamFormData, setTeamFormData]         = useState({ teamName:'', memberUSNs:[''] })
  const [teamInvites, setTeamInvites]           = useState([])
  const [showUpiModal, setShowUpiModal]         = useState(null)
  const [activeQueueEvent, setActiveQueueEvent] = useState(null)
  const [transactionId, setTransactionId]       = useState("")
  const [isSubmitting, setIsSubmitting]         = useState(false)
  const [qrCodeDataUrl, setQrCodeDataUrl]       = useState("")
  const timerRef      = useRef(null)
  const modalTimerRef = useRef(null)
  const sliderDomRef  = useRef(null)

  function showFlash(type, message) {
    if (timerRef.current) clearTimeout(timerRef.current)
    setFlash({ type, message })
    timerRef.current = setTimeout(() => setFlash({ type:"", message:"" }), 4000)
  }
  function showModalFlash(type, message) {
    if (modalTimerRef.current) clearTimeout(modalTimerRef.current)
    setModalFlash({ type, message })
    modalTimerRef.current = setTimeout(() => setModalFlash({ type:"", message:"" }), 4000)
  }
  function generateUpiUrl(upiId, eventName, amount, eventId) {
    return `upi://pay?${new URLSearchParams({ pa:upiId, pn:eventName, am:amount.toString(), cu:"INR", tn:`Event Registration - ${eventId}` }).toString()}`
  }

  const loadEvents = useCallback(async () => {
    try {
      setLoading(true)
      const r = await apiFetch('/api/events', { method:"GET" });
      if (r.status === 401) { navigate('/'); return }
      if (!r.ok) throw new Error("Failed")
      const data = await r.json()
      setEventsData({ upcoming:data?.events?.upcoming||[], ongoing:data?.events?.ongoing||[], completed:data?.events?.completed||[] })
    } catch (err) { showFlash("error","Failed to load events") }
    finally { setLoading(false) }
  }, [navigate]);

  const fetchMyRegistrations = useCallback(async () => {
    try {
      const res = await apiFetch('/api/my-participant-events');
      if (res.ok) { const d = await res.json(); setRegisteredEvents(new Set(d.participantEvents.map(ev=>ev.eid))) }
    } catch (err) { console.error(err) }
  }, []);

  const loadTeamStatus = useCallback(async (eventId) => {
    try {
      const r = await apiFetch(`/api/events/${eventId}/team-status`);
      if (r.ok) { const d = await r.json(); setTeamStates(prev=>({...prev,[eventId]:d})) }
      else       { setTeamStates(prev=>({...prev,[eventId]:null})) }
    } catch (err) { console.error(err) }
  }, []);

  useEffect(() => { loadEvents(); fetchMyRegistrations(); }, [loadEvents, fetchMyRegistrations])
  useEffect(() => {
    const active = [...(eventsData.upcoming||[]), ...(eventsData.ongoing||[])];
    active.forEach(e => loadTeamStatus(e.eid))
  }, [eventsData, loadTeamStatus])
  useEffect(() => {
    const locked = selectedEvent || showTeamModal || showUpiModal || activeQueueEvent;
    const w = document.querySelector('.registerevent-page');
    if (w) w.style.overflowY = locked ? 'hidden' : 'auto';
  }, [selectedEvent, showTeamModal, showUpiModal, activeQueueEvent]);

  const allEvents = useMemo(() => [
    ...(eventsData.upcoming||[]).map(e=>({...e,status:"upcoming"})),
    ...(eventsData.ongoing||[]).map(e=>({...e,status:"ongoing"})),
    ...(eventsData.completed||[]).map(e=>({...e,status:"completed"})),
  ], [eventsData]);

  const statusCounts = useMemo(() => ({
    all:      allEvents.length,
    upcoming: allEvents.filter(e=>e.status==="upcoming").length,
    ongoing:  allEvents.filter(e=>e.status==="ongoing").length,
    completed:allEvents.filter(e=>e.status==="completed").length,
  }), [allEvents]);

  const filteredEvents = useMemo(() => {
    const base = filter === "all" ? allEvents : allEvents.filter(e=>e.status===filter)
    return base.filter(e => {
      if (e.status==='completed') return true
      if (teamStates[e.eid]===null) return false
      return true
    })
  }, [allEvents, filter, teamStates])

  useEffect(() => {
    if (showUpiModal) {
      const { event } = showUpiModal
      QRCode.toDataURL(generateUpiUrl(event.upiId,event.ename,event.regFee,event.eid), { width:280, margin:2, color:{dark:'#000000',light:'#ffffff'} }).then(setQrCodeDataUrl)
    } else { setQrCodeDataUrl("") }
  }, [showUpiModal])

  // ── Slider state ───────────────────────────────────────────────────────────
  const { currentIndex, goToNext, goToPrev, goToSlide } = useSliderNavigation({
    totalSlides: filteredEvents.length,
    enableKeyboard: !selectedEvent && !showTeamModal && !showUpiModal && !activeQueueEvent && viewMode==="gallery",
  });

  const trackRef = useRef(null);
  const snapPoints = useSnapPoints(trackRef, filteredEvents.length);
  const snapPointsRef   = useRef(snapPoints);
  const currentIndexRef = useRef(currentIndex);
  useEffect(() => { snapPointsRef.current   = snapPoints;   }, [snapPoints]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

  const { isDragging, sliderCallbackRef, handleMouseDown, handleMouseMove, handleMouseUp, handleMouseLeave } = useSliderDrag({
    trackRef, snapPointsRef, currentIndexRef, onSwipeLeft: goToNext, onSwipeRight: goToPrev,
  });

  const combinedSliderRef = useCallback((node) => {
    sliderDomRef.current = node;
    sliderCallbackRef(node);
  }, [sliderCallbackRef]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el || snapPoints.length === 0) return;
    const base = snapPoints[currentIndex] ?? 0;
    el.style.transition = 'transform 0.45s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    el.style.transform  = `translateX(${base}px) translateZ(0)`;
  }, [currentIndex, snapPoints]);

  useSliderWheel({
    sliderRef: sliderDomRef, onScrollLeft: goToNext, onScrollRight: goToPrev,
    enabled: !selectedEvent && !showTeamModal && !showUpiModal && !activeQueueEvent && viewMode==="gallery",
  });

  const colorMap      = useColorExtraction(filteredEvents);
  const currentColors = colorMap[filteredEvents[currentIndex]?.eid] || DEFAULT_COLORS;

  // ==================== ACTION HANDLERS ====================

  // ── Register button click ──────────────────────────────────────────────────
  // PAID events: go through queue/claim-seat flow → QueueStatus modal
  // FREE events: go directly to /join → ticket animation (no queue needed)
  async function handleRegister(event) {
    const isPaid = (event.regFee || 0) > 0;

    if (!isPaid) {
      // ── FREE event: direct join, no queue ──
      try {
        const r = await apiFetch(`/api/events/${event.eid}/join`, { method: "POST", headers: { "Content-Type": "application/json" } });
        const d = await r.json();
        if (!r.ok) { showFlash("error", d.error || "Failed to register"); return; }
        showFlash("success", "Registered successfully!");
        setRegisteredEvents(prev => new Set(prev).add(event.eid));
        setTicketInfo({ eventName: event.ename, eventDate: event.eventDate, userUSN: d.userUSN || "AUTHORIZED" });
        await loadEvents();
      } catch {
        showFlash("error", "Network error");
      }
      return;
    }

    // ── PAID event: claim-seat → queue/holding flow ──
    try {
      const r = await apiFetch(`/api/events/${event.eid}/claim-seat`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) { showFlash("error", d.error || "Failed to claim seat"); return; }
      setActiveQueueEvent({ event, claimData: d });
    } catch {
      showFlash("error", "Network error claiming seat");
    }
  }

  // Called by QueueStatus when user is promoted from queued → holding
  // and also when they already had a holding slot on first claim
  function handleSeatAvailable(event) {
    setActiveQueueEvent(null);
    if (!event.upiId) { showFlash("error", "Payment not setup."); return; }
    setTransactionId(""); setModalFlash({ type: "", message: "" });
    setShowUpiModal({ event, isTeam: false });
  }

  function handleQueueExpired() {
    setActiveQueueEvent(null);
    showFlash("error", "Your seat reservation expired. Please try again.");
  }

  // ── Close queue modal (× or overlay click) ────────────────────────────────
  // QueueStatus itself calls release-queue on unmount when status=queued.
  // For holding: seat stays held — UPI modal opens right after promotion anyway.
  function handleCloseQueueModal() {
    setActiveQueueEvent(null);
    // release-queue is called inside QueueStatus cleanup (unmount effect)
  }

  // ── Close UPI modal without paying ────────────────────────────────────────
  // Immediately releases holding slot so next person in queue can be promoted.
  function handleCloseUpiModal() {
    if (isSubmitting) return;
    const { event } = showUpiModal;
    // Fire-and-forget: release the holding slot
    apiFetch(`/api/events/${event.eid}/release-holding`, { method: 'DELETE' }).catch(() => {});
    setShowUpiModal(null);
    setTransactionId("");
  }

  async function executeJoin(event) {
    try {
      const r = await apiFetch(`/api/events/${event.eid}/join`, { method: "POST", headers: { "Content-Type": "application/json" } });
      const d = await r.json()
      if (!r.ok) { showFlash("error", d.error || "Failed"); return; }
      showFlash("success", "Registered successfully!")
      setRegisteredEvents(prev => new Set(prev).add(event.eid))
      setTicketInfo({ eventName: event.ename, eventDate: event.eventDate, userUSN: d.userUSN || "AUTHORIZED" })
      await loadEvents()
    } catch { showFlash("error", "Network error") }
  }

  async function handleCreateTeam(eventId) {
    try {
      const { teamName, memberUSNs } = teamFormData
      if (!teamName.trim()) { showModalFlash('error','Team name required'); return }
      const r = await apiFetch(`/api/events/${eventId}/create-team`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({teamName:teamName.trim(),memberUSNs:memberUSNs.filter(u=>u.trim()!=='')})});
      const d = await r.json()
      if (!r.ok) { showModalFlash('error',d.error); return }
      showModalFlash('success','Team created!'); showFlash('success','Team created!')
      setTimeout(()=>{ setShowTeamModal(null); setTeamFormData({teamName:'',memberUSNs:['']}); loadTeamStatus(eventId) },1500)
    } catch { showModalFlash('error','Error creating team') }
  }

  async function handleViewInvites(eventId) {
    try {
      const r = await apiFetch(`/api/events/${eventId}/my-invites`);
      const d = await r.json()
      if (!r.ok) { showFlash('error',d.error); return }
      if (!d.invites?.length) { showFlash('error','No pending invites'); setTeamInvites([]) }
      else { setTeamInvites(d.invites); setShowTeamModal({eventId,mode:'invites'}) }
    } catch { showFlash('error','Error loading invites') }
  }

  async function handleConfirmJoin(teamId, eventId) {
    try {
      const r = await apiFetch(`/api/teams/${teamId}/confirm-join`,{method:"POST"});
      if (!r.ok) { showModalFlash('error','Failed to join'); return }
      showModalFlash('success','Joined team!');
      setTimeout(()=>{ setShowTeamModal(null); setTeamInvites([]); loadTeamStatus(eventId) },1500)
    } catch { showModalFlash('error','Error') }
  }

  async function handleRegisterTeam(event, teamState) {
    try {
      const r = await apiFetch(`/api/events/${event.eid}/register-team`,{method:"POST"});
      const d = await r.json()
      if (!r.ok) { showFlash('error',d.error); return }
      if (d.requiresPayment) {
        if (!event.upiId) { showFlash("error","Payment not setup"); return }
        setTransactionId(""); setShowUpiModal({event,isTeam:true,teamId:teamState.teamId}); return
      }
      showFlash('success','Team registered!');
      setTicketInfo({eventName:event.ename,eventDate:event.eventDate,userUSN:d.userUSN});
      await loadTeamStatus(event.eid); await loadEvents(); await fetchMyRegistrations()
    } catch { showFlash('error','Error registering team') }
  }

  async function handleSubmitUpiPayment() {
    if (!transactionId.trim()) { showModalFlash('error','Enter Transaction ID'); return }
    if (isSubmitting) return; setIsSubmitting(true)
    const { event, isTeam } = showUpiModal;
    const url = isTeam ? `/api/events/${event.eid}/register-team-upi` : `/api/events/${event.eid}/register-upi`
    try {
      const r = await apiFetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({transaction_id:transactionId.trim()})});
      const d = await r.json()
      if (!r.ok) { showModalFlash('error',d.error); return }
      showModalFlash('success','Submitted for verification!');
      setTimeout(async()=>{
        setShowUpiModal(null); setTransactionId(""); showFlash('success','Submitted!');
        setTicketInfo({eventName:event.ename,eventDate:event.eventDate,userUSN:d.userUSN||"PENDING"});
        await loadEvents(); await loadTeamStatus(event.eid); await fetchMyRegistrations()
      },1500)
    } catch { showModalFlash('error','Error submitting') } finally { setIsSubmitting(false) }
  }

  const handleOpenPoster = (e, url) => { e.stopPropagation(); if (url) window.open(url,'_blank','noopener,noreferrer'); }

  function renderControls(event, isOverlay=false) {
    const ts = teamStates[event.eid]
    const aboutBtn = (event.posterUrl && isOverlay)
      ? <button className="registerevent-btn about" onClick={e=>handleOpenPoster(e,event.posterUrl)}>View Poster ↗</button>
      : null;
    if (!ts && event.status!=='completed') return <button className="registerevent-btn disabled">Loading...</button>
    if (event.status==='completed')        return <button className="registerevent-btn disabled">Event Completed</button>
    if (!ts?.isTeamEvent) {
      if (registeredEvents.has(event.eid)) return <div className="registerevent-btn-group"><button className="registerevent-btn success" disabled>✓ Registered</button>{aboutBtn}</div>
      const isPaid = (event.regFee || 0) > 0;
      const btnLabel = isPaid ? `Pay ₹${event.regFee}` : "Register";
      return <div className="registerevent-btn-group"><button className="registerevent-btn primary" onClick={e=>{e.stopPropagation();handleRegister(event);}}>{btnLabel}</button>{aboutBtn}</div>
    }
    if (ts.registrationComplete) return <div className="registerevent-btn-group"><button className="registerevent-btn success" disabled>✓ Team Registered</button>{aboutBtn}</div>
    if (ts.hasJoinedTeam) {
      return (
        <div className="registerevent-team-controls-group" style={{width:'100%'}}>
          {isOverlay && (
            <div className="registerevent-hud-panel">
              <div className="registerevent-hud-header">
                <span className="registerevent-hud-label">Team: {ts.teamName}</span>
                <span className="registerevent-hud-value" style={{color:ts.canRegister?'#00ff9d':'#ffbd00'}}>{ts.joinedCount}/{ts.minSize} Members</span>
              </div>
              <div className="registerevent-member-stack">
                <span className="registerevent-hud-label">Member Status:</span>
                {ts.members?.map((m,i)=>(
                  <div key={i} className="registerevent-member-row">
                    <span>{m.student?.sname||m.student_usn}</span>
                    <span className={`registerevent-status-indicator ${m.join_status?"joined":"pending"}`}>{m.join_status?"Accepted":"Pending"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="registerevent-btn-group" style={{marginTop:isOverlay?'16px':'0'}}>
            {ts.isLeader
              ? <button className={`registerevent-btn ${ts.canRegister?"primary":"disabled"}`} onClick={e=>{e.stopPropagation();ts.canRegister&&handleRegisterTeam(event,ts);}} disabled={!ts.canRegister}>{(ts.regFee||0)>0?`Pay ₹${ts.regFee}`:"Finalize Registration"}</button>
              : <button className="registerevent-btn disabled">Waiting for Leader</button>
            }
            {aboutBtn}
          </div>
        </div>
      )
    }
    return (
      <div className="registerevent-btn-group">
        <button className="registerevent-btn secondary" onClick={e=>{e.stopPropagation();setShowTeamModal({eventId:event.eid,mode:'create'})}}>Create Team</button>
        <button className="registerevent-btn secondary" onClick={e=>{e.stopPropagation();handleViewInvites(event.eid)}}>View Invites</button>
        {aboutBtn}
      </div>
    )
  }

  // ==================== RENDER ====================

  return (
    <main className="registerevent-page">
      {ticketInfo && <TicketAnimation onClose={()=>setTicketInfo(null)} {...ticketInfo} />}

      {flash.message && (
        <div className={`flo-toast ${flash.type==='success'?'flo-toast--success':'flo-toast--error'}`}>
          <span className="flo-toast-icon">{flash.type==='success'?'✓':'✕'}</span>{flash.message}
        </div>
      )}

      {/* ── Queue Status Modal ── */}
      {activeQueueEvent && (
        <div className="registerevent-modal-overlay" onClick={handleCloseQueueModal}>
          <div className="registerevent-modal" onClick={e => e.stopPropagation()}>
            <div className="registerevent-modal-header" style={{ marginBottom: "16px" }}>
              <h2 className="registerevent-modal-title">Queue Status</h2>
              <button className="registerevent-modal-close" onClick={handleCloseQueueModal}>×</button>
            </div>
            <QueueStatus
              eventId={activeQueueEvent.event.eid}
              initialData={activeQueueEvent.claimData}
              onSeatAvailable={() => handleSeatAvailable(activeQueueEvent.event)}
              onExpired={handleQueueExpired}
            />
          </div>
        </div>
      )}

      <div className="re-gallery-bg" style={{background:`radial-gradient(ellipse at 25% 20%, ${currentColors[0]}55 0%, transparent 50%), radial-gradient(ellipse at 75% 80%, ${currentColors[1]}55 0%, transparent 50%), radial-gradient(ellipse at 50% 50%, ${currentColors[2]}33 0%, transparent 65%), linear-gradient(180deg, #080808 0%, #0d0d0d 100%)`}} />
      <div className="re-gallery-blur-bg" />

      <header className="re-gallery-header">
        <div className="re-gallery-header-left">
          <h1 className="re-gallery-headline">Events</h1>
          <p className="re-gallery-subline">Discover & join events happening around you.</p>
        </div>
        <div className="re-gallery-header-right">
          {filteredEvents.length>0 && viewMode==="gallery" && <JumpCounter current={currentIndex} total={filteredEvents.length} onJump={goToSlide} />}
          {filteredEvents.length>0 && viewMode==="grid"    && <div className="re-gallery-counter" style={{cursor:'default'}}><span>{filteredEvents.length}</span><span style={{color:'rgba(255,255,255,0.25)',margin:'0 3px'}}>·</span><span>events</span></div>}
        </div>
      </header>

      <div className="re-view-toggle-desktop-centered">
        <button className={`re-view-tab ${viewMode==="gallery"?"active":""}`} onClick={()=>setViewMode("gallery")}>
          <svg viewBox="0 0 18 14" fill="none" stroke="currentColor" strokeWidth="1.6" width="14" height="11"><rect x="0.8" y="0.8" width="16.4" height="12.4" rx="2"/><line x1="0.8" y1="4" x2="17.2" y2="4"/><line x1="0.8" y1="10" x2="17.2" y2="10"/></svg>
          <span>Gallery</span>
        </button>
        <button className={`re-view-tab ${viewMode==="grid"?"active":""}`} onClick={()=>setViewMode("grid")}>
          <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><rect x="0" y="0" width="6" height="6" rx="1.2"/><rect x="8" y="0" width="6" height="6" rx="1.2" opacity="0.6"/><rect x="0" y="8" width="6" height="6" rx="1.2" opacity="0.6"/><rect x="8" y="8" width="6" height="6" rx="1.2" opacity="0.6"/></svg>
          <span>Grid</span>
        </button>
      </div>

      <div className="re-gallery-filter-strip">
        {!loading && filteredEvents.length>0 && <SearchBar events={filteredEvents} onSelect={i=>{setViewMode("gallery");goToSlide(i);}} currentIndex={currentIndex} />}
        <div className="re-filter-divider" />
        {["all","upcoming","ongoing","completed"].map(k=>(
          <button key={k} className={`re-gallery-filter-btn ${filter===k?'active':''}`} onClick={()=>{setFilter(k);goToSlide(0);}}>
            {k.charAt(0).toUpperCase()+k.slice(1)}
            {statusCounts[k]>0 && <span className={`re-filter-count ${filter===k?'active':''}`}>{statusCounts[k]}</span>}
          </button>
        ))}
      </div>

      <div className="re-mobile-view-toggle">
        <button className={`re-mobile-view-btn ${viewMode==="gallery"?"active":""}`} onClick={()=>setViewMode("gallery")}>
          <svg viewBox="0 0 18 14" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="11"><rect x="0.8" y="0.8" width="16.4" height="12.4" rx="2"/><line x1="0.8" y1="4" x2="17.2" y2="4"/><line x1="0.8" y1="10" x2="17.2" y2="10"/></svg>
          Gallery
        </button>
        <button className={`re-mobile-view-btn ${viewMode==="grid"?"active":""}`} onClick={()=>setViewMode("grid")}>
          <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><rect x="0" y="0" width="6.5" height="6.5" rx="1.2"/><rect x="9.5" y="0" width="6.5" height="6.5" rx="1.2"/><rect x="0" y="9.5" width="6.5" height="6.5" rx="1.2"/><rect x="9.5" y="9.5" width="6.5" height="6.5" rx="1.2"/></svg>
          Grid
        </button>
      </div>

      {loading ? (
        <div className="re-gallery-loading"><div className="re-gallery-spinner"></div><p>Loading events...</p></div>
      ) : filteredEvents.length===0 ? (
        <div className="re-gallery-empty"><span>No events found</span></div>
      ) : viewMode==="gallery" ? (
        <div ref={combinedSliderRef} className={`re-gallery-slider ${isDragging?'dragging':''}`}
          onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseLeave}>
          <div ref={trackRef} className="re-gallery-track">
            {filteredEvents.map((event,index) => (
              <EventGalleryCard key={event.eid} event={event} isActive={index===currentIndex}
                index={index} currentIndex={currentIndex} onOpen={setSelectedEvent} renderControls={renderControls} />
            ))}
          </div>
        </div>
      ) : (
        <BentoGrid events={filteredEvents} onOpen={setSelectedEvent} renderControls={renderControls} />
      )}

      {!loading && filteredEvents.length>1 && viewMode==="gallery" && <NavigationDots total={filteredEvents.length} current={currentIndex} onSelect={goToSlide} />}
      {viewMode==="gallery" && <div className="re-gallery-keyboard-hint"><kbd>←</kbd><kbd>→</kbd><span>navigate</span></div>}

      {/* ── Event detail overlay ── */}
      {selectedEvent && (
        <div className="registerevent-overlay-container">
          <div className="registerevent-overlay-split">
            <div className="registerevent-split-top">
              <button className="registerevent-close-btn" onClick={()=>setSelectedEvent(null)}>×</button>
              <div className="registerevent-image-wrapper">
                <img src={resolveBanner(selectedEvent)} alt={selectedEvent.ename} />
                <div className="registerevent-image-gradient"></div>
              </div>
            </div>
            <div className="registerevent-split-bottom">
              <div className="registerevent-detail-content">
                <div className="registerevent-detail-header-flex">
                  <div style={{fontFamily:'var(--nb-font-mono)',fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.12em',color:'#999',marginBottom:'6px'}}>Event Details</div>
                  <h2 className="registerevent-card-title" style={{fontSize:'2rem',marginBottom:'8px'}}>{selectedEvent.ename}</h2>
                  <div className="registerevent-badges" style={{marginTop:'8px'}}>
                    <span className="registerevent-badge registerevent-badge-upcoming">{new Date(selectedEvent.eventDate).toDateString()}</span>
                    <span className="registerevent-badge registerevent-badge-upcoming">{formatTime12h(selectedEvent.eventTime)}</span>
                    {selectedEvent.regFee>0
                      ? <span className="registerevent-badge registerevent-badge-upcoming" style={{background:'var(--nb-orange)',color:'#fff',borderColor:'var(--nb-orange)'}}>₹{selectedEvent.regFee}</span>
                      : <span className="registerevent-badge registerevent-badge-ongoing">Free</span>}
                  </div>
                </div>
                <div className="registerevent-description-box"><h4>About Event</h4><p>{selectedEvent.eventdesc}</p></div>
                <div className="registerevent-bento-grid">
                  <div className="registerevent-bento-item"><span className="bento-label">Venue</span><span className="bento-value">{selectedEvent.eventLoc}</span></div>
                  <div className="registerevent-bento-item"><span className="bento-label">Organizer</span><span className="bento-value">{selectedEvent.organizerName||"Club"}</span></div>
                  {selectedEvent.is_team && <div className="registerevent-bento-item"><span className="bento-label">Team Size</span><span className="bento-value">{selectedEvent.min_team_size} - {selectedEvent.max_team_size} Members</span></div>}
                </div>
                <div style={{height:'24px'}}></div>
              </div>
              <div className="registerevent-action-bar">{renderControls(selectedEvent,true)}</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Team modal ── */}
      {showTeamModal && (
        <div className="registerevent-modal-overlay" onClick={()=>setShowTeamModal(null)}>
          <div className="registerevent-modal" onClick={e=>e.stopPropagation()}>
            <div className="registerevent-modal-header">
              <h2 className="registerevent-modal-title">{showTeamModal.mode==='create'?'Create Team':'Invites'}</h2>
              <button className="registerevent-modal-close" onClick={()=>setShowTeamModal(null)}>×</button>
            </div>
            <div className="registerevent-modal-body">
              {modalFlash.message && (
                <div className={`flo-toast ${modalFlash.type==='error'?"flo-toast--error":"flo-toast--success"}`} style={{position:'relative',top:0,left:0,transform:'none',width:'auto',marginBottom:'16px'}}>
                  <span className="flo-toast-icon">{modalFlash.type==='error'?"✕":"✓"}</span>{modalFlash.message}
                </div>
              )}
              {showTeamModal.mode==='create' ? (
                <div className="registerevent-team-form">
                  <div className="registerevent-form-group">
                    <label className="registerevent-form-label">Team Name</label>
                    <input className="registerevent-form-input" placeholder="Enter Team Name" value={teamFormData.teamName} onChange={e=>setTeamFormData({...teamFormData,teamName:e.target.value})} />
                  </div>
                  <div className="registerevent-form-group">
                    <label className="registerevent-form-label">Members (USNs)</label>
                    {teamFormData.memberUSNs.map((usn,i)=>(
                      <div key={i} style={{display:'flex',gap:'8px',marginBottom:'8px'}}>
                        <input className="registerevent-form-input" placeholder="Member USN" value={usn} onChange={e=>{const n=[...teamFormData.memberUSNs];n[i]=e.target.value;setTeamFormData({...teamFormData,memberUSNs:n})}} />
                        {i>0 && <button className="registerevent-team-action-btn" style={{background:'var(--nb-red)',color:'#fff',borderColor:'var(--nb-black)',padding:'0 10px',width:'auto'}} onClick={()=>{setTeamFormData({...teamFormData,memberUSNs:teamFormData.memberUSNs.filter((_,idx)=>idx!==i)})}}>×</button>}
                      </div>
                    ))}
                    <button className="registerevent-team-action-btn" style={{marginTop:'8px',fontSize:'0.85rem'}} onClick={()=>setTeamFormData(p=>({...p,memberUSNs:[...p.memberUSNs,'']}))}>+ Add Member</button>
                  </div>
                  <button className="registerevent-modal-submit-btn" onClick={()=>handleCreateTeam(showTeamModal.eventId)}>Create Team</button>
                </div>
              ) : (
                <div className="registerevent-invites-list">
                  {!teamInvites.length
                    ? <p style={{color:'var(--nb-black)',textAlign:'center',fontFamily:'var(--nb-font-mono)',fontSize:'12px',textTransform:'uppercase'}}>No pending invites.</p>
                    : teamInvites.map((inv,i)=>(
                      <div key={i} className="registerevent-hud-panel" style={{marginBottom:'10px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                        <div>
                          <div style={{color:'var(--nb-black)',fontFamily:'var(--nb-font-mono)',fontWeight:700,fontSize:'13px'}}>{inv.teamName}</div>
                          <div style={{fontSize:'11px',color:'#666',fontFamily:'var(--nb-font-mono)',textTransform:'uppercase'}}>Leader: {inv.leaderName}</div>
                        </div>
                        {!inv.registrationComplete && !inv.joinStatus && <button className="registerevent-invite-confirm-btn" style={{width:'auto',padding:'8px 16px'}} onClick={()=>handleConfirmJoin(inv.teamId,showTeamModal.eventId)}>Join</button>}
                        {inv.joinStatus && <span style={{color:'var(--nb-green)',fontFamily:'var(--nb-font-mono)',fontSize:'11px',fontWeight:700}}>Joined</span>}
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── UPI Payment modal ── */}
      {showUpiModal && (
        <div className="registerevent-modal-overlay" onClick={handleCloseUpiModal}>
          <div className="registerevent-modal" onClick={e=>e.stopPropagation()}>
            <div className="registerevent-modal-header">
              <h2 className="registerevent-modal-title">Pay & Register</h2>
              <button className="registerevent-modal-close" disabled={isSubmitting} onClick={handleCloseUpiModal}>×</button>
            </div>
            <div className="registerevent-modal-body" style={{textAlign:'center'}}>
              {modalFlash.message && (
                <div className={`flo-toast ${modalFlash.type==='error'?"flo-toast--error":"flo-toast--success"}`} style={{position:'relative',top:0,left:0,transform:'none',width:'auto',marginBottom:'16px'}}>
                  <span className="flo-toast-icon">{modalFlash.type==='error'?"✕":"✓"}</span>{modalFlash.message}
                </div>
              )}
              <div className="registerevent-qr-wrapper">{qrCodeDataUrl?<img src={qrCodeDataUrl} alt="QR" style={{display:'block',maxWidth:'100%'}}/>:<div className="registerevent-spinner" style={{margin:'40px auto'}}></div>}</div>
              <p style={{color:'var(--nb-black)',marginBottom:'20px',fontFamily:'var(--nb-font-mono)',fontSize:'13px',fontWeight:700}}>Pay <strong>₹{showUpiModal.event.regFee}</strong></p>
              <div className="registerevent-payment-details"><div className="registerevent-payment-row"><span style={{color:'#888'}}>UPI ID</span><span className="registerevent-payment-value">{showUpiModal.event.upiId}</span></div></div>
              <input className="registerevent-form-input" placeholder="Transaction ID (UTR)" value={transactionId} onChange={e=>setTransactionId(e.target.value)} disabled={isSubmitting} />
              <button className="registerevent-modal-submit-btn" style={{marginTop:'16px'}} onClick={handleSubmitUpiPayment} disabled={isSubmitting}>{isSubmitting?"Verifying...":"Submit Payment"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
