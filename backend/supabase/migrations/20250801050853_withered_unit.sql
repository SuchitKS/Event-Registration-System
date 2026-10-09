/*
  # Initial Database Schema Migration

  1. New Tables
    - `student` - Student information with USN as primary key
    - `club` - Club information with auto-incrementing ID
    - `event` - Event details with foreign keys to student and club
    - `memberof` - Junction table for student-club membership
    - `participant` - Event participation tracking
    - `volunteer` - Event volunteering tracking

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to manage their own data
    - Add policies for event organizers to manage their events

  3. Features
    - UUID generation for QR tokens
    - Proper foreign key relationships
    - Default values for status fields
*/

-- Enable UUID extension for QR tokens
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create student table
CREATE TABLE IF NOT EXISTS student (
  usn VARCHAR(10) PRIMARY KEY,
  sname VARCHAR(50) NOT NULL,
  sem INTEGER DEFAULT 1,
  mobno VARCHAR(10),
  emailid VARCHAR(50),
  password VARCHAR(225)
);

-- Create club table
CREATE TABLE IF NOT EXISTS club (
  cid SERIAL PRIMARY KEY,
  cname VARCHAR(255) NOT NULL,
  clubdesc VARCHAR(500),
  clubprezusn VARCHAR(10),
  maxmembers INTEGER DEFAULT 50
);

-- Create event table
CREATE TABLE IF NOT EXISTS event (
  eid SERIAL PRIMARY KEY,
  ename VARCHAR(50) NOT NULL,
  eventdesc VARCHAR(1000),
  eventdate DATE,
  eventtime TIME,
  eventloc VARCHAR(50),
  maxpart INTEGER,
  maxvoln INTEGER,
  orgusn VARCHAR(10),
  orgcid INTEGER,
  regfee DECIMAL(6,2) DEFAULT 0.00
);

-- Create memberof junction table
CREATE TABLE IF NOT EXISTS memberof (
  studentusn VARCHAR(10),
  clubid INTEGER
);

-- Create participant table
CREATE TABLE IF NOT EXISTS participant (
  partusn VARCHAR(10),
  parteid INTEGER,
  partstatus BOOLEAN DEFAULT FALSE,
  qrtoken UUID DEFAULT uuid_generate_v4()
);

-- Create volunteer table
CREATE TABLE IF NOT EXISTS volunteer (
  volnusn VARCHAR(10),
  volneid INTEGER,
  volnstatus BOOLEAN DEFAULT FALSE
);

-- Add foreign key constraints
ALTER TABLE club 
ADD CONSTRAINT club_clubprezusn_fkey 
FOREIGN KEY (clubprezusn) REFERENCES student(usn);

ALTER TABLE event 
ADD CONSTRAINT event_orgusn_fkey 
FOREIGN KEY (orgusn) REFERENCES student(usn);

ALTER TABLE event 
ADD CONSTRAINT event_orgcid_fkey 
FOREIGN KEY (orgcid) REFERENCES club(cid);

ALTER TABLE memberof 
ADD CONSTRAINT memberof_studentusn_fkey 
FOREIGN KEY (studentusn) REFERENCES student(usn);

ALTER TABLE memberof 
ADD CONSTRAINT memberof_clubid_fkey 
FOREIGN KEY (clubid) REFERENCES club(cid);

ALTER TABLE participant 
ADD CONSTRAINT participant_partusn_fkey 
FOREIGN KEY (partusn) REFERENCES student(usn);

ALTER TABLE participant 
ADD CONSTRAINT participant_parteid_fkey 
FOREIGN KEY (parteid) REFERENCES event(eid);

ALTER TABLE volunteer 
ADD CONSTRAINT volunteer_volnusn_fkey 
FOREIGN KEY (volnusn) REFERENCES student(usn);

ALTER TABLE volunteer 
ADD CONSTRAINT volunteer_volneid_fkey 
FOREIGN KEY (volneid) REFERENCES event(eid);

-- Enable Row Level Security
ALTER TABLE student ENABLE ROW LEVEL SECURITY;
ALTER TABLE club ENABLE ROW LEVEL SECURITY;
ALTER TABLE event ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberof ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant ENABLE ROW LEVEL SECURITY;
ALTER TABLE volunteer ENABLE ROW LEVEL SECURITY;

-- RLS Policies for student table
CREATE POLICY "Students can read own data"
  ON student
  FOR SELECT
  TO authenticated
  USING (auth.uid()::text = usn OR EXISTS (
    SELECT 1 FROM student WHERE usn = auth.uid()::text
  ));

CREATE POLICY "Students can update own data"
  ON student
  FOR UPDATE
  TO authenticated
  USING (auth.uid()::text = usn);

CREATE POLICY "Anyone can insert student data"
  ON student
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- RLS Policies for club table
CREATE POLICY "Anyone can read clubs"
  ON club
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Club presidents can update their clubs"
  ON club
  FOR UPDATE
  TO authenticated
  USING (clubprezusn = auth.uid()::text);

CREATE POLICY "Anyone can create clubs"
  ON club
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- RLS Policies for event table
CREATE POLICY "Anyone can read events"
  ON event
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Event organizers can update their events"
  ON event
  FOR UPDATE
  TO authenticated
  USING (orgusn = auth.uid()::text);

CREATE POLICY "Anyone can create events"
  ON event
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- RLS Policies for memberof table
CREATE POLICY "Students can read their memberships"
  ON memberof
  FOR SELECT
  TO authenticated
  USING (studentusn = auth.uid()::text);

CREATE POLICY "Students can manage their memberships"
  ON memberof
  FOR ALL
  TO authenticated
  USING (studentusn = auth.uid()::text);

-- RLS Policies for participant table
CREATE POLICY "Students can read their participations"
  ON participant
  FOR SELECT
  TO authenticated
  USING (partusn = auth.uid()::text OR EXISTS (
    SELECT 1 FROM event WHERE eid = parteid AND orgusn = auth.uid()::text
  ));

CREATE POLICY "Students can manage their participations"
  ON participant
  FOR ALL
  TO authenticated
  USING (partusn = auth.uid()::text OR EXISTS (
    SELECT 1 FROM event WHERE eid = parteid AND orgusn = auth.uid()::text
  ));

-- RLS Policies for volunteer table
CREATE POLICY "Students can read their volunteering"
  ON volunteer
  FOR SELECT
  TO authenticated
  USING (volnusn = auth.uid()::text OR EXISTS (
    SELECT 1 FROM event WHERE eid = volneid AND orgusn = auth.uid()::text
  ));

CREATE POLICY "Students can manage their volunteering"
  ON volunteer
  FOR ALL
  TO authenticated
  USING (volnusn = auth.uid()::text OR EXISTS (
    SELECT 1 FROM event WHERE eid = volneid AND orgusn = auth.uid()::text
  ));

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_student_email ON student(emailid);
CREATE INDEX IF NOT EXISTS idx_event_date ON event(eventdate);
CREATE INDEX IF NOT EXISTS idx_event_organizer ON event(orgusn);
CREATE INDEX IF NOT EXISTS idx_participant_event ON participant(parteid);
CREATE INDEX IF NOT EXISTS idx_participant_student ON participant(partusn);
CREATE INDEX IF NOT EXISTS idx_volunteer_event ON volunteer(volneid);
CREATE INDEX IF NOT EXISTS idx_volunteer_student ON volunteer(volnusn);
CREATE INDEX IF NOT EXISTS idx_memberof_student ON memberof(studentusn);
CREATE INDEX IF NOT EXISTS idx_memberof_club ON memberof(clubid);