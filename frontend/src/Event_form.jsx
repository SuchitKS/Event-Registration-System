import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import CertificateEditor from './CertificateEditor.jsx';
import CertificateCanvas from './CertificateCanvas.jsx';
import { TEMPLATES, SAMPLE_STUDENTS, defaultLayout, normalizeLayout, buildCertData } from './certificateLib.js';
import './event_form.css';
import { apiFetch } from './api.js';

const EventForm = () => {
  const navigate = useNavigate();

  // Certificate options
  const [certEnabled, setCertEnabled] = useState(false);
  const [certTemplate, setCertTemplate] = useState('teal');
  const [certLayout, setCertLayout] = useState(null); // null = template default
  const [showCertEditor, setShowCertEditor] = useState(false);
  const [volCert, setVolCert] = useState({ mode: 'same', template: null, layout: null });

  const [formData, setFormData] = useState({
    eventName: '',
    eventDescription: '',
    certificateInfo: '',
    posterUrl: '',
    eventDate: '',
    eventTime: '',
    eventLocation: '',
    maxParticipants: '',
    maxVolunteers: '',
    OrgCid: '',
    registrationFee: '',
    upiId: '',
    isTeamEvent: false,
    minTeamSize: '',
    maxTeamSize: '',
    maxActivityPts: '',
    volActivityPts: '',
    minPartScans: '',
    minVolnScans: '',
    whatsappLink: '',
    contactPhone: '',
    contactName: '',
  });

  const [bannerFile, setBannerFile]       = useState(null);
  const [message, setMessage]             = useState({ text: '', isError: false, show: false });
  const [isSubmitting, setIsSubmitting]   = useState(false);
  const [myClubs, setMyClubs]             = useState([]);
  const [isLoadingClubs, setIsLoadingClubs] = useState(true);
  const [activeSection, setActiveSection] = useState(1);

  /* ── prefill the participants' contact number from the organiser's profile ── */
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/me');
        if (res.ok) {
          const me = await res.json();
          const m = String(me.mobile || '').replace(/\D/g, '').slice(-10);
          if (m) setFormData((f) => (f.contactPhone ? f : { ...f, contactPhone: m }));
        }
      } catch (_) { /* optional */ }
    })();
  }, []);

  /* ── fetch organiser's clubs ── */
  useEffect(() => {
    const fetchMyClubs = async () => {
      try {
        const res = await apiFetch('/api/my-clubs');
        if (res.ok) {
          const data = await res.json();
          setMyClubs(data.clubs || []);
        } else if (res.status === 401) {
          navigate('/');
        }
      } catch (err) {
        console.error('Failed to load memberships', err);
      } finally {
        setIsLoadingClubs(false);
      }
    };
    fetchMyClubs();
  }, [navigate]);

  /* ── scroll spy — highlight sidebar dot ── */
  useEffect(() => {
    const sections = document.querySelectorAll('.event-form-section[data-section]');
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            setActiveSection(Number(entry.target.dataset.section));
          }
        });
      },
      { threshold: 0.4 }
    );
    sections.forEach(s => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  const showMessage = (text, isError = false) => {
    setMessage({ text, isError, show: true });
    setTimeout(() => setMessage({ text: '', isError: false, show: false }), 5000);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 5 * 1024 * 1024) {
        showMessage('Banner image is too large (Max 5MB).', true);
        e.target.value = null;
        setBannerFile(null);
        return;
      }
      setBannerFile(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);

    if (!formData.eventName || !formData.eventDate || !formData.OrgCid) {
      showMessage('Please fill in all required fields, including the Organizing Club.', true);
      setIsSubmitting(false);
      return;
    }

    const wa = formData.whatsappLink.trim();
    if (wa && !wa.startsWith('https://chat.whatsapp.com/')) {
      showMessage('WhatsApp link must start with https://chat.whatsapp.com/', true);
      setIsSubmitting(false);
      return;
    }

    const phone = String(formData.contactPhone || '').replace(/\D/g, '');
    if (!/^\d{10}$/.test(phone)) {
      showMessage('Please enter a valid 10-digit contact number for participants (Communication section).', true);
      setIsSubmitting(false);
      return;
    }

    const submissionData = new FormData();
    submissionData.append('contactPhone', phone);
    submissionData.append('contactName', (formData.contactName || '').trim());
    submissionData.append('eventName',        formData.eventName);
    submissionData.append('eventDescription', formData.eventDescription);
    submissionData.append('certificate_info', formData.certificateInfo || '');
    submissionData.append('posterUrl',        formData.posterUrl || '');
    submissionData.append('certificate_enabled',  certEnabled ? 'true' : 'false');
    if (certEnabled) {
      submissionData.append('certificate_template', certTemplate);
      submissionData.append('certificate_layout',   JSON.stringify(certLayout || defaultLayout(certTemplate)));
      submissionData.append('volunteer_certificate_mode', volCert.mode);
      if (volCert.mode === 'separate' && volCert.layout) {
        submissionData.append('volunteer_certificate_template', volCert.template || certTemplate);
        submissionData.append('volunteer_certificate_layout',   JSON.stringify(volCert.layout));
      }
    }
    submissionData.append('eventDate',        formData.eventDate);
    submissionData.append('eventTime',        formData.eventTime);
    submissionData.append('eventLocation',    formData.eventLocation);
    submissionData.append('maxParticipants',  formData.maxParticipants || '');
    submissionData.append('maxVolunteers',    formData.maxVolunteers || '');
    submissionData.append('OrgCid',           formData.OrgCid);
    submissionData.append('registrationFee',  formData.registrationFee || '0');
    submissionData.append('upiId',            formData.upiId || '');
    submissionData.append('isTeamEvent',      formData.isTeamEvent);
    submissionData.append('minTeamSize',      formData.minTeamSize || '');
    submissionData.append('maxTeamSize',      formData.maxTeamSize || '');
    submissionData.append('activityPoints',   formData.maxActivityPts || '0');
    submissionData.append('maxActivityPts',   formData.maxActivityPts || '0');
    submissionData.append('volActivityPts',   formData.volActivityPts || '0');
    submissionData.append('minPartScans',     formData.minPartScans || '1');
    submissionData.append('minVolnScans',     formData.minVolnScans || '1');
    submissionData.append('whatsappLink',     wa);

    if (bannerFile) submissionData.append('banner', bannerFile);

    try {
      const res = await apiFetch('/api/events/create', {
        method: 'POST',
        body: submissionData,
      });
      const result = await res.json();
      if (res.ok) {
        showMessage('Event published successfully!');
        setTimeout(() => navigate('/organisers'), 2000);
      } else {
        if (res.status === 401) {
          showMessage('Session expired. Please login again.', true);
          setTimeout(() => navigate('/'), 2000);
        } else if (res.status === 403) {
          showMessage('You are not authorized to organize events for this club.', true);
          setIsSubmitting(false);
        } else {
          showMessage(result.error || 'Failed to create event', true);
          setIsSubmitting(false);
        }
      }
    } catch (err) {
      showMessage(`Network Error: ${err.message}`, true);
      setIsSubmitting(false);
    }
  };

  const hasFee = parseFloat(formData.registrationFee) > 0;

  return (
    <div className="event-form-container">
      {/* TOAST */}
      {message.show && (
        <div className={`event-form-message ${message.isError ? 'event-form-message-error' : 'event-form-message-success'}`}>
          {message.text}
        </div>
      )}

      <div className="event-form-wrap">

        {/* ── SIDEBAR ── */}
        <aside className="event-form-left">
          {[1,2,3,4,5,6].map(n => (
            <div key={n} className={`form-step-dot${activeSection === n ? ' active' : ''}`}>
              {String(n).padStart(2,'0')}
            </div>
          ))}
          <div className="event-form-logo-text">Hey Organisers</div>
        </aside>

        {/* ── MOBILE HEADER ── */}
        <div className="event-form-mobile-header">
          <span className="event-form-neon">Hey</span>
          <span className="event-form-neon event-form-neon-alt">Organisers</span>
        </div>

        {/* ── BACK BUTTON ── */}
        <button className="back-button-top" onClick={() => navigate(-1)} type="button">
          ← Back
        </button>

        {/* ── MAIN FORM ── */}
        <div className="event-form-right">
          <div className="form-header">
            <h2 className="event-form-title">Create <span>Event</span></h2>
            <p className="form-subtitle">Fill in the details to launch your new event.</p>
          </div>

          <form onSubmit={handleSubmit}>

            {/* ════════════════════════════════
                SECTION 1 — EVENT BASICS
            ════════════════════════════════ */}
            <div className="event-form-section" data-section="1">
              <div className="section-label">
                <span className="section-label-num n1">01</span>
                <span className="section-label-text">Event Basics</span>
              </div>
              <div className="section-body">

                <div className="input-group">
                  <label className="input-label">
                    Event Name <span className="req">*</span>
                  </label>
                  <input
                    className="modern-input"
                    type="text"
                    name="eventName"
                    placeholder="e.g. Annual Tech Hackathon"
                    value={formData.eventName}
                    onChange={handleChange}
                    required
                  />
                </div>

                <div className="input-group">
                  <label className="input-label">
                    Description <span className="req">*</span>
                  </label>
                  <textarea
                    className="modern-textarea"
                    name="eventDescription"
                    placeholder="What is this event about? Give participants a clear idea of what to expect."
                    value={formData.eventDescription}
                    onChange={handleChange}
                    rows="3"
                    required
                  />
                </div>

                <div className="form-grid-2">
                  <div className="input-group">
                    <label className="input-label">
                      Banner Image <span>(Optional)</span>
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      className="modern-input"
                      style={{ padding: '10px 14px', cursor: 'pointer' }}
                    />
                    <p className="helper-text">Max 5 MB · JPEG / PNG</p>
                    {bannerFile && (
                      <p className="file-name-preview">✓ {bannerFile.name}</p>
                    )}
                  </div>

                  <div className="input-group">
                    <label className="input-label">
                      Brochure Link <span>(Google Drive, Optional)</span>
                    </label>
                    <input
                      className="modern-input"
                      type="url"
                      name="posterUrl"
                      placeholder="https://drive.google.com/..."
                      value={formData.posterUrl}
                      onChange={handleChange}
                    />
                    <p className="helper-text">Set sharing to "Anyone with the link"</p>
                  </div>
                </div>

              </div>
            </div>

            {/* ════════════════════════════════
                SECTION 2 — SCHEDULE & LOCATION
            ════════════════════════════════ */}
            <div className="event-form-section" data-section="2">
              <div className="section-label">
                <span className="section-label-num n2">02</span>
                <span className="section-label-text">Schedule &amp; Location</span>
              </div>
              <div className="section-body">

                <div className="form-grid-2">
                  <div className="input-group">
                    <label className="input-label">
                      Date <span className="req">*</span>
                    </label>
                    <input
                      className="modern-input"
                      type="date"
                      name="eventDate"
                      value={formData.eventDate}
                      onChange={handleChange}
                      required
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label">
                      Time <span className="req">*</span>
                    </label>
                    <input
                      className="modern-input"
                      type="time"
                      name="eventTime"
                      value={formData.eventTime}
                      onChange={handleChange}
                      required
                    />
                  </div>
                </div>

                <div className="input-group">
                  <label className="input-label">
                    Venue / Location <span className="req">*</span>
                  </label>
                  <input
                    className="modern-input"
                    type="text"
                    name="eventLocation"
                    placeholder="e.g. Auditorium A, Main Block"
                    value={formData.eventLocation}
                    onChange={handleChange}
                    required
                  />
                </div>

              </div>
            </div>

            {/* ════════════════════════════════
                SECTION 3 — PARTICIPATION
            ════════════════════════════════ */}
            <div className="event-form-section" data-section="3">
              <div className="section-label">
                <span className="section-label-num n3">03</span>
                <span className="section-label-text">Participation</span>
              </div>
              <div className="section-body">

                <div className="checkbox-group">
                  <label className="custom-checkbox-label">
                    <input
                      type="checkbox"
                      name="isTeamEvent"
                      checked={formData.isTeamEvent}
                      onChange={handleChange}
                    />
                    Is this a Team Event?
                  </label>
                </div>

                <div className={`conditional-fields ${formData.isTeamEvent ? 'open' : ''}`}>
                  <div className="conditional-inner">
                    <div className="form-grid-2">
                      <div className="input-group">
                        <label className="input-label">Min Team Size</label>
                        <input
                          className="modern-input"
                          type="number"
                          name="minTeamSize"
                          placeholder="2"
                          value={formData.minTeamSize}
                          onChange={handleChange}
                          min="2"
                        />
                      </div>
                      <div className="input-group">
                        <label className="input-label">Max Team Size</label>
                        <input
                          className="modern-input"
                          type="number"
                          name="maxTeamSize"
                          placeholder="5"
                          value={formData.maxTeamSize}
                          onChange={handleChange}
                          min="2"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="form-grid-2">
                  <div className="input-group">
                    <label className="input-label">
                      {formData.isTeamEvent ? 'Max Teams' : 'Max Participants'}
                    </label>
                    <input
                      className="modern-input"
                      type="number"
                      name="maxParticipants"
                      placeholder="0 = Unlimited"
                      value={formData.maxParticipants}
                      onChange={handleChange}
                      min="1"
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label">Volunteers Needed</label>
                    <input
                      className="modern-input"
                      type="number"
                      name="maxVolunteers"
                      placeholder="0"
                      value={formData.maxVolunteers}
                      onChange={handleChange}
                      min="1"
                    />
                  </div>
                </div>

              </div>
            </div>

            {/* ════════════════════════════════
                SECTION 4 — PAYMENTS & CLUB
            ════════════════════════════════ */}
            <div className="event-form-section" data-section="4">
              <div className="section-label">
                <span className="section-label-num n4">04</span>
                <span className="section-label-text">Payments &amp; Organising Club</span>
              </div>
              <div className="section-body">

                <div className="form-grid-2">
                  <div className="input-group">
                    <label className="input-label">
                      Organizing Club <span className="req">*</span>
                    </label>
                    {isLoadingClubs ? (
                      <div className="modern-input" style={{ display:'flex', alignItems:'center', color:'#888', fontStyle:'italic' }}>
                        Fetching your clubs…
                      </div>
                    ) : myClubs.length > 0 ? (
                      <select
                        className="modern-input"
                        name="OrgCid"
                        value={formData.OrgCid}
                        onChange={handleChange}
                        required
                      >
                        <option value="">— Select Your Club —</option>
                        {myClubs.map((club) => (
                          <option key={club.cid} value={club.cid}>
                            {club.cname || `Club ID: ${club.cid}`}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="modern-input" style={{ border:'2px solid var(--coral)', color:'var(--coral)', fontSize:'13px' }}>
                        ⚠️ You are not a member of any club.
                      </div>
                    )}
                  </div>

                  <div className="input-group">
                    <label className="input-label">
                      Registration Fee (₹) <span className="req">*</span>
                    </label>
                    <input
                      className="modern-input"
                      type="number"
                      name="registrationFee"
                      placeholder="0 for free events"
                      value={formData.registrationFee}
                      onChange={handleChange}
                      step="0.01"
                      min="0"
                      required
                    />
                  </div>
                </div>

                <div className={`conditional-fields ${hasFee ? 'open' : ''}`}>
                  <div className="conditional-inner">
                    <div className="input-group">
                      <label className="input-label">UPI ID for Payment</label>
                      <input
                        className="modern-input"
                        type="text"
                        name="upiId"
                        placeholder="merchant@upi"
                        value={formData.upiId}
                        onChange={handleChange}
                      />
                    </div>
                  </div>
                </div>

              </div>
            </div>

            {/* ════════════════════════════════
                SECTION 5 — EXTRAS
            ════════════════════════════════ */}
            <div className="event-form-section" data-section="5">
              <div className="section-label">
                <span className="section-label-num n5">05</span>
                <span className="section-label-text">Extras &amp; Activity Points</span>
              </div>
              <div className="section-body">

                <div className="cert-opt">
                  <label className="ce-chk">
                    <input type="checkbox" checked={certEnabled} onChange={(e) => setCertEnabled(e.target.checked)} />
                    Provide a certificate for this event
                  </label>
                  {certEnabled && (
                    <div className="cert-row">
                      <div className="cert-th">
                        <CertificateCanvas
                          template={certTemplate}
                          layout={normalizeLayout(certTemplate, certLayout)}
                          data={buildCertData({ ...SAMPLE_STUDENTS[0], event: formData.eventName || 'Event name', date: formData.eventDate, points: formData.maxActivityPts || 5, customText: formData.certificateInfo })}
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <h4>Certificate ready</h4>
                        <p>{certLayout ? 'Customised layout.' : 'Default layout.'} Set it up to change the template, text and signatures.</p>
                      </div>
                      <button type="button" className="ce-btn b" onClick={() => setShowCertEditor(true)}>Set up certificate →</button>
                    </div>
                  )}
                </div>
                {showCertEditor && createPortal(
                  <CertificateEditor
                    template={certTemplate}
                    layout={certLayout}
                    customText={formData.certificateInfo}
                    eventName={formData.eventName}
                    eventDate={formData.eventDate}
                    points={formData.maxActivityPts || 5}
                    volPoints={formData.volActivityPts || 5}
                    volunteerMode={volCert.mode}
                    volunteerTemplate={volCert.template}
                    volunteerLayout={volCert.layout}
                    backLabel="Back to form"
                    saveLabel="Save & return"
                    onSave={({ template, layout, customText, volunteerMode, volunteerTemplate, volunteerLayout }) => {
                      setCertTemplate(template); setCertLayout(layout);
                      setVolCert({ mode: volunteerMode, template: volunteerTemplate, layout: volunteerLayout });
                      setFormData((f) => ({ ...f, certificateInfo: customText }));
                      setShowCertEditor(false);
                    }}
                    onClose={() => setShowCertEditor(false)}
                  />,
                  document.body
                )}

                <div className="event-form-info-note">
                  <span className="event-form-info-icon">📋</span>
                  <span>
                    <strong>Flo Attendance Certificate:</strong> If attendance is marked via QR scan,
                    students will automatically receive a Flo-verified attendance certificate
                    downloadable from their dashboard.
                  </span>
                </div>

                <div className="form-grid-2">
                  <div className="input-group">
                    <label className="input-label">
                      Max Activity Pts — Participants <span>(Optional)</span>
                    </label>
                    <input
                      className="modern-input"
                      type="number"
                      name="maxActivityPts"
                      placeholder="0 = No points"
                      value={formData.maxActivityPts}
                      onChange={handleChange}
                      min="0"
                    />
                    <p className="helper-text">Max points earned by attending sub-events.</p>
                  </div>

                  <div className="input-group">
                    <label className="input-label">
                      Activity Pts — Volunteers <span>(Optional)</span>
                    </label>
                    <input
                      className="modern-input"
                      type="number"
                      name="volActivityPts"
                      placeholder="0 = No points"
                      value={formData.volActivityPts}
                      onChange={handleChange}
                      min="0"
                    />
                    <p className="helper-text">Fixed points awarded to volunteers on completion.</p>
                  </div>
                </div>

                <div className="form-grid-2">
                  <div className="input-group">
                    <label className="input-label">Min. Sub-event Scans — Participant Attendance</label>
                    <input
                      className="modern-input"
                      type="number"
                      name="minPartScans"
                      placeholder="1"
                      value={formData.minPartScans}
                      onChange={handleChange}
                      min="1"
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label">Min. Sub-event Scans — Volunteer Attendance</label>
                    <input
                      className="modern-input"
                      type="number"
                      name="minVolnScans"
                      placeholder="1"
                      value={formData.minVolnScans}
                      onChange={handleChange}
                      min="1"
                    />
                  </div>
                </div>
                <p className="helper-text">Set to 1 if a single QR scan should grant attendance.</p>

              </div>
            </div>

            {/* ════════════════════════════════
                SECTION 6 — COMMUNICATION
            ════════════════════════════════ */}
            <div className="event-form-section" data-section="6">
              <div className="section-label">
                <span className="section-label-num n6">06</span>
                <span className="section-label-text">Communication</span>
              </div>
              <div className="section-body">

                <div className="input-group">
                  <label className="input-label">
                    Contact number for participants <span style={{ color: '#d62020' }}>*</span>
                  </label>
                  <input
                    className="modern-input"
                    type="tel"
                    name="contactPhone"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="10-digit mobile number"
                    value={formData.contactPhone}
                    onChange={handleChange}
                    required
                  />
                  <p className="helper-text">
                    Shown to students on the event page, in the queue and on payment screens, so they can call you with doubts.
                  </p>
                </div>

                <div className="input-group">
                  <label className="input-label">
                    Contact person name <span>(Optional)</span>
                  </label>
                  <input
                    className="modern-input"
                    type="text"
                    name="contactName"
                    maxLength={60}
                    placeholder="e.g. Rahul (Treasurer)"
                    value={formData.contactName}
                    onChange={handleChange}
                  />
                </div>

                <div className="input-group">
                  <label className="input-label">
                    WhatsApp Group Link <span>(Optional)</span>
                  </label>
                  <input
                    className="modern-input"
                    type="url"
                    name="whatsappLink"
                    placeholder="https://chat.whatsapp.com/..."
                    value={formData.whatsappLink}
                    onChange={handleChange}
                  />
                  <p className="helper-text">
                    Students will see a "Join WhatsApp Group" button after registering and on their ticket.
                    Leave blank if not applicable.
                  </p>
                </div>

              </div>
            </div>

            {/* ── SUBMIT ── */}
            <div className="submit-btn-container">
              <button
                className="event-form-button"
                type="submit"
                disabled={isSubmitting || (myClubs.length === 0 && !isLoadingClubs)}
              >
                {isSubmitting ? (
                  <><div className="org-req-btn-spinner"></div> Submitting...</>
                ) : (
                  <>Publish Event →</>
                )}
              </button>
            </div>

          </form>
        </div>{/* /event-form-right */}
      </div>{/* /event-form-wrap */}
    </div>
  );
};

export default EventForm;
