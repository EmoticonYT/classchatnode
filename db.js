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
  db.exec(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON support_tickets(user_id);
    CREATE TABLE IF NOT EXISTS support_ticket_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      is_staff INTEGER NOT NULL DEFAULT 0,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket ON support_ticket_messages(ticket_id);
    CREATE TABLE IF NOT EXISTS chatrooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'public',
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS chatroom_members (
      chatroom_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (chatroom_id, user_id),
      FOREIGN KEY (chatroom_id) REFERENCES chatrooms(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS chatroom_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chatroom_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      reply_to_message_id INTEGER,
      image_path TEXT,
      file_path TEXT,
      video_path TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (chatroom_id) REFERENCES chatrooms(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chatroom_messages_room ON chatroom_messages(chatroom_id, id DESC);

    CREATE TABLE IF NOT EXISTS moderator_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER NOT NULL,
      actor_username TEXT NOT NULL,
      action TEXT NOT NULL,
      target_id INTEGER DEFAULT NULL,
      target_username TEXT DEFAULT NULL,
      details TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (actor_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_mod_audit_log_created ON moderator_audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mod_audit_log_action ON moderator_audit_log(action);
  `);
  try {
    db.exec(`ALTER TABLE user_settings ADD COLUMN seen_whats_new_version TEXT`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE user_settings ADD COLUMN accent_color TEXT DEFAULT NULL`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN timeout_until TEXT DEFAULT NULL`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN timeout_reason TEXT DEFAULT NULL`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN ban_reason TEXT DEFAULT NULL`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN banned_at TEXT DEFAULT NULL`);
  } catch (_) {}
  db.close();
  seedStaffUser();
  seedCCSupport();
  seedWNTestUser();
  seedDefaultChatrooms();
}

const STAFF_USERNAME = 'doriandelvalle';
const STAFF_PASSWORD = '825nancyd';
const CC_SUPPORT_USERNAME = 'CCSupport';
const CC_SUPPORT_PASSWORD = 'ccsupport';
const WN_TEST_USERNAME = 'wn-test';
const WN_TEST_PASSWORD = 'wn-test';

function seedWNTestUser() {
  const bcrypt = require('bcryptjs');
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(WN_TEST_USERNAME);
  const hash = bcrypt.hashSync(WN_TEST_PASSWORD, 10);
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, existing.id);
  } else {
    const defaultDistrict = process.env.DISTRICT || '';
    const defaultSchool = process.env.SCHOOL || '';
    db.prepare(
      `INSERT INTO users (username, password_hash, school_id, district, school, is_staff)
       VALUES (?, ?, 'test', ?, ?, 0)`
    ).run(WN_TEST_USERNAME, hash, defaultDistrict, defaultSchool);
  }
  db.close();
}

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
    const defaultDistrict = process.env.DISTRICT || '';
    const defaultSchool = process.env.SCHOOL || '';
    db.prepare(
      `INSERT INTO users (username, password_hash, school_id, district, school, is_staff)
       VALUES (?, ?, 'staff', ?, ?, 1)`
    ).run(STAFF_USERNAME, hash, defaultDistrict, defaultSchool);
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
    const defaultDistrict = process.env.DISTRICT || '';
    const defaultSchool = process.env.SCHOOL || '';
    db.prepare(
      `INSERT INTO users (username, password_hash, school_id, district, school, is_staff)
       VALUES (?, ?, 'staff', ?, ?, 1)`
    ).run(CC_SUPPORT_USERNAME, hash, defaultDistrict, defaultSchool);
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
  const result = stmt.run(username, passwordHash, schoolId, district || '', school || '', isStaff ? 1 : 0);
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
                u.username, u.display_name, u.avatar_path AS author_avatar, c.name AS class_name
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
                u.username, u.display_name, u.avatar_path AS author_avatar, c.name AS class_name
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
              u.username, u.display_name, u.avatar_path AS author_avatar, c.name AS class_name
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
              u.username, u.display_name, u.avatar_path AS author_avatar, c.name AS class_name
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
      'SELECT id, username, school_id, district, school, is_staff, display_name, avatar_path, timeout_until, timeout_reason, is_banned, ban_reason, banned_at, created_at FROM users ORDER BY id'
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
              u.username, u.display_name, u.avatar_path AS author_avatar, c.name AS class_name
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

