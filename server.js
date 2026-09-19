/**
 * ClassChat — Account system, posting, and image support.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const expressLayouts = require('express-ejs-layouts');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { WebSocketServer } = require('ws');
const webpush = require('web-push');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

const callTokens = new Map();
const socketsByUser = new Map(); // userId -> Set<WebSocket>
const pushSubscriptionsByUser = new Map(); // userId -> array of { subscription }
const CALL_TOKEN_TTL_MS = 60 * 1000;

function addSocketUser(userId, ws) {
  if (!socketsByUser.has(userId)) {
    socketsByUser.set(userId, new Set());
  }
  socketsByUser.get(userId).add(ws);
}

function removeSocketUser(userId, ws) {
  const set = socketsByUser.get(userId);
  if (set) {
    set.delete(ws);
    if (set.size === 0) socketsByUser.delete(userId);
  }
}

function isUserOnline(userId) {
  const set = socketsByUser.get(userId);
  if (!set || set.size === 0) return false;
  for (const s of set) {
    if (s.readyState === 1) return true;
  }
  return false;
}

function sendToUser(userId, eventObj) {
  const set = socketsByUser.get(userId);
  if (!set || set.size === 0) return false;
  const payload = typeof eventObj === 'string' ? eventObj : JSON.stringify(eventObj);
  let sent = false;
  for (const s of set) {
    if (s.readyState === 1) {
      try {
        s.send(payload);
        sent = true;
      } catch (_) {}
    }
  }
  return sent;
}

function isEmoticonyt(userOrUsername) {
  const u = typeof userOrUsername === 'string' ? userOrUsername : (userOrUsername?.username || '');
  return ['emoticonyt', 'doriandelvalle'].includes((u || '').toLowerCase());
}

function disconnectUserSockets(userId, reason = 'Account restricted') {
  const set = socketsByUser.get(userId);
  if (!set || set.size === 0) return;
  for (const s of set) {
    try {
      s.send(JSON.stringify({ type: 'sanctioned', reason }));
      s.close(4003, reason);
    } catch (_) {}
  }
  socketsByUser.delete(userId);
}

function broadcastToRoom(roomId, eventObj) {
  const room = db.getChatroomById(roomId);
  if (!room) return;
  const payload = typeof eventObj === 'string' ? eventObj : JSON.stringify(eventObj);
  if (room.type === 'public') {
    for (const [uid, sockets] of socketsByUser.entries()) {
      for (const s of sockets) {
        if (s.readyState === 1) {
          try { s.send(payload); } catch (_) {}
        }
      }
    }
  } else {
    const members = db.getChatroomMembers(roomId);
    for (const m of members) {
      sendToUser(m.user_id, eventObj);
    }
  }
}

const DATA_DIR = path.join(__dirname, 'data');
const VAPID_PATH = path.join(DATA_DIR, 'vapid.json');
let vapidPublic = '';
let vapidPrivate = '';
if (fs.existsSync(VAPID_PATH)) {
  try {
    const vapid = JSON.parse(fs.readFileSync(VAPID_PATH, 'utf8'));
    vapidPublic = vapid.publicKey || '';
    vapidPrivate = vapid.privateKey || '';
  } catch (_) {}
}
if (!vapidPublic || !vapidPrivate) {
  const keys = webpush.generateVAPIDKeys();
  vapidPublic = keys.publicKey;
  vapidPrivate = keys.privateKey;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(VAPID_PATH, JSON.stringify({ publicKey: vapidPublic, privateKey: vapidPrivate }, null, 2));
}
webpush.setVapidDetails('mailto:classchat@localhost', vapidPublic, vapidPrivate);

function sendPushToUser(userId, payload) {
  const subs = pushSubscriptionsByUser.get(userId);
  if (!subs || subs.length === 0) return;
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  subs.forEach((sub) => {
    webpush.sendNotification(sub, body).catch(() => {});
  });
}

function createCallToken(userId) {
  const token = require('crypto').randomBytes(24).toString('hex');
  callTokens.set(token, { userId, expires: Date.now() + CALL_TOKEN_TTL_MS });
  setTimeout(() => callTokens.delete(token), CALL_TOKEN_TTL_MS);
  return token;
}

function validateCallToken(token) {
  const entry = callTokens.get(token);
  if (!entry || Date.now() > entry.expires) return null;
  return entry.userId;
}

const DISTRICT = process.env.DISTRICT || '';
const SCHOOL = process.env.SCHOOL || '';
const SUPPORT_USERNAME = 'CCSupport';

const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const AVATAR_DIR = path.join(__dirname, 'public', 'uploads', 'avatars');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (file.mimetype.match(/\/(jpeg|jpg|png|gif|webp)$/i) && file.originalname.split('.').pop()) || 'jpg';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  },
});
const MAX_ATTACHMENT = 5 * 1024 * 1024; // 5MB
const upload = multer({
  storage,
  limits: { fileSize: MAX_ATTACHMENT },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.mimetype);
    cb(null, ok);
  },
});
const attachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (file.originalname && file.originalname.split('.').pop()) || file.mimetype.split('/')[1] || 'bin';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext.replace(/[^a-z0-9]/gi, '')}`);
  },
});
const attachmentFilter = (req, file, cb) => {
  const ok = /^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.mimetype) ||
    /^video\//i.test(file.mimetype) ||
    /^application\//i.test(file.mimetype) ||
    /^text\//i.test(file.mimetype);
  cb(null, ok);
};
const postAttachUpload = multer({
  storage: attachmentStorage,
  limits: { fileSize: MAX_ATTACHMENT },
  fileFilter: attachmentFilter,
}).fields([{ name: 'image', maxCount: 1 }, { name: 'file', maxCount: 1 }, { name: 'video', maxCount: 1 }]);
const messageAttachUpload = multer({
  storage: attachmentStorage,
  limits: { fileSize: MAX_ATTACHMENT },
  fileFilter: attachmentFilter,
}).fields([{ name: 'image', maxCount: 1 }, { name: 'file', maxCount: 1 }, { name: 'video', maxCount: 1 }]);

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    const ext = (file.mimetype.match(/\/(jpeg|jpg|png|gif|webp)$/i) && file.originalname.split('.').pop()) || 'jpg';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  },
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.mimetype);
    cb(null, ok);
  },
});

db.initDb();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
const SESSION_DIR = path.join(__dirname, 'data', 'sessions');
const MAINTENANCE_FLAG = path.join(__dirname, 'data', 'maintenance.flag');
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

function getMaintenanceMode() {
  try {
    return fs.existsSync(MAINTENANCE_FLAG);
  } catch (_) {
    return false;
  }
}

function setMaintenanceMode(on) {
  try {
    if (on) fs.writeFileSync(MAINTENANCE_FLAG, '1', 'utf8');
    else if (fs.existsSync(MAINTENANCE_FLAG)) fs.unlinkSync(MAINTENANCE_FLAG);
  } catch (_) {}
}

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'classchat-dev-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    store: new FileStore({
      path: SESSION_DIR,
      ttl: 30 * 24 * 60 * 60,
      retries: 0,
    }),
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
    },
  })
);

function getFeatureFlags() {
  const flagsPath = path.join(__dirname, 'feature_flags.txt');
  const flags = {
    chatroom_enabled: false,
  };
  if (fs.existsSync(flagsPath)) {
    try {
      const content = fs.readFileSync(flagsPath, 'utf8');
      content.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const [key, val] = trimmed.split('=');
        if (key && val !== undefined) {
          flags[key.trim()] = val.trim() === '1' || val.trim().toLowerCase() === 'true';
        }
      });
    } catch (_) {}
  }
  return flags;
}

app.use((req, res, next) => {
  res.locals.featureFlags = getFeatureFlags();
  res.locals.showSupportButton = !!req.session.userId;
  res.locals.isGuest = !!req.session.guest;
  res.locals.is_staff = !!req.session.is_staff;
  res.locals.username = req.session.username || null;
  res.locals.userId = req.session.userId || null;
  res.locals.district = DISTRICT;
  res.locals.school = SCHOOL;
  res.locals.currentPath = req.path;
  res.locals.isOwner = isEmoticonyt(req.session.username);
  if (req.session.userId) {
    const u = db.getUserById(req.session.userId);
    res.locals.currentUser = u || null;
    res.locals.pendingFriendRequestsCount = db.getPendingRequestsToMe(req.session.userId).length;
    res.locals.unreadActivityCount = db.getUnreadNotificationCount(req.session.userId);
    res.locals.userSettings = db.getUserSettings(req.session.userId);
  } else {
    res.locals.currentUser = null;
    res.locals.pendingFriendRequestsCount = 0;
    res.locals.unreadActivityCount = 0;
    res.locals.userSettings = { theme: 'dark', email_digest: 'none' };
  }
  next();
});

// Moderation sanction interceptor (bans and timeouts)
app.use((req, res, next) => {
  if (!req.session.userId) return next();
  const u = res.locals.currentUser || db.getUserById(req.session.userId);
  if (!u) return next();

  // Allow static assets, uploads, and logout
  if (req.path === '/logout' || req.path.startsWith('/uploads') || req.path.startsWith('/css') || req.path.startsWith('/js')) {
    return next();
  }

  // Check Ban
  if (u.is_banned) {
    if (req.path === '/banned' || req.path === '/appeal') return next();
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(403).json({ error: 'banned', reason: u.ban_reason });
    }
    return res.redirect('/banned');
  }

  // Check Timeout
  if (u.timeout_until) {
    const timeoutTime = new Date(u.timeout_until).getTime();
    if (timeoutTime > Date.now()) {
      if (req.path === '/timed-out' || req.path === '/appeal') return next();
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(403).json({ error: 'timed_out', timeout_until: u.timeout_until, reason: u.timeout_reason });
      }
      return res.redirect('/timed-out');
    } else {
      // Timeout has expired! Automatically unlock
      db.clearUserTimeout(u.id);
      u.timeout_until = null;
      u.timeout_reason = null;
    }
  }

  // If user is currently on /timed-out or /banned but no longer sanctioned, redirect to /feed
  if (req.path === '/timed-out' || req.path === '/banned') {
    return res.redirect('/feed');
  }

  next();
});

app.use((req, res, next) => {
  if (!getMaintenanceMode()) return next();
  if (req.path.startsWith('/staff') || req.path === '/logout') return next();
  res.status(503).render('maintenance', { title: 'Maintenance — ClassChat', layout: false });
});

function isUsernameCompatible(username) {
  if (!username || typeof username !== 'string') return false;
  return /^[a-z0-9_-]{2,30}$/.test(username);
}

function sanitizeUsername(username) {
  if (!username || typeof username !== 'string') return 'user';
  // Replace incompatible characters with '-'
  let sanitized = username.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  // Collapse multiple dashes into one and trim leading/trailing dashes
  sanitized = sanitized.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (sanitized.length < 2) {
    sanitized = (sanitized || 'user') + '-1';
  }
  return sanitized.slice(0, 30);
}

// ClassChat 3.0 migration functions
// (Automatic interceptor disabled so users can log in directly without being forced into migration screens)

function requireAuth(req, res, next) {
  if (req.session.userId) {
    if (req.session.username !== 'wn-test' && !db.hasSeenWhatsNew(req.session.userId, '3.1')) {
      if (!req.path.startsWith('/whats-new') && req.path !== '/logout') {
        return res.redirect('/whats-new');
      }
    }
    return next();
  }
  res.redirect('/join?login=1');
}

function allowGuestOrAuth(req, res, next) {
  if (req.session.userId) {
    if (req.session.username !== 'wn-test' && !db.hasSeenWhatsNew(req.session.userId, '3.1')) {
      if (!req.path.startsWith('/whats-new') && req.path !== '/logout') {
        return res.redirect('/whats-new');
      }
    }
    return next();
  }
  if (req.session.guest) return next();
  res.redirect('/join?login=1');
}

function requireStaff(req, res, next) {
  if (!req.session.userId) {
    return res.status(403).render('unavailable', {
      title: 'ClassChat',
      layout: 'layout',
      message: 'This page is not available for your account.',
      closeUrl: '/',
    });
  }
  const user = db.getUserById(req.session.userId);
  if (!user || !user.is_staff) {
    return res.status(403).render('unavailable', {
      title: 'ClassChat',
      layout: 'layout',
      message: 'This page is not available for your account.',
      closeUrl: '/feed',
    });
  }
  req.session.is_staff = true;
  next();
}

app.get('/staff', requireStaff, (req, res) => {
  res.redirect('/staff/dashboard');
});

app.get('/staff/login', (req, res) => {
  if (getMaintenanceMode()) {
    req.session.destroy(() => res.redirect('/maintenance-login.html'));
    return;
  }
  if (req.session.userId) {
    const user = db.getUserById(req.session.userId);
    if (user && user.is_staff) return res.redirect('/staff/dashboard');
    return res.redirect('/feed');
  }
  res.render('staff/login', {
    title: 'Staff login — ClassChat',
    layout: false,
    district: DISTRICT,
    school: SCHOOL,
    error: req.query.error,
  });
});

app.post('/staff/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const user = db.getUserByUsername(username);
  if (!user || !user.is_staff || !bcrypt.compareSync(password, user.password_hash)) {
    return res.redirect('/staff/login?error=invalid');
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.school_id = user.school_id;
  req.session.district = user.district;
  req.session.school = user.school;
  req.session.is_staff = true;
  delete req.session.guest;

  if (user.is_banned) {
    return res.redirect('/banned');
  }
  if (user.timeout_until && new Date(user.timeout_until).getTime() > Date.now()) {
    return res.redirect('/timed-out');
  }

  res.redirect('/staff/dashboard');
});

app.get('/', (req, res) => {
  if (req.session.userId) {
    if (req.session.username !== 'wn-test' && !db.hasSeenWhatsNew(req.session.userId, '3.1')) {
      return res.redirect('/whats-new');
    }
    return res.redirect('/feed');
  }
  res.render('landing', {
    title: 'ClassChat',
    district: DISTRICT,
    school: SCHOOL,
  });
});

app.get('/guest', (req, res) => {
  if (req.session.userId) return res.redirect('/feed');
  req.session.guest = true;
  res.redirect('/feed');
});

app.get('/join', (req, res) => {
  if (req.session.userId) return res.redirect('/feed');
  res.render('index', {
    title: 'Join — ClassChat',
    district: DISTRICT,
    school: SCHOOL,
    loginError: req.query.login_error,
    registerError: req.query.register_error,
    showLogin: req.query.login === '1',
  });
});

app.post('/register', (req, res) => {
  const username = (req.body.username || '').trim().toLowerCase();
  const password = req.body.password || '';
  const schoolId = (req.body.school_id || '').trim();
  const district = req.body.district || DISTRICT;
  const school = req.body.school || SCHOOL;
  if (!username || !password || !schoolId) {
    return res.redirect('/join?register_error=missing');
  }
  if (username.length < 2) return res.redirect('/join?register_error=username_short');
  if (!isUsernameCompatible(username)) return res.redirect('/join?register_error=username_invalid');
  if (password.length < 6) return res.redirect('/join?register_error=password_short');
  if (db.getUserByUsername(username)) return res.redirect('/join?register_error=username_taken');
  const passwordHash = bcrypt.hashSync(password, 10);
  const userId = db.createUser(username, passwordHash, schoolId, district, school, 0);
  req.session.userId = userId;
  req.session.username = username;
  req.session.school_id = schoolId;
  req.session.district = district;
  req.session.school = school;
  delete req.session.guest;
  res.redirect('/feed');
});

app.post('/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const user = db.getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.redirect('/join?login=1&login_error=invalid');
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.school_id = user.school_id;
  req.session.district = user.district;
  req.session.school = user.school;
  req.session.is_staff = user.is_staff ? true : false;
  delete req.session.guest;

  if (user.is_banned) {
    return res.redirect('/banned');
  }
  if (user.timeout_until && new Date(user.timeout_until).getTime() > Date.now()) {
    return res.redirect('/timed-out');
  }

  if (user.username === 'wn-test') {
    return res.redirect('/whats-new');
  }
  if (!db.hasSeenWhatsNew(user.id, '3.1')) {
    return res.redirect('/whats-new');
  }
  res.redirect('/feed');
});

app.get('/timed-out', (req, res) => {
  if (!req.session.userId) return res.redirect('/join?login=1');
  const u = db.getUserById(req.session.userId);
  if (!u || !u.timeout_until || new Date(u.timeout_until).getTime() <= Date.now()) {
    return res.redirect('/feed');
  }
  res.render('timed-out', {
    title: 'Account Timed Out — ClassChat',
    layout: 'layout',
    hideSidebar: true,
    username: u.username,
    timeout_until: u.timeout_until,
    timeout_reason: u.timeout_reason,
    appealed: req.query.appealed === '1',
    showAppeal: req.query.appeal === '1',
    error: req.query.error || null,
  });
});

app.get('/banned', (req, res) => {
  if (!req.session.userId) return res.redirect('/join?login=1');
  const u = db.getUserById(req.session.userId);
  if (!u || !u.is_banned) {
    return res.redirect('/feed');
  }
  res.render('banned', {
    title: 'Account Suspended — ClassChat',
    layout: 'layout',
    hideSidebar: true,
    username: u.username,
    ban_reason: u.ban_reason,
    banned_at: u.banned_at,
    appealed: req.query.appealed === '1',
    showAppeal: req.query.appeal === '1',
    error: req.query.error || null,
  });
});

app.get('/appeal', (req, res) => {
  if (!req.session.userId) return res.redirect('/join?login=1');
  const u = db.getUserById(req.session.userId);
  if (!u) return res.redirect('/join?login=1');
  if (u.is_banned) return res.redirect('/banned?appeal=1');
  if (u.timeout_until && new Date(u.timeout_until).getTime() > Date.now()) {
    return res.redirect('/timed-out?appeal=1');
  }
  res.redirect('/feed');
});

app.post('/appeal', (req, res) => {
  if (!req.session.userId) return res.redirect('/join?login=1');
  const u = db.getUserById(req.session.userId);
  if (!u) return res.redirect('/join?login=1');

  const isBanned = !!u.is_banned;
  const isTimedOut = !!(u.timeout_until && new Date(u.timeout_until).getTime() > Date.now());

  if (!isBanned && !isTimedOut) {
    return res.redirect('/feed');
  }

  const type = (req.body.type || (isBanned ? 'ban' : 'timeout')).toLowerCase();
  const isBanType = type === 'ban' || isBanned;
  const prefix = isBanType ? '[BAN APPEAL]' : '[TIMEOUT APPEAL]';
  const targetRedirect = isBanType ? '/banned' : '/timed-out';

  const rawTitle = (req.body.title || '').trim();
  const rawSubject = (req.body.subject || '').trim();

  if (!rawTitle || !rawSubject) {
    return res.redirect(`${targetRedirect}?error=missing&appeal=1`);
  }

  const ticketSubject = `${prefix} ${rawTitle}`;
  const ticketMessage = rawSubject;

  db.createSupportTicket(u.id, ticketSubject, 'account', 'high', ticketMessage);
  return res.redirect(`${targetRedirect}?appealed=1`);
});

app.get('/whats-new', requireAuth, (req, res) => {
  res.render('whats-new', {
    title: "What's New — ClassChat 3.1",
    layout: 'layout',
    hideSidebar: true,
    username: req.session.username,
  });
});

app.all('/whats-new/dismiss', requireAuth, (req, res) => {
  if (req.session.username !== 'wn-test') {
    db.markSeenWhatsNew(req.session.userId, '3.1');
  }
  res.redirect('/feed');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/migrate-username', (req, res) => {
  if (!req.session.userId) {
    return res.status(403).render('unavailable', {
      title: 'ClassChat',
      layout: 'layout',
      message: 'This page is not available for your account.',
      closeUrl: '/',
    });
  }
  const user = db.getUserById(req.session.userId);
  if (!user) return res.redirect('/logout');

  const currentUsername = user.username;
  const sanitized = sanitizeUsername(currentUsername);

  // If already compatible and not viewing the success screen
  if (isUsernameCompatible(currentUsername) && req.query.done !== '1') {
    return res.redirect('/feed');
  }

  const step = req.query.done === '1' ? 3 : (req.query.step === '2' ? 2 : 1);

  res.render('migrate-username', {
    title: 'ClassChat 3.0 — Username Update',
    layout: 'layout',
    step,
    currentUsername,
    sanitizedUsername: sanitized,
    enteredUsername: req.query.u || sanitized,
    enteredConfirmUsername: req.query.cu || '',
    error: req.query.error || null,
  });
});

app.post('/migrate-username', (req, res) => {
  if (!req.session.userId) return res.redirect('/join?login=1');
  const user = db.getUserById(req.session.userId);
  if (!user) return res.redirect('/logout');

  const newUsername = (req.body.username || '').trim().toLowerCase();
  const confirmUsername = (req.body.confirm_username || '').trim().toLowerCase();
  const password = req.body.password || '';

  const sanitized = sanitizeUsername(user.username);

  if (!newUsername || !confirmUsername || !password) {
    return res.render('migrate-username', {
      title: 'ClassChat 3.0 — Username Update',
      layout: 'layout',
      step: 2,
      currentUsername: user.username,
      sanitizedUsername: sanitized,
      enteredUsername: newUsername,
      enteredConfirmUsername: confirmUsername,
      error: 'missing',
    });
  }

  if (newUsername !== confirmUsername) {
    return res.render('migrate-username', {
      title: 'ClassChat 3.0 — Username Update',
      layout: 'layout',
      step: 2,
      currentUsername: user.username,
      sanitizedUsername: sanitized,
      enteredUsername: newUsername,
      enteredConfirmUsername: confirmUsername,
      error: 'mismatch',
    });
  }

  if (!isUsernameCompatible(newUsername)) {
    return res.render('migrate-username', {
      title: 'ClassChat 3.0 — Username Update',
      layout: 'layout',
      step: 2,
      currentUsername: user.username,
      sanitizedUsername: sanitized,
      enteredUsername: newUsername,
      enteredConfirmUsername: confirmUsername,
      error: 'invalid_username',
    });
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.render('migrate-username', {
      title: 'ClassChat 3.0 — Username Update',
      layout: 'layout',
      step: 2,
      currentUsername: user.username,
      sanitizedUsername: sanitized,
      enteredUsername: newUsername,
      enteredConfirmUsername: confirmUsername,
      error: 'invalid_password',
    });
  }

  const existing = db.getUserByUsername(newUsername);
  if (existing && existing.id !== user.id) {
    return res.render('migrate-username', {
      title: 'ClassChat 3.0 — Username Update',
      layout: 'layout',
      step: 2,
      currentUsername: user.username,
      sanitizedUsername: sanitized,
      enteredUsername: newUsername,
      enteredConfirmUsername: confirmUsername,
      error: 'username_taken',
    });
  }

  db.updateUsername(user.id, newUsername);
  req.session.username = newUsername;

  res.render('migrate-username', {
    title: 'ClassChat 3.0 — Username Update',
    layout: 'layout',
    step: 3,
    currentUsername: newUsername,
    sanitizedUsername: newUsername,
    enteredUsername: '',
    enteredConfirmUsername: '',
    error: null,
  });
});

function formatPostTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

app.get('/feed', allowGuestOrAuth, (req, res) => {
  const classId = req.query.class ? String(req.query.class).trim() : null;
  const classes = db.getClasses();
  const currentClass = classId && classes.find((c) => String(c.id) === classId) ? { id: classId, name: classes.find((c) => String(c.id) === classId).name } : null;
  const raw = db.getPosts(100, currentClass ? currentClass.id : null);
  const userId = req.session.userId || null;
  const filteredRaw = userId ? raw.filter((p) => !db.isBlocked(userId, p.user_id) && !db.isBlocked(p.user_id, userId)) : raw;
  const posts = filteredRaw.map((p) => ({
    ...p,
    created_at: formatPostTime(p.created_at),
    likeCount: db.getLikeCount(p.id),
    dislikeCount: db.getDislikeCount(p.id),
    replyCount: db.getReplyCount(p.id),
    userLiked: userId ? db.getUserLike(p.id, userId) : false,
    userDisliked: userId ? db.getUserDislike(p.id, userId) : false,
    userSaved: userId ? db.isPostSavedByUser(userId, p.id) : false,
  }));
  const currentUser = userId ? db.getUserById(userId) : null;
  res.render('feed', {
    title: currentClass ? `${currentClass.name} — ClassChat` : 'Feed — ClassChat',
    district: req.session.district || DISTRICT,
    school: req.session.school || SCHOOL,
    school_id: req.session.school_id || null,
    username: req.session.username || null,
    userId,
    display_name: currentUser?.display_name || null,
    currentUser,
    is_staff: !!req.session.is_staff,
    isGuest: !!req.session.guest,
    posts,
    classes,
    currentClass,
    postError: req.query.post_error,
  });
});

app.post('/posts', requireAuth, postAttachUpload, (req, res) => {
  const body = (req.body.body || '').trim();
  if (!body) return res.redirect('/feed?post_error=empty');
  const imagePath = req.files && req.files.image && req.files.image[0] ? `/uploads/${req.files.image[0].filename}` : null;
  const filePath = req.files && req.files.file && req.files.file[0] ? `/uploads/${req.files.file[0].filename}` : null;
  const videoPath = req.files && req.files.video && req.files.video[0] ? `/uploads/${req.files.video[0].filename}` : null;
  const classId = (req.body.class_id || '').trim() || null;
  db.createPost(req.session.userId, body, imagePath, classId, filePath, videoPath);
  const redirectClass = classId ? `?class=${classId}` : '';
  res.redirect(`/feed${redirectClass}`);
});

app.post('/posts/:id/delete', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const post = db.getPostById(id);
  if (!post) return res.redirect('/feed');
  if (post.user_id !== req.session.userId) return res.redirect(`/posts/${id}`);
  db.deletePost(id);
  res.redirect('/feed');
});

app.get('/posts/:id', allowGuestOrAuth, (req, res) => {
  const id = Number(req.params.id);
  const post = db.getPostById(id);
  if (!post) return res.status(404).render('profile-not-found', { title: 'Not Found', username: '' });
  const replies = db.getRepliesByPostId(id).map((r) => ({ ...r, created_at: formatPostTime(r.created_at) }));
  const likeCount = db.getLikeCount(id);
  const dislikeCount = db.getDislikeCount(id);
  const replyCount = db.getReplyCount(id);
  const userId = req.session.userId || null;
  const userLiked = userId ? db.getUserLike(id, userId) : false;
  const userDisliked = userId ? db.getUserDislike(id, userId) : false;
  const userSaved = userId ? db.isPostSavedByUser(userId, id) : false;
  const currentUser = userId ? db.getUserById(userId) : null;
  res.render('post-expanded', {
    title: 'Post — ClassChat',
    layout: 'layout',
    post: { ...post, created_at: formatPostTime(post.created_at) },
    replies,
    likeCount,
    dislikeCount,
    replyCount,
    userLiked,
    userDisliked,
    userSaved,
    username: req.session.username || null,
    userId,
    currentUser,
    is_staff: !!req.session.is_staff,
    isGuest: !!req.session.guest,
    district: req.session.district || DISTRICT,
    school: req.session.school || SCHOOL,
    reply_error: req.query.reply_error,
  });
});

app.post('/posts/:id/replies', requireAuth, upload.single('image'), (req, res) => {
  const id = Number(req.params.id);
  const post = db.getPostById(id);
  if (!post) return res.redirect('/feed');
  const body = (req.body.body || '').trim();
  if (!body) return res.redirect(`/posts/${id}?reply_error=empty`);
  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;
  db.createReply(id, req.session.userId, body, imagePath);
  if (post.user_id !== req.session.userId) db.createNotification(post.user_id, 'post_reply', req.session.userId, id);
  res.redirect(`/posts/${id}`);
});

app.post('/posts/:id/like', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const post = db.getPostById(id);
  if (!post) return res.redirect('/feed');
  db.togglePostLike(id, req.session.userId);
  if (post.user_id !== req.session.userId) db.createNotification(post.user_id, 'post_like', req.session.userId, id);
  res.redirect(req.get('Referer') || `/posts/${id}`);
});

app.post('/posts/:id/dislike', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!db.getPostById(id)) return res.redirect('/feed');
  db.togglePostDislike(id, req.session.userId);
  res.redirect(req.get('Referer') || `/posts/${id}`);
});

app.get('/friends', requireAuth, (req, res) => {
  const friends = db.getFriends(req.session.userId);
  const currentUser = db.getUserById(req.session.userId);
  res.render('friends', {
    title: 'Friends — ClassChat',
    friends,
    currentUser,
    username: req.session.username,
    is_staff: !!req.session.is_staff,
  });
});

app.get('/activity', requireAuth, (req, res) => {
  const notifications = db.getNotificationsForUser(req.session.userId).map((n) => ({ ...n, created_at: formatPostTime(n.created_at) }));
  const currentUser = db.getUserById(req.session.userId);
  db.markNotificationsRead(req.session.userId);
  res.render('activity', {
    title: 'Activity — ClassChat',
    notifications,
    currentUser,
    username: req.session.username,
    is_staff: !!req.session.is_staff,
  });
});

app.get('/search', requireAuth, (req, res) => {
  const q = (req.query.q || '').trim();
  const users = q ? db.searchUsers(q) : [];
  const postsRaw = q ? db.searchPosts(q) : [];
  const posts = postsRaw.map((p) => ({ ...p, created_at: formatPostTime(p.created_at) }));
  const currentUser = db.getUserById(req.session.userId);
  res.render('search', {
    title: 'Search — ClassChat',
    q,
    users,
    posts,
    currentUser,
    username: req.session.username,
    is_staff: !!req.session.is_staff,
  });
});

app.get('/saved', requireAuth, (req, res) => {
  const raw = db.getSavedPostsByUser(req.session.userId);
  const posts = raw.map((p) => ({
    ...p,
    created_at: formatPostTime(p.created_at),
    likeCount: db.getLikeCount(p.id),
    dislikeCount: db.getDislikeCount(p.id),
    replyCount: db.getReplyCount(p.id),
    userLiked: db.getUserLike(p.id, req.session.userId),
    userDisliked: db.getUserDislike(p.id, req.session.userId),
  }));
  const currentUser = db.getUserById(req.session.userId);
  res.render('saved', {
    title: 'Saved — ClassChat',
    posts,
    currentUser,
    username: req.session.username,
    is_staff: !!req.session.is_staff,
  });
});

app.post('/posts/:id/save', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!db.getPostById(id)) return res.redirect('/feed');
  db.toggleSavePost(req.session.userId, id);
  res.redirect(req.get('Referer') || `/posts/${id}`);
});

app.get('/messages', requireAuth, (req, res) => {
  const allConversations = db.getConversations(req.session.userId);
  const conversations = allConversations
    .filter((c) => (db.areFriends(req.session.userId, c.id) || (c.username && c.username.toLowerCase() === SUPPORT_USERNAME.toLowerCase())) && !db.isBlocked(req.session.userId, c.id) && !db.isBlocked(c.id, req.session.userId))
    .map((c) => ({ ...c, isOnline: isUserOnline(c.id) }));
  const currentUser = db.getUserById(req.session.userId);
  const pendingRequestsToMe = db.getPendingRequestsToMe(req.session.userId);
  res.render('messages', {
    title: 'Messages — ClassChat',
    conversations,
    pendingRequestsToMe,
    currentUser,
    username: req.session.username,
    userId: req.session.userId,
    error: req.query.error,
    is_staff: !!req.session.is_staff,
  });
});

app.get('/messages/:username', requireAuth, (req, res) => {
  const other = db.getUserByUsername(req.params.username);
  const isSupport = other && other.username && other.username.toLowerCase() === SUPPORT_USERNAME.toLowerCase();
  if (!other || other.id === req.session.userId) return res.redirect('/messages');
  if (db.isBlocked(req.session.userId, other.id) || db.isBlocked(other.id, req.session.userId)) return res.redirect('/messages?error=blocked');
  if (!isSupport && !db.areFriends(req.session.userId, other.id)) return res.redirect('/messages?error=not_friends');
  const limit = 50;
  let messages = db.getMessagesWithUser(req.session.userId, other.id, limit).map((m) => ({ ...m, created_at_fmt: formatPostTime(m.created_at), reactions: db.getMessageReactions(m.id) }));
  messages = messages.map((m) => {
    if (m.reply_to_message_id) {
      const replyTo = db.getMessageById(m.reply_to_message_id);
      m.reply_to_body = replyTo ? (replyTo.body || '').slice(0, 100) : null;
    }
    return m;
  });
  const oldestId = messages.length > 0 ? messages[0].id : null;
  const hasMore = oldestId ? db.hasOlderMessagesWithUser(req.session.userId, other.id, oldestId) : false;
  const pinnedMessageId = db.getPinnedMessage(req.session.userId, other.id);
  const currentUser = db.getUserById(req.session.userId);
  res.render('conversation', {
    title: `@${other.username} — ClassChat`,
    other,
    messages,
    hasMore,
    pinnedMessageId,
    isMuted: db.isConversationMuted(req.session.userId, other.id),
    isOnline: isUserOnline(other.id),
    currentUser,
    username: req.session.username,
    userId: req.session.userId,
    is_staff: !!req.session.is_staff,
  });
});

app.get('/api/messages/:username', requireAuth, (req, res) => {
  const other = db.getUserByUsername(req.params.username);
  if (!other) return res.status(404).json({ error: 'User not found' });
  const isSupport = other.username && other.username.toLowerCase() === SUPPORT_USERNAME.toLowerCase();
  if (!isSupport && !db.areFriends(req.session.userId, other.id)) {
    return res.status(403).json({ error: 'Not friends' });
  }
  const beforeId = req.query.before ? parseInt(req.query.before, 10) : null;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  let messages = db.getMessagesWithUser(req.session.userId, other.id, limit, beforeId).map((m) => ({
    ...m,
    created_at_fmt: formatPostTime(m.created_at),
    reactions: db.getMessageReactions(m.id),
  }));
  messages = messages.map((m) => {
    if (m.reply_to_message_id) {
      const replyTo = db.getMessageById(m.reply_to_message_id);
      m.reply_to_body = replyTo ? (replyTo.body || '').slice(0, 100) : null;
    }
    return m;
  });
  const oldestId = messages.length > 0 ? messages[0].id : null;
  const hasMore = oldestId ? db.hasOlderMessagesWithUser(req.session.userId, other.id, oldestId) : false;
  res.json({
    ok: true,
    messages,
    hasMore,
    other: {
      id: other.id,
      username: other.username,
      display_name: other.display_name,
      avatar_path: other.avatar_path,
      online: isUserOnline(other.id),
    },
  });
});

app.post('/messages', requireAuth, messageAttachUpload, (req, res) => {
  const toUsername = (req.body.to || '').trim();
  const body = (req.body.body || '').trim();
  const replyToId = req.body.reply_to ? Number(req.body.reply_to) : null;
  const isJson = req.xhr || req.headers.accept?.includes('application/json') || req.query.format === 'json';

  if (!toUsername) {
    if (isJson) return res.status(400).json({ error: 'Recipient required' });
    return res.redirect('/messages');
  }
  if (!body && !(req.files && (req.files.image?.[0] || req.files.file?.[0] || req.files.video?.[0]))) {
    if (isJson) return res.status(400).json({ error: 'Message or attachment required' });
    return res.redirect(`/messages/${encodeURIComponent(toUsername)}?error=empty`);
  }
  const other = db.getUserByUsername(toUsername);
  const isSupport = other && other.username && other.username.toLowerCase() === SUPPORT_USERNAME.toLowerCase();
  if (!other || other.id === req.session.userId) {
    if (isJson) return res.status(404).json({ error: 'Invalid recipient' });
    return res.redirect('/messages');
  }
  if (db.isBlocked(req.session.userId, other.id) || db.isBlocked(other.id, req.session.userId)) {
    if (isJson) return res.status(403).json({ error: 'User is blocked' });
    return res.redirect('/messages?error=blocked');
  }
  if (!isSupport && !db.areFriends(req.session.userId, other.id)) {
    if (isJson) return res.status(403).json({ error: 'Not friends' });
    return res.redirect('/messages?error=not_friends');
  }
  const imagePath = req.files && req.files.image?.[0] ? `/uploads/${req.files.image[0].filename}` : null;
  const filePath = req.files && req.files.file?.[0] ? `/uploads/${req.files.file[0].filename}` : null;
  const videoPath = req.files && req.files.video?.[0] ? `/uploads/${req.files.video[0].filename}` : null;
  const messageId = db.sendMessage(req.session.userId, other.id, body, replyToId, imagePath, filePath, videoPath);

  const detailedMsg = db.getMessageWithDetails(messageId);
  const formattedMsg = {
    ...detailedMsg,
    created_at_fmt: formatPostTime(detailedMsg.created_at),
    reactions: [],
  };

  // Broadcast in real-time to recipient's active socket(s)
  sendToUser(other.id, {
    type: 'new_message',
    message: formattedMsg,
    conversationWith: req.session.username,
  });

  // Broadcast confirmation to sender's active socket(s)
  sendToUser(req.session.userId, {
    type: 'new_message',
    message: formattedMsg,
    conversationWith: other.username,
  });

  // Send background web push if supported
  sendPushToUser(other.id, {
    title: `@${req.session.username}`,
    body: body ? (body.length > 70 ? body.slice(0, 70) + '…' : body) : 'Sent an attachment',
    url: `/messages/${encodeURIComponent(req.session.username)}`,
    tag: `msg-${messageId}`,
  });

  if (isJson) {
    return res.json({ ok: true, message: formattedMsg });
  }
  res.redirect(`/messages/${encodeURIComponent(other.username)}`);
});

app.post('/messages/:id/delete', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const isJson = req.xhr || req.headers.accept?.includes('application/json');
  const msg = db.getMessageById(id);
  if (!msg) {
    if (isJson) return res.status(404).json({ error: 'Message not found' });
    return res.redirect('/messages');
  }
  if (msg.sender_id !== req.session.userId) {
    if (isJson) return res.status(403).json({ error: 'Forbidden' });
    return res.redirect('/messages');
  }
  const otherId = msg.receiver_id;
  const other = db.getUserById(otherId);
  db.deleteMessage(id, req.session.userId);

  // Broadcast deletion in real time to both parties
  sendToUser(otherId, { type: 'delete_message', messageId: id });
  sendToUser(req.session.userId, { type: 'delete_message', messageId: id });

  if (isJson) {
    return res.json({ ok: true, id });
  }
  if (other) return res.redirect(`/messages/${encodeURIComponent(other.username)}`);
  res.redirect('/messages');
});

// --- Chatroom Routes ---
app.get('/chatrooms', requireAuth, (req, res) => {
  const flags = getFeatureFlags();
  if (!flags.chatroom_enabled) {
    return res.redirect('/messages');
  }
  const publicChatrooms = db.getPublicChatrooms().map((r) => ({
    ...r,
    last_at_fmt: r.last_at ? formatPostTime(r.last_at) : null,
  }));
  const currentUser = db.getUserById(req.session.userId);
  res.render('chatrooms', {
    title: 'Chatrooms — ClassChat',
    publicChatrooms,
    currentUser,
    username: req.session.username,
    userId: req.session.userId,
    is_staff: !!req.session.is_staff,
    currentPath: '/chatrooms',
  });
});

app.get('/chatrooms/:id', requireAuth, (req, res) => {
  const flags = getFeatureFlags();
  if (!flags.chatroom_enabled) {
    return res.redirect('/messages');
  }
  const roomId = Number(req.params.id);
  const room = db.getChatroomById(roomId);
  if (!room) return res.redirect('/messages');

  const isStaff = !!req.session.is_staff;
  const isMember = db.isUserInChatroom(roomId, req.session.userId);

  if (room.type === 'private' && !isMember && !isStaff) {
    return res.redirect('/messages?error=not_member');
  }

  const limit = 50;
  let messages = db.getChatroomMessages(roomId, limit).map((m) => ({
    ...m,
    created_at_fmt: formatPostTime(m.created_at),
  }));

  messages = messages.map((m) => {
    if (m.reply_to_message_id) {
      const rep = db.getChatroomMessageWithDetails(m.reply_to_message_id);
      m.reply_to_body = rep ? (rep.body || '').slice(0, 100) : null;
    }
    return m;
  });

  const oldestId = messages.length > 0 ? messages[0].id : null;
  const hasMore = oldestId ? db.hasOlderChatroomMessages(roomId, oldestId) : false;
  const members = db.getChatroomMembers(roomId);
  const friends = db.getFriends(req.session.userId);
  const currentUser = db.getUserById(req.session.userId);

  const isOwner = members.some((m) => m.user_id === req.session.userId && m.role === 'owner') || isStaff;
  const canRename = room.type === 'public' ? isStaff : (isMember || isStaff);

  res.render('chatroom', {
    title: `${room.name} — ClassChat`,
    room,
    messages,
    hasMore,
    members,
    friends,
    currentUser,
    username: req.session.username,
    userId: req.session.userId,
    is_staff: isStaff,
    isMember,
    isOwner,
    canRename,
    error: req.query.error,
  });
});

app.post('/chatrooms/new', requireAuth, (req, res) => {
  const name = (req.body.name || '').trim() || 'Group Chatroom';
  let invitedFriendIds = [];
  if (req.body.friends) {
    if (Array.isArray(req.body.friends)) {
      invitedFriendIds = req.body.friends.map(Number).filter(Boolean);
    } else {
      invitedFriendIds = [Number(req.body.friends)].filter(Boolean);
    }
  }

  const roomId = db.createChatroom(name, 'private', req.session.userId);

  for (const fId of invitedFriendIds) {
    if (db.areFriends(req.session.userId, fId)) {
      db.addChatroomMember(roomId, fId, 'member');
      sendToUser(fId, {
        type: 'room_invite',
        roomId,
        roomName: name,
        inviter: req.session.username,
      });
    }
  }

  res.redirect(`/chatrooms/${roomId}`);
});

app.post('/chatrooms/:id/rename', requireAuth, (req, res) => {
  const roomId = Number(req.params.id);
  const room = db.getChatroomById(roomId);
  if (!room) return res.redirect('/messages');

  const canRename = room.type === 'public' ? !!req.session.is_staff : (db.isUserInChatroom(roomId, req.session.userId) || !!req.session.is_staff);
  if (!canRename) return res.status(403).redirect(`/chatrooms/${roomId}?error=forbidden`);

  const newName = (req.body.name || '').trim();
  if (newName) {
    db.renameChatroom(roomId, newName);
    broadcastToRoom(roomId, {
      type: 'room_renamed',
      roomId,
      newName,
      by: req.session.username,
    });
  }

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ ok: true, name: newName });
  }
  res.redirect(`/chatrooms/${roomId}`);
});

app.post('/chatrooms/:id/invite', requireAuth, (req, res) => {
  const roomId = Number(req.params.id);
  const room = db.getChatroomById(roomId);
  if (!room) return res.redirect('/messages');

  if (room.type === 'private' && !db.isUserInChatroom(roomId, req.session.userId) && !req.session.is_staff) {
    return res.status(403).redirect('/messages?error=not_member');
  }

  let friendIds = [];
  if (req.body.friends) {
    if (Array.isArray(req.body.friends)) {
      friendIds = req.body.friends.map(Number).filter(Boolean);
    } else {
      friendIds = [Number(req.body.friends)].filter(Boolean);
    }
  }

  for (const fId of friendIds) {
    if (db.areFriends(req.session.userId, fId)) {
      db.addChatroomMember(roomId, fId, 'member');
      sendToUser(fId, {
        type: 'room_invite',
        roomId,
        roomName: room.name,
        inviter: req.session.username,
      });
    }
  }

  broadcastToRoom(roomId, {
    type: 'room_members_updated',
    roomId,
  });

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ ok: true });
  }
  res.redirect(`/chatrooms/${roomId}`);
});

app.post('/chatrooms/:id/leave', requireAuth, (req, res) => {
  const roomId = Number(req.params.id);
  const room = db.getChatroomById(roomId);
  if (!room) return res.redirect('/messages');

  if (room.type === 'private') {
    db.removeChatroomMember(roomId, req.session.userId);
    const members = db.getChatroomMembers(roomId);
    if (members.length === 0) {
      db.deleteChatroom(roomId);
    } else {
      const hasOwner = members.some((m) => m.role === 'owner');
      if (!hasOwner && members.length > 0) {
        db.addChatroomMember(roomId, members[0].user_id, 'owner');
      }
      broadcastToRoom(roomId, {
        type: 'room_members_updated',
        roomId,
      });
    }
  }
  res.redirect('/messages');
});

app.post('/chatrooms/:id/messages', requireAuth, messageAttachUpload, (req, res) => {
  const roomId = Number(req.params.id);
  const body = (req.body.body || '').trim();
  const replyToId = req.body.reply_to ? Number(req.body.reply_to) : null;
  const isJson = req.xhr || req.headers.accept?.includes('application/json') || req.query.format === 'json';

  const room = db.getChatroomById(roomId);
  if (!room) {
    if (isJson) return res.status(404).json({ error: 'Chatroom not found' });
    return res.redirect('/messages');
  }

  if (room.type === 'private' && !db.isUserInChatroom(roomId, req.session.userId) && !req.session.is_staff) {
    if (isJson) return res.status(403).json({ error: 'Not a member of this chatroom' });
    return res.redirect('/messages?error=not_member');
  }

  if (!body && !(req.files && (req.files.image?.[0] || req.files.file?.[0] || req.files.video?.[0]))) {
    if (isJson) return res.status(400).json({ error: 'Message or attachment required' });
    return res.redirect(`/chatrooms/${roomId}?error=empty`);
  }

  const imagePath = req.files && req.files.image?.[0] ? `/uploads/${req.files.image[0].filename}` : null;
  const filePath = req.files && req.files.file?.[0] ? `/uploads/${req.files.file[0].filename}` : null;
  const videoPath = req.files && req.files.video?.[0] ? `/uploads/${req.files.video[0].filename}` : null;

  const messageId = db.sendChatroomMessage(roomId, req.session.userId, body, replyToId, imagePath, filePath, videoPath);
  const detailedMsg = db.getChatroomMessageWithDetails(messageId);
  if (detailedMsg.reply_to_message_id) {
    const rep = db.getChatroomMessageWithDetails(detailedMsg.reply_to_message_id);
    detailedMsg.reply_to_body = rep ? (rep.body || '').slice(0, 100) : null;
  }
  detailedMsg.created_at_fmt = formatPostTime(detailedMsg.created_at);

  broadcastToRoom(roomId, {
    type: 'new_room_message',
    roomId,
    message: detailedMsg,
  });

  if (isJson) {
    return res.json({ ok: true, message: detailedMsg });
  }
  res.redirect(`/chatrooms/${roomId}`);
});

app.post('/chatrooms/:id/messages/:msgId/delete', requireAuth, (req, res) => {
  const roomId = Number(req.params.id);
  const msgId = Number(req.params.msgId);
  const isJson = req.xhr || req.headers.accept?.includes('application/json');

  const room = db.getChatroomById(roomId);
  if (!room) {
    if (isJson) return res.status(404).json({ error: 'Chatroom not found' });
    return res.redirect('/messages');
  }

  const ok = db.deleteChatroomMessage(msgId, req.session.userId, !!req.session.is_staff);
  if (ok) {
    broadcastToRoom(roomId, {
      type: 'delete_room_message',
      roomId,
      messageId: msgId,
    });
  }

  if (isJson) {
    return res.json({ ok });
  }
  res.redirect(`/chatrooms/${roomId}`);
});

app.get('/api/chatrooms/:id/messages', requireAuth, (req, res) => {
  const roomId = Number(req.params.id);
  const room = db.getChatroomById(roomId);
  if (!room) return res.status(404).json({ error: 'Chatroom not found' });

  if (room.type === 'private' && !db.isUserInChatroom(roomId, req.session.userId) && !req.session.is_staff) {
    return res.status(403).json({ error: 'Not a member' });
  }

  const before = req.query.before ? Number(req.query.before) : null;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

  let messages = db.getChatroomMessages(roomId, limit, before).map((m) => ({
    ...m,
    created_at_fmt: formatPostTime(m.created_at),
  }));

  messages = messages.map((m) => {
    if (m.reply_to_message_id) {
      const rep = db.getChatroomMessageWithDetails(m.reply_to_message_id);
      m.reply_to_body = rep ? (rep.body || '').slice(0, 100) : null;
    }
    return m;
  });

  const oldestId = messages.length > 0 ? messages[0].id : null;
  const hasMore = oldestId ? db.hasOlderChatroomMessages(roomId, oldestId) : false;

  res.json({ messages, hasMore });
});

// --- Staff Chatroom Admin Management ---
app.post('/staff/chatrooms/new', requireStaff, (req, res) => {
  const name = (req.body.name || '').trim();
  if (name) {
    db.createChatroom(name, 'public', req.session.userId);
  }
  res.redirect(req.get('Referer') || '/messages');
});

app.post('/staff/chatrooms/:id/clear', requireStaff, (req, res) => {
  const roomId = Number(req.params.id);
  db.clearChatroomMessages(roomId);
  broadcastToRoom(roomId, {
    type: 'room_cleared',
    roomId,
  });
  res.redirect(req.get('Referer') || `/chatrooms/${roomId}`);
});

app.post('/staff/chatrooms/:id/delete', requireStaff, (req, res) => {
  const roomId = Number(req.params.id);
  db.deleteChatroom(roomId);
  res.redirect('/messages');
});

app.get('/profile', requireAuth, (req, res) => {
  res.redirect(`/u/${req.session.username}`);
});

app.get('/u/:username', requireAuth, (req, res) => {
  const profileUser = db.getUserByUsername(req.params.username);
  if (!profileUser) return res.status(404).render('profile-not-found', { title: 'Not Found', username: req.params.username });
  const isOwn = req.session.userId === profileUser.id;
  const friendStatus = isOwn ? 'self' : db.getFriendStatus(req.session.userId, profileUser.id);
  const isBlockedByMe = db.isBlocked(req.session.userId, profileUser.id);
  const isBlockedByThem = db.isBlocked(profileUser.id, req.session.userId);
  const postsRaw = db.getPostsByUserId(profileUser.id);
  const posts = postsRaw.map((p) => ({ ...p, created_at: formatPostTime(p.created_at) }));
  res.render('profile', {
    title: `@${profileUser.username} — ClassChat`,
    profileUser,
    isOwn,
    friendStatus,
    isBlockedByMe,
    isBlockedByThem,
    currentUsername: req.session.username,
    posts,
    is_staff: !!req.session.is_staff,
  });
});

app.get('/profile/edit', requireAuth, (req, res) => {
  const user = db.getUserById(req.session.userId);
  res.render('profile-edit', {
    title: 'Edit profile — ClassChat',
    user,
    username: req.session.username,
    profileError: req.query.profile_error,
    is_staff: !!req.session.is_staff,
  });
});

app.post('/profile/edit', requireAuth, avatarUpload.single('avatar'), (req, res) => {
  const displayName = (req.body.display_name || '').trim() || null;
  const bio = (req.body.bio || '').trim() || null;
  db.updateUserProfile(req.session.userId, displayName, bio);
  if (req.body.remove_avatar === '1') {
    db.updateUserAvatar(req.session.userId, null);
  } else if (req.file) {
    db.updateUserAvatar(req.session.userId, `/uploads/avatars/${req.file.filename}`);
  }
  res.redirect(`/u/${req.session.username}`);
});

app.post('/friends/request', requireAuth, (req, res) => {
  const username = (req.body.username || '').trim();
  const other = username ? db.getUserByUsername(username) : null;
  if (!other || other.id === req.session.userId) return res.redirect(`/u/${username || 'feed'}`);
  const status = db.getFriendStatus(req.session.userId, other.id);
  if (status !== 'none') return res.redirect(`/u/${username}`);
  db.sendFriendRequest(req.session.userId, other.id);
  db.createNotification(other.id, 'friend_request', req.session.userId, null);
  res.redirect(`/u/${username}`);
});

app.post('/friends/accept', requireAuth, (req, res) => {
  const username = (req.body.username || '').trim();
  const other = username ? db.getUserByUsername(username) : null;
  if (!other) return res.redirect('/friends');
  db.acceptFriendRequest(other.id, req.session.userId);
  db.createNotification(other.id, 'friend_accepted', req.session.userId, null);
  res.redirect(`/u/${username}`);
});

app.post('/friends/decline', requireAuth, (req, res) => {
  const username = (req.body.username || '').trim();
  const other = username ? db.getUserByUsername(username) : null;
  if (other) db.declineFriendRequest(other.id, req.session.userId);
  res.redirect('/messages');
});

app.post('/friends/remove', requireAuth, (req, res) => {
  const username = (req.body.username || '').trim();
  const other = username ? db.getUserByUsername(username) : null;
  if (!other || other.id === req.session.userId) return res.redirect(`/u/${username || 'feed'}`);
  db.removeFriend(req.session.userId, other.id);
  res.redirect(`/u/${username}`);
});

app.get('/settings', requireAuth, (req, res) => {
  const userSettings = db.getUserSettings(req.session.userId);
  res.render('settings', {
    title: 'Settings — ClassChat',
    layout: 'layout',
    username: req.session.username,
    userSettings,
    pendingFriendRequestsCount: res.locals.pendingFriendRequestsCount,
    unreadActivityCount: res.locals.unreadActivityCount,
  });
});

app.post('/settings/theme', requireAuth, (req, res) => {
  const theme = (req.body.theme || 'dark').trim();
  if (['light', 'dark'].includes(theme)) db.setUserTheme(req.session.userId, theme);
  res.redirect(req.body.redirect || '/settings');
});

app.post('/settings/accent-color', requireAuth, (req, res) => {
  let hex = (req.body.hex || '').trim();
  if (!hex && req.body.r !== undefined && req.body.g !== undefined && req.body.b !== undefined) {
    const r = Math.max(0, Math.min(255, parseInt(req.body.r, 10) || 0));
    const g = Math.max(0, Math.min(255, parseInt(req.body.g, 10) || 0));
    const b = Math.max(0, Math.min(255, parseInt(req.body.b, 10) || 0));
    hex = '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  const savedColor = db.setUserAccentColor(req.session.userId, hex);

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, accent_color: savedColor });
  }
  res.redirect('/settings?saved=accent');
});

app.post('/settings/accent-color/reset', requireAuth, (req, res) => {
  db.setUserAccentColor(req.session.userId, null);
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, reset: true });
  }
  res.redirect('/settings?reset=accent');
});

app.post('/settings/email-digest', requireAuth, (req, res) => {
  const digest = (req.body.email_digest || 'none').trim();
  if (['none', 'daily', 'weekly'].includes(digest)) db.setEmailDigest(req.session.userId, digest);
  res.redirect(req.body.redirect || '/settings');
});

// --- User Support Routes ---
app.get('/support', requireAuth, (req, res) => {
  const user = db.getUserById(req.session.userId);
  const ticketsRaw = db.getSupportTicketsByUser(req.session.userId);
  const tickets = ticketsRaw.map((t) => ({
    ...t,
    created_at_fmt: formatPostTime(t.created_at),
    updated_at_fmt: formatPostTime(t.updated_at),
    resolved_at_fmt: t.resolved_at ? formatPostTime(t.resolved_at) : null,
  }));

  res.render('support/index', {
    title: 'Help Center & Support — ClassChat',
    layout: 'layout',
    username: req.session.username,
    user,
    tickets,
    pendingFriendRequestsCount: res.locals.pendingFriendRequestsCount,
    unreadActivityCount: res.locals.unreadActivityCount,
  });
});

app.get('/support/new', requireAuth, (req, res) => {
  const user = db.getUserById(req.session.userId);
  res.render('support/new', {
    title: 'Open Support Ticket — ClassChat',
    layout: 'layout',
    username: req.session.username,
    user,
    error: null,
    pendingFriendRequestsCount: res.locals.pendingFriendRequestsCount,
    unreadActivityCount: res.locals.unreadActivityCount,
  });
});

app.post('/support/new', requireAuth, (req, res) => {
  const subject = (req.body.subject || '').trim();
  const category = (req.body.category || 'general').trim();
  const priority = (req.body.priority || 'normal').trim();
  const message = (req.body.message || '').trim();

  if (!subject || !message) {
    const user = db.getUserById(req.session.userId);
    return res.render('support/new', {
      title: 'Open Support Ticket — ClassChat',
      layout: 'layout',
      username: req.session.username,
      user,
      error: 'Please enter both a subject and a description of your issue.',
      pendingFriendRequestsCount: res.locals.pendingFriendRequestsCount,
      unreadActivityCount: res.locals.unreadActivityCount,
    });
  }

  const validCategories = ['account', 'bug', 'report', 'feature', 'general'];
  const validPriorities = ['low', 'normal', 'high', 'urgent'];
  const cat = validCategories.includes(category) ? category : 'general';
  const prio = validPriorities.includes(priority) ? priority : 'normal';

  const ticketId = db.createSupportTicket(req.session.userId, subject, cat, prio, message);
  res.redirect(`/support/ticket/${ticketId}`);
});

app.get('/support/ticket/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const ticket = db.getSupportTicketById(id);
  if (!ticket) return res.redirect('/support');

  const user = db.getUserById(req.session.userId);
  if (ticket.user_id !== req.session.userId && !user.is_staff) {
    return res.redirect('/support');
  }

  const messagesRaw = db.getSupportTicketMessages(id);
  const messages = messagesRaw.map((m) => ({
    ...m,
    created_at_fmt: formatPostTime(m.created_at),
  }));

  res.render('support/ticket', {
    title: `Ticket #${ticket.id}: ${ticket.subject} — ClassChat`,
    layout: 'layout',
    username: req.session.username,
    user,
    ticket: {
      ...ticket,
      created_at_fmt: formatPostTime(ticket.created_at),
      updated_at_fmt: formatPostTime(ticket.updated_at),
      resolved_at_fmt: ticket.resolved_at ? formatPostTime(ticket.resolved_at) : null,
    },
    messages,
    pendingFriendRequestsCount: res.locals.pendingFriendRequestsCount,
    unreadActivityCount: res.locals.unreadActivityCount,
  });
});

app.post('/support/ticket/:id/reply', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const ticket = db.getSupportTicketById(id);
  if (!ticket) return res.redirect('/support');

  const user = db.getUserById(req.session.userId);
  if (ticket.user_id !== req.session.userId && !user.is_staff) {
    return res.redirect('/support');
  }

  const body = (req.body.body || '').trim();
  if (body) {
    db.addSupportTicketMessage(id, req.session.userId, user.is_staff === 1, body);
  }
  res.redirect(`/support/ticket/${id}`);
});

app.post('/support/ticket/:id/resolve', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const ticket = db.getSupportTicketById(id);
  if (!ticket) return res.redirect('/support');

  const user = db.getUserById(req.session.userId);
  if (ticket.user_id !== req.session.userId && !user.is_staff) {
    return res.redirect('/support');
  }

  db.updateSupportTicketStatus(id, 'resolved');
  res.redirect(`/support/ticket/${id}`);
});

app.post('/report', requireAuth, express.json(), (req, res) => {
  const { target_type, target_id, reason } = req.body;
  if (!target_type || !target_id) return res.status(400).json({ error: 'Missing target' });
  db.createReport(req.session.userId, target_type, Number(target_id), reason);
  res.json({ ok: true });
});

app.post('/block/:username', requireAuth, (req, res) => {
  const other = db.getUserByUsername(req.params.username);
  if (other && other.id !== req.session.userId) db.blockUser(req.session.userId, other.id);
  res.redirect(req.query.redirect || '/messages');
});

app.post('/unblock/:username', requireAuth, (req, res) => {
  const other = db.getUserByUsername(req.params.username);
  if (other) db.unblockUser(req.session.userId, other.id);
  res.redirect(req.query.redirect || '/messages');
});

app.post('/conversations/:username/mute', requireAuth, (req, res) => {
  const other = db.getUserByUsername(req.params.username);
  if (other) db.muteConversation(req.session.userId, other.id);
  res.redirect(`/messages/${encodeURIComponent(req.params.username)}`);
});

app.post('/conversations/:username/unmute', requireAuth, (req, res) => {
  const other = db.getUserByUsername(req.params.username);
  if (other) db.unmuteConversation(req.session.userId, other.id);
  res.redirect(`/messages/${encodeURIComponent(req.params.username)}`);
});

app.post('/api/post/:id/react', requireAuth, express.json(), (req, res) => {
  const id = Number(req.params.id);
  const emoji = (req.body.emoji || '👍').trim();
  db.addPostReaction(id, req.session.userId, emoji);
  res.json({ ok: true, reactions: db.getPostReactions(id) });
});

app.post('/api/message/:id/react', requireAuth, express.json(), (req, res) => {
  const id = Number(req.params.id);
  const emoji = (req.body.emoji || '👍').trim();
  db.addMessageReaction(id, req.session.userId, emoji);
  res.json({ ok: true, reactions: db.getMessageReactions(id) });
});

app.get('/stories', requireAuth, (req, res) => {
  res.redirect('/feed');
});

app.get('/call-history', requireAuth, (req, res) => {
  const history = db.getCallHistory(req.session.userId).map((h) => ({ ...h, started_at: formatPostTime(h.started_at) }));
  res.render('call-history', {
    title: 'Call history — ClassChat',
    layout: 'layout',
    username: req.session.username,
    userId: req.session.userId,
    history,
    showSupportButton: true,
    pendingFriendRequestsCount: res.locals.pendingFriendRequestsCount,
    unreadActivityCount: res.locals.unreadActivityCount,
  });
});

app.post('/messages/:id/pin', requireAuth, (req, res) => {
  const msg = db.getMessageById(Number(req.params.id));
  if (!msg) return res.redirect('/messages');
  const otherId = msg.sender_id === req.session.userId ? msg.receiver_id : msg.sender_id;
  const other = db.getUserById(otherId);
  if (other) db.pinMessage(req.session.userId, other.id, msg.id);
  res.redirect(other ? `/messages/${encodeURIComponent(other.username)}` : '/messages');
});

app.post('/messages/:id/edit', requireAuth, express.urlencoded({ extended: true }), (req, res) => {
  const id = Number(req.params.id);
  const body = (req.body.body || '').trim();
  if (body) db.updateMessageBody(id, req.session.userId, body);
  const msg = db.getMessageById(id);
  const otherId = msg && (msg.sender_id === req.session.userId ? msg.receiver_id : msg.sender_id);
  const other = otherId ? db.getUserById(otherId) : null;
  res.redirect(other ? `/messages/${encodeURIComponent(other.username)}` : '/messages');
});

app.post('/classes/:id/join', requireAuth, (req, res) => {
  db.joinClass(req.session.userId, Number(req.params.id));
  res.redirect(req.query.redirect || '/feed');
});

app.post('/classes/:id/leave', requireAuth, (req, res) => {
  db.leaveClass(req.session.userId, Number(req.params.id));
  res.redirect(req.query.redirect || '/feed');
});

app.get('/assignments', (req, res) => {
  res.redirect('/feed');
});

db.ensureSupportUser();

app.get('/staff/dashboard', requireStaff, (req, res) => {
  const stats = db.getStats();
  const classes = db.getClasses();
  const maintenance = getMaintenanceMode();
  const user = db.getUserById(req.session.userId);
  const postsRaw = db.getAllPosts(100);
  const posts = postsRaw.map((p) => ({ ...p, created_at: formatPostTime(p.created_at) }));
  const users = db.getAllUsers();
  const supportUser = db.getUserByUsername(SUPPORT_USERNAME);
  const supportQueriesRaw = supportUser ? db.getConversations(supportUser.id) : [];
  const supportQueries = supportQueriesRaw.map((q) => ({ ...q, last_at: q.last_at ? formatPostTime(q.last_at) : null }));
  const supportStats = db.getSupportStats();
  const recentTicketsRaw = db.getAllSupportTickets('all').slice(0, 10);
  const recentTickets = recentTicketsRaw.map((t) => ({
    ...t,
    created_at_fmt: formatPostTime(t.created_at),
    updated_at_fmt: formatPostTime(t.updated_at),
    resolved_at_fmt: t.resolved_at ? formatPostTime(t.resolved_at) : null,
  }));
  res.render('staff/dashboard', {
    title: 'Staff Dashboard — ClassChat',
    layout: 'layout',
    stats,
    classes,
    maintenance,
    maintenanceMode: maintenance,
    posts,
    users,
    supportQueries,
    supportStats,
    recentTickets,
    publicChatrooms: db.getPublicChatrooms(),
    username: req.session.username,
    user,
    district: DISTRICT,
    school: SCHOOL,
  });
});

app.post('/staff/maintenance', requireStaff, (req, res) => {
  const enabled = !!req.body.enable;
  setMaintenanceMode(enabled);
  db.logModeratorAction(req.session.userId, req.session.username, 'MAINTENANCE', null, null, `Maintenance mode set to ${enabled ? 'ENABLED' : 'DISABLED'}`);
  res.redirect('/staff/dashboard');
});

app.post('/staff/maintenance/toggle', requireStaff, (req, res) => {
  const newStatus = !getMaintenanceMode();
  setMaintenanceMode(newStatus);
  db.logModeratorAction(req.session.userId, req.session.username, 'MAINTENANCE', null, null, `Maintenance mode toggled to ${newStatus ? 'ENABLED' : 'DISABLED'}`);
  res.redirect('/staff/dashboard');
});

app.get('/staff/posts/:id/edit', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  const post = db.getPostById(id);
  if (!post) return res.redirect('/staff/dashboard');
  const classes = db.getClasses();
  res.render('staff/post-edit', {
    title: 'Edit post — ClassChat',
    layout: 'layout',
    post,
    classes,
    username: req.session.username,
  });
});

app.post('/staff/posts/:id/edit', requireStaff, upload.single('image'), (req, res) => {
  const id = Number(req.params.id);
  const post = db.getPostById(id);
  if (!post) return res.redirect('/staff/dashboard');
  const body = (req.body.body || '').trim();
  const imagePath = req.file ? `/uploads/${req.file.filename}` : post.image_path;
  db.updatePost(id, body, imagePath);
  db.logModeratorAction(req.session.userId, req.session.username, 'EDIT_POST', post.user_id, post.username, `Edited post #${id}: "${body.slice(0, 40)}${body.length > 40 ? '...' : ''}"`);
  res.redirect('/staff/dashboard');
});

app.post('/staff/posts/:id/delete', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  const post = db.getPostById(id);
  if (post) {
    db.deletePost(id);
    db.logModeratorAction(req.session.userId, req.session.username, 'DELETE_POST', post.user_id, post.username, `Deleted post #${id}: "${(post.content || '').slice(0, 40)}${(post.content || '').length > 40 ? '...' : ''}"`);
  }
  res.redirect('/staff/dashboard');
});

app.post('/staff/classes', requireStaff, (req, res) => {
  const name = (req.body.name || '').trim();
  if (name) db.addClass(name);
  res.redirect('/staff/dashboard');
});

app.post('/staff/classes/:id/delete', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  db.deleteClass(id);
  res.redirect('/staff/dashboard');
});

app.get('/staff/users/:id/edit', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.userId) return res.redirect('/staff/dashboard');
  const user = db.getUserById(id);
  if (!user) return res.redirect('/staff/dashboard');
  res.render('staff/user-edit', {
    title: `Edit @${user.username} — ClassChat`,
    layout: 'layout',
    editUser: user,
    targetUser: user,
    username: req.session.username,
    error: req.query.error,
    success: req.query.success === '1',
    district: DISTRICT,
  });
});

app.post('/staff/users/:id/edit', requireStaff, avatarUpload.single('avatar'), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.userId) return res.redirect('/staff/dashboard');
  const user = db.getUserById(id);
  if (!user) return res.redirect('/staff/dashboard');

  const newUsername = (req.body.username || '').trim().toLowerCase();
  const newPassword = (req.body.password || '').trim();
  const newSchoolId = (req.body.school_id || '').trim();
  const newBio = (req.body.bio || '').trim() || null;
  const newDisplayName = (req.body.display_name || '').trim() || null;
  const isStaff = req.body.is_staff === '1';
  const removeAvatar = req.body.remove_avatar === '1';

  // Validation
  if (!newUsername || newUsername.length < 2) {
    return res.redirect(`/staff/users/${id}/edit?error=username_short`);
  }
  if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) {
    return res.redirect(`/staff/users/${id}/edit?error=username_invalid`);
  }
  if (newUsername !== user.username.toLowerCase()) {
    const existing = db.getUserByUsername(newUsername);
    if (existing && existing.id !== id) {
      return res.redirect(`/staff/users/${id}/edit?error=username_taken`);
    }
  }
  if (!newSchoolId) {
    return res.redirect(`/staff/users/${id}/edit?error=student_id_required`);
  }
  if (newPassword && newPassword.length < 6) {
    return res.redirect(`/staff/users/${id}/edit?error=password_short`);
  }

  let newAvatarPath = user.avatar_path;
  if (removeAvatar) {
    newAvatarPath = null;
  } else if (req.file) {
    newAvatarPath = `/uploads/avatars/${req.file.filename}`;
  }

  let newPasswordHash = user.password_hash;
  if (newPassword) {
    newPasswordHash = bcrypt.hashSync(newPassword, 10);
  }

  db.staffUpdateUser(id, {
    username: newUsername,
    passwordHash: newPasswordHash,
    schoolId: newSchoolId,
    bio: newBio,
    displayName: newDisplayName,
    avatarPath: newAvatarPath,
    isStaff,
  });

  db.logModeratorAction(req.session.userId, req.session.username, 'EDIT_USER', id, newUsername, `Updated user details (is_staff: ${isStaff ? 'YES' : 'NO'})`);
  res.redirect(`/staff/users/${id}/edit?success=1`);
});

app.post('/staff/users/:id/delete', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.userId) return res.redirect('/staff/dashboard');
  const targetUser = db.getUserById(id);
  if (targetUser) {
    db.deleteUser(id);
    db.logModeratorAction(req.session.userId, req.session.username, 'DELETE_USER', id, targetUser.username, `Deleted user account @${targetUser.username}`);
  }
  res.redirect('/staff/dashboard');
});

app.post('/staff/users/:id/timeout', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  const targetUser = db.getUserById(id);
  if (!targetUser) return res.redirect('/staff/dashboard');

  // Protection: Cannot timeout owner
  if (isEmoticonyt(targetUser.username)) {
    return res.status(403).send('Cannot timeout owner account.');
  }

  // Permission check: Moderator timeout is ONLY doable through @emoticonyt
  if (targetUser.is_staff && !isEmoticonyt(req.session.username)) {
    return res.status(403).send('Moderator timeouts can only be issued by @emoticonyt.');
  }

  const durationMinutes = Number(req.body.duration) || 15;
  const reason = (req.body.reason || '').trim();

  db.timeoutUser(id, durationMinutes, reason);
  disconnectUserSockets(id, `Timed out for ${durationMinutes} minutes`);
  db.logModeratorAction(req.session.userId, req.session.username, targetUser.is_staff ? 'MOD_TIMEOUT' : 'TIMEOUT', id, targetUser.username, `${durationMinutes}m: ${reason || 'Violation of rules'}`);

  const referer = req.get('Referrer') || '/staff/dashboard';
  res.redirect(referer);
});

app.post('/staff/users/:id/untimeout', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  const targetUser = db.getUserById(id);
  if (!targetUser) return res.redirect('/staff/dashboard');

  // Permission check: If target is staff, only @emoticonyt can clear
  if (targetUser.is_staff && !isEmoticonyt(req.session.username)) {
    return res.status(403).send('Only @emoticonyt can manage staff sanctions.');
  }

  db.clearUserTimeout(id);
  db.logModeratorAction(req.session.userId, req.session.username, 'UNTIMEOUT', id, targetUser.username, 'Timeout cleared');

  const referer = req.get('Referrer') || '/staff/dashboard';
  res.redirect(referer);
});

app.post('/staff/users/:id/ban', requireStaff, (req, res) => {
  // Permission check: Account bans are ONLY doable through @emoticonyt
  if (!isEmoticonyt(req.session.username)) {
    return res.status(403).send('Account bans can only be issued by @emoticonyt.');
  }

  const id = Number(req.params.id);
  const targetUser = db.getUserById(id);
  if (!targetUser) return res.redirect('/staff/dashboard');

  if (isEmoticonyt(targetUser.username)) {
    return res.status(403).send('Cannot ban owner account.');
  }

  const reason = (req.body.reason || '').trim();
  db.banUser(id, reason);
  disconnectUserSockets(id, 'Account suspended by administrator');
  db.logModeratorAction(req.session.userId, req.session.username, 'BAN', id, targetUser.username, reason || 'Permanent account suspension');

  const referer = req.get('Referrer') || '/staff/dashboard';
  res.redirect(referer);
});

app.post('/staff/users/:id/unban', requireStaff, (req, res) => {
  // Permission check: Unbans are ONLY doable through @emoticonyt
  if (!isEmoticonyt(req.session.username)) {
    return res.status(403).send('Account unbans can only be issued by @emoticonyt.');
  }

  const id = Number(req.params.id);
  const targetUser = db.getUserById(id);
  db.unbanUser(id);
  db.logModeratorAction(req.session.userId, req.session.username, 'UNBAN', id, targetUser ? targetUser.username : `User #${id}`, 'Account suspension lifted');

  const referer = req.get('Referrer') || '/staff/dashboard';
  res.redirect(referer);
});

app.get('/staff/profile', requireStaff, (req, res) => {
  const user = db.getUserById(req.session.userId);
  res.render('staff/profile', {
    title: 'Staff profile — ClassChat',
    layout: 'layout',
    user,
    username: req.session.username,
  });
});

// --- Moderator Audit Log Route ---
app.get('/staff/audit-log', requireStaff, (req, res) => {
  const actionFilter = (req.query.action || 'all').trim();
  const searchQuery = (req.query.q || '').trim();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = 40;
  const offset = (page - 1) * limit;

  const total = db.getModeratorAuditLogCount({ action: actionFilter, search: searchQuery });
  const logsRaw = db.getModeratorAuditLogs({ limit, offset, action: actionFilter, search: searchQuery });
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const logs = logsRaw.map((log) => ({
    ...log,
    created_at_fmt: formatPostTime(log.created_at) || log.created_at,
  }));

  const user = db.getUserById(req.session.userId);
  const supportStats = db.getSupportStats();

  res.render('staff/audit-log', {
    title: 'Moderator Audit Log — ClassChat',
    layout: 'layout',
    logs,
    total,
    page,
    totalPages,
    actionFilter,
    searchQuery,
    supportStats,
    username: req.session.username,
    user,
    district: DISTRICT,
    school: SCHOOL,
  });
});

// --- Staff Support Tickets Management ---
app.get('/staff/support', requireStaff, (req, res) => {
  const statusFilter = req.query.status || 'all';
  const ticketsRaw = db.getAllSupportTickets(statusFilter);
  const tickets = ticketsRaw.map((t) => ({
    ...t,
    created_at_fmt: formatPostTime(t.created_at),
    updated_at_fmt: formatPostTime(t.updated_at),
    resolved_at_fmt: t.resolved_at ? formatPostTime(t.resolved_at) : null,
  }));
  const stats = db.getSupportStats();
  const user = db.getUserById(req.session.userId);

  res.render('staff/support-tickets', {
    title: 'Support Tickets — ClassChat Staff',
    layout: 'layout',
    username: req.session.username,
    user,
    tickets,
    stats,
    currentStatus: statusFilter,
    district: DISTRICT,
    school: SCHOOL,
  });
});

app.get('/staff/support/ticket/:id', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  const ticket = db.getSupportTicketById(id);
  if (!ticket) return res.redirect('/staff/support');

  const messagesRaw = db.getSupportTicketMessages(id);
  const messages = messagesRaw.map((m) => ({
    ...m,
    created_at_fmt: formatPostTime(m.created_at),
  }));
  const user = db.getUserById(req.session.userId);

  res.render('staff/support-ticket-detail', {
    title: `Ticket #${ticket.id}: ${ticket.subject} — ClassChat Staff`,
    layout: 'layout',
    username: req.session.username,
    user,
    ticket: {
      ...ticket,
      created_at_fmt: formatPostTime(ticket.created_at),
      updated_at_fmt: formatPostTime(ticket.updated_at),
      resolved_at_fmt: ticket.resolved_at ? formatPostTime(ticket.resolved_at) : null,
    },
    messages,
    district: DISTRICT,
    school: SCHOOL,
  });
});

app.post('/staff/support/ticket/:id/reply', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  const ticket = db.getSupportTicketById(id);
  if (!ticket) return res.redirect('/staff/support');

  const body = (req.body.body || '').trim();
  if (body) {
    db.addSupportTicketMessage(id, req.session.userId, true, body);
  }
  res.redirect(`/staff/support/ticket/${id}`);
});

app.post('/staff/support/ticket/:id/status', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  const ticket = db.getSupportTicketById(id);
  if (!ticket) return res.redirect('/staff/support');

  const validStatuses = ['open', 'in_progress', 'waiting_on_user', 'resolved', 'closed'];
  const newStatus = (req.body.status || '').trim();
  if (validStatuses.includes(newStatus)) {
    db.updateSupportTicketStatus(id, newStatus);
    db.logModeratorAction(req.session.userId, req.session.username, 'TICKET_STATUS', ticket.user_id, ticket.username || null, `Ticket #${id} ("${(ticket.subject || '').slice(0, 30)}") status changed to ${newStatus}`);
  }
  res.redirect(`/staff/support/ticket/${id}`);
});

app.get('/staff/support/:username', requireStaff, (req, res) => {
  const supportUser = db.getUserByUsername(SUPPORT_USERNAME);
  const other = db.getUserByUsername(req.params.username);
  if (!supportUser || !other || other.username.toLowerCase() === SUPPORT_USERNAME.toLowerCase()) return res.redirect('/staff/dashboard');
  const messages = db.getMessagesWithUser(supportUser.id, other.id).map((m) => ({ ...m, created_at: formatPostTime(m.created_at) }));
  res.render('staff/support-conversation', {
    title: `Support: @${other.username} — ClassChat`,
    layout: 'layout',
    supportUser,
    other,
    messages,
    username: req.session.username,
    district: DISTRICT,
    school: SCHOOL,
  });
});

app.post('/staff/support/:username', requireStaff, (req, res) => {
  const supportUser = db.getUserByUsername(SUPPORT_USERNAME);
  const other = db.getUserByUsername(req.params.username);
  if (!supportUser || !other || other.username.toLowerCase() === SUPPORT_USERNAME.toLowerCase()) return res.redirect('/staff/dashboard');
  const body = (req.body.body || '').trim();
  if (body) {
    const msgId = db.sendMessage(supportUser.id, other.id, body);
    const detailedMsg = db.getMessageWithDetails(msgId);
    const formattedMsg = {
      ...detailedMsg,
      created_at_fmt: formatPostTime(detailedMsg.created_at),
      reactions: [],
    };
    sendToUser(other.id, {
      type: 'new_message',
      message: formattedMsg,
      conversationWith: SUPPORT_USERNAME,
    });
  }
  res.redirect(`/staff/support/${encodeURIComponent(other.username)}`);
});

app.get('/api/call/token', requireAuth, (req, res) => {
  const token = createCallToken(req.session.userId);
  res.json({ token });
});

app.get('/api/notifications/vapid-public', (req, res) => {
  res.json({ publicKey: vapidPublic });
});

app.post('/api/notifications/subscribe', requireAuth, express.json(), (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  const userId = req.session.userId;
  let list = pushSubscriptionsByUser.get(userId);
  if (!list) {
    list = [];
    pushSubscriptionsByUser.set(userId, list);
  }
  const existing = list.find((s) => s.endpoint === sub.endpoint);
  if (!existing) list.push(sub);
  res.json({ ok: true });
});

app.get('/call/:username', requireAuth, (req, res) => {
  const other = db.getUserByUsername(req.params.username);
  if (!other || other.id === req.session.userId) return res.redirect('/messages');
  if (db.isBlocked(req.session.userId, other.id) || db.isBlocked(other.id, req.session.userId)) return res.redirect('/messages?error=blocked');
  if (!db.areFriends(req.session.userId, other.id) && (other.username || '').toLowerCase() !== SUPPORT_USERNAME.toLowerCase()) {
    return res.redirect(`/messages/${encodeURIComponent(req.params.username)}?error=not_friends`);
  }
  const incoming = req.query.incoming === '1';
  const audioOnly = req.query.audio === '1';
  res.render('call', {
    title: incoming ? (audioOnly ? 'Incoming audio call — ClassChat' : 'Incoming call — ClassChat') : (audioOnly ? `Audio call @${other.username} — ClassChat` : `Call @${other.username} — ClassChat`),
    layout: 'layout',
    other,
    incoming: !!incoming,
    audioOnly: !!audioOnly,
    username: req.session.username,
    userId: req.session.userId,
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', 'http://localhost').pathname;
  if (pathname === '/call/ws' || pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  const userId = url.searchParams.get('token') ? validateCallToken(url.searchParams.get('token')) : null;
  if (!userId) {
    ws.close(4001, 'Invalid or expired token');
    return;
  }

  addSocketUser(userId, ws);
  ws.userId = userId;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const fromUser = db.getUserById(userId);
  if (!fromUser || fromUser.is_banned || (fromUser.timeout_until && new Date(fromUser.timeout_until).getTime() > Date.now())) {
    ws.close(4003, 'Account sanctioned');
    return;
  }
  const fromUsername = fromUser ? fromUser.username : '';

  // Broadcast online status to connections
  ws.send(JSON.stringify({ type: 'connected', userId, username: fromUsername }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }

    // --- Real-time Chat: Typing Indicator ---
    if (msg.type === 'typing') {
      const toUser = typeof msg.to === 'number' ? db.getUserById(msg.to) : db.getUserByUsername(msg.to);
      if (toUser && toUser.id !== userId) {
        sendToUser(toUser.id, {
          type: 'typing',
          from: userId,
          username: fromUsername,
          typing: !!msg.typing,
        });
      }
      return;
    }

    // --- Real-time Chatroom: Typing Indicator ---
    if (msg.type === 'room_typing') {
      const roomId = Number(msg.roomId);
      if (!roomId) return;
      const room = db.getChatroomById(roomId);
      if (!room) return;
      if (room.type === 'private' && !db.isUserInChatroom(roomId, userId)) return;
      broadcastToRoom(roomId, {
        type: 'room_typing',
        roomId,
        fromUserId: userId,
        fromUsername,
        fromDisplayName: fromUser ? (fromUser.display_name || fromUser.username) : fromUsername,
        typing: !!msg.typing,
      });
      return;
    }

    // --- Real-time Chat: Read Receipt ---
    if (msg.type === 'read') {
      const toUser = typeof msg.to === 'number' ? db.getUserById(msg.to) : db.getUserByUsername(msg.to);
      if (toUser && toUser.id !== userId) {
        sendToUser(toUser.id, {
          type: 'read',
          by: userId,
          username: fromUsername,
          messageId: msg.messageId,
        });
      }
      return;
    }

    // --- Real-time Presence Check ---
    if (msg.type === 'check_online') {
      const targetUser = db.getUserByUsername(msg.username);
      const online = targetUser ? isUserOnline(targetUser.id) : false;
      ws.send(JSON.stringify({
        type: 'online_status',
        username: msg.username,
        isOnline: online,
      }));
      return;
    }

    // --- Calls: Signaling ---
    if (msg.type === 'call') {
      const toUser = db.getUserByUsername(msg.to);
      if (!toUser || toUser.id === userId) return;
      if (db.isBlocked(userId, toUser.id) || db.isBlocked(toUser.id, userId)) return;
      if (!db.areFriends(userId, toUser.id) && toUser.username.toLowerCase() !== SUPPORT_USERNAME.toLowerCase()) return;
      if (!isUserOnline(toUser.id)) {
        ws.send(JSON.stringify({ type: 'offline', to: msg.to }));
        return;
      }
      const isVideo = msg.video !== false;
      sendToUser(toUser.id, {
        type: 'incoming-call',
        from: userId,
        username: fromUsername,
        video: isVideo,
      });
      sendPushToUser(toUser.id, {
        title: isVideo ? 'Incoming video call' : 'Incoming audio call',
        body: '@' + fromUsername + ' is calling you',
        url: '/messages',
        requireInteraction: true,
        tag: 'incoming-call-' + userId,
      });
      return;
    }
    if (msg.type === 'accept') {
      sendToUser(msg.from, { type: 'accepted', from: userId, username: fromUsername });
      return;
    }
    if (msg.type === 'decline') {
      sendToUser(msg.from, { type: 'declined', from: userId });
      return;
    }
    if (msg.type === 'offer' || msg.type === 'answer' || msg.type === 'ice-candidate' || msg.type === 'hangup') {
      sendToUser(msg.to, { ...msg, from: userId, username: fromUsername });
    }
  });

  ws.on('close', () => {
    removeSocketUser(userId, ws);
  });
});

const wsHeartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      if (ws.userId) removeSocketUser(ws.userId, ws);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, '0.0.0.0', () => {
  const hostname = os.hostname();
  console.log(`ClassChat running at http://localhost:${PORT}`);
  console.log(`  Also on this network: http://${hostname}:${PORT} and http://${hostname}.local:${PORT}`);
});
