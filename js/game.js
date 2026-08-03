(function () {
  'use strict';

  const STORAGE_KEY = 'guessit_data';
  const SCORE_CONSTANTS = {
    how_many: 1.5,
    how_tall: 3,
    how_old: 3
  };

  let rounds = [];
  let currentRound = null;
  let currentPhotoIndex = 0;
  let roundScores = [];
  let roundGuesses = [];
  let calendarDate = new Date();

  // --- Obfuscation ---

  function encode(value) {
    return btoa(String(value)).split('').reverse().join('');
  }

  function decode(encoded) {
    return Number(atob(encoded.split('').reverse().join('')));
  }

  // --- Storage ---

  function loadStorage() {
    try {
      var data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || { played: {} };
      if (!data.inProgress) data.inProgress = {};
      return data;
    } catch {
      return { played: {}, inProgress: {} };
    }
  }

  function saveStorage(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function saveRoundResult(date, scores, guesses, category) {
    const data = loadStorage();
    const total = scores.reduce((a, b) => a + b, 0);
    data.played[date] = { scores, guesses, total, category, playedAt: Date.now() };
    delete data.inProgress[date];
    saveStorage(data);
  }

  function saveProgress(date, scores, guesses, photoIndex, category) {
    const data = loadStorage();
    data.inProgress[date] = { scores, guesses, photoIndex, category };
    saveStorage(data);
  }

  // --- Scoring ---

  function calculateScore(guess, answer, category) {
    const k = SCORE_CONSTANTS[category] || 5;
    var score;
    if (category === 'how_old') {
      var age = Math.max(60, new Date().getFullYear() - answer);
      var error = Math.abs(guess - answer);
      score = Math.round(1000 * Math.exp(-k * error / age));
    } else {
      var errorRatio = Math.abs(guess - answer) / answer;
      score = Math.round(1000 * Math.exp(-k * errorRatio));
    }
    return Math.max(0, Math.min(1000, score));
  }

  // --- Round Loading ---

  async function loadRounds() {
    const response = await fetch('data/rounds.json');
    const data = await response.json();
    rounds = data.map(function (round) {
      return {
        date: round.date,
        category: round.category,
        question: round.question,
        unit: round.unit,
        photos: round.photos.map(function (photo) {
          return {
            file: photo.file,
            subject: photo.subject,
            answer: encode(photo.answer),
            fun_fact: photo.fun_fact
          };
        })
      };
    });
  }

  function getRoundByDate(dateStr) {
    return rounds.find(function (r) { return r.date === dateStr; });
  }

  function getTodayStr() {
    return new Date().toISOString().split('T')[0];
  }

  // --- Game Flow ---

  function startRound(round, progress) {
    currentRound = round;
    if (progress && progress.photoIndex < 4) {
      currentPhotoIndex = progress.photoIndex;
      roundScores = progress.scores.slice();
      roundGuesses = progress.guesses.slice();
    } else {
      currentPhotoIndex = 0;
      roundScores = [];
      roundGuesses = [];
    }

    const gameArea = document.querySelector('.game-area');
    const roundComplete = document.querySelector('.round-complete');
    const noRound = document.querySelector('.no-round');
    const reviewMode = document.querySelector('.review-mode');
    const gameHeader = document.querySelector('.game-header');

    gameArea.classList.remove('hidden');
    gameHeader.classList.remove('hidden');
    roundComplete.classList.add('hidden');
    noRound.classList.add('hidden');
    reviewMode.classList.add('hidden');

    document.querySelector('.category-title').textContent = getCategoryLabel(round.category);
    updateProgressDots();
    showCurrentPhoto();
  }

  function getCategoryLabel(category) {
    switch (category) {
      case 'how_many': return 'How Many?';
      case 'how_tall': return 'How Tall?';
      case 'how_old': return 'How Old Is It?';
      default: return category;
    }
  }

  function getSliderConfig(category) {
    if (category === 'how_old') {
      return { min: 0, max: 2030, step: 1, initial: 1900, digits: 4, power: 0.4, sliderSteps: 1000 };
    } else if (category === 'how_tall') {
      return { min: 1, max: 900, step: 1, initial: 150, digits: 3 };
    } else {
      return { min: 0, max: 140000, step: 100, initial: 30000, digits: 6, power: 2.5, sliderSteps: 1000 };
    }
  }

  function sliderToValue(pos, config) {
    if (!config.power) return pos;
    var ratio = pos / config.sliderSteps;
    var value = config.min + Math.pow(ratio, config.power) * (config.max - config.min);
    return Math.round(value / config.step) * config.step;
  }

  function valueToSlider(value, config) {
    if (!config.power) return value;
    var ratio = (value - config.min) / (config.max - config.min);
    return Math.round(Math.pow(Math.max(0, ratio), 1 / config.power) * config.sliderSteps);
  }

  function createDigitBoxes(count) {
    var container = document.querySelector('.digit-inputs');
    container.innerHTML = '';
    for (var i = 0; i < count; i++) {
      var input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.pattern = '[0-9]';
      input.maxLength = 1;
      input.className = 'digit-box';
      input.dataset.index = i;
      container.appendChild(input);
    }
  }

  function setDigitBoxesValue(value, digitCount) {
    var str = String(value).padStart(digitCount, '0');
    var boxes = document.querySelectorAll('.digit-box');
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].value = str[i] || '';
    }
  }

  function getDigitBoxesValue() {
    var boxes = document.querySelectorAll('.digit-box');
    var str = '';
    for (var i = 0; i < boxes.length; i++) {
      str += boxes[i].value || '0';
    }
    return parseInt(str, 10);
  }

  function setupDigitNavigation() {
    var boxes = document.querySelectorAll('.digit-box');
    boxes.forEach(function (box, idx) {
      box.addEventListener('input', function () {
        var val = box.value.replace(/[^0-9]/g, '');
        box.value = val.slice(-1);
        if (val && idx < boxes.length - 1) {
          boxes[idx + 1].focus();
          boxes[idx + 1].select();
        }
        syncSliderFromDigits();
      });

      box.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace' && !box.value && idx > 0) {
          boxes[idx - 1].focus();
          boxes[idx - 1].select();
        } else if (e.key === 'ArrowLeft' && idx > 0) {
          e.preventDefault();
          boxes[idx - 1].focus();
          boxes[idx - 1].select();
        } else if (e.key === 'ArrowRight' && idx < boxes.length - 1) {
          e.preventDefault();
          boxes[idx + 1].focus();
          boxes[idx + 1].select();
        } else if (e.key === 'Enter') {
          submitGuess();
        }
      });

      box.addEventListener('focus', function () {
        box.select();
      });
    });
  }

  function syncSliderFromDigits() {
    var val = getDigitBoxesValue();
    var slider = document.querySelector('.guess-slider');
    if (currentRound) {
      var config = getSliderConfig(currentRound.category);
      var clamped = Math.max(config.min, Math.min(config.max, val));
      slider.value = config.power ? valueToSlider(clamped, config) : clamped;
    }
  }

  var photoLoadTimeout = null;

  function showCurrentPhoto() {
    const photo = currentRound.photos[currentPhotoIndex];
    const img = document.querySelector('.photo');
    const questionText = document.querySelector('.question-text');
    const unitLabel = document.querySelector('.unit-label');
    const guessSlider = document.querySelector('.guess-slider');
    const guessSection = document.querySelector('.guess-section');
    const resultSection = document.querySelector('.result-section');

    guessSection.classList.add('hidden');
    resultSection.classList.add('hidden');

    if (photoLoadTimeout) {
      clearTimeout(photoLoadTimeout);
      photoLoadTimeout = null;
    }

    var revealed = false;
    function revealGuessSection() {
      if (revealed) return;
      revealed = true;
      if (photoLoadTimeout) { clearTimeout(photoLoadTimeout); photoLoadTimeout = null; }
      img.style.opacity = '1';
      guessSection.classList.remove('hidden');
    }

    var retried = false;
    img.style.opacity = '0';
    img.onload = revealGuessSection;
    img.onerror = function () {
      if (!retried) {
        retried = true;
        img.src = 'media/' + photo.file + '?retry=' + Date.now();
      } else {
        revealGuessSection();
      }
    };
    img.src = 'media/' + photo.file;
    img.alt = 'Guess this!';
    if (img.complete && img.naturalWidth > 0) {
      revealGuessSection();
    } else {
      photoLoadTimeout = setTimeout(revealGuessSection, 8000);
    }
    questionText.textContent = currentRound.question;
    unitLabel.textContent = currentRound.unit;

    var config = getSliderConfig(currentRound.category);
    if (config.power) {
      guessSlider.min = 0;
      guessSlider.max = config.sliderSteps;
      guessSlider.step = 1;
      guessSlider.value = valueToSlider(config.initial, config);
    } else {
      guessSlider.min = config.min;
      guessSlider.max = config.max;
      guessSlider.step = config.step;
      guessSlider.value = config.initial;
    }

    createDigitBoxes(config.digits);
    setDigitBoxesValue(config.initial, config.digits);
    setupDigitNavigation();
  }

  function submitGuess() {
    var guess = getDigitBoxesValue();

    if (isNaN(guess) || guess < 0) {
      var container = document.querySelector('.digit-inputs');
      container.classList.add('shake');
      setTimeout(function () { container.classList.remove('shake'); }, 300);
      return;
    }

    const photo = currentRound.photos[currentPhotoIndex];
    const answer = decode(photo.answer);
    const score = calculateScore(guess, answer, currentRound.category);
    roundScores.push(score);
    roundGuesses.push(guess);

    saveProgress(currentRound.date, roundScores, roundGuesses, currentPhotoIndex + 1, currentRound.category);

    showResult(score, answer, photo, guess);
  }

  function showResult(score, answer, photo, guess) {
    const guessSection = document.querySelector('.guess-section');
    const resultSection = document.querySelector('.result-section');
    const scoreValue = document.querySelector('.score-value');
    const resultAnswer = document.querySelector('.result-answer');
    const resultFunFact = document.querySelector('.result-fun-fact');
    const nextBtn = document.querySelector('.next-photo');

    guessSection.classList.add('hidden');
    resultSection.classList.remove('hidden');

    scoreValue.textContent = score;
    scoreValue.className = 'score-value';
    if (score >= 800) {
      scoreValue.classList.add('high');
    } else if (score >= 400) {
      scoreValue.classList.add('medium');
    } else {
      scoreValue.classList.add('low');
    }

    if (score === 1000) {
      launchConfetti();
    }

    let answerText = '';
    if (currentRound.category === 'how_old') {
      answerText = photo.subject + ' is from ' + answer + '. You guessed ' + guess + '.';
    } else if (currentRound.category === 'how_tall') {
      answerText = photo.subject + ' is ' + answer + 'm tall. You guessed ' + guess + 'm.';
    } else {
      answerText = photo.subject + ' holds ' + answer.toLocaleString() + ' people. You guessed ' + guess.toLocaleString() + '.';
    }
    resultAnswer.textContent = answerText;
    resultFunFact.textContent = photo.fun_fact;

    if (currentPhotoIndex >= 3) {
      nextBtn.textContent = 'See Results';
    } else {
      nextBtn.textContent = 'Next';
    }

    updateProgressDots();
  }

  function nextPhoto() {
    currentPhotoIndex++;
    if (currentPhotoIndex >= 4) {
      showRoundComplete();
    } else {
      updateProgressDots();
      showCurrentPhoto();
    }
  }

  function showRoundComplete() {
    const gameArea = document.querySelector('.game-area');
    const roundComplete = document.querySelector('.round-complete');
    const totalValue = document.querySelector('.total-value');
    const roundSummary = document.querySelector('.round-summary');

    gameArea.classList.add('hidden');
    roundComplete.classList.remove('hidden');

    const total = roundScores.reduce(function (a, b) { return a + b; }, 0);
    totalValue.textContent = total;

    if (total >= 3200) {
      totalValue.style.color = 'var(--color-great)';
    } else if (total >= 2000) {
      totalValue.style.color = 'var(--color-good)';
    } else if (total >= 1000) {
      totalValue.style.color = 'var(--color-ok)';
    } else {
      totalValue.style.color = 'var(--color-poor)';
    }

    roundSummary.innerHTML = '';
    currentRound.photos.forEach(function (photo, i) {
      var item = document.createElement('div');
      item.className = 'summary-item';
      item.innerHTML = '<span class="summary-item-name">' + photo.subject + '</span>' +
        '<span class="summary-item-score">' + roundScores[i] + '</span>';
      roundSummary.appendChild(item);
    });

    saveRoundResult(currentRound.date, roundScores, roundGuesses, currentRound.category);
    updateProgressDots();
  }

  // --- Review Mode (already played) ---

  let reviewRound = null;
  let reviewData = null;

  function showReview(round, playedData) {
    reviewRound = round;
    reviewData = playedData;

    const gameArea = document.querySelector('.game-area');
    const roundComplete = document.querySelector('.round-complete');
    const noRound = document.querySelector('.no-round');
    const reviewMode = document.querySelector('.review-mode');
    const gameHeader = document.querySelector('.game-header');

    gameArea.classList.add('hidden');
    roundComplete.classList.add('hidden');
    noRound.classList.add('hidden');
    gameHeader.classList.add('hidden');
    reviewMode.classList.remove('hidden');

    document.querySelector('.review-title').textContent =
      getCategoryLabel(round.category) + ' — ' + round.date;

    var totalValue = document.querySelector('.review-total-value');
    totalValue.textContent = playedData.total;
    if (playedData.total >= 3200) totalValue.style.color = 'var(--color-great)';
    else if (playedData.total >= 2000) totalValue.style.color = 'var(--color-good)';
    else if (playedData.total >= 1000) totalValue.style.color = 'var(--color-ok)';
    else totalValue.style.color = 'var(--color-poor)';

    var grid = document.querySelector('.review-grid');
    grid.innerHTML = '';

    round.photos.forEach(function (photo, i) {
      var answer = decode(photo.answer);
      var score = playedData.scores[i];
      var guess = playedData.guesses ? playedData.guesses[i] : null;

      var answerText = '';
      var guessText = '';
      if (round.category === 'how_old') {
        answerText = 'Answer: ' + answer;
        guessText = guess !== null ? 'Your guess: ' + guess : '';
      } else if (round.category === 'how_tall') {
        answerText = 'Answer: ' + answer + 'm';
        guessText = guess !== null ? 'Your guess: ' + guess + 'm' : '';
      } else {
        answerText = 'Answer: ' + answer.toLocaleString();
        guessText = guess !== null ? 'Your guess: ' + guess.toLocaleString() : '';
      }

      var scoreClass = 'low';
      if (score >= 800) scoreClass = 'high';
      else if (score >= 400) scoreClass = 'medium';

      var card = document.createElement('div');
      card.className = 'review-card';
      card.innerHTML =
        '<img class="review-card-img" src="media/' + photo.file + '" alt="' + photo.subject + '">' +
        '<div class="review-card-body">' +
          '<div class="review-card-subject">' + photo.subject + '</div>' +
          '<div class="review-card-answer">' + answerText + '</div>' +
          (guessText ? '<div class="review-card-guess">' + guessText + '</div>' : '') +
          '<div class="review-card-fact">' + photo.fun_fact + '</div>' +
          '<span class="review-card-score ' + scoreClass + '">' + score + ' pts</span>' +
        '</div>';
      grid.appendChild(card);
    });
  }

  function hideReview() {
    document.querySelector('.review-mode').classList.add('hidden');
    document.querySelector('.game-header').classList.remove('hidden');
    reviewRound = null;
    reviewData = null;
  }

  function updateProgressDots() {
    const dots = document.querySelectorAll('.dot');
    dots.forEach(function (dot, i) {
      dot.className = 'dot';
      if (i < currentPhotoIndex) {
        dot.classList.add('completed');
      } else if (i === currentPhotoIndex) {
        dot.classList.add('active');
      }
    });

    document.querySelector('.game-round-counter').textContent =
      Math.min(currentPhotoIndex + 1, 4) + '/4';

    var runningTotal = roundScores.reduce(function (a, b) { return a + b; }, 0);
    document.querySelector('.game-running-score').textContent = runningTotal + ' pts';
  }

  // --- Share ---

  function shareResult() {
    var round = currentRound || reviewRound;
    var scores = currentRound ? roundScores : (reviewData ? reviewData.scores : []);
    if (!round || scores.length === 0) return;

    const total = scores.reduce(function (a, b) { return a + b; }, 0);
    const emojis = scores.map(function (s) {
      if (s >= 900) return '⭐';
      if (s >= 700) return '🟢';
      if (s >= 400) return '🟡';
      return '🔴';
    }).join(' ');

    const text = 'Guesstimate ' + round.date + '\n' +
      getCategoryLabel(round.category) + '\n' +
      emojis + '\n' +
      'Score: ' + total + '/4000';

    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () {
        showToast('Copied to clipboard!');
      });
    } else {
      showToast('Share: ' + total + '/4000');
    }
  }

  // --- Calendar ---

  function renderCalendar() {
    const title = document.querySelector('.calendar-month-title');
    const daysContainer = document.querySelector('.calendar-days');
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();

    title.textContent = calendarDate.toLocaleString('default', { month: 'long', year: 'numeric' });

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    let startDow = firstDay.getDay();
    if (startDow === 0) startDow = 7;

    const today = getTodayStr();
    const storage = loadStorage();

    daysContainer.innerHTML = '';

    for (let i = 1; i < startDow; i++) {
      var spacer = document.createElement('div');
      spacer.className = 'calendar-day';
      daysContainer.appendChild(spacer);
    }

    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const dayEl = document.createElement('div');
      dayEl.className = 'calendar-day';
      dayEl.textContent = d;

      const round = getRoundByDate(dateStr);

      if (round && dateStr <= today) {
        dayEl.classList.add('has-round');
        dayEl.classList.add('cat-' + round.category);
        if (storage.played[dateStr]) {
          dayEl.classList.add('played');
        } else if (storage.inProgress[dateStr]) {
          dayEl.classList.add('in-progress');
        }
        dayEl.addEventListener('click', function () {
          if (storage.played[dateStr]) {
            switchToView('game');
            showReview(round, storage.played[dateStr]);
            return;
          }
          switchToView('game');
          startRound(round, storage.inProgress[dateStr] || null);
        });
      }

      daysContainer.appendChild(dayEl);
    }
  }

  // --- Stats ---

  function renderStats() {
    const data = loadStorage();
    const played = Object.keys(data.played);
    const scores = played.map(function (d) { return data.played[d].total; });

    document.getElementById('stat-played').textContent = played.length;
    var totalPoints = scores.reduce(function (a, b) { return a + b; }, 0);
    document.getElementById('stat-total-points').textContent = totalPoints.toLocaleString();

    var perfectCount = 0;
    played.forEach(function (d) {
      var entry = data.played[d];
      if (entry.scores) {
        entry.scores.forEach(function (s) { if (s === 1000) perfectCount++; });
      }
    });
    document.getElementById('stat-perfect').textContent = perfectCount;

    if (scores.length > 0) {
      const avg = Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length);
      document.getElementById('stat-average').textContent = avg;

      const bestScore = Math.max.apply(null, scores);
      const worstScore = Math.min.apply(null, scores);
      const bestDate = played.find(function (d) { return data.played[d].total === bestScore; });
      const worstDate = played.find(function (d) { return data.played[d].total === worstScore; });

      var bestEl = document.getElementById('stat-best');
      bestEl.textContent = bestScore;
      bestEl.parentElement.querySelector('.stat-date').textContent = bestDate;
      bestEl.parentElement.classList.add('clickable');
      bestEl.parentElement.onclick = function () {
        var round = getRoundByDate(bestDate);
        if (round) { switchToView('game'); showReview(round, data.played[bestDate]); }
      };

      var worstEl = document.getElementById('stat-worst');
      worstEl.textContent = worstScore;
      worstEl.parentElement.querySelector('.stat-date').textContent = worstDate;
      worstEl.parentElement.classList.add('clickable');
      worstEl.parentElement.onclick = function () {
        var round = getRoundByDate(worstDate);
        if (round) { switchToView('game'); showReview(round, data.played[worstDate]); }
      };
    } else {
      document.getElementById('stat-average').textContent = '-';
      document.getElementById('stat-best').textContent = '-';
      document.getElementById('stat-worst').textContent = '-';
      document.getElementById('stat-best').parentElement.querySelector('.stat-date').textContent = '';
      document.getElementById('stat-worst').parentElement.querySelector('.stat-date').textContent = '';
    }

    const historyList = document.querySelector('.history-list');
    historyList.innerHTML = '';
    const sortedDates = played.sort().reverse().slice(0, 10);
    sortedDates.forEach(function (date) {
      const entry = data.played[date];
      const item = document.createElement('div');
      item.className = 'history-item clickable';
      item.innerHTML =
        '<span class="history-date">' + date + '</span>' +
        '<span class="history-category">' + getCategoryLabel(entry.category) + '</span>' +
        '<span class="history-score">' + entry.total + '</span>';
      item.onclick = function () {
        var round = getRoundByDate(date);
        if (round) { switchToView('game'); showReview(round, data.played[date]); }
      };
      historyList.appendChild(item);
    });
  }

  // --- Navigation ---

  function switchToView(viewName) {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    document.querySelectorAll('.nav-btn').forEach(function (b) { b.classList.remove('active'); });

    document.getElementById('view-' + viewName).classList.add('active');
    document.querySelector('[data-view="' + viewName + '"]').classList.add('active');

    if (viewName !== 'game' && (reviewRound || reviewData)) hideReview();
    if (viewName === 'calendar') renderCalendar();
    if (viewName === 'stats') renderStats();
    if (viewName === 'game' && !currentRound && !reviewRound) {
      loadGameView();
    }
  }

  function loadGameView() {
    var today = getTodayStr();
    var todayRound = getRoundByDate(today);
    var storage = loadStorage();

    if (todayRound && !storage.played[today]) {
      startRound(todayRound, storage.inProgress[today] || null);
    } else if (todayRound && storage.played[today]) {
      showReview(todayRound, storage.played[today]);
    } else {
      document.querySelector('.game-area').classList.add('hidden');
      document.querySelector('.game-header').classList.add('hidden');
      document.querySelector('.round-complete').classList.add('hidden');
      document.querySelector('.review-mode').classList.add('hidden');
      document.querySelector('.no-round').classList.remove('hidden');
    }
  }

  // --- Confetti ---

  function launchConfetti() {
    var canvas = document.getElementById('confetti-canvas');
    var ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    var particles = [];
    var colors = ['#e94560', '#4ecdc4', '#ffe66d', '#ff6b81', '#95e1d3', '#ffffff'];

    for (var i = 0; i < 150; i++) {
      particles.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 200,
        y: canvas.height / 2,
        vx: (Math.random() - 0.5) * 15,
        vy: Math.random() * -18 - 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 8 + 4,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 10,
        gravity: 0.4 + Math.random() * 0.2,
        opacity: 1
      });
    }

    var startTime = performance.now();
    var duration = 2500;

    function animate(now) {
      var elapsed = now - startTime;
      if (elapsed > duration) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.x += p.vx;
        p.vy += p.gravity;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;
        p.vx *= 0.98;
        p.opacity = Math.max(0, 1 - elapsed / duration);

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation * Math.PI / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }

      requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
  }

  // --- Toast ---

  function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(function () { toast.classList.add('hidden'); }, 2500);
  }

  // --- Init ---

  // --- Welcome Modal ---

  function setupWelcomeModal() {
    var overlay = document.getElementById('welcome-overlay');

    function dismiss() {
      overlay.classList.add('hidden');
      document.body.classList.remove('modal-open');
      localStorage.setItem('guessit_welcomed', 'true');
    }

    function show() {
      overlay.classList.remove('hidden');
      document.body.classList.add('modal-open');
    }

    document.getElementById('welcome-got-it').addEventListener('click', dismiss);
    document.getElementById('welcome-close').addEventListener('click', dismiss);
    document.getElementById('welcome-feedback').addEventListener('click', function () {
      var email = 'info@offclock.dev';
      navigator.clipboard.writeText(email).then(function () {
        var btn = document.getElementById('welcome-feedback');
        var original = btn.textContent;
        btn.textContent = '✓ Email copied to clipboard!';
        setTimeout(function () { btn.textContent = original; }, 2000);
      });
    });
    var confirmOverlay = document.getElementById('confirm-reset-overlay');
    document.getElementById('welcome-reset').addEventListener('click', function () {
      confirmOverlay.classList.remove('hidden');
    });
    document.getElementById('confirm-reset-cancel').addEventListener('click', function () {
      confirmOverlay.classList.add('hidden');
    });
    document.getElementById('confirm-reset-confirm').addEventListener('click', function () {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    });
    confirmOverlay.addEventListener('click', function (e) {
      if (e.target === confirmOverlay) confirmOverlay.classList.add('hidden');
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) dismiss();
    });
    document.getElementById('help-btn').addEventListener('click', show);

    if (!localStorage.getItem('guessit_welcomed')) {
      show();
    }
  }

  async function init() {
    await loadRounds();
    setupWelcomeModal();

    // Navigation
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.dataset.view) switchToView(btn.dataset.view);
      });
    });

    // Game controls
    document.querySelector('.submit-guess').addEventListener('click', submitGuess);

    var slider = document.querySelector('.guess-slider');
    slider.addEventListener('input', function () {
      if (currentRound) {
        var config = getSliderConfig(currentRound.category);
        var displayValue = sliderToValue(parseInt(slider.value), config);
        setDigitBoxesValue(displayValue, config.digits);
      }
    });

    document.querySelector('.next-photo').addEventListener('click', nextPhoto);
    document.querySelector('.share-btn').addEventListener('click', shareResult);
    document.querySelector('.play-another').addEventListener('click', function () {
      switchToView('calendar');
    });
    document.querySelector('.go-calendar').addEventListener('click', function () {
      switchToView('calendar');
    });
    document.querySelector('.share-btn-review').addEventListener('click', shareResult);
    document.querySelector('.back-to-calendar').addEventListener('click', function () {
      switchToView('calendar');
    });

    // Calendar navigation
    document.querySelector('.prev-month').addEventListener('click', function () {
      calendarDate.setMonth(calendarDate.getMonth() - 1);
      renderCalendar();
    });
    document.querySelector('.next-month').addEventListener('click', function () {
      calendarDate.setMonth(calendarDate.getMonth() + 1);
      renderCalendar();
    });

    // Load today's round
    const today = getTodayStr();
    const todayRound = getRoundByDate(today);
    const storage = loadStorage();

    if (todayRound && !storage.played[today]) {
      startRound(todayRound, storage.inProgress[today] || null);
    } else if (todayRound && storage.played[today]) {
      showReview(todayRound, storage.played[today]);
    } else {
      document.querySelector('.game-area').classList.add('hidden');
      document.querySelector('.no-round').classList.remove('hidden');
    }
  }

  init();
})();
