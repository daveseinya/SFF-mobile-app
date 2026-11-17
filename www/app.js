const screens = new Set(['home', 'membership', 'apply', 'competition', 'guide']);
let TEAM_NAMES = ['Team Legal', 'Team Odada 27', 'Team Tom', 'Team Koroma'];
const MAX_PLAYERS_PER_TEAM = 20;
const JOTFORM_TEAMS = ['Team Legal', 'Team Odada 27', 'Team Tom', 'Team Koroma'];
const JOTFORM_MATCH_TYPES = ['Full Field Competition', 'Six aside Competition'];
const MATCH_RESULTS_KEY = 'sff-gala-match-results-v1';
const registrationForm = document.getElementById('gala-registration-form');
const playersList = document.getElementById('players-list');
const playerCount = document.getElementById('player-count');
const playerListData = document.getElementById('player-list-data');
const entryFee = document.getElementById('entry-fee');
const totalAmount = document.getElementById('total-amount');
const totalAmountData = document.getElementById('total-amount-data');
const coachSffId = registrationForm.querySelector('[name="q5_q5_textbox3"]');
const addPlayerButton = document.getElementById('add-player');
const playerLimitNote = document.getElementById('player-limit-note');
const matchResultForm = document.getElementById('match-result-form');
const matchResultSubmit = matchResultForm.querySelector('button[type="submit"]');
const matchDate = document.getElementById('match-date');
const homeTeam = document.getElementById('home-team');
const awayTeam = document.getElementById('away-team');
const homeScore = document.getElementById('home-score');
const awayScore = document.getElementById('away-score');
const matchPlayerStats = document.getElementById('match-player-stats');
const storageStatus = document.getElementById('results-storage-status');
const memberLoginForm = document.getElementById('member-login-form');
const memberSessionCard = document.getElementById('member-session-card');
const memberStatusMessage = document.getElementById('member-status-message');
const memberError = document.getElementById('member-error');
const registrationStatus = document.getElementById('registration-status');
const teamOptionsStatus = document.getElementById('team-options-status');
const apiBaseUrl = (document.querySelector('meta[name="sff-api-base-url"]')?.content || '').replace(/\/$/, '');
let matchResults = [];
let matchStorageAvailable = true;
let currentMember = null;

async function apiRequest(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The SFF approval server returned an unreadable response.');
  }
  if (!response.ok) {
    const error = new Error(payload.error || 'The request could not be completed.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

function readPhotoDataUrl(file, maxBytes = 2 * 1024 * 1024) {
  if (!file) {
    return Promise.resolve('');
  }
  if (file.size > maxBytes) {
    return Promise.reject(new Error(`Each player photo must be smaller than ${Math.floor(maxBytes / 1024)} KB.`));
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return Promise.reject(new Error('Upload a JPEG, PNG or WebP player photo.'));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(new Error('The player photo could not be read.')));
    reader.readAsDataURL(file);
  });
  if (TEAM_NAMES.includes(selectedTeam)) {
    select.value = selectedTeam;
  }
}

function setMemberStatus(message, isError = false) {
  memberStatusMessage.textContent = message;
  memberStatusMessage.classList.toggle('is-error', isError);
  memberError.hidden = !isError;
  memberError.textContent = isError ? message : '';
}

function setRegistrationStatus(message, isError = false) {
  registrationStatus.textContent = message;
  registrationStatus.classList.toggle('is-error', isError);
}

function updateMemberView(message, isError = false) {
  const signedIn = Boolean(currentMember);
  memberSessionCard.hidden = !signedIn;
  memberLoginForm.hidden = signedIn;
  document.getElementById('member-logout').hidden = !signedIn;
  if (signedIn) {
    const photo = document.getElementById('member-photo');
    document.getElementById('member-name').textContent = currentMember.fullName;
    document.getElementById('member-id').textContent = currentMember.membershipId;
    photo.hidden = !currentMember.photoAvailable;
    if (currentMember.photoAvailable) {
      photo.crossOrigin = 'use-credentials';
      photo.src = `${apiBaseUrl}/api/profile/photo?refresh=${Date.now()}`;
    } else {
      photo.removeAttribute('src');
    }
    const approved = currentMember.approvalStatus === 'approved';
    const rejected = currentMember.approvalStatus === 'rejected';
    document.getElementById('member-approval').textContent = approved
      ? 'Approved — all member features are available.'
      : rejected
        ? 'This registration was not approved. Contact an SFF organizer for help.'
        : 'Pending organizer approval. Member features remain locked until approved.';
    setMemberStatus(message || (approved
      ? 'Your SFF membership is approved.'
      : rejected
        ? 'Your registration was rejected.'
        : 'Your registration is awaiting organizer approval.'));
  } else {
    setMemberStatus(message || 'Sign in to check your membership approval.', isError);
  }
}

