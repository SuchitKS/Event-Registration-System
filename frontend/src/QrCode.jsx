import { useState, useEffect, useRef } from 'react';
import './QrCode.css';

export default function QrCode() {
  const [error, setError] = useState(false);
  const qrCodeRef = useRef(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const eventId = urlParams.get('eventId');
    const usn = urlParams.get('usn');

    if (!eventId || !usn) {
      setError(true);
      return;
    }

    // Load QRCode library dynamically
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    script.async = true;
    script.onload = () => {
      generateQRCode(eventId, usn);
    };
    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  const generateQRCode = (eventId, usn) => {
    if (qrCodeRef.current && window.QRCode) {
      qrCodeRef.current.innerHTML = '';
      
      const qrText = `http://localhost:3000/api/scan-qr?usn=${usn}&eid=${eventId}`;
      new window.QRCode(qrCodeRef.current, {
        text: qrText,
        width: 180,
        height: 180,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: window.QRCode.CorrectLevel.H
      });
    }
  };

  const handleBack = () => {
    window.history.back();
  };

  return (
    <div className="qr-code-page">
      <div className="qr-container">
        <div className="qr-header">
          <h1>Event Check-in</h1>
          <p className="subtitle">Present your QR code at the venue</p>
        </div>
        
        {error ? (
          <div className="error-message">
            <h3>Error</h3>
            <p>Unable to generate QR code. Please try again.</p>
          </div>
        ) : (
          <div className="card">
            <div className="card-header">
              <h2>QR Code</h2>
              <p className="card-subtitle">Scan to check-in</p>
            </div>
            <div ref={qrCodeRef} className="qr-code"></div>
          </div>
        )}
        
        <button onClick={handleBack} className="back-btn">
          Back to Ticket
        </button>
      </div>
    </div>
  );
}