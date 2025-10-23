import { useState, useRef, useEffect } from 'react';

export default function Scanner() {
  const [lastResult, setLastResult] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [error, setError] = useState(null);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [checkInStatus, setCheckInStatus] = useState(null);
  const [participantInfo, setParticipantInfo] = useState(null);
  
  const scannerRef = useRef(null);
  const html5QrcodeScannerRef = useRef(null);

  // Configure your API base URL
  const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

  useEffect(() => {
    if (!window.Html5QrcodeScanner) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';
      script.onload = () => {
        setLibraryLoaded(true);
        initScanner();
      };
      script.onerror = () => setError('Failed to load QR scanner library');
      document.head.appendChild(script);
    } else {
      setLibraryLoaded(true);
      initScanner();
    }

    return () => {
      if (html5QrcodeScannerRef.current) {
        html5QrcodeScannerRef.current.clear().catch(err => console.error('Clear error:', err));
      }
    };
  }, []);

  const initScanner = () => {
    if (!window.Html5QrcodeScanner || !scannerRef.current) return;

    if (html5QrcodeScannerRef.current) {
      html5QrcodeScannerRef.current.clear().catch(err => console.error('Clear error:', err));
    }

    setIsScanning(true);
    setError(null);
    setCheckInStatus(null);
    setParticipantInfo(null);

    html5QrcodeScannerRef.current = new window.Html5QrcodeScanner('reader', {
      qrbox: {
        width: 250,
        height: 250,
      },
      fps: 20,
      aspectRatio: 1.0,
      showTorchButtonIfSupported: true,
      showZoomSliderIfSupported: true,
      defaultZoomValueIfSupported: 2,
      rememberLastUsedCamera: true,
    });

    html5QrcodeScannerRef.current.render(onScanSuccess, onScanError);
  };

  const parseQRData = (qrText) => {
    try {
      // Try parsing as JSON first
      const data = JSON.parse(qrText);
      return data;
    } catch {
      // If not JSON, try parsing as URL query string
      // Format: usn=1234&eid=5678 or URL with query params
      const url = new URL(qrText.includes('://') ? qrText : `http://dummy.com?${qrText}`);
      const usn = url.searchParams.get('usn');
      const eid = url.searchParams.get('eid');
      
      if (usn && eid) {
        return { usn, eid };
      }
      
      return null;
    }
  };

  const sendToBackend = async (usn, eid) => {
    setIsProcessing(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/scan-qr?usn=${encodeURIComponent(usn)}&eid=${encodeURIComponent(eid)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (response.ok) {
        setCheckInStatus('success');
        setParticipantInfo({ usn, eid, message: data.message });
      } else {
        setCheckInStatus('error');
        setError(data.error || 'Failed to check in participant');
      }
    } catch (err) {
      console.error('Error contacting backend:', err);
      setCheckInStatus('error');
      setError('Network error. Please check your connection.');
    } finally {
      setIsProcessing(false);
    }
  };

  const onScanSuccess = async (decodedText, decodedResult) => {
    console.log(`QR Code detected: ${decodedText}`, decodedResult);
    
    setLastResult(decodedText);
    setIsScanning(false);
    
    if (html5QrcodeScannerRef.current) {
      html5QrcodeScannerRef.current.clear().catch(err => console.error('Clear error:', err));
      html5QrcodeScannerRef.current = null;
    }

    // Parse QR code data
    const parsedData = parseQRData(decodedText);
    
    if (parsedData && parsedData.usn && parsedData.eid) {
      // Valid QR code with USN and EID - send to backend
      await sendToBackend(parsedData.usn, parsedData.eid);
    } else {
      // Invalid QR code format
      setCheckInStatus('error');
      setError('Invalid QR code format. Expected USN and Event ID.');
    }

    setShowResult(true);
  };

  const onScanError = (errorMessage) => {
    console.log(`Scan error: ${errorMessage}`);
  };

  const isValidUrl = (string) => {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  };

  const copyToClipboard = () => {
    if (lastResult) {
      navigator.clipboard
        .writeText(lastResult)
        .then(() => {
          const copyBtn = document.getElementById('copy-btn');
          if (copyBtn) {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = '✅ Copied!';
            copyBtn.style.background = 'linear-gradient(135deg, #48bb78, #38a169)';

            setTimeout(() => {
              copyBtn.textContent = originalText;
              copyBtn.style.background = '';
            }, 2000);
          }
        })
        .catch((err) => {
          console.error('Failed to copy:', err);
          const textArea = document.createElement('textarea');
          textArea.value = lastResult;
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
        });
    }
  };

  const scanAgain = () => {
    setShowResult(false);
    setLastResult('');
    setError(null);
    setCheckInStatus(null);
    setParticipantInfo(null);
    initScanner();
  };

  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Animated background elements */}
      <div style={{
        position: 'absolute',
        top: '-50%',
        right: '-50%',
        width: '100%',
        height: '100%',
        background: 'radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%)',
        animation: 'float 20s ease-in-out infinite',
        pointerEvents: 'none'
      }}></div>
      <div style={{
        position: 'absolute',
        bottom: '-50%',
        left: '-50%',
        width: '100%',
        height: '100%',
        background: 'radial-gradient(circle, rgba(255,255,255,0.05) 0%, transparent 70%)',
        animation: 'float 15s ease-in-out infinite reverse',
        pointerEvents: 'none'
      }}></div>

      <div style={{
        background: 'rgba(255, 255, 255, 0.98)',
        backdropFilter: 'blur(20px)',
        borderRadius: '32px',
        padding: '40px',
        boxShadow: '0 30px 60px rgba(0, 0, 0, 0.3), 0 0 100px rgba(102, 126, 234, 0.1)',
        maxWidth: '550px',
        width: '100%',
        textAlign: 'center',
        position: 'relative',
        border: '1px solid rgba(255, 255, 255, 0.3)',
        animation: 'fadeInUp 0.6s ease-out'
      }}>
        {/* Decorative corner elements */}
        <div style={{
          position: 'absolute',
          top: '-2px',
          left: '-2px',
          width: '60px',
          height: '60px',
          borderTop: '3px solid #667eea',
          borderLeft: '3px solid #667eea',
          borderRadius: '32px 0 0 0',
          opacity: '0.6'
        }}></div>
        <div style={{
          position: 'absolute',
          bottom: '-2px',
          right: '-2px',
          width: '60px',
          height: '60px',
          borderBottom: '3px solid #764ba2',
          borderRight: '3px solid #764ba2',
          borderRadius: '0 0 32px 0',
          opacity: '0.6'
        }}></div>

        <div style={{ marginBottom: '36px' }}>
          <div style={{
            fontSize: '64px',
            marginBottom: '20px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            animation: 'scaleIn 0.5s ease-out',
            filter: 'drop-shadow(0 4px 8px rgba(102, 126, 234, 0.3))'
          }}>📱</div>
          <h1 style={{
            color: '#1a202c',
            fontSize: '32px',
            fontWeight: '800',
            margin: '0 0 12px 0',
            letterSpacing: '-0.5px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}>Event Check-In Scanner</h1>
          <p style={{
            color: '#718096',
            fontSize: '16px',
            margin: '0',
            fontWeight: '500'
          }}>Scan participant QR codes for instant check-in</p>
        </div>

        {error && (
          <div style={{
            background: 'linear-gradient(135deg, #fed7d7 0%, #feb2b2 100%)',
            border: '2px solid #fc8181',
            borderRadius: '16px',
            padding: '24px',
            margin: '24px 0',
            color: '#c53030',
            animation: 'shake 0.5s ease-in-out'
          }}>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>⚠️</div>
            <p style={{ margin: '0', fontSize: '15px', fontWeight: '600' }}>{error}</p>
          </div>
        )}

        {isProcessing && (
          <div style={{
            background: 'linear-gradient(135deg, #bee3f8 0%, #90cdf4 100%)',
            border: '2px solid #4299e1',
            borderRadius: '16px',
            padding: '24px',
            margin: '24px 0',
            color: '#2c5282',
            animation: 'pulse 1.5s ease-in-out infinite'
          }}>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>⏳</div>
            <p style={{ margin: '0', fontSize: '15px', fontWeight: '600' }}>Processing check-in...</p>
          </div>
        )}

        {!showResult && (
          <div style={{
            position: 'relative',
            margin: '28px 0',
            borderRadius: '20px',
            overflow: 'hidden',
            background: 'linear-gradient(135deg, #000000 0%, #1a202c 100%)',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4), inset 0 0 0 1px rgba(255,255,255,0.1)',
            border: '2px solid rgba(102, 126, 234, 0.3)'
          }}>
            <div id="reader" ref={scannerRef} style={{
              width: '100%',
              minHeight: '320px',
              borderRadius: '20px'
            }}></div>
            {isScanning && (
              <div style={{
                position: 'absolute',
                top: '20px',
                right: '20px',
                background: 'linear-gradient(135deg, #48bb78 0%, #38a169 100%)',
                color: 'white',
                padding: '10px 20px',
                borderRadius: '24px',
                fontSize: '13px',
                fontWeight: '700',
                animation: 'pulse 2s infinite',
                zIndex: 1000,
                boxShadow: '0 4px 12px rgba(72, 187, 120, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span style={{
                  display: 'inline-block',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: 'white',
                  animation: 'blink 1.5s infinite'
                }}></span>
                Scanning...
              </div>
            )}
          </div>
        )}

        {showResult && checkInStatus === 'success' && (
          <div style={{
            background: 'linear-gradient(135deg, #48bb78 0%, #38a169 100%)',
            borderRadius: '20px',
            padding: '28px',
            marginTop: '28px',
            animation: 'slideInUp 0.5s ease-out',
            boxShadow: '0 10px 30px rgba(72, 187, 120, 0.3)',
            border: '1px solid rgba(255, 255, 255, 0.3)'
          }}>
            <div style={{ 
              fontSize: '48px', 
              marginBottom: '16px',
              animation: 'bounceIn 0.6s ease-out'
            }}>✅</div>
            <div style={{
              color: 'white',
              fontSize: '24px',
              fontWeight: '800',
              marginBottom: '20px',
              textShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}>Check-In Successful!</div>
            
            {participantInfo && (
              <div style={{
                background: 'rgba(255, 255, 255, 0.98)',
                backdropFilter: 'blur(10px)',
                borderRadius: '16px',
                padding: '20px',
                marginBottom: '20px',
                textAlign: 'left',
                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.06)',
                border: '1px solid rgba(0,0,0,0.1)'
              }}>
                <div style={{ marginBottom: '12px', color: '#2d3748', fontWeight: '700', fontSize: '15px' }}>
                  Participant Details:
                </div>
                <div style={{ color: '#4a5568', fontSize: '14px', lineHeight: '1.8' }}>
                  <div><strong>USN:</strong> {participantInfo.usn}</div>
                  <div><strong>Event ID:</strong> {participantInfo.eid}</div>
                  <div style={{ marginTop: '8px', color: '#48bb78', fontWeight: '600' }}>
                    ✓ {participantInfo.message}
                  </div>
                </div>
              </div>
            )}

            <button 
              style={{
                background: 'white',
                color: '#38a169',
                border: '2px solid rgba(255, 255, 255, 0.4)',
                borderRadius: '14px',
                padding: '12px 32px',
                fontWeight: '700',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                fontSize: '15px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                width: '100%',
                justifyContent: 'center'
              }}
              onClick={scanAgain}
              onMouseOver={(e) => {
                e.currentTarget.style.background = '#f7fafc';
                e.currentTarget.style.transform = 'translateY(-3px)';
                e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.2)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'white';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              }}
            >
              🔄 Scan Next Participant
            </button>
          </div>
        )}

        {showResult && checkInStatus === 'error' && (
          <div style={{
            background: 'linear-gradient(135deg, #fc8181 0%, #f56565 100%)',
            borderRadius: '20px',
            padding: '28px',
            marginTop: '28px',
            animation: 'slideInUp 0.5s ease-out',
            boxShadow: '0 10px 30px rgba(252, 129, 129, 0.3)',
            border: '1px solid rgba(255, 255, 255, 0.3)'
          }}>
            <div style={{ 
              fontSize: '48px', 
              marginBottom: '16px',
              animation: 'shake 0.5s ease-out'
            }}>❌</div>
            <div style={{
              color: 'white',
              fontSize: '24px',
              fontWeight: '800',
              marginBottom: '12px',
              textShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}>Check-In Failed</div>
            
            <div style={{
              background: 'rgba(255, 255, 255, 0.98)',
              backdropFilter: 'blur(10px)',
              borderRadius: '16px',
              padding: '20px',
              marginBottom: '20px',
              color: '#c53030',
              fontSize: '14px',
              fontWeight: '600',
              lineHeight: '1.6'
            }}>
              {error || 'An error occurred during check-in'}
            </div>

            <div style={{
              display: 'flex',
              gap: '12px',
              flexWrap: 'wrap'
            }}>
              <button 
                style={{
                  background: 'white',
                  color: '#f56565',
                  border: '2px solid rgba(255, 255, 255, 0.4)',
                  borderRadius: '14px',
                  padding: '12px 24px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  fontSize: '15px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  flex: '1'
                }}
                onClick={scanAgain}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = '#f7fafc';
                  e.currentTarget.style.transform = 'translateY(-3px)';
                  e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.2)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = 'white';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                }}
              >
                🔄 Try Again
              </button>
              
              <button 
                id="copy-btn"
                style={{
                  background: 'rgba(255, 255, 255, 0.25)',
                  color: 'white',
                  border: '2px solid rgba(255, 255, 255, 0.4)',
                  borderRadius: '14px',
                  padding: '12px 24px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  fontSize: '15px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  flex: '1'
                }}
                onClick={copyToClipboard}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.35)';
                  e.currentTarget.style.transform = 'translateY(-3px)';
                  e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.2)';
                }}
                onMouseOut={(e) => {
                  if (!e.currentTarget.textContent.includes('Copied')) {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.25)';
                  }
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                }}
              >
                📋 Copy QR Data
              </button>
            </div>
          </div>
        )}

        <div style={{
          background: 'linear-gradient(135deg, rgba(102, 126, 234, 0.08) 0%, rgba(118, 75, 162, 0.08) 100%)',
          borderRadius: '16px',
          padding: '20px',
          marginTop: '28px',
          color: '#4a5568',
          fontSize: '14px',
          lineHeight: '1.8',
          textAlign: 'left',
          border: '1px solid rgba(102, 126, 234, 0.15)'
        }}>
          <div style={{
            fontWeight: '700',
            marginBottom: '12px',
            color: '#2d3748',
            fontSize: '15px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span style={{ fontSize: '18px' }}>💡</span>
            Quick Tips
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ fontSize: '16px', minWidth: '20px' }}>✓</span>
              <span>QR code must contain USN and Event ID</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ fontSize: '16px', minWidth: '20px' }}>✓</span>
              <span>Ensure good lighting for best scanning</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ fontSize: '16px', minWidth: '20px' }}>✓</span>
              <span>Hold QR code steady in the frame</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ fontSize: '16px', minWidth: '20px' }}>✓</span>
              <span>Check-in status updates automatically</span>
            </div>
          </div>
        </div>

        <style>{`
          #reader video {
            border-radius: 20px !important;
          }

          #reader__dashboard_section {
            background: rgba(255, 255, 255, 0.98) !important;
            backdrop-filter: blur(10px) !important;
            border-radius: 0 0 20px 20px !important;
            padding: 20px !important;
            border-top: 1px solid rgba(102, 126, 234, 0.2) !important;
          }

          #reader__dashboard_section button {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
            border: none !important;
            border-radius: 14px !important;
            color: white !important;
            font-weight: 700 !important;
            padding: 12px 28px !important;
            margin: 6px !important;
            transition: all 0.3s ease !important;
            cursor: pointer !important;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3) !important;
            font-size: 14px !important;
          }

          #reader__dashboard_section button:hover {
            transform: translateY(-3px) !important;
            box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4) !important;
          }

          #reader__dashboard_section select {
            border: 2px solid #e2e8f0 !important;
            border-radius: 12px !important;
            padding: 10px 16px !important;
            font-size: 14px !important;
            background: white !important;
            font-weight: 600 !important;
            color: #2d3748 !important;
            transition: all 0.3s ease !important;
          }

          #reader__dashboard_section select:focus {
            outline: none !important;
            border-color: #667eea !important;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1) !important;
          }

          #reader__scan_region {
            border: 3px solid #667eea !important;
            border-radius: 12px !important;
          }

          @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
          }

          @keyframes slideInUp {
            from { opacity: 0; transform: translateY(40px) scale(0.95); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }

          @keyframes scaleIn {
            from { transform: scale(0); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
          }

          @keyframes bounceIn {
            0% { transform: scale(0); opacity: 0; }
            50% { transform: scale(1.1); }
            100% { transform: scale(1); opacity: 1; }
          }

          @keyframes pulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.05); opacity: 0.9; }
          }

          @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }

          @keyframes float {
            0%, 100% { transform: translateY(0) rotate(0deg); }
            50% { transform: translateY(-20px) rotate(5deg); }
          }

          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-10px); }
            75% { transform: translateX(10px); }
          }

          @media (max-width: 600px) {
            body > div > div {
              padding: 28px !important;
              border-radius: 24px !important;
            }
          }
        `}</style>
      </div>
    </div>
  );
}