async function refreshMemberSession() {
  try {
    const payload = await apiRequest('/api/session');
    currentMember = payload.member;
    updateMemberView();
  } catch (error) {
    currentMember = null;
    updateMemberView(error.status === 401
      ? 'Sign in to check your membership approval.'
      : `Member access could not be checked: ${error.message}`, error.status !== 401);
  }
}

async function showScreen(name, updateAddress = true) {
  let screen = screens.has(name) ? name : 'home';
  if (['competition', 'guide'].includes(screen)) {
    try {
      await apiRequest(`/api/features/${screen}`);
      if (screen === 'competition') {
        await loadCompetitionDetails();
      }
    } catch (error) {
      screen = 'membership';
      setMemberStatus(error.message, error.status !== 403);
    }
  }

  document.querySelectorAll('.screen').forEach((section) => {
    section.hidden = section.id !== screen;
  });

  document.querySelectorAll('.main-nav [data-screen]').forEach((link) => {
    if (link.dataset.screen === screen) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  if (updateAddress && window.location.hash !== `#${screen}`) {
    window.history.pushState(null, '', `#${screen}`);
  }

  const section = document.getElementById(screen);
  const heading = section && document.getElementById(section.getAttribute('aria-labelledby'));
  if (heading) {
    heading.focus({ preventScroll: true });
  }
  window.scrollTo(0, 0);
}

function updatePlayerCount() {
  const cards = [...playersList.querySelectorAll('.player-card')];
  playerCount.value = String(cards.length);
  document.getElementById('roster-count').textContent = `${cards.length} player${cards.length === 1 ? '' : 's'}`;
  addPlayerButton.disabled = cards.length >= MAX_PLAYERS_PER_TEAM;
  playerLimitNote.hidden = cards.length < MAX_PLAYERS_PER_TEAM;

  cards.forEach((card, index) => {
    const number = index + 1;
    card.querySelector('.player-card-title').textContent = `Player ${number}`;
    const removeButton = card.querySelector('.remove-player');
    removeButton.setAttribute('aria-label', `Remove player ${number}`);
    removeButton.disabled = cards.length === 1;
  });
}

function updateTotalAmount() {
  const fee = Number(entryFee.value);
  const count = playersList.querySelectorAll('.player-card').length;
  const total = entryFee.value !== '' && Number.isFinite(fee) ? String(fee * count) : '';
  totalAmount.value = total;
  totalAmountData.value = total;
}

function addPlayer() {
  if (playersList.querySelectorAll('.player-card').length >= MAX_PLAYERS_PER_TEAM) {
    return;
  }

  const card = document.createElement('article');
  card.className = 'player-card';
  card.innerHTML = `
    <div class="player-card-head">
      <h3 class="player-card-title"></h3>
      <button class="remove-player" type="button">Remove</button>
    </div>
    <div class="player-fields player-roster-fields">
      <label class="field player-id-field">
        <span>SFF membership ID <span class="required-mark">*</span></span>
        <input class="player-sff-id" type="text" placeholder="Assigned after submission" readonly>
        <span class="player-id-note" role="status">Assigned after this team roster is submitted.</span>
      </label>
      <label class="field player-name-field">
        <span>Player name <span class="required-mark">*</span></span>
        <input class="player-name" type="text" autocomplete="name" required>
      </label>
      <label class="field">
        <span>Player email <span class="required-mark">*</span></span>
        <input class="player-email" type="email" autocomplete="email" required>
      </label>
      <label class="field">
        <span>Player phone <span class="required-mark">*</span></span>
        <input class="player-phone" type="tel" autocomplete="tel" required>
      </label>
      <label class="field">
        <span>Create password <span class="required-mark">*</span></span>
        <input class="player-password" type="password" autocomplete="new-password" minlength="10" required>
      </label>
      <label class="field">
        <span>Confirm password <span class="required-mark">*</span></span>
        <input class="player-password-confirm" type="password" autocomplete="new-password" minlength="10" required>
      </label>
      <label class="field">
        <span>Player photo (optional)</span>
        <input class="player-photo" type="file" accept="image/jpeg,image/png,image/webp">
        <span class="player-id-note">JPEG, PNG or WebP, up to 512 KB</span>
      </label>
      <label class="field">
        <span>Shirt number <span class="required-mark">*</span></span>
        <input class="player-shirt" type="text" inputmode="numeric" pattern="[0-9]+" required>
      </label>
      <label class="field">
        <span>Position <span class="required-mark">*</span></span>
        <select class="player-position" required>
          <option value="">Choose position</option>
          <option value="Attacker">Attacker</option>
          <option value="Midfielder">Midfielder</option>
          <option value="Defender">Defender</option>
          <option value="Goalkeeper">Goalkeeper</option>
        </select>
      </label>
      <label class="field">
        <span>Member approval</span>
        <output class="member-approval-status">Pending</output>
      </label>
      <label class="field">
        <span>Player status</span>
        <output class="player-status">Pending</output>
      </label>
    </div>`;

  const nameInput = card.querySelector('.player-name');
  const passwordInput = card.querySelector('.player-password');
  const confirmInput = card.querySelector('.player-password-confirm');
  confirmInput.addEventListener('input', () => {
    confirmInput.setCustomValidity(
      passwordInput.value === confirmInput.value ? '' : 'Passwords do not match.',
    );
  });
  passwordInput.addEventListener('input', () => {
    confirmInput.setCustomValidity(
      passwordInput.value === confirmInput.value ? '' : 'Passwords do not match.',
    );
  });
  card.querySelector('.remove-player').addEventListener('click', () => {
    card.remove();
    updatePlayerCount();
    updateTotalAmount();
  });
  playersList.append(card);
  updatePlayerCount();
  updateTotalAmount();
  nameInput.focus();
}

function setStorageStatus(message, isError = false) {
  storageStatus.textContent = message;
  storageStatus.classList.toggle('is-error', isError);
}

function showStorageError(message) {
  matchStorageAvailable = false;
  matchResultSubmit.disabled = true;
  setStorageStatus(message, true);
}

function populateTeamOptions(select, placeholder, teams = TEAM_NAMES) {
  const selectedTeam = select.value;
  select.textContent = '';
  const prompt = document.createElement('option');
  prompt.value = '';
  prompt.textContent = placeholder;
  select.append(prompt);

  teams.forEach((team) => {
    const option = document.createElement('option');
    option.value = team;
    option.textContent = team;
    select.append(option);
  });
  if (teams.includes(selectedTeam)) {
    select.value = selectedTeam;
  }
}

async function loadRegistrationOptions() {
  const { teams, matchTypes } = await apiRequest('/api/registration-options');
  const historicalTeams = matchResults.flatMap((match) => [match.homeTeam, match.awayTeam]);
  TEAM_NAMES = [...new Set([...teams, ...historicalTeams])];
  const homeTeamList = document.getElementById('home-team-list');
  homeTeamList.textContent = '';
  teams.forEach((team, index) => {
    const item = document.createElement('li');
    const number = document.createElement('span');
    number.textContent = String(index + 1).padStart(2, '0');
    item.append(number, document.createTextNode(team));
    homeTeamList.append(item);
  });
  populateTeamOptions(registrationForm.elements.namedItem('q3_q3_dropdown1'), 'Choose your team', teams);
  populateTeamOptions(homeTeam, 'Select home team');
  populateTeamOptions(awayTeam, 'Select away team');
  matchPlayerStats.querySelectorAll('.stat-team').forEach(updateStatTeamOptions);

  const matchTypeSelect = registrationForm.elements.namedItem('q13_q13_dropdown11');
  const selectedMatchType = matchTypeSelect.value;
  matchTypeSelect.textContent = '';
  const prompt = document.createElement('option');
  prompt.value = '';
  prompt.textContent = 'Choose match type';
  matchTypeSelect.append(prompt);
  matchTypes.forEach((matchType) => {
    const option = document.createElement('option');
    option.value = matchType;
    option.textContent = matchType;
    matchTypeSelect.append(option);
  });
  if (matchTypes.includes(selectedMatchType)) {
    matchTypeSelect.value = selectedMatchType;
  }
  teamOptionsStatus.textContent = '';
  renderLeaderboards();
}

function renderCompetitionList(container, values, emptyMessage) {
  container.textContent = '';
  if (!values.length) {
    const item = document.createElement('p');
    item.textContent = emptyMessage;
    container.append(item);
    return;
  }
  values.forEach((value) => {
    const item = document.createElement('p');
    item.textContent = value;
    container.append(item);
  });
}

async function loadCompetitionDetails() {
  const [{ competition }, { teams }] = await Promise.all([
    apiRequest('/api/competition-details'),
    apiRequest('/api/registration-options'),
  ]);
  document.getElementById('competition-page-title').textContent = competition.title;
  document.getElementById('competition-description').textContent = competition.description;
  renderCompetitionList(
    document.getElementById('competition-match-formats'),
    competition.matchFormats,
    'Match formats will be announced soon.',
  );
  renderCompetitionList(
    document.getElementById('competition-team-list'),
    teams,
    'Teams will be announced soon.',
  );
  document.getElementById('competition-points-system').textContent = competition.pointsSystem;
  document.getElementById('competition-date-schedule').textContent = competition.dateSchedule;
  document.getElementById('competition-schedule-card').hidden = !competition.dateSchedule;
  document.getElementById('competition-venue').textContent = competition.venue;
  document.getElementById('competition-venue-card').hidden = !competition.venue;
  document.getElementById('competition-announcements').textContent = competition.announcements;
  document.getElementById('competition-announcements-card').hidden = !competition.announcements;
  TEAM_NAMES = [...new Set([...teams, ...matchResults.flatMap((match) => [match.homeTeam, match.awayTeam])])];
  populateTeamOptions(homeTeam, 'Select home team');
  populateTeamOptions(awayTeam, 'Select away team');
  renderLeaderboards();
}

function updateStatTeamOptions(select) {
  const selectedTeam = select.value;
  const participatingTeams = [...new Set([homeTeam.value, awayTeam.value].filter(Boolean))];
  const availableTeams = participatingTeams.length ? participatingTeams : TEAM_NAMES;
  select.textContent = '';

  const prompt = document.createElement('option');
  prompt.value = '';
  prompt.textContent = 'Choose team';
  select.append(prompt);

  availableTeams.forEach((team) => {
    const option = document.createElement('option');
    option.value = team;
    option.textContent = team;
    select.append(option);
  });

  if (availableTeams.includes(selectedTeam)) {
    select.value = selectedTeam;
  }
}

function updateMatchStatLabels() {
  [...matchPlayerStats.querySelectorAll('.match-stat-card')].forEach((card, index) => {
    const number = index + 1;
    card.querySelector('.match-stat-card-title').textContent = `Player ${number}`;
    card.querySelector('.remove-match-stat').setAttribute('aria-label', `Remove player stats ${number}`);
  });
}

function addMatchPlayerStat() {
  const card = document.createElement('article');
  card.className = 'match-stat-card';
  card.innerHTML = `
    <div class="match-stat-card-head">
      <strong class="match-stat-card-title"></strong>
      <button class="remove-match-stat button button-outline" type="button">Remove</button>
    </div>
    <div class="match-stat-fields">
      <label class="field">
        <span>SFF membership ID <span class="required-mark">*</span></span>
        <input class="stat-sff-id" type="text" placeholder="SFF/0002" pattern="SFF/[0-9]+" title="Use the unique SFF ID from the member registration form" autocapitalize="characters" required>
      </label>
      <label class="field">
        <span>Player name <span class="required-mark">*</span></span>
        <input class="stat-player-name" type="text" required>
      </label>
      <label class="field">
        <span>Team <span class="required-mark">*</span></span>
        <select class="stat-team" required></select>
      </label>
      <label class="field">
        <span>Goals</span>
        <input class="stat-goals" type="number" min="0" max="99" step="1" value="0" required>
      </label>
      <label class="field">
        <span>Assists</span>
        <input class="stat-assists" type="number" min="0" max="99" step="1" value="0" required>
      </label>
      <label class="field">
        <span>Yellow</span>
        <input class="stat-yellow" type="number" min="0" max="99" step="1" value="0" required>
      </label>
      <label class="field">
        <span>Red</span>
        <input class="stat-red" type="number" min="0" max="99" step="1" value="0" required>
      </label>
    </div>`;

  const idInput = card.querySelector('.stat-sff-id');
  const nameInput = card.querySelector('.stat-player-name');
  const teamSelect = card.querySelector('.stat-team');
  updateStatTeamOptions(teamSelect);

  idInput.addEventListener('input', () => {
    idInput.value = idInput.value.toUpperCase();
    if (!nameInput.dataset.userEdited) {
      nameInput.value = idInput.value;
    }
  });
  nameInput.addEventListener('input', () => {
    nameInput.dataset.userEdited = 'true';
  });
  card.querySelector('.remove-match-stat').addEventListener('click', () => {
    card.remove();
    updateMatchStatLabels();
  });

  matchPlayerStats.append(card);
  updateMatchStatLabels();
  idInput.focus();
}

function isValidStoredMatch(match) {
  if (
    !match ||
    typeof match.id !== 'string' ||
    typeof match.date !== 'string' ||
    !TEAM_NAMES.includes(match.homeTeam) ||
    !TEAM_NAMES.includes(match.awayTeam) ||
    match.homeTeam === match.awayTeam ||
    !Number.isInteger(match.homeScore) ||
    match.homeScore < 0 ||
    !Number.isInteger(match.awayScore) ||
    match.awayScore < 0 ||
    !Array.isArray(match.playerStats)
  ) {
    return false;
  }

  return match.playerStats.every((stat) =>
    stat &&
    typeof stat.sffId === 'string' &&
    typeof stat.name === 'string' &&
    TEAM_NAMES.includes(stat.team) &&
    [stat.goals, stat.assists, stat.yellowCards, stat.redCards].every((value) =>
      Number.isInteger(value) && value >= 0
    )
  );
}

function loadMatchResults() {
  try {
    const savedResults = window.localStorage.getItem(MATCH_RESULTS_KEY);
    if (savedResults) {
      const parsedResults = JSON.parse(savedResults);
      if (Array.isArray(parsedResults)) {
        const historicalTeams = parsedResults.flatMap((match) => [
          match && typeof match.homeTeam === 'string' ? match.homeTeam : '',
          match && typeof match.awayTeam === 'string' ? match.awayTeam : '',
        ]).filter(Boolean);
        TEAM_NAMES = [...new Set([...TEAM_NAMES, ...historicalTeams])];
      }
      if (!Array.isArray(parsedResults) || !parsedResults.every(isValidStoredMatch)) {
        throw new Error('Stored results have an invalid format.');
      }
      matchResults = parsedResults;
    }
  } catch (error) {
    showStorageError('Saved results could not be loaded. They have not been overwritten; check browser storage before entering more results.');
  }

  renderLeaderboards();
}

function saveMatchResults(updatedResults) {
  if (!matchStorageAvailable) {
    return false;
  }

  try {
    window.localStorage.setItem(MATCH_RESULTS_KEY, JSON.stringify(updatedResults));
  } catch (error) {
    showStorageError('Could not save results in this browser. Check device storage and try again.');
    return false;
  }

  matchResults = updatedResults;
  renderLeaderboards();
  setStorageStatus('Results saved on this device only.');
  return true;
}

function makeTeamStandings() {
  const standings = TEAM_NAMES.map((team) => ({
    team,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
  }));
  const byTeam = new Map(standings.map((standing) => [standing.team, standing]));

  matchResults.forEach((match) => {
    const home = byTeam.get(match.homeTeam);
    const away = byTeam.get(match.awayTeam);
    home.played += 1;
    away.played += 1;
    home.goalsFor += match.homeScore;
    home.goalsAgainst += match.awayScore;
    away.goalsFor += match.awayScore;
    away.goalsAgainst += match.homeScore;

    if (match.homeScore > match.awayScore) {
      home.wins += 1;
      home.points += 3;
      away.losses += 1;
    } else if (match.homeScore < match.awayScore) {
      away.wins += 1;
      away.points += 3;
      home.losses += 1;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }
  });

  return standings.sort((first, second) =>
    second.points - first.points ||
    (second.goalsFor - second.goalsAgainst) - (first.goalsFor - first.goalsAgainst) ||
    second.goalsFor - first.goalsFor ||
    TEAM_NAMES.indexOf(first.team) - TEAM_NAMES.indexOf(second.team)
  );
}

function appendTableCell(row, value, isHeading = false) {
  const cell = document.createElement(isHeading ? 'th' : 'td');
  if (isHeading) {
    cell.scope = 'row';
  }
  cell.textContent = String(value);
  row.append(cell);
}

function renderStandings() {
  const standingsBody = document.getElementById('standings-body');
  standingsBody.textContent = '';

  makeTeamStandings().forEach((standing, index) => {
    const row = document.createElement('tr');
    appendTableCell(row, index + 1);
    appendTableCell(row, standing.team, true);
    appendTableCell(row, standing.played);
    appendTableCell(row, standing.wins);
    appendTableCell(row, standing.draws);
    appendTableCell(row, standing.losses);
    appendTableCell(row, standing.goalsFor);
    appendTableCell(row, standing.goalsAgainst);
    appendTableCell(row, standing.goalsFor - standing.goalsAgainst);
    appendTableCell(row, standing.points);
    standingsBody.append(row);
  });
}

function getPlayerTotals() {
  const totalsByPlayer = new Map();
  matchResults.forEach((match) => {
    match.playerStats.forEach((stat) => {
      const key = `${stat.sffId.toUpperCase()}|${stat.team}`;
      let total = totalsByPlayer.get(key);
      if (!total) {
        total = {
          sffId: stat.sffId.toUpperCase(),
          name: stat.name,
          team: stat.team,
          goals: 0,
          assists: 0,
          yellowCards: 0,
          redCards: 0,
        };
        totalsByPlayer.set(key, total);
      }
      total.name = stat.name;
      total.goals += stat.goals;
      total.assists += stat.assists;
      total.yellowCards += stat.yellowCards;
      total.redCards += stat.redCards;
    });
  });

  return [...totalsByPlayer.values()].sort((first, second) =>
    second.goals - first.goals ||
    second.assists - first.assists ||
    first.name.localeCompare(second.name)
  );
}

function renderPlayerStats() {
  const statsBody = document.getElementById('player-stats-body');
  const topScorerBanner = document.getElementById('top-scorer-banner');
  const playerTotals = getPlayerTotals();
  statsBody.textContent = '';

  const topGoals = playerTotals.length ? playerTotals[0].goals : 0;
  const topScorers = playerTotals.filter((player) => player.goals > 0 && player.goals === topGoals);
  topScorerBanner.textContent = topScorers.length
    ? `Highest goal scorer${topScorers.length > 1 ? 's' : ''}: ${topScorers.map((player) => `${player.name} (${player.team}) · ${player.goals}`).join(' | ')}`
    : 'No goals recorded yet.';

  if (!playerTotals.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 7;
    cell.className = 'empty-cell';
    cell.textContent = 'Player stats will appear here after an organizer records them.';
    row.append(cell);
    statsBody.append(row);
    return;
  }

  playerTotals.forEach((player, index) => {
    const row = document.createElement('tr');
    if (topScorers.includes(player)) {
      row.className = 'leader-row';
    }
    appendTableCell(row, index + 1);
    appendTableCell(row, `${player.name} · ${player.sffId}`, true);
    appendTableCell(row, player.team);
    appendTableCell(row, player.goals);
    appendTableCell(row, player.assists);
    appendTableCell(row, player.yellowCards);
    appendTableCell(row, player.redCards);
    statsBody.append(row);
  });
}

function formatMatchDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) {
    return date;
  }
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    .format(new Date(year, month - 1, day));
}

