import React, { useEffect, useState } from 'react';
import './participants.css';
import { useNavigate } from 'react-router-dom';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const Participants = () => {
  const navigate = useNavigate();
  const [events, setEvents] = useState({
    ongoing: [],
    completed: [],
    upcoming: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userInfo, setUserInfo] = useState({ userName: '', userUSN: '' });

  useEffect(() => {
    fetchUserInfo();
    fetchParticipantEvents();
  }, []);

  const fetchUserInfo = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/me', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setUserInfo({
          userName: data.userName,
          userUSN: data.userUSN
        });
      }
    } catch (err) {
      console.error('Error fetching user info:', err);
    }
  };

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

  const fetchParticipantEvents = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/my-participant-events', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          navigate('/');
          return;
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const participantEvents = data.participantEvents || [];
      const categorizedEvents = categorizeEvents(participantEvents);
      setEvents(categorizedEvents);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching participant events:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  const generateCertificate = async (event) => {
    try {
      // Check if participant attended the event
      if (!event.PartStatus) {
        alert('Certificate is only available for attended events.');
        return;
      }

      // Fetch the PDF template
      const templateUrl = '/certificate-template.pdf';
      const existingPdfBytes = await fetch(templateUrl).then(res => {
        if (!res.ok) {
          throw new Error('Certificate template not found. Please ensure certificate-template.pdf is in the public folder.');
        }
        return res.arrayBuffer();
      });

      // Load the PDF template
      const pdfDoc = await PDFDocument.load(existingPdfBytes);
      
      // Register fontkit to enable custom fonts
      pdfDoc.registerFontkit(fontkit);
      
      // Get the first page
      const pages = pdfDoc.getPages();
      const firstPage = pages[0];
      const { width, height } = firstPage.getSize();

      // Try to embed Romeo font for participant name, fallback to TimesRomanBold if it fails
      let nameFont;
      try {
        const fontUrl = '/RommetooOne-Regular.ttf';
        const fontBytes = await fetch(fontUrl).then(res => {
          if (!res.ok) {
            throw new Error('Romeo font file not found.');
          }
          return res.arrayBuffer();
        });
        nameFont = await pdfDoc.embedFont(fontBytes);
      } catch (fontError) {
        console.warn('Could not load custom font, using TimesRomanBold as fallback:', fontError);
        nameFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
      }
      
      // Regular font for other text
      const font = await pdfDoc.embedFont(StandardFonts.Courier);
      const boldFont = await pdfDoc.embedFont(StandardFonts.CourierBold);

      // Colors for text
      const nameColor = rgb(202 / 255, 209 / 255, 164 / 255);
      const whiteColor = rgb(1, 1, 1);

      // Add participant name (centered) with Romeo font
      const nameText = userInfo.userName;
      const nameSize = 38;
      const nameWidth = nameFont.widthOfTextAtSize(nameText, nameSize);
      firstPage.drawText(nameText, {
        x: (width - nameWidth) / 2, // Center horizontally
        y: 350, // Adjust based on your template (from bottom)
        size: nameSize,
        font: nameFont,
        color: nameColor,
      });

      // Add USN
      const usnSize = 19;
      firstPage.drawText(userInfo.userUSN, {
        x: 327, // Adjust X position based on your template
        y: 110, // Adjust Y position based on your template
        size: usnSize,
        font: font,
        color: whiteColor,
      });

      // Add Event Description (with word wrapping)
      const eventDesc = event.eventdesc || event.ename;
      const descSize = 15;
      const maxWidth = 450; // Maximum width for text
      
      // Simple word wrapping
      const words = eventDesc.split(' ');
      let line = '';
      let yPosition = 260; // Starting Y position
      
      words.forEach((word, index) => {
        const testLine = line + word + ' ';
        const testWidth = font.widthOfTextAtSize(testLine, descSize);
        
        if (testWidth > maxWidth && line !== '') {
          firstPage.drawText(line, {
            x: 165, // Adjust X position
            y: yPosition,
            size: descSize,
            font: font,
            color: whiteColor,
          });
          line = word + ' ';
          yPosition -= 20; // Move to next line
        } else {
          line = testLine;
        }
      });
      
      // Draw remaining text
      if (line !== '') {
        firstPage.drawText(line, {
          x: 150, // Adjust X position
          y: yPosition,
          size: descSize,
          font: font,
          color: whiteColor,
        });
      }

      // Serialize the PDF to bytes
      const pdfBytes = await pdfDoc.save();

      // Create a blob and download
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Certificate_${event.ename.replace(/\s+/g, '_')}_${userInfo.userUSN}.pdf`;
      link.click();
      window.URL.revokeObjectURL(url);

    } catch (error) {
      console.error('Error generating certificate:', error);
      alert(`Error generating certificate: ${error.message}`);
    }
  };

  const getParticipantStatus = (status) => {
    switch (status) {
      case 0:
      case false:
        return 'Registered';
      case 1:
      case true:
        return 'Attended';
      default:
        return 'Unknown';
    }
  };

  const getButtonText = (eventType) => {
    switch (eventType) {
      case 'ongoing': return 'View Details';
      case 'completed': return 'View Certificate';
      case 'upcoming': return 'View Details';
      default: return 'View';
    }
  };

  const handleEventButtonClick = (event, eventType) => {
    if (eventType === 'completed') {
      // Generate and download certificate for completed events
      generateCertificate(event);
    } else {
      // Navigate to ticket page for other events
      navigate(`/participant-ticket?eventId=${event.eid}`);
    }
  };

  const handleParticipateClick = () => {
    navigate('/register-event');
  };

  const handleLogout = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/signout', {
        method: 'POST',
        credentials: 'include',
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
          <div className="event-info">
            <p><strong>Loading...</strong></p>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="event-item">
          <div className="event-info">
            <p><strong>Error:</strong> Could not load events. {error}</p>
          </div>
        </div>
      );
    }

    if (!eventsList || eventsList.length === 0) {
      return (
        <div className="event-item">
          <div className="event-info">
            <p><strong>No events available</strong></p>
          </div>
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
          {event.clubName && <p>Club: {event.clubName}</p>}
          <p>Status: {getParticipantStatus(event.PartStatus)}</p>
        </div>
        <div className="event-actions">
          <button
            className="event-btn"
            onClick={() => handleEventButtonClick(event, eventType)}
          >
            {getButtonText(eventType)}
          </button>
        </div>
      </div>
    ));
  };

  return (
    <div className="participants-page">
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
            <button onClick={handleParticipateClick}>
              Participate in other Event
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Participants;