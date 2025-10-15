import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './style.css';

export default function Login() {
  const navigate = useNavigate();
  const [isActive, setIsActive] = useState(false);
  const [message, setMessage] = useState({ text: '', isError: false, show: false });

  const [signInData, setSignInData] = useState({
    usn: '',
    password: ''
  });

  const [signUpData, setSignUpData] = useState({
    name: '',
    usn: '',
    sem: '',
    mobno: '',
    email: '',
    password: ''
  });

  useEffect(() => {
    checkAuthStatus();
  }, []);

  useEffect(() => {
    if (message.show) {
      const timer = setTimeout(() => {
        setMessage(prev => ({ ...prev, show: false }));
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [message.show]);

  const checkAuthStatus = async () => {
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
        showMessage(`Already logged in as ${data.userName}. Redirecting...`);
        setTimeout(() => {
          navigate('/events');
        }, 1500);
      }
    } catch (error) {
      console.log('User not authenticated');
    }
  };

  const showMessage = (text, isError = false) => {
    setMessage({ text, isError, show: true });
  };

  const handleSignIn = async () => {
    const { usn, password } = signInData;

    if (!usn || !password) {
      showMessage("Please fill in all fields", true);
      return;
    }

    try {
      const response = await fetch('http://localhost:3000/api/signin', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ usn, password })
      });

      const data = await response.json();

      if (data.success) {
        showMessage(`Welcome back, ${data.userName}!`);
        setTimeout(() => {
          navigate('/events');
        }, 1500);
      } else {
        showMessage(data.error, true);
      }
    } catch (error) {
      console.error('Sign in error:', error);
      showMessage('Network error. Please try again.', true);
    }
  };

  const handleSignUp = async () => {
    const { name, usn, sem, mobno, email, password } = signUpData;

    if (!name || !usn || !sem || !mobno || !email || !password) {
      showMessage("Please fill in all fields", true);
      return;
    }

    if (!/^1BM\d{2}[A-Z]{2}\d{3}$/.test(usn)) {
      showMessage("Invalid USN format. Example: 1BM23CS101", true);
      return;
    }

    if (!/\S+@\S+\.\S+/.test(email)) {
      showMessage("Please enter a valid email address", true);
      return;
    }

    if (!/^\d{10}$/.test(mobno)) {
      showMessage("Please enter a valid 10-digit mobile number", true);
      return;
    }

    const semNum = parseInt(sem);
    if (semNum < 1 || semNum > 8) {
      showMessage("Semester must be between 1 and 8", true);
      return;
    }

    try {
      const response = await fetch('http://localhost:3000/api/signup', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, usn, sem: semNum, mobno, email, password })
      });

      if (!response.ok) {
        const errorData = await response.json();
        showMessage(errorData.error || 'Failed to sign up. Please try again.', true);
        return;
      }

      const data = await response.json();

      if (data.success) {
        showMessage(`Account created successfully! Welcome, ${data.userName}!`);
        setSignUpData({
          name: '',
          usn: '',
          sem: '',
          mobno: '',
          email: '',
          password: ''
        });
        setTimeout(() => {
          navigate('/events');
        }, 2000);
      } else {
        showMessage(data.error, true);
      }
    } catch (error) {
      console.error('Signup network error:', error);
      showMessage('Network error during signup. Please check your connection and try again.', true);
    }
  };

  const handleSignInChange = (e) => {
    setSignInData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  const handleSignUpChange = (e) => {
    const { name, value } = e.target;
    setSignUpData(prev => ({
      ...prev,
      [name]: name === 'usn' ? value.toUpperCase() : value
    }));
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      if (isActive) {
        handleSignUp();
      } else {
        handleSignIn();
      }
    }
  };

  const handleAboutUsClick = () => {
    navigate('/about-us');
  };

  const handleContactUsClick = () => {
    navigate('/about-us#connect-section');
  };

  return (
    <div className="login-page">
      <link
        rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css"
      />

      <button className="button about-us-btn" onClick={handleAboutUsClick}>
        <span className="hoverEffect">
          <div></div>
        </span>
        <span className="button-text">About Us</span>
      </button>

      <button className="button contact-us-btn" onClick={handleContactUsClick}>
        <span className="hoverEffect">
          <div></div>
        </span>
        <span className="button-text">Contact Us</span>
      </button>

      {message.show && (
        <div className={`message ${message.isError ? 'error' : 'success'}`}>
          {message.text}
        </div>
      )}

      <div className={`container ${isActive ? 'active' : ''}`} id="container">
        <div className="form-container sign-up">
          <div onKeyPress={handleKeyPress}>
            <h1>Create Account</h1>
            <input
              type="text"
              name="name"
              placeholder="Name"
              value={signUpData.name}
              onChange={handleSignUpChange}
            />
            <input
              type="text"
              name="usn"
              placeholder="USN"
              value={signUpData.usn}
              onChange={handleSignUpChange}
            />
            <input
              type="number"
              name="sem"
              placeholder="Sem"
              value={signUpData.sem}
              onChange={handleSignUpChange}
            />
            <input
              type="number"
              name="mobno"
              placeholder="Mobile No"
              value={signUpData.mobno}
              onChange={handleSignUpChange}
            />
            <input
              type="text"
              name="email"
              placeholder="email ID"
              value={signUpData.email}
              onChange={handleSignUpChange}
            />
            <input
              type="password"
              name="password"
              placeholder="Password"
              value={signUpData.password}
              onChange={handleSignUpChange}
            />
            <button type="button" onClick={handleSignUp}>
              Sign Up
            </button>
          </div>
        </div>

        <div className="form-container sign-in">
          <div onKeyPress={handleKeyPress}>
            <h1>Sign In</h1>
            <div className="social-icons">
              <a href="#" className="icon">
                <i className="fa-brands fa-google-plus-g"></i>
              </a>
              <a href="#" className="icon">
                <i className="fa-brands fa-facebook-f"></i>
              </a>
              <a href="#" className="icon">
                <i className="fa-brands fa-github"></i>
              </a>
              <a href="#" className="icon">
                <i className="fa-brands fa-linkedin-in"></i>
              </a>
            </div>
            <input
              type="text"
              name="usn"
              placeholder="USN"
              id="usn"
              value={signInData.usn}
              onChange={handleSignInChange}
            />
            <input
              type="password"
              name="password"
              placeholder="Password"
              id="password"
              value={signInData.password}
              onChange={handleSignInChange}
            />
            <a href="#">Forgot Your Password?</a>
            <button type="button" onClick={handleSignIn}>
              Sign In
            </button>
          </div>
        </div>

        <div className="toggle-container">
          <div className="toggle">
            <div className="toggle-panel toggle-left">
              <h1>Welcome Back!</h1>
              <p>Enter your personal details to use all of site features</p>
              <button className="hidden" id="login" onClick={() => setIsActive(false)}>
                Sign In
              </button>
            </div>
            <div className="toggle-panel toggle-right">
              <h1>Hello, Friend!</h1>
              <p>Register with your personal details to Create New Account</p>
              <button className="hidden" id="register" onClick={() => setIsActive(true)}>
                Sign Up
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}