function renderMatchHistory() {
  const list = document.getElementById('match-results-list');
  list.textContent = '';

  if (!matchResults.length) {
    const emptyMessage = document.createElement('p');
    emptyMessage.className = 'match-history-empty';
    emptyMessage.textContent = 'No games have been recorded yet.';
    list.append(emptyMessage);
    return;
  }

  [...matchResults].sort((first, second) =>
    second.date.localeCompare(first.date) || second.id.localeCompare(first.id)
  ).forEach((match) => {
    const item = document.createElement('article');
    item.className = 'match-result-item';

    const details = document.createElement('div');
    details.className = 'match-result-details';
    const date = document.createElement('time');
    date.className = 'match-result-date';
    date.dateTime = match.date;
    date.textContent = formatMatchDate(match.date);
    const scoreline = document.createElement('p');
    scoreline.className = 'match-result-scoreline';
    scoreline.textContent = `${match.homeTeam}  ${match.homeScore} – ${match.awayScore}  ${match.awayTeam}`;
    const playerSummary = document.createElement('span');
    playerSummary.className = 'match-result-player-summary';
    playerSummary.textContent = `${match.playerStats.length} player stat${match.playerStats.length === 1 ? '' : 's'} recorded`;
    details.append(date, scoreline, playerSummary);

    const removeButton = document.createElement('button');
    removeButton.className = 'button button-outline remove-match-result';
    removeButton.type = 'button';
    removeButton.dataset.removeMatch = match.id;
    removeButton.textContent = 'Remove';
    removeButton.setAttribute('aria-label', `Remove result: ${match.homeTeam} ${match.homeScore}, ${match.awayTeam} ${match.awayScore}`);
    item.append(details, removeButton);
    list.append(item);
  });
}