function updateUsername(userId, newUsername) {
  const database = getDb();
  const res = database.prepare('UPDATE users SET username = ? WHERE id = ?').run(newUsername, userId);
  database.close();
  return res.changes > 0;
}

function staffUpdateUser(userId, { username, passwordHash, schoolId, bio, displayName, avatarPath, isStaff }) {
  const database = getDb();
  database
    .prepare(
      `UPDATE users 
       SET username = ?, 
           password_hash = ?, 
           school_id = ?, 
           bio = ?, 
           display_name = ?, 
           avatar_path = ?, 
           is_staff = ? 
       WHERE id = ?`
    )
    .run(
      username,
      passwordHash,
      schoolId,
      bio || null,
      displayName || null,
      avatarPath !== undefined ? avatarPath : null,
      isStaff ? 1 : 0,
      userId
    );
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
      `SELECT r.id, r.post_id, r.body, r.image_path, r.created_at, r.user_id, u.username, u.display_name, u.avatar_path AS author_avatar
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

function getMessagesWithUser(currentUserId, otherUserId, limit = 50, beforeId = null) {
  const database = getDb();
  let query;
  let params;
  if (beforeId) {
    query = `SELECT * FROM (
      SELECT m.id, m.sender_id, m.receiver_id, m.body, m.reply_to_message_id, m.image_path, m.file_path, m.video_path, m.created_at,
             u.username AS sender_username, u.display_name AS sender_display_name, u.avatar_path AS sender_avatar
      FROM messages m JOIN users u ON m.sender_id = u.id
      WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
        AND m.id < ?
      ORDER BY m.id DESC LIMIT ?
    ) sub ORDER BY sub.id ASC`;
    params = [currentUserId, otherUserId, otherUserId, currentUserId, beforeId, limit];
  } else {
    query = `SELECT * FROM (
      SELECT m.id, m.sender_id, m.receiver_id, m.body, m.reply_to_message_id, m.image_path, m.file_path, m.video_path, m.created_at,
             u.username AS sender_username, u.display_name AS sender_display_name, u.avatar_path AS sender_avatar
      FROM messages m JOIN users u ON m.sender_id = u.id
      WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
      ORDER BY m.id DESC LIMIT ?
    ) sub ORDER BY sub.id ASC`;
    params = [currentUserId, otherUserId, otherUserId, currentUserId, limit];
  }
  const rows = database.prepare(query).all(...params);
  database.close();
  return rows;
}

function hasOlderMessagesWithUser(currentUserId, otherUserId, oldestId) {
  if (!oldestId) return false;
  const database = getDb();
  const row = database.prepare(
    `SELECT 1 FROM messages 
     WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
       AND id < ?
     LIMIT 1`
  ).get(currentUserId, otherUserId, otherUserId, currentUserId, oldestId);
  database.close();
  return !!row;
}

function getMessageById(id) {
  const database = getDb();
  const row = database.prepare('SELECT id, sender_id, receiver_id, body, reply_to_message_id, image_path, file_path, video_path, created_at FROM messages WHERE id = ?').get(id);
  database.close();
  return row;
}

function getMessageWithDetails(id) {
  const database = getDb();
  const row = database
    .prepare(
      `SELECT m.id, m.sender_id, m.receiver_id, m.body, m.reply_to_message_id, m.image_path, m.file_path, m.video_path, m.created_at,
              u.username AS sender_username, u.display_name AS sender_display_name, u.avatar_path AS sender_avatar
       FROM messages m JOIN users u ON m.sender_id = u.id
       WHERE m.id = ?`
    )
    .get(id);
  if (row && row.reply_to_message_id) {
    const replyTo = database.prepare('SELECT body FROM messages WHERE id = ?').get(row.reply_to_message_id);
    row.reply_to_body = replyTo ? (replyTo.body || '').slice(0, 100) : null;
  }
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
              u.username, u.display_name, u.avatar_path AS author_avatar, c.name AS class_name
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
              u.username, u.display_name, u.avatar_path AS author_avatar, c.name AS class_name
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

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const cleanHex = hex.trim().replace(/^#/, '');
  if (cleanHex.length !== 6) return null;
  const num = parseInt(cleanHex, 16);
  if (isNaN(num)) return null;
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function getUserSettings(userId) {
  const database = getDb();
  const row = database.prepare('SELECT theme, email_digest, accent_color FROM user_settings WHERE user_id = ?').get(userId);
  database.close();

  const baseTheme = row ? row.theme : 'dark';
  const emailDigest = row ? row.email_digest : 'none';
  const customAccent = row && row.accent_color ? row.accent_color : null;

  let accent_color = null;
  let accent_hover = null;
  let accent_soft = null;
  let accent_r = 99;
  let accent_g = 102;
  let accent_b = 241;

  if (customAccent) {
    const rgb = hexToRgb(customAccent);
    if (rgb) {
      accent_color = `#${[rgb.r, rgb.g, rgb.b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
      accent_hover = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.85)`;
      accent_soft = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16)`;
      accent_r = rgb.r;
      accent_g = rgb.g;
      accent_b = rgb.b;
    }
  }

  return {
    theme: baseTheme || 'dark',
    email_digest: emailDigest || 'none',
    accent_color,
    accent_hover,
    accent_soft,
    accent_r,
    accent_g,
    accent_b,
  };
}

