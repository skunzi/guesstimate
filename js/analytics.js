(function () {
  'use strict';

  // var ANALYTICS_ENDPOINT = 'http://localhost:8787';
  var ANALYTICS_ENDPOINT = 'https://guessit-analytics.offclock.workers.dev';
  var UID_KEY = 'guessit_uid';
  var CONSENT_KEY = 'guessit_analytics_consent';
  var QUEUE_KEY = 'guessit_analytics_queue';
  var RESET_COUNT_KEY = 'guessit_reset_count';

  function getOrCreateUserId() {
    var uid = localStorage.getItem(UID_KEY);
    if (!uid) {
      uid = crypto.randomUUID();
      localStorage.setItem(UID_KEY, uid);
    }
    return uid;
  }

  function hasConsent() {
    return localStorage.getItem(CONSENT_KEY) === 'true';
  }

  function grantConsent() {
    localStorage.setItem(CONSENT_KEY, 'true');
    flushQueue();
  }

  function revokeConsent() {
    localStorage.setItem(CONSENT_KEY, 'false');
    localStorage.removeItem(QUEUE_KEY);
  }

  function getResetCount() {
    return parseInt(localStorage.getItem(RESET_COUNT_KEY) || '0', 10);
  }

  function incrementResetCount() {
    var count = getResetCount() + 1;
    localStorage.setItem(RESET_COUNT_KEY, String(count));
    return count;
  }

  function hashRound(round) {
    var str = JSON.stringify({
      date: round.date,
      category: round.category,
      question: round.question,
      photos: round.photos.map(function (p) { return p.file + ':' + p.subject; })
    });
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return (hash >>> 0).toString(36);
  }

  function track(eventType, data) {
    if (!ANALYTICS_ENDPOINT) return;
    if (['localhost', '127.0.0.1', ''].includes(window.location.hostname)) return;

    var event = Object.assign({
      user_id: getOrCreateUserId(),
      event_type: eventType
    }, data || {});

    if (!hasConsent()) {
      enqueue(event);
      return;
    }

    send([event]);
  }

  function enqueue(event) {
    try {
      var queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      queue.push(event);
      if (queue.length > 200) queue = queue.slice(-200);
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch (e) { /* ignore storage errors */ }
  }

  function flushQueue() {
    try {
      var queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      if (queue.length > 0) {
        send(queue);
        localStorage.removeItem(QUEUE_KEY);
      }
    } catch (e) { /* ignore */ }
  }

  function send(events) {
    if (!ANALYTICS_ENDPOINT || events.length === 0) return;

    var payload = JSON.stringify(events);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ANALYTICS_ENDPOINT + '/events', payload);
    } else {
      fetch(ANALYTICS_ENDPOINT + '/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true
      }).catch(function () {});
    }
  }

  window.GuessitAnalytics = {
    ENDPOINT: ANALYTICS_ENDPOINT,
    track: track,
    hasConsent: hasConsent,
    grantConsent: grantConsent,
    revokeConsent: revokeConsent,
    getResetCount: getResetCount,
    incrementResetCount: incrementResetCount,
    hashRound: hashRound,
    getOrCreateUserId: getOrCreateUserId
  };
})();
