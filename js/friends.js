(function () {
  'use strict';

  var API_ENDPOINT = 'https://guessit-analytics.offclock.workers.dev';
  var DISPLAY_NAME_KEY = 'guessit_display_name';
  var STORAGE_KEY = 'guessit_data';

  function getUserId() {
    return window.GuessitAnalytics.getOrCreateUserId();
  }

  function getDisplayName() {
    return localStorage.getItem(DISPLAY_NAME_KEY) || '';
  }

  function setDisplayNameLocal(name) {
    localStorage.setItem(DISPLAY_NAME_KEY, name);
  }

  // --- API helpers ---

  function api(method, path, body) {
    var opts = {
      method: method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    return fetch(API_ENDPOINT + path, opts).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data.error || 'Request failed');
        return data;
      });
    });
  }

  // --- User management ---

  function saveDisplayName(name) {
    return api('PUT', '/users', {
      user_id: getUserId(),
      display_name: name,
    }).then(function (data) {
      setDisplayNameLocal(data.display_name);
      return data.display_name;
    });
  }

  // --- Score sync ---

  function submitScore(roundDate, totalScore) {
    if (!getDisplayName()) return Promise.resolve();
    return api('POST', '/scores', {
      user_id: getUserId(),
      round_date: roundDate,
      total_score: totalScore,
    }).catch(function () {});
  }

  function backfillScores() {
    try {
      var data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      var played = data.played || {};
      var scores = [];
      var userId = getUserId();
      Object.keys(played).forEach(function (date) {
        if (played[date].total != null) {
          scores.push({
            user_id: userId,
            round_date: date,
            total_score: played[date].total,
          });
        }
      });
      if (scores.length === 0) return Promise.resolve();
      return api('POST', '/scores', scores).catch(function () {});
    } catch (e) {
      return Promise.resolve();
    }
  }

  // --- Leaderboard operations ---

  function createLeaderboard(name) {
    return api('POST', '/leaderboards', {
      user_id: getUserId(),
      name: name,
    });
  }

  function listLeaderboards() {
    return api('GET', '/leaderboards?user_id=' + encodeURIComponent(getUserId()));
  }

  function getLeaderboardByCode(inviteCode) {
    return api('GET', '/leaderboards/' + encodeURIComponent(inviteCode));
  }

  function joinLeaderboard(inviteCode) {
    return api('POST', '/leaderboards/' + encodeURIComponent(inviteCode) + '/join', {
      user_id: getUserId(),
    });
  }

  function getStandings(leaderboardId, date, period) {
    var params = '?user_id=' + encodeURIComponent(getUserId());
    if (date) params += '&date=' + encodeURIComponent(date);
    if (period) params += '&period=' + encodeURIComponent(period);
    return api('GET', '/leaderboards/' + leaderboardId + '/standings' + params);
  }

  function leaveLeaderboard(leaderboardId) {
    return api('DELETE', '/leaderboards/' + leaderboardId + '/leave', {
      user_id: getUserId(),
    });
  }

  // --- UI rendering ---

  var state = {
    currentView: 'list',
    currentLeaderboard: null,
    standingsPeriod: 'today',
  };

  function getContainer() {
    return document.getElementById('friends-content');
  }

  var pendingInvite = null;

  function show() {
    var name = getDisplayName();
    if (!name) {
      renderNameSetup();
    } else if (pendingInvite) {
      var code = pendingInvite;
      pendingInvite = null;
      renderJoinForm(code);
    } else {
      renderLeaderboardList();
    }
  }

  function renderNameSetup(prefill) {
    var container = getContainer();
    container.innerHTML =
      '<div class="friends-name-setup">' +
        '<h2>Set Your Display Name</h2>' +
        '<p>Choose a name so your friends can identify you on leaderboards.</p>' +
        '<div class="friends-input-group">' +
          '<input type="text" id="friends-name-input" maxlength="20" placeholder="Your name" value="' + escapeHtml(prefill || '') + '">' +
          '<button id="friends-name-save" class="btn-primary">Save</button>' +
        '</div>' +
        '<p class="friends-hint">1–20 characters</p>' +
      '</div>';

    var input = document.getElementById('friends-name-input');
    var btn = document.getElementById('friends-name-save');

    btn.addEventListener('click', function () {
      var val = input.value.trim();
      if (!val || val.length > 20) return;
      btn.disabled = true;
      btn.textContent = 'Saving...';
      saveDisplayName(val).then(function () {
        backfillScores().then(function () {
          if (checkPendingJoin()) {
            var code = pendingInvite;
            pendingInvite = null;
            renderJoinForm(code);
          } else {
            renderLeaderboardList();
          }
        });
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Save';
        showToast('Error: ' + err.message);
      });
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') btn.click();
    });
  }

  function renderLeaderboardList() {
    var container = getContainer();
    state.currentView = 'list';
    state.currentLeaderboard = null;

    container.innerHTML =
      '<div class="friends-list-view">' +
        '<div class="friends-header">' +
          '<span class="friends-username">' + escapeHtml(getDisplayName()) + '</span>' +
          '<button id="friends-edit-name" class="btn-icon" title="Edit name">&#9998;</button>' +
        '</div>' +
        '<div class="friends-actions">' +
          '<button id="friends-create" class="btn-primary">Create Leaderboard</button>' +
          '<button id="friends-join" class="btn-secondary">Join Leaderboard</button>' +
        '</div>' +
        '<div id="friends-boards-list" class="friends-boards-list">' +
          '<p class="friends-loading">Loading...</p>' +
        '</div>' +
      '</div>';

    document.getElementById('friends-edit-name').addEventListener('click', function () {
      renderNameSetup(getDisplayName());
    });
    document.getElementById('friends-create').addEventListener('click', renderCreateForm);
    document.getElementById('friends-join').addEventListener('click', renderJoinForm);

    listLeaderboards().then(function (data) {
      var listEl = document.getElementById('friends-boards-list');
      if (!data.leaderboards || data.leaderboards.length === 0) {
        listEl.innerHTML = '<p class="friends-empty">No leaderboards yet. Create one or join with an invite link!</p>';
        return;
      }
      listEl.innerHTML = data.leaderboards.map(function (lb) {
        return '<button class="friends-board-item" data-id="' + lb.id + '">' +
          '<span class="friends-board-name">' + escapeHtml(lb.name) + '</span>' +
          '<span class="friends-board-members">' + lb.member_count + ' members</span>' +
        '</button>';
      }).join('');

      listEl.querySelectorAll('.friends-board-item').forEach(function (el) {
        el.addEventListener('click', function () {
          var id = parseInt(el.dataset.id);
          var lb = data.leaderboards.find(function (b) { return b.id === id; });
          renderStandings(lb);
        });
      });
    }).catch(function (err) {
      document.getElementById('friends-boards-list').innerHTML =
        '<p class="friends-error">Failed to load leaderboards.</p>';
    });
  }

  function renderCreateForm() {
    var container = getContainer();
    container.innerHTML =
      '<div class="friends-create-view">' +
        '<button id="friends-back" class="btn-back">&larr; Back</button>' +
        '<h2>Create Leaderboard</h2>' +
        '<div class="friends-input-group">' +
          '<input type="text" id="friends-lb-name" maxlength="30" placeholder="Leaderboard name">' +
          '<button id="friends-lb-create" class="btn-primary">Create</button>' +
        '</div>' +
      '</div>';

    document.getElementById('friends-back').addEventListener('click', renderLeaderboardList);

    var input = document.getElementById('friends-lb-name');
    var btn = document.getElementById('friends-lb-create');

    btn.addEventListener('click', function () {
      var val = input.value.trim();
      if (!val || val.length > 30) return;
      btn.disabled = true;
      btn.textContent = 'Creating...';
      createLeaderboard(val).then(function (data) {
        renderStandings({ id: data.id, name: data.name, invite_code: data.invite_code });
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Create';
        showToast('Error: ' + err.message);
      });
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') btn.click();
    });
  }

  function renderJoinForm(inviteCode) {
    var container = getContainer();
    var prefill = typeof inviteCode === 'string' ? inviteCode : '';
    container.innerHTML =
      '<div class="friends-join-view">' +
        '<button id="friends-back" class="btn-back">&larr; Back</button>' +
        '<h2>Join Leaderboard</h2>' +
        '<div class="friends-input-group">' +
          '<input type="text" id="friends-join-code" maxlength="8" placeholder="Invite code" value="' + escapeHtml(prefill) + '">' +
          '<button id="friends-join-btn" class="btn-primary">Join</button>' +
        '</div>' +
        '<div id="friends-join-preview"></div>' +
      '</div>';

    document.getElementById('friends-back').addEventListener('click', renderLeaderboardList);

    var input = document.getElementById('friends-join-code');
    var btn = document.getElementById('friends-join-btn');
    var preview = document.getElementById('friends-join-preview');

    function doJoin() {
      var code = input.value.trim().toLowerCase();
      if (!code || code.length !== 8) {
        showToast('Enter an 8-character invite code');
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Joining...';
      joinLeaderboard(code).then(function (data) {
        showToast('Joined "' + data.leaderboard.name + '"!');
        renderStandings({ id: data.leaderboard.id, name: data.leaderboard.name, invite_code: code });
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Join';
        showToast('Error: ' + err.message);
      });
    }

    btn.addEventListener('click', doJoin);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doJoin();
    });

    if (prefill) {
      getLeaderboardByCode(prefill).then(function (data) {
        preview.innerHTML =
          '<div class="friends-join-preview-card">' +
            '<strong>' + escapeHtml(data.name) + '</strong>' +
            '<span>' + data.member_count + ' members</span>' +
            '<span>Created by ' + escapeHtml(data.created_by_name || 'Unknown') + '</span>' +
          '</div>';
      }).catch(function () {});
    }
  }

  function renderStandings(lb) {
    var container = getContainer();
    state.currentView = 'standings';
    state.currentLeaderboard = lb;

    var today = new Date().toISOString().slice(0, 10);

    container.innerHTML =
      '<div class="friends-standings-view">' +
        '<button id="friends-back" class="btn-back">&larr; Back</button>' +
        '<h2>' + escapeHtml(lb.name) + '</h2>' +
        '<div class="friends-standings-tabs">' +
          '<button class="friends-tab active" data-period="today">Today</button>' +
          '<button class="friends-tab" data-period="week">This Week</button>' +
          '<button class="friends-tab" data-period="average">Average</button>' +
        '</div>' +
        '<div id="friends-standings-body" class="friends-standings-body">' +
          '<p class="friends-loading">Loading...</p>' +
        '</div>' +
        '<div class="friends-standings-actions">' +
          '<button id="friends-invite" class="btn-secondary">Copy Invite Link</button>' +
          '<button id="friends-leave" class="btn-danger">Leave</button>' +
        '</div>' +
      '</div>';

    document.getElementById('friends-back').addEventListener('click', renderLeaderboardList);

    document.getElementById('friends-invite').addEventListener('click', function () {
      var code = lb.invite_code;
      if (!code) {
        listLeaderboards().then(function (data) {
          var found = data.leaderboards.find(function (b) { return b.id === lb.id; });
          if (found) copyInviteLink(found.invite_code);
        });
      } else {
        copyInviteLink(code);
      }
    });

    document.getElementById('friends-leave').addEventListener('click', function () {
      if (!confirm('Leave "' + lb.name + '"? You can rejoin with the invite link.')) return;
      leaveLeaderboard(lb.id).then(function () {
        showToast('Left "' + lb.name + '"');
        renderLeaderboardList();
      }).catch(function (err) {
        showToast('Error: ' + err.message);
      });
    });

    var tabs = container.querySelectorAll('.friends-tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        state.standingsPeriod = tab.dataset.period;
        var period = tab.dataset.period;
        if (period === 'today') {
          loadStandings(lb.id, today, null);
        } else if (period === 'average') {
          loadStandings(lb.id, null, 'average');
        } else {
          loadStandings(lb.id, null, null);
        }
      });
    });

    loadStandings(lb.id, today, null);
  }

  function loadStandings(leaderboardId, date, period) {
    var body = document.getElementById('friends-standings-body');
    body.innerHTML = '<p class="friends-loading">Loading...</p>';

    getStandings(leaderboardId, date, period).then(function (data) {
      if (!data.standings || data.standings.length === 0) {
        body.innerHTML = '<p class="friends-empty">No standings yet.</p>';
        return;
      }
      var userId = getUserId();
      body.innerHTML =
        '<table class="friends-standings-table">' +
          '<thead><tr><th>#</th><th>Player</th><th>Score</th></tr></thead>' +
          '<tbody>' +
            data.standings.map(function (s) {
              var isMe = s.user_id === userId;
              var scoreText = s.score != null ? s.score : '-';
              return '<tr class="' + (isMe ? 'friends-me' : '') + '">' +
                '<td>' + s.rank + '</td>' +
                '<td>' + escapeHtml(s.display_name) + (isMe ? ' (you)' : '') + '</td>' +
                '<td>' + scoreText + '</td>' +
              '</tr>';
            }).join('') +
          '</tbody>' +
        '</table>';
    }).catch(function (err) {
      body.innerHTML = '<p class="friends-error">Failed to load standings.</p>';
    });
  }

  function copyInviteLink(code) {
    var url = 'https://guesstimate.offclock.dev/?join=' + code;
    navigator.clipboard.writeText(url).then(function () {
      showToast('Invite link copied!');
    }).catch(function () {
      showToast('Could not copy link');
    });
  }

  // --- Invite link handling ---

  function checkPendingJoin() {
    var params = new URLSearchParams(window.location.search);
    var joinCode = params.get('join');
    if (joinCode && /^[a-z0-9]{8}$/.test(joinCode)) {
      history.replaceState(null, '', window.location.pathname);
      if (!getDisplayName()) {
        localStorage.setItem('guessit_pending_join', joinCode);
      }
      pendingInvite = joinCode;
      return true;
    }
    var pending = localStorage.getItem('guessit_pending_join');
    if (pending) {
      localStorage.removeItem('guessit_pending_join');
      pendingInvite = pending;
      return true;
    }
    return false;
  }

  // --- Utilities ---

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function showToast(msg) {
    var existing = document.querySelector('.friends-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'friends-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function () { toast.classList.add('visible'); }, 10);
    setTimeout(function () {
      toast.classList.remove('visible');
      setTimeout(function () { toast.remove(); }, 300);
    }, 3000);
  }

  // --- Public API ---

  window.GuessitFriends = {
    show: show,
    submitScore: submitScore,
    checkPendingJoin: checkPendingJoin,
    getDisplayName: getDisplayName,
  };
})();
