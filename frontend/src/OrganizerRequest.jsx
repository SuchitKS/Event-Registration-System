import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from './api.js';
import './OrganizerRequest.css';

export default function OrganizerRequest() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    college_email: '',
    college_name: '',
    club_name: '',
    role_in_club: '',
  });
  
  const [existingRequest, setExistingRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', isError: false });
  
  // New state for clubs dropdown
  const [clubs, setClubs] = useState([]);
  const [clubSelection, setClubSelection] = useState('');

  useEffect(() => {
    fetchStatus();
    fetchClubs();
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await apiFetch('/api/organizer-request/status');
      if (res.ok) {
        const data = await res.json();
        setExistingRequest(data.request);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch available clubs from the database
  const fetchClubs = async () => {
    try {
      const res = await apiFetch('/api/clubs');
      if (res.ok) {
        const data = await res.json();
        setClubs(data.clubs || []);
      }
    } catch (err) {
      console.error("Failed to load clubs", err);
    }
  };

  const showToast = (message, isError = false) => {
    setToast({ show: true, message, isError });
    setTimeout(() => setToast({ show: false, message: '', isError: false }), 4000);
  };

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  // Handle the dropdown selection specifically
  const handleClubSelect = (e) => {
    const val = e.target.value;
    setClubSelection(val);
    
    if (val !== 'OTHER') {
      // If they picked an existing club, update formData
      setFormData(prev => ({ ...prev, club_name: val }));
    } else {
      // If they picked OTHER, clear it so they can type
      setFormData(prev => ({ ...prev, club_name: '' }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/organizer-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || 'Request submitted!');
        fetchStatus();
      } else {
        showToast(data.error || 'Submission failed', true);
      }
    } catch (err) {
      showToast('Network error. Please try again.', true);
    } finally {
      setSubmitting(false);
    }
  };

  const statusConfig = {
    pending: { label: 'PENDING REVIEW', color: '#FFE500', bg: '#1a1a00', icon: '⏳' },
    approved: { label: 'APPROVED', color: '#00ff9d', bg: '#001a0d', icon: '✓' },
    rejected: { label: 'REJECTED', color: '#ff4444', bg: '#1a0000', icon: '✕' },
  };

  return (
    <div className="org-req-page">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css" />

      {toast.show && (
        <div className={`org-req-toast ${toast.isError ? 'error' : 'success'}`}>
          <span>{toast.isError ? '✕' : '✓'}</span>
          {toast.message}
        </div>
      )}

      <div className="org-req-nav">
        <button className="org-req-back-btn" onClick={() => navigate('/events')}>
          <i className="fas fa-arrow-left"></i> Back
        </button>
      </div>

      <div className="org-req-container">

        {/* Header */}
        <div className="org-req-header">
          <div className="org-req-header-tag">ORGANIZER ACCESS</div>
          <h1 className="org-req-title">Become an<br />Organiser</h1>
          <div className="org-req-header-line"></div>
          <p className="org-req-subtitle">
            Fill in your details below. Our team will review your request
            and grant you organizer access to create events on Flo.
          </p>
        </div>

        {loading ? (
          <div className="org-req-loading">
            <div className="org-req-spinner"></div>
            <span>Loading...</span>
          </div>
        ) : existingRequest && existingRequest.status !== 'rejected' ? (
          /* Status Card */
          <div className="org-req-status-card" style={{
            borderColor: statusConfig[existingRequest.status]?.color,
            background: statusConfig[existingRequest.status]?.bg,
          }}>
            <div className="org-req-status-icon" style={{ color: statusConfig[existingRequest.status]?.color }}>
              {statusConfig[existingRequest.status]?.icon}
            </div>
            <div className="org-req-status-label" style={{ color: statusConfig[existingRequest.status]?.color }}>
              {statusConfig[existingRequest.status]?.label}
            </div>

            <div className="org-req-status-details">
              <div className="org-req-detail-row">
                <span className="org-req-detail-key">Club</span>
                <span className="org-req-detail-val">{existingRequest.club_name}</span>
              </div>
              <div className="org-req-detail-row">
                <span className="org-req-detail-key">Role</span>
                <span className="org-req-detail-val">{existingRequest.role_in_club}</span>
              </div>
              <div className="org-req-detail-row">
                <span className="org-req-detail-key">College</span>
                <span className="org-req-detail-val">{existingRequest.college_name}</span>
              </div>
            </div>

            {existingRequest.status === 'pending' && (
              <p className="org-req-status-note">
                Your request is under review. You will be able to create events once approved.
              </p>
            )}
            {existingRequest.status === 'approved' && (
              <p className="org-req-status-note" style={{ color: '#00ff9d' }}>
                You are an approved organizer. Head to the Events page to create your first event.
              </p>
            )}
          </div>
        ) : (
          /* Application Form */
          <form className="org-req-form" onSubmit={handleSubmit}>
            {existingRequest?.status === 'rejected' && (
              <div className="org-req-rejected-notice">
                <span>✕</span> Your previous request was rejected. You may resubmit below.
                {existingRequest.reject_reason && (
                  <div style={{ marginTop: 6, textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>
                    Reason: {existingRequest.reject_reason}
                  </div>
                )}
              </div>
            )}

            <div className="org-req-field">
              <label className="org-req-label">Full Name</label>
              <div className="org-req-input-static">
                Pulled from your account automatically
              </div>
            </div>

            <div className="org-req-field">
              <label className="org-req-label">USN</label>
              <div className="org-req-input-static">
                Pulled from your account automatically
              </div>
            </div>

            <div className="org-req-field">
              <label className="org-req-label">College Email *</label>
              <input
                className="org-req-input"
                type="email"
                name="college_email"
                placeholder="yourname@college.edu.in"
                value={formData.college_email}
                onChange={handleChange}
                required
              />
              <span className="org-req-helper">Use your official institutional email address.</span>
            </div>

            <div className="org-req-field">
              <label className="org-req-label">College Name *</label>
              <input
                className="org-req-input"
                type="text"
                name="college_name"
                maxLength={255}
                placeholder="e.g. BMS College of Engineering"
                value={formData.college_name}
                onChange={handleChange}
                required
              />
            </div>

            <div className="org-req-field">
              <label className="org-req-label">Club Name *</label>
              <select
                className="org-req-input"
                value={clubSelection}
                onChange={handleClubSelect}
                required
                style={{ cursor: 'pointer' }}
              >
                <option value="">— Select an existing club —</option>
                {clubs.map(club => (
                  <option key={club.cid} value={club.cname}>
                    {club.cname}
                  </option>
                ))}
                <option value="OTHER">Other (Enter your club name)</option>
              </select>

              {/* Conditional Input for Custom Club Name */}
              {clubSelection === 'OTHER' && (
                <input
                  className="org-req-input"
                  style={{ marginTop: '8px' }}
                  type="text"
                  name="club_name"
                  maxLength={50}
                  placeholder="Type your club name here"
                  value={formData.club_name}
                  onChange={handleChange}
                  required
                />
              )}
            </div>

            <div className="org-req-field">
              <label className="org-req-label">Your Role in the Club *</label>
              <input
                className="org-req-input"
                type="text"
                name="role_in_club"
                maxLength={100}
                placeholder="e.g. President, Event Coordinator, Secretary"
                value={formData.role_in_club}
                onChange={handleChange}
                required
              />
            </div>

            <button className="org-req-submit-btn" type="submit" disabled={submitting}>
              {submitting ? (
                <><div className="org-req-btn-spinner"></div> Submitting...</>
              ) : (
                <>Submit Request <i className="fas fa-arrow-right"></i></>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
