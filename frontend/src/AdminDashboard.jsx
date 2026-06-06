import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './AdminDashboard.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

// ── Admin-specific fetch — always uses adminToken, never student token ──────────
const adminFetch = (url, options = {}) => {
  const adminToken = localStorage.getItem('adminToken');
  return fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {}),
      ...options.headers,
    },
  });
};

const TABS = [
  { id: 'overview',   label: 'Overview',    icon: 'fa-chart-bar' },
  { id: 'requests',   label: 'Requests',    icon: 'fa-user-check' },
  { id: 'events',     label: 'Events',      icon: 'fa-calendar-alt' },
  { id: 'users',      label: 'Users',       icon: 'fa-users' },
  { id: 'organizers', label: 'Organisers',  icon: 'fa-crown' },
];

export default function AdminDashboard() {
  const navigate = useNavigate();

  // ── Auth state ─────────────────────────────────────────────────
  const [adminAuth, setAdminAuth]       = useState(false);
  const [authLoading, setAuthLoading]   = useState(true);
  const [adminPassword, setAdminPassword] = useState('');

  // ── Data state ─────────────────────────────────────────────────
  const [activeTab, setActiveTab]           = useState('overview');
  const [stats, setStats]                   = useState(null);
  const [requests, setRequests]             = useState([]);
  const [requestFilter, setRequestFilter]   = useState('pending');
  const [events, setEvents]                 = useState([]);
  const [users, setUsers]                   = useState([]);
  const [organizers, setOrganizers]         = useState([]);
  const [loading, setLoading]               = useState({
    overview: true, requests: true, events: true, users: true, organizers: true,
  });
  const [actionLoading, setActionLoading]   = useState({});
  const [toast, setToast]                   = useState({ show: false, message: '', isError: false });

  // ── Helpers ────────────────────────────────────────────────────
  const showToast = (message, isError = false) => {
    setToast({ show: true, message, isError });
    setTimeout(() => setToast({ show: false, message: '', isError: false }), 4000);
  };

  const setTabLoading = (tab, val) =>
    setLoading(prev => ({ ...prev, [tab]: val }));

  const fmt = (d) =>
    d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  // ── Data fetchers (all use adminFetch) ─────────────────────────
  const fetchStats = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/stats');
      if (res.ok) setStats(await res.json());
    } catch (e) { console.error(e); }
    finally { setTabLoading('overview', false); }
  }, []);

  const fetchRequests = useCallback(async (status = 'pending') => {
    setTabLoading('requests', true);
    try {
      const res = await adminFetch(`/api/admin/organizer-requests?status=${status}`);
      if (res.ok) {
        const data = await res.json();
        setRequests(data.requests || []);
      }
    } catch (e) { console.error(e); }
    finally { setTabLoading('requests', false); }
  }, []);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/events');
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch (e) { console.error(e); }
    finally { setTabLoading('events', false); }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (e) { console.error(e); }
    finally { setTabLoading('users', false); }
  }, []);

  const fetchOrganizers = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/organizers');
      if (res.ok) {
        const data = await res.json();
        setOrganizers(data.organizers || []);
      }
    } catch (e) { console.error(e); }
    finally { setTabLoading('organizers', false); }
  }, []);

  const fetchAllData = useCallback(() => {
    fetchStats();
    fetchRequests('pending');
    fetchEvents();
    fetchUsers();
    fetchOrganizers();
  }, [fetchStats, fetchRequests, fetchEvents, fetchUsers, fetchOrganizers]);

  // ── Initial Auth Check ─────────────────────────────────────────
  // Only attempt check if an adminToken already exists in storage.
  // This avoids sending a student token to /api/admin/check.
  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        const adminToken = localStorage.getItem('adminToken');
        if (!adminToken) {
          // No admin token stored — skip the network call, show password gate
          setAdminAuth(false);
          setAuthLoading(false);
          return;
        }

        const res = await adminFetch('/api/admin/check');
        if (res.ok) {
          const data = await res.json();
          if (data.isAdmin) {
            setAdminAuth(true);
            fetchAllData();
            return;
          }
        }
        // Token invalid or expired — clear it
        localStorage.removeItem('adminToken');
        setAdminAuth(false);
      } catch {
        setAdminAuth(false);
      } finally {
        setAuthLoading(false);
      }
    };

    checkAdminStatus();
  }, [fetchAllData]);

  // ── Password Login ─────────────────────────────────────────────
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        // ✅ Store under 'adminToken' — never overwrites the student 'token'
        localStorage.setItem('adminToken', data.token);
        setAdminAuth(true);
        fetchAllData();
      } else {
        showToast(data.error || 'Incorrect admin password', true);
      }
    } catch (err) {
      showToast('Network error while logging in', true);
    }
  };

  // ── Actions ────────────────────────────────────────────────────
  const handleApprove = async (id) => {
    setActionLoading(prev => ({ ...prev, [id]: 'approving' }));
    try {
      const res = await adminFetch(`/api/admin/organizer-requests/${id}/approve`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || 'Approved!');
        fetchRequests(requestFilter);
        fetchStats();
        fetchOrganizers();
      } else {
        showToast(data.error || 'Failed to approve', true);
      }
    } catch {
      showToast('Network error', true);
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: null }));
    }
  };

  const handleReject = async (id) => {
    setActionLoading(prev => ({ ...prev, [id]: 'rejecting' }));
    try {
      const res = await adminFetch(`/api/admin/organizer-requests/${id}/reject`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showToast('Request rejected');
        fetchRequests(requestFilter);
        fetchStats();
      } else {
        showToast(data.error || 'Failed to reject', true);
      }
    } catch {
      showToast('Network error', true);
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: null }));
    }
  };

  const handleDeleteEvent = async (eid, ename) => {
    if (!window.confirm(`Delete event "${ename}"? This cannot be undone.`)) return;
    setActionLoading(prev => ({ ...prev, [`event_${eid}`]: true }));
    try {
      const res = await adminFetch(`/api/admin/events/${eid}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        showToast('Event deleted');
        fetchEvents();
        fetchStats();
      } else {
        showToast(data.error || 'Failed to delete', true);
      }
    } catch {
      showToast('Network error', true);
    } finally {
      setActionLoading(prev => ({ ...prev, [`event_${eid}`]: null }));
    }
  };

  const handleRevokeOrganizer = async (usn, name) => {
    if (!window.confirm(`Revoke organizer status for ${name}?`)) return;
    setActionLoading(prev => ({ ...prev, [`org_${usn}`]: true }));
    try {
      const res = await adminFetch(`/api/admin/organizers/${usn}/revoke`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showToast('Organizer status revoked');
        fetchOrganizers();
      } else {
        showToast(data.error || 'Failed', true);
      }
    } catch {
      showToast('Network error', true);
    } finally {
      setActionLoading(prev => ({ ...prev, [`org_${usn}`]: null }));
    }
  };

  // ✅ Only removes adminToken — student 'token' is untouched
  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    navigate('/');
  };

  // ── Render guards ──────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="adm-page">
        <div className="adm-loading"><div className="adm-spinner"></div></div>
      </div>
    );
  }

  if (!adminAuth) {
    return (
      <div
        className="adm-page"
        style={{
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          height: '100vh', background: '#F5EFE0',
        }}
      >
        <div style={{
          background: '#fff', padding: '40px', border: '3px solid #0D0D0D',
          boxShadow: '8px 8px 0 #0D0D0D', maxWidth: '400px', width: '100%', textAlign: 'center',
        }}>
          <h2 style={{ fontFamily: '"Space Mono", monospace', textTransform: 'uppercase', marginBottom: '20px' }}>
            Admin Access
          </h2>

          {toast.show && (
            <div style={{
              color: toast.isError ? 'red' : 'green',
              marginBottom: '15px', fontSize: '14px', fontWeight: 'bold',
            }}>
              {toast.message}
            </div>
          )}

          <form onSubmit={handlePasswordSubmit}>
            <input
              type="password"
              placeholder="Enter admin password"
              value={adminPassword}
              onChange={e => setAdminPassword(e.target.value)}
              style={{
                width: '100%', padding: '12px', border: '2px solid #000',
                marginBottom: '20px', fontFamily: '"Space Mono", monospace',
                boxSizing: 'border-box',
              }}
            />
            <button
              type="submit"
              style={{
                width: '100%', padding: '12px', background: '#FFD600',
                color: '#000', border: '2px solid #000', fontWeight: 'bold',
                cursor: 'pointer', fontFamily: '"Space Mono", monospace',
              }}
            >
              ENTER DASHBOARD
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Tab renderers ──────────────────────────────────────────────
  const renderOverview = () => (
    <div className="adm-overview">
      <div className="adm-section-title">Platform Overview</div>
      {loading.overview
        ? <div className="adm-loading"><div className="adm-spinner"></div></div>
        : (
          <div className="adm-stats-grid">
            {[
              { label: 'Total Users',      val: stats?.totalUsers        ?? 0, color: '#FFE500' },
              { label: 'Total Events',     val: stats?.totalEvents       ?? 0, color: '#00ff9d' },
              { label: 'Participants',     val: stats?.totalParticipants ?? 0, color: '#60a5fa' },
              { label: 'Volunteers',       val: stats?.totalVolunteers   ?? 0, color: '#f472b6' },
              { label: 'Pending Requests', val: stats?.pendingRequests   ?? 0, color: '#fb923c', alert: stats?.pendingRequests > 0 },
              { label: 'Total Revenue',    val: `₹${(stats?.totalRevenue ?? 0).toLocaleString('en-IN')}`, color: '#a78bfa' },
            ].map((s, i) => (
              <div key={i} className={`adm-stat-card ${s.alert ? 'alert' : ''}`}>
                <div className="adm-stat-val" style={{ color: s.color }}>{s.val}</div>
                <div className="adm-stat-label">{s.label}</div>
                {s.alert && <div className="adm-stat-badge">ACTION NEEDED</div>}
              </div>
            ))}
          </div>
        )
      }
    </div>
  );

  const renderRequests = () => (
    <div className="adm-requests">
      <div className="adm-section-header">
        <div className="adm-section-title">Organiser Requests</div>
        <div className="adm-filter-group">
          {['pending', 'approved', 'rejected'].map(s => (
            <button
              key={s}
              className={`adm-filter-btn ${requestFilter === s ? 'active' : ''}`}
              onClick={() => { setRequestFilter(s); fetchRequests(s); }}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {loading.requests
        ? <div className="adm-loading"><div className="adm-spinner"></div></div>
        : requests.length === 0
          ? <div className="adm-empty">No {requestFilter} requests.</div>
          : (
            <div className="adm-request-list">
              {requests.map((r) => (
                <div key={r.id} className="adm-request-card">
                  <div className="adm-request-top">
                    <div className="adm-request-name">{r.sname}</div>
                    <div className="adm-request-usn">{r.usn}</div>
                  </div>
                  <div className="adm-request-grid">
                    <div className="adm-request-field">
                      <span className="adm-field-key">College Email</span>
                      <span className="adm-field-val">{r.college_email}</span>
                    </div>
                    <div className="adm-request-field">
                      <span className="adm-field-key">College</span>
                      <span className="adm-field-val">{r.college_name}</span>
                    </div>
                    <div className="adm-request-field">
                      <span className="adm-field-key">Club</span>
                      <span className="adm-field-val">{r.club_name}</span>
                    </div>
                    <div className="adm-request-field">
                      <span className="adm-field-key">Role</span>
                      <span className="adm-field-val">{r.role_in_club}</span>
                    </div>
                    <div className="adm-request-field">
                      <span className="adm-field-key">Submitted</span>
                      <span className="adm-field-val">{fmt(r.created_at)}</span>
                    </div>
                  </div>
                  {requestFilter === 'pending' && (
                    <div className="adm-request-actions">
                      <button
                        className="adm-approve-btn"
                        onClick={() => handleApprove(r.id)}
                        disabled={!!actionLoading[r.id]}
                      >
                        {actionLoading[r.id] === 'approving' && <div className="adm-btn-spinner"></div>}
                        Approve
                      </button>
                      <button
                        className="adm-reject-btn"
                        onClick={() => handleReject(r.id)}
                        disabled={!!actionLoading[r.id]}
                      >
                        {actionLoading[r.id] === 'rejecting' && <div className="adm-btn-spinner"></div>}
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
      }
    </div>
  );

  const renderEvents = () => (
    <div className="adm-events">
      <div className="adm-section-title">All Events</div>
      {loading.events
        ? <div className="adm-loading"><div className="adm-spinner"></div></div>
        : events.length === 0
          ? <div className="adm-empty">No events found.</div>
          : (
            <div className="adm-table-wrapper">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Organiser</th>
                    <th>Club</th>
                    <th>Date</th>
                    <th>Participants</th>
                    <th>Volunteers</th>
                    <th>Revenue</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(ev => (
                    <tr key={ev.eid}>
                      <td className="adm-td-name">{ev.ename}</td>
                      <td>{ev.organizer_name || ev.orgusn}</td>
                      <td>{ev.club_name || '—'}</td>
                      <td>{fmt(ev.eventdate)}</td>
                      <td className="adm-td-center">{ev.participant_count}</td>
                      <td className="adm-td-center">{ev.volunteer_count}</td>
                      <td className="adm-td-revenue">
                        {parseFloat(ev.revenue) > 0
                          ? `₹${parseFloat(ev.revenue).toLocaleString('en-IN')}`
                          : '—'}
                      </td>
                      <td>
                        <button
                          className="adm-delete-btn"
                          onClick={() => handleDeleteEvent(ev.eid, ev.ename)}
                          disabled={!!actionLoading[`event_${ev.eid}`]}
                          title="Delete event"
                        >
                          {actionLoading[`event_${ev.eid}`]
                            ? <div className="adm-btn-spinner"></div>
                            : <i className="fas fa-trash"></i>}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      }
    </div>
  );

  const renderUsers = () => (
    <div className="adm-users">
      <div className="adm-section-title">All Users</div>
      {loading.users
        ? <div className="adm-loading"><div className="adm-spinner"></div></div>
        : users.length === 0
          ? <div className="adm-empty">No users found.</div>
          : (
            <div className="adm-table-wrapper">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>USN</th>
                    <th>Email</th>
                    <th>Sem</th>
                    <th>Events</th>
                    <th>Volunteered</th>
                    <th>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.usn}>
                      <td className="adm-td-name">{u.sname}</td>
                      <td><span className="adm-usn-tag">{u.usn}</span></td>
                      <td>{u.emailid}</td>
                      <td className="adm-td-center">{u.sem}</td>
                      <td className="adm-td-center">{u.event_count}</td>
                      <td className="adm-td-center">{u.volunteer_count}</td>
                      <td>
                        {u.is_admin
                          ? <span className="adm-role-badge admin">ADMIN</span>
                          : <span className="adm-role-badge user">USER</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      }
    </div>
  );

  const renderOrganizers = () => (
    <div className="adm-organizers">
      <div className="adm-section-title">Approved Organisers</div>
      {loading.organizers
        ? <div className="adm-loading"><div className="adm-spinner"></div></div>
        : organizers.length === 0
          ? <div className="adm-empty">No approved organisers yet.</div>
          : (
            <div className="adm-request-list">
              {organizers.map(o => (
                <div key={o.usn} className="adm-request-card">
                  <div className="adm-request-top">
                    <div className="adm-request-name">{o.sname}</div>
                    <div className="adm-request-usn">{o.usn}</div>
                  </div>
                  <div className="adm-request-grid">
                    <div className="adm-request-field">
                      <span className="adm-field-key">Club</span>
                      <span className="adm-field-val">{o.club_name}</span>
                    </div>
                    <div className="adm-request-field">
                      <span className="adm-field-key">Role</span>
                      <span className="adm-field-val">{o.role_in_club}</span>
                    </div>
                    <div className="adm-request-field">
                      <span className="adm-field-key">College</span>
                      <span className="adm-field-val">{o.college_name}</span>
                    </div>
                    <div className="adm-request-field">
                      <span className="adm-field-key">Events Organised</span>
                      <span className="adm-field-val">{o.events_organized}</span>
                    </div>
                    <div className="adm-request-field">
                      <span className="adm-field-key">Email</span>
                      <span className="adm-field-val">{o.emailid}</span>
                    </div>
                  </div>
                  <div className="adm-request-actions">
                    <button
                      className="adm-reject-btn"
                      onClick={() => handleRevokeOrganizer(o.usn, o.sname)}
                      disabled={!!actionLoading[`org_${o.usn}`]}
                    >
                      {actionLoading[`org_${o.usn}`] && <div className="adm-btn-spinner"></div>}
                      Revoke Organiser
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
      }
    </div>
  );

  // ── Main dashboard render ──────────────────────────────────────
  return (
    <div className="adm-page">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css" />

      {toast.show && (
        <div className={`adm-toast ${toast.isError ? 'error' : 'success'}`}>
          <span>{toast.isError ? '✕' : '✓'}</span>
          {toast.message}
        </div>
      )}

      {/* Sidebar */}
      <aside className="adm-sidebar">
        <div className="adm-sidebar-logo">
          <span className="adm-logo-flo">FLO●</span>
          <span className="adm-logo-tag">ADMIN</span>
        </div>

        <nav className="adm-nav">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`adm-nav-btn ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              <i className={`fas ${t.icon}`}></i>
              <span>{t.label}</span>
              {t.id === 'requests' && stats?.pendingRequests > 0 && (
                <span className="adm-nav-badge">{stats.pendingRequests}</span>
              )}
            </button>
          ))}
        </nav>

        <button className="adm-logout-btn" onClick={handleLogout}>
          <i className="fas fa-sign-out-alt"></i> Logout
        </button>
      </aside>

      {/* Main content */}
      <main className="adm-main">
        <div className="adm-main-header">
          <div className="adm-breadcrumb">
            <span className="adm-breadcrumb-root">Admin</span>
            <span className="adm-breadcrumb-sep">→</span>
            <span className="adm-breadcrumb-cur">{TABS.find(t => t.id === activeTab)?.label}</span>
          </div>
        </div>

        <div className="adm-content">
          {activeTab === 'overview'   && renderOverview()}
          {activeTab === 'requests'   && renderRequests()}
          {activeTab === 'events'     && renderEvents()}
          {activeTab === 'users'      && renderUsers()}
          {activeTab === 'organizers' && renderOrganizers()}
        </div>
      </main>
    </div>
  );
}
