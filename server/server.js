const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const appDirectory = path.resolve(__dirname, '..');
const envFilePath = path.join(appDirectory, '.env');
if (fs.existsSync(envFilePath)) {
  for (const line of fs.readFileSync(envFilePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) {
      continue;
    }
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const webDirectory = path.join(appDirectory, 'www');
const databasePath = process.env.SFF_DATABASE_PATH || path.join(appDirectory, 'data', 'sff-members.sqlite');
const port = Number(process.env.PORT || process.env.SFF_PORT || 8080);
const host = process.env.SFF_HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const defaultTeams = ['Team Legal', 'Team Odada 27', 'Team Tom', 'Team Koroma'];
const allowedPositions = new Set(['Attacker', 'Midfielder', 'Defender', 'Goalkeeper']);
const supportedMatchTypes = new Set(['Full Field Competition', 'Six aside Competition']);
const allowedPaymentMethods = new Set(['Cash']);
const allowedOrigins = new Set((process.env.SFF_ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean));
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.manifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    membership_id TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    phone TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    team_name TEXT NOT NULL,
    coach_name TEXT NOT NULL,
    coach_membership_id TEXT NOT NULL,
    coach_phone TEXT NOT NULL,
    coach_email TEXT NOT NULL COLLATE NOCASE,
    shirt_number TEXT NOT NULL,
    position TEXT NOT NULL,
    match_type TEXT NOT NULL,
    entry_fee REAL NOT NULL,
    payment_method TEXT NOT NULL,
    photo_mime TEXT,
    photo_data BLOB,
    approval_status TEXT NOT NULL DEFAULT 'pending'
      CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('member', 'admin')),
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS team_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_name TEXT NOT NULL,
    coach_name TEXT NOT NULL,
    coach_membership_id TEXT NOT NULL,
    coach_phone TEXT NOT NULL,
    coach_email TEXT NOT NULL,
    match_type TEXT NOT NULL,
    entry_fee REAL NOT NULL,
    payment_method TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS competition_details (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    date_schedule TEXT NOT NULL,
    venue TEXT NOT NULL,
    match_formats TEXT NOT NULL,
    points_system TEXT NOT NULL,
    announcements TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);
const memberColumns = new Set(database.prepare('PRAGMA table_info(members)').all().map((column) => column.name));
if (!memberColumns.has('photo_mime')) {
  database.exec('ALTER TABLE members ADD COLUMN photo_mime TEXT');
}
if (!memberColumns.has('photo_data')) {
  database.exec('ALTER TABLE members ADD COLUMN photo_data BLOB');
}
if (!memberColumns.has('team_registration_id')) {
  database.exec('ALTER TABLE members ADD COLUMN team_registration_id INTEGER');
}
const seedTeam = database.prepare('INSERT OR IGNORE INTO teams (name, created_at) VALUES (?, ?)');
for (const teamName of defaultTeams) {
  seedTeam.run(teamName, new Date().toISOString());
}
database.prepare(`
  INSERT OR IGNORE INTO competition_details (
    id, title, description, date_schedule, venue, match_formats, points_system, announcements, updated_at
  ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  'Saturday Football Family Gala',
  'Match results and player statistics entered by the organizers appear in the standings below.',
  '',
  '',
  JSON.stringify([...supportedMatchTypes]),
  'Win 3 · Draw 1 · Loss 0',
  '',
  new Date().toISOString(),
);

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  response.end(JSON.stringify(value));
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) {
      return ['', ''];
    }
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([key]) => key));
}

function cookieHeader(name, value, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure; SameSite=None' : '; SameSite=Lax';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Max-Age=${maxAge}${secure}`;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createSession(memberId, role) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionLifetimeMs).toISOString();
  database.prepare(
    'INSERT INTO sessions (token_hash, member_id, role, expires_at) VALUES (?, ?, ?, ?)',
  ).run(hashToken(token), memberId, role, expiresAt);
  return token;
}

