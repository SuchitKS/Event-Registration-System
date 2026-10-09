import React, { useEffect, useState, useRef, useMemo } from 'react';
import './volunteers.css';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from "./api.js";

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { generateCertificatePdf } from './certificatePdf.js';
import { buildCertData, normalizeLayout } from './certificateLib.js';

// Where a volunteer is with the new certificate system (events made before it keep the old flow)
const certState = (ev) => {
  if (!ev.certificateEnabled) return 'legacy';
  if (ev.volunteerCertificateMode === 'none') return 'none';
  if (!ev.certificateReleased) return 'pending';
  if (ev.certificateReleaseMode !== 'all' && !ev.VolnStatus) return 'not_eligible';
  return 'ready';
};

let cachedFontBytes = null;

const Volunteers = () => {
  const navigate = useNavigate();
  const [events, setEvents] = useState({ ongoing: [], completed: [], upcoming: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userInfo, setUserInfo] = useState({ userName: '', userUSN: '' });

  const [generatingIds, setGeneratingIds] = useState(new Set());
  const [downloadLinks, setDownloadLinks] = useState({});
  const [activeFilter, setActiveFilter] = useState('all');

  const [showFab, setShowFab] = useState(true);
  const ctaRef = useRef(null);

  useEffect(() => {
    fetchUserInfo();
    fetchVolunteerEvents();
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { setShowFab(!entry.isIntersecting); },
      { threshold: 0.1 }
    );
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
      const response = await apiFetch('/api/me');
      if (response.ok) {
        const data = await response.json();
        setUserInfo({ userName: data.userName, userUSN: data.userUSN });
      }
    } catch (err) {
      console.error('Error fetching user info:', err);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatTime = (timeString) => {
    if (!timeString) return 'N/A';
    const [h, m] = timeString.split(':');
    let hours = parseInt(h);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${m} ${ampm}`;
  };

  const categorizeEvents = (eventsList) => {
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    const uniqueEvents = eventsList.reduce((acc, current) => {
      if (!acc.find(e => e.eid === current.eid)) acc.push(current);
      return acc;
    }, []);

    const categorized = { ongoing: [], completed: [], upcoming: [] };

    uniqueEvents.forEach(event => {
      const eventDate = new Date(event.eventDate);
      eventDate.setHours(0, 0, 0, 0);
      const diffTime = eventDate.getTime() - currentDate.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 0) categorized.ongoing.push(event);
      else if (diffDays < 0) categorized.completed.push(event);
      else categorized.upcoming.push(event);
    });

    categorized.upcoming.sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));
    categorized.completed.sort((a, b) => new Date(b.eventDate) - new Date(a.eventDate));

    return categorized;
  };

  const fetchVolunteerEvents = async () => {
    try {
      const response = await apiFetch('/api/my-volunteer-events');
      if (!response.ok) {
        if (response.status === 401) { navigate('/'); return; }
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setEvents(categorizeEvents(data.volunteerEvents || []));
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
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
      // New certificate system: design is made by the organiser, released by the organiser
      if (event.certificateEnabled) {
        const r = await apiFetch(`/api/events/${event.eid}/certificate`, { method: 'GET' });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { alert(j.error || 'Certificate is not available yet.'); return; }
        const data = buildCertData({
          name: userInfo.userName, usn: userInfo.userUSN, event: event.ename, date: event.eventDate,
          points: event.earnedActivityPts || j.points || 0, customText: j.certificateInfo, role: 'volunteer',
        });
        const bytes = await generateCertificatePdf({ template: j.template, layout: normalizeLayout(j.template, j.layout), data });
        const url = window.URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        setDownloadLinks(prev => ({
          ...prev,
          [event.eid]: { url, filename: `Certificate_${userInfo.userUSN || event.eid}.pdf` },
        }));
        return;
      }

      if (!event.VolnStatus) {
        alert('Certificate is only available for confirmed volunteer participation.');
        setGeneratingIds(prev => { const next = new Set(prev); next.delete(event.eid); return next; });
        return;
      }

      const t = new Date().getTime();
      const res = await fetch(`/openday2.pdf?v=${t}`);
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

      // ✅ Added: matches participants.jsx exactly
      const certifyText = 'This is to certify that';
      drawCentred(page, certifyText, { font: regularFont, size: 13, color: white, y: 290, pageWidth: width });

      const nameText = userInfo.userName || 'Volunteer';
      drawCentred(page, nameText, { font: nameFont, size: 38, color: gold, y: 245, pageWidth: width });

      const usn = userInfo.userUSN || '______';
      const eventName = event.ename || 'the specified';
      const volunteerText = `bearing USN ${usn} has actively volunteered for the ${eventName} event held on ${formatDate(event.eventDate)} at BMS College of Engineering, Bangalore.`;

      const afterPartY = drawWrappedCentred(page, volunteerText, {
        font: regularFont, size: 12, color: white, startY: 220, maxWidth, lineHeight, pageWidth: width,
      });

      const rawPts = String(event.earnedActivityPts || '0').replace(/[^0-9.]/g, '');
      let pts = parseFloat(rawPts);
      if (isNaN(pts)) pts = 0;

      if (pts > 0) {
        const ptsText = `${pts} activity point${pts !== 1 ? 's' : ''} can be claimed from this certificate.`;
        drawWrappedCentred(page, ptsText, {
          font: boldFont, size: 13, color: gold, startY: afterPartY - 8, maxWidth, lineHeight, pageWidth: width,
        });
      }

      const pdfBytes = await pdfDoc.save();
      const url = window.URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));
      setDownloadLinks(prev => ({
        ...prev,
        [event.eid]: { url, filename: `Volunteer_Certificate_${userInfo.userUSN || event.eid}.pdf` },
      }));

    } catch (err) {
      console.error(err);
      alert(`Error generating certificate: ${err.message}`);
    } finally {
      setGeneratingIds(prev => { const next = new Set(prev); next.delete(event.eid); return next; });
    }
  };

  const handleEventButtonClick = (event, type) => {
    if (type === 'completed') {
      generateCertificate(event);
    } else {
      navigate(`/volunteer-ticket?eventId=${event.eid}`);
    }
  };

  const counts = useMemo(() => ({
    all: events.ongoing.length + events.completed.length + events.upcoming.length,
    upcoming: events.upcoming.length,
    ongoing: events.ongoing.length,
    completed: events.completed.length,
  }), [events]);

  const renderCard = (event, type) => {
    const isPast = type === 'completed';

    return (
      <div key={event.eid} className={`vol-event-card ${type}`}>
        <div className="vol-card-header">
          <h3 className="vol-card-title">{event.ename || 'N/A'}</h3>
          <span className={`vol-status-chip ${type}`}>
            {type === 'ongoing' ? '🟢 Live' : type === 'upcoming' ? 'Upcoming' : 'Done'}
          </span>
        </div>

        <p className="vol-card-desc">{event.eventdesc || 'No description available for this event.'}</p>

        <div className="vol-card-meta">
          <span><i className="fas fa-calendar-alt"></i> {formatDate(event.eventDate)}</span>
          <span><i className="fas fa-clock"></i> {formatTime(event.eventTime)}</span>
          <span><i className="fas fa-map-marker-alt"></i> {event.eventLoc || 'TBD'}</span>
        </div>

        <div className="vol-card-badges">
          {event.VolnStatus
            ? <span className="status-confirmed"><i className="fas fa-check"></i> Confirmed</span>
            : <span className="status-reg"><i className="fas fa-hourglass-half"></i> Registered</span>
          }
          {event.whatsappLink && (
            <a className="status-reg" href={event.whatsappLink} target="_blank" rel="noopener noreferrer"><i className="fab fa-whatsapp"></i> WhatsApp group</a>
          )}
          {(event.earnedActivityPts || 0) > 0 && (
            <span className="vol-activity-points"><i className="fas fa-star"></i> {event.earnedActivityPts} Claimable Pts</span>
          )}
        </div>

        <div className="vol-card-action-bar">
          {isPast ? (
            certState(event) === 'none' ? (
              <span className="status-reg">No certificate for this event</span>
            ) : certState(event) === 'pending' ? (
              <button className="vol-action-btn secondary" disabled>Certificate pending</button>
            ) : certState(event) === 'not_eligible' ? (
              <button className="vol-action-btn secondary" disabled>Confirmed volunteers only</button>
            ) : (
            generatingIds.has(event.eid) ? (
              <button className="vol-action-btn primary" disabled>Generating...</button>
            ) : downloadLinks[event.eid] ? (
              <a href={downloadLinks[event.eid].url} download={downloadLinks[event.eid].filename} className="vol-action-btn success">
                <i className="fas fa-download"></i> Download
              </a>
            ) : (
              <button className="vol-action-btn primary" onClick={() => handleEventButtonClick(event, type)}>
                <i className="fas fa-certificate"></i> Certificate
              </button>
            )
            )
          ) : (
            <button className="vol-action-btn secondary" onClick={() => handleEventButtonClick(event, type)}>
              <i className="fas fa-ticket-alt"></i> View Details
            </button>
          )}
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
    <div className="volunteers-page">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css" />

      {/* Spacer to prevent Navbar overlap */}
      <div style={{ paddingBottom: 60 }} />

      <section className="hero-section">
        <div className="container">

          <div className="vol-hero-band">
            <p className="vol-hero-greeting">Volunteer Dashboard</p>
            <h1 className="vol-hero-name">
              {userInfo.userName ? `Welcome back, ${userInfo.userName.split(' ')[0]} 🤝` : 'Your Volunteer Events'}
            </h1>
            <div className="vol-stats-row">
              <div className="vol-stat-pill">
                <span className="vol-stat-num y">{counts.all}</span>
                <span className="vol-stat-label">Total<br />Events</span>
              </div>
              <div className="vol-stat-pill">
                <span className="vol-stat-num g">{counts.completed}</span>
                <span className="vol-stat-label">Completed</span>
              </div>
              <div className="vol-stat-pill">
                <span className="vol-stat-num p">{counts.upcoming}</span>
                <span className="vol-stat-label">Upcoming</span>
              </div>
            </div>
          </div>

          <div className="vol-filter-bar">
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                className="vol-filter-tab"
                data-active={activeFilter === key ? key : undefined}
                onClick={() => setActiveFilter(key)}
              >
                {label}
                <span className="vol-filter-count">{counts[key]}</span>
              </button>
            ))}
          </div>

          {loading ? (
            <div className="vol-empty">
              <h2 style={{ fontFamily: 'var(--font-display)' }}>Loading your shifts...</h2>
            </div>
          ) : error ? (
            <div className="vol-empty">
              <div className="vol-empty-icon">⚠</div>
              <p className="vol-empty-txt">{error}</p>
            </div>
          ) : (
            <>
              {activeFilter === 'all' ? (
                <>
                  {events.ongoing.length > 0 && (
                    <>
                      <div className="vol-section-label">
                        <span className="vol-section-label-text" style={{ color: 'var(--mint)' }}>🟢 Live Now</span>
                        <div className="vol-section-label-line"></div>
                      </div>
                      <div className="vol-feed">{events.ongoing.map(e => renderCard(e, 'ongoing'))}</div>
                    </>
                  )}
                  {events.upcoming.length > 0 && (
                    <>
                      <div className="vol-section-label">
                        <span className="vol-section-label-text" style={{ color: 'var(--pink)' }}>Upcoming</span>
                        <div className="vol-section-label-line"></div>
                      </div>
                      <div className="vol-feed">{events.upcoming.map(e => renderCard(e, 'upcoming'))}</div>
                    </>
                  )}
                  {events.completed.length > 0 && (
                    <>
                      <div className="vol-section-label">
                        <span className="vol-section-label-text">Completed</span>
                        <div className="vol-section-label-line"></div>
                      </div>
                      <div className="vol-feed">{events.completed.map(e => renderCard(e, 'completed'))}</div>
                    </>
                  )}
                  {counts.all === 0 && (
                    <div className="vol-empty">
                      <div className="vol-empty-icon">🤝</div>
                      <p className="vol-empty-txt">No volunteer events yet — time to step up!</p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {(activeFilter === 'ongoing' ? events.ongoing :
                    activeFilter === 'upcoming' ? events.upcoming :
                      events.completed).length === 0 ? (
                    <div className="vol-empty">
                      <div className="vol-empty-icon">🤝</div>
                      <p className="vol-empty-txt">No {activeFilter} events</p>
                    </div>
                  ) : (
                    <div className="vol-feed">
                      {(activeFilter === 'ongoing' ? events.ongoing :
                        activeFilter === 'upcoming' ? events.upcoming :
                          events.completed).map(e => renderCard(e, activeFilter))}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <div className="vol-cta-strip" ref={ctaRef}>
            <button className="vol-cta-btn" onClick={() => navigate('/volunteer-event')}>
              <i className="fas fa-hand-holding-heart"></i>
              Volunteer for Events
            </button>
          </div>

        </div>
      </section>

      <button
        className={`mobile-fab ${!showFab ? 'hidden' : ''}`}
        onClick={() => navigate('/volunteer-event')}
      >
        <i className="fas fa-hand-holding-heart"></i>
        <span>Volunteer</span>
      </button>
    </div>
  );
};

export default Volunteers;
