import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import './organisers.css';

import { apiFetch } from './api.js';
import CertificateSettings from './CertificateSettings.jsx';
import './org_payments_extra.css';

const Organisers = () => {
  const navigate = useNavigate();

  const [events, setEvents] = useState({
    ongoing: [],
    completed: [],
    upcoming: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generatingExcel, setGeneratingExcel] = useState({});
  const [certEvent, setCertEvent] = useState(null);

  // Payment States
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedEventForPayments, setSelectedEventForPayments] = useState(null);
  const [pendingPayments, setPendingPayments] = useState([]);
  const [refundNeeded, setRefundNeeded] = useState([]);
  const [rejectTarget, setRejectTarget] = useState(null);   // payment row being rejected
  const [rejectReason, setRejectReason] = useState('');
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [processingPayment, setProcessingPayment] = useState({});
  const [isTeamEvent, setIsTeamEvent] = useState(false);

  // Scroll Assistant Refs & States
  const completedRef = useRef(null);
  const ongoingRef = useRef(null);
  const upcomingRef = useRef(null);
  const [scrollPositions, setScrollPositions] = useState({
    completed: 'down',
    ongoing: 'down',
    upcoming: 'down'
  });

  // FAB Visibility Logic
  const [showFab, setShowFab] = useState(true);
  const buttonRef = useRef(null);

  // --- FIX 1: iOS Detection Logic ---
  useEffect(() => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    const wrapper = document.querySelector('.organisers-unique-wrapper');
    if (isIOS && wrapper) {
      wrapper.classList.add('is-ios');
    }
  }, []);

  // --- FAB Visibility Observer ---
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowFab(!entry.isIntersecting);
      },
      {
        root: null,
        threshold: 0.1,
      }
    );

    if (buttonRef.current) {
      observer.observe(buttonRef.current);
    }

    return () => {
      if (buttonRef.current) {
        observer.unobserve(buttonRef.current);
      }
    };
  }, [loading]);

  // --- Logic ---
  const categorizeEvents = useCallback((events) => {
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    const categorized = {
      ongoing: [],
      completed: [],
      upcoming: [],
    };

    events.forEach((event) => {
      const eventDate = new Date(event.eventDate);
      eventDate.setHours(0, 0, 0, 0);
      const diffTime = eventDate.getTime() - currentDate.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        categorized.ongoing.push(event);
      } else if (diffDays < 0) {
        categorized.completed.push(event);
      } else {
        categorized.upcoming.push(event);
      }
    });

    return categorized;
  }, []);

  const fetchOrganizerEvents = async () => {
    try {
      const response = await apiFetch('/api/my-organized-events', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        if (response.status === 401) {
          navigate('/');
          return;
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const categorizedEvents = categorizeEvents(data.organizerEvents || []);
      setEvents(categorizedEvents);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching organizer events:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrganizerEvents();
  }, [navigate, categorizeEvents]);

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (timeString) => {
    if (!timeString) return 'N/A';
    const [hours, minutes] = timeString.split(':');
    let h = parseInt(hours);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${minutes} ${ampm}`;
  };

  const handleGenerateDetails = async (eventId, eventName) => {
    try {
      setGeneratingExcel((prev) => ({ ...prev, [eventId]: true }));

      const response = await apiFetch(`/api/events/${eventId}/generate-details`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        if (response.status === 401) {
          alert('Session expired. Please login again.');
          navigate('/');
          return;
        }
        if (response.status === 403) {
          alert('You are not authorized to generate details for this event.');
          return;
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Event_${eventName.replace(/\s+/g, '_')}_Details.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Error generating Excel file:', err);
      alert('Error generating Excel file. Please try again.');
    } finally {
      setGeneratingExcel((prev) => ({ ...prev, [eventId]: false }));
    }
  };

  const handleViewPendingPayments = async (event) => {
    setSelectedEventForPayments(event);
    setShowPaymentModal(true);
    setLoadingPayments(true);

    try {
      const response = await apiFetch(`/api/events/${event.eid}/pending-payments`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) throw new Error('Failed to fetch pending payments');

      const data = await response.json();
      setPendingPayments(data.pendingPayments || []);
      setRefundNeeded(data.refundNeeded || []);
      setRejectTarget(null); setRejectReason('');
      setIsTeamEvent(data.isTeamEvent || false);
    } catch (err) {
      console.error('Error fetching pending payments:', err);
      alert('Error loading pending payments');
      setPendingPayments([]);
      setRefundNeeded([]);
      setIsTeamEvent(false);
    } finally {
      setLoadingPayments(false);
    }
  };

  // Reject a payment. The reason is optional; the student always sees "rejected" on the website,
  // and gets an email only when a reason was written.
  const handleRejectPayment = async () => {
    if (!rejectTarget || !selectedEventForPayments) return;
    const usn = rejectTarget.partusn;
    if (processingPayment[usn]) return;
    setProcessingPayment((prev) => ({ ...prev, [usn]: 'rejecting' }));
    try {
      const response = await apiFetch('/api/payments/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantUSN: usn, eventId: selectedEventForPayments.eid, reason: rejectReason.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP status ${response.status}`);
      setPendingPayments((prev) => prev.filter((p) => p.partusn !== usn));
      setRejectTarget(null); setRejectReason('');
    } catch (err) {
      alert(`Error: ${err.message || 'Failed to reject payment. Please try again.'}`);
    } finally {
      setProcessingPayment((prev) => ({ ...prev, [usn]: null }));
    }
  };

  // The student paid after their seat went to someone else; organiser refunds, then marks it done.
  const handleRefunded = async (participantUSN) => {
    try {
      const response = await apiFetch('/api/payments/refunded', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantUSN, eventId: selectedEventForPayments.eid }),
      });
      if (!response.ok) throw new Error('Failed');
      setRefundNeeded((prev) => prev.filter((r) => r.partusn !== participantUSN));
    } catch (err) {
      alert('Could not update. Please try again.');
    }
  };

  const handleVerifyPayment = async (participantUSN, eventId) => {
    // Prevent double clicks
    if (processingPayment[participantUSN]) return;

    setProcessingPayment((prev) => ({ ...prev, [participantUSN]: 'verifying' }));

    try {
      const response = await apiFetch('/api/payments/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantUSN, eventId }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP status ${response.status}`);

      // Success Animation State
      setProcessingPayment((prev) => ({ ...prev, [participantUSN]: 'success' }));

      setTimeout(() => {
        if (data.verifiedCount && data.verifiedCount > 1) {
          alert(`${data.message}\nAll ${data.verifiedCount} team members can now mark attendance.`);
        }
        setPendingPayments((prev) => prev.filter((p) => p.partusn !== participantUSN));
        setProcessingPayment((prev) => ({ ...prev, [participantUSN]: null }));
      }, 1200);

    } catch (err) {
      console.error('Error verifying payment:', err);
      alert(`Error: ${err.message || 'Failed to verify payment. Please try again.'}`);
      setProcessingPayment((prev) => ({ ...prev, [participantUSN]: null }));
    }
  };

  const handleEventButtonClick = (eventId) => {
    navigate(`/organiser-ticket?eventId=${eventId}`);
  };

  const handleOrganiseClick = () => navigate('/create-event');

  const handleCloseModal = () => {
    setShowPaymentModal(false);
  };

  const handleCardScroll = (e, key) => {
    const el = e.target;
    const isAtBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 10;
    const newState = isAtBottom ? 'up' : 'down';
    if (scrollPositions[key] !== newState) {
      setScrollPositions(prev => ({ ...prev, [key]: newState }));
    }
  };

  const executeCardScroll = (key) => {
    const refs = { completed: completedRef, ongoing: ongoingRef, upcoming: upcomingRef };
    const el = refs[key].current;
    if (!el) return;

    if (scrollPositions[key] === 'up') {
      el.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      const items = el.querySelectorAll('.part-event-item-glass');
      let target = null;
      for (let item of items) {
        // Find first item whose top is below current scroll + padding offset
        if (item.offsetTop > el.scrollTop + 20) {
          target = item;
          break;
        }
      }
      if (target) {
        // Subtract container padding (16px) to align perfectly at the top
        el.scrollTo({ top: target.offsetTop - 16, behavior: 'smooth' });
      } else {
        el.scrollBy({ top: 150, behavior: 'smooth' });
      }
    }
  };

  const ScrollAssistant = ({ type }) => {
    const icon = scrollPositions[type] === 'up' ? 'fa-chevron-up' : 'fa-chevron-down';
    return (
      <button
        className={`card-scroll-assistant ${scrollPositions[type]}`}
        onClick={() => executeCardScroll(type)}
        title={scrollPositions[type] === 'up' ? 'Scroll to Top' : 'Scroll Down'}
      >
        <i className={`fas ${icon}`}></i>
      </button>
    );
  };

  // --- FIX 2: Handle Body Scroll Lock when Modal is Open ---
  useEffect(() => {
    if (showPaymentModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [showPaymentModal]);

  // ── RENDER CARD ──────────────────────────────────────────────
  const renderCard = (event, type) => (
    <div key={event.eid} className={`org-event-card ${type}`}>
      <div className="org-card-header">
        <h3 className="org-card-title">{DOMPurify.sanitize(event.ename || 'N/A')}</h3>
        <span className={`org-status-chip ${type}`}>
          {type === 'ongoing' ? '🟢 Live' : type === 'upcoming' ? 'Upcoming' : 'Done'}
        </span>
      </div>
      {event.eventdesc && (
        <p className="org-card-desc" style={{ padding: '0 18px 0 22px' }}>
          {DOMPurify.sanitize(event.eventdesc)}
        </p>
      )}
      <div className="org-card-meta">
        <span className="org-meta-item date"><i className="fas fa-calendar-alt"></i>{formatDate(event.eventDate)}</span>
        <span className="org-meta-item time"><i className="fas fa-clock"></i>{formatTime(event.eventTime)}</span>
        <span className="org-meta-item place"><i className="fas fa-map-marker-alt"></i>{DOMPurify.sanitize(event.eventLoc || 'N/A')}</span>
        <span className="org-meta-item seats"><i className="fas fa-users"></i>{event.maxPart || '∞'} Seats</span>
        {event.regFee > 0 && <span className="org-fee-badge"><i className="fas fa-tag"></i>₹{event.regFee}</span>}
      </div>
      <div className="org-card-footer">
        {type !== 'completed' && (
          <button className="org-action-btn view" onClick={() => handleEventButtonClick(event.eid)}>
            <i className="fas fa-eye"></i> View
          </button>
        )}
        {type !== 'completed' && (
          <button className="org-action-btn sub" onClick={() => navigate(`/sub-events?eventId=${event.eid}`)}>
            <i className="fas fa-qrcode"></i> Sub-events
          </button>
        )}
        {event.regFee > 0 && type !== 'completed' && (
          <button className="org-action-btn pay org-pulse-border" onClick={() => handleViewPendingPayments(event)}>
            <i className="fas fa-credit-card"></i> Verify Pay
          </button>
        )}
        <button className="org-action-btn view" onClick={() => setCertEvent(event)}>
          <i className="fas fa-certificate"></i> Certificate
        </button>
        <button
          className="org-action-btn excel"
          onClick={() => handleGenerateDetails(event.eid, event.ename)}
          disabled={generatingExcel[event.eid]}
        >
          {generatingExcel[event.eid]
            ? <span className="org-spinner-sm"></span>
            : <><i className="fas fa-file-excel"></i> Details</>}
        </button>
      </div>
    </div>
  );

  const renderEventsList = (list, type) => {
    if (loading) return (
      <div className="org-skeleton">
        {[1, 2].map(i => (
          <div key={i} className="org-skel-card">
            <div className="org-skel-line w70"></div>
            <div className="org-skel-line w45"></div>
            <div className="org-skel-line w55"></div>
          </div>
        ))}
      </div>
    );
    if (error) return <div className="org-event-message error">Error: {error}</div>;
    if (!list || list.length === 0) return (
      <div className="org-empty">
        <div className="org-empty-icon">📋</div>
        <p className="org-empty-txt">No {type} events</p>
      </div>
    );
    return list.map(e => renderCard(e, type));
  };

  const [activeFilter, setActiveFilter] = React.useState('all');

  const counts = React.useMemo(() => ({
    all: events.ongoing.length + events.completed.length + events.upcoming.length,
    ongoing: events.ongoing.length,
    upcoming: events.upcoming.length,
    completed: events.completed.length,
  }), [events]);

  const FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'ongoing', label: 'Live Now' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'completed', label: 'Completed' },
  ];

  return (
    <>
      <div className="org-bg-layer"></div>
      <div className="organisers-unique-wrapper">
        <div style={{ paddingBottom: 60 }} /> {/* Top Spacer for Nav */}

        <section className="hero-section">
          <div className="container">

            {/* HERO BAND */}
            <div className="org-hero-band">
              <p className="org-hero-greeting">Organiser Dashboard</p>
              <h1 className="org-hero-name">Your Events 🎯</h1>
              <div className="org-stats-row">
                <div className="org-stat-pill">
                  <span className="org-stat-num y">{counts.all}</span>
                  <span className="org-stat-label">Total<br />Events</span>
                </div>
                <div className="org-stat-pill">
                  <span className="org-stat-num g">{counts.ongoing}</span>
                  <span className="org-stat-label">Live<br />Now</span>
                </div>
                <div className="org-stat-pill">
                  <span className="org-stat-num o">{counts.upcoming}</span>
                  <span className="org-stat-label">Upcoming</span>
                </div>
              </div>
            </div>

            {/* FILTER TABS */}
            <div className="org-filter-bar">
              {FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  className="org-filter-tab"
                  data-active={activeFilter === key ? key : undefined}
                  onClick={() => setActiveFilter(key)}
                >
                  {label}
                  <span className="org-filter-count">{counts[key]}</span>
                </button>
              ))}
            </div>

            {/* FEED */}
            {activeFilter === 'all' ? (
              <>
                {events.ongoing.length > 0 && (
                  <>
                    <div className="org-section-label">
                      <div className="org-section-label-line"></div>
                      <span className="org-section-label-text g">🟢 Live Now</span>
                      <div className="org-section-label-line"></div>
                    </div>
                    <div className="org-feed">{events.ongoing.map(e => renderCard(e, 'ongoing'))}</div>
                  </>
                )}
                {events.upcoming.length > 0 && (
                  <>
                    <div className="org-section-label">
                      <div className="org-section-label-line"></div>
                      <span className="org-section-label-text o">Upcoming</span>
                      <div className="org-section-label-line"></div>
                    </div>
                    <div className="org-feed">{events.upcoming.map(e => renderCard(e, 'upcoming'))}</div>
                  </>
                )}
                {events.completed.length > 0 && (
                  <>
                    <div className="org-section-label">
                      <div className="org-section-label-line"></div>
                      <span className="org-section-label-text b">Completed</span>
                      <div className="org-section-label-line"></div>
                    </div>
                    <div className="org-feed">{events.completed.map(e => renderCard(e, 'completed'))}</div>
                  </>
                )}
                {counts.all === 0 && !loading && (
                  <div className="org-empty">
                    <div className="org-empty-icon">🎪</div>
                    <p className="org-empty-txt">No events yet — create your first one!</p>
                  </div>
                )}
              </>
            ) : (
              <div className="org-feed" style={{ marginTop: 8 }}>
                {renderEventsList(
                  activeFilter === 'ongoing' ? events.ongoing :
                    activeFilter === 'upcoming' ? events.upcoming :
                      events.completed,
                  activeFilter
                )}
              </div>
            )}

            {/* CTA */}
            <div className="org-cta-strip" ref={buttonRef}>
              <button className="org-cta-btn" onClick={handleOrganiseClick}>
                <i className="fas fa-plus"></i> Organise New Event
              </button>
            </div>

          </div>
        </section>
      </div>

      {/* FAB */}
      <button
        className={`org-mobile-fab ${!showFab ? 'hidden' : ''}`}
        onClick={handleOrganiseClick}
      >
        <i className="fas fa-plus"></i>
        <span>New Event</span>
      </button>

      {/* PAYMENT MODAL — logic unchanged */}
      {certEvent && (
        <CertificateSettings event={certEvent} onClose={() => setCertEvent(null)} />
      )}

      {showPaymentModal && (
        <div
          className="org-fintech-modal-overlay"
          onMouseDown={(e) => { if (e.target.classList.contains('org-fintech-modal-overlay')) handleCloseModal(); }}
          onTouchStart={(e) => { if (e.target.classList.contains('org-fintech-modal-overlay')) handleCloseModal(); }}
        >
          <div className="org-fintech-modal" onClick={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}>
            <div className="org-modal-top-bar">
              <div className="org-modal-title-group">
                <h2>Payment Verification</h2>
                <span className="org-modal-subtitle">{selectedEventForPayments?.ename}</span>
              </div>
              <button className="org-modal-close-btn" onClick={handleCloseModal}
                onTouchEnd={(e) => { e.preventDefault(); handleCloseModal(); }}>×</button>
            </div>
            <div className="org-modal-content-area">
              {loadingPayments ? (
                <div className="org-payment-loading-state">
                  <div className="org-spinner-dots"></div>
                  <p>Loading transactions...</p>
                </div>
              ) : pendingPayments.length === 0 && refundNeeded.length === 0 ? (
                <div className="org-empty-payments">
                  <div className="org-check-ring-lg"><i className="fas fa-check"></i></div>
                  <h3>All Caught Up!</h3>
                  <p>No pending transactions found.</p>
                </div>
              ) : (
                <div className="org-payment-list">
                  {isTeamEvent && (
                    <div className="org-notice-banner">
                      <i className="fas fa-users"></i>
                      <span><strong>Team Event:</strong> Verifying Leader approves everyone.</span>
                    </div>
                  )}
                  {pendingPayments.map((payment, index) => (
                    <React.Fragment key={payment.partusn + '-' + index}>
                    <div className="org-payment-row-card" style={{ animationDelay: `${index * 0.05}s` }}>
                      <div className="org-pay-user-info">
                        <div className="org-avatar-placeholder">{payment.studentName.charAt(0)}</div>
                        <div className="org-text-details">
                          <h5>{DOMPurify.sanitize(payment.studentName)} {payment.isTeamLeader && <span className="org-tag-leader">LEADER</span>}{payment.late && <span className="org-tag-late">LATE</span>}</h5>
                          <span className="org-usn">{payment.partusn}</span>
                        </div>
                      </div>
                      <div className="org-pay-meta">
                        <span className="org-pay-id">ID: {payment.transactionId}</span>
                        <span className="org-pay-amount">₹{payment.amount}</span>
                      </div>
                      <div className="org-pay-action">
                        {processingPayment[payment.partusn] === 'success' ? (
                          <div className="org-success-tick-anim"><i className="fas fa-check-circle"></i></div>
                        ) : (
                          <>
                          <button
                            className={`org-verify-btn ${processingPayment[payment.partusn] ? 'loading' : ''}`}
                            onClick={(e) => { e.stopPropagation(); handleVerifyPayment(payment.partusn, selectedEventForPayments.eid); }}
                            onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); handleVerifyPayment(payment.partusn, selectedEventForPayments.eid); }}
                            disabled={!!processingPayment[payment.partusn]}
                          >
                            {processingPayment[payment.partusn] === 'verifying' ? <div className="org-spinner-dots-sm"></div> : 'Approve'}
                          </button>
                          <button
                            className="org-reject-btn"
                            onClick={(e) => { e.stopPropagation(); setRejectTarget(payment); setRejectReason(''); }}
                            disabled={!!processingPayment[payment.partusn]}
                          >
                            Reject
                          </button>
                          </>
                        )}
                      </div>
                    </div>
                    {payment.late && (
                      <div className="org-late-note">
                        Paid after the 15-minute hold ended, but the seat was still free. Approve to confirm it, or reject.
                      </div>
                    )}
                    {rejectTarget && rejectTarget.partusn === payment.partusn && (
                      <div className="org-reject-panel">
                        <label htmlFor={`rj-${payment.partusn}`}>Reason (optional)</label>
                        <textarea
                          id={`rj-${payment.partusn}`}
                          value={rejectReason}
                          maxLength={300}
                          placeholder="e.g. Amount not received / wrong transaction ID"
                          onChange={(e) => setRejectReason(e.target.value)}
                        />
                        <p className="hint">The seat is released and offered to the next person in line. The student sees "rejected" on the website{rejectReason.trim() ? ' and gets this reason by email' : ' (no email is sent without a reason)'}.</p>
                        <div className="row">
                          <button className="org-reject-btn" onClick={handleRejectPayment} disabled={!!processingPayment[payment.partusn]}>
                            {processingPayment[payment.partusn] === 'rejecting' ? 'Rejecting…' : 'Confirm reject'}
                          </button>
                          <button className="org-reject-btn" onClick={() => { setRejectTarget(null); setRejectReason(''); }}>Cancel</button>
                        </div>
                      </div>
                    )}
                    </React.Fragment>
                  ))}

                  {refundNeeded.length > 0 && (
                    <div className="org-refund-box">
                      <h4>Refund needed</h4>
                      <p>These students paid after their seat had already gone to the next person. Refund them, then tap Done.</p>
                      {refundNeeded.map((r) => (
                        <div className="org-refund-row" key={r.partusn}>
                          <span><strong>{DOMPurify.sanitize(r.studentName)}</strong> · {r.partusn} · {r.studentMobile}<br />ID: {r.transactionId} · ₹{r.amount}</span>
                          <button className="org-reject-btn" onClick={() => handleRefunded(r.partusn)}>Refunded · Done</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Organisers;