const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

async function reservePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(baseUrl, child, getLogs) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`SFF server exited before starting.\n${getLogs()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`SFF server did not start in time.\n${getLogs()}`);
}

function cookieFrom(response) {
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie, 'Expected the server to issue a session cookie.');
  return cookie.split(';', 1)[0];
}

async function requestJson(baseUrl, route, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (cookie) {
    headers.Cookie = cookie;
  }
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test('member access stays locked until an organizer approves registration', async (t) => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'sff-gala-test-'));
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      SFF_ADMIN_PASSWORD: 'test-organizer-password',
      SFF_DATABASE_PATH: path.join(temporaryDirectory, 'members.sqlite'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.setEncoding('utf8').on('data', (data) => { logs += data; });
  child.stderr.setEncoding('utf8').on('data', (data) => { logs += data; });

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  await waitForServer(baseUrl, child, () => logs);

  const registration = {
    fullName: 'Test Player',
    email: 'player@example.test',
    phone: '076123456',
    password: 'a-secure-test-password',
    teamName: 'Team Legal',
    coachName: 'Test Coach',
    coachMembershipId: 'SFF/0002',
    coachPhone: '076123456',
    coachEmail: 'coach@example.test',
    shirtNumber: '10',
    position: 'Attacker',
    matchType: 'Full Field Competition',
    entryFee: 100,
    paymentMethod: 'Cash',
  };
  const created = await requestJson(baseUrl, '/api/register', {
    method: 'POST',
    body: registration,
  });
  assert.equal(created.response.status, 201);
  assert.match(created.payload.member.membershipId, /^SFF\/\d{9}$/);
  assert.equal(created.payload.member.approvalStatus, 'pending');
  const memberCookie = cookieFrom(created.response);

  const pendingAccess = await requestJson(baseUrl, '/api/features/competition', { cookie: memberCookie });
  assert.equal(pendingAccess.response.status, 403);
  assert.equal(pendingAccess.payload.status, 'pending');

  const duplicate = await requestJson(baseUrl, '/api/register', {
    method: 'POST',
    body: registration,
  });
  assert.equal(duplicate.response.status, 409);

  const badLogin = await requestJson(baseUrl, '/api/login', {
    method: 'POST',
    body: { email: registration.email, password: 'incorrect-password' },
  });
  assert.equal(badLogin.response.status, 401);

  const adminLogin = await requestJson(baseUrl, '/api/admin/login', {
    method: 'POST',
    body: { password: 'test-organizer-password' },
  });
  assert.equal(adminLogin.response.status, 200);
  const adminCookie = cookieFrom(adminLogin.response);

  const reviewQueue = await requestJson(baseUrl, '/api/admin/registrations', { cookie: adminCookie });
  assert.equal(reviewQueue.response.status, 200);
  assert.equal(reviewQueue.payload.registrations.length, 1);
  assert.equal(reviewQueue.payload.registrations[0].email, registration.email);

  const approval = await requestJson(
    baseUrl,
    `/api/admin/registrations/${reviewQueue.payload.registrations[0].id}`,
    { method: 'PATCH', body: { approvalStatus: 'approved' }, cookie: adminCookie },
  );
  assert.equal(approval.response.status, 200);

  const approvedAccess = await requestJson(baseUrl, '/api/features/competition', { cookie: memberCookie });
  assert.equal(approvedAccess.response.status, 200);
  assert.equal(approvedAccess.payload.allowed, true);

  const pendingCompetition = await requestJson(baseUrl, '/api/competition-details', { cookie: memberCookie });
  assert.equal(pendingCompetition.response.status, 200);
  assert.equal(pendingCompetition.payload.competition.title, 'Saturday Football Family Gala');

  const unauthorizedTeams = await requestJson(baseUrl, '/api/admin/teams');
  assert.equal(unauthorizedTeams.response.status, 401);

  const addedTeam = await requestJson(baseUrl, '/api/admin/teams', {
    method: 'POST',
    body: { name: 'Team Test' },
    cookie: adminCookie,
  });
  assert.equal(addedTeam.response.status, 201);

  const teamRegistration = {
    teamName: 'Team Test',
    coachName: 'Team Coordinator',
    coachMembershipId: 'SFF/0002',
    coachPhone: '076123456',
    coachEmail: 'coordinator@example.test',
    matchType: 'Full Field Competition',
    entryFee: 200,
    paymentMethod: 'Cash',
    players: [
      {
        fullName: 'Roster Player One',
        email: 'roster-one@example.test',
        phone: '076111111',
        password: 'roster-player-one-password',
        shirtNumber: '7',
        position: 'Midfielder',
      },
      {
        fullName: 'Roster Player Two',
        email: 'roster-two@example.test',
        phone: '076222222',
        password: 'roster-player-two-password',
        shirtNumber: '9',
        position: 'Attacker',
      },
    ],
  };
  const duplicateRoster = await requestJson(baseUrl, '/api/register/team', {
    method: 'POST',
    body: {
      ...teamRegistration,
      players: [teamRegistration.players[0], { ...teamRegistration.players[1], email: teamRegistration.players[0].email }],
    },
  });
  assert.equal(duplicateRoster.response.status, 400);

  const roster = await requestJson(baseUrl, '/api/register/team', {
    method: 'POST',
    body: teamRegistration,
  });
  assert.equal(roster.response.status, 201);
  assert.equal(roster.payload.registrations.length, 2);
  assert.ok(roster.payload.registrations.every((player) => player.approvalStatus === 'pending'));

  const rosterLogin = await requestJson(baseUrl, '/api/login', {
    method: 'POST',
    body: { email: 'roster-one@example.test', password: 'roster-player-one-password' },
  });
  assert.equal(rosterLogin.payload.member.approvalStatus, 'pending');
  const rosterCookie = cookieFrom(rosterLogin.response);
  const rosterCompetitionAccess = await requestJson(baseUrl, '/api/competition-details', { cookie: rosterCookie });
  assert.equal(rosterCompetitionAccess.response.status, 403);
  const secondRosterLogin = await requestJson(baseUrl, '/api/login', {
    method: 'POST',
    body: { email: 'roster-two@example.test', password: 'roster-player-two-password' },
  });
  const secondRosterCookie = cookieFrom(secondRosterLogin.response);
  const secondRosterCompetitionAccess = await requestJson(baseUrl, '/api/competition-details', { cookie: secondRosterCookie });
  assert.equal(secondRosterCompetitionAccess.response.status, 403);

  const renamedTeam = await requestJson(baseUrl, `/api/admin/teams/${addedTeam.payload.team.id}`, {
    method: 'PATCH',
    body: { name: 'Team Test Renamed', isActive: true },
    cookie: adminCookie,
  });
  assert.equal(renamedTeam.response.status, 200);

  const competitionUpdate = await requestJson(baseUrl, '/api/admin/competition-details', {
    method: 'PATCH',
    body: {
      title: 'SFF Test Gala',
      description: 'Updated competition summary',
      dateSchedule: 'Saturday, 9 AM',
      venue: 'Test Field',
      matchFormats: ['Full Field Competition'],
      pointsSystem: 'Win 3 · Draw 1 · Loss 0',
      announcements: 'Bring boots and water.',
    },
    cookie: adminCookie,
  });
  assert.equal(competitionUpdate.response.status, 200);

  const updatedCompetition = await requestJson(baseUrl, '/api/competition-details', { cookie: rosterCookie });
  assert.equal(updatedCompetition.response.status, 403);
  const originalApprovedCompetition = await requestJson(baseUrl, '/api/competition-details', { cookie: memberCookie });
  assert.equal(originalApprovedCompetition.payload.competition.title, 'SFF Test Gala');
  assert.equal(originalApprovedCompetition.payload.competition.matchFormats.length, 1);
  assert.equal(originalApprovedCompetition.payload.competition.announcements, 'Bring boots and water.');

  const activeTeams = await requestJson(baseUrl, '/api/registration-options');
  assert.ok(activeTeams.payload.teams.includes('Team Test Renamed'));
  assert.deepEqual(activeTeams.payload.matchTypes, ['Full Field Competition']);
  const removedTeam = await requestJson(baseUrl, `/api/admin/teams/${addedTeam.payload.team.id}`, {
    method: 'PATCH',
    body: { name: 'Team Test Renamed', isActive: false },
    cookie: adminCookie,
  });
  assert.equal(removedTeam.response.status, 200);
  const teamsAfterRemoval = await requestJson(baseUrl, '/api/registration-options');
  assert.ok(!teamsAfterRemoval.payload.teams.includes('Team Test Renamed'));
  const restoredTeam = await requestJson(baseUrl, `/api/admin/teams/${addedTeam.payload.team.id}`, {
    method: 'PATCH',
    body: { name: 'Team Test Renamed', isActive: true },
    cookie: adminCookie,
  });
  assert.equal(restoredTeam.response.status, 200);

  const rosterMember = (await requestJson(baseUrl, '/api/admin/registrations', { cookie: adminCookie }))
    .payload.registrations.find((member) => member.email === 'roster-one@example.test');
  assert.equal(rosterMember.teamName, 'Team Test Renamed');
  const rosterApproval = await requestJson(baseUrl, `/api/admin/registrations/${rosterMember.id}`, {
    method: 'PATCH',
    body: { approvalStatus: 'approved' },
    cookie: adminCookie,
  });
  assert.equal(rosterApproval.response.status, 200);
  const approvedRosterAccess = await requestJson(baseUrl, '/api/competition-details', { cookie: rosterCookie });
  assert.equal(approvedRosterAccess.payload.competition.title, 'SFF Test Gala');
  const secondPlayerStillPending = await requestJson(baseUrl, '/api/competition-details', { cookie: secondRosterCookie });
  assert.equal(secondPlayerStillPending.response.status, 403);
});
