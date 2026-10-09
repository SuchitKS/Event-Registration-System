
import React, { useEffect, useState, useRef, useMemo } from 'react';
import './participants.css';
import { useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { apiFetch } from './api.js';

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { generateCertificatePdf } from './certificatePdf.js';
import { buildCertData, normalizeLayout } from './certificateLib.js';

let cachedFontBytes = null;

const Participants = () => {
  const navigate = useNavigate();
  const [events, setEvents] = useState({ ongoing: [], completed: [], upcoming: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userInfo, setUserInfo] = useState({ userName: '', userUSN: '' });
  const [activeFilter, setActiveFilter] = useState('all');
  const [showFab, setShowFab] = useState(true);
  const ctaRef = useRef(null);

  const [generatingIds, setGeneratingIds] = useState(new Set());
  const [downloadLinks, setDownloadLinks] = useState({});

  useEffect(() => { fetchUserInfo(); fetchParticipantEvents(); }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(([e]) => setShowFab(!e.isIntersecting), { threshold: 0.1 });
    if (ctaRef.current) observer.observe(ctaRef.current);
    return () => { if (ctaRef.current) observer.unobserve(ctaRef.current); };
  }, [loading]);

  useEffect(() => {
    return () => {
      Object.values(downloadLinks).forEach(link => {
        if (link && link.url) window.URL.revokeObjectURL(link.url);
      });
    };
  }, [downloadLinks]);

  const fetchUserInfo = async () => {
    try {
      const res = await apiFetch('/api/me', { method: 'GET' });
      if (res.ok) { const d = await res.json(); setUserInfo({ userName: d.userName, userUSN: d.userUSN }); }
    } catch { }
  };

  const fmt = (ds) => {
    if (!ds) return 'N/A';
    return new Date(ds).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };
  const fmtTime = (ts) => {
    if (!ts) return 'N/A';
    const [h, m] = ts.split(':'); let hr = parseInt(h);
    const ap = hr >= 12 ? 'PM' : 'AM'; hr = hr % 12 || 12;
    return `${hr}:${m} ${ap}`;
  };
  const categorize = (list) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const c = { ongoing: [], completed: [], upcoming: [] };
    list.forEach(ev => {
      const d = new Date(ev.eventDate); d.setHours(0, 0, 0, 0);
      const diff = Math.ceil((d - today) / 86400000);
      if (diff === 0) c.ongoing.push(ev);
      else if (diff < 0) c.completed.push(ev);
      else c.upcoming.push(ev);
    });
    c.upcoming.sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));
    c.completed.sort((a, b) => new Date(b.eventDate) - new Date(a.eventDate));
    return c;
  };

  const fetchParticipantEvents = async () => {
    try {
      const res = await apiFetch('/api/my-participant-events', { method: 'GET' });
      if (!res.ok) { if (res.status === 401) { navigate('/'); return; } throw new Error(`HTTP ${res.status}`); }
      const data = await res.json();
      setEvents(categorize(data.participantEvents || []));
      setLoading(false);
    } catch (err) { setError(err.message); setLoading(false); }
  };

  const drawCentred = (page, text, { font, size, color, y, pageWidth }) => {
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (pageWidth - textWidth) / 2, y, size, font, color });
  };

  const drawWrappedCentred = (page, text, { font, size, color, startY, maxWidth, lineHeight, pageWidth }) => {
    const words = text.split(' ');
    const lines = [];
    let current = '';

    words.forEach(word => {
      const test = current ? current + ' ' + word : word;
      if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    });
    if (current) lines.push(current);

    let y = startY;
    lines.forEach(line => {
      const lw = font.widthOfTextAtSize(line, size);
      page.drawText(line, { x: (pageWidth - lw) / 2, y, size, font, color });
      y -= lineHeight;
    });

    return y; 
  };

  const generateCertificate = async (event) => {
    if (downloadLinks[event.eid]?.url) window.URL.revokeObjectURL(downloadLinks[event.eid].url);
    setGeneratingIds(prev => new Set(prev).add(event.eid));

    try {
      // New certificate system: layout is designed by the organiser and released by them.
      if (event.certificateEnabled) {
        const r = await apiFetch(`/api/events/${event.eid}/certificate`, { method: 'GET' });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { alert(j.error || 'Certificate is not available yet.'); return; }
        const data = buildCertData({
          name: userInfo.userName, usn: userInfo.userUSN, event: event.ename,
          date: event.eventDate, points: event.earnedActivityPts, customText: j.certificateInfo,
        });
        const bytes = await generateCertificatePdf({ template: j.template, layout: normalizeLayout(j.template, j.layout), data });
        const url = window.URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        setDownloadLinks(prev => ({
          ...prev,
          [event.eid]: { url, filename: `Certificate_${userInfo.userUSN || event.eid}.pdf` },
        }));
        return;
      }

      if (!event.PartStatus) {
        alert('Certificate is only available for attended events.');
        setGeneratingIds(prev => { const next = new Set(prev); next.delete(event.eid); return next; });
        return;
      }

      const t = new Date().getTime();
      const res = await fetch(`/openday.pdf?v=${t}`);
      if (!res.ok) throw new Error('Template not found');
      const templateBytes = await res.arrayBuffer();

      const pdfDoc = await PDFDocument.load(templateBytes);
      pdfDoc.registerFontkit(fontkit);
      const page = pdfDoc.getPages()[0];
      const { width } = page.getSize();

      let nameFont;
      try {
        if (!cachedFontBytes) {
          const fontRes = await fetch(`/Allura-Regular.ttf?v=${t}`);
          if (fontRes.ok) cachedFontBytes = await fontRes.arrayBuffer();
          else throw new Error('Font missing');
        }
        nameFont = await pdfDoc.embedFont(cachedFontBytes);
      } catch {
        nameFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic);
      }

      const regularFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
      const boldFont    = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

      const gold       = rgb(0.97, 0.85, 0.57);
      const white      = rgb(1, 1, 1);
      const maxWidth   = width * 0.72;
      const lineHeight = 18;

      const certifyText = 'This is to certify that';
      drawCentred(page, certifyText, { font: regularFont, size: 13, color: white, y: 290, pageWidth: width });

      const nameText = userInfo.userName || 'Participant';
      drawCentred(page, nameText, { font: nameFont, size: 38, color: gold, y: 245, pageWidth: width });

      const usn = userInfo.userUSN || '______';
      const eventName = event.ename || 'the specified';
      const participationText = `bearing USN ${usn} has actively participated in the ${eventName} event held on ${fmt(event.eventDate)} at BMS College of Engineering, Bangalore.`;

      const afterPartY = drawWrappedCentred(page, participationText, {
        font: regularFont, size: 12, color: white, startY: 220, maxWidth, lineHeight, pageWidth: width,
      });

      const rawPts = String(event.earnedActivityPts || '0').replace(/[^0-9.]/g, '');
      let pts = parseFloat(rawPts);
      if (isNaN(pts)) pts = 0;

      if (pts > 0) {
        const ptsText = `${pts} activity point${pts !== 1 ? 's' : ''} can be claimed from this certificate.`;
        drawWrappedCentred(page, ptsText, {
          font: boldFont, size: 13, color: gold, startY: afterPartY - 18, maxWidth, lineHeight, pageWidth: width,
        });
      }

      const pdfBytes = await pdfDoc.save();
      const url = window.URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));
      setDownloadLinks(prev => ({
        ...prev,
        [event.eid]: { url, filename: `Certificate_${userInfo.userUSN || event.eid}.pdf` },
      }));

    } catch (err) {
      console.error(err);
      alert(`Error generating certificate: ${err.message}`);
    } finally {
      setGeneratingIds(prev => { const next = new Set(prev); next.delete(event.eid); return next; });
    }
  };

  // Legacy events: attended only. New events: organiser must release (to present / to all registered).
  const canGetCert = (ev) => ev.certificateEnabled
    ? !!ev.certificateReleased && (ev.certificateReleaseMode === 'all' || ev.PartStatus)
    : ev.PartStatus;

  const counts = useMemo(() => ({
    all: events.ongoing.length + events.completed.length + events.upcoming.length,
    upcoming: events.upcoming.length,
    ongoing: events.ongoing.length,
    completed: events.completed.length,
  }), [events]);

  const attendedCount = useMemo(() => events.completed.filter(e => e.PartStatus).length, [events]);

  const renderCard = (event, type) => {
    const isPast = type === 'completed';
    let displayPts = parseFloat(String(event.earnedActivityPts || '0').replace(/[^0-9.]/g, ''));
    if (isNaN(displayPts)) displayPts = 0;

    return (
      <div key={event.eid} className={`part-event-card ${type}`}>
        <div className="part-card-header">
          <h3 className="part-card-title">{DOMPurify.sanitize(event.ename || 'N/A')}</h3>
          <span className={`part-status-chip ${type}`}>
            {type === 'ongoing' ? '🟢 Live' : type === 'upcoming' ? 'Upcoming' : 'Done'}
          </span>
        </div>

        <div className="part-card-meta">
          <span className="part-card-meta-item date"><i className="fas fa-calendar-alt"></i>{fmt(event.eventDate)}</span>
          <span className="part-card-meta-item time"><i className="fas fa-clock"></i>{fmtTime(event.eventTime)}</span>
          <span className="part-card-meta-item place"><i className="fas fa-map-marker-alt"></i>{DOMPurify.sanitize(event.eventLoc || 'TBD')}</span>
        </div>

        <div className="part-card-footer">
          <div className="part-card-badges">
            {isPast && !event.PartStatus ? (
              <span className="part-no-attend">Did not attend</span>
            ) : (
              <>
                {event.PartStatus
                  ? <span className="part-attend-chip attended"><i className="fas fa-check"></i> Attended</span>
                  : <span className="part-attend-chip registered"><i className="fas fa-bookmark"></i> Registered</span>
                }
                {displayPts > 0 && (
                  <span className="part-points-chip"><i className="fas fa-star"></i>{displayPts} pts</span>
                )}
              </>
            )}

            {(type === 'upcoming' || type === 'ongoing') && (
              <button className="part-action-chip ticket-btn" onClick={() => navigate(`/participant-ticket?eventId=${event.eid}`)}>
                <i className="fas fa-ticket-alt"></i> View Ticket
              </button>
            )}

            {(type === 'completed' && canGetCert(event)) && (
              generatingIds.has(event.eid) ? (
                <button className="part-action-chip cert-btn" disabled>
                  <i className="fas fa-spinner fa-spin"></i> Generating...
                </button>
              ) : downloadLinks[event.eid] ? (
                <a href={downloadLinks[event.eid].url} download={downloadLinks[event.eid].filename} className="part-action-chip cert-btn" style={{ textDecoration: 'none' }}>
                  <i className="fas fa-download"></i> Download
                </a>
              ) : (
                <button className="part-action-chip cert-btn" onClick={() => generateCertificate(event)}>
                  <i className="fas fa-certificate"></i> View Cert
                </button>
              )
            )}

            {event.whatsappLink && (
              <a className="part-attend-chip registered" href={event.whatsappLink} target="_blank" rel="noopener noreferrer"><i className="fab fa-whatsapp"></i> WhatsApp group</a>
            )}
            {type === 'completed' && event.certificateEnabled && !event.certificateReleased && event.PartStatus && (
              <span className="part-attend-chip registered"><i className="fas fa-hourglass-half"></i> Certificate pending</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  const FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'ongoing', label: 'Live Now' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'completed', label: 'Completed' },
  ];

  return (
    <div className="participants-page">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css" />

      {/* Spacer to prevent Navbar overlap */}
      <div style={{ paddingBottom: 60 }} />

      <section className="hero-section">
        <div className="container">

          <div className="part-hero-band">
            <div className="memphis-circle"></div>
            <div className="memphis-dots"></div>

            <p className="part-hero-greeting">Participant Dashboard</p>
            <h1 className="part-hero-name">
              {userInfo.userName ? `Hey, ${userInfo.userName.split(' ')[0]} 👋` : 'Your Events'}
            </h1>
            <div className="part-stats-row">
              <div className="part-stat-pill">
                <span className="part-stat-num y">{counts.all}</span>
                <span className="part-stat-label">Total<br />Events</span>
              </div>
              <div className="part-stat-pill">
                <span className="part-stat-num g">{attendedCount}</span>
                <span className="part-stat-label">Attended</span>
              </div>
              <div className="part-stat-pill">
                <span className="part-stat-num p">{counts.upcoming}</span>
                <span className="part-stat-label">Upcoming</span>
              </div>
            </div>
          </div>

          <div className="part-filter-bar">
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                className="part-filter-tab"
                data-active={activeFilter === key ? key : undefined}
                onClick={() => setActiveFilter(key)}
              >
                {label}
                <span className="part-filter-count">{counts[key]}</span>
              </button>
            ))}
          </div>

          {loading ? (
            <div className="part-feed" style={{ marginTop: '20px' }}>
              <div style={{ color: 'var(--yellow)', textAlign: 'center', padding: '40px', fontFamily: 'var(--mono)' }}>LOADING YOUR PASSES...</div>
            </div>
          ) : error ? (
            <div className="part-empty"><div className="part-empty-icon">⚠</div><p className="part-empty-txt">{error}</p></div>
          ) : (
            <>
              {activeFilter === 'all' ? (
                <>
                  {events.ongoing.length > 0 && (
                    <>
                      <div className="part-section-label">
                        <span className="part-section-label-text g">🟢 Live Now</span>
                        <div className="part-section-label-line"></div>
                      </div>
                      <div className="part-feed">{events.ongoing.map(e => renderCard(e, 'ongoing'))}</div>
                    </>
                  )}
                  {events.upcoming.length > 0 && (
                    <>
                      <div className="part-section-label">
                        <span className="part-section-label-text p">Upcoming</span>
                        <div className="part-section-label-line"></div>
                      </div>
                      <div className="part-feed">{events.upcoming.map(e => renderCard(e, 'upcoming'))}</div>
                    </>
                  )}
                  {events.completed.length > 0 && (
                    <>
                      <div className="part-section-label">
                        <span className="part-section-label-text b">Completed</span>
                        <div className="part-section-label-line"></div>
                      </div>
                      <div className="part-feed">{events.completed.map(e => renderCard(e, 'completed'))}</div>
                    </>
                  )}
                  {counts.all === 0 && (
                    <div className="part-empty">
                      <div className="part-empty-icon">🎟</div>
                      <p className="part-empty-txt">No events yet — go join something!</p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {(activeFilter === 'ongoing' ? events.ongoing :
                    activeFilter === 'upcoming' ? events.upcoming :
                      events.completed).length === 0 ? (
                    <div className="part-empty">
                      <div className="part-empty-icon">🎟</div>
                      <p className="part-empty-txt">No {activeFilter} events</p>
                    </div>
                  ) : (
                    <div className="part-feed" style={{ marginTop: '20px' }}>
                      {(activeFilter === 'ongoing' ? events.ongoing :
                        activeFilter === 'upcoming' ? events.upcoming :
                          events.completed).map(e => renderCard(e, activeFilter))}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <div className="part-cta-strip" ref={ctaRef}>
            <button className="part-cta-btn" onClick={() => navigate('/register-event')}>
              <i className="fas fa-plus"></i>
              Discover &amp; Join Events
            </button>
          </div>

        </div>
      </section>

      <button
        className={`mobile-fab ${!showFab ? 'hidden' : ''}`}
        onClick={() => navigate('/register-event')}
      >
        <i className="fas fa-plus"></i>
        <span>Join Event</span>
      </button>
    </div>
  );
};

export default Participants;
