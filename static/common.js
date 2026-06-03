/**
 * Yearworm — Game Logic Module
 */

// ── Navbar / footer templates ──────────────────────────────────────────────

const navbarHTML = `
<nav class="navbar">
  <div class="navbar-container">
    <a href="/" class="navbar-logo">
      <img src="/static/logo.png" alt="Yearworm Logo" class="navbar-logo-img">
      Yearworm
    </a>
    <ul class="navbar-menu">
      <li><a href="/" class="navbar-item">Home</a></li>
      <li><a href="/daily" class="navbar-item">Daily</a></li>
      <li><a href="/free_options" class="navbar-item">Free Play</a></li>
    </ul>
  </div>
</nav>
`;

const footerHTML = `
<footer>
  <p>
    <a href="https://twcrockett.github.io/" target="_blank">
      <img src="https://avatars.githubusercontent.com/u/79346208?v=4" class="footer-avatar" alt="Tay's avatar">
    </a>
    Made by Tay &nbsp;|&nbsp; <a href="https://github.com/twcrockett/yearworm" target="_blank">GitHub</a>
  </p>
</footer>
`;

// ── Global audio management ────────────────────────────────────────────────

let _currentAudio = null;

function stopAllAudio() {
    if (_currentAudio) {
        try { _currentAudio.pause(); _currentAudio.currentTime = 0; } catch (_) {}
        _currentAudio = null;
    }
    document.querySelectorAll('audio').forEach(a => {
        try { a.pause(); a.currentTime = 0; } catch (_) {}
    });
}

window.addEventListener('beforeunload', stopAllAudio);

// ── Timeline constants ─────────────────────────────────────────────────────

const TIMELINE_MIN = 1950;
const TIMELINE_MAX = 2024;

function yearToPercent(year) {
    const clamped = Math.max(TIMELINE_MIN, Math.min(TIMELINE_MAX, year));
    return ((clamped - TIMELINE_MIN) / (TIMELINE_MAX - TIMELINE_MIN)) * 100;
}

function distClass(diff) {
    if (diff === 0) return 'exact';
    if (diff <= 2)  return 'close';
    if (diff <= 10) return 'warm';
    if (diff <= 25) return 'cold';
    return 'far';
}

// ── YearwormGame class ─────────────────────────────────────────────────────

