require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const { createClient } = require('redis');
const Brevo = require('@getbrevo/brevo');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');

const QR_TOKEN_SECRET = process.env.QR_TOKEN_SECRET;
const QR_TOKEN_VALIDITY_MS = 18000;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = '7d';

if (!QR_TOKEN_SECRET) throw new Error('QR_TOKEN_SECRET is required');
if (!JWT_SECRET) throw new Error('JWT_SECRET is required');

const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const streamifier = require('streamifier');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function uploadFromBuffer(buffer) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ folder: 'flo-banners' }, (error, result) => {
            if (error) return reject(error);
            resolve(result);
        });
        streamifier.createReadStream(buffer).pipe(stream);
    });
}

// ─── Brevo email ───────────────────────────────────────────────────────────────
const apiInstance = new Brevo.TransactionalEmailsApi();
const apiKey = apiInstance.authentications['apiKey'];
apiKey.apiKey = process.env.BREVO_API_KEY;

// ─── Neon (pg) pool ────────────────────────────────────────────────────────────
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});
pool.on('error', (err) => console.error('❌ Unexpected PG pool error:', err.message || err));

async function query(text, params) {
    if (!IS_PRODUCTION) {
        const cleanSql = text.replace(/\s+/g, ' ').trim();
        console.log(`   🗄️ SQL: ${cleanSql.length > 120 ? cleanSql.substring(0, 120) + '...' : cleanSql}`);
    }
    const client = await pool.connect();
    try {
        const res = await client.query(text, params);
        return res.rows;
    } finally {
        client.release();
    }
}

async function queryOne(text, params) {
    const rows = await query(text, params);
    return rows[0] || null;
}

async function queryCount(text, params) {
    const rows = await query(text, params);
    return parseInt(rows[0]?.count || '0', 10);
}

function signToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function extractDept(usn) {
    const match = usn?.toUpperCase().match(/^1[A-Z]{2}\d{2}([A-Z]{2})\d{3}$/);
    return match ? match[1] : null;
}

// ─── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

// ─── Logging Middleware ────────────────────────────────────────────────────────
app.use((req, res, next) => {
    const start = Date.now();
    const timestamp = new Date().toLocaleTimeString();

    // Log Request
    const userSuffix = req.session?.userUSN ? ` (${req.session.userUSN})` : '';
    console.log(`[${timestamp}] 📡 ${req.method} ${req.url}${userSuffix}`);
    if (req.body && Object.keys(req.body).length > 0) {
        const maskedBody = { ...req.body };
        const secrets = ['password', 'newPassword', 'currentPassword', 'newPin', 'confirmPin', 'otp', 'token'];
        secrets.forEach(s => { if (maskedBody[s]) maskedBody[s] = '******'; });
        const bodyStr = JSON.stringify(maskedBody);
        console.log(`   📦 Body: ${bodyStr.length > 200 ? bodyStr.substring(0, 200) + '...' : bodyStr}`);
    }

    // Intercept Response
    const originalSend = res.send;
    res.send = function (data) {
        const duration = Date.now() - start;
        const status = res.statusCode;
        const emoji = status >= 400 ? '❌' : '✅';
        console.log(`[${timestamp}] ${emoji} ${status} ${req.method} ${req.url} — ${duration}ms`);
        return originalSend.apply(res, arguments);
    };
    next();
});

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false });
app.use(limiter);

const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

let redisClient = { isOpen: false, get: async () => null, set: async () => null, del: async () => null, connect: async () => { } };
let redisActive = false;

(async () => {
    try {
        if (!process.env.REDIS_URL) {
            console.log('⚠️ No REDIS_URL set — running without Redis cache');
            return;
        }

        const realClient = createClient({
            url: process.env.REDIS_URL,
            socket: {
                tls: true,
                rejectUnauthorized: false,
                connectTimeout: 5000,
                reconnectStrategy: (r) => (r > 2 ? false : 1000),
            },
        });
        realClient.on('error', (err) => {
            console.log('⚠️ Redis error:', err.message);
        });
        realClient.on('connect', () => {
            console.log('✅ Connected to Redis Cloud (cache only)');
            redisActive = true;
        });
        realClient.on('end', () => {
            console.log('⚠️ Redis disconnected');
            redisActive = false;
        });
        await realClient.connect();
        redisClient = realClient;
    } catch (err) {
        console.log('⚠️ Redis unavailable — running without cache (non-fatal)');
        redisActive = false;
    }
})();

if (IS_PRODUCTION) app.set('trust proxy', 1);

const allowedOrigins = [
    process.env.FRONTEND_URL,
    'https://www.flobms.com',
    'https://flobms.com',
    'http://localhost:5173',
    'http://localhost:3000',
].filter(Boolean);

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors());

// ─── Passport Google OAuth ─────────────────────────────────────────────────────
app.use(passport.initialize());

// Strip trailing slashes to prevent double-slash in OAuth redirect URIs
const BACKEND_URL = (process.env.BACKEND_URL || '').replace(/\/+$/, '');
const FRONTEND_URL_BASE = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${BACKEND_URL}/auth/google/callback`,
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const email = profile.emails?.[0]?.value;
        const googleId = profile.id;
        const name = profile.displayName || email?.split('@')[0] || 'User';

        let student = await queryOne('SELECT usn, sname, emailid, google_id FROM student WHERE google_id = $1 OR emailid = $2 LIMIT 1', [googleId, email]);

        if (student && !student.google_id) {
            await query('UPDATE student SET google_id = $1 WHERE usn = $2', [googleId, student.usn]);
        }

        return done(null, { student, googleId, email, name });
    } catch (err) {
        return done(err);
    }
}));

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account', session: false }));

app.get('/auth/google/callback', passport.authenticate('google', { session: false, failureRedirect: `${FRONTEND_URL_BASE}/login?error=google_failed` }),
    async (req, res) => {
        const { student, googleId, email, name } = req.user;

        if (student) {
            const token = signToken({ usn: student.usn, name: student.sname, email: student.emailid });
            return res.redirect(`${FRONTEND_URL_BASE}/auth/callback?token=${token}&needs_onboarding=false`);
        } else {
            const onboardingToken = signToken({ googleId, email, name, onboarding: true });
            const encodedName = encodeURIComponent(name);
            return res.redirect(`${FRONTEND_URL_BASE}/auth/callback?token=${onboardingToken}&needs_onboarding=true&name=${encodedName}`);
        }
    }
);

// ─── Auth Middleware ────────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Please sign in first' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.onboarding) {
            return res.status(401).json({ error: 'Please complete your profile setup first.', needsOnboarding: true });
        }
        const student = await queryOne('SELECT usn, sname, emailid FROM student WHERE usn = $1', [decoded.usn]);
        if (!student) return res.status(401).json({ error: 'Account not found. Please sign in again.' });
        req.session = { userUSN: student.usn, userName: student.sname, userEmail: student.emailid };
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }
}

async function requireAuthToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Please sign in first' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.session = {
            userUSN: decoded.usn || null,
            userEmail: decoded.email,
            googleId: decoded.googleId || null,
            userName: decoded.name || null,
            isOnboarding: !!decoded.onboarding,
        };
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }
}

app.get('/', (req, res) => res.send('🚀 Flobms backend server is running successfully'));
app.get('/health', (req, res) => res.json({ ok: true }));

// ─── Complete Auth Routes ───────────────────────────────────────────────────────

app.post('/api/signup', async (req, res) => {
    try {
        const { name, usn, sem, mobno, email, password, organizerPin } = req.body;
        if (!usn || !name || !email || !sem || !mobno || !password) return res.status(400).json({ error: 'All fields are required' });

        const existing = await queryOne('SELECT usn FROM student WHERE usn = $1 OR emailid = $2 LIMIT 1', [usn, email]);
        if (existing) return res.status(400).json({ error: 'Student with this USN or email already exists' });

        const hashedPassword = await bcrypt.hash(password, 12);
        const hashedPin = organizerPin ? await bcrypt.hash(organizerPin, 10) : null;

        await query(
            `INSERT INTO student (usn, sname, sem, mobno, emailid, password_hash, organizer_pin) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [usn.toUpperCase(), name, parseInt(sem), mobno, email, hashedPassword, hashedPin]
        );

        const token = signToken({ usn: usn.toUpperCase(), name, email });
        res.status(201).json({ success: true, message: 'Student registered successfully!', token, userUSN: usn.toUpperCase(), userName: name });
    } catch (err) {
        res.status(500).json({ error: `Error registering student: ${err.message}` });
    }
});

app.post('/api/signin', async (req, res) => {
    try {
        const { usn, password } = req.body;
        if (!usn || !password) return res.status(400).json({ error: 'USN and password are required' });

        const student = await queryOne('SELECT usn, sname, emailid, password_hash FROM student WHERE usn = $1', [usn.toUpperCase()]);
        if (!student) return res.status(401).json({ error: 'Invalid USN or password' });

        if (!student.password_hash) return res.status(401).json({ error: 'This account uses Google Sign-In. Please use "Continue with Google".' });
        const match = await bcrypt.compare(password, student.password_hash);
        if (!match) return res.status(401).json({ error: 'Invalid USN or password' });

        const token = signToken({ usn: student.usn, name: student.sname, email: student.emailid });
        res.json({ success: true, message: 'Signed in successfully', token, userUSN: student.usn, userName: student.sname });
    } catch (err) {
        res.status(500).json({ error: `Error signing in: ${err.message}` });
    }
});

app.post('/api/signout', async (req, res) => {
    res.json({ success: true, message: 'Signed out successfully' });
});

app.get('/api/me', requireAuth, async (req, res) => {
    try {
        const student = await queryOne('SELECT usn, sname, sem, mobno, emailid, organizer_pin, google_id, password_hash FROM student WHERE usn = $1', [req.session.userUSN]);
        if (!student) return res.status(404).json({ error: 'User not found' });
        
        // NEW: Check if this user is an approved organizer
        const orgReq = await queryOne("SELECT id FROM organizer_request WHERE usn = $1 AND status = 'approved' LIMIT 1", [req.session.userUSN]);
        
        res.json({
            userUSN: student.usn, userName: student.sname, semester: student.sem,
            mobile: student.mobno, email: student.emailid,
            hasPinSet: !!student.organizer_pin,
            hasGoogleIdentity: !!student.google_id,
            hasPasswordIdentity: !!student.password_hash,
            isOrganiser: !!orgReq  // This passes the flag to your events.jsx page!
        });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching user info' });
    }
});

