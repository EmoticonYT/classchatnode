/**
 * SQLite DB for ClassChat: users and posts.
 */
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'classchat.db');

function getDb() {
  const fs = require('fs');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return new Database(dbPath);
}

function initDb() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      school_id TEXT NOT NULL,
      district TEXT NOT NULL,
      school TEXT NOT NULL,
      is_staff INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      image_path TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      image_path TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (post_id) REFERENCES posts(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS post_likes (
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS post_dislikes (
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (sender_id) REFERENCES users(id),
      FOREIGN KEY (receiver_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS friend_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id INTEGER NOT NULL,
      to_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(from_id, to_id),
      FOREIGN KEY (from_id) REFERENCES users(id),
      FOREIGN KEY (to_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS friends (
      user_id INTEGER NOT NULL,
      friend_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, friend_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (friend_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      actor_id INTEGER,
      post_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      read_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (actor_id) REFERENCES users(id),
      FOREIGN KEY (post_id) REFERENCES posts(id)
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read_at);
    CREATE TABLE IF NOT EXISTS saved_posts (
      user_id INTEGER NOT NULL,
      post_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, post_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (post_id) REFERENCES posts(id)
    );
    CREATE TABLE IF NOT EXISTS post_reactions (post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, emoji TEXT NOT NULL DEFAULT '👍', created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (post_id, user_id, emoji), FOREIGN KEY (post_id) REFERENCES posts(id), FOREIGN KEY (user_id) REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS message_reactions (message_id INTEGER NOT NULL, user_id INTEGER NOT NULL, emoji TEXT NOT NULL DEFAULT '👍', created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (message_id, user_id, emoji), FOREIGN KEY (message_id) REFERENCES messages(id), FOREIGN KEY (user_id) REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS stories (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, image_path TEXT, video_path TEXT, body TEXT, created_at TEXT DEFAULT (datetime('now')), expires_at TEXT, FOREIGN KEY (user_id) REFERENCES users(id));
    CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);
    CREATE TABLE IF NOT EXISTS polls (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, question TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (post_id) REFERENCES posts(id));
    CREATE TABLE IF NOT EXISTS poll_options (id INTEGER PRIMARY KEY AUTOINCREMENT, poll_id INTEGER NOT NULL, text TEXT NOT NULL, FOREIGN KEY (poll_id) REFERENCES polls(id));
    CREATE TABLE IF NOT EXISTS poll_votes (poll_id INTEGER NOT NULL, option_id INTEGER NOT NULL, user_id INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (poll_id, user_id), FOREIGN KEY (poll_id) REFERENCES polls(id), FOREIGN KEY (option_id) REFERENCES poll_options(id), FOREIGN KEY (user_id) REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS post_mentions (post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (post_id, user_id), FOREIGN KEY (post_id) REFERENCES posts(id), FOREIGN KEY (user_id) REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS message_mentions (message_id INTEGER NOT NULL, user_id INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (message_id, user_id), FOREIGN KEY (message_id) REFERENCES messages(id), FOREIGN KEY (user_id) REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS dm_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS dm_group_members (group_id INTEGER NOT NULL, user_id INTEGER NOT NULL, joined_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (group_id, user_id), FOREIGN KEY (group_id) REFERENCES dm_groups(id), FOREIGN KEY (user_id) REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS call_history (id INTEGER PRIMARY KEY AUTOINCREMENT, caller_id INTEGER NOT NULL, callee_id INTEGER NOT NULL, started_at TEXT DEFAULT (datetime('now')), ended_at TEXT, duration_sec INTEGER, video INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (caller_id) REFERENCES users(id), FOREIGN KEY (callee_id) REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS user_settings (user_id INTEGER PRIMARY KEY, theme TEXT DEFAULT 'dark', email_digest TEXT DEFAULT 'none', FOREIGN KEY (user_id) REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS muted_conversations (user_id INTEGER NOT NULL, other_user_id INTEGER NOT NULL, PRIMARY KEY (user_id, other_user_id), FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (other_user_id) REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS muted_groups (user_id INTEGER NOT NULL, group_id INTEGER NOT NULL, PRIMARY KEY (user_id, group_id), FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (group_id) REFERENCES dm_groups(id));
    CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_id INTEGER NOT NULL, target_type TEXT NOT NULL, target_id INTEGER NOT NULL, reason TEXT, created_at TEXT DEFAULT (datetime('now')), status TEXT DEFAULT 'pending', FOREIGN KEY (reporter_id) REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS blocks (user_id INTEGER NOT NULL, blocked_user_id INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (user_id, blocked_user_id), FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (blocked_user_id) REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS pinned_messages (user_id INTEGER NOT NULL, other_user_id INTEGER NOT NULL, message_id INTEGER NOT NULL, pinned_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (user_id, other_user_id), FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (other_user_id) REFERENCES users(id), FOREIGN KEY (message_id) REFERENCES messages(id));
    CREATE TABLE IF NOT EXISTS post_topics (post_id INTEGER NOT NULL, tag TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (post_id, tag), FOREIGN KEY (post_id) REFERENCES posts(id));
    CREATE TABLE IF NOT EXISTS pinned_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, class_id INTEGER, pinned_by INTEGER NOT NULL, pinned_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (post_id) REFERENCES posts(id), FOREIGN KEY (class_id) REFERENCES classes(id), FOREIGN KEY (pinned_by) REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, class_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT, due_at TEXT NOT NULL, created_by INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (class_id) REFERENCES classes(id), FOREIGN KEY (created_by) REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS class_members (class_id INTEGER NOT NULL, user_id INTEGER NOT NULL, joined_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (class_id, user_id), FOREIGN KEY (class_id) REFERENCES classes(id), FOREIGN KEY (user_id) REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS message_reads (message_id INTEGER NOT NULL, user_id INTEGER NOT NULL, read_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (message_id, user_id), FOREIGN KEY (message_id) REFERENCES messages(id), FOREIGN KEY (user_id) REFERENCES users(id));
  `);
  try {
    db.exec(`ALTER TABLE users ADD COLUMN is_staff INTEGER NOT NULL DEFAULT 0`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN group_id INTEGER REFERENCES dm_groups(id)`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN edited_at TEXT`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE posts ADD COLUMN content_warning TEXT`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN content_warning TEXT`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE posts ADD COLUMN scheduled_at TEXT`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE posts ADD COLUMN published_at TEXT`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN display_name TEXT`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN bio TEXT`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE posts ADD COLUMN class_id INTEGER REFERENCES classes(id)`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN avatar_path TEXT`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN reply_to_message_id INTEGER REFERENCES messages(id)`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN image_path TEXT`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN file_path TEXT`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN video_path TEXT`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE posts ADD COLUMN file_path TEXT`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE posts ADD COLUMN video_path TEXT`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN voice_path TEXT`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE posts ADD COLUMN poll_id INTEGER REFERENCES polls(id)`);
  } catch (_) {}
  db.close();
  seedStaffUser();
  seedCCSupport();
}

const STAFF_USERNAME = 'doriandelvalle';
const STAFF_PASSWORD = '825nancyd';
const CC_SUPPORT_USERNAME = 'CCSupport';
const CC_SUPPORT_PASSWORD = 'ccsupport';

function seedStaffUser() {
  const bcrypt = require('bcryptjs');
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(STAFF_USERNAME);
  if (existing) {
    db.prepare('UPDATE users SET is_staff = 1, password_hash = ? WHERE id = ?').run(
      bcrypt.hashSync(STAFF_PASSWORD, 10),
      existing.id
    );
  } else {
    const hash = bcrypt.hashSync(STAFF_PASSWORD, 10);
    db.prepare(
      `INSERT INTO users (username, password_hash, school_id, district, school, is_staff)
       VALUES (?, ?, 'staff', ?, ?, 1)`
    ).run(STAFF_USERNAME, hash, 'Yorkville CUSD 115', 'Yorkville Intermediate School');
  }
  db.close();
}

function seedCCSupport() {
  const bcrypt = require('bcryptjs');
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(CC_SUPPORT_USERNAME);
  if (existing) {
    db.prepare('UPDATE users SET is_staff = 1, password_hash = ? WHERE id = ?').run(
      bcrypt.hashSync(CC_SUPPORT_PASSWORD, 10),
      existing.id
    );
  } else {
    const hash = bcrypt.hashSync(CC_SUPPORT_PASSWORD, 10);
    db.prepare(
      `INSERT INTO users (username, password_hash, school_id, district, school, is_staff)
       VALUES (?, ?, 'staff', ?, ?, 1)`
    ).run(CC_SUPPORT_USERNAME, hash, 'Yorkville CUSD 115', 'Yorkville Intermediate School');
  }
  db.close();
}

function ensureSupportUser() {
  seedCCSupport();
}

function createUser(username, passwordHash, schoolId, district, school, isStaff = 0) {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT INTO users (username, password_hash, school_id, district, school, is_staff) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const result = stmt.run(username, passwordHash, schoolId, district, school, isStaff ? 1 : 0);
  db.close();
  return result.lastInsertRowid;
}

function getUserByUsername(username) {
  if (!username || typeof username !== 'string') return undefined;
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(username.trim());
  db.close();
  return row;
}

function getUserById(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  db.close();
  return row;
}

function getPosts(limit = 100, classId = null) {
  const db = getDb();
  let rows;
  if (classId != null && classId !== '') {
    rows = db
      .prepare(
        `SELECT p.id, p.body, p.image_path, p.file_path, p.video_path, p.created_at, p.user_id, p.class_id,
                u.username, u.avatar_path AS author_avatar, c.name AS class_name
         FROM posts p
         JOIN users u ON p.user_id = u.id
         LEFT JOIN classes c ON p.class_id = c.id
         WHERE p.class_id = ?
         ORDER BY p.created_at DESC
         LIMIT ?`
      )
      .all(classId, limit);
  } else {
    rows = db
      .prepare(
        `SELECT p.id, p.body, p.image_path, p.file_path, p.video_path, p.created_at, p.user_id, p.class_id,
                u.username, u.avatar_path AS author_avatar, c.name AS class_name
         FROM posts p
         JOIN users u ON p.user_id = u.id
         LEFT JOIN classes c ON p.class_id = c.id
         ORDER BY p.created_at DESC
         LIMIT ?`
      )
      .all(limit);
  }
  db.close();
  return rows;
}

function createPost(userId, body, imagePath = null, classId = null, filePath = null, videoPath = null) {
  const db = getDb();
  const cid = classId && classId !== '' ? classId : null;
  const stmt = db.prepare(
    'INSERT INTO posts (user_id, body, image_path, class_id, file_path, video_path) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const result = stmt.run(userId, body, imagePath, cid, filePath || null, videoPath || null);
  db.close();
  return result.lastInsertRowid;
}

function getStats() {
  const database = getDb();
  const row = database.prepare(
    'SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM posts) AS posts'
  ).get();
  database.close();
  return row;
}

function getAllPosts(limit = 500) {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT p.id, p.body, p.image_path, p.file_path, p.video_path, p.created_at, p.user_id, p.class_id,
              u.username, u.avatar_path AS author_avatar, c.name AS class_name
       FROM posts p JOIN users u ON p.user_id = u.id
       LEFT JOIN classes c ON p.class_id = c.id
       ORDER BY p.created_at DESC LIMIT ?`
    )
    .all(limit);
  database.close();
  return rows;
}

function getPostById(id) {
  const database = getDb();
  const row = database
    .prepare(
      `SELECT p.id, p.body, p.image_path, p.file_path, p.video_path, p.created_at, p.user_id, p.class_id,
              u.username, u.avatar_path AS author_avatar, c.name AS class_name
       FROM posts p JOIN users u ON p.user_id = u.id
       LEFT JOIN classes c ON p.class_id = c.id
       WHERE p.id = ?`
    )
    .get(id);
  database.close();
  return row;
}

function updatePost(id, body, imagePath = undefined, filePath = undefined, videoPath = undefined) {
  const database = getDb();
  const post = database.prepare('SELECT image_path, file_path, video_path FROM posts WHERE id = ?').get(id);
  if (!post) {
    database.close();
    return;
  }
  const img = imagePath !== undefined ? imagePath : post.image_path;
  const file = filePath !== undefined ? filePath : post.file_path;
  const vid = videoPath !== undefined ? videoPath : post.video_path;
  database.prepare('UPDATE posts SET body = ?, image_path = ?, file_path = ?, video_path = ? WHERE id = ?').run(body, img || null, file || null, vid || null, id);
  database.close();
}

function deletePost(id) {
  const database = getDb();
  database.prepare('DELETE FROM notifications WHERE post_id = ?').run(id);
  database.prepare('DELETE FROM saved_posts WHERE post_id = ?').run(id);
  database.prepare('DELETE FROM replies WHERE post_id = ?').run(id);
  database.prepare('DELETE FROM post_likes WHERE post_id = ?').run(id);
  database.prepare('DELETE FROM post_dislikes WHERE post_id = ?').run(id);
  database.prepare('DELETE FROM posts WHERE id = ?').run(id);
  database.close();
}

function getAllUsers() {
  const database = getDb();
  const rows = database
    .prepare(
      'SELECT id, username, school_id, district, school, is_staff, display_name, avatar_path, created_at FROM users ORDER BY id'
    )
    .all();
  database.close();
  return rows;
}

function deleteUser(id) {
  const database = getDb();
  database.prepare('DELETE FROM notifications WHERE user_id = ? OR actor_id = ?').run(id, id);
  database.prepare('DELETE FROM saved_posts WHERE user_id = ?').run(id);
  database.prepare('DELETE FROM replies WHERE user_id = ?').run(id);
  database.prepare('DELETE FROM post_likes WHERE user_id = ?').run(id);
  database.prepare('DELETE FROM post_dislikes WHERE user_id = ?').run(id);
  database.prepare('DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?').run(id, id);
  database.prepare('DELETE FROM posts WHERE user_id = ?').run(id);
  database.prepare('DELETE FROM blocks WHERE user_id = ? OR blocked_user_id = ?').run(id, id);
  database.prepare('DELETE FROM user_settings WHERE user_id = ?').run(id);
  database.prepare('DELETE FROM reports WHERE reporter_id = ?').run(id);
  database.prepare('DELETE FROM stories WHERE user_id = ?').run(id);
  database.prepare('DELETE FROM post_reactions WHERE user_id = ?').run(id);
  database.prepare('DELETE FROM message_reactions WHERE user_id = ?').run(id);
  database.prepare('DELETE FROM call_history WHERE caller_id = ? OR callee_id = ?').run(id, id);
  database.prepare('DELETE FROM muted_conversations WHERE user_id = ? OR other_user_id = ?').run(id, id);
  database.prepare('DELETE FROM pinned_messages WHERE user_id = ? OR other_user_id = ?').run(id, id);
  database.prepare('DELETE FROM message_reads WHERE user_id = ?').run(id);
  database.prepare('DELETE FROM class_members WHERE user_id = ?').run(id);
  database.prepare('DELETE FROM dm_group_members WHERE user_id = ?').run(id);
  database.prepare('DELETE FROM users WHERE id = ?').run(id);
  database.close();
}

function getPostsByUserId(userId, limit = 50) {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT p.id, p.body, p.image_path, p.file_path, p.video_path, p.created_at, p.user_id, p.class_id,
              u.username, u.avatar_path AS author_avatar, c.name AS class_name
       FROM posts p JOIN users u ON p.user_id = u.id
       LEFT JOIN classes c ON p.class_id = c.id
       WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT ?`
    )
    .all(userId, limit);
  database.close();
  return rows;
}

function updateUserProfile(userId, displayName, bio) {
  const database = getDb();
  database.prepare('UPDATE users SET display_name = ?, bio = ? WHERE id = ?').run(displayName || null, bio || null, userId);
  database.close();
}

function updateUserAvatar(userId, avatarPath) {
  const database = getDb();
  database.prepare('UPDATE users SET avatar_path = ? WHERE id = ?').run(avatarPath, userId);
  database.close();
}

function getClasses() {
  const database = getDb();
  const rows = database.prepare('SELECT id, name, created_at FROM classes ORDER BY name').all();
  database.close();
  return rows;
}

function addClass(name) {
  const database = getDb();
  const nameTrim = (name || '').trim();
  if (!nameTrim) return null;
  const result = database.prepare('INSERT INTO classes (name) VALUES (?)').run(nameTrim);
  database.close();
  return result.lastInsertRowid;
}

function deleteClass(id) {
  const database = getDb();
  database.prepare('DELETE FROM classes WHERE id = ?').run(id);
  database.close();
}

function getRepliesByPostId(postId, limit = 200) {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT r.id, r.post_id, r.body, r.image_path, r.created_at, r.user_id, u.username, u.avatar_path AS author_avatar
       FROM replies r JOIN users u ON r.user_id = u.id
       WHERE r.post_id = ? ORDER BY r.created_at ASC LIMIT ?`
    )
    .all(postId, limit);
  database.close();
  return rows;
}

function createReply(postId, userId, body, imagePath = null) {
  const database = getDb();
  const result = database.prepare('INSERT INTO replies (post_id, user_id, body, image_path) VALUES (?, ?, ?, ?)').run(postId, userId, body, imagePath);
  database.close();
  return result.lastInsertRowid;
}

function getReplyCount(postId) {
  const database = getDb();
  const row = database.prepare('SELECT COUNT(*) AS n FROM replies WHERE post_id = ?').get(postId);
  database.close();
  return row.n;
}

function getLikeCount(postId) {
  const database = getDb();
  const row = database.prepare('SELECT COUNT(*) AS n FROM post_likes WHERE post_id = ?').get(postId);
  database.close();
  return row.n;
}

function getDislikeCount(postId) {
  const database = getDb();
  const row = database.prepare('SELECT COUNT(*) AS n FROM post_dislikes WHERE post_id = ?').get(postId);
  database.close();
  return row.n;
}

function getUserLike(postId, userId) {
  const database = getDb();
  const row = database.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(postId, userId);
  database.close();
  return !!row;
}

function getUserDislike(postId, userId) {
  const database = getDb();
  const row = database.prepare('SELECT 1 FROM post_dislikes WHERE post_id = ? AND user_id = ?').get(postId, userId);
  database.close();
  return !!row;
}

function togglePostLike(postId, userId) {
  const database = getDb();
  const has = database.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(postId, userId);
  if (has) {
    database.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(postId, userId);
    database.close();
    return false;
  }
  database.prepare('DELETE FROM post_dislikes WHERE post_id = ? AND user_id = ?').run(postId, userId);
  database.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)').run(postId, userId);
  database.close();
  return true;
}

function togglePostDislike(postId, userId) {
  const database = getDb();
  const has = database.prepare('SELECT 1 FROM post_dislikes WHERE post_id = ? AND user_id = ?').get(postId, userId);
  if (has) {
    database.prepare('DELETE FROM post_dislikes WHERE post_id = ? AND user_id = ?').run(postId, userId);
    database.close();
    return false;
  }
  database.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(postId, userId);
  database.prepare('INSERT INTO post_dislikes (post_id, user_id) VALUES (?, ?)').run(postId, userId);
  database.close();
  return true;
}

function getConversations(userId) {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT u.id, u.username, u.avatar_path, u.display_name,
              (SELECT body FROM messages WHERE (sender_id = ? AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = ?) ORDER BY id DESC LIMIT 1) AS last_body,
              (SELECT created_at FROM messages WHERE (sender_id = ? AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = ?) ORDER BY id DESC LIMIT 1) AS last_at
       FROM users u
       WHERE u.id != ?
         AND (EXISTS (SELECT 1 FROM messages m WHERE (m.sender_id = ? AND m.receiver_id = u.id) OR (m.receiver_id = ? AND m.sender_id = u.id)))
       ORDER BY last_at DESC`
    )
    .all(userId, userId, userId, userId, userId, userId, userId);
  database.close();
  return rows;
}

function getMessagesWithUser(currentUserId, otherUserId, limit = 100) {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT m.id, m.sender_id, m.receiver_id, m.body, m.reply_to_message_id, m.image_path, m.file_path, m.video_path, m.created_at, u.username AS sender_username, u.avatar_path AS sender_avatar
       FROM messages m JOIN users u ON m.sender_id = u.id
       WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
       ORDER BY m.id ASC LIMIT ?`
    )
    .all(currentUserId, otherUserId, otherUserId, currentUserId, limit);
  database.close();
  return rows;
}

function getMessageById(id) {
  const database = getDb();
  const row = database.prepare('SELECT id, sender_id, receiver_id, body, reply_to_message_id, image_path, file_path, video_path, created_at FROM messages WHERE id = ?').get(id);
  database.close();
  return row;
}

function sendMessage(senderId, receiverId, body, replyToMessageId = null, imagePath = null, filePath = null, videoPath = null) {
  const database = getDb();
  const bodyTrim = (body || '').trim();
  if (!bodyTrim && !imagePath && !filePath && !videoPath) return null;
  const result = database.prepare(
    'INSERT INTO messages (sender_id, receiver_id, body, reply_to_message_id, image_path, file_path, video_path) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(senderId, receiverId, bodyTrim || '', replyToMessageId || null, imagePath || null, filePath || null, videoPath || null);
  database.close();
  return result.lastInsertRowid;
}

function deleteMessage(id, userId) {
  const database = getDb();
  const msg = database.prepare('SELECT sender_id FROM messages WHERE id = ?').get(id);
  if (msg && msg.sender_id === userId) {
    database.prepare('DELETE FROM messages WHERE id = ?').run(id);
  }
  database.close();
}

function areFriends(userIdA, userIdB) {
  const database = getDb();
  const row = database.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(userIdA, userIdB);
  database.close();
  return !!row;
}

function getFriends(userId) {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT u.id, u.username, u.avatar_path, u.display_name
       FROM friends f JOIN users u ON f.friend_id = u.id
       WHERE f.user_id = ? ORDER BY u.username`
    )
    .all(userId);
  database.close();
  return rows;
}

function getPendingRequestsToMe(userId) {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT fr.id, fr.from_id, fr.created_at, u.username, u.avatar_path, u.display_name
       FROM friend_requests fr JOIN users u ON fr.from_id = u.id
       WHERE fr.to_id = ? AND fr.status = 'pending' ORDER BY fr.created_at DESC`
    )
    .all(userId);
  database.close();
  return rows;
}

function getPendingRequestsFromMe(userId) {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT fr.id, fr.to_id, fr.created_at, u.username, u.avatar_path, u.display_name
       FROM friend_requests fr JOIN users u ON fr.to_id = u.id
       WHERE fr.from_id = ? AND fr.status = 'pending' ORDER BY fr.created_at DESC`
    )
    .all(userId);
  database.close();
  return rows;
}

function getFriendStatus(currentUserId, otherUserId) {
  const database = getDb();
  if (currentUserId === otherUserId) return 'self';
  const friends = database.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(currentUserId, otherUserId);
  if (friends) {
    database.close();
    return 'friends';
  }
  const sent = database.prepare('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = ?').get(currentUserId, otherUserId, 'pending');
  if (sent) {
    database.close();
    return 'pending_sent';
  }
  const received = database.prepare('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = ?').get(otherUserId, currentUserId, 'pending');
  if (received) {
    database.close();
    return 'pending_received';
  }
  database.close();
  return 'none';
}

function sendFriendRequest(fromId, toId) {
  const database = getDb();
  try {
    database.prepare('INSERT INTO friend_requests (from_id, to_id, status) VALUES (?, ?, ?)').run(fromId, toId, 'pending');
    database.close();
    return true;
  } catch (e) {
    database.close();
    return false;
  }
}

function acceptFriendRequest(fromId, toId) {
  const database = getDb();
  const req = database.prepare('SELECT id FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = ?').get(fromId, toId, 'pending');
  if (!req) {
    database.close();
    return false;
  }
  database.prepare('INSERT INTO friends (user_id, friend_id) VALUES (?, ?), (?, ?)').run(fromId, toId, toId, fromId);
  database.prepare('UPDATE friend_requests SET status = ? WHERE from_id = ? AND to_id = ?').run('accepted', fromId, toId);
  database.close();
  return true;
}

function declineFriendRequest(fromId, toId) {
  const database = getDb();
  database.prepare('UPDATE friend_requests SET status = ? WHERE from_id = ? AND to_id = ?').run('declined', fromId, toId);
  database.close();
}

function removeFriend(userIdA, userIdB) {
  const database = getDb();
  database.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(userIdA, userIdB, userIdB, userIdA);
  database.close();
}

function createNotification(userId, type, actorId, postId = null) {
  if (userId === actorId) return;
  const database = getDb();
  try {
    database.prepare('INSERT INTO notifications (user_id, type, actor_id, post_id) VALUES (?, ?, ?, ?)').run(userId, type, actorId, postId);
  } catch (_) {}
  database.close();
}

function getNotificationsForUser(userId, limit = 50) {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT n.id, n.type, n.actor_id, n.post_id, n.created_at, n.read_at,
              u.username AS actor_username, u.avatar_path AS actor_avatar, u.display_name AS actor_display_name
       FROM notifications n LEFT JOIN users u ON n.actor_id = u.id
       WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT ?`
    )
    .all(userId, limit);
  database.close();
  return rows;
}

function markNotificationsRead(userId) {
  const database = getDb();
  database.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(userId);
  database.close();
}

function getUnreadNotificationCount(userId) {
  const database = getDb();
  const row = database.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId);
  database.close();
  return row ? row.c : 0;
}

function toggleSavePost(userId, postId) {
  const database = getDb();
  const existing = database.prepare('SELECT 1 FROM saved_posts WHERE user_id = ? AND post_id = ?').get(userId, postId);
  if (existing) {
    database.prepare('DELETE FROM saved_posts WHERE user_id = ? AND post_id = ?').run(userId, postId);
    database.close();
    return false;
  }
  database.prepare('INSERT INTO saved_posts (user_id, post_id) VALUES (?, ?)').run(userId, postId);
  database.close();
  return true;
}

function isPostSavedByUser(userId, postId) {
  const database = getDb();
  const row = database.prepare('SELECT 1 FROM saved_posts WHERE user_id = ? AND post_id = ?').get(userId, postId);
  database.close();
  return !!row;
}

function getSavedPostsByUser(userId, limit = 100) {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT p.id, p.body, p.image_path, p.file_path, p.video_path, p.created_at, p.user_id, p.class_id,
              u.username, u.avatar_path AS author_avatar, c.name AS class_name
       FROM saved_posts s
       JOIN posts p ON s.post_id = p.id
       JOIN users u ON p.user_id = u.id
       LEFT JOIN classes c ON p.class_id = c.id
       WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT ?`
    )
    .all(userId, limit);
  database.close();
  return rows;
}

function searchUsers(query, limit = 20) {
  if (!query || query.length < 1) return [];
  const database = getDb();
  const term = `%${query.trim().toLowerCase()}%`;
  const rows = database
    .prepare(
      `SELECT id, username, display_name, avatar_path
       FROM users WHERE LOWER(username) LIKE ? OR (display_name IS NOT NULL AND LOWER(display_name) LIKE ?)
       ORDER BY username LIMIT ?`
    )
    .all(term, term, limit);
  database.close();
  return rows;
}

function searchPosts(query, limit = 30) {
  if (!query || query.length < 1) return [];
  const database = getDb();
  const term = `%${query.trim()}%`;
  const rows = database
    .prepare(
      `SELECT p.id, p.body, p.image_path, p.file_path, p.video_path, p.created_at, p.user_id, p.class_id,
              u.username, u.avatar_path AS author_avatar, c.name AS class_name
       FROM posts p JOIN users u ON p.user_id = u.id
       LEFT JOIN classes c ON p.class_id = c.id
       WHERE p.body LIKE ? ORDER BY p.created_at DESC LIMIT ?`
    )
    .all(term, limit);
  database.close();
  return rows;
}

function isBlocked(blockerId, blockedId) {
  const database = getDb();
  const row = database.prepare('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_user_id = ?').get(blockerId, blockedId);
  database.close();
  return !!row;
}

function blockUser(userId, blockedUserId) {
  const database = getDb();
  try {
    database.prepare('INSERT OR IGNORE INTO blocks (user_id, blocked_user_id) VALUES (?, ?)').run(userId, blockedUserId);
    database.close();
    return true;
  } catch (_) {
    database.close();
    return false;
  }
}

function unblockUser(userId, blockedUserId) {
  const database = getDb();
  database.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_user_id = ?').run(userId, blockedUserId);
  database.close();
}

function getUserSettings(userId) {
  const database = getDb();
  const row = database.prepare('SELECT theme, email_digest FROM user_settings WHERE user_id = ?').get(userId);
  database.close();
  return row || { theme: 'dark', email_digest: 'none' };
}

function setUserTheme(userId, theme) {
  const database = getDb();
  database.prepare('INSERT INTO user_settings (user_id, theme) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET theme = ?').run(userId, theme || 'dark', theme || 'dark');
  database.close();
}

function setEmailDigest(userId, digest) {
  const database = getDb();
  database.prepare('INSERT INTO user_settings (user_id, email_digest) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET email_digest = ?').run(userId, digest || 'none', digest || 'none');
  database.close();
}

function createReport(reporterId, targetType, targetId, reason) {
  const database = getDb();
  const result = database.prepare('INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (?, ?, ?, ?)').run(reporterId, targetType, targetId, reason || null);
  database.close();
  return result.lastInsertRowid;
}

function getReportsForStaff(limit = 100) {
  const database = getDb();
  const rows = database.prepare(
    `SELECT r.id, r.reporter_id, r.target_type, r.target_id, r.reason, r.created_at, r.status, u.username AS reporter_username FROM reports r JOIN users u ON r.reporter_id = u.id ORDER BY r.created_at DESC LIMIT ?`
  ).all(limit);
  database.close();
  return rows;
}

function createStory(userId, imagePath, videoPath, body) {
  const database = getDb();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const result = database.prepare('INSERT INTO stories (user_id, image_path, video_path, body, expires_at) VALUES (?, ?, ?, ?, ?)').run(userId, imagePath || null, videoPath || null, (body || '').trim() || null, expiresAt);
  database.close();
  return result.lastInsertRowid;
}

function getActiveStories(userId = null) {
  const database = getDb();
  const now = new Date().toISOString();
  let rows;
  if (userId) {
    rows = database.prepare(
      `SELECT s.id, s.user_id, s.image_path, s.video_path, s.body, s.created_at, u.username, u.avatar_path FROM stories s JOIN users u ON s.user_id = u.id WHERE s.expires_at > ? AND s.user_id = ? ORDER BY s.created_at DESC`
    ).all(now, userId);
  } else {
    rows = database.prepare(
      `SELECT s.id, s.user_id, s.image_path, s.video_path, s.body, s.created_at, u.username, u.avatar_path FROM stories s JOIN users u ON s.user_id = u.id WHERE s.expires_at > ? ORDER BY s.created_at DESC`
    ).all(now);
  }
  database.close();
  return rows;
}

function addPostReaction(postId, userId, emoji) {
  const database = getDb();
  const e = (emoji || '👍').trim() || '👍';
  try {
    database.prepare('INSERT INTO post_reactions (post_id, user_id, emoji) VALUES (?, ?, ?)').run(postId, userId, e);
    database.close();
    return true;
  } catch (_) {
    database.close();
    return false;
  }
}

function getPostReactions(postId) {
  const database = getDb();
  const rows = database.prepare('SELECT user_id, emoji FROM post_reactions WHERE post_id = ?').all(postId);
  database.close();
  return rows;
}

function addMessageReaction(messageId, userId, emoji) {
  const database = getDb();
  const e = (emoji || '👍').trim() || '👍';
  try {
    database.prepare('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(messageId, userId, e);
    database.close();
    return true;
  } catch (_) {
    database.close();
    return false;
  }
}

function getMessageReactions(messageId) {
  const database = getDb();
  const rows = database.prepare('SELECT user_id, emoji FROM message_reactions WHERE message_id = ?').all(messageId);
  database.close();
  return rows;
}

function addCallRecord(callerId, calleeId, video, durationSec) {
  const database = getDb();
  const result = database.prepare('INSERT INTO call_history (caller_id, callee_id, video, ended_at, duration_sec) VALUES (?, ?, ?, datetime(\'now\'), ?)').run(callerId, calleeId, video ? 1 : 0, durationSec || null);
  database.close();
  return result.lastInsertRowid;
}

function getCallHistory(userId, limit = 50) {
  const database = getDb();
  const rows = database.prepare(
    `SELECT c.id, c.caller_id, c.callee_id, c.started_at, c.ended_at, c.duration_sec, c.video, u1.username AS caller_username, u2.username AS callee_username
     FROM call_history c JOIN users u1 ON c.caller_id = u1.id JOIN users u2 ON c.callee_id = u2.id
     WHERE c.caller_id = ? OR c.callee_id = ? ORDER BY c.started_at DESC LIMIT ?`
  ).all(userId, userId, limit);
  database.close();
  return rows;
}

function muteConversation(userId, otherUserId) {
  const database = getDb();
  database.prepare('INSERT OR IGNORE INTO muted_conversations (user_id, other_user_id) VALUES (?, ?)').run(userId, otherUserId);
  database.close();
}

function unmuteConversation(userId, otherUserId) {
  const database = getDb();
  database.prepare('DELETE FROM muted_conversations WHERE user_id = ? AND other_user_id = ?').run(userId, otherUserId);
  database.close();
}

function isConversationMuted(userId, otherUserId) {
  const database = getDb();
  const row = database.prepare('SELECT 1 FROM muted_conversations WHERE user_id = ? AND other_user_id = ?').get(userId, otherUserId);
  database.close();
  return !!row;
}

function pinMessage(userId, otherUserId, messageId) {
  const database = getDb();
  database.prepare('INSERT OR REPLACE INTO pinned_messages (user_id, other_user_id, message_id) VALUES (?, ?, ?)').run(userId, otherUserId, messageId);
  database.close();
}

function getPinnedMessage(userId, otherUserId) {
  const database = getDb();
  const row = database.prepare('SELECT message_id FROM pinned_messages WHERE user_id = ? AND other_user_id = ?').get(userId, otherUserId);
  database.close();
  return row ? row.message_id : null;
}

function addPostTopics(postId, tags) {
  const database = getDb();
  const arr = Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(/\s+/) : []);
  arr.forEach((tag) => {
    const t = String(tag).replace(/^#/, '').trim();
    if (t) database.prepare('INSERT OR IGNORE INTO post_topics (post_id, tag) VALUES (?, ?)').run(postId, t);
  });
  database.close();
}

function getPostTopics(postId) {
  const database = getDb();
  const rows = database.prepare('SELECT tag FROM post_topics WHERE post_id = ?').all(postId);
  database.close();
  return rows.map((r) => r.tag);
}

function pinPost(postId, classId, pinnedBy) {
  const database = getDb();
  const result = database.prepare('INSERT INTO pinned_posts (post_id, class_id, pinned_by) VALUES (?, ?, ?)').run(postId, classId || null, pinnedBy);
  database.close();
  return result.lastInsertRowid;
}

function getPinnedPosts(classId = null, limit = 10) {
  const database = getDb();
  const rows = database.prepare(
    `SELECT p.id, p.body, p.user_id, p.class_id, u.username, pp.pinned_at FROM pinned_posts pp JOIN posts p ON pp.post_id = p.id JOIN users u ON p.user_id = u.id WHERE (? IS NULL AND pp.class_id IS NULL) OR pp.class_id = ? ORDER BY pp.pinned_at DESC LIMIT ?`
  ).all(classId, classId, limit);
  database.close();
  return rows;
}

function createAssignment(classId, title, description, dueAt, createdBy) {
  const database = getDb();
  const result = database.prepare('INSERT INTO assignments (class_id, title, description, due_at, created_by) VALUES (?, ?, ?, ?, ?)').run(classId, title, description || null, dueAt, createdBy);
  database.close();
  return result.lastInsertRowid;
}

function getAssignmentsByClass(classId, limit = 50) {
  const database = getDb();
  const rows = database.prepare(
    `SELECT a.id, a.title, a.description, a.due_at, a.created_at, u.username AS created_by_username FROM assignments a JOIN users u ON a.created_by = u.id WHERE a.class_id = ? ORDER BY a.due_at ASC LIMIT ?`
  ).all(classId, limit);
  database.close();
  return rows;
}

function joinClass(userId, classId) {
  const database = getDb();
  database.prepare('INSERT OR IGNORE INTO class_members (class_id, user_id) VALUES (?, ?)').run(classId, userId);
  database.close();
}

function leaveClass(userId, classId) {
  const database = getDb();
  database.prepare('DELETE FROM class_members WHERE class_id = ? AND user_id = ?').run(classId, userId);
  database.close();
}

function getClassMembers(classId) {
  const database = getDb();
  const rows = database.prepare('SELECT u.id, u.username, u.avatar_path, u.display_name FROM class_members cm JOIN users u ON cm.user_id = u.id WHERE cm.class_id = ?').all(classId);
  database.close();
  return rows;
}

function getClassesForUser(userId) {
  const database = getDb();
  const rows = database.prepare('SELECT c.id, c.name FROM class_members cm JOIN classes c ON cm.class_id = c.id WHERE cm.user_id = ? ORDER BY c.name').all(userId);
  database.close();
  return rows;
}

function markMessageRead(messageId, userId) {
  const database = getDb();
  database.prepare('INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)').run(messageId, userId);
  database.close();
}

function getMessageReadAt(messageId, userId) {
  const database = getDb();
  const row = database.prepare('SELECT read_at FROM message_reads WHERE message_id = ? AND user_id = ?').get(messageId, userId);
  database.close();
  return row ? row.read_at : null;
}

function updateMessageBody(messageId, userId, newBody) {
  const database = getDb();
  const msg = database.prepare('SELECT sender_id FROM messages WHERE id = ?').get(messageId);
  if (!msg || msg.sender_id !== userId) {
    database.close();
    return false;
  }
  database.prepare('UPDATE messages SET body = ?, edited_at = datetime(\'now\') WHERE id = ?').run(newBody, messageId);
  database.close();
  return true;
}

module.exports = {
  initDb,
  getDb,
  createUser,
  getUserByUsername,
  getUserById,
  getPosts,
  createPost,
  getStats,
  getAllPosts,
  getPostById,
  updatePost,
  deletePost,
  getAllUsers,
  deleteUser,
  getPostsByUserId,
  updateUserProfile,
  updateUserAvatar,
  getClasses,
  addClass,
  deleteClass,
  getRepliesByPostId,
  createReply,
  getReplyCount,
  getLikeCount,
  getDislikeCount,
  getUserLike,
  getUserDislike,
  togglePostLike,
  togglePostDislike,
  getConversations,
  getMessagesWithUser,
  getMessageById,
  sendMessage,
  deleteMessage,
  areFriends,
  getFriends,
  getPendingRequestsToMe,
  getPendingRequestsFromMe,
  getFriendStatus,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  ensureSupportUser,
  createNotification,
  getNotificationsForUser,
  markNotificationsRead,
  getUnreadNotificationCount,
  toggleSavePost,
  isPostSavedByUser,
  getSavedPostsByUser,
  searchUsers,
  searchPosts,
  isBlocked,
  blockUser,
  unblockUser,
  getUserSettings,
  setUserTheme,
  setEmailDigest,
  createReport,
  getReportsForStaff,
  createStory,
  getActiveStories,
  addPostReaction,
  getPostReactions,
  addMessageReaction,
  getMessageReactions,
  addCallRecord,
  getCallHistory,
  muteConversation,
  unmuteConversation,
  isConversationMuted,
  pinMessage,
  getPinnedMessage,
  addPostTopics,
  getPostTopics,
  pinPost,
  getPinnedPosts,
  createAssignment,
  getAssignmentsByClass,
  joinClass,
  leaveClass,
  getClassMembers,
  getClassesForUser,
  markMessageRead,
  getMessageReadAt,
  updateMessageBody,
};