class YearwormGame {
    constructor(options = {}) {
        this.options = {
            mode: 'free',
            hintsEnabled: false,
            unlimitedGuesses: false,
            unlimitedMode: false,
            ...options,
        };

        this.state = {
            currentRound:        1,
            score:               100,
            totalYearsDifference: 0,
            totalRounds:         0,
            songResults:         [],
            pendingResult:       null,   // data from last check-guess, used in showRoundResult
            trackViewUrl:        null,   // Apple Music link for current song
            submitting:          false,  // guard against double-submit
            isCompleted:         false,  // daily already completed today
        };

        this.elements = {};
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    initialize(elements) {
        this.elements = elements;

        // Render initial worm health bar segments
        this._renderWormSegments(10);
        this._updateWormBar(100);

        // Set up hint buttons if hints enabled
        if (this.options.hintsEnabled) {
            this._injectHintButtons();
        }

        // Set up static listeners (once, not per-round)
        this._setupListeners();
    }

    start() {
        if (this.options.mode === 'daily') {
            // Check if already completed today
            const completed = this._checkDailyCompletion();
            if (completed) return;

            // Check for in-progress session
            this._checkDailyProgress();
        }
        this.loadNewSong();
    }

    // ── View switching ─────────────────────────────────────────────────────

    showView(name) {
        const app = document.getElementById('game-app');
        if (app) app.dataset.view = name;
    }

    // ── Song loading ───────────────────────────────────────────────────────

    loadNewSong() {
        stopAllAudio();
        this._clearGuessForm();

        const wrapper = this.elements.audioWrapper;
        if (wrapper) {
            wrapper.innerHTML = '<div class="no-preview-player">Loading song...</div>';
        }

        fetch('/get-song')
            .then(r => r.json())
            .then(song => {
                if (song.gameOver) {
                    this._showResults(song.finalScore);
                    return;
                }

                this.state.currentRound = song.round;
                this.state.trackViewUrl = song.trackViewUrl || null;

                // Update round counter (free mode)
                if (this.elements.freeRoundSpan) {
                    this.elements.freeRoundSpan.textContent = song.round;
                }

                // Update progress dots (daily mode)
                if (this.options.mode === 'daily') {
                    this._updateProgressDots(song.round);
                }

                // Build custom audio player
                this._buildAudioPlayer(song.previewUrl);

                // Show game view
                this.showView('game');
            })
            .catch(err => {
                console.error('Error loading song:', err);
                if (this.elements.audioWrapper) {
                    this.elements.audioWrapper.innerHTML = '<div class="no-preview-player">Error loading song. Try refreshing.</div>';
                }
            });
    }

    // ── Custom audio player ────────────────────────────────────────────────

    _buildAudioPlayer(previewUrl) {
        const wrapper = this.elements.audioWrapper;
        if (!wrapper) return;

        if (!previewUrl) {
            wrapper.innerHTML = '<div class="no-preview-player">No preview available for this song — give it your best guess!</div>';
            _currentAudio = null;
            return;
        }

        wrapper.innerHTML = `
            <div class="custom-player" id="custom-player">
                <button class="play-pause-btn" id="play-pause-btn" aria-label="Play">▶</button>
                <div class="player-right">
                    <div class="player-label">30-second preview</div>
                    <div class="progress-bar" id="progress-bar">
                        <div class="progress-fill" id="progress-fill"></div>
                    </div>
                    <div class="time-row">
                        <span id="current-time">0:00</span>
                        <span id="total-time">0:30</span>
                    </div>
                </div>
            </div>
            <audio id="hidden-audio" preload="auto" style="display:none">
                <source src="${previewUrl}" type="audio/mpeg">
                <source src="${previewUrl}" type="audio/mp4">
            </audio>
        `;

        const audio    = document.getElementById('hidden-audio');
        const playBtn  = document.getElementById('play-pause-btn');
        const fill     = document.getElementById('progress-fill');
        const bar      = document.getElementById('progress-bar');
        const curTime  = document.getElementById('current-time');
        const totTime  = document.getElementById('total-time');

        _currentAudio = audio;

        const fmt = s => {
            const m = Math.floor(s / 60);
            const sec = Math.floor(s % 60);
            return m + ':' + String(sec).padStart(2, '0');
        };

        audio.addEventListener('timeupdate', () => {
            if (!audio.duration) return;
            const pct = (audio.currentTime / audio.duration) * 100;
            fill.style.width = pct + '%';
            curTime.textContent = fmt(audio.currentTime);
        });

        audio.addEventListener('loadedmetadata', () => {
            totTime.textContent = fmt(audio.duration);
        });

        audio.addEventListener('ended', () => {
            playBtn.textContent = '▶';
        });

        playBtn.addEventListener('click', () => {
            if (audio.paused) {
                audio.play().catch(() => {});
                playBtn.textContent = '⏸';
            } else {
                audio.pause();
                playBtn.textContent = '▶';
            }
        });

        bar.addEventListener('click', e => {
            if (!audio.duration) return;
            const rect = bar.getBoundingClientRect();
            const pct  = (e.clientX - rect.left) / rect.width;
            audio.currentTime = pct * audio.duration;
        });

        // Autoplay
        const savedVol = localStorage.getItem('yearworm_volume');
        audio.volume = savedVol !== null ? parseFloat(savedVol) : 0.6;
        audio.addEventListener('volumechange', () => {
            localStorage.setItem('yearworm_volume', audio.volume);
        });

        setTimeout(() => {
            if (document.hasFocus()) {
                audio.play()
                    .then(() => { playBtn.textContent = '⏸'; })
                    .catch(() => { /* autoplay blocked — user can click */ });
            }
        }, 400);
    }

    // ── Listeners ──────────────────────────────────────────────────────────

    _setupListeners() {
        const { guessBtn, skipBtn, yearInput, nextRoundBtn, copyBtn } = this.elements;

        if (guessBtn)    guessBtn.addEventListener('click', () => this._checkGuess());
        if (skipBtn)     skipBtn.addEventListener('click',  () => this._skipSong());
        if (yearInput)   yearInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') this._checkGuess();
        });
        if (nextRoundBtn) nextRoundBtn.addEventListener('click', () => this._onNextRound());
        if (copyBtn)      copyBtn.addEventListener('click', () => this.copyResults());
    }

    _setupHintListener(type, btn) {
        btn.addEventListener('click', () => this._revealHint(type, btn));
    }

    _injectHintButtons() {
        const { titleItem, artistItem } = this.elements;
        if (titleItem) {
            const btn = document.createElement('button');
            btn.className = 'hint-btn';
            btn.textContent = '? hint';
            btn.id = 'title-hint-btn';
            titleItem.appendChild(btn);
            this._setupHintListener('title', btn);
        }
        if (artistItem) {
            const btn = document.createElement('button');
            btn.className = 'hint-btn';
            btn.textContent = '? hint';
            btn.id = 'artist-hint-btn';
            artistItem.appendChild(btn);
            this._setupHintListener('artist', btn);
        }
    }

    // ── Guess handling ─────────────────────────────────────────────────────

    _checkGuess() {
        if (this.state.submitting) return;

        const input  = this.elements.yearInput;
        const errEl  = this.elements.inputError;
        if (!input) return;

        const raw   = input.value.trim();
        const guess = parseInt(raw, 10);
        const currentYear = new Date().getFullYear();

        if (isNaN(guess) || guess < 1900 || guess > currentYear) {
            if (errEl) errEl.textContent = 'Enter a year between 1900 and ' + currentYear;
            input.classList.add('shake');
            setTimeout(() => input.classList.remove('shake'), 400);
            return;
        }
        if (errEl) errEl.textContent = '';

        this.state.submitting = true;
        this._disableGuessForm();

        fetch('/check-guess', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ guess, is_skip: false }),
        })
        .then(r => r.json())
        .then(data => {
            this.state.submitting = false;
            this._handleGuessResponse(data, guess, false);
        })
        .catch(err => {
            console.error('check-guess error:', err);
            this.state.submitting = false;
            this._enableGuessForm();
        });
    }

    _skipSong() {
        if (this.state.submitting) return;
        this.state.submitting = true;
        this._disableGuessForm();

        fetch('/check-guess', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ guess: 0, is_skip: true }),
        })
        .then(r => r.json())
        .then(data => {
            this.state.submitting = false;
            this._handleGuessResponse(data, null, true);
        })
        .catch(err => {
            console.error('skip error:', err);
            this.state.submitting = false;
            this._enableGuessForm();
        });
    }

    _handleGuessResponse(data, guess, isSkip) {
        // Update state
        this.state.score = data.new_score ?? this.state.score;

        // Store for results screen
        if (data.title && data.artist) {
            const result = {
                title:          data.title,
                artist:         data.artist,
                actualYear:     data.actual_year,
                guessedYear:    isSkip ? null : guess,
                yearDifference: data.year_difference,
                isSkip,
                trackViewUrl:   this.state.trackViewUrl,
            };
            this.state.songResults.push(result);

            if (this.options.mode === 'daily') {
                this._saveDailyProgress();
            }
        }

        // Update score display
        if (this.options.unlimitedMode) {
            this.state.totalYearsDifference += isSkip ? 30 : (data.year_difference || 0);
            this.state.totalRounds++;
            const avg = (this.state.totalYearsDifference / this.state.totalRounds).toFixed(1);
            if (this.elements.wormScoreNum) this.elements.wormScoreNum.textContent = avg;
        } else {
            this._updateWormBar(data.new_score ?? this.state.score);
        }

        // Mark progress dot
        if (this.options.mode === 'daily') {
            const dots = this.elements.progressDots;
            const dotIdx = (this.state.currentRound || 1) - 1;
            if (dots && dots[dotIdx]) {
                dots[dotIdx].classList.remove('active');
                dots[dotIdx].classList.add(isSkip ? 'skipped' : 'correct');
            }
        }

        // Transition to round result view
        this._showRoundResult(data, guess, isSkip);
    }

    // ── Round result view ──────────────────────────────────────────────────

    _showRoundResult(data, guess, isSkip) {
        stopAllAudio();

        const e = this.elements;
        const diff = isSkip ? null : data.year_difference;

        // Populate song info
        if (e.resultTitle)  e.resultTitle.textContent  = data.title  || '—';
        if (e.resultArtist) e.resultArtist.textContent = data.artist || '—';
        if (e.resultYear)   e.resultYear.textContent   = data.actual_year || '—';

        // Timeline bar
        this._renderTimeline(guess, data.actual_year, isSkip);

        // Feedback text
        if (e.resultFeedback) {
            const cls = isSkip ? 'skipped' : distClass(diff);
            e.resultFeedback.className = 'result-feedback-text ' + cls;
            e.resultFeedback.textContent = isSkip
                ? 'Skipped — the song was from ' + data.actual_year
                : _feedbackText(diff, guess, data.actual_year);
        }

        // Apple Music link
        if (e.appleMusicLink) {
            const url = this.state.trackViewUrl;
            e.appleMusicLink.innerHTML = url
                ? '🎵 <a href="' + url + '" target="_blank" rel="noopener">Listen on Apple Music →</a>'
                : '';
        }

        // Next button label
        if (e.nextRoundBtn) {
            const isLast = this.options.mode === 'daily' && this.state.currentRound >= 5;
            e.nextRoundBtn.textContent = isLast ? 'See Results →' : 'Next →';
            e.nextRoundBtn.className = 'next-btn' + (isLast ? ' see-results' : '');
        }

        this.showView('round-result');
    }

    _renderTimeline(guess, actualYear, isSkip) {
        const { timelineTrack, timelineDist, markerGuess, markerGuessLbl, markerActual } = this.elements;
        if (!timelineTrack) return;

        const actualPct = yearToPercent(actualYear) + '%';

        // Actual marker — always shown
        if (markerActual) markerActual.style.left = actualPct;

        if (isSkip || guess === null) {
            // Only show actual marker
            if (markerGuess) markerGuess.style.display = 'none';
            if (timelineDist) timelineDist.style.display = 'none';
            return;
        }

        if (markerGuess) markerGuess.style.display = '';
        const guessPct  = yearToPercent(guess);
        const guessLeft = guessPct + '%';

        if (markerGuess)    markerGuess.style.left    = guessLeft;
        if (markerGuessLbl) markerGuessLbl.textContent = String(guess);

        // Distance band
        if (timelineDist) {
            timelineDist.style.display = '';
            const left  = Math.min(guessPct, yearToPercent(actualYear));
            const right = Math.max(guessPct, yearToPercent(actualYear));
            timelineDist.style.left  = left + '%';
            timelineDist.style.width = (right - left) + '%';
            const cls = distClass(Math.abs(guess - actualYear));
            timelineDist.className = 'timeline-distance ' + cls;
            // Trigger opacity transition
            requestAnimationFrame(() => timelineDist.classList.add('visible'));
        }
    }

    _onNextRound() {
        const isLast = this.options.mode === 'daily' && this.state.currentRound >= 5;
        if (isLast || (this.options.mode === 'free' && this.state.score < 0 && !this.options.unlimitedMode)) {
            this._showResults(this.state.score);
        } else {
            this.loadNewSong();
        }
    }

    // ── Hint reveal ────────────────────────────────────────────────────────

    _revealHint(type, btn) {
        fetch('/get-hint?type=' + type)
            .then(r => r.json())
            .then(data => {
                if (type === 'title' && data.title && this.elements.titleDisplay) {
                    this.elements.titleDisplay.textContent = data.title;
                    this.elements.titleDisplay.className   = 'info-value revealed';
                }
                if (type === 'artist' && data.artist && this.elements.artistDisplay) {
                    this.elements.artistDisplay.textContent = data.artist;
                    this.elements.artistDisplay.className   = 'info-value revealed';
                }
                if (btn) btn.disabled = true;
            })
            .catch(err => console.error('hint error:', err));
    }

    // ── Results screen ─────────────────────────────────────────────────────

    _showResults(finalScore) {
        stopAllAudio();

        const e       = this.elements;
        const score   = typeof finalScore === 'number' ? finalScore : 0;
        const message = generateGameOverMessage(score);

        // Score and worm reaction
        if (e.resultsScore) e.resultsScore.textContent = score;
        if (e.resultsMessage) e.resultsMessage.textContent = message;

        // Worm face reaction on results
        if (e.resultsWorm) {
            const face = _wormFace(score);
            e.resultsWorm.textContent = face.emoji;
        }

        // Already-played banner (daily)
        if (e.alreadyBanner && this.state.isCompleted) {
            e.alreadyBanner.classList.add('visible');
        }

        // Round cards
        if (e.roundsList) {
            e.roundsList.innerHTML = this._renderRoundCards();
        }

        // Save daily completion to localStorage
        if (this.options.mode === 'daily') {
            this._saveDailyCompletion(score);
        }

        this.showView('results');
    }

    _renderRoundCards() {
        if (!this.state.songResults || this.state.songResults.length === 0) {
            return '<p style="font-family:var(--font-hand);color:var(--c-muted)">No rounds recorded.</p>';
        }

        return this.state.songResults.map((r, i) => {
            const isSkip  = r.isSkip;
            const diff    = isSkip ? null : r.yearDifference;
            const cls     = isSkip ? 'skipped' : distClass(diff);
            const diffTxt = isSkip
                ? 'skip'
                : (diff === 0 ? 'exact!' : (r.guessedYear > r.actualYear ? '+' : '−') + Math.abs(diff) + 'yr');
            const yearsTxt = isSkip
                ? '— → ' + r.actualYear
                : r.guessedYear + ' → ' + r.actualYear;

            return `
                <div class="round-card">
                    <div class="round-card-num">${i + 1}</div>
                    <div class="round-card-song">
                        <div class="round-card-title">${_esc(r.title)}</div>
                        <div class="round-card-artist">${_esc(r.artist)}</div>
                    </div>
                    <div class="round-card-right">
                        <div class="round-card-diff ${cls}">${diffTxt}</div>
                        <div class="round-card-years">${yearsTxt}</div>
                    </div>
                </div>`;
        }).join('');
    }

    // ── Worm health bar ────────────────────────────────────────────────────

    _renderWormSegments(count) {
        const container = this.elements.wormSegments;
        if (!container) return;
        container.innerHTML = '';
        for (let i = 0; i < count; i++) {
            const seg = document.createElement('div');
            seg.className = 'worm-segment';
            seg.dataset.index = i;
            container.appendChild(seg);
        }
    }

    _updateWormBar(score) {
        if (this.options.mode === 'free' && !this.options.unlimitedMode) {
            // Free mode: just update numeric display
            if (this.elements.wormScoreNum) this.elements.wormScoreNum.textContent = score;
            return;
        }

        // Daily mode: full worm bar
        const segments = document.querySelectorAll('.worm-segment');
        const active   = Math.max(0, Math.min(10, Math.ceil(Math.max(0, score) / 10)));

        segments.forEach((seg, i) => {
            seg.classList.toggle('lost', i >= active);
        });

        // Face state
        const face = _wormFace(score);
        const faceEl = this.elements.wormFace;
        if (faceEl) {
            faceEl.textContent = face.emoji;
            faceEl.className   = 'worm-face state-' + face.state;
        }

        // Numeric score
        if (this.elements.wormScoreNum) this.elements.wormScoreNum.textContent = score;
    }

    // ── Progress dots (daily) ──────────────────────────────────────────────

    _updateProgressDots(currentRound) {
        const dots = this.elements.progressDots;
        if (!dots) return;
        dots.forEach((dot, i) => {
            dot.classList.toggle('active', i < currentRound);
        });
    }

    // ── Form helpers ───────────────────────────────────────────────────────

    _clearGuessForm() {
        const { yearInput, guessBtn, skipBtn, inputError, titleDisplay, artistDisplay } = this.elements;
        if (yearInput)     { yearInput.value = ''; yearInput.disabled = false; }
        if (guessBtn)      guessBtn.disabled  = false;
        if (skipBtn)       skipBtn.disabled   = false;
        if (inputError)    inputError.textContent = '';
        if (titleDisplay)  { titleDisplay.textContent = '?'; titleDisplay.className = 'info-value unknown'; }
        if (artistDisplay) { artistDisplay.textContent = '?'; artistDisplay.className = 'info-value unknown'; }

        // Re-enable hint buttons
        const th = document.getElementById('title-hint-btn');
        const ah = document.getElementById('artist-hint-btn');
        if (th) th.disabled = false;
        if (ah) ah.disabled = false;

        // Reset timeline visibility for next round
        const { timelineDist, markerGuess } = this.elements;
        if (timelineDist) { timelineDist.className = 'timeline-distance'; timelineDist.style.display = 'none'; }
        if (markerGuess)  markerGuess.style.display = '';
    }

    _disableGuessForm() {
        const { yearInput, guessBtn, skipBtn } = this.elements;
        if (yearInput) yearInput.disabled = true;
        if (guessBtn)  guessBtn.disabled  = true;
        if (skipBtn)   skipBtn.disabled   = true;
    }

    _enableGuessForm() {
        const { yearInput, guessBtn, skipBtn } = this.elements;
        if (yearInput) yearInput.disabled = false;
        if (guessBtn)  guessBtn.disabled  = false;
        if (skipBtn)   skipBtn.disabled   = false;
    }

    // ── localStorage — daily ───────────────────────────────────────────────

    _saveDailyCompletion(finalScore) {
        try {
            const record = {
                date:        new Date().toISOString().split('T')[0],
                score:       parseInt(finalScore),
                results:     this.state.songResults,
                completedAt: new Date().toISOString(),
            };
            localStorage.setItem('dailyChallenge', JSON.stringify(record));
            localStorage.removeItem('dailyProgress');
        } catch (e) {
            console.error('Error saving daily completion:', e);
        }
    }

    _saveDailyProgress() {
        if (this.options.mode !== 'daily') return;
        try {
            localStorage.setItem('dailyProgress', JSON.stringify({
                date:         new Date().toISOString().split('T')[0],
                currentRound: this.state.currentRound,
                score:        this.state.score,
                results:      this.state.songResults,
            }));
        } catch (e) {
            console.error('Error saving daily progress:', e);
        }
    }

    _checkDailyProgress() {
        try {
            const raw = localStorage.getItem('dailyProgress');
            if (!raw) return;
            const progress = JSON.parse(raw);
            if (progress.date !== new Date().toISOString().split('T')[0]) return;
            if (progress.currentRound > 0 && progress.currentRound < 5) {
                this.state.currentRound  = progress.currentRound;
                this.state.score         = progress.score ?? 100;
                this.state.songResults   = progress.results ?? [];
                this._updateWormBar(this.state.score);
                this._updateProgressDots(this.state.currentRound);
            }
        } catch (e) {
            console.error('Error checking daily progress:', e);
        }
    }

    _checkDailyCompletion() {
        if (this.options.mode !== 'daily') return false;
        try {
            const raw = localStorage.getItem('dailyChallenge');
            if (!raw) return false;
            const record = JSON.parse(raw);
            if (record.date !== new Date().toISOString().split('T')[0]) return false;

            // Already completed — load stored results and show results screen
            this.state.songResults = record.results ?? [];
            this.state.score       = record.score ?? 0;
            this.state.isCompleted = true;
            this._showResults(record.score);
            return true;
        } catch (e) {
            console.error('Error checking daily completion:', e);
            return false;
        }
    }

    // ── Copy results (daily) ───────────────────────────────────────────────

    copyResults() {
        if (this.options.mode !== 'daily') return;

        const today = new Date().toISOString().split('T')[0].replace(/-/g, '/');
        const diffs = this.state.songResults.map(r => {
            if (r.isSkip) return 'SKIP';
            if (r.yearDifference === 0) return '✓';
            return (r.guessedYear > r.actualYear ? '+' : '-') + r.yearDifference;
        }).join(' | ');

        const score  = this.state.score;
        const text   = `Yearworm ${today}\n\n${diffs}\n\nFinal Score: ${score}`;

        navigator.clipboard.writeText(text)
            .then(() => {
                const el = this.elements.copySuccess;
                if (el) {
                    el.textContent = 'Copied!';
                    setTimeout(() => { el.textContent = ''; }, 2000);
                }
            })
            .catch(() => {
                alert('Could not copy — try manually selecting the text.');
            });
    }
}