function readSession(request) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies.sff_session;
  if (!token) {
    return null;
  }
  const session = database.prepare(`
    SELECT sessions.role, members.id AS member_id, members.membership_id, members.full_name,
      members.email, members.approval_status, members.photo_mime
    FROM sessions
    LEFT JOIN members ON members.id = sessions.member_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashToken(token), new Date().toISOString());
  if (!session) {
    database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    return null;
  }
  return session;
}

function requireMember(request, response, approvedOnly = false) {
  const session = readSession(request);
  if (!session || session.role !== 'member') {
    sendJson(response, 401, { error: 'Sign in to continue.' });
    return null;
  }
  if (approvedOnly && session.approval_status !== 'approved') {
    sendJson(response, 403, {
      error: session.approval_status === 'rejected'
        ? 'This registration was not approved.'
        : 'Your registration is awaiting organizer approval.',
      status: session.approval_status,
    });
    return null;
  }
  return session;
}

function requireAdmin(request, response) {
  const session = readSession(request);
  if (!session || session.role !== 'admin') {
    sendJson(response, 401, { error: 'Organizer sign-in is required.' });
    return null;
  }
  return session;
}

function isAllowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) {
    return process.env.NODE_ENV !== 'production' || request.headers['sec-fetch-site'] === 'same-origin';
  }
  const hostOrigin = `${request.headers['x-forwarded-proto'] || 'http'}://${request.headers.host}`;
  return origin === hostOrigin || allowedOrigins.has(origin);
}

function setCorsHeaders(request, response) {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Vary', 'Origin');
  }
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 16 * 1024 * 1024) {
      const error = new Error('Request body is too large. Reduce the number or size of player photos.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.status = 400;
    throw error;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error('Request body must be a JSON object.');
    error.status = 400;
    throw error;
  }
  return value;
}

function requireText(value, label, maxLength = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    const error = new Error(`${label} is required and must be no longer than ${maxLength} characters.`);
    error.status = 400;
    throw error;
  }
  return value.trim();
}

function optionalText(value, label, maxLength = 200) {
  if (typeof value !== 'string' || value.trim().length > maxLength) {
    const error = new Error(`${label} must be no longer than ${maxLength} characters.`);
    error.status = 400;
    throw error;
  }
  return value.trim();
}

function readCompetitionDetails() {
  const row = database.prepare('SELECT * FROM competition_details WHERE id = 1').get();
  return {
    title: row.title,
    description: row.description,
    dateSchedule: row.date_schedule,
    venue: row.venue,
    matchFormats: JSON.parse(row.match_formats),
    pointsSystem: row.points_system,
    announcements: row.announcements,
    updatedAt: row.updated_at,
  };
}

function activeTeamExists(teamName) {
  return Boolean(database.prepare('SELECT 1 FROM teams WHERE name = ? AND is_active = 1').get(teamName));
}

