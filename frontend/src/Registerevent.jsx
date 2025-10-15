"use client"

import { useEffect, useMemo, useState, useRef } from "react"
import { useNavigate } from "react-router-dom"
import "./registerevent.css"

function formatTime12h(timeString) {
  if (!timeString) return "Time TBA"
  const [hours, minutes] = String(timeString).split(":")
  const hour24 = Number.parseInt(hours, 10)
  if (Number.isNaN(hour24)) return "Time TBA"
  const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24
  const ampm = hour24 >= 12 ? "PM" : "AM"
  return `${hour12}:${minutes} ${ampm}`
}

export default function Registerevent() {
  const navigate = useNavigate()
  const [eventsData, setEventsData] = useState({ upcoming: [], ongoing: [], completed: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState("all")
  const [flash, setFlash] = useState({ type: "", message: "" })
  const timerRef = useRef(null)

  function showFlash(type, message) {
    if (timerRef.current) clearTimeout(timerRef.current)
    setFlash({ type, message })
    timerRef.current = setTimeout(() => setFlash({ type: "", message: "" }), 4000)
  }

  async function loadEvents() {
    try {
      setLoading(true)
      setError("")
      const response = await fetch("http://localhost:3000/api/events", { 
        method: "GET",
        credentials: "include", // CRITICAL: Send cookies with request
        headers: {
          "Content-Type": "application/json"
        }
      })
      
      if (response.status === 401) {
        // User not authenticated, redirect to login
        navigate('/')
        return
      }
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()
      setEventsData({
        upcoming: data?.events?.upcoming || [],
        ongoing: data?.events?.ongoing || [],
        completed: data?.events?.completed || [],
      })
    } catch (err) {
      console.error("Error loading events:", err)
      setError(err?.message || "Failed to load events")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadEvents()
    
    // Cleanup timer on unmount
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const allEvents = useMemo(() => {
    return [
      ...(eventsData.upcoming || []).map((e) => ({ ...e, status: "upcoming" })),
      ...(eventsData.ongoing || []).map((e) => ({ ...e, status: "ongoing" })),
      ...(eventsData.completed || []).map((e) => ({ ...e, status: "completed" })),
    ]
  }, [eventsData])

  const filteredEvents = useMemo(() => {
    if (filter === "all") {
      return allEvents
    }
    return allEvents.filter((e) => e.status === filter)
  }, [allEvents, filter])

  async function handleRegister(eventId) {
    try {
      const response = await fetch(`http://localhost:3000/api/events/${eventId}/join`, {
        method: "POST",
        credentials: "include", // CRITICAL: Send cookies
        headers: { 
          "Content-Type": "application/json" 
        },
      })
      
      const data = await response.json().catch(() => ({}))
      
      if (!response.ok) {
        if (response.status === 401) {
          showFlash("error", "Please sign in to register for events")
          setTimeout(() => navigate('/'), 2000)
          return
        }
        showFlash("error", data?.error || data?.message || "Registration failed")
        return
      }
      
      showFlash("success", data?.message || "Successfully registered for the event!")
      // Reload events to reflect updated registration status
      await loadEvents()
    } catch (err) {
      console.error("Registration error:", err)
      showFlash("error", "Registration failed. Please try again.")
    }
  }

  function handleGoBack() {
    navigate('/events')
  }

  return (
    <main className="registerevent-page">
      {/* CSS-only geometric background */}
      <div className="registerevent-hero-bg" aria-hidden="true" />

      {/* Foreground container */}
      <div className="registerevent-container">
        <div className="registerevent-surface">
          {/* Flash message */}
          {flash.message && (
            <div
              className={`registerevent-flash ${
                flash.type === "success" ? "registerevent-flash-success" : "registerevent-flash-error"
              }`}
              role={flash.type === "error" ? "alert" : "status"}
              aria-live={flash.type === "error" ? "assertive" : "polite"}
            >
              {flash.message}
            </div>
          )}

          {/* Header with filters */}
          <div className="registerevent-header">
            <div className="registerevent-header-text">
              <h1 className="registerevent-title">All Events</h1>
              <p className="registerevent-subtitle">Discover and join events happening around you</p>
            </div>

            <div className="registerevent-filters" role="tablist" aria-label="Event filters">
              {["all", "upcoming", "ongoing", "completed"].map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={filter === key}
                  className={`registerevent-filter-btn${filter === key ? " registerevent-filter-active" : ""}`}
                  onClick={() => setFilter(key)}
                >
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Loading state */}
          {loading && (
            <div className="registerevent-state">
              <div className="registerevent-spinner" />
              <p className="registerevent-muted">Loading events...</p>
            </div>
          )}

          {/* Error state */}
          {!loading && error && (
            <div className="registerevent-state">
              <p className="registerevent-error">Failed to load events</p>
              <button type="button" className="registerevent-retry-btn" onClick={loadEvents}>
                Try Again
              </button>
            </div>
          )}

          {/* No events state */}
          {!loading && !error && filteredEvents.length === 0 && (
            <div className="registerevent-state">
              <p className="registerevent-muted">No events found</p>
            </div>
          )}

          {/* Events list */}
          {!loading && !error && filteredEvents.length > 0 && (
            <div className="registerevent-list">
              {filteredEvents.map((event) => {
                const dateStr = event?.eventDate ? new Date(event.eventDate) : null
                const formattedDate = dateStr
                  ? dateStr.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
                  : "Date TBA"
                const fee = event?.regFee || 0
                const feeText = fee > 0 ? `₹${fee}` : "Free"

                return (
                  <article 
                    key={event.eid} 
                    className="registerevent-card" 
                    aria-labelledby={`event-${event.eid}-title`}
                  >
                    {/* Card header */}
                    <div className="registerevent-card-top">
                      <div className="registerevent-card-title-wrap">
                        <h2 id={`event-${event.eid}-title`} className="registerevent-card-title">
                          {event.ename}
                        </h2>
                        <span className={`registerevent-badge registerevent-badge-${event.status}`}>
                          {event.status}
                        </span>
                      </div>

                      {event.status === "upcoming" && (
                        <button
                          type="button"
                          className="registerevent-register-btn"
                          aria-label={`Register for ${event.ename}`}
                          onClick={() => handleRegister(event.eid)}
                        >
                          <span className="registerevent-btn-border" />
                          <span className="registerevent-btn-fill" />
                          <span className="registerevent-btn-label">Register</span>
                        </button>
                      )}
                    </div>

                    {/* Event description */}
                    {event.eventdesc && (
                      <p className="registerevent-card-desc">{event.eventdesc}</p>
                    )}

                    {/* Event details section */}
                    <h3 className="registerevent-section-title">Event Details</h3>
                    <div className="registerevent-details">
                      <div className="registerevent-detail-row">
                        <p className="registerevent-detail-label">Date & Time</p>
                        <p className="registerevent-detail-value">
                          {formattedDate}, {formatTime12h(event.eventTime)}
                        </p>
                      </div>
                      
                      <div className="registerevent-detail-row">
                        <p className="registerevent-detail-label">Location</p>
                        <p className="registerevent-detail-value">{event.eventLoc || "Location TBA"}</p>
                      </div>
                      
                      <div className="registerevent-detail-row">
                        <p className="registerevent-detail-label">Organizer</p>
                        <p className="registerevent-detail-value">
                          {event.organizerName || event.clubName || "Event Organizer"}
                        </p>
                      </div>
                      
                      <div className="registerevent-detail-row">
                        <p className="registerevent-detail-label">Registration Fee</p>
                        <p className="registerevent-detail-value">{feeText}</p>
                      </div>
                      
                      {event.maxPart && (
                        <div className="registerevent-detail-row">
                          <p className="registerevent-detail-label">Max Participants</p>
                          <p className="registerevent-detail-value">{event.maxPart}</p>
                        </div>
                      )}
                      
                      {event.maxVoln && (
                        <div className="registerevent-detail-row">
                          <p className="registerevent-detail-label">Max Volunteers</p>
                          <p className="registerevent-detail-value">{event.maxVoln}</p>
                        </div>
                      )}
                    </div>

                    {/* About section */}
                    <h3 className="registerevent-section-title">About the Event</h3>
                    <div className="registerevent-about">
                      {event.eventdesc ||
                        "Join us for this exciting event! More details will be available soon. Don't miss this opportunity to be part of something special."}
                    </div>
                  </article>
                )
              })}
            </div>
          )}

          {/* Back button */}
          <div className="registerevent-back">
            <button
              type="button"
              className="registerevent-back-btn"
              onClick={handleGoBack}
            >
              ← Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}