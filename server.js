/**
 * ClassChat — Account system, posting, and image support.
 * Yorkville CUSD 115 / Yorkville Intermediate School.
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
const socketsByUser = new Map();
const pushSubscriptionsByUser = new Map(); // userId -> array of { subscription }
const CALL_TOKEN_TTL_MS = 60 * 1000;

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

const DISTRICT = 'Yorkville CUSD 115';
const SCHOOL = 'Yorkville Intermediate School';
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

app.use((req, res, next) => {
  res.locals.showSupportButton = !!req.session.userId;
  res.locals.isGuest = !!req.session.guest;
  if (req.session.userId) {
    res.locals.pendingFriendRequestsCount = db.getPendingRequestsToMe(req.session.userId).length;
    res.locals.unreadActivityCount = db.getUnreadNotificationCount(req.session.userId);
    res.locals.userSettings = db.getUserSettings(req.session.userId);
  } else {
    res.locals.pendingFriendRequestsCount = 0;
    res.locals.unreadActivityCount = 0;
    res.locals.userSettings = { theme: 'dark', email_digest: 'none' };
  }
  next();
});

app.use((req, res, next) => {
  if (!getMaintenanceMode()) return next();
  if (req.path.startsWith('/staff') || req.path === '/logout') return next();
  res.status(503).render('maintenance', { title: 'Maintenance — ClassChat', layout: false });
});

function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  res.redirect('/join?login=1');
}

function allowGuestOrAuth(req, res, next) {
  if (req.session.userId || req.session.guest) return next();
  res.redirect('/join?login=1');
}

function requireStaff(req, res, next) {
  if (!req.session.userId) return res.redirect(getMaintenanceMode() ? '/staff/login' : '/?login=1');
  const user = db.getUserById(req.session.userId);
  if (!user || !user.is_staff) return res.redirect('/feed');
  req.session.is_staff = true;
  next();
}

app.get('/staff/login', (req, res) => {
  if (getMaintenanceMode()) {
    req.session.destroy(() => res.redirect('/maintenance-login.html'));
    return;
  }
  if (req.session.userId) {
    const user = db.getUserById(req.session.userId);
    if (user && user.is_staff) return res.redirect('/staff/dashboard');
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
  res.redirect('/staff/dashboard');
});

app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/feed');
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
  res.redirect(user.is_staff ? '/staff/dashboard' : '/feed');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
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
  const conversations = allConversations.filter((c) => (db.areFriends(req.session.userId, c.id) || (c.username && c.username.toLowerCase() === SUPPORT_USERNAME.toLowerCase())) && !db.isBlocked(req.session.userId, c.id) && !db.isBlocked(c.id, req.session.userId));
  const currentUser = db.getUserById(req.session.userId);
  const pendingRequestsToMe = db.getPendingRequestsToMe(req.session.userId);
  res.render('messages', {
    title: 'Messages — ClassChat',
    conversations,
    pendingRequestsToMe,
    currentUser,
    username: req.session.username,
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
  let messages = db.getMessagesWithUser(req.session.userId, other.id).map((m) => ({ ...m, created_at: formatPostTime(m.created_at), reactions: db.getMessageReactions(m.id) }));
  messages = messages.map((m) => {
    if (m.reply_to_message_id) {
      const replyTo = db.getMessageById(m.reply_to_message_id);
      m.reply_to_body = replyTo ? (replyTo.body || '').slice(0, 100) : null;
    }
    return m;
  });
  const pinnedMessageId = db.getPinnedMessage(req.session.userId, other.id);
  const currentUser = db.getUserById(req.session.userId);
  res.render('conversation', {
    title: `@${other.username} — ClassChat`,
    other,
    messages,
    pinnedMessageId,
    isMuted: db.isConversationMuted(req.session.userId, other.id),
    currentUser,
    username: req.session.username,
    userId: req.session.userId,
    is_staff: !!req.session.is_staff,
  });
});

app.post('/messages', requireAuth, messageAttachUpload, (req, res) => {
  const toUsername = (req.body.to || '').trim();
  const body = (req.body.body || '').trim();
  const replyToId = req.body.reply_to ? Number(req.body.reply_to) : null;
  if (!toUsername) return res.redirect('/messages');
  if (!body && !(req.files && (req.files.image?.[0] || req.files.file?.[0] || req.files.video?.[0]))) return res.redirect(`/messages/${encodeURIComponent(toUsername)}?error=empty`);
  const other = db.getUserByUsername(toUsername);
  const isSupport = other && other.username && other.username.toLowerCase() === SUPPORT_USERNAME.toLowerCase();
  if (!other || other.id === req.session.userId) return res.redirect('/messages');
  if (db.isBlocked(req.session.userId, other.id) || db.isBlocked(other.id, req.session.userId)) return res.redirect('/messages?error=blocked');
  if (!isSupport && !db.areFriends(req.session.userId, other.id)) return res.redirect('/messages?error=not_friends');
  const imagePath = req.files && req.files.image?.[0] ? `/uploads/${req.files.image[0].filename}` : null;
  const filePath = req.files && req.files.file?.[0] ? `/uploads/${req.files.file[0].filename}` : null;
  const videoPath = req.files && req.files.video?.[0] ? `/uploads/${req.files.video[0].filename}` : null;
  db.sendMessage(req.session.userId, other.id, body, replyToId, imagePath, filePath, videoPath);
  res.redirect(`/messages/${encodeURIComponent(other.username)}`);
});

app.post('/messages/:id/delete', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const msg = db.getMessageById(id);
  if (!msg) return res.redirect('/messages');
  if (msg.sender_id !== req.session.userId) return res.redirect('/messages');
  const otherId = msg.receiver_id;
  const other = db.getUserById(otherId);
  db.deleteMessage(id, req.session.userId);
  if (other) return res.redirect(`/messages/${encodeURIComponent(other.username)}`);
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

app.post('/settings/email-digest', requireAuth, (req, res) => {
  const digest = (req.body.email_digest || 'none').trim();
  if (['none', 'daily', 'weekly'].includes(digest)) db.setEmailDigest(req.session.userId, digest);
  res.redirect(req.body.redirect || '/settings');
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
  const stories = db.getActiveStories().map((s) => ({ ...s, created_at: formatPostTime(s.created_at) }));
  res.render('stories', {
    title: 'Stories — ClassChat',
    layout: 'layout',
    username: req.session.username,
    stories,
    showSupportButton: true,
    pendingFriendRequestsCount: res.locals.pendingFriendRequestsCount,
    unreadActivityCount: res.locals.unreadActivityCount,
  });
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

app.get('/assignments', requireAuth, (req, res) => {
  const classId = req.query.class_id ? Number(req.query.class_id) : null;
  const classes = db.getClasses();
  const assignments = classId ? db.getAssignmentsByClass(classId) : [];
  res.render('assignments', {
    title: 'Assignments — ClassChat',
    layout: 'layout',
    username: req.session.username,
    classId,
    classes,
    assignments: assignments.map((a) => ({ ...a, due_at: formatPostTime(a.due_at) })),
    showSupportButton: true,
    pendingFriendRequestsCount: res.locals.pendingFriendRequestsCount,
    unreadActivityCount: res.locals.unreadActivityCount,
  });
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
  res.render('staff/dashboard', {
    title: 'Staff Dashboard — ClassChat',
    layout: 'staff-layout',
    stats,
    classes,
    maintenance,
    maintenanceMode: maintenance,
    posts,
    users,
    supportQueries,
    username: req.session.username,
    user,
  });
});

app.post('/staff/maintenance', requireStaff, (req, res) => {
  setMaintenanceMode(!!req.body.enable);
  res.redirect('/staff/dashboard');
});

app.post('/staff/maintenance/toggle', requireStaff, (req, res) => {
  setMaintenanceMode(!getMaintenanceMode());
  res.redirect('/staff/dashboard');
});

app.get('/staff/posts/:id/edit', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  const post = db.getPostById(id);
  if (!post) return res.redirect('/staff/dashboard');
  const classes = db.getClasses();
  res.render('staff/post-edit', {
    title: 'Edit post — ClassChat',
    layout: 'staff-layout',
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
  res.redirect('/staff/dashboard');
});

app.post('/staff/posts/:id/delete', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  if (db.getPostById(id)) db.deletePost(id);
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
    title: 'Edit user — ClassChat',
    layout: 'staff-layout',
    editUser: user,
    targetUser: user,
    username: req.session.username,
  });
});

app.post('/staff/users/:id/edit', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.userId) return res.redirect('/staff/dashboard');
  const user = db.getUserById(id);
  if (!user) return res.redirect('/staff/dashboard');
  const isStaff = req.body.is_staff === '1';
  const database = db.getDb();
  database.prepare('UPDATE users SET is_staff = ? WHERE id = ?').run(isStaff ? 1 : 0, id);
  database.close();
  res.redirect('/staff/dashboard');
});

app.post('/staff/users/:id/delete', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.userId) return res.redirect('/staff/dashboard');
  if (db.getUserById(id)) db.deleteUser(id);
  res.redirect('/staff/dashboard');
});

app.get('/staff/profile', requireStaff, (req, res) => {
  const user = db.getUserById(req.session.userId);
  res.render('staff/profile', {
    title: 'Staff profile — ClassChat',
    layout: 'staff-layout',
    user,
    username: req.session.username,
  });
});

app.get('/staff/support/:username', requireStaff, (req, res) => {
  const supportUser = db.getUserByUsername(SUPPORT_USERNAME);
  const other = db.getUserByUsername(req.params.username);
  if (!supportUser || !other || other.username.toLowerCase() === SUPPORT_USERNAME.toLowerCase()) return res.redirect('/staff/dashboard');
  const messages = db.getMessagesWithUser(supportUser.id, other.id).map((m) => ({ ...m, created_at: formatPostTime(m.created_at) }));
  res.render('staff/support-conversation', {
    title: `Support: @${other.username} — ClassChat`,
    layout: 'staff-layout',
    supportUser,
    other,
    messages,
    username: req.session.username,
  });
});

app.post('/staff/support/:username', requireStaff, (req, res) => {
  const supportUser = db.getUserByUsername(SUPPORT_USERNAME);
  const other = db.getUserByUsername(req.params.username);
  if (!supportUser || !other || other.username.toLowerCase() === SUPPORT_USERNAME.toLowerCase()) return res.redirect('/staff/dashboard');
  const body = (req.body.body || '').trim();
  if (body) db.sendMessage(supportUser.id, other.id, body);
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
const wss = new WebSocketServer({ server, path: '/call/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  const userId = url.searchParams.get('token') ? validateCallToken(url.searchParams.get('token')) : null;
  if (!userId) {
    ws.close(4001, 'Invalid or expired token');
    return;
  }
  const prev = socketsByUser.get(userId);
  if (prev) try { prev.close(); } catch (_) {}
  socketsByUser.set(userId, ws);
  ws.userId = userId;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    const fromUser = db.getUserById(userId);
    const fromUsername = fromUser ? fromUser.username : '';

    if (msg.type === 'call') {
      const toUser = db.getUserByUsername(msg.to);
      if (!toUser || toUser.id === userId) return;
      if (db.isBlocked(userId, toUser.id) || db.isBlocked(toUser.id, userId)) return;
      if (!db.areFriends(userId, toUser.id) && toUser.username.toLowerCase() !== SUPPORT_USERNAME.toLowerCase()) return;
      const targetWs = socketsByUser.get(toUser.id);
      if (!targetWs || targetWs.readyState !== 1) {
        ws.send(JSON.stringify({ type: 'offline', to: msg.to }));
        return;
      }
      const isVideo = msg.video !== false;
      targetWs.send(JSON.stringify({ type: 'incoming-call', from: userId, username: fromUsername, video: isVideo }));
      sendPushToUser(toUser.id, {
        title: isVideo ? 'Incoming video call' : 'Incoming audio call',
        body: '@' + fromUsername + ' is calling you',
        url: '/messages',
        requireInteraction: true,
        tag: 'incoming-call-' + userId
      });
      return;
    }
    if (msg.type === 'accept') {
      const callerWs = socketsByUser.get(msg.from);
      if (callerWs && callerWs.readyState === 1) callerWs.send(JSON.stringify({ type: 'accepted', from: userId, username: fromUsername }));
      return;
    }
    if (msg.type === 'decline') {
      const callerWs = socketsByUser.get(msg.from);
      if (callerWs && callerWs.readyState === 1) callerWs.send(JSON.stringify({ type: 'declined', from: userId }));
      return;
    }
    if (msg.type === 'offer' || msg.type === 'answer' || msg.type === 'ice-candidate' || msg.type === 'hangup') {
      const targetWs = socketsByUser.get(msg.to);
      if (targetWs && targetWs.readyState === 1) targetWs.send(JSON.stringify({ ...msg, from: userId, username: fromUsername }));
    }
  });

  ws.on('close', () => {
    if (socketsByUser.get(userId) === ws) socketsByUser.delete(userId);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const hostname = os.hostname();
  console.log(`ClassChat running at http://localhost:${PORT}`);
  console.log(`  Also on this network: http://${hostname}:${PORT} and http://${hostname}.local:${PORT}`);
});