function validateRegistration(value, maxPhotoBytes = 2 * 1024 * 1024) {
  const fullName = requireText(value.fullName, 'Player name');
  const email = requireText(value.email, 'Email', 254).toLowerCase();
  const phone = requireText(value.phone, 'Phone number', 40);
  const password = requireText(value.password, 'Password', 200);
  const teamName = requireText(value.teamName, 'Team');
  const coachName = requireText(value.coachName, 'Coach/coordinator name');
  const coachMembershipId = requireText(value.coachMembershipId, 'Coach SFF membership ID', 32).toUpperCase();
  const coachPhone = requireText(value.coachPhone, 'Coach phone', 40);
  const coachEmail = requireText(value.coachEmail, 'Coach email', 254).toLowerCase();
  const shirtNumber = requireText(value.shirtNumber, 'Shirt number', 3);
  const position = requireText(value.position, 'Player position');
  const matchType = requireText(value.matchType, 'Match type');
  const paymentMethod = requireText(value.paymentMethod, 'Payment method');
  const entryFee = Number(value.entryFee);
  let photoMime = null;
  let photoData = null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(coachEmail)) {
    const error = new Error('Enter valid player and coach email addresses.');
    error.status = 400;
    throw error;
  }
  if (password.length < 10) {
    const error = new Error('Password must be at least 10 characters long.');
    error.status = 400;
    throw error;
  }
  if (!activeTeamExists(teamName)) {
    const error = new Error('Choose a valid SFF team.');
    error.status = 400;
    throw error;
  }
  if (!/^SFF\/[0-9]+$/.test(coachMembershipId)) {
    const error = new Error('Enter the coach’s SFF membership ID in the format SFF/0002.');
    error.status = 400;
    throw error;
  }
  if (!/^[0-9]{1,3}$/.test(shirtNumber)) {
    const error = new Error('Shirt number must contain 1 to 3 digits.');
    error.status = 400;
    throw error;
  }
  if (!allowedPositions.has(position)) {
    const error = new Error('Choose a valid player position.');
    error.status = 400;
    throw error;
  }
  if (!readCompetitionDetails().matchFormats.includes(matchType)) {
    const error = new Error('Choose a valid Gala match type.');
    error.status = 400;
    throw error;
  }
  if (!allowedPaymentMethods.has(paymentMethod)) {
    const error = new Error('Choose a valid payment method.');
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(entryFee) || entryFee < 0 || entryFee > 100000000) {
    const error = new Error('Enter a valid entry fee.');
    error.status = 400;
    throw error;
  }
  if (value.photoDataUrl) {
    const photoMatch = typeof value.photoDataUrl === 'string'
      ? value.photoDataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
      : null;
    if (!photoMatch) {
      const error = new Error('Upload a JPEG, PNG or WebP player photo.');
      error.status = 400;
      throw error;
    }
    photoMime = photoMatch[1];
    photoData = Buffer.from(photoMatch[2], 'base64');
    const validSignature = photoMime === 'image/jpeg'
      ? photoData[0] === 0xff && photoData[1] === 0xd8 && photoData[2] === 0xff
      : photoMime === 'image/png'
        ? photoData.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        : photoData.subarray(0, 4).toString('ascii') === 'RIFF'
          && photoData.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!photoData.length || photoData.length > maxPhotoBytes || !validSignature) {
      const error = new Error(`Player photo must be a valid JPEG, PNG or WebP smaller than ${Math.floor(maxPhotoBytes / 1024)} KB.`);
      error.status = 400;
      throw error;
    }
  }

  return {
    fullName,
    email,
    phone,
    password,
    teamName,
    coachName,
    coachMembershipId,
    coachPhone,
    coachEmail,
    shirtNumber,
    position,
    matchType,
    entryFee,
    paymentMethod,
    photoMime,
    photoData,
  };
}

function validateTeamRegistration(value) {
  if (!Array.isArray(value.players) || value.players.length < 1 || value.players.length > 20) {
    const error = new Error('A team registration must include between 1 and 20 players.');
    error.status = 400;
    throw error;
  }
  const common = {
    teamName: value.teamName,
    coachName: value.coachName,
    coachMembershipId: value.coachMembershipId,
    coachPhone: value.coachPhone,
    coachEmail: value.coachEmail,
    matchType: value.matchType,
    entryFee: value.entryFee,
    paymentMethod: value.paymentMethod,
  };
  const players = value.players.map((player) => validateRegistration({
    ...player,
    ...common,
  }, 512 * 1024));
  const playerEmails = new Set(players.map((player) => player.email));
  if (playerEmails.size !== players.length) {
    const error = new Error('Each player must use a different email address.');
    error.status = 400;
    throw error;
  }
  const firstPlayer = players[0];
  return {
    ...common,
    teamName: firstPlayer.teamName,
    coachName: firstPlayer.coachName,
    coachMembershipId: firstPlayer.coachMembershipId,
    coachPhone: firstPlayer.coachPhone,
    coachEmail: firstPlayer.coachEmail,
    matchType: firstPlayer.matchType,
    entryFee: firstPlayer.entryFee,
    paymentMethod: firstPlayer.paymentMethod,
    players,
  };
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

function passwordMatches(password, saltHex, hashHex) {
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function generateMembershipId() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const value = `SFF/${crypto.randomInt(100000000, 1000000000)}`;
    if (!database.prepare('SELECT 1 FROM members WHERE membership_id = ?').get(value)) {
      return value;
    }
  }
  throw new Error('Could not generate a unique SFF membership ID.');
}

