const express = require('express');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const DB_PATH = path.join(__dirname, 'data.sqlite');

app.use(cors({ credentials: true }));
app.use(express.json());
app.use(session({
  secret: 'point-system-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8시간
}));
app.use(express.static(path.join(__dirname, 'public')));

let db;

// ── 인증 미들웨어 ──
function requireAuth(req, res, next) {
  if (req.session && req.session.adminId) return next();
  res.status(401).json({ success: false, message: '로그인이 필요합니다.', code: 'UNAUTHORIZED' });
}

// ── DB 초기화 ──
async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_no TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS point_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('적립', '사용', '조정')),
      amount INTEGER NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (member_id) REFERENCES members(id)
    )
  `);

  saveDB();
  console.log('DB 초기화 완료');
}

function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// ════════════════════════════
//  AUTH API
// ════════════════════════════

// 로그인
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: '아이디와 비밀번호를 입력해주세요.' });

    const stmt = db.prepare('SELECT * FROM admins WHERE username = ?');
    stmt.bind([username]);
    if (!stmt.step()) {
      stmt.free();
      return res.status(401).json({ success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }
    const admin = stmt.getAsObject();
    stmt.free();

    const ok = await bcrypt.compare(password, admin.password);
    if (!ok)
      return res.status(401).json({ success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });

    req.session.adminId = admin.id;
    req.session.adminName = admin.username;
    res.json({ success: true, message: '로그인 성공', username: admin.username });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 로그아웃
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true, message: '로그아웃 되었습니다.' });
  });
});

// 세션 확인
app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.adminId) {
    res.json({ success: true, username: req.session.adminName });
  } else {
    res.status(401).json({ success: false, code: 'UNAUTHORIZED' });
  }
});

// 관리자 목록 조회
app.get('/api/admins', requireAuth, (req, res) => {
  try {
    const stmt = db.prepare('SELECT id, username, created_at FROM admins ORDER BY created_at ASC');
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 관리자 생성
app.post('/api/admins', requireAuth, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: '아이디와 비밀번호를 입력해주세요.' });
    if (password.length < 4)
      return res.status(400).json({ success: false, message: '비밀번호는 4자 이상이어야 합니다.' });

    const hashed = await bcrypt.hash(password, 10);
    db.run('INSERT INTO admins (username, password) VALUES (?, ?)', [username, hashed]);
    saveDB();
    res.json({ success: true, message: '관리자가 생성되었습니다.' });
  } catch (err) {
    if (err.message.includes('UNIQUE'))
      res.status(409).json({ success: false, message: '이미 존재하는 아이디입니다.' });
    else
      res.status(500).json({ success: false, message: err.message });
  }
});

// 관리자 비밀번호 변경
app.put('/api/admins/:id/password', requireAuth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 4)
      return res.status(400).json({ success: false, message: '비밀번호는 4자 이상이어야 합니다.' });

    const hashed = await bcrypt.hash(password, 10);
    db.run('UPDATE admins SET password = ? WHERE id = ?', [hashed, req.params.id]);
    saveDB();
    res.json({ success: true, message: '비밀번호가 변경되었습니다.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 관리자 삭제
app.delete('/api/admins/:id', requireAuth, (req, res) => {
  try {
    if (parseInt(req.params.id) === req.session.adminId)
      return res.status(400).json({ success: false, message: '현재 로그인된 계정은 삭제할 수 없습니다.' });

    const count = db.exec('SELECT COUNT(*) FROM admins')[0].values[0][0];
    if (count <= 1)
      return res.status(400).json({ success: false, message: '관리자 계정이 1개 이상 유지되어야 합니다.' });

    db.run('DELETE FROM admins WHERE id = ?', [req.params.id]);
    saveDB();
    res.json({ success: true, message: '관리자가 삭제되었습니다.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════
//  MEMBERS API (모두 인증 필요)
// ════════════════════════════

app.get('/api/members', requireAuth, (req, res) => {
  try {
    const { search } = req.query;
    let sql = 'SELECT * FROM members';
    const params = [];
    if (search) {
      sql += ' WHERE name LIKE ? OR member_no LIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }
    sql += ' ORDER BY created_at DESC';
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/members/:id', requireAuth, (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM members WHERE id = ?');
    stmt.bind([req.params.id]);
    if (stmt.step()) {
      const member = stmt.getAsObject();
      stmt.free();
      res.json({ success: true, data: member });
    } else {
      stmt.free();
      res.status(404).json({ success: false, message: '회원을 찾을 수 없습니다.' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/members', requireAuth, (req, res) => {
  try {
    const { member_no, name, points = 0 } = req.body;
    if (!member_no || !name)
      return res.status(400).json({ success: false, message: '회원번호와 이름은 필수입니다.' });

    db.run('INSERT INTO members (member_no, name, points) VALUES (?, ?, ?)', [member_no, name, points]);
    const lastId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];

    if (points > 0)
      db.run('INSERT INTO point_history (member_id, type, amount, note) VALUES (?, ?, ?, ?)',
        [lastId, '적립', points, '초기 포인트 지급']);

    saveDB();
    res.json({ success: true, message: '회원이 등록되었습니다.', id: lastId });
  } catch (err) {
    if (err.message.includes('UNIQUE'))
      res.status(409).json({ success: false, message: '이미 존재하는 회원번호입니다.' });
    else
      res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/members/:id', requireAuth, (req, res) => {
  try {
    const { member_no, name } = req.body;
    if (!member_no || !name)
      return res.status(400).json({ success: false, message: '회원번호와 이름은 필수입니다.' });

    db.run('UPDATE members SET member_no = ?, name = ? WHERE id = ?', [member_no, name, req.params.id]);
    saveDB();
    res.json({ success: true, message: '회원 정보가 수정되었습니다.' });
  } catch (err) {
    if (err.message.includes('UNIQUE'))
      res.status(409).json({ success: false, message: '이미 존재하는 회원번호입니다.' });
    else
      res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/members/:id', requireAuth, (req, res) => {
  try {
    db.run('DELETE FROM point_history WHERE member_id = ?', [req.params.id]);
    db.run('DELETE FROM members WHERE id = ?', [req.params.id]);
    saveDB();
    res.json({ success: true, message: '회원이 삭제되었습니다.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/members/:id/points', requireAuth, (req, res) => {
  try {
    const { type, amount, note } = req.body;
    if (!type || amount === undefined)
      return res.status(400).json({ success: false, message: '유형과 금액은 필수입니다.' });

    const stmt = db.prepare('SELECT * FROM members WHERE id = ?');
    stmt.bind([req.params.id]);
    if (!stmt.step()) {
      stmt.free();
      return res.status(404).json({ success: false, message: '회원을 찾을 수 없습니다.' });
    }
    const member = stmt.getAsObject();
    stmt.free();

    let newPoints = member.points;
    if (type === '적립') newPoints += Math.abs(amount);
    else if (type === '사용') newPoints -= Math.abs(amount);
    else if (type === '조정') newPoints = amount;

    if (newPoints < 0)
      return res.status(400).json({ success: false, message: '포인트가 부족합니다.' });

    db.run('UPDATE members SET points = ? WHERE id = ?', [newPoints, req.params.id]);
    db.run('INSERT INTO point_history (member_id, type, amount, note) VALUES (?, ?, ?, ?)',
      [req.params.id, type, amount, note || '']);

    saveDB();
    res.json({ success: true, message: '포인트가 변경되었습니다.', points: newPoints });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/members/:id/history', requireAuth, (req, res) => {
  try {
    const stmt = db.prepare(
      'SELECT * FROM point_history WHERE member_id = ? ORDER BY created_at DESC LIMIT 50'
    );
    stmt.bind([req.params.id]);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/stats', requireAuth, (req, res) => {
  try {
    const totalMembers = db.exec('SELECT COUNT(*) FROM members')[0].values[0][0];
    const totalPoints = db.exec('SELECT COALESCE(SUM(points), 0) FROM members')[0].values[0][0];
    const todayNew = db.exec(
      "SELECT COUNT(*) FROM members WHERE date(created_at) = date('now', 'localtime')"
    )[0].values[0][0];
    res.json({ success: true, data: { totalMembers, totalPoints, todayNew } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 최초 실행 시 기본 관리자 생성 ──
async function ensureDefaultAdmin() {
  const count = db.exec('SELECT COUNT(*) FROM admins')[0].values[0][0];
  if (count === 0) {
    const hashed = await bcrypt.hash('admin1234', 10);
    db.run("INSERT INTO admins (username, password) VALUES ('admin', ?)", [hashed]);
    saveDB();
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  기본 관리자 계정이 생성되었습니다.');
    console.log('  아이디    : admin');
    console.log('  비밀번호  : admin1234');
    console.log('  ⚠️  로그인 후 비밀번호를 변경하세요!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }
}

initDB().then(async () => {
  await ensureDefaultAdmin();
  app.listen(PORT, () => {
    console.log(`서버 실행 중: http://localhost:${PORT}`);
  });
});
