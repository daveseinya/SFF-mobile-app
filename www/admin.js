const loginForm = document.getElementById('admin-login-form');
const dashboard = document.getElementById('admin-dashboard');
const registrationsList = document.getElementById('registration-list');
const teamAddForm = document.getElementById('team-add-form');
const teamsList = document.getElementById('admin-team-list');
const competitionForm = document.getElementById('competition-form');
const statusMessage = document.getElementById('admin-status');

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    throw new Error('The server returned an unreadable response.');
  }
  if (!response.ok) {
    throw new Error(payload.error || 'The request could not be completed.');
  }
  return payload;
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle('is-error', isError);
}

function buildRegistrationCard(registration) {
  const card = document.createElement('article');
  card.className = 'player-card';
  const title = document.createElement('h3');
  title.textContent = `${registration.fullName} · ${registration.membershipId}`;

  const details = document.createElement('p');
  const teamSubmission = registration.teamRegistrationId
    ? ` · Team registration #${registration.teamRegistrationId}`
    : '';
  details.textContent = `${registration.email} · ${registration.teamName} · ${registration.position} · #${registration.shirtNumber}${teamSubmission}`;

  const meta = document.createElement('p');
  meta.textContent = `Gala: ${registration.matchType} · Registration approval: ${registration.approvalStatus}`;

  const actions = document.createElement('div');
  actions.className = 'admin-actions';
  for (const decision of ['approved', 'rejected']) {
    const button = document.createElement('button');
    button.className = decision === 'approved' ? 'button button-accent' : 'button button-outline';
    button.type = 'button';
    button.textContent = decision === 'approved' ? 'Approve' : 'Reject';
    button.disabled = registration.approvalStatus === decision;
    button.addEventListener('click', () => updateDecision(registration.id, decision));
    actions.append(button);
  }
  card.append(title, details, meta, actions);
  return card;
}

async function loadRegistrations() {
  registrationsList.replaceChildren();
  const { registrations } = await apiRequest('/api/admin/registrations');
  if (!registrations.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No registrations have been submitted yet.';
    registrationsList.append(empty);
    return;
  }
  registrations.forEach((registration) => registrationsList.append(buildRegistrationCard(registration)));
}

function buildTeamCard(team) {
  const card = document.createElement('article');
  card.className = 'player-card admin-team-card';
  const label = document.createElement('label');
  label.className = 'field';
  const nameLabel = document.createElement('span');
  nameLabel.textContent = `Team name${team.isActive ? '' : ' (removed from registration)'}`;
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 60;
  nameInput.value = team.name;
  nameInput.required = true;
  label.append(nameLabel, nameInput);

  const actions = document.createElement('div');
  actions.className = 'admin-actions';
  const saveButton = document.createElement('button');
  saveButton.className = 'button button-primary';
  saveButton.type = 'button';
  saveButton.textContent = 'Save team';
  saveButton.addEventListener('click', () => updateTeam(team.id, nameInput.value.trim(), Boolean(team.isActive)));

  const activeButton = document.createElement('button');
  activeButton.className = 'button button-outline';
  activeButton.type = 'button';
  activeButton.textContent = team.isActive ? 'Remove from registration' : 'Restore team';
  activeButton.addEventListener('click', () => updateTeam(team.id, nameInput.value.trim(), !team.isActive));
  actions.append(saveButton, activeButton);
  card.append(label, actions);
  return card;
}

async function loadTeams() {
  teamsList.replaceChildren();
  const { teams } = await apiRequest('/api/admin/teams');
  if (!teams.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No teams are configured.';
    teamsList.append(empty);
    return;
  }
  teams.forEach((team) => teamsList.append(buildTeamCard(team)));
}

async function updateTeam(id, name, isActive) {
  try {
    await apiRequest(`/api/admin/teams/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, isActive }),
    });
    await loadTeams();
    setStatus(isActive ? 'Team saved and available for registration.' : 'Team removed from new registrations.');
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function loadCompetitionDetails() {
  const { competition } = await apiRequest('/api/admin/competition-details');
  competitionForm.elements.namedItem('title').value = competition.title;
  competitionForm.elements.namedItem('description').value = competition.description;
  competitionForm.elements.namedItem('dateSchedule').value = competition.dateSchedule;
  competitionForm.elements.namedItem('venue').value = competition.venue;
  competitionForm.elements.namedItem('pointsSystem').value = competition.pointsSystem;
  competitionForm.elements.namedItem('announcements').value = competition.announcements;
  competitionForm.querySelectorAll('[name="matchFormats"]').forEach((checkbox) => {
    checkbox.checked = competition.matchFormats.includes(checkbox.value);
  });
}

async function updateDecision(id, approvalStatus) {
  try {
    await apiRequest(`/api/admin/registrations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ approvalStatus }),
    });
    await loadRegistrations();
    setStatus(`Registration ${approvalStatus}.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = new FormData(loginForm).get('password');
  try {
    await apiRequest('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    loginForm.hidden = true;
    dashboard.hidden = false;
    setStatus('Organizer signed in.');
    await Promise.all([loadRegistrations(), loadTeams(), loadCompetitionDetails()]);
  } catch (error) {
    setStatus(error.message, true);
  }
});

teamAddForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(teamAddForm);
  try {
    await apiRequest('/api/admin/teams', {
      method: 'POST',
      body: JSON.stringify({ name: formData.get('name') }),
    });
    teamAddForm.reset();
    await loadTeams();
    setStatus('Team added to registration choices.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

competitionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(competitionForm);
  try {
    await apiRequest('/api/admin/competition-details', {
      method: 'PATCH',
      body: JSON.stringify({
        title: formData.get('title'),
        description: formData.get('description'),
        dateSchedule: formData.get('dateSchedule'),
        venue: formData.get('venue'),
        matchFormats: formData.getAll('matchFormats'),
        pointsSystem: formData.get('pointsSystem'),
        announcements: formData.get('announcements'),
      }),
    });
    setStatus('Competition details saved for approved members.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.getElementById('admin-logout').addEventListener('click', async () => {
  try {
    await apiRequest('/api/admin/logout', { method: 'POST', body: '{}' });
    dashboard.hidden = true;
    loginForm.hidden = false;
    loginForm.reset();
    setStatus('Signed out.');
  } catch (error) {
    setStatus(error.message, true);
  }
});