function serveStatic(request, response, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const resolvedPath = path.resolve(webDirectory, `.${requestedPath}`);
  if (!resolvedPath.startsWith(`${webDirectory}${path.sep}`) && resolvedPath !== webDirectory) {
    sendJson(response, 400, { error: 'Invalid path.' });
    return;
  }
  fs.stat(resolvedPath, (error, stats) => {
    if (error || !stats.isFile()) {
      sendJson(response, 404, { error: 'Page not found. Run npm run build:web first.' });
      return;
    }
    response.writeHead(200, {
      'Cache-Control': path.basename(resolvedPath) === 'index.html' ? 'no-cache' : 'public, max-age=3600',
      'Content-Length': stats.size,
      'Content-Type': mimeTypes[path.extname(resolvedPath)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(resolvedPath).pipe(response);
  });
}

async function handleApi(request, response, url) {
  if (!isAllowedOrigin(request)) {
    sendJson(response, 403, { error: 'This app origin is not allowed.' });
    return;
  }
  setCorsHeaders(request, response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Max-Age': '600',
    });
    response.end();
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/registration-options') {
    const teams = database.prepare('SELECT name FROM teams WHERE is_active = 1 ORDER BY name').all()
      .map((team) => team.name);
    sendJson(response, 200, {
      teams,
      matchTypes: readCompetitionDetails().matchFormats,
      maxPlayers: 20,
      maxPhotoBytes: 512 * 1024,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/register/team') {
    const input = validateTeamRegistration(await readJson(request));
    const existing = input.players.find((player) =>
      Boolean(database.prepare('SELECT 1 FROM members WHERE email = ?').get(player.email))
    );
    if (existing) {
      sendJson(response, 409, { error: `An account already exists for ${existing.email}. Each player needs a unique email.` });
      return;
    }

    const createdAt = new Date().toISOString();
    const registrations = [];
    database.exec('BEGIN IMMEDIATE');
    try {
      const teamRegistrationResult = database.prepare(`
        INSERT INTO team_registrations (
          team_name, coach_name, coach_membership_id, coach_phone, coach_email,
          match_type, entry_fee, payment_method, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.teamName,
        input.coachName,
        input.coachMembershipId,
        input.coachPhone,
        input.coachEmail,
        input.matchType,
        Number(input.entryFee),
        input.paymentMethod,
        createdAt,
      );
      const teamRegistrationId = Number(teamRegistrationResult.lastInsertRowid);
      const insertMember = database.prepare(`
        INSERT INTO members (
          membership_id, full_name, email, phone, password_salt, password_hash,
          team_name, coach_name, coach_membership_id, coach_phone, coach_email,
          shirt_number, position, match_type, entry_fee, payment_method,
          photo_mime, photo_data, created_at, team_registration_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const player of input.players) {
        const { salt, hash } = createPasswordHash(player.password);
        const membershipId = generateMembershipId();
        insertMember.run(
          membershipId, player.fullName, player.email, player.phone, salt, hash,
          input.teamName, input.coachName, input.coachMembershipId, input.coachPhone, input.coachEmail,
          player.shirtNumber, player.position, input.matchType, Number(input.entryFee), input.paymentMethod,
          player.photoMime, player.photoData, createdAt, teamRegistrationId,
        );
        registrations.push({
          membershipId,
          fullName: player.fullName,
          email: player.email,
          approvalStatus: 'pending',
        });
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      if (String(error.code).includes('CONSTRAINT_UNIQUE')) {
        sendJson(response, 409, { error: 'An account already exists for one of these email addresses.' });
        return;
      }
      throw error;
    }
    sendJson(response, 201, {
      registrations,
      message: `${registrations.length} player account${registrations.length === 1 ? '' : 's'} created and awaiting individual organizer approval.`,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/register') {
    const input = validateRegistration(await readJson(request));
    const existing = database.prepare('SELECT id FROM members WHERE email = ?').get(input.email);
    if (existing) {
      sendJson(response, 409, { error: 'An account already exists for this email. Sign in instead.' });
      return;
    }

    const { salt, hash } = createPasswordHash(input.password);
    const membershipId = generateMembershipId();
    const createdAt = new Date().toISOString();
    let result;
    try {
      result = database.prepare(`
        INSERT INTO members (
          membership_id, full_name, email, phone, password_salt, password_hash,
          team_name, coach_name, coach_membership_id, coach_phone, coach_email,
          shirt_number, position, match_type, entry_fee,           payment_method, photo_mime, photo_data, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        membershipId, input.fullName, input.email, input.phone, salt, hash,
        input.teamName, input.coachName, input.coachMembershipId, input.coachPhone, input.coachEmail,
        input.shirtNumber, input.position, input.matchType, input.entryFee, input.paymentMethod,
        input.photoMime, input.photoData, createdAt,
      );
    } catch (error) {
      if (String(error.code).includes('CONSTRAINT_UNIQUE')) {
        sendJson(response, 409, { error: 'An account already exists for this email. Sign in instead.' });
        return;
      }
      throw error;
    }
    const token = createSession(Number(result.lastInsertRowid), 'member');
    sendJson(response, 201, {
      member: {
        membershipId,
        fullName: input.fullName,
        email: input.email,
        approvalStatus: 'pending',
        photoAvailable: Boolean(input.photoData),
      },
      message: 'Registration received and awaiting organizer approval.',
    }, { 'Set-Cookie': cookieHeader('sff_session', token, Math.floor(sessionLifetimeMs / 1000)) });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/login') {
    const input = await readJson(request);
    const email = requireText(input.email, 'Email', 254).toLowerCase();
    const password = requireText(input.password, 'Password', 200);
    const member = database.prepare(`
      SELECT id, membership_id, full_name, email, password_salt, password_hash, approval_status
      FROM members WHERE email = ?
    `).get(email);
    if (!member || !passwordMatches(password, member.password_salt, member.password_hash)) {
      sendJson(response, 401, { error: 'Email or password is incorrect.' });
      return;
    }
    const token = createSession(member.id, 'member');
    sendJson(response, 200, {
      member: {
        membershipId: member.membership_id,
        fullName: member.full_name,
        email: member.email,
        approvalStatus: member.approval_status,
      },
    }, { 'Set-Cookie': cookieHeader('sff_session', token, Math.floor(sessionLifetimeMs / 1000)) });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/session') {
    const session = readSession(request);
    if (!session || session.role !== 'member') {
      sendJson(response, 401, { error: 'No member is signed in.' });
      return;
    }
    sendJson(response, 200, {
      member: {
        membershipId: session.membership_id,
        fullName: session.full_name,
        email: session.email,
        approvalStatus: session.approval_status,
        photoAvailable: Boolean(session.photo_mime),
      },
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/profile/photo') {
    const session = requireMember(request, response);
    if (!session) {
      return;
    }
    const photo = database.prepare('SELECT photo_mime, photo_data FROM members WHERE id = ?').get(session.member_id);
    if (!photo || !photo.photo_data) {
      sendJson(response, 404, { error: 'No profile photo is available.' });
      return;
    }
    response.writeHead(200, {
      'Cache-Control': 'private, no-store',
      'Content-Length': photo.photo_data.length,
      'Content-Type': photo.photo_mime,
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(photo.photo_data);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/logout') {
    const token = parseCookies(request.headers.cookie).sff_session;
    if (token) {
      database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    }
    sendJson(response, 200, { ok: true }, { 'Set-Cookie': cookieHeader('sff_session', '', 0) });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/login') {
    if (!process.env.SFF_ADMIN_PASSWORD) {
      sendJson(response, 503, { error: 'Organizer sign-in is not configured on the server.' });
      return;
    }
    const input = await readJson(request);
    const password = requireText(input.password, 'Organizer password', 200);
    const expected = Buffer.from(process.env.SFF_ADMIN_PASSWORD);
    const actual = Buffer.from(password);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      sendJson(response, 401, { error: 'Organizer password is incorrect.' });
      return;
    }
    const token = createSession(null, 'admin');
    sendJson(response, 200, { ok: true }, { 'Set-Cookie': cookieHeader('sff_session', token, Math.floor(sessionLifetimeMs / 1000)) });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/logout') {
    const token = parseCookies(request.headers.cookie).sff_session;
    if (token) {
      database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    }
    sendJson(response, 200, { ok: true }, { 'Set-Cookie': cookieHeader('sff_session', '', 0) });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/teams') {
    if (!requireAdmin(request, response)) {
      return;
    }
    const teams = database.prepare('SELECT id, name, is_active AS isActive FROM teams ORDER BY name').all();
    sendJson(response, 200, { teams });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/teams') {
    if (!requireAdmin(request, response)) {
      return;
    }
    const input = await readJson(request);
    const name = requireText(input.name, 'Team name', 60);
    try {
      const result = database.prepare('INSERT INTO teams (name, created_at) VALUES (?, ?)')
        .run(name, new Date().toISOString());
      sendJson(response, 201, { team: { id: Number(result.lastInsertRowid), name, isActive: 1 } });
    } catch (error) {
      if (String(error.code).includes('CONSTRAINT_UNIQUE')) {
        sendJson(response, 409, { error: 'A team with that name already exists.' });
        return;
      }
      throw error;
    }
    return;
  }

  const teamMatch = url.pathname.match(/^\/api\/admin\/teams\/(\d+)$/);
  if (request.method === 'PATCH' && teamMatch) {
    if (!requireAdmin(request, response)) {
      return;
    }
    const input = await readJson(request);
    const name = requireText(input.name, 'Team name', 60);
    if (typeof input.isActive !== 'boolean') {
      sendJson(response, 400, { error: 'Choose whether this team is active.' });
      return;
    }
    const teamId = Number(teamMatch[1]);
    const team = database.prepare('SELECT name FROM teams WHERE id = ?').get(teamId);
    if (!team) {
      sendJson(response, 404, { error: 'Team not found.' });
      return;
    }
    const duplicate = database.prepare('SELECT 1 FROM teams WHERE name = ? AND id != ?').get(name, teamId);
    if (duplicate) {
      sendJson(response, 409, { error: 'A team with that name already exists.' });
      return;
    }
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('UPDATE teams SET name = ?, is_active = ? WHERE id = ?')
        .run(name, input.isActive ? 1 : 0, teamId);
      if (team.name !== name) {
        database.prepare('UPDATE members SET team_name = ? WHERE team_name = ?').run(name, team.name);
        database.prepare('UPDATE team_registrations SET team_name = ? WHERE team_name = ?').run(name, team.name);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    sendJson(response, 200, { team: { id: teamId, name, isActive: input.isActive ? 1 : 0 } });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/competition-details') {
    if (!requireAdmin(request, response)) {
      return;
    }
    sendJson(response, 200, { competition: readCompetitionDetails() });
    return;
  }

  if (request.method === 'PATCH' && url.pathname === '/api/admin/competition-details') {
    if (!requireAdmin(request, response)) {
      return;
    }
    const input = await readJson(request);
    const title = requireText(input.title, 'Competition title', 120);
    const description = optionalText(input.description, 'Description', 1000);
    const dateSchedule = optionalText(input.dateSchedule, 'Date and schedule', 300);
    const venue = optionalText(input.venue, 'Venue', 200);
    const pointsSystem = optionalText(input.pointsSystem, 'Points system', 200);
    const announcements = optionalText(input.announcements, 'Announcements', 1000);
    if (
      !Array.isArray(input.matchFormats) ||
      input.matchFormats.length < 1 ||
      input.matchFormats.length > supportedMatchTypes.size ||
      input.matchFormats.some((format) => !supportedMatchTypes.has(format))
    ) {
      sendJson(response, 400, { error: 'Select at least one supported match format.' });
      return;
    }
    const matchFormats = [...new Set(input.matchFormats)];
    database.prepare(`
      UPDATE competition_details
      SET title = ?, description = ?, date_schedule = ?, venue = ?, match_formats = ?,
        points_system = ?, announcements = ?, updated_at = ?
      WHERE id = 1
    `).run(
      title,
      description,
      dateSchedule,
      venue,
      JSON.stringify(matchFormats),
      pointsSystem,
      announcements,
      new Date().toISOString(),
    );
    sendJson(response, 200, { competition: readCompetitionDetails() });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/competition-details') {
    if (!requireMember(request, response, true)) {
      return;
    }
    sendJson(response, 200, { competition: readCompetitionDetails() });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/registrations') {
    if (!requireAdmin(request, response)) {
      return;
    }
    const registrations = database.prepare(`
      SELECT id, membership_id AS membershipId, full_name AS fullName, email, phone,
        team_name AS teamName, shirt_number AS shirtNumber, position, match_type AS matchType,
        entry_fee AS entryFee, team_registration_id AS teamRegistrationId,
        approval_status AS approvalStatus, created_at AS createdAt
      FROM members ORDER BY created_at DESC
    `).all();
    sendJson(response, 200, { registrations });
    return;
  }

  const decisionMatch = url.pathname.match(/^\/api\/admin\/registrations\/(\d+)$/);
  if (request.method === 'PATCH' && decisionMatch) {
    if (!requireAdmin(request, response)) {
      return;
    }
    const input = await readJson(request);
    if (!['approved', 'rejected'].includes(input.approvalStatus)) {
      sendJson(response, 400, { error: 'Choose approved or rejected.' });
      return;
    }
    const result = database.prepare('UPDATE members SET approval_status = ? WHERE id = ?')
      .run(input.approvalStatus, Number(decisionMatch[1]));
    if (!result.changes) {
      sendJson(response, 404, { error: 'Registration not found.' });
      return;
    }
    sendJson(response, 200, { ok: true, approvalStatus: input.approvalStatus });
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/api/features/')) {
    if (!requireMember(request, response, true)) {
      return;
    }
    sendJson(response, 200, { allowed: true });
    return;
  }

  sendJson(response, 404, { error: 'API route not found.' });
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const work = url.pathname.startsWith('/api/')
    ? handleApi(request, response, url)
    : request.method === 'GET'
      ? serveStatic(request, response, url.pathname)
      : sendJson(response, 405, { error: 'Method not allowed.' });

  Promise.resolve(work).catch((error) => {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) {
      console.error('SFF API request failed.', error);
    }
    if (!response.headersSent) {
      sendJson(response, status, {
        error: status >= 500 ? 'The server could not complete the request.' : error.message,
      });
    } else {
      response.destroy(error);
    }
  });
});

server.listen(port, host, () => {
  console.log(`SFF app and approval API listening on ${host}:${port}`);
});

function close() {
  server.close();
  database.close();
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