function renderLeaderboards() {
  renderStandings();
  renderPlayerStats();
  renderMatchHistory();
}

function setDefaultMatchDate() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  matchDate.value = localDate.toISOString().slice(0, 10);
}

function validateMatchTeams() {
  awayTeam.setCustomValidity(
    homeTeam.value && homeTeam.value === awayTeam.value
      ? 'Choose a different away team.'
      : ''
  );
}

homeTeam.addEventListener('change', () => {
  validateMatchTeams();
  matchPlayerStats.querySelectorAll('.stat-team').forEach(updateStatTeamOptions);
});
awayTeam.addEventListener('change', () => {
  validateMatchTeams();
  matchPlayerStats.querySelectorAll('.stat-team').forEach(updateStatTeamOptions);
});
document.getElementById('add-match-stat').addEventListener('click', addMatchPlayerStat);

matchResultForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await apiRequest('/api/features/competition');
  } catch (error) {
    setMemberStatus(error.message, error.status !== 403);
    showScreen('membership');
    return;
  }
  validateMatchTeams();
  if (!matchResultForm.reportValidity() || !matchStorageAvailable) {
    return;
  }

  const playerStats = [...matchPlayerStats.querySelectorAll('.match-stat-card')].map((card) => ({
    sffId: card.querySelector('.stat-sff-id').value.trim().toUpperCase(),
    name: card.querySelector('.stat-player-name').value.trim(),
    team: card.querySelector('.stat-team').value,
    goals: Number(card.querySelector('.stat-goals').value),
    assists: Number(card.querySelector('.stat-assists').value),
    yellowCards: Number(card.querySelector('.stat-yellow').value),
    redCards: Number(card.querySelector('.stat-red').value),
  }));
  const match = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: matchDate.value,
    homeTeam: homeTeam.value,
    homeScore: Number(homeScore.value),
    awayTeam: awayTeam.value,
    awayScore: Number(awayScore.value),
    playerStats,
  };

  if (saveMatchResults([...matchResults, match])) {
    matchResultForm.reset();
    matchPlayerStats.textContent = '';
    setDefaultMatchDate();
    validateMatchTeams();
  }
});