app.put('/api/profile', requireAuth, async (req, res) => {
    try {
        const { sname, sem, mobno } = req.body;
        if (!sname || !sem || !mobno) return res.status(400).json({ error: 'All fields are required' });
        if (!/^\d{10}$/.test(mobno)) return res.status(400).json({ error: 'Mobile must be 10 digits' });
        const semNum = parseInt(sem, 10);
        if (semNum < 1 || semNum > 8) return res.status(400).json({ error: 'Semester must be 1-8' });
        await query('UPDATE student SET sname = $1, sem = $2, mobno = $3 WHERE usn = $4', [sname, semNum, mobno, req.session.userUSN]);
        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/change-password', requireAuth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both fields are required' });
        if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

        const student = await queryOne('SELECT password_hash FROM student WHERE usn = $1', [req.session.userUSN]);
        if (!student?.password_hash) return res.status(400).json({ error: 'This account uses Google Sign-In and has no password to change.' });

        const match = await bcrypt.compare(currentPassword, student.password_hash);
        if (!match) return res.status(400).json({ error: 'Current password is incorrect' });

        const newHash = await bcrypt.hash(newPassword, 12);
        await query('UPDATE student SET password_hash = $1 WHERE usn = $2', [newHash, req.session.userUSN]);

        const s = await queryOne('SELECT usn, sname, emailid FROM student WHERE usn = $1', [req.session.userUSN]);
        const token = signToken({ usn: s.usn, name: s.sname, email: s.emailid });
        res.json({ success: true, message: 'Password changed successfully', token });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Set password for Google-only users (no existing password)
app.post('/api/set-password', requireAuth, async (req, res) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword) return res.status(400).json({ error: 'New password is required' });
        if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

        const student = await queryOne('SELECT password_hash FROM student WHERE usn = $1', [req.session.userUSN]);
        if (student?.password_hash) return res.status(400).json({ error: 'You already have a password. Use Change Password instead.' });

        const newHash = await bcrypt.hash(newPassword, 12);
        await query('UPDATE student SET password_hash = $1 WHERE usn = $2', [newHash, req.session.userUSN]);

        const s = await queryOne('SELECT usn, sname, emailid FROM student WHERE usn = $1', [req.session.userUSN]);
        const token = signToken({ usn: s.usn, name: s.sname, email: s.emailid });
        res.json({ success: true, message: 'Password set successfully!', token });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const student = await queryOne('SELECT usn, sname FROM student WHERE emailid = $1', [email]);
        if (student) {
            const resetToken = jwt.sign({ usn: student.usn, purpose: 'reset' }, JWT_SECRET, { expiresIn: '15m' });
            const resetLink = `${FRONTEND_URL_BASE}/reset-password?token=${resetToken}`;
            const sendSmtpEmail = new Brevo.SendSmtpEmail();
            sendSmtpEmail.subject = 'Reset Your FLO Password';
            sendSmtpEmail.sender = { name: 'FLO E-Pass System', email: 'flobms3@gmail.com' };
            sendSmtpEmail.to = [{ email, name: student.sname }];
            sendSmtpEmail.htmlContent = `
                <html><body style="font-family: Arial, sans-serif; background:#f5f0e8; padding:20px;">
                <div style="max-width:500px;margin:0 auto;background:#fff;border:3px solid #0D0D0D;padding:32px;box-shadow:5px 5px 0 #0D0D0D;">
                    <h2 style="font-family:monospace;text-transform:uppercase;letter-spacing:2px;margin:0 0 8px;">FLO</h2>
                    <div style="height:4px;background:#FFD600;width:40px;margin-bottom:24px;"></div>
                    <p>Hello <strong>${student.sname}</strong>,</p>
                    <p>Click the button below to reset your password. This link expires in <strong>15 minutes</strong>.</p>
                    <a href="${resetLink}" style="display:inline-block;background:#0D0D0D;color:#FFD600;font-family:monospace;font-weight:700;padding:14px 28px;text-decoration:none;letter-spacing:1px;margin:16px 0;">RESET PASSWORD →</a>
                    <p style="color:#999;font-size:12px;margin-top:24px;">If you did not request this, ignore this email.</p>
                </div></body></html>`;
            try {
                await apiInstance.sendTransacEmail(sendSmtpEmail);
                console.log(`✅ Password reset email sent to ${email}`);
            } catch (e) {
                console.error('❌ Brevo email error (forgot-password):', e?.response?.body || e?.message || e);
                return res.status(500).json({ error: 'Failed to send reset email. Please try again later.' });
            }
        } else {
            // No need for a log here as the 200 response will be logged by middleware
        }
        res.json({ success: true, message: 'If an account exists, you will receive a reset link.' });
    } catch (err) {
        console.error('❌ forgot-password route error:', err);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

app.post('/api/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required' });
        if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters long' });

        let decoded;
        try { decoded = jwt.verify(token, JWT_SECRET); } catch (e) { return res.status(400).json({ error: 'Invalid or expired reset link.' }); }
        if (decoded.purpose !== 'reset') return res.status(400).json({ error: 'Invalid reset token.' });

        const newHash = await bcrypt.hash(newPassword, 12);
        await query('UPDATE student SET password_hash = $1 WHERE usn = $2', [newHash, decoded.usn]);

        const student = await queryOne('SELECT sname FROM student WHERE usn = $1', [decoded.usn]);
        res.json({ success: true, message: 'Password reset successfully! You can now sign in with your new password.', userName: student?.sname || '' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

app.get('/api/complete-google-signup', requireAuthToken, async (req, res) => {
    try {
        if (req.session.userUSN) {
            const student = await queryOne('SELECT usn, sname FROM student WHERE usn = $1', [req.session.userUSN]);
            if (student) return res.json({ needsOnboarding: false, userUSN: student.usn, userName: student.sname });
        }
        res.json({ needsOnboarding: true, email: req.session.userEmail || '', name: req.session.userName || '' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to check onboarding status' });
    }
});

app.post('/api/complete-google-signup', requireAuthToken, async (req, res) => {
    try {
        if (!req.session.isOnboarding) return res.status(400).json({ error: 'Not in onboarding flow' });
        const { usn, sem, mobno, organizerPin } = req.body;
        if (!usn || !sem || !mobno) return res.status(400).json({ error: 'USN, semester and mobile are required' });
        if (organizerPin && !/^\d{4,6}$/.test(organizerPin)) return res.status(400).json({ error: 'Organizer PIN must be 4 to 6 digits' });

        const existing = await queryOne('SELECT usn FROM student WHERE usn = $1', [usn.toUpperCase()]);
        if (existing) return res.status(400).json({ error: 'This USN is already registered' });

        const name = req.session.userName || req.session.userEmail.split('@')[0];
        const email = req.session.userEmail;
        const googleId = req.session.googleId;
        const hashedPin = organizerPin ? await bcrypt.hash(organizerPin, 10) : null;

        await query(
            `INSERT INTO student (usn, sname, sem, mobno, emailid, google_id, organizer_pin) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [usn.toUpperCase(), name, parseInt(sem), mobno, email, googleId, hashedPin]
        );

        const token = signToken({ usn: usn.toUpperCase(), name, email });
        res.json({ success: true, userName: name, userUSN: usn.toUpperCase(), token });
    } catch (err) {
        res.status(500).json({ error: 'Failed to complete setup' });
    }
});


// ─── Events Business Logic ──────────────────────────────────────────────────────

app.get('/api/events', requireAuth, async (req, res) => {
    try {
        const currentDate = new Date().toISOString().split('T')[0];
        const rows = await query(`
            SELECT e.*, c.cname AS club_cname, s.sname AS organizer_name
            FROM event e
            LEFT JOIN club c ON e.orgcid = c.cid
            LEFT JOIN student s ON e.orgusn = s.usn
        `);

        const events = { ongoing: [], completed: [], upcoming: [] };
        (rows || []).forEach(event => {
            const transformedEvent = {
                ...event,
                eventDate: event.eventdate, eventTime: event.eventtime, eventLoc: event.eventloc,
                maxPart: event.maxpart, maxVoln: event.maxvoln, regFee: event.regfee,
                upiId: event.upi_id, posterUrl: event.poster_url, bannerUrl: event.banner_url,
                activityPoints: event.activity_points || 0, maxActivityPts: event.max_activity_pts || 0,
                volActivityPts: event.vol_activity_pts || 0,
                certificateInfo: event.certificate_info,
                clubName: event.club_cname, organizerName: event.organizer_name
            };
            const eventDateStr = new Date(event.eventdate).toISOString().split('T')[0];
            if (eventDateStr === currentDate) events.ongoing.push(transformedEvent);
            else if (eventDateStr < currentDate) events.completed.push(transformedEvent);
            else events.upcoming.push(transformedEvent);
        });
        res.json({ events, currentUser: req.session.userUSN });
    } catch (err) {
        console.error("Error in /api/events:", err);
        res.status(500).json({ error: 'Error fetching events' });
    }
});

app.get('/api/events/:eventId', requireAuth, async (req, res) => {
    try {
        const eventId = req.params.eventId;
        if (!eventId || isNaN(eventId)) return res.status(400).json({ error: 'Invalid event ID' });

        const event = await queryOne(`
            SELECT e.*, c.cname AS club_cname, s.sname AS organizer_name
            FROM event e
            LEFT JOIN club c ON e.orgcid = c.cid
            LEFT JOIN student s ON e.orgusn = s.usn
            WHERE e.eid = $1 LIMIT 1
        `, [eventId]);

        if (!event) return res.status(404).json({ error: 'Event not found' });

        const transformedEvent = {
            ...event,
            eventDate: event.eventdate, eventTime: event.eventtime, eventLoc: event.eventloc,
            maxPart: event.maxpart, maxVoln: event.maxvoln, regFee: event.regfee,
            upiId: event.upi_id, posterUrl: event.poster_url, bannerUrl: event.banner_url,
            activityPoints: event.activity_points || 0,
            maxActivityPts: event.max_activity_pts || 0, volActivityPts: event.vol_activity_pts || 0,
            minPartScans: event.min_part_scans || 1, minVolnScans: event.min_voln_scans || 1,
            certificateInfo: event.certificate_info,
            clubName: event.club_cname, organizerName: event.organizer_name, OrgUsn: event.orgusn
        };

        const participantCheck = await queryOne('SELECT partstatus, payment_status FROM participant WHERE partusn = $1 AND parteid = $2 LIMIT 1', [req.session.userUSN, eventId]);
        const volunteerCheck = await queryOne('SELECT volnstatus FROM volunteer WHERE volnusn = $1 AND volneid = $2 LIMIT 1', [req.session.userUSN, eventId]);

        transformedEvent.isRegistered = !!participantCheck;
        transformedEvent.paymentStatus = participantCheck?.payment_status || null;
        transformedEvent.isVolunteer = !!volunteerCheck;
        transformedEvent.isOrganizer = event.orgusn === req.session.userUSN;
        res.json(transformedEvent);
    } catch (err) {
        res.status(500).json({ error: 'Error fetching event details: ' + err.message });
    }
});

app.post('/api/events/create', requireAuth, upload.single('banner'), async (req, res) => {
    try {
        const {
            eventName, eventDescription, certificate_info, posterUrl,
            eventDate, eventTime, eventLocation, maxParticipants, maxVolunteers,
            registrationFee, clubId, OrgCid, upiId, isTeamEvent,
            minTeamSize, maxTeamSize, activityPoints, maxActivityPts,
            volActivityPts, minPartScans, minVolnScans
        } = req.body;
        const file = req.file;
        let finalBannerUrl = null;

        if (file) {
            try {
                const result = await uploadFromBuffer(file.buffer);
                finalBannerUrl = result.secure_url;
            } catch (uploadErr) {
                return res.status(500).json({ error: 'Failed to upload banner image' });
            }
        }

        const organizedClubId = (clubId || OrgCid) ? parseInt(clubId || OrgCid) : null;
        const fee = parseFloat(registrationFee) || 0;
        const isTeam = isTeamEvent === 'true' || isTeamEvent === true;
        const points = parseInt(activityPoints) || 0;

        if (organizedClubId) {
            const memberCheck = await queryOne('SELECT clubid FROM memberof WHERE studentusn = $1 AND clubid = $2 LIMIT 1', [req.session.userUSN, organizedClubId]);
            if (!memberCheck) return res.status(403).json({ error: 'Unauthorized: You are not a member of this club and cannot organize events for it.' });
        }
        if (!eventName || !eventDescription || !eventDate || !eventTime || !eventLocation) {
            return res.status(400).json({ error: 'Required fields missing' });
        }
        if (fee > 0 && (!upiId || upiId.trim() === '')) {
            return res.status(400).json({ error: 'UPI ID is required for paid events' });
        }

        const newEvent = await queryOne(`
            INSERT INTO event (
                ename, eventdesc, certificate_info, poster_url, banner_url, eventdate, eventtime, eventloc,
                maxpart, maxvoln, regfee, upi_id, orgusn, orgcid, is_team, min_team_size, max_team_size,
                activity_points, max_activity_pts, vol_activity_pts, min_part_scans, min_voln_scans
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
            ) RETURNING eid
        `, [
            eventName, eventDescription, certificate_info || null, posterUrl || null, finalBannerUrl,
            eventDate, eventTime, eventLocation, maxParticipants ? parseInt(maxParticipants) : null,
            maxVolunteers ? parseInt(maxVolunteers) : null, fee, fee > 0 ? upiId : null,
            req.session.userUSN, organizedClubId || null, isTeam, isTeam ? (parseInt(minTeamSize) || null) : null,
            isTeam ? (parseInt(maxTeamSize) || null) : null, points, parseInt(maxActivityPts) || 0,
            parseInt(volActivityPts) || 0, parseInt(minPartScans) || 1, parseInt(minVolnScans) || 1
        ]);

        const newEventId = newEvent.eid;
        await query(`INSERT INTO sub_event (eid, se_name, se_details, activity_pts) VALUES ($1, $2, $3, $4)`,
            [newEventId, eventName, '', parseInt(maxActivityPts) || 0]
        );

        res.status(201).json({ success: true, message: 'Event created successfully!', eventId: newEventId });
    } catch (err) {
        console.error('Error creating event:', err);
        res.status(500).json({ error: `Error creating event: ${err.message}` });
    }
});

app.get('/api/my-participant-events', requireAuth, async (req, res) => {
    try {
        const userUSN = req.session.userUSN;
        const participantEvents = await query(`
            SELECT p.*, e.*, c.cname AS club_cname
            FROM participant p
            JOIN event e ON p.parteid = e.eid
            LEFT JOIN club c ON e.orgcid = c.cid
            WHERE p.partusn = $1
        `, [userUSN]);

        const transformedEvents = [];
        for (const e of participantEvents) {
            let earnedActivityPts = 0;
            const maxActivityPts = e.max_activity_pts || 0;
            if (maxActivityPts > 0 && e.partstatus) {
                const attendance = await query(`
                    SELECT se.activity_pts 
                    FROM sub_event_attendance sea
                    JOIN sub_event se ON sea.seid = se.seid
                    WHERE sea.eid = $1 AND sea.usn = $2 AND sea.role = 'participant'
                `, [e.eid, userUSN]);

                const sum = attendance.reduce((s, row) => s + (row.activity_pts || 0), 0);
                earnedActivityPts = Math.min(sum, maxActivityPts);
            }
            transformedEvents.push({
                ...e,
                eventDate: e.eventdate, eventTime: e.eventtime, eventLoc: e.eventloc,
                maxPart: e.maxpart, maxVoln: e.maxvoln, regFee: e.regfee,
                posterUrl: e.poster_url, bannerUrl: e.banner_url,
                activityPoints: e.activity_points || 0,
                maxActivityPts, earnedActivityPts, clubName: e.club_cname,
                PartStatus: e.partstatus == true, PartUSN: e.partusn, role: 'participant'
            });
        }
        res.json({ participantEvents: transformedEvents, userUSN });
    } catch (err) {
        console.error("Error in /api/my-participant-events:", err);
        res.status(500).json({ error: 'Error fetching participant events' });
    }
});

app.get('/api/my-volunteer-events', requireAuth, async (req, res) => {
    try {
        const userUSN = req.session.userUSN;
        const volunteerEvents = await query(`
            SELECT v.*, e.*, c.cname AS club_cname
            FROM volunteer v
            JOIN event e ON v.volneid = e.eid
            LEFT JOIN club c ON e.orgcid = c.cid
            WHERE v.volnusn = $1
        `, [userUSN]);

        const transformedEvents = volunteerEvents.map(e => {
            const volActivityPts = e.vol_activity_pts || 0;
            return {
                ...e,
                eventDate: e.eventdate, eventTime: e.eventtime, eventLoc: e.eventloc,
                maxPart: e.maxpart, maxVoln: e.maxvoln, regFee: e.regfee,
                posterUrl: e.poster_url, bannerUrl: e.banner_url,
                volActivityPts, earnedActivityPts: e.volnstatus ? volActivityPts : 0,
                clubName: e.club_cname, VolnStatus: e.volnstatus == true, role: 'volunteer'
            };
        });
        res.json({ volunteerEvents: transformedEvents, userUSN });
    } catch (err) {
        console.error("Error in /api/my-volunteer-events:", err);
        res.status(500).json({ error: 'Error fetching volunteer events' });
    }
});

app.get('/api/my-organized-events', requireAuth, async (req, res) => {
    try {
        const organizerEvents = await query(`
            SELECT e.*, c.cname AS club_cname
            FROM event e
            LEFT JOIN club c ON e.orgcid = c.cid
            WHERE e.orgusn = $1
        `, [req.session.userUSN]);

        const transformedEvents = organizerEvents.map(e => ({
            ...e,
            eventDate: e.eventdate, eventTime: e.eventtime, eventLoc: e.eventloc,
            maxPart: e.maxpart, maxVoln: e.maxvoln, regFee: e.regfee,
            upiId: e.upi_id, posterUrl: e.poster_url, bannerUrl: e.banner_url,
            activityPoints: e.activity_points || 0, clubName: e.club_cname, role: 'organizer'
        }));
        res.json({ organizerEvents: transformedEvents, userUSN: req.session.userUSN });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching organized events' });
    }
});

app.post('/api/events/:eventId/join', requireAuth, async (req, res) => {
    try {
        const eventId = req.params.eventId;
        const userUSN = req.session.userUSN;

        const existing = await queryOne('SELECT * FROM participant WHERE partusn = $1 AND parteid = $2 LIMIT 1', [userUSN, eventId]);
        if (existing) return res.status(400).json({ error: 'Already joined this event' });

        const event = await queryOne('SELECT maxpart, regfee, orgusn FROM event WHERE eid = $1 LIMIT 1', [eventId]);
        if (!event) return res.status(404).json({ error: 'Event not found' });
        if (event.orgusn === userUSN) return res.status(403).json({ error: 'You cannot register as a participant in an event you are organizing' });

        const volCheck = await queryOne('SELECT volnusn FROM volunteer WHERE volnusn = $1 AND volneid = $2 LIMIT 1', [userUSN, eventId]);
        if (volCheck) return res.status(403).json({ error: 'You are already volunteering for this event. Volunteers cannot also register as participants.' });

        const regFee = event.regfee || 0;
        if (regFee > 0) return res.status(400).json({ error: 'This is a paid event. Please use the UPI payment flow.', requiresPayment: true });

        const maxPart = event.maxpart || 0;
        if (maxPart > 0) {
            const count = await queryCount('SELECT count(*) FROM participant WHERE parteid = $1', [eventId]);
            if (count >= maxPart) return res.status(400).json({ error: 'No more participant slots available' });
        }

        await query('INSERT INTO participant (partusn, parteid, partstatus, payment_status) VALUES ($1, $2, false, $3)', [userUSN, eventId, 'free']);
        res.json({ success: true, message: 'Successfully joined event!', userUSN });
    } catch (err) {
        res.status(500).json({ error: 'Error joining event' });
    }
});

app.post('/api/events/:eventId/volunteer', requireAuth, async (req, res) => {
    try {
        const eventId = req.params.eventId;
        const userUSN = req.session.userUSN;

        const existing = await queryOne('SELECT * FROM volunteer WHERE volnusn = $1 AND volneid = $2 LIMIT 1', [userUSN, eventId]);
        if (existing) return res.status(400).json({ error: 'Already volunteered for this event' });

        const event = await queryOne('SELECT maxvoln FROM event WHERE eid = $1 LIMIT 1', [eventId]);
        if (!event) return res.status(404).json({ error: 'Event not found' });

        const partCheck = await queryOne('SELECT partusn FROM participant WHERE partusn = $1 AND parteid = $2 LIMIT 1', [userUSN, eventId]);
        if (partCheck) return res.status(403).json({ error: 'You are already registered as a participant for this event. Participants cannot also volunteer.' });

        const maxVoln = event.maxvoln || 0;
        if (maxVoln > 0) {
            const count = await queryCount('SELECT count(*) FROM volunteer WHERE volneid = $1', [eventId]);
            if (count >= maxVoln) return res.status(400).json({ error: 'No more volunteer slots available' });
        }

        await query('INSERT INTO volunteer (volnusn, volneid, volnstatus) VALUES ($1, $2, false)', [userUSN, eventId]);
        res.json({ success: true, message: 'Successfully volunteered for event!' });
    } catch (err) {
        res.status(500).json({ error: 'Error volunteering for event' });
    }
});

app.get('/api/events/:eventId/volunteer-count', requireAuth, async (req, res) => {
    try {
        const count = await queryCount('SELECT count(*) FROM volunteer WHERE volneid = $1', [req.params.eventId]);
        res.json({ count });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching volunteer count' });
    }
});

app.get('/api/events/:eventId/participant-count', requireAuth, async (req, res) => {
    try {
        const count = await queryCount('SELECT count(*) FROM participant WHERE parteid = $1', [req.params.eventId]);
        res.json({ count });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching participant count' });
    }
});

app.get('/api/events/:eventId/participant-status', requireAuth, async (req, res) => {
    try {
        const eventId = req.params.eventId;
        const event = await queryOne(`
            SELECT e.eid, e.ename, e.eventdesc, e.eventdate, e.eventtime, e.eventloc, e.maxpart, e.regfee, c.cname AS club_cname
            FROM event e LEFT JOIN club c ON e.orgcid = c.cid WHERE e.eid = $1 LIMIT 1
        `, [eventId]);

        if (!event) return res.status(404).json({ error: 'Event not found' });

        const participant = await queryOne('SELECT partstatus, payment_status FROM participant WHERE parteid = $1 AND partusn = $2 LIMIT 1', [eventId, req.session.userUSN]);
        if (!participant) return res.json({ isRegistered: false, ename: event.ename });

        res.json({
            isRegistered: true, ename: event.ename, clubName: event.club_cname,
            eventDate: event.eventdate, eventTime: event.eventtime, eventLoc: event.eventloc,
            eventdesc: event.eventdesc, regFee: event.regfee, maxPart: event.maxpart,
            paymentStatus: participant.payment_status || (event.regfee > 0 ? 'pending' : 'verified')
        });
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

app.get('/api/events/:eventId/sub-events', requireAuth, async (req, res) => {
    try {
        const subEvents = await query('SELECT * FROM sub_event WHERE eid = $1 ORDER BY seid ASC', [req.params.eventId]);
        const subEventsWithCount = await Promise.all(subEvents.map(async (se) => {
            const count = await queryCount('SELECT count(*) FROM sub_event_attendance WHERE seid = $1', [se.seid]);
            return { ...se, attendanceCount: count };
        }));
        res.json({ subEvents: subEventsWithCount });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching sub-events' });
    }
});

app.post('/api/events/:eventId/sub-events', requireAuth, async (req, res) => {
    try {
        const eventId = req.params.eventId;
        const { se_name, activity_pts, se_details } = req.body;
        if (!se_name) return res.status(400).json({ error: 'Sub-event name is required' });
        if (activity_pts !== undefined && activity_pts < 0) return res.status(400).json({ error: 'Activity points cannot be negative' });

        const event = await queryOne('SELECT orgusn FROM event WHERE eid = $1 LIMIT 1', [eventId]);
        if (!event) return res.status(404).json({ error: 'Event not found' });
        if (event.orgusn !== req.session.userUSN) return res.status(403).json({ error: 'Only the organizer can add sub-events' });

        const newSubEvent = await queryOne(
            `INSERT INTO sub_event (eid, se_name, se_details, activity_pts) VALUES ($1, $2, $3, $4) RETURNING *`,
            [eventId, se_name, se_details || '', parseInt(activity_pts) || 0]
        );
        res.status(201).json(newSubEvent);
    } catch (err) {
        res.status(500).json({ error: 'Error creating sub-event' });
    }
});

app.put('/api/sub-events/:seid', requireAuth, async (req, res) => {
    try {
        const seid = req.params.seid;
        const { se_name, activity_pts, se_details, password } = req.body;
        if (!password) return res.status(400).json({ error: 'Organizer PIN is required to confirm changes' });
        if (activity_pts !== undefined && activity_pts < 0) return res.status(400).json({ error: 'Activity points cannot be negative' });

        const userData = await queryOne('SELECT organizer_pin FROM student WHERE usn = $1', [req.session.userUSN]);
        if (!userData?.organizer_pin) return res.status(400).json({ error: 'You have not set an organizer PIN yet.' });

        const isValid = await bcrypt.compare(password, userData.organizer_pin);
        if (!isValid) return res.status(400).json({ error: 'Incorrect organizer PIN' });

        const subEvent = await queryOne('SELECT eid FROM sub_event WHERE seid = $1 LIMIT 1', [seid]);
        if (!subEvent) return res.status(404).json({ error: 'Sub-event not found' });

        const event = await queryOne('SELECT orgusn FROM event WHERE eid = $1 LIMIT 1', [subEvent.eid]);
        if (event.orgusn !== req.session.userUSN) return res.status(403).json({ error: 'Only the organizer can update sub-events' });

        const updateFields = [];
        const params = [];
        if (se_name !== undefined) { params.push(se_name); updateFields.push(`se_name = $${params.length}`); }
        if (activity_pts !== undefined) { params.push(parseInt(activity_pts) || 0); updateFields.push(`activity_pts = $${params.length}`); }
        if (se_details !== undefined) { params.push(se_details || ''); updateFields.push(`se_details = $${params.length}`); }

        if (updateFields.length === 0) return res.json(subEvent);

        params.push(seid);
        const updatedSubEvent = await queryOne(`UPDATE sub_event SET ${updateFields.join(', ')} WHERE seid = $${params.length} RETURNING *`, params);
        res.json(updatedSubEvent);
    } catch (err) {
        res.status(500).json({ error: 'Error updating sub-event' });
    }
});

app.delete('/api/sub-events/:seid', requireAuth, async (req, res) => {
    try {
        const seid = req.params.seid;
        const { password } = req.body;
        if (!password) return res.status(400).json({ error: 'Organizer PIN is required' });

        const userData = await queryOne('SELECT organizer_pin FROM student WHERE usn = $1', [req.session.userUSN]);
        if (!userData?.organizer_pin) return res.status(400).json({ error: 'You have not set an organizer PIN yet.' });

        const isValid = await bcrypt.compare(password, userData.organizer_pin);
        if (!isValid) return res.status(400).json({ error: 'Incorrect organizer PIN' });

        const subEvent = await queryOne('SELECT eid FROM sub_event WHERE seid = $1 LIMIT 1', [seid]);
        if (!subEvent) return res.status(404).json({ error: 'Sub-event not found' });

        const event = await queryOne('SELECT orgusn FROM event WHERE eid = $1 LIMIT 1', [subEvent.eid]);
        if (event.orgusn !== req.session.userUSN) return res.status(403).json({ error: 'Only the organizer can delete sub-events' });

        const count = await queryCount('SELECT count(*) FROM sub_event WHERE eid = $1', [subEvent.eid]);
        if (count <= 1) return res.status(400).json({ error: 'Cannot delete the last sub-event' });

        await query('DELETE FROM sub_event WHERE seid = $1', [seid]);
        res.json({ success: true, message: 'Sub-event deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Error deleting sub-event' });
    }
});

app.get('/api/clubs', requireAuth, async (req, res) => {
    try {
        const clubs = await query('SELECT cid, cname, clubdesc FROM club');
        res.json({ clubs: clubs || [], userUSN: req.session.userUSN });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching clubs' });
    }
});

app.get('/api/my-clubs', requireAuth, async (req, res) => {
    try {
        const rows = await query(`
            SELECT c.cid, c.cname, c.clubdesc, c.maxmembers 
            FROM memberof m JOIN club c ON m.clubid = c.cid 
            WHERE m.studentusn = $1
        `, [req.session.userUSN]);
        res.json({ clubs: rows || [], userUSN: req.session.userUSN });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching clubs' });
    }
});

app.get('/api/students', requireAuth, async (req, res) => {
    try {
        const students = await query('SELECT usn, sname, sem, mobno, emailid FROM student');
        res.json({ students: students || [], currentUser: req.session.userUSN });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching students: ' + err.message });
    }
});

function validateQRToken(seid, token, timestamp) {
    const now = Date.now();
    const ts = parseInt(timestamp, 10);
    if (isNaN(ts) || now - ts > QR_TOKEN_VALIDITY_MS) return false;
    const payload = `${seid}:${timestamp}`;
    const expected = crypto.createHmac('sha256', QR_TOKEN_SECRET).update(payload).digest('hex').substring(0, 16);
    try {
        return crypto.timingSafeEqual(Buffer.from(token, 'utf8'), Buffer.from(expected, 'utf8'));
    } catch (e) {
        return false;
    }
}

app.post('/api/mark-participant-attendance', requireAuth, async (req, res) => {
    try {
        const { seid, usn, token, timestamp } = req.body;
        if (usn !== req.session.userUSN) return res.status(403).json({ error: 'Unauthorized: USN mismatch' });
        if (!usn || !seid) return res.status(400).json({ error: 'USN and Sub-event ID are required' });
        if (!token || !timestamp) return res.status(400).json({ error: 'QR code is outdated.' });
        if (!validateQRToken(seid, token, timestamp)) return res.status(400).json({ error: 'QR code has expired.' });

        // Redis cache check — prevent duplicate DB hits
        const cacheKey = `attendance:participant:${seid}:${usn}`;
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                console.log(`   🔴 Redis HIT: ${cacheKey} — duplicate blocked`);
                return res.status(400).json({ error: 'Attendance already marked for this sub-event' });
            }
            if (redisActive) console.log(`   🟢 Redis MISS: ${cacheKey} — proceeding to DB`);
        } catch (redisErr) {
            console.log('   ⚠️ Redis read error (ignored):', redisErr.message);
        }

        const subEvent = await queryOne('SELECT eid, se_name FROM sub_event WHERE seid = $1 LIMIT 1', [seid]);
        if (!subEvent) return res.status(404).json({ error: 'Sub-event not found' });
        const eventId = subEvent.eid;

        const existing = await queryOne('SELECT partstatus, payment_status FROM participant WHERE partusn = $1 AND parteid = $2 LIMIT 1', [usn, eventId]);
        if (!existing) return res.status(404).json({ error: 'You are not registered for this event' });
        if (existing.payment_status === 'pending_verification') return res.status(400).json({ error: 'Your payment is pending verification' });

        const existingAttendance = await queryOne('SELECT id FROM sub_event_attendance WHERE seid = $1 AND usn = $2 AND role = $3 LIMIT 1', [seid, usn, 'participant']);
        if (existingAttendance) return res.status(400).json({ error: 'Attendance already marked for this sub-event' });

        await query('INSERT INTO sub_event_attendance (seid, eid, usn, role) VALUES ($1, $2, $3, $4)', [seid, eventId, usn, 'participant']);

        // Cache the attendance in Redis after successful DB insert
        try {
            await redisClient.set(cacheKey, '1', { EX: 3600 });
            if (redisActive) console.log(`   ✅ Redis SET: ${cacheKey} (TTL: 1h)`);
        } catch (redisErr) {
            console.log('   ⚠️ Redis write error (ignored):', redisErr.message);
        }

        const scanCount = await queryCount('SELECT count(*) FROM sub_event_attendance WHERE eid = $1 AND usn = $2 AND role = $3', [eventId, usn, 'participant']);
        const eventData = await queryOne('SELECT min_part_scans FROM event WHERE eid = $1 LIMIT 1', [eventId]);

        const minPartScans = eventData?.min_part_scans || 1;
        const thresholdMet = scanCount >= minPartScans;
        if (thresholdMet) {
            await query('UPDATE participant SET partstatus = true WHERE partusn = $1 AND parteid = $2', [usn, eventId]);
        }
        res.json({ success: true, message: 'Attendance marked successfully', attendanceCount: scanCount, minRequired: minPartScans, thresholdMet });
    } catch (err) {
        res.status(500).json({ error: 'Error marking attendance: ' + err.message });
    }
});

app.post('/api/mark-volunteer-attendance', requireAuth, async (req, res) => {
    try {
        const { seid, usn, token, timestamp } = req.body;
        if (usn !== req.session.userUSN) return res.status(403).json({ error: 'Unauthorized: USN mismatch' });
        if (!usn || !seid) return res.status(400).json({ error: 'USN and Sub-event ID are required' });
        if (!token || !timestamp) return res.status(400).json({ error: 'QR code is outdated.' });
        if (!validateQRToken(seid, token, timestamp)) return res.status(400).json({ error: 'QR code has expired.' });

        // Redis cache check — prevent duplicate DB hits
        const cacheKey = `attendance:volunteer:${seid}:${usn}`;
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                console.log(`   🔴 Redis HIT: ${cacheKey} — duplicate blocked`);
                return res.status(400).json({ error: 'Attendance already marked for this sub-event' });
            }
            if (redisActive) console.log(`   🟢 Redis MISS: ${cacheKey} — proceeding to DB`);
        } catch (redisErr) {
            console.log('   ⚠️ Redis read error (ignored):', redisErr.message);
        }

        const subEvent = await queryOne('SELECT eid, se_name FROM sub_event WHERE seid = $1 LIMIT 1', [seid]);
        if (!subEvent) return res.status(404).json({ error: 'Sub-event not found' });
        const eventId = subEvent.eid;

        const existing = await queryOne('SELECT volnstatus FROM volunteer WHERE volnusn = $1 AND volneid = $2 LIMIT 1', [usn, eventId]);
        if (!existing) return res.status(404).json({ error: 'You are not registered as a volunteer for this event' });

        const existingAttendance = await queryOne('SELECT id FROM sub_event_attendance WHERE seid = $1 AND usn = $2 AND role = $3 LIMIT 1', [seid, usn, 'volunteer']);
        if (existingAttendance) return res.status(400).json({ error: 'Attendance already marked for this sub-event' });

        await query('INSERT INTO sub_event_attendance (seid, eid, usn, role) VALUES ($1, $2, $3, $4)', [seid, eventId, usn, 'volunteer']);

        // Cache the attendance in Redis after successful DB insert
        try {
            await redisClient.set(cacheKey, '1', { EX: 3600 });
            if (redisActive) console.log(`   ✅ Redis SET: ${cacheKey} (TTL: 1h)`);
        } catch (redisErr) {
            console.log('   ⚠️ Redis write error (ignored):', redisErr.message);
        }

        const scanCount = await queryCount('SELECT count(*) FROM sub_event_attendance WHERE eid = $1 AND usn = $2 AND role = $3', [eventId, usn, 'volunteer']);
        const eventData = await queryOne('SELECT min_voln_scans FROM event WHERE eid = $1 LIMIT 1', [eventId]);

        const minVolnScans = eventData?.min_voln_scans || 1;
        const thresholdMet = scanCount >= minVolnScans;
        if (thresholdMet) {
            await query('UPDATE volunteer SET volnstatus = true WHERE volnusn = $1 AND volneid = $2', [usn, eventId]);
        }
        res.json({ success: true, message: 'Attendance marked successfully', attendanceCount: scanCount, minRequired: minVolnScans, thresholdMet });
    } catch (err) {
        res.status(500).json({ error: 'Error marking attendance: ' + err.message });
    }
});

app.get('/api/scan-qr', async (req, res) => {
    try {
        const { usn, eid } = req.query;
        if (!usn || !eid) return res.status(400).json({ error: 'USN and Event ID are required' });
        const existing = await queryOne('SELECT partstatus FROM participant WHERE partusn = $1 AND parteid = $2 LIMIT 1', [usn, eid]);
        if (!existing) return res.status(404).json({ error: 'Participant not found for this event' });
        if (existing.partstatus === true) return res.status(400).json({ error: 'Participant already checked in' });

        await query('UPDATE participant SET partstatus = true WHERE partusn = $1 AND parteid = $2', [usn, eid]);
        res.json({ success: true, message: 'Participant checked in successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Error updating participant status: ' + err.message });
    }
});

app.get('/api/sub-events/:seid/qr-token', requireAuth, async (req, res) => {
    try {
        const seid = req.params.seid;
        const subEvent = await queryOne('SELECT eid, se_name FROM sub_event WHERE seid = $1 LIMIT 1', [seid]);
        if (!subEvent) return res.status(404).json({ error: 'Sub-event not found' });

        const event = await queryOne('SELECT orgusn FROM event WHERE eid = $1 LIMIT 1', [subEvent.eid]);
        if (!event || event.orgusn !== req.session.userUSN) return res.status(403).json({ error: 'Only the organizer can generate QR tokens' });

        const timestamp = Date.now().toString();
        const payload = `${seid}:${timestamp}`;
        const token = crypto.createHmac('sha256', QR_TOKEN_SECRET).update(payload).digest('hex').substring(0, 16);
        res.json({ token, timestamp, seid, eid: subEvent.eid, seName: subEvent.se_name });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate token' });
    }
});

// ==================== ORGANIZER PIN ====================

app.post('/api/set-organizer-pin', requireAuth, async (req, res) => {
    try {
        const { newPin, confirmPin } = req.body;
        if (!newPin || !/^\d{4,6}$/.test(newPin)) return res.status(400).json({ error: 'PIN must be 4 to 6 digits' });
        if (newPin !== confirmPin) return res.status(400).json({ error: 'PINs do not match' });

        const userData = await queryOne('SELECT organizer_pin FROM student WHERE usn = $1', [req.session.userUSN]);
        if (userData?.organizer_pin) return res.status(400).json({ error: 'PIN already set. Use the change PIN flow.' });

        const hashedPin = await bcrypt.hash(newPin, 10);
        await query('UPDATE student SET organizer_pin = $1 WHERE usn = $2', [hashedPin, req.session.userUSN]);
        res.json({ success: true, message: 'Organizer PIN set successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to set PIN' });
    }
});

app.post('/api/request-pin-otp', requireAuth, async (req, res) => {
    try {
        const userData = await queryOne('SELECT sname, emailid, organizer_pin FROM student WHERE usn = $1', [req.session.userUSN]);
        if (!userData) return res.status(404).json({ error: 'User not found' });
        if (!userData.organizer_pin) return res.status(400).json({ error: 'No PIN set. Use Set PIN instead.' });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = new Date(Date.now() + 5 * 60 * 1000);
        const hashedOtp = await bcrypt.hash(otp, 10);

        await query('UPDATE student SET pin_otp = $1, pin_otp_expiry = $2 WHERE usn = $3', [hashedOtp, expiry.toISOString(), req.session.userUSN]);

        const sendSmtpEmail = new Brevo.SendSmtpEmail();
        sendSmtpEmail.subject = 'Your Organizer PIN Change OTP - FLO';
        sendSmtpEmail.sender = { name: 'FLO E-Pass System', email: 'flobms3@gmail.com' };
        sendSmtpEmail.to = [{ email: userData.emailid, name: userData.sname }];
        sendSmtpEmail.htmlContent = `
            <html><body style="font-family: Arial, sans-serif; background:#f5f0e8; padding:20px;">
            <div style="max-width:500px;margin:0 auto;background:#fff;border:3px solid #0D0D0D;padding:32px;box-shadow:5px 5px 0 #000;">
                <h2 style="font-family:monospace;text-transform:uppercase;letter-spacing:2px;margin:0 0 8px;">FLO</h2>
                <div style="height:4px;background:#FFD600;width:40px;margin-bottom:24px;"></div>
                <p>Hello <strong>${userData.sname}</strong>,</p>
                <p>Use the OTP below to reset your organizer PIN. This OTP expires in <strong>5 minutes</strong>.</p>
                <div style="background:#0D0D0D;color:#FFD600;font-family:monospace;font-size:32px;font-weight:700;padding:24px;text-align:center;letter-spacing:8px;margin:24px 0;">${otp}</div>
                <p style="color:#999;font-size:12px;margin-top:24px;">If you did not request this, ignore this email.</p>
            </div></body></html>`;
        try {
            await apiInstance.sendTransacEmail(sendSmtpEmail);
            console.log(`✅ PIN reset OTP sent to ${userData.emailid}`);
        } catch (e) {
            console.error('❌ Brevo email error (request-pin-otp):', e?.response?.body || e?.message || e);
            return res.status(500).json({ error: 'Failed to send OTP. Please try again later.' });
        }

        res.json({ success: true, message: `OTP sent to ${userData.emailid}. Valid for 5 minutes.` });
    } catch (err) {
        console.error('❌ request-pin-otp route error:', err);
        res.status(500).json({ error: 'Failed to request OTP. Please try again.' });
    }
});

app.post('/api/verify-pin-otp', requireAuth, async (req, res) => {
    try {
        const { otp } = req.body;
        if (!otp || !/^\d{6}$/.test(otp)) return res.status(400).json({ error: 'Please enter a valid 6-digit OTP' });

        const userData = await queryOne('SELECT pin_otp, pin_otp_expiry FROM student WHERE usn = $1', [req.session.userUSN]);
        if (!userData?.pin_otp || !userData?.pin_otp_expiry) return res.status(400).json({ error: 'No OTP requested.' });

        if (new Date(userData.pin_otp_expiry) < new Date()) {
            await query('UPDATE student SET pin_otp = null, pin_otp_expiry = null WHERE usn = $1', [req.session.userUSN]);
            return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
        }

        const isValid = await bcrypt.compare(otp, userData.pin_otp);
        if (!isValid) return res.status(400).json({ error: 'Incorrect OTP. Please try again.' });

        await query('UPDATE student SET pin_otp = null, pin_otp_expiry = null WHERE usn = $1', [req.session.userUSN]);
        res.json({ success: true, message: 'OTP verified. You can now set your new PIN.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to verify OTP. Please try again.' });
    }
});

app.post('/api/reset-organizer-pin', requireAuth, async (req, res) => {
    try {
        const { newPin, confirmPin } = req.body;
        if (!newPin || !/^\d+$/.test(newPin) || newPin.length < 4 || newPin.length > 6) return res.status(400).json({ error: 'PIN must be 4-6 digits' });
        if (newPin !== confirmPin) return res.status(400).json({ error: 'PINs do not match' });

        const hashedPin = await bcrypt.hash(newPin, 10);
        await query('UPDATE student SET organizer_pin = $1 WHERE usn = $2', [hashedPin, req.session.userUSN]);
        res.json({ success: true, message: 'Organizer PIN changed successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to change PIN. Please try again.' });
    }
});

// ==================== UPI PAYMENT & TEAMS ====================

app.post('/api/events/:eventId/register-upi', requireAuth, async (req, res) => {
    try {
        const eventId = req.params.eventId;
        const userUSN = req.session.userUSN;
        const { transaction_id } = req.body;

        if (!transaction_id) return res.status(400).json({ error: 'Transaction ID is required' });

        const existing = await queryOne('SELECT partusn FROM participant WHERE partusn = $1 AND parteid = $2 LIMIT 1', [userUSN, eventId]);
        if (existing) return res.status(400).json({ error: 'You are already registered for this event' });

        const eventData = await queryOne('SELECT regfee, maxpart, orgusn FROM event WHERE eid = $1 LIMIT 1', [eventId]);
        if (!eventData) return res.status(404).json({ error: 'Event not found' });
        if (eventData.orgusn === userUSN) return res.status(403).json({ error: 'You cannot register in an event you organize' });

        const amount = eventData.regfee || 0;
        if (amount <= 0) return res.status(400).json({ error: 'This is not a paid event' });

        if (eventData.maxpart > 0) {
            const count = await queryCount('SELECT count(*) FROM participant WHERE parteid = $1', [eventId]);
            if (count >= eventData.maxpart) return res.status(400).json({ error: 'Event is full' });
        }

        await query(`
            UPDATE registration_queue SET status = 'submitted'
            WHERE event_id = $1 AND usn = $2
        `, [eventId, userUSN]);

        await query('INSERT INTO payment (usn, event_id, amount, status, upi_transaction_id) VALUES ($1, $2, $3, $4, $5)',
            [userUSN, eventId, amount, 'pending_verification', transaction_id]);

        await query('INSERT INTO participant (partusn, parteid, partstatus, payment_status) VALUES ($1, $2, false, $3)',
            [userUSN, eventId, 'pending_verification']);

        res.json({ success: true, message: 'Registration submitted! Your payment is pending verification by the organizer.', userUSN });
    } catch (err) {
        res.status(500).json({ error: 'Error submitting registration' });
    }
});

app.post('/api/payments/verify', requireAuth, async (req, res) => {
    try {
        const { participantUSN, eventId } = req.body;
        const organizerUSN = req.session.userUSN;

        if (!participantUSN || !eventId) return res.status(400).json({ error: 'Participant USN and Event ID are required' });

        const event = await queryOne('SELECT orgusn, is_team FROM event WHERE eid = $1 LIMIT 1', [eventId]);
        if (!event) return res.status(404).json({ error: 'Event not found' });
        if (event.orgusn !== organizerUSN) return res.status(403).json({ error: 'Not authorized to verify payments' });

        if (event.is_team) {
            const team = await queryOne('SELECT id FROM team WHERE event_id = $1 AND leader_usn = $2 LIMIT 1', [eventId, participantUSN]);
            if (team) {
                const teamMembers = await query('SELECT student_usn FROM team_members WHERE team_id = $1 AND join_status = true', [team.id]);
                const allTeamUSNs = teamMembers.map(m => m.student_usn);

                await query('UPDATE payment SET status = $1 WHERE event_id = $2 AND usn = $3 AND status = $4', ['verified', eventId, participantUSN, 'pending_verification']);

                for (const memberUsn of allTeamUSNs) {
                    await query('UPDATE participant SET payment_status = $1 WHERE partusn = $2 AND parteid = $3', ['verified', memberUsn, eventId]);
                }
                await query('UPDATE team SET registration_complete = true WHERE id = $1', [team.id]);
                return res.json({ success: true, message: `Payment verified for entire team (${allTeamUSNs.length} members)!`, verifiedCount: allTeamUSNs.length });
            }
        }

        await query('UPDATE payment SET status = $1 WHERE event_id = $2 AND usn = $3 AND status = $4', ['verified', eventId, participantUSN, 'pending_verification']);
        await query('UPDATE participant SET payment_status = $1 WHERE partusn = $2 AND parteid = $3', ['verified', participantUSN, eventId]);

        res.json({ success: true, message: 'Payment verified successfully!' });
    } catch (err) {
        res.status(500).json({ error: 'Error verifying payment' });
    }
});

app.get('/api/events/:eventId/pending-payments', requireAuth, async (req, res) => {
    try {
        const eventId = req.params.eventId;
        const event = await queryOne('SELECT orgusn, ename, is_team FROM event WHERE eid = $1 LIMIT 1', [eventId]);
        if (!event) return res.status(404).json({ error: 'Event not found' });
        if (event.orgusn !== req.session.userUSN) return res.status(403).json({ error: 'Not authorized' });

        const pendingPayments = await query(`
            SELECT p.usn, p.amount, p.upi_transaction_id, p.created_at, p.status,
                   s.sname, s.emailid, s.mobno
            FROM payment p JOIN student s ON p.usn = s.usn
            WHERE p.event_id = $1 AND p.status = 'pending_verification'
        `, [eventId]);

        let paymentsToShow = [];
        if (event.is_team) {
            for (const payment of pendingPayments) {
                const teamData = await queryOne('SELECT id, team_name FROM team WHERE event_id = $1 AND leader_usn = $2 LIMIT 1', [eventId, payment.usn]);
                if (teamData) {
                    const memberCount = await queryCount('SELECT count(*) FROM team_members WHERE team_id = $1 AND join_status = true', [teamData.id]);
                    paymentsToShow.push({
                        partusn: payment.usn, studentName: payment.sname || 'Unknown',
                        studentEmail: payment.emailid || 'N/A', studentMobile: payment.mobno || 'N/A',
                        transactionId: payment.upi_transaction_id || 'N/A', amount: payment.amount || 0,
                        submittedAt: payment.created_at || null, teamName: teamData.team_name,
                        teamMemberCount: memberCount || 1, isTeamLeader: true
                    });
                }
            }
        } else {
            paymentsToShow = pendingPayments.map(payment => ({
                partusn: payment.usn, studentName: payment.sname || 'Unknown',
                studentEmail: payment.emailid || 'N/A', studentMobile: payment.mobno || 'N/A',
                transactionId: payment.upi_transaction_id || 'N/A', amount: payment.amount || 0,
                submittedAt: payment.created_at || null, teamName: null, isTeamLeader: false
            }));
        }
        res.json({ success: true, pendingPayments: paymentsToShow, isTeamEvent: event.is_team });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching pending payments' });
    }
});

app.post('/api/events/:eventId/create-team', requireAuth, async (req, res) => {
    try {
        const eventId = req.params.eventId;
        const userUSN = req.session.userUSN;
        const { teamName, memberUSNs } = req.body;

        if (!teamName || !Array.isArray(memberUSNs)) return res.status(400).json({ error: 'Team name and member USNs are required' });

        const event = await queryOne('SELECT is_team, min_team_size, max_team_size, orgusn FROM event WHERE eid = $1 LIMIT 1', [eventId]);
        if (!event || !event.is_team) return res.status(400).json({ error: 'This is not a team event' });
        if (event.orgusn === userUSN) return res.status(403).json({ error: 'Organizers cannot participate in their own event' });

        const totalMembers = memberUSNs.length + 1;
        if (event.max_team_size && totalMembers > event.max_team_size) {
            return res.status(400).json({ error: `Team size cannot exceed ${event.max_team_size}` });
        }

        const existingTeam = await query(`
            SELECT tm.team_id FROM team_members tm JOIN team t ON tm.team_id = t.id 
            WHERE tm.student_usn = $1 AND tm.join_status = true AND t.event_id = $2
        `, [userUSN, eventId]);

        if (existingTeam.length > 0) return res.status(400).json({ error: 'You have already joined a team for this event.' });

        if (memberUSNs.length > 0) {
            const students = await query('SELECT usn FROM student WHERE usn = ANY($1::text[])', [memberUSNs]);
            if (students.length !== memberUSNs.length) return res.status(400).json({ error: 'One or more member USNs are invalid' });
            if (memberUSNs.includes(event.orgusn)) return res.status(400).json({ error: 'Cannot add the event organizer as a team member' });

            const memberTeamCheck = await query(`
                SELECT tm.student_usn FROM team_members tm JOIN team t ON tm.team_id = t.id 
                WHERE tm.student_usn = ANY($1::text[]) AND tm.join_status = true AND t.event_id = $2
            `, [memberUSNs, eventId]);
            if (memberTeamCheck.length > 0) return res.status(400).json({ error: `Member ${memberTeamCheck[0].student_usn} has already joined another team` });
        }

        const newTeam = await queryOne('INSERT INTO team (team_name, leader_usn, event_id, registration_complete) VALUES ($1, $2, $3, false) RETURNING id', [teamName, userUSN, eventId]);
        const teamId = newTeam.id;

        await query('INSERT INTO team_members (team_id, student_usn, join_status) VALUES ($1, $2, true)', [teamId, userUSN]);
        for (const usn of memberUSNs) {
            await query('INSERT INTO team_members (team_id, student_usn, join_status) VALUES ($1, $2, false)', [teamId, usn]);
        }

        res.json({ success: true, message: 'Team created successfully! Invitations sent.', teamId, minSize: event.min_team_size, currentSize: 1, canRegister: event.min_team_size <= 1 });
    } catch (err) {
        res.status(500).json({ error: 'Error creating team' });
    }
});

app.get('/api/events/:eventId/team-status', requireAuth, async (req, res) => {
    try {
        const eventId = req.params.eventId;
        const userUSN = req.session.userUSN;
        const event = await queryOne('SELECT is_team, min_team_size, max_team_size, regfee FROM event WHERE eid = $1 LIMIT 1', [eventId]);

        if (!event) return res.status(404).json({ error: 'Event not found' });
        if (!event.is_team) return res.json({ isTeamEvent: false });

        const leaderTeam = await queryOne('SELECT id, team_name, registration_complete FROM team WHERE leader_usn = $1 AND event_id = $2 LIMIT 1', [userUSN, eventId]);
        if (leaderTeam) {
            const members = await query('SELECT tm.student_usn, tm.join_status, s.sname FROM team_members tm LEFT JOIN student s ON tm.student_usn = s.usn WHERE tm.team_id = $1', [leaderTeam.id]);
            const joinedCount = members.filter(m => m.join_status).length;
            return res.json({
                isTeamEvent: true, isLeader: true, hasJoinedTeam: true,
                teamId: leaderTeam.id, teamName: leaderTeam.team_name, members,
                joinedCount, minSize: event.min_team_size, maxSize: event.max_team_size,
                canRegister: joinedCount >= event.min_team_size,
                registrationComplete: leaderTeam.registration_complete, regFee: event.regfee
            });
        }

        const memberTeamQuery = await query(`
            SELECT tm.team_id, tm.join_status, t.id, t.team_name, t.leader_usn, t.registration_complete, s.sname AS leader_name
            FROM team_members tm JOIN team t ON tm.team_id = t.id LEFT JOIN student s ON t.leader_usn = s.usn
            WHERE tm.student_usn = $1 AND tm.join_status = true AND t.event_id = $2 LIMIT 1
        `, [userUSN, eventId]);

        if (memberTeamQuery.length > 0) {
            const mt = memberTeamQuery[0];
            const members = await query('SELECT tm.student_usn, tm.join_status, s.sname FROM team_members tm LEFT JOIN student s ON tm.student_usn = s.usn WHERE tm.team_id = $1', [mt.id]);
            return res.json({
                isTeamEvent: true, isLeader: false, isMember: true, hasJoinedTeam: true,
                teamId: mt.id, teamName: mt.team_name, leaderUSN: mt.leader_usn, leaderName: mt.leader_name,
                registrationComplete: mt.registration_complete, minSize: event.min_team_size, maxSize: event.max_team_size,
                members, joinedCount: members.filter(m => m.join_status).length
            });
        }

        res.json({ isTeamEvent: true, isLeader: false, isMember: false, hasJoinedTeam: false, minSize: event.min_team_size, maxSize: event.max_team_size, regFee: event.regfee });
    } catch (err) {
        res.status(500).json({ error: 'Error getting team status' });
    }
});

app.post('/api/events/:eventId/register-team', requireAuth, async (req, res) => {
    try {
        const eventId = req.params.eventId;
        const userUSN = req.session.userUSN;

        const team = await queryOne(`
            SELECT t.id, t.registration_complete, e.regfee, e.min_team_size, e.maxpart 
            FROM team t JOIN event e ON t.event_id = e.eid 
            WHERE t.leader_usn = $1 AND t.event_id = $2 LIMIT 1
        `, [userUSN, eventId]);

        if (!team) return res.status(404).json({ error: 'Team not found or you are not the team leader' });
        if (team.registration_complete) return res.status(400).json({ error: 'Team is already registered' });

        const members = await query('SELECT student_usn FROM team_members WHERE team_id = $1 AND join_status = true', [team.id]);
        if (members.length < team.min_team_size) return res.status(400).json({ error: `Minimum ${team.min_team_size} members required.` });

        if (team.maxpart > 0) {
            const count = await queryCount('SELECT count(*) FROM team WHERE event_id = $1 AND registration_complete = true', [eventId]);
            if (count >= team.maxpart) return res.status(400).json({ error: `Event is full.` });
        }
        if (team.regfee > 0) return res.json({ success: true, requiresPayment: true, message: 'Payment required', teamId: team.id, regFee: team.regfee });

        await query('UPDATE team SET registration_complete = true WHERE id = $1', [team.id]);

        for (const m of members) {
            await query(`
                INSERT INTO participant (partusn, parteid, partstatus, payment_status, team_id) 
                VALUES ($1, $2, false, 'free', $3)
                ON CONFLICT (partusn, parteid) DO UPDATE SET payment_status = 'free', team_id = $3
            `, [m.student_usn, eventId, team.id]);
        }
        res.json({ success: true, message: 'Team registered successfully!', teamId: team.id, userUSN });
    } catch (err) {
        res.status(500).json({ error: 'Error registering team' });
    }
});

app.post('/api/events/:eventId/register-team-upi', requireAuth, async (req, res) => {
    try {
        const eventId = req.params.eventId;
        const userUSN = req.session.userUSN;
        const { transaction_id } = req.body;
        if (!transaction_id) return res.status(400).json({ error: 'Transaction ID is required' });

        const team = await queryOne(`
            SELECT t.id, t.registration_complete, e.regfee, e.min_team_size, e.maxpart 
            FROM team t JOIN event e ON t.event_id = e.eid 
            WHERE t.leader_usn = $1 AND t.event_id = $2 LIMIT 1
        `, [userUSN, eventId]);

        if (!team) return res.status(404).json({ error: 'Team not found or you are not the team leader' });
        if (team.registration_complete) return res.status(400).json({ error: 'Team is already registered' });
        if (team.regfee <= 0) return res.status(400).json({ error: 'This is not a paid event' });

        const members = await query('SELECT student_usn FROM team_members WHERE team_id = $1 AND join_status = true', [team.id]);
        if (members.length < team.min_team_size) return res.status(400).json({ error: `Minimum ${team.min_team_size} members required.` });

        await query('INSERT INTO payment (usn, event_id, amount, status, upi_transaction_id) VALUES ($1, $2, $3, $4, $5)',
            [userUSN, eventId, team.regfee, 'pending_verification', transaction_id]);

        for (const m of members) {
            await query(`
                INSERT INTO participant (partusn, parteid, partstatus, payment_status, team_id) 
                VALUES ($1, $2, false, 'pending_verification', $3)
                ON CONFLICT (partusn, parteid) DO UPDATE SET payment_status = 'pending_verification', team_id = $3
            `, [m.student_usn, eventId, team.id]);
        }
        res.json({ success: true, message: 'Team registration submitted! Pending verification.', userUSN });
    } catch (err) {
        res.status(500).json({ error: 'Error registering team' });
    }
});

app.post('/api/teams/:teamId/confirm-join', requireAuth, async (req, res) => {
    try {
        const teamId = req.params.teamId;
        const userUSN = req.session.userUSN;

        const membership = await queryOne(`
            SELECT tm.join_status, t.event_id, t.registration_complete, t.team_name
            FROM team_members tm JOIN team t ON tm.team_id = t.id
            WHERE tm.team_id = $1 AND tm.student_usn = $2 LIMIT 1
        `, [teamId, userUSN]);

        if (!membership) return res.status(404).json({ error: 'You are not invited to this team' });
        if (membership.join_status) return res.status(400).json({ error: 'You have already joined this team' });
        if (membership.registration_complete) return res.status(400).json({ error: 'This team has already completed registration' });

        const otherTeams = await query(`
            SELECT tm.team_id FROM team_members tm JOIN team t ON tm.team_id = t.id
            WHERE tm.student_usn = $1 AND tm.join_status = true AND t.event_id = $2 LIMIT 1
        `, [userUSN, membership.event_id]);

        if (otherTeams.length > 0) return res.status(400).json({ error: 'You have already joined another team for this event' });

        await query('UPDATE team_members SET join_status = true WHERE team_id = $1 AND student_usn = $2', [teamId, userUSN]);
        res.json({ success: true, message: `Successfully joined team "${membership.team_name}"!`, teamId });
    } catch (err) {
        res.status(500).json({ error: 'Error confirming join' });
    }
});

app.get('/api/events/:eventId/my-invites', requireAuth, async (req, res) => {
    try {
        const eventId = req.params.eventId;
        const invites = await query(`
            SELECT tm.team_id, tm.join_status, t.id, t.team_name, t.leader_usn, t.event_id, t.registration_complete, s.sname AS leader_name
            FROM team_members tm JOIN team t ON tm.team_id = t.id LEFT JOIN student s ON t.leader_usn = s.usn
            WHERE tm.student_usn = $1 AND tm.join_status = false AND t.event_id = $2
        `, [req.session.userUSN, eventId]);

        const eventInvites = invites.map(invite => ({
            teamId: invite.id, teamName: invite.team_name,
            leaderUSN: invite.leader_usn, leaderName: invite.leader_name || 'Unknown',
            joinStatus: invite.join_status, registrationComplete: invite.registration_complete
        }));
        res.json({ success: true, invites: eventInvites });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching invites' });
    }
});

// ==================== EXCEL GENERATION ====================

app.get('/api/events/:eventId/generate-details', requireAuth, async (req, res) => {
    try {
        const eventId = req.params.eventId;
        const userUSN = req.session.userUSN;

        const event = await queryOne('SELECT eid, ename, eventdate, eventtime, eventloc, orgusn, max_activity_pts, vol_activity_pts FROM event WHERE eid = $1', [eventId]);
        if (!event) return res.status(404).json({ error: 'Event not found' });
        if (event.orgusn !== userUSN) return res.status(403).json({ error: 'Not authorized' });

        const organiser = await queryOne('SELECT sname FROM student WHERE usn = $1', [event.orgusn]);
        const organiserName = organiser?.sname || 'N/A';

        const participants = await query('SELECT partusn, partstatus, payment_status, team_id FROM participant WHERE parteid = $1', [eventId]);
        const partUsns = participants.length > 0 ? [...new Set(participants.map(p => p.partusn))] : [];

        const students = partUsns.length > 0 ? await query('SELECT usn, sname, sem, mobno, emailid FROM student WHERE usn = ANY($1::text[])', [partUsns]) : [];
        const studentMap = students.reduce((acc, s) => ({ ...acc, [s.usn]: s }), {});

        const teams = await query('SELECT id, team_name FROM team WHERE event_id = $1', [eventId]);
        const teamMap = teams.reduce((acc, t) => ({ ...acc, [t.id]: t.team_name }), {});

        const payments = await query('SELECT usn, upi_transaction_id, amount FROM payment WHERE event_id = $1', [eventId]);
        const paymentMap = payments.reduce((acc, p) => ({ ...acc, [p.usn]: p }), {});

        const volunteers = await query('SELECT volnusn, volnstatus FROM volunteer WHERE volneid = $1', [eventId]);
        const volUsns = volunteers.length > 0 ? [...new Set(volunteers.map(v => v.volnusn))] : [];
        const volStudents = volUsns.length > 0 ? await query('SELECT usn, sname FROM student WHERE usn = ANY($1::text[])', [volUsns]) : [];
        const volStudentMap = volStudents.reduce((acc, s) => ({ ...acc, [s.usn]: s }), {});

        const combined = [];

        // Participants
        participants.forEach(p => {
            const dept = extractDept(p.partusn);
            if (!dept) return;
            const std = studentMap[p.partusn] || {};

            combined.push({
                usn: p.partusn,
                name: std.sname || 'N/A',
                sem: std.sem || 'N/A',
                dept,
                role: 'Participant',
                registered: 1,
                participated: p.partstatus ? 1 : 0
            });
        });

        // Volunteers
        volunteers.forEach(v => {
            const dept = extractDept(v.volnusn);
            if (!dept) return;
            const std = volStudentMap[v.volnusn] || {};

            combined.push({
                usn: v.volnusn,
                name: std.sname || 'N/A',
                sem: 'N/A', // Sem not available in vol query
                dept,
                role: 'Volunteer',
                registered: 1,
                participated: v.volnstatus ? 1 : 0
            });
        });

        // Aggregation Logic (Separate for Participants and Volunteers)
        const partStats = {};
        const volStats = {};
        combined.forEach(item => {
            const st = item.role === 'Participant' ? partStats : volStats;
            if (!st[item.dept]) {
                st[item.dept] = { totalRegistered: 0, totalParticipated: 0, semesters: {} };
            }
            st[item.dept].totalRegistered += item.registered;
            st[item.dept].totalParticipated += item.participated;

            if (!st[item.dept].semesters[item.sem]) {
                st[item.dept].semesters[item.sem] = { registered: 0, participated: 0 };
            }
            st[item.dept].semesters[item.sem].registered += item.registered;
            st[item.dept].semesters[item.sem].participated += item.participated;
        });

        const workbook = new ExcelJS.Workbook();

        // Date formatting helper to avoid timezone shifts
        const formatExcelDate = (date) => {
            if (!date) return 'N/A';
            const d = new Date(date);
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return `${day}-${month}-${year}`;
        };
        const eDate = formatExcelDate(event.eventdate);

        // 1. Overview Sheet
        const overviewSheet = workbook.addWorksheet('Event Overview');
        overviewSheet.addRow(['EVENT OVERVIEW']).font = { size: 16, bold: true };
        overviewSheet.mergeCells('A1:B1');
        overviewSheet.getRow(1).alignment = { horizontal: 'left' };
        overviewSheet.addRow([]);
        overviewSheet.addRow(['Event Name:', event.ename || 'N/A']);
        overviewSheet.addRow(['Event Date:', eDate]);
        overviewSheet.addRow(['Event Time:', event.eventtime || 'N/A']);
        overviewSheet.addRow(['Event Location:', event.eventloc || 'N/A']);
        overviewSheet.addRow(['Organiser USN:', event.orgusn || 'N/A']);
        overviewSheet.addRow(['Organiser Name:', organiserName]);
        overviewSheet.addRow([]);
        overviewSheet.addRow(['SUMMARY STATISTICS']).font = { bold: true };
        const totalRegCount = combined.length;
        const totalPartCount = combined.filter(c => c.participated).length;
        overviewSheet.addRow(['Total Registered:', totalRegCount]);
        overviewSheet.addRow(['Total Participated:', totalPartCount]);
        overviewSheet.addRow(['Participation Rate:', totalRegCount ? ((totalPartCount / totalRegCount) * 100).toFixed(2) + '%' : '0%']);
        overviewSheet.getColumn(1).width = 25;
        overviewSheet.getColumn(2).width = 50;

        // 2. Participants Sheet
        const partSheet = workbook.addWorksheet('Participants');
        const partCols = ['USN', 'Name', 'Semester', 'Mobile No', 'Email', 'Status', 'Payment Status', 'Team Name', 'Transaction ID', 'Amount', 'Activity Pts'];
        const pHeader = partSheet.addRow(partCols);
        pHeader.font = { bold: true };
        pHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

        const maxActivityPts = event.max_activity_pts || 0;
        let attendanceRaw = [];
        let subEventPts = [];
        try {
            attendanceRaw = await query('SELECT usn, seid FROM sub_event_attendance WHERE eid = $1 AND role = $2', [eventId, 'participant']);
            subEventPts = await query('SELECT seid, activity_pts FROM sub_event WHERE eid = $1', [eventId]);
        } catch (e) { console.log('Attendance tables missing'); }

        const seidToPts = subEventPts.reduce((acc, se) => ({ ...acc, [se.seid]: se.activity_pts || 0 }), {});
        const usnToPtsMap = {};
        attendanceRaw.forEach(row => {
            if (!usnToPtsMap[row.usn]) usnToPtsMap[row.usn] = 0;
            usnToPtsMap[row.usn] += seidToPts[row.seid] || 0;
        });

        participants.forEach(p => {
            const student = studentMap[p.partusn] || {};
            const payment = paymentMap[p.partusn] || {};
            const teamName = teamMap[p.team_id] || 'N/A';
            const earnedPts = p.partstatus ? Math.min(usnToPtsMap[p.partusn] || 0, maxActivityPts) : 0;
            partSheet.addRow([
                p.partusn || 'N/A', student.sname || 'N/A', student.sem || 'N/A',
                student.mobno || 'N/A', student.emailid || 'N/A',
                p.partstatus ? 'Present' : 'Absent', p.payment_status || 'N/A',
                teamName, payment.upi_transaction_id || 'N/A',
                payment.amount ?? (p.payment_status === 'free' ? '0' : 'N/A'), earnedPts
            ]);
        });
        partSheet.columns.forEach(col => { col.width = 20; });

        // 3. Volunteers Sheet
        const volSheet = workbook.addWorksheet('Volunteers');
        const volCols = ['USN', 'Name', 'Status', 'Activity Pts'];
        const vHeader = volSheet.addRow(volCols);
        vHeader.font = { bold: true };
        vHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };

        const volActivityPts = event.vol_activity_pts || 0;
        volunteers.forEach(v => {
            const std = volStudentMap[v.volnusn] || {};
            volSheet.addRow([
                v.volnusn || 'N/A', std.sname || 'N/A',
                v.volnstatus ? 'Present' : 'Absent', v.volnstatus ? volActivityPts : 0
            ]);
        });
        volSheet.columns.forEach(col => { col.width = 20; });

        // 4. Department Summary
        const deptSheet = workbook.addWorksheet('Department Summary');

        // Participants Section
        deptSheet.addRow(['PARTICIPANTS SUMMARY']).font = { bold: true };
        deptSheet.addRow(['Department', 'Registered', 'Participated', '% Participation']).font = { bold: true };
        let pTR = 0; let pTP = 0;
        for (const dept in partStats) {
            const d = partStats[dept];
            const pct = d.totalRegistered ? ((d.totalParticipated / d.totalRegistered) * 100).toFixed(2) : 0;
            deptSheet.addRow([dept, d.totalRegistered, d.totalParticipated, pct + '%']);
            pTR += d.totalRegistered; pTP += d.totalParticipated;
        }
        deptSheet.addRow(['PARTICIPANTS TOTAL', pTR, pTP, (pTR ? ((pTP / pTR) * 100).toFixed(2) : 0) + '%']).font = { bold: true };
        deptSheet.addRow([]);

        // Volunteers Section
        deptSheet.addRow(['VOLUNTEERS SUMMARY']).font = { bold: true };
        deptSheet.addRow(['Department', 'Registered', 'Participated', '% Participation']).font = { bold: true };
        let vTR = 0; let vTP = 0;
        for (const dept in volStats) {
            const d = volStats[dept];
            const pct = d.totalRegistered ? ((d.totalParticipated / d.totalRegistered) * 100).toFixed(2) : 0;
            deptSheet.addRow([dept, d.totalRegistered, d.totalParticipated, pct + '%']);
            vTR += d.totalRegistered; vTP += d.totalParticipated;
        }
        deptSheet.addRow(['VOLUNTEERS TOTAL', vTR, vTP, (vTR ? ((vTP / vTR) * 100).toFixed(2) : 0) + '%']).font = { bold: true };
        deptSheet.columns.forEach(col => { col.width = 25; });

        // 5. Dept-Sem Breakdown
        const semSheet = workbook.addWorksheet('Dept-Sem Breakdown');

        // Participants Section
        semSheet.addRow(['PARTICIPANTS DEPT-SEM BREAKDOWN']).font = { bold: true };
        semSheet.addRow(['Department', 'Semester', 'Registered', 'Participated', '%']).font = { bold: true };
        for (const dept in partStats) {
            const semesters = partStats[dept].semesters;
            for (const sem in semesters) {
                const s = semesters[sem];
                const pct = s.registered ? ((s.participated / s.registered) * 100).toFixed(2) : 0;
                semSheet.addRow([dept, sem, s.registered, s.participated, pct + '%']);
            }
        }
        semSheet.addRow([]);

        // Volunteers Section
        semSheet.addRow(['VOLUNTEERS DEPARTMENT SUMMARY']).font = { bold: true };
        semSheet.addRow(['Department', 'Registered', 'Participated', '%']).font = { bold: true };
        for (const dept in volStats) {
            const d = volStats[dept];
            const pct = d.totalRegistered ? ((d.totalParticipated / d.totalRegistered) * 100).toFixed(2) : 0;
            semSheet.addRow([dept, d.totalRegistered, d.totalParticipated, pct + '%']);
        }
        semSheet.columns.forEach(col => { col.width = 25; });

        // Apply global styling: borders + left alignment for all data
        workbook.eachSheet(sheet => {
            sheet.eachRow(row => {
                row.eachCell(cell => {
                    cell.alignment = { horizontal: 'left' };
                    cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                });
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Event_${(event.ename || 'Event').replace(/\s+/g, '_')}_Details.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error('❌ Excel Error:', err);
        res.status(500).json({ error: 'Error generating Excel file: ' + err.message });
    }
});


// ============================================================
// NEW ROUTES — ADD THESE BEFORE app.listen()
// ============================================================

// ─── Admin Auth Middleware ──────────────────────────────────────────────────────
// ============================================================
// ADMIN ROUTES & AUTHENTICATION
// ============================================================

// ─── Admin Auth Middleware ──────────────────────────────────────────────────────
async function requireAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Please sign in first' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // 1. New Way: Standalone generic Admin Token
        if (decoded.role === 'admin') {
            // Give them a dummy USN session so admin logging functionality (like reviewed_by) doesn't break
            req.session = { userUSN: 'ADMIN', userName: 'Administrator', isAdmin: true };
            return next();
        }

        // 2. Fallback Old Way: DB flag (optional, kept just in case you manually set someone in pgAdmin)
        const student = await queryOne(
            'SELECT usn, sname, emailid, is_admin FROM student WHERE usn = $1',
            [decoded.usn]
        );
        if (!student) return res.status(401).json({ error: 'Account not found.' });
        if (!student.is_admin) return res.status(403).json({ error: 'Admin access required.' });
        
        req.session = { userUSN: student.usn, userName: student.sname, userEmail: student.emailid, isAdmin: true };
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }
}

// ─── Admin: Password Login endpoint ─────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    
    // Hardcoded password bypass as requested
    if (password === 'vibe') {
        const adminToken = jwt.sign({ role: 'admin', usn: 'ADMIN' }, JWT_SECRET, { expiresIn: '1d' });
        return res.json({ success: true, token: adminToken });
    }
    
    return res.status(401).json({ error: 'Invalid admin password' });
});

// ─── Check if current token grants admin access ─────────────────────────────────
app.get('/api/admin/check', requireAdmin, async (req, res) => {
    // If it passed requireAdmin, they are good to go!
    res.json({ isAdmin: true });
});

// ─── Admin: Get dashboard stats ────────────────────────────────────────────────
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        const [
            totalUsers,
            totalEvents,
            totalParticipants,
            totalVolunteers,
            pendingRequests,
            revenueRows
        ] = await Promise.all([
            queryCount('SELECT count(*) FROM student'),
            queryCount('SELECT count(*) FROM event'),
            queryCount('SELECT count(*) FROM participant'),
            queryCount('SELECT count(*) FROM volunteer'),
            queryCount("SELECT count(*) FROM organizer_request WHERE status = 'pending'"),
            query(`
                SELECT COALESCE(SUM(p.amount), 0) AS total_revenue
                FROM payment p
                WHERE p.status = 'verified'
            `)
        ]);

        const totalRevenue = parseFloat(revenueRows[0]?.total_revenue || 0);

        res.json({
            totalUsers,
            totalEvents,
            totalParticipants,
            totalVolunteers,
            pendingRequests,
            totalRevenue
        });
    } catch (err) {
        console.error('Admin stats error:', err);
        res.status(500).json({ error: 'Error fetching stats' });
    }
});

// ─── Admin: Get all organizer requests ─────────────────────────────────────────
app.get('/api/admin/organizer-requests', requireAdmin, async (req, res) => {
    try {
        const { status = 'pending' } = req.query;
        const rows = await query(`
            SELECT r.*, s.sname, s.sem, s.mobno, s.emailid AS student_email
            FROM organizer_request r
            JOIN student s ON r.usn = s.usn
            WHERE r.status = $1
            ORDER BY r.created_at DESC
        `, [status]);
        res.json({ requests: rows });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching organizer requests' });
    }
});

// ─── Admin: Approve organizer request ──────────────────────────────────────────
app.post('/api/admin/organizer-requests/:id/approve', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const request = await queryOne(
            'SELECT * FROM organizer_request WHERE id = $1 LIMIT 1',
            [id]
        );
        if (!request) return res.status(404).json({ error: 'Request not found' });
        if (request.status !== 'pending') return res.status(400).json({ error: 'Request already reviewed' });

        // Check if club exists, create if not
        let club = await queryOne(
            'SELECT cid FROM club WHERE LOWER(cname) = LOWER($1) LIMIT 1',
            [request.club_name]
        );
        if (!club) {
            club = await queryOne(
                'INSERT INTO club (cname, clubdesc, maxmembers) VALUES ($1, $2, 100) RETURNING cid',
                [request.club_name, `${request.club_name} at ${request.college_name}`]
            );
        }

        // Add student as club member if not already
        const alreadyMember = await queryOne(
            'SELECT clubid FROM memberof WHERE studentusn = $1 AND clubid = $2 LIMIT 1',
            [request.usn, club.cid]
        );
        if (!alreadyMember) {
            await query(
                'INSERT INTO memberof (studentusn, clubid) VALUES ($1, $2)',
                [request.usn, club.cid]
            );
        }

        // Mark request approved
        await query(`
            UPDATE organizer_request
            SET status = 'approved', reviewed_at = NOW(), reviewed_by = $1
            WHERE id = $2
        `, [req.session.userUSN, id]);

        res.json({ success: true, message: `Organizer approved and added to club "${request.club_name}"` });
    } catch (err) {
        console.error('Approve error:', err);
        res.status(500).json({ error: 'Error approving request: ' + err.message });
    }
});

// ─── Admin: Reject organizer request ───────────────────────────────────────────
app.post('/api/admin/organizer-requests/:id/reject', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const request = await queryOne(
            'SELECT * FROM organizer_request WHERE id = $1 LIMIT 1',
            [id]
        );
        if (!request) return res.status(404).json({ error: 'Request not found' });
        if (request.status !== 'pending') return res.status(400).json({ error: 'Request already reviewed' });

        await query(`
            UPDATE organizer_request
            SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $1
            WHERE id = $2
        `, [req.session.userUSN, id]);

        res.json({ success: true, message: 'Request rejected' });
    } catch (err) {
        res.status(500).json({ error: 'Error rejecting request' });
    }
});

// ─── Admin: Get all users ───────────────────────────────────────────────────────
app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const users = await query(`
            SELECT s.usn, s.sname, s.sem, s.emailid, s.mobno, s.is_admin,
                   COUNT(DISTINCT p.parteid) AS event_count,
                   COUNT(DISTINCT v.volneid) AS volunteer_count
            FROM student s
            LEFT JOIN participant p ON s.usn = p.partusn
            LEFT JOIN volunteer v ON s.usn = v.volnusn
            GROUP BY s.usn, s.sname, s.sem, s.emailid, s.mobno, s.is_admin
            ORDER BY s.sname ASC
        `);
        res.json({ users });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching users' });
    }
});

// ─── Admin: Get all events with revenue ────────────────────────────────────────
app.get('/api/admin/events', requireAdmin, async (req, res) => {
    try {
        const events = await query(`
            SELECT e.eid, e.ename, e.eventdate, e.eventloc, e.regfee,
                   e.maxpart, e.maxvoln, e.orgusn,
                   s.sname AS organizer_name,
                   c.cname AS club_name,
                   COUNT(DISTINCT p.partusn) AS participant_count,
                   COUNT(DISTINCT v.volnusn) AS volunteer_count,
                   COALESCE(SUM(CASE WHEN pay.status = 'verified' THEN pay.amount ELSE 0 END), 0) AS revenue
            FROM event e
            LEFT JOIN student s ON e.orgusn = s.usn
            LEFT JOIN club c ON e.orgcid = c.cid
            LEFT JOIN participant p ON e.eid = p.parteid
            LEFT JOIN volunteer v ON e.eid = v.volneid
            LEFT JOIN payment pay ON e.eid = pay.event_id
            GROUP BY e.eid, e.ename, e.eventdate, e.eventloc, e.regfee,
                     e.maxpart, e.maxvoln, e.orgusn, s.sname, c.cname
            ORDER BY e.eventdate DESC
        `);
        res.json({ events });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching events' });
    }
});

// ─── Admin: Remove event ────────────────────────────────────────────────────────
app.delete('/api/admin/events/:eventId', requireAdmin, async (req, res) => {
    try {
        const { eventId } = req.params;
        await query('DELETE FROM event WHERE eid = $1', [eventId]);
        res.json({ success: true, message: 'Event removed' });
    } catch (err) {
        res.status(500).json({ error: 'Error removing event' });
    }
});

// ─── Admin: Get all organizers (approved) ──────────────────────────────────────
app.get('/api/admin/organizers', requireAdmin, async (req, res) => {
    try {
        const organizers = await query(`
            SELECT r.usn, r.college_name, r.club_name, r.role_in_club,
                   r.college_email, r.approved_at,
                   s.sname, s.emailid, s.sem,
                   COUNT(DISTINCT e.eid) AS events_organized
            FROM organizer_request r
            JOIN student s ON r.usn = s.usn
            LEFT JOIN event e ON e.orgusn = r.usn
            WHERE r.status = 'approved'
            GROUP BY r.usn, r.college_name, r.club_name, r.role_in_club,
                     r.college_email, r.approved_at, s.sname, s.emailid, s.sem
            ORDER BY s.sname ASC
        `);
        res.json({ organizers });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching organizers' });
    }
});

// ─── Admin: Revoke organizer (remove from club membership) ────────────────────
app.post('/api/admin/organizers/:usn/revoke', requireAdmin, async (req, res) => {
    try {
        const { usn } = req.params;
        // Mark request as rejected so they can't create events
        await query(
            "UPDATE organizer_request SET status = 'rejected' WHERE usn = $1",
            [usn]
        );
        // Remove all club memberships
        await query('DELETE FROM memberof WHERE studentusn = $1', [usn]);
        res.json({ success: true, message: 'Organizer status revoked' });
    } catch (err) {
        res.status(500).json({ error: 'Error revoking organizer' });
    }
});

// ─── Student: Submit organizer request ─────────────────────────────────────────
app.post('/api/organizer-request', requireAuth, async (req, res) => {
    try {
        const { college_email, college_name, club_name, role_in_club } = req.body;
        if (!college_email || !college_name || !club_name || !role_in_club) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const existing = await queryOne(
            'SELECT id, status FROM organizer_request WHERE usn = $1 LIMIT 1',
            [req.session.userUSN]
        );
        if (existing) {
            if (existing.status === 'pending') {
                return res.status(400).json({ error: 'You already have a pending request' });
            }
            if (existing.status === 'approved') {
                return res.status(400).json({ error: 'You are already an approved organizer' });
            }
            // Rejected — allow resubmission by updating
            await query(`
                UPDATE organizer_request
                SET college_email = $1, college_name = $2, club_name = $3,
                    role_in_club = $4, status = 'pending', created_at = NOW(),
                    reviewed_at = NULL, reviewed_by = NULL
                WHERE usn = $5
            `, [college_email, college_name, club_name, role_in_club, req.session.userUSN]);
            return res.json({ success: true, message: 'Request resubmitted successfully' });
        }

        await query(`
            INSERT INTO organizer_request (usn, college_email, college_name, club_name, role_in_club, status, created_at)
            VALUES ($1, $2, $3, $4, $5, 'pending', NOW())
        `, [req.session.userUSN, college_email, college_name, club_name, role_in_club]);

        res.status(201).json({ success: true, message: 'Request submitted! We will review it shortly.' });
    } catch (err) {
        res.status(500).json({ error: 'Error submitting request: ' + err.message });
    }
});

// ─── Student: Check own organizer request status ───────────────────────────────
app.get('/api/organizer-request/status', requireAuth, async (req, res) => {
    try {
        const request = await queryOne(
            'SELECT id, status, created_at, college_name, club_name, role_in_club FROM organizer_request WHERE usn = $1 LIMIT 1',
            [req.session.userUSN]
        );
        res.json({ request: request || null });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching request status' });
    }
});



// ============================================================
// QUEUE SYSTEM ROUTES
// Add these inside new_routes.js (before app.listen)
// ============================================================

// ── Helper: clean up expired queue entries ─────────────────────
async function purgeExpiredQueue(eventId) {
    await query(`
        UPDATE registration_queue
        SET status = 'expired'
        WHERE event_id = $1
          AND status = 'holding'
          AND expires_at < NOW()
    `, [eventId]);
}

// ── Helper: count truly occupied seats ─────────────────────────
// Occupied = confirmed participants + active holding slots
async function occupiedSeats(eventId) {
    // Confirmed registrations (free or payment verified)
    const confirmed = await queryCount(`
        SELECT count(*) FROM participant
        WHERE parteid = $1
          AND payment_status IN ('free', 'verified', 'pending_verification')
    `, [eventId]);

    // Active holding slots (someone clicked Register but hasn't submitted TXN ID yet)
    const holding = await queryCount(`
        SELECT count(*) FROM registration_queue
        WHERE event_id = $1
          AND status = 'holding'
          AND expires_at > NOW()
    `, [eventId]);

    return confirmed + holding;
}

// ── GET /api/events/:eventId/seat-status ───────────────────────
// Frontend calls this to know: available / holding / queued / full
app.get('/api/events/:eventId/seat-status', requireAuth, async (req, res) => {
    try {
        const eventId = parseInt(req.params.eventId);
        const userUSN  = req.session.userUSN;

        await purgeExpiredQueue(eventId);

        const event = await queryOne(
            'SELECT maxpart, regfee, is_team FROM event WHERE eid = $1 LIMIT 1',
            [eventId]
        );
        if (!event) return res.status(404).json({ error: 'Event not found' });

        const maxPart = event.maxpart || 0;

        // Already registered?
        const alreadyIn = await queryOne(
            'SELECT payment_status FROM participant WHERE partusn = $1 AND parteid = $2 LIMIT 1',
            [userUSN, eventId]
        );
        if (alreadyIn) return res.json({ status: 'registered', paymentStatus: alreadyIn.payment_status });

        // Already in queue?
        const mySlot = await queryOne(
            'SELECT id, status, expires_at FROM registration_queue WHERE event_id = $1 AND usn = $2 LIMIT 1',
            [eventId, userUSN]
        );
        if (mySlot && mySlot.status === 'holding') {
            const secsLeft = Math.max(0, Math.ceil((new Date(mySlot.expires_at) - Date.now()) / 1000));
            return res.json({ status: 'holding', expiresIn: secsLeft, queueId: mySlot.id });
        }

        if (maxPart === 0) return res.json({ status: 'available' });

        const occupied = await occupiedSeats(eventId);
        if (occupied < maxPart) return res.json({ status: 'available', remaining: maxPart - occupied });

        // Check queue position
        const queuePos = await queryCount(`
            SELECT count(*) FROM registration_queue
            WHERE event_id = $1
              AND status = 'holding'
              AND expires_at > NOW()
              AND created_at < COALESCE(
                (SELECT created_at FROM registration_queue WHERE event_id = $1 AND usn = $2 LIMIT 1),
                NOW() + INTERVAL '1 year'
              )
        `, [eventId, userUSN]);

        return res.json({
            status: 'full',
            queueLength: await queryCount(`
                SELECT count(*) FROM registration_queue
                WHERE event_id = $1 AND status = 'holding' AND expires_at > NOW()
            `, [eventId]),
        });
    } catch (err) {
        console.error('seat-status error:', err);
        res.status(500).json({ error: 'Error checking seat status' });
    }
});

// ── POST /api/events/:eventId/claim-seat ───────────────────────
// Called when user clicks "Register" on a paid event.
// Reserves their slot for HOLD_MINUTES before they submit TXN ID.
const HOLD_MINUTES = 15;

app.post('/api/events/:eventId/claim-seat', requireAuth, async (req, res) => {
    try {
        const eventId = parseInt(req.params.eventId);
        const userUSN  = req.session.userUSN;

        await purgeExpiredQueue(eventId);

        const event = await queryOne(
            'SELECT maxpart, regfee, orgusn, is_team FROM event WHERE eid = $1 LIMIT 1',
            [eventId]
        );
        if (!event) return res.status(404).json({ error: 'Event not found' });
        if (event.orgusn === userUSN) return res.status(403).json({ error: 'You cannot register in your own event' });
        if ((event.regfee || 0) <= 0) return res.status(400).json({ error: 'Use the free registration flow for free events' });

        // Already registered?
        const alreadyIn = await queryOne(
            'SELECT partusn FROM participant WHERE partusn = $1 AND parteid = $2 LIMIT 1',
            [userUSN, eventId]
        );
        if (alreadyIn) return res.status(400).json({ error: 'You are already registered' });

        // Already holding?
        const existing = await queryOne(
            'SELECT id, status, expires_at FROM registration_queue WHERE event_id = $1 AND usn = $2 LIMIT 1',
            [eventId, userUSN]
        );
        if (existing && existing.status === 'holding' && new Date(existing.expires_at) > new Date()) {
            const secsLeft = Math.ceil((new Date(existing.expires_at) - Date.now()) / 1000);
            return res.json({ success: true, status: 'holding', expiresIn: secsLeft, queueId: existing.id, message: 'You already have an active seat hold' });
        }

        const maxPart = event.maxpart || 0;
        if (maxPart > 0) {
            const occupied = await occupiedSeats(eventId);
            if (occupied >= maxPart) {
                // Event full — put in queue
                const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60 * 1000);
                const slot = await queryOne(`
                    INSERT INTO registration_queue (event_id, usn, status, expires_at)
                    VALUES ($1, $2, 'holding', $3)
                    ON CONFLICT (event_id, usn) DO UPDATE
                        SET status = 'holding', expires_at = $3, created_at = NOW()
                    RETURNING id
                `, [eventId, userUSN, expiresAt]);

                const pos = await queryCount(`
                    SELECT count(*) FROM registration_queue
                    WHERE event_id = $1
                      AND status = 'holding'
                      AND expires_at > NOW()
                      AND created_at <= (SELECT created_at FROM registration_queue WHERE id = $2 LIMIT 1)
                `, [eventId, slot.id]);

                return res.json({
                    success: true,
                    status: 'queued',
                    queuePosition: pos,
                    expiresIn: HOLD_MINUTES * 60,
                    message: `Event is full. You are #${pos} in the queue. If a seat opens you will be notified here.`
                });
            }
        }

        // Seat available — create hold
        const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60 * 1000);
        const slot = await queryOne(`
            INSERT INTO registration_queue (event_id, usn, status, expires_at)
            VALUES ($1, $2, 'holding', $3)
            ON CONFLICT (event_id, usn) DO UPDATE
                SET status = 'holding', expires_at = $3, created_at = NOW()
            RETURNING id
        `, [eventId, userUSN, expiresAt]);

        res.json({
            success: true,
            status: 'holding',
            queueId: slot.id,
            expiresIn: HOLD_MINUTES * 60,
            message: `Seat held for ${HOLD_MINUTES} minutes. Please complete payment before time runs out.`
        });
    } catch (err) {
        console.error('claim-seat error:', err);
        res.status(500).json({ error: 'Error claiming seat: ' + err.message });
    }
});