// ── Module-level helpers ───────────────────────────────────────────────────

function _wormFace(score) {
    if (score >= 70) return { emoji: '😊', state: 'happy' };
    if (score >= 40) return { emoji: '😐', state: 'neutral' };
    if (score >= 20) return { emoji: '😟', state: 'worried' };
    if (score >   0) return { emoji: '😱', state: 'panicked' };
    return { emoji: '💀', state: 'dead' };
}

function _feedbackText(diff, guess, actual) {
    if (diff === 0)   return 'Exact year! Perfect! 🎯';
    if (diff <= 2)    return 'Only ' + diff + (diff === 1 ? ' year' : ' years') + ' off — almost there!';
    if (diff <= 5)    return diff + ' years off — pretty close!';
    if (diff <= 10)   return diff + ' years off — getting warm.';
    if (diff <= 20)   return diff + ' years off — a bit cold.';
    return diff + ' years off — not quite the same era!';
}

function _esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Navbar injection ───────────────────────────────────────────────────────

function injectNavbar() {
    document.body.insertAdjacentHTML('afterbegin', navbarHTML);
    const path = window.location.pathname;
    document.querySelectorAll('.navbar-item').forEach(item => {
        const href = item.getAttribute('href');
        if (path === href || (href !== '/' && path.startsWith(href))) {
            item.classList.add('active');
        }
    });
}

