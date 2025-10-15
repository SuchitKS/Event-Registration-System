import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './volunteer_events.css';

export default function VolunteerEvents() {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [message, setMessage] = useState({ text: '', isError: false });

  // Format date helper
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  // Format time helper
  const formatTime = (timeString) => {
    if (!timeString) return 'N/A';
    const timeParts = timeString.split(':');
    let hours = parseInt(timeParts[0]);
    const minutes = timeParts[1];
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes} ${ampm}`;
  };

  // Show message
  const showMessage = (text, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage({ text: '', isError: false }), 5000);
  };

  // Fetch events
  const fetchEvents = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/events', {
        method: 'GET',
        credentials: 'include', // CRITICAL: Send cookies with request
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        if (response.status === 401) {
          showMessage('Please sign in to view events.', true);
          setTimeout(() => {
            navigate('/');
          }, 2000);
          return;
        }
        throw new Error('Network response was not ok');
      }

      const data = await response.json();
      const allEvents = [
        ...data.events.ongoing,
        ...data.events.upcoming
      ];

      // Fetch volunteer counts for each event
      const eventsWithCounts = await Promise.all(
        allEvents.map(async (event) => {
          const countResponse = await fetch(`http://localhost:3000/api/events/${event.eid}/volunteer-count`, {
            credentials: 'include', // CRITICAL: Send cookies
            headers: { 'Content-Type': 'application/json' }
          });
          const countData = await countResponse.json();
          return { ...event, volunteerCount: countData.count };
        })
      );

      setEvents(eventsWithCounts);
    } catch (error) {
      console.error('Error fetching events:', error);
      showMessage('Could not load events.', true);
    }
  };

  // Handle volunteer action
  const handleVolunteer = async (eventId) => {
    try {
      const response = await fetch(`http://localhost:3000/api/events/${eventId}/volunteer`, {
        method: 'POST',
        credentials: 'include', // CRITICAL: Send cookies
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();

      if (response.ok) {
        showMessage('Successfully volunteered for the event!');
        fetchEvents();
      } else {
        if (response.status === 401) {
          showMessage('Please sign in to volunteer.', true);
          setTimeout(() => {
            navigate('/');
          }, 2000);
        } else {
          showMessage(`Failed to volunteer: ${data.error}`, true);
        }
      }
    } catch (error) {
      console.error('Error volunteering:', error);
      showMessage('Error volunteering for the event.', true);
    }
  };

  // Handle logout
  const handleLogout = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/signout', {
        method: 'POST',
        credentials: 'include', // CRITICAL: Send cookies
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();

      if (data.success) {
        navigate('/');
      } else {
        showMessage('Error logging out. Please try again.', true);
      }
    } catch (error) {
      console.error('Logout error:', error);
      showMessage('Error logging out. Please try again.', true);
    }
  };

  // Handle back navigation
  const handleBack = () => {
    navigate('/volunteers');
  };

  // Load events on mount
  useEffect(() => {
    fetchEvents();
  }, []);

  return (
    <div className="volunteer-events-wrapper">
      {/* Message notification */}
      {message.text && (
        <div className={`ve-message ${message.isError ? 'error' : 'success'}`}>
          {message.text}
        </div>
      )}

      {/* Navigation buttons */}
      <div className="ve-nav-container">
        <button onClick={handleBack} className="ve-nav-btn">
          ← Back
        </button>
        <button onClick={handleLogout} className="ve-nav-btn">
          ⎋ Logout
        </button>
      </div>

      {/* Main container with animated border */}
      <div className="ve-container">
        <div className="ve-content-box">
          <h2 className="ve-header">Volunteer for Events</h2>

          {/* Events list */}
          <div className="ve-events-list">
            {events.length === 0 ? (
              <div className="ve-event-item">
                <div className="ve-event-info">
                  <p><strong>No events available for volunteering</strong></p>
                </div>
              </div>
            ) : (
              events.map((event) => {
                const remainingVolunteers = event.maxVoln - (event.volunteerCount || 0);
                return (
                  <div key={event.eid} className="ve-event-item">
                    <div className="ve-event-info">
                      <p className="ve-event-name">{event.ename || 'N/A'}</p>
                      <p><strong>Date:</strong> {formatDate(event.eventDate)}</p>
                      <p><strong>Time:</strong> {formatTime(event.eventTime)}</p>
                      <p><strong>Location:</strong> {event.eventLoc || 'N/A'}</p>
                      <p>
                        <strong>Volunteers Needed:</strong>{' '}
                        {remainingVolunteers > 0 ? remainingVolunteers : 0}/{event.maxVoln || 'N/A'}
                      </p>
                    </div>

                    <div className="ve-event-actions">
                      {remainingVolunteers > 0 ? (
                        <button
                          onClick={() => handleVolunteer(event.eid)}
                          className="ve-button ve-volunteer-btn"
                        >
                          Volunteer
                        </button>
                      ) : (
                        <p className="ve-no-volunteers">No more volunteers</p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}