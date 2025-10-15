import React, { useEffect, useState } from 'react';
import './volunteers.css';
import { useNavigate } from 'react-router-dom';

const Volunteers = () => {
  const navigate = useNavigate();
  const [events, setEvents] = useState({
    ongoing: [],
    completed: [],
    upcoming: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchVolunteerEvents();
  }, []);

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

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

  const categorizeEvents = (events) => {
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    const categorized = {
      ongoing: [],
      completed: [],
      upcoming: []
    };

    events.forEach(event => {
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
  };

  const fetchVolunteerEvents = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/my-volunteer-events', {
        method: 'GET',
        credentials: 'include', // CRITICAL: Send cookies with request
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          // User not authenticated, redirect to login
          navigate('/');
          return;
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const volunteerEvents = data.volunteerEvents || [];
      const categorizedEvents = categorizeEvents(volunteerEvents);
      setEvents(categorizedEvents);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching volunteer events:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  const getButtonText = (eventType) => {
    return 'View Details';
  };

  const handleEventButtonClick = (eventId, eventType) => {
    navigate(`/volunteer-ticket?eventId=${eventId}`);
  };

  const handleVolunteerClick = () => {
    navigate('/volunteer-event');
  };

  const handleLogout = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/signout', {
        method: 'POST',
        credentials: 'include', // CRITICAL: Send cookies
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (data.success) {
        navigate('/');
      } else {
        alert('Error logging out. Please try again.');
      }
    } catch (error) {
      console.error('Logout error:', error);
      alert('Error logging out. Please try again.');
    }
  };

  const renderEventsList = (eventsList, eventType) => {
    if (loading) {
      return (
        <div className="event-item">
          <p><strong>Loading...</strong></p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="event-item">
          <p><strong>Error:</strong> Could not load events. {error}</p>
        </div>
      );
    }

    if (!eventsList || eventsList.length === 0) {
      return (
        <div className="event-item">
          <p><strong>No events available</strong></p>
        </div>
      );
    }

    return eventsList.map(event => (
      <div className="event-item" key={event.eid}>
        <div className="event-info">
          <p><strong>{event.ename || 'N/A'}</strong></p>
          <p>Date: {formatDate(event.eventDate)}</p>
          <p>Time: {formatTime(event.eventTime)}</p>
          <p>Location: {event.eventLoc || 'N/A'}</p>
        </div>
        <div className="event-actions">
          <button
            className="event-btn"
            onClick={() => handleEventButtonClick(event.eid, eventType)}
          >
            {getButtonText(eventType)}
          </button>
        </div>
      </div>
    ));
  };

  return (
    <div className="volunteers-page">
      <div className="logout-container">
        <button id="logoutBtn" className="logout-btn" onClick={handleLogout}>
          <i className="fas fa-sign-out-alt"></i>
          Logout
        </button>
      </div>

      <section className="hero-section">
        <div className="container">
          <div className="card-grid">
            <div className="card" id="completed-card">
              <div className="card__background"></div>
              <div className="card__content">
                <h3 className="card__heading">Completed Events</h3>
                <div className="card__details">
                  {renderEventsList(events.completed, 'completed')}
                </div>
              </div>
            </div>

            <div className="card" id="ongoing-card">
              <div className="card__background"></div>
              <div className="card__content">
                <h3 className="card__heading">Ongoing Events</h3>
                <div className="card__details">
                  {renderEventsList(events.ongoing, 'ongoing')}
                </div>
              </div>
            </div>

            <div className="card" id="upcoming-card">
              <div className="card__background"></div>
              <div className="card__content">
                <h3 className="card__heading">Upcoming Events</h3>
                <div className="card__details">
                  {renderEventsList(events.upcoming, 'upcoming')}
                </div>
              </div>
            </div>
          </div>

          <div className="button-container">
            <button id="volunteerOtherEvent" onClick={handleVolunteerClick}>
              Volunteer in Other Event
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Volunteers;