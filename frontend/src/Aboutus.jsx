import React from 'react';
import ProfileCard from './ProfileCard';
import './AboutUs.css';
import member1 from './assets/member1.jpg';
import member2 from './assets/member2.jpg';
import member3 from './assets/member3.jpg';
import member4 from './assets/member4.jpg';

const AboutUs = () => {
  const teamMembers = [
    {
      name: "Tanmay",
      title: "Role/Position",
      handle: "username1",
      status: "Available",
      avatarUrl: member1,
    },
    {
      name: "Suchit",
      title: "Role/Position",
      handle: "username2",
      status: "Available",
      avatarUrl: member2,
    },
    {
      name: "Yashwanth",
      title: "Role/Position",
      handle: "username3",
      status: "Available",
      avatarUrl: member3,
    },
    {
      name: "Member Name 4",
      title: "Role/Position",
      handle: "username4",
      status: "Available",
      avatarUrl: member4,
    }
  ];

  const socialLinks = [
    { name: "LinkedIn", icon: "fab fa-linkedin", url: "#" },
    { name: "GitHub", icon: "fab fa-github", url: "#" },
    { name: "Twitter", icon: "fab fa-twitter", url: "#" },
    { name: "Email", icon: "fas fa-envelope", url: "#" }
  ];

  const handleContactClick = (memberName) => {
    console.log(`Contact clicked for ${memberName}`);
  };

  return (
    <div className="aboutus-container">
      {/* Hero Section */}
      <section className="aboutus-hero">
        <div className="hero-content">
          <h1 className="hero-title">About ePass</h1>
          <div className="hero-underline"></div>
          <p className="hero-description">
            XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
            XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
            XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
            XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
          </p>
        </div>
      </section>

      {/* Team Section */}
      <section className="team-section">
        <h2 className="section-title">Meet Our Team</h2>
        <div className="team-grid">
          {teamMembers.map((member, index) => (
            <div key={index} className="card-wrapper">
              <ProfileCard
                name={member.name}
                title={member.title}
                handle={member.handle}
                status={member.status}
                contactText="Contact"
                avatarUrl={member.avatarUrl}
                showUserInfo={true}
                enableTilt={true}
                enableMobileTilt={false}
                onContactClick={() => handleContactClick(member.name)}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Connect Section */}
      <section className="connect-section">
        <h2 className="connect-title">Connect With Us</h2>
        <div className="social-links">
          {socialLinks.map((link, index) => (
            <a
              key={index}
              href={link.url}
              className="social-link"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={link.name}
            >
              <i className={link.icon}></i>
              <span>{link.name}</span>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
};

export default AboutUs;