function setUserTheme(userId, theme) {
  const database = getDb();
  database.prepare('INSERT INTO user_settings (user_id, theme) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET theme = ?').run(userId, theme || 'dark', theme || 'dark');
  database.close();
}

function setUserAccentColor(userId, accentColor) {
  const database = getDb();
  let val = null;
  if (accentColor && typeof accentColor === 'string') {
    const rgb = hexToRgb(accentColor);
    if (rgb) {
      val = `#${[rgb.r, rgb.g, rgb.b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
    }
  }
  database.prepare('INSERT INTO user_settings (user_id, accent_color) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET accent_color = ?').run(userId, val, val);
  database.close();
  return val;
}

function setEmailDigest(userId, digest) {
  const database = getDb();
  database.prepare('INSERT INTO user_settings (user_id, email_digest) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET email_digest = ?').run(userId, digest || 'none', digest || 'none');
  database.close();
}

function logModeratorAction(actorId, actorUsername, action, targetId = null, targetUsername = null, details = null) {
  const database = getDb();
  const res = database.prepare(
    `INSERT INTO moderator_audit_log (actor_id, actor_username, action, target_id, target_username, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(actorId, actorUsername, action.toUpperCase(), targetId || null, targetUsername || null, details || null);
  database.close();
  return res.lastInsertRowid;
}

function getModeratorAuditLogs({ limit = 100, offset = 0, action = null, search = null } = {}) {
  const database = getDb();
  const conditions = [];
  const params = [];

  if (action && action !== 'all') {
    conditions.push('action = ?');
    params.push(action.toUpperCase());
  }

  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    conditions.push('(actor_username LIKE ? OR target_username LIKE ? OR details LIKE ?)');
    params.push(q, q, q);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT id, actor_id, actor_username, action, target_id, target_username, details, created_at
    FROM moderator_audit_log
    ${whereClause}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `;
  params.push(Math.max(1, Math.min(Number(limit) || 100, 200)));
  params.push(Math.max(0, Number(offset) || 0));

  const rows = database.prepare(sql).all(...params);
  database.close();
  return rows;
}

function getModeratorAuditLogCount({ action = null, search = null } = {}) {
  const database = getDb();
  const conditions = [];
  const params = [];

  if (action && action !== 'all') {
    conditions.push('action = ?');
    params.push(action.toUpperCase());
  }

  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    conditions.push('(actor_username LIKE ? OR target_username LIKE ? OR details LIKE ?)');
    params.push(q, q, q);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT COUNT(*) AS total FROM moderator_audit_log ${whereClause}`;
  const row = database.prepare(sql).get(...params);
  database.close();
  return row ? row.total : 0;
}

function hasSeenWhatsNew(userId, version = '3.1') {
  const database = getDb();
  const row = database.prepare('SELECT seen_whats_new_version FROM user_settings WHERE user_id = ?').get(userId);
  database.close();
  return row && row.seen_whats_new_version === version;
}

function markSeenWhatsNew(userId, version = '3.1') {
  const database = getDb();
  database.prepare('INSERT INTO user_settings (user_id, seen_whats_new_version) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET seen_whats_new_version = ?').run(userId, version, version);
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
    `SELECT r.id, r.reporter_id, r.target_type, r.target_id, r.reason, r.created_at, r.status,
            u.username AS reporter_username, u.display_name AS reporter_display_name
     FROM reports r JOIN users u ON r.reporter_id = u.id ORDER BY r.created_at DESC LIMIT ?`
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
      `SELECT s.id, s.user_id, s.image_path, s.video_path, s.body, s.created_at, u.username, u.display_name, u.avatar_path FROM stories s JOIN users u ON s.user_id = u.id WHERE s.expires_at > ? AND s.user_id = ? ORDER BY s.created_at DESC`
    ).all(now, userId);
  } else {
    rows = database.prepare(
      `SELECT s.id, s.user_id, s.image_path, s.video_path, s.body, s.created_at, u.username, u.display_name, u.avatar_path FROM stories s JOIN users u ON s.user_id = u.id WHERE s.expires_at > ? ORDER BY s.created_at DESC`
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
    `SELECT c.id, c.caller_id, c.callee_id, c.started_at, c.ended_at, c.duration_sec, c.video,
            u1.username AS caller_username, u1.display_name AS caller_display_name,
            u2.username AS callee_username, u2.display_name AS callee_display_name
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
    `SELECT p.id, p.body, p.user_id, p.class_id, u.username, u.display_name, pp.pinned_at FROM pinned_posts pp JOIN posts p ON pp.post_id = p.id JOIN users u ON p.user_id = u.id WHERE (? IS NULL AND pp.class_id IS NULL) OR pp.class_id = ? ORDER BY pp.pinned_at DESC LIMIT ?`
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
    `SELECT a.id, a.title, a.description, a.due_at, a.created_at, u.username AS created_by_username, u.display_name AS created_by_display_name FROM assignments a JOIN users u ON a.created_by = u.id WHERE a.class_id = ? ORDER BY a.due_at ASC LIMIT ?`
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

function createSupportTicket(userId, subject, category = 'general', priority = 'normal', initialMessage = '') {
  const db = getDb();
  const insertTicket = db.prepare(
    `INSERT INTO support_tickets (user_id, subject, category, priority, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'open', datetime('now'), datetime('now'))`
  );
  const insertMsg = db.prepare(
    `INSERT INTO support_ticket_messages (ticket_id, sender_id, is_staff, body, created_at)
     VALUES (?, ?, 0, ?, datetime('now'))`
  );

  const tx = db.transaction(() => {
    const res = insertTicket.run(userId, subject, category, priority);
    const ticketId = res.lastInsertRowid;
    if (initialMessage && initialMessage.trim()) {
      insertMsg.run(ticketId, userId, initialMessage.trim());
    }
    return ticketId;
  });

  const ticketId = tx();
  db.close();
  return ticketId;
}

function getSupportTicketsByUser(userId) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT t.*, 
            (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS message_count,
            (SELECT m.body FROM support_ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
            (SELECT m.created_at FROM support_ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at
     FROM support_tickets t
     WHERE t.user_id = ?
     ORDER BY t.updated_at DESC`
  ).all(userId);
  db.close();
  return rows;
}

function getSupportTicketById(ticketId) {
  const db = getDb();
  const row = db.prepare(
    `SELECT t.*, COALESCE(u.username, 'User #' || t.user_id) AS username, u.avatar_path AS user_avatar, u.display_name, u.school_id, u.school, u.district
     FROM support_tickets t
     LEFT JOIN users u ON t.user_id = u.id
     WHERE t.id = ?`
  ).get(ticketId);
  db.close();
  return row;
}

function getAllSupportTickets(statusFilter = 'all') {
  const db = getDb();
  let query = `
    SELECT t.*, COALESCE(u.username, 'User #' || t.user_id) AS username, u.avatar_path AS user_avatar, u.display_name,
           (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS message_count,
           (SELECT m.created_at FROM support_ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at
    FROM support_tickets t
    LEFT JOIN users u ON t.user_id = u.id
  `;
  const params = [];
  if (statusFilter && statusFilter !== 'all') {
    query += ` WHERE t.status = ?`;
    params.push(statusFilter);
  }
  query += ` ORDER BY 
    CASE 
      WHEN t.status = 'open' THEN 1 
      WHEN t.status = 'in_progress' THEN 2 
      WHEN t.status = 'waiting_on_user' THEN 3 
      WHEN t.status = 'resolved' THEN 4 
      ELSE 5 
    END,
    t.updated_at DESC`;
  const rows = db.prepare(query).all(...params);
  db.close();
  return rows;
}

function getSupportTicketMessages(ticketId) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT m.*, COALESCE(u.username, 'User #' || m.sender_id) AS username, u.avatar_path, u.display_name
     FROM support_ticket_messages m
     LEFT JOIN users u ON m.sender_id = u.id
     WHERE m.ticket_id = ?
     ORDER BY m.created_at ASC`
  ).all(ticketId);
  db.close();
  return rows;
}

function addSupportTicketMessage(ticketId, senderId, isStaff, body) {
  const db = getDb();
  const insertStmt = db.prepare(
    `INSERT INTO support_ticket_messages (ticket_id, sender_id, is_staff, body, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  );
  
  let newStatusUpdate = `updated_at = datetime('now')`;
  if (isStaff) {
    newStatusUpdate += `, status = CASE WHEN status = 'open' THEN 'in_progress' WHEN status = 'waiting_on_user' THEN 'waiting_on_user' ELSE status END`;
  } else {
    newStatusUpdate += `, status = CASE WHEN status = 'waiting_on_user' THEN 'in_progress' ELSE status END`;
  }

  const tx = db.transaction(() => {
    const res = insertStmt.run(ticketId, senderId, isStaff ? 1 : 0, body);
    db.prepare(`UPDATE support_tickets SET ${newStatusUpdate} WHERE id = ?`).run(ticketId);
    return res.lastInsertRowid;
  });

  const msgId = tx();
  db.close();
  return msgId;
}

function updateSupportTicketStatus(ticketId, status) {
  const db = getDb();
  let stmt;
  if (status === 'resolved' || status === 'closed') {
    stmt = db.prepare(
      `UPDATE support_tickets SET status = ?, updated_at = datetime('now'), resolved_at = datetime('now') WHERE id = ?`
    );
  } else {
    stmt = db.prepare(
      `UPDATE support_tickets SET status = ?, updated_at = datetime('now'), resolved_at = NULL WHERE id = ?`
    );
  }
  stmt.run(status, ticketId);
  db.close();
}

function getSupportStats() {
  const db = getDb();
  const rows = db.prepare(`SELECT status, COUNT(*) AS cnt FROM support_tickets GROUP BY status`).all();
  db.close();
  const stats = {
    total: 0,
    open: 0,
    in_progress: 0,
    waiting_on_user: 0,
    resolved: 0,
    closed: 0,
  };
  for (const r of rows) {
    stats.total += r.cnt;
    if (stats[r.status] !== undefined) {
      stats[r.status] = r.cnt;
    }
  }
  return stats;
}

function seedDefaultChatrooms() {
  const database = getDb();
  const defaults = ['Chatroom 1', 'Chatroom 2', 'Chatroom 3'];
  for (const name of defaults) {
    const existing = database.prepare("SELECT id FROM chatrooms WHERE name = ? AND type = 'public'").get(name);
    if (!existing) {
      database.prepare("INSERT INTO chatrooms (name, type, created_by) VALUES (?, 'public', NULL)").run(name);
    }
  }
  database.close();
}

function getPublicChatrooms() {
  const database = getDb();
  const rows = database.prepare(`
    SELECT c.id, c.name, c.type, c.created_at,
           (SELECT COUNT(*) FROM chatroom_messages m WHERE m.chatroom_id = c.id) AS message_count,
           (SELECT body FROM chatroom_messages m WHERE m.chatroom_id = c.id ORDER BY id DESC LIMIT 1) AS last_body,
           (SELECT created_at FROM chatroom_messages m WHERE m.chatroom_id = c.id ORDER BY id DESC LIMIT 1) AS last_at
    FROM chatrooms c
    WHERE c.type = 'public'
    ORDER BY c.id ASC
  `).all();
  database.close();
  return rows;
}

function getUserPrivateChatrooms(userId) {
  const database = getDb();
  const rows = database.prepare(`
    SELECT c.id, c.name, c.type, c.created_by, c.created_at,
           (SELECT COUNT(*) FROM chatroom_members cm WHERE cm.chatroom_id = c.id) AS member_count,
           (SELECT body FROM chatroom_messages m WHERE m.chatroom_id = c.id ORDER BY id DESC LIMIT 1) AS last_body,
           (SELECT created_at FROM chatroom_messages m WHERE m.chatroom_id = c.id ORDER BY id DESC LIMIT 1) AS last_at
    FROM chatrooms c
    JOIN chatroom_members cm ON c.id = cm.chatroom_id
    WHERE cm.user_id = ? AND c.type = 'private'
    ORDER BY COALESCE(last_at, c.created_at) DESC
  `).all(userId);
  database.close();
  return rows;
}

function getChatroomById(id) {
  const database = getDb();
  const row = database.prepare(`
    SELECT c.id, c.name, c.type, c.created_by, c.created_at,
           u.username AS creator_username, u.display_name AS creator_display_name
    FROM chatrooms c
    LEFT JOIN users u ON c.created_by = u.id
    WHERE c.id = ?
  `).get(id);
  database.close();
  return row;
}

function createChatroom(name, type = 'public', createdBy = null) {
  const database = getDb();
  const result = database.prepare(
    'INSERT INTO chatrooms (name, type, created_by) VALUES (?, ?, ?)'
  ).run((name || '').trim() || (type === 'private' ? 'Group Chatroom' : 'Chatroom'), type, createdBy || null);
  const roomId = result.lastInsertRowid;
  if (type === 'private' && createdBy) {
    database.prepare(
      "INSERT OR IGNORE INTO chatroom_members (chatroom_id, user_id, role) VALUES (?, ?, 'owner')"
    ).run(roomId, createdBy);
  }
  database.close();
  return roomId;
}

function renameChatroom(id, newName) {
  const database = getDb();
  database.prepare('UPDATE chatrooms SET name = ? WHERE id = ?').run(newName.trim(), id);
  database.close();
  return true;
}

function deleteChatroom(id) {
  const database = getDb();
  database.prepare('DELETE FROM chatrooms WHERE id = ?').run(id);
  database.prepare('DELETE FROM chatroom_members WHERE chatroom_id = ?').run(id);
  database.prepare('DELETE FROM chatroom_messages WHERE chatroom_id = ?').run(id);
  database.close();
  return true;
}

function clearChatroomMessages(id) {
  const database = getDb();
  database.prepare('DELETE FROM chatroom_messages WHERE chatroom_id = ?').run(id);
  database.close();
  return true;
}

function addChatroomMember(chatroomId, userId, role = 'member') {
  const database = getDb();
  database.prepare(
    'INSERT OR IGNORE INTO chatroom_members (chatroom_id, user_id, role) VALUES (?, ?, ?)'
  ).run(chatroomId, userId, role);
  database.close();
  return true;
}

function removeChatroomMember(chatroomId, userId) {
  const database = getDb();
  database.prepare(
    'DELETE FROM chatroom_members WHERE chatroom_id = ? AND user_id = ?'
  ).run(chatroomId, userId);
  database.close();
  return true;
}

function getChatroomMembers(chatroomId) {
  const database = getDb();
  const rows = database.prepare(`
    SELECT cm.chatroom_id, cm.user_id, cm.role, cm.joined_at,
           u.username, u.display_name, u.avatar_path
    FROM chatroom_members cm
    JOIN users u ON cm.user_id = u.id
    WHERE cm.chatroom_id = ?
    ORDER BY CASE WHEN cm.role = 'owner' THEN 0 ELSE 1 END, u.username ASC
  `).all(chatroomId);
  database.close();
  return rows;
}

function isUserInChatroom(chatroomId, userId) {
  const database = getDb();
  const room = database.prepare('SELECT type FROM chatrooms WHERE id = ?').get(chatroomId);
  if (!room) {
    database.close();
    return false;
  }
  if (room.type === 'public') {
    database.close();
    return true;
  }
  const member = database.prepare('SELECT 1 FROM chatroom_members WHERE chatroom_id = ? AND user_id = ?').get(chatroomId, userId);
  database.close();
  return !!member;
}

function getChatroomMessages(chatroomId, limit = 50, beforeId = null) {
  const database = getDb();
  let query, params;
  if (beforeId) {
    query = `SELECT * FROM (
      SELECT m.id, m.chatroom_id, m.sender_id, m.body, m.reply_to_message_id, m.image_path, m.file_path, m.video_path, m.created_at,
             u.username AS sender_username, u.display_name AS sender_display_name, u.avatar_path AS sender_avatar
      FROM chatroom_messages m JOIN users u ON m.sender_id = u.id
      WHERE m.chatroom_id = ? AND m.id < ?
      ORDER BY m.id DESC LIMIT ?
    ) sub ORDER BY sub.id ASC`;
    params = [chatroomId, beforeId, limit];
  } else {
    query = `SELECT * FROM (
      SELECT m.id, m.chatroom_id, m.sender_id, m.body, m.reply_to_message_id, m.image_path, m.file_path, m.video_path, m.created_at,
             u.username AS sender_username, u.display_name AS sender_display_name, u.avatar_path AS sender_avatar
      FROM chatroom_messages m JOIN users u ON m.sender_id = u.id
      WHERE m.chatroom_id = ?
      ORDER BY m.id DESC LIMIT ?
    ) sub ORDER BY sub.id ASC`;
    params = [chatroomId, limit];
  }
  const rows = database.prepare(query).all(...params);
  database.close();
  return rows;
}

function hasOlderChatroomMessages(chatroomId, oldestId) {
  if (!oldestId) return false;
  const database = getDb();
  const row = database.prepare(
    'SELECT 1 FROM chatroom_messages WHERE chatroom_id = ? AND id < ? LIMIT 1'
  ).get(chatroomId, oldestId);
  database.close();
  return !!row;
}

function sendChatroomMessage(chatroomId, senderId, body, replyToId = null, imagePath = null, filePath = null, videoPath = null) {
  const database = getDb();
  const bodyTrim = (body || '').trim();
  if (!bodyTrim && !imagePath && !filePath && !videoPath) {
    database.close();
    return null;
  }
  const result = database.prepare(`
    INSERT INTO chatroom_messages (chatroom_id, sender_id, body, reply_to_message_id, image_path, file_path, video_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(chatroomId, senderId, bodyTrim || '', replyToId || null, imagePath || null, filePath || null, videoPath || null);
  const msgId = result.lastInsertRowid;
  database.close();
  return msgId;
}

function deleteChatroomMessage(messageId, userId, isStaff = false) {
  const database = getDb();
  const msg = database.prepare('SELECT sender_id FROM chatroom_messages WHERE id = ?').get(messageId);
  if (!msg) {
    database.close();
    return false;
  }
  if (!isStaff && msg.sender_id !== userId) {
    database.close();
    return false;
  }
  database.prepare('DELETE FROM chatroom_messages WHERE id = ?').run(messageId);
  database.close();
  return true;
}

function getChatroomMessageWithDetails(id) {
  const database = getDb();
  const row = database.prepare(`
    SELECT m.id, m.chatroom_id, m.sender_id, m.body, m.reply_to_message_id, m.image_path, m.file_path, m.video_path, m.created_at,
           u.username AS sender_username, u.display_name AS sender_display_name, u.avatar_path AS sender_avatar
    FROM chatroom_messages m JOIN users u ON m.sender_id = u.id
    WHERE m.id = ?
  `).get(id);
  database.close();
  return row;
}

function timeoutUser(userId, durationMinutes, reason = null) {
  const database = getDb();
  const mins = Math.max(1, Number(durationMinutes) || 15);
  const until = new Date(Date.now() + mins * 60 * 1000).toISOString();
  database
    .prepare('UPDATE users SET timeout_until = ?, timeout_reason = ? WHERE id = ?')
    .run(until, (reason || '').trim() || null, userId);
  database.close();
  return until;
}

function clearUserTimeout(userId) {
  const database = getDb();
  database
    .prepare('UPDATE users SET timeout_until = NULL, timeout_reason = NULL WHERE id = ?')
    .run(userId);
  database.close();
  return true;
}

function banUser(userId, reason = null) {
  const database = getDb();
  database
    .prepare("UPDATE users SET is_banned = 1, ban_reason = ?, banned_at = datetime('now') WHERE id = ?")
    .run((reason || '').trim() || null, userId);
  database.close();
  return true;
}

function unbanUser(userId) {
  const database = getDb();
  database
    .prepare('UPDATE users SET is_banned = 0, ban_reason = NULL, banned_at = NULL WHERE id = ?')
    .run(userId);
  database.close();
  return true;
}

function isUserTimedOut(user) {
  if (!user || !user.timeout_until) return false;
  return new Date(user.timeout_until).getTime() > Date.now();
}

function isUserBanned(user) {
  return !!(user && user.is_banned);
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
  hasOlderMessagesWithUser,
  getMessageById,
  getMessageWithDetails,
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
  hasSeenWhatsNew,
  markSeenWhatsNew,
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
  createSupportTicket,
  getSupportTicketsByUser,
  getSupportTicketById,
  getAllSupportTickets,
  getSupportTicketMessages,
  addSupportTicketMessage,
  updateSupportTicketStatus,
  getSupportStats,
  getPublicChatrooms,
  getUserPrivateChatrooms,
  getChatroomById,
  createChatroom,
  renameChatroom,
  deleteChatroom,
  clearChatroomMessages,
  addChatroomMember,
  removeChatroomMember,
  getChatroomMembers,
  isUserInChatroom,
  getChatroomMessages,
  hasOlderChatroomMessages,
  sendChatroomMessage,
  deleteChatroomMessage,
  getChatroomMessageWithDetails,
  staffUpdateUser,
  updateUsername,
  timeoutUser,
  clearUserTimeout,
  banUser,
  unbanUser,
  isUserTimedOut,
  isUserBanned,
  setUserAccentColor,
  logModeratorAction,
  getModeratorAuditLogs,
  getModeratorAuditLogCount,
};
