import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './ticket.css';

export default function OrganizerTicket() {
  const [eventData, setEventData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userUSN, setUserUSN] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const eventId = urlParams.get('eventId');

    if (!eventId) {
      setError('No event ID provided in the URL');
      setLoading(false);
      return;
    }

    fetchEventData(eventId);
  }, []);

  const fetchUserData = async () => {
    try {
      const response = await fetch('/api/me', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to fetch user data`);
      }
      const data = await response.json();
      return data.userUSN;
    } catch (error) {
      console.error('Error fetching user data:', error);
      return null;
    }
  };

  const fetchEventData = async (eventId) => {
    try {
      const usn = await fetchUserData();
      if (!usn) {
        setError('User not authenticated. Please sign in.');
        setLoading(false);
        return;
      }
      setUserUSN(usn);

      const response = await fetch(`/api/events/${eventId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.eid) {
        if (!data.isRegistered) {
          setError('You are not registered for this event. Please join the event first.');
          setLoading(false);
          return;
        }
        setEventData(data);
        setLoading(false);
      } else {
        throw new Error('Invalid event data');
      }
    } catch (err) {
      console.error('Error fetching event:', err);
      setError(`Could not load event details. Event ID may not exist or another error occurred.`);
      setLoading(false);
    }
  };

  const handleBack = () => {
    window.location.href = '/organisers.html';
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Not specified';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatTime = (timeString) => {
    if (!timeString) return 'Not specified';
    const timeParts = timeString.split(':');
    let hours = parseInt(timeParts[0]);
    const minutes = timeParts[1];
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes} ${ampm}`;
  };

  return (
    <div className="ticket-page-wrapper">
      <div className="tk-background-glow"></div>

      <div className="tk-nav-container">
        <button onClick={handleBack} className="tk-nav-btn">
          <i className="fas fa-arrow-left"></i>
          Back
        </button>
      </div>

      <div className="tk-ticket-container">
        {loading && (
          <div className="tk-loading-spinner">
            <div className="tk-spinner"></div>
          </div>
        )}

        {error && (
          <div className="tk-error-message">
            <h3>Error Loading Event</h3>
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && eventData && (
          <div className="tk-ticket-card">
            <div className="tk-ticket-header">
              <h1 className="tk-event-title">{eventData.ename || 'Untitled Event'}</h1>
              <p className="tk-event-id">Event ID: {eventData.eid}</p>
            </div>

            <div className="tk-ticket-content">
              <div className="tk-info-section">
                <div className="tk-info-icon">📅</div>
                <div className="tk-info-content">
                  <h3>Date</h3>
                  <p>{formatDate(eventData.eventDate)}</p>
                </div>
              </div>

              <div className="tk-info-section">
                <div className="tk-info-icon">⏰</div>
                <div className="tk-info-content">
                  <h3>Time</h3>
                  <p>{formatTime(eventData.eventTime)}</p>
                </div>
              </div>

              <div className="tk-info-section">
                <div className="tk-info-icon">📍</div>
                <div className="tk-info-content">
                  <h3>Location</h3>
                  <p>{eventData.eventLoc || 'Location TBD'}</p>
                </div>
              </div>

              <div className="tk-info-section">
                <div className="tk-info-icon">👥</div>
                <div className="tk-info-content">
                  <h3>Max Participants</h3>
                  <p>{eventData.maxPart || 'No limit'}</p>
                </div>
              </div>

              <div className="tk-info-section">
                <div className="tk-info-icon">🤝</div>
                <div className="tk-info-content">
                  <h3>Max Volunteers</h3>
                  <p>{eventData.maxVoln || 'No limit'}</p>
                </div>
              </div>

              <div className="tk-info-section">
                <div className="tk-info-icon">💰</div>
                <div className="tk-info-content">
                  <h3>Registration Fee</h3>
                  <p>₹{eventData.regFee || '0'}</p>
                </div>
              </div>

              {eventData.clubName && (
                <div className="tk-info-section">
                  <div className="tk-info-icon">🏛️</div>
                  <div className="tk-info-content">
                    <h3>Organized by</h3>
                    <p>{eventData.clubName}</p>
                  </div>
                </div>
              )}

              <div className="tk-description-section">
                <h3>Event Description</h3>
                <p>{eventData.eventdesc || 'No description available'}</p>
              </div>
            </div>

            <div className="tk-ticket-footer">
              <button 
                onClick={() => navigate(`/qr?eventId=${eventData.eid}&usn=${userUSN}`)}
                className="tk-qr-placeholder"
                title="View QR Code"
              >
                QR
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}