// ── Shared helpers kept for any legacy callers ────────────────────────────

function formatYearDifferenceFeedback(diff, actual, isCorrect) {
    if (isCorrect) return 'Exact year! Perfect! 🎯';
    return 'Off by ' + diff + ' ' + (diff === 1 ? 'year' : 'years') + '. The actual year was ' + actual + '.';
}

function generateGameOverMessage(score) {
    const expert = [
        "Sweet Child O' Mine! You're a bona fide music historian! 🎸",
        "You've got the Knowledge! 🏆",
        "Don't Stop Believin' in your music expertise! 🌟",
        "You must have Spotify on 24/7. Dynamite! 💯",
        "Another One Bites The Dust! You crushed it! 👑",
    ];
    const good = [
        "You can't always get what you want, but you got most of these! 🎵",
        "Hit me baby one more time — with another challenge please! 🎤",
        "We Will Rock You… with a slightly harder quiz next time! 👏",
        "Not quite a Smooth Criminal of music knowledge, but close! 🕴️",
        "That's The Way we like your answers! 👍",
    ];
    const avg = [
        "Every Rose Has Its Thorn, and every player misses some! 🌹",
        "With A Little Help From My Friends, you might score higher next time! 👫",
        "Don't Stop 'Til You Get Enough... correct answers, that is! 🕺",
        "Like Britney says, Oops! But it's okay. 😅",
        "More than a feeling — you've got some music knowledge brewing! 🎸",
    ];
    const low = [
        "Yesterday, all your troubles seemed so far away… 🎹",
        "Livin' On A Prayer with some of those guesses! 🙏",
        "Sweet Dreams are made of… better scores than this! Keep trying! 💤",
        "Bye Bye Bye to your bragging rights — for now! 👋",
    ];
    const pool = score >= 90 ? expert : score >= 70 ? good : score >= 50 ? avg : low;
    return pool[Math.floor(Math.random() * pool.length)];
}

function validateYearInput(year) {
    const cur = new Date().getFullYear();
    if (isNaN(year) || year < 1900 || year > cur) {
        return { valid: false, message: 'Enter a year between 1900 and ' + cur };
    }
    return { valid: true };
}

// CommonJS export (for any test runner)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        YearwormGame,
        injectNavbar,
        formatYearDifferenceFeedback,
        generateGameOverMessage,
        validateYearInput,
        navbarHTML,
        footerHTML,
    };
}