document.getElementById('match-results-list').addEventListener('click', async (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }
  const removeButton = event.target.closest('[data-remove-match]');
  if (!removeButton) {
    return;
  }
  const match = matchResults.find((result) => result.id === removeButton.dataset.removeMatch);
  if (!match || !window.confirm(`Remove the result ${match.homeTeam} ${match.homeScore} - ${match.awayScore} ${match.awayTeam}?`)) {
    return;
  }
  try {
    await apiRequest('/api/features/competition');
  } catch (error) {
    setMemberStatus(error.message, error.status !== 403);
    showScreen('membership');
    return;
  }
  saveMatchResults(matchResults.filter((result) => result.id !== match.id));
});

document.querySelectorAll('[data-screen]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    void showScreen(link.dataset.screen);
  });
});

window.addEventListener('hashchange', () => {
  void showScreen(window.location.hash.slice(1), false);
});

document.getElementById('add-player').addEventListener('click', addPlayer);
entryFee.addEventListener('input', updateTotalAmount);
coachSffId.addEventListener('input', () => {
  coachSffId.value = coachSffId.value.toUpperCase();
});
populateTeamOptions(homeTeam, 'Select home team');
populateTeamOptions(awayTeam, 'Select away team');
setDefaultMatchDate();

memberLoginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(memberLoginForm);
  try {
    const payload = await apiRequest('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        email: formData.get('email'),
        password: formData.get('password'),
      }),
    });
    currentMember = payload.member;
    memberLoginForm.reset();
    updateMemberView();
  } catch (error) {
    setMemberStatus(error.message, true);
  }
});

