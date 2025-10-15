import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './event_form.css';

const EventForm = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    eventName: '',
    eventDescription: '',
    eventDate: '',
    eventTime: '',
    eventLocation: '',
    maxParticipants: '',
    maxVolunteers: '',
    OrgCid: '', // Only club ID needed, organizer USN comes from session
    registrationFee: ''
  });

  const [message, setMessage] = useState({ text: '', isError: false, show: false });

  const showMessage = (text, isError = false) => {
    setMessage({ text, isError, show: true });
    setTimeout(() => {
      setMessage({ text: '', isError: false, show: false });
    }, 5000);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const data = {
      eventName: formData.eventName,
      eventDescription: formData.eventDescription,
      eventDate: formData.eventDate,
      eventTime: formData.eventTime,
      eventLocation: formData.eventLocation,
      maxParticipants: parseInt(formData.maxParticipants),
      maxVolunteers: parseInt(formData.maxVolunteers),
      OrgCid: parseInt(formData.OrgCid) || null,
      registrationFee: parseFloat(formData.registrationFee)
    };

    // Basic validation
    if (!data.eventName || !data.eventDescription || !data.eventDate || !data.eventTime || !data.eventLocation || !data.OrgCid) {
      showMessage('Please fill in all required fields.', true);
      return;
    }

    // Validate Club ID
    if (data.OrgCid <= 0) {
      showMessage('Club ID must be a positive number.', true);
      return;
    }

    // Validate date (must be in the future)
    const eventDate = new Date(data.eventDate);
    const currentDate = new Date();
    if (eventDate <= currentDate) {
      showMessage('Event date must be in the future.', true);
      return;
    }

    try {
      const res = await fetch('http://localhost:3000/api/events/create', {
        method: 'POST',
        credentials: 'include', // CRITICAL: Send cookies with request
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const result = await res.json();
      console.log('Server response:', result);

      if (res.ok) {
        showMessage('Event created successfully!');
        setFormData({
          eventName: '',
          eventDescription: '',
          eventDate: '',
          eventTime: '',
          eventLocation: '',
          maxParticipants: '',
          maxVolunteers: '',
          OrgCid: '',
          registrationFee: ''
        });
        setTimeout(() => {
          navigate('/organisers');
        }, 2000);
      } else {
        if (res.status === 401) {
          showMessage('Please sign in to create an event.', true);
          setTimeout(() => {
            navigate('/');
          }, 2000);
        } else {
          showMessage(`Failed to create event: ${result.error}`, true);
        }
      }
    } catch (err) {
      console.error('Error creating event:', err);
      showMessage(`Error: ${err.message}`, true);
    }
  };

  return (
    <div className="event-form-container">
      {message.show && (
        <div className={`event-form-message ${message.isError ? 'event-form-message-error' : 'event-form-message-success'}`}>
          {message.text}
        </div>
      )}
      
      <div className="event-form-wrap event-form-registration">
        <div className="event-form-card">
          <div className="event-form-card-side event-form-left">
            <div className="event-form-logo-text" data-text="Hey Organisers">
              Hey Organisers
            </div>
          </div>
          <div className="event-form-card-side event-form-right">
            <h2 className="event-form-title">Organize an Event</h2>
            <form className="event-form-form" onSubmit={handleSubmit}>
              <input
                className="event-form-input"
                type="text"
                name="eventName"
                placeholder="Event Name"
                value={formData.eventName}
                onChange={handleChange}
                required
              />
              <textarea
                className="event-form-textarea"
                name="eventDescription"
                placeholder="Description"
                value={formData.eventDescription}
                onChange={handleChange}
                rows="3"
                required
              />
              <input
                className="event-form-input"
                type="date"
                name="eventDate"
                value={formData.eventDate}
                onChange={handleChange}
                required
              />
              <input
                className="event-form-input"
                type="time"
                name="eventTime"
                value={formData.eventTime}
                onChange={handleChange}
                required
              />
              <input
                className="event-form-input"
                type="text"
                name="eventLocation"
                placeholder="Location"
                value={formData.eventLocation}
                onChange={handleChange}
                required
              />
              <input
                className="event-form-input"
                type="number"
                name="maxParticipants"
                placeholder="Max Participants"
                value={formData.maxParticipants}
                onChange={handleChange}
                min="1"
                required
              />
              <input
                className="event-form-input"
                type="number"
                name="maxVolunteers"
                placeholder="Max Volunteers"
                value={formData.maxVolunteers}
                onChange={handleChange}
                min="1"
                required
              />
              <input
                className="event-form-input"
                type="number"
                name="OrgCid"
                placeholder="Club ID"
                value={formData.OrgCid}
                onChange={handleChange}
                min="1"
                required
              />
              <input
                className="event-form-input"
                type="number"
                name="registrationFee"
                placeholder="Registration Fee"
                value={formData.registrationFee}
                onChange={handleChange}
                step="0.01"
                min="0"
                required
              />
              <button className="event-form-button" type="submit">Create Event</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventForm;