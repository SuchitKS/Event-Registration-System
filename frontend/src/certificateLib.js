// Shared constants + helpers for the certificate editor, preview and PDF generator.
// Layout units: x / y / w / h are % of the page (11 x 8.5 in). Font size is % of page WIDTH.

export const PAGE_RATIO = 11 / 8.5;

// Only these four fonts are allowed. Files live in /public (root).
export const FONTS = {
  Allura:    { label: 'Allura',                  file: '/Allura-Regular.ttf',            css: 'CertAllura' },
  Playfair:  { label: 'Playfair Display Italic', file: '/PlayfairDisplay-MediumItalic.ttf', css: 'CertPlayfair' },
  Meie:      { label: 'Meie Script',             file: '/MeieScript-Regular.ttf',        css: 'CertMeie' },
  Cormorant: { label: 'Cormorant Infant',        file: '/CormorantInfant-SemiBold.ttf',  css: 'CertCormorant' },
};

export const TEMPLATES = {
  teal:   { label: 'Template 1', bg: '/cert/teal.jpg',   colors: ['#000000', '#FFFFFF', '#FF3B30', '#34C759', '#007AFF', '#FFCC00', '#0E3B44', '#CFEFE4', '#F6D58A'], base: '#FFFFFF' },
  orange: { label: 'Template 2',   bg: '/cert/orange.jpg', colors: ['#000000', '#FFFFFF', '#FF3B30', '#34C759', '#007AFF', '#FFCC00', '#7A1A0C', '#222222', '#F6D58A'], base: '#222222' },
};

export const FIELDS = {
  name: 'Name',
  usn: 'USN',
  department: 'Department',
  event: 'Event name',
  date: 'Date',
  points: 'Activity points',
  points_line: 'Points sentence',
  role_title: 'Role (Participant / Volunteer)',
  role_phrase: 'Role phrase (participated in / volunteered for)',
  custom_text: 'Custom text',
};

let _id = 0;
export const newId = () => `e${Date.now().toString(36)}${(++_id).toString(36)}`;

const tx = (x, y, w, h, text, font, size, color) =>
  ({ id: newId(), t: 'text', x, y, w, h, text, font, size, color, al: 'center' });
const sig = (x, y, name, desig, color) =>
  ({ id: newId(), t: 'sig', x, y, w: 27, h: 14, name, desig, font: 'Cormorant', size: 1.8, color, al: 'center', src: null });

const BODY = 'This is to certify that {{name}} bearing USN {{usn}} has actively {{role_phrase}} the {{event}} event held on {{date}} at BMS College of Engineering, Bangalore.';
const PTS = '{{points_line}}';

export const defaultLayout = (template) =>
  template === 'orange'
    ? [
        tx(12, 14, 76, 14, 'CERTIFICATE', 'Cormorant', 8.2, '#222222'),
        tx(25, 27, 50, 8, 'of Completion', 'Meie', 4.4, '#222222'),
        tx(18, 42, 64, 14, BODY, 'Cormorant', 2.3, '#222222'),
        tx(18, 58, 64, 5, PTS, 'Cormorant', 2.1, '#7A1A0C'),
        sig(14, 70, 'Name', 'Event Coordinator', '#222222'),
        sig(59, 70, 'Name', 'Principal', '#222222'),
      ]
    : [
        tx(15, 27.5, 70, 11, 'Participation', 'Allura', 7, '#F6D58A'),
        tx(15, 38, 70, 11, 'CERTIFICATE', 'Cormorant', 7.2, '#F6D58A'),
        tx(18, 50, 64, 12, BODY, 'Cormorant', 2.2, '#FFFFFF'),
        tx(18, 63.5, 64, 5, PTS, 'Cormorant', 2.0, '#F6D58A'),
        sig(14, 72, 'Name', 'Event Coordinator', '#FFFFFF'),
        sig(59, 72, 'Name', 'Principal', '#FFFFFF'),
      ];

// Accepts whatever came back from the DB and returns something safe to render.
export const normalizeLayout = (template, layout) => {
  let arr = layout;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = null; } }
  if (!Array.isArray(arr) || !arr.length) return defaultLayout(template);
  return arr.map((e) => ({ ...e, id: e.id || newId() }));
};

export const layoutSig = (arr) => JSON.stringify((arr || []).map(({ id, ...r }) => r));

// USN like 1BM23CS045 -> "CS"
const DEPTS = {
  CS: 'Computer Science & Engineering', IS: 'Information Science & Engineering',
  EC: 'Electronics & Communication Engineering', EE: 'Electrical & Electronics Engineering',
  ME: 'Mechanical Engineering', CV: 'Civil Engineering', AI: 'Artificial Intelligence & Machine Learning',
  AD: 'Artificial Intelligence & Data Science', CY: 'Cyber Security', CD: 'Computer Science & Design',
  BT: 'Biotechnology', CH: 'Chemical Engineering', IM: 'Industrial Engineering & Management',
  ET: 'Electronics & Telecommunication Engineering', AS: 'Aerospace Engineering', IC: 'Instrumentation & Control',
};
export const deptFromUsn = (usn) => {
  const m = String(usn || '').toUpperCase().match(/^1[A-Z]{2}\d{2}([A-Z]{2})\d{3}$/);
  return m ? (DEPTS[m[1]] || m[1]) : '';
};

export const fmtCertDate = (ds) =>
  ds ? new Date(ds).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';

// Builds the object used to replace {{tokens}}.
export const buildCertData = ({ name, usn, event, date, points, customText, role = 'participant' }) => {
  const pts = parseFloat(String(points ?? 0).replace(/[^0-9.]/g, '')) || 0;
  return {
    name: name || 'Participant',
    usn: usn || '',
    department: deptFromUsn(usn),
    event: event || '',
    date: fmtCertDate(date),
    points: String(pts),
    points_line: pts > 0 ? `${pts} activity point${pts !== 1 ? 's' : ''} can be claimed from this certificate.` : '',
    custom_text: customText || '',
    role_title: role === 'volunteer' ? 'Volunteer' : 'Participant',
    role_phrase: role === 'volunteer' ? 'volunteered for' : 'participated in',
  };
};

export const SAMPLE_STUDENTS = [
  { name: 'Ananya Rao', usn: '1BM23CS045' },
  { name: 'Sri Lakshmi Venkata Subramanian', usn: '1BM22IS118' },
  { name: 'Rohan M', usn: '1BM24EC009' },
];

export const fillTokens = (s, data) =>
  String(s ?? '').replace(/\{\{(\w+)\}\}/g, (_, k) => (data && data[k] != null ? data[k] : ''));

// Downscale an uploaded image so the layout JSON stays small. Returns a data URL.
export const fileToDataUrl = (file, maxSide = 600) =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const k = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });

// New copies of a layout (fresh ids) – used when volunteers get their own design.
export const cloneLayout = (arr) => (arr || []).map((e) => ({ ...e, id: newId() }));