document.getElementById('member-logout').addEventListener('click', async () => {
  try {
    await apiRequest('/api/logout', { method: 'POST', body: '{}' });
    currentMember = null;
    updateMemberView('You have signed out.');
  } catch (error) {
    setMemberStatus(error.message, true);
  }
});

registrationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const playerCards = [...playersList.querySelectorAll('.player-card')];
  playerCards.forEach((card) => {
    const password = card.querySelector('.player-password');
    const confirmation = card.querySelector('.player-password-confirm');
    confirmation.setCustomValidity(
      password.value === confirmation.value ? '' : 'Passwords do not match.',
    );
  });
  if (!registrationForm.reportValidity()) {
    return;
  }

  const teamName = registrationForm.elements.namedItem('q3_q3_dropdown1').value;
  const matchType = registrationForm.elements.namedItem('q13_q13_dropdown11').value;
  const jotformCompatible = JOTFORM_TEAMS.includes(teamName) && JOTFORM_MATCH_TYPES.includes(matchType);
  const nativeApp = Boolean(window.Capacitor && window.Capacitor.isNativePlatform());
  const confirmationWindow = !jotformCompatible || nativeApp
    ? null
    : window.open('about:blank', `sff-gala-${Date.now()}`);
  if (jotformCompatible && !nativeApp && !confirmationWindow) {
    setRegistrationStatus('Allow pop-ups to open the Jotform confirmation after registration.', true);
    return;
  }

  const registration = {
    teamName,
    coachName: registrationForm.elements.namedItem('q4_q4_textbox2').value.trim(),
    coachMembershipId: coachSffId.value.trim().toUpperCase(),
    coachPhone: registrationForm.elements.namedItem('q29_contactPhone').value.trim(),
    coachEmail: registrationForm.elements.namedItem('q7_q7_email5').value.trim(),
    matchType,
    entryFee: entryFee.value === '' ? 0 : Number(entryFee.value),
    paymentMethod: registrationForm.elements.namedItem('q16_q16_dropdown14').value,
    players: playerCards.map((card) => ({
      fullName: card.querySelector('.player-name').value.trim(),
      email: card.querySelector('.player-email').value.trim(),
      phone: card.querySelector('.player-phone').value.trim(),
      password: card.querySelector('.player-password').value,
      shirtNumber: card.querySelector('.player-shirt').value.trim(),
      position: card.querySelector('.player-position').value,
    })),
  };

  const submitButton = registrationForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  setRegistrationStatus('Submitting the team roster and creating individual player accounts…');
  try {
    registration.players = await Promise.all(registration.players.map(async (player, index) => ({
      ...player,
      photoDataUrl: await readPhotoDataUrl(playerCards[index].querySelector('.player-photo').files[0], 512 * 1024),
    })));
    const payload = await apiRequest('/api/register/team', {
      method: 'POST',
      body: JSON.stringify(registration),
    });
    payload.registrations.forEach((member, index) => {
      const card = playerCards[index];
      card.querySelector('.player-sff-id').value = member.membershipId;
      card.querySelector('.player-id-note').textContent = 'Assigned by the SFF registration backend.';
      card.querySelector('.member-approval-status').textContent = 'Pending';
      card.querySelector('.player-status').textContent = 'Pending';
      card.querySelector('.player-password').value = '';
      card.querySelector('.player-password-confirm').value = '';
    });
    playerListData.value = payload.registrations.map((member, index) => {
      const player = registration.players[index];
      return [
        player.fullName,
        member.membershipId,
        `#${player.shirtNumber}`,
        player.position,
        `Email: ${player.email}`,
        `Phone: ${player.phone}`,
        'Approval: Pending',
        'Status: Pending',
      ].join(' · ');
    }).join('\n');

    const now = new Date();
    document.getElementById('submission-month').value = String(now.getMonth() + 1).padStart(2, '0');
    document.getElementById('submission-day').value = String(now.getDate()).padStart(2, '0');
    document.getElementById('submission-year').value = String(now.getFullYear());
    updateTotalAmount();

    const ids = payload.registrations.map((member) => `${member.fullName}: ${member.membershipId}`).join(' | ');
    if (jotformCompatible) {
      const targetName = nativeApp ? '_self' : `sff-gala-${Date.now()}`;
      if (confirmationWindow) {
        confirmationWindow.name = targetName;
      }
      registrationForm.target = targetName;
      registrationForm.submit();
    } else {
      confirmationWindow?.close();
      setRegistrationStatus(
        `Team roster saved to the app backend. Player IDs: ${ids}. Update the Jotform team and match-format choices to enable its submission for this roster.`,
      );
    }
    if (jotformCompatible) {
      setRegistrationStatus(`${payload.message} Player IDs: ${ids}.`);
    }
    registrationForm.reset();
    playersList.textContent = '';
    addPlayer();
    updateTotalAmount();
  } catch (error) {
    if (confirmationWindow) {
      confirmationWindow.close();
    }
    setRegistrationStatus(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

addPlayer();
loadMatchResults();
void loadRegistrationOptions().catch((error) => {
  teamOptionsStatus.textContent = `Teams and match types could not be loaded: ${error.message}`;
  teamOptionsStatus.classList.add('is-error');
});
void refreshMemberSession().finally(() => {
  void showScreen(window.location.hash.slice(1) || 'home', false);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .catch((error) => console.error('The app could not enable offline support.', error));
  });
}