// ── GET /api/events/:eventId/queue-position ────────────────────
// Polling endpoint — frontend calls every 30s to check if
// a queued person has been promoted to a real hold.
app.get('/api/events/:eventId/queue-position', requireAuth, async (req, res) => {
    try {
        const eventId = parseInt(req.params.eventId);
        const userUSN  = req.session.userUSN;

        await purgeExpiredQueue(eventId);

        const mySlot = await queryOne(
            'SELECT id, status, expires_at FROM registration_queue WHERE event_id = $1 AND usn = $2 LIMIT 1',
            [eventId, userUSN]
        );

        if (!mySlot || mySlot.status === 'expired') {
            return res.json({ status: 'expired' });
        }

        if (mySlot.status === 'submitted') {
            return res.json({ status: 'submitted' });
        }

        // Check if a seat has opened for this person (they're first in queue)
        const event = await queryOne('SELECT maxpart FROM event WHERE eid = $1 LIMIT 1', [eventId]);
        const maxPart = event?.maxpart || 0;

        if (maxPart > 0) {
            const occupied = await occupiedSeats(eventId);
            if (occupied < maxPart) {
                // Seat opened — they're promoted, update their expiry to give them 15 min from now
                const newExpiry = new Date(Date.now() + HOLD_MINUTES * 60 * 1000);
                await query(`
                    UPDATE registration_queue SET expires_at = $1 WHERE id = $2
                `, [newExpiry, mySlot.id]);
                return res.json({
                    status: 'holding',
                    expiresIn: HOLD_MINUTES * 60,
                    promoted: true,
                    message: 'A seat just opened! You have 15 minutes to complete payment.'
                });
            }
        }

        // Still queued
        const secsLeft = Math.max(0, Math.ceil((new Date(mySlot.expires_at) - Date.now()) / 1000));
        const pos = await queryCount(`
            SELECT count(*) FROM registration_queue
            WHERE event_id = $1
              AND status = 'holding'
              AND expires_at > NOW()
              AND created_at <= (SELECT created_at FROM registration_queue WHERE id = $2 LIMIT 1)
        `, [eventId, mySlot.id]);

        res.json({
            status: secsLeft > 0 ? 'queued' : 'expired',
            queuePosition: pos,
            expiresIn: secsLeft
        });
    } catch (err) {
        res.status(500).json({ error: 'Error checking queue position' });
    }
});


app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '─'.repeat(50));
    console.log(`🚀 FLO BACKEND: http://localhost:${PORT}`);
    console.log(`📡 CORS: ${allowedOrigins.length} origins allowed`);
    console.log(`🔐 AUTH: Custom JWT + Neon PG + Google OAuth`);
    console.log(`🌱 MODE: ${IS_PRODUCTION ? 'Production' : 'Development'}`);
    console.log('─'.repeat(50) + '\n');
});
