/**
 * Yearworm - Consolidated Game Logic Module
 */

// Navbar HTML template
const navbarHTML = `
<nav class="navbar">
    <div class="navbar-container">
        <a href="/" class="navbar-logo">
            <img src="/static/logo.png" alt="Yearworm Logo" class="navbar-logo-img">
            Yearworm
        </a>
        <ul class="navbar-menu">
            <li><a href="/" class="navbar-item">Home</a></li>
            <li><a href="/daily" class="navbar-item">Daily Challenge</a></li>
            <li><a href="/free_options" class="navbar-item">Free Play</a></li>
        </ul>
    </div>
</nav>
`;

// Footer HTML template
const footerHTML = `
<footer>
    <p><a href="https://twcrockett.github.io/" target="_blank"><img src="https://avatars.githubusercontent.com/u/79346208?v=4" class="footer-avatar" alt="Tay's avatar"></a> Made by Tay | <a href="https://github.com/twcrockett/yearworm" target="_blank">GitHub</a></p>
</footer>
`;

// Global handler to stop audio on page unload (refresh, navigation)
window.addEventListener('beforeunload', function() {
    // Find and stop all audio elements
    const audioElements = document.querySelectorAll('audio');
    audioElements.forEach(audio => {
        try {
            audio.pause();
            audio.currentTime = 0;
        } catch (err) {
            // Ignore errors during unload
        }
    });
});


/**
 * Game Logic Class - Manages core game functionality
 */
class YearwormGame {
    constructor(options = {}) {
        // Default options
        this.options = {
            mode: 'free', // 'free' or 'daily'
            hintsEnabled: false,
            unlimitedGuesses: false,
            unlimitedMode: false,
            ...options
        };

        // Game state
        this.state = {
            currentRound: 1,
            score: 100,
            totalYearsDifference: 0,
            totalRounds: 0,
            songResults: [],
            hasGuessed: false
        };

        // DOM Elements - these will be set in the initialize method
        this.elements = {};

        // Bind methods to this instance
        this.loadNewSong = this.loadNewSong.bind(this);
        this.checkGuess = this.checkGuess.bind(this);
        this.skipSong = this.skipSong.bind(this);
        this.revealHint = this.revealHint.bind(this);
        this.showGameOver = this.showGameOver.bind(this);
    }

    /**
     * Initialize the game by setting up DOM elements and event listeners
     * @param {Object} elements - Object containing references to DOM elements
     */
    initialize(elements) {
        // Store references to DOM elements
        this.elements = elements;

        // Initialize UI components
        this.initUI();
    }

    /**
     * Initialize UI components
     */
    initUI() {
        // Inject navbar
        injectNavbar();

        // Replace the footer with the common footer
        document.body.insertAdjacentHTML('beforeend', footerHTML);

        // Initialize score circle based on game mode
        if (this.options.unlimitedMode) {
            initScoreCircle('avg-container', 'avg-years-off', 'Avg', true);
            if (this.elements.scoreContainer) this.elements.scoreContainer.style.display = 'none';
            if (this.elements.avgContainer) this.elements.avgContainer.style.display = 'flex';
        } else {
            initScoreCircle('score-container', 'score');
            if (this.elements.scoreContainer) this.elements.scoreContainer.style.display = 'flex';
            if (this.elements.avgContainer) this.elements.avgContainer.style.display = 'none';
        }

        // Set up hint buttons
        this.setupHintButtons();

        // Hide elements initially
        if (this.elements.guessFeedback) this.elements.guessFeedback.style.display = 'none';
        if (this.elements.nextBtn) {
            this.elements.nextBtn.style.display = 'none';
            this.elements.nextBtn.classList.remove('visible');
            this.elements.nextBtn.addEventListener('click', this.loadNewSong);
        }

        // For daily challenge progress dots
        if (this.options.mode === 'daily' && this.elements.progressDots) {
            this.updateProgressDots(1);
        }
    }

    stopCurrentAudio() {
        console.log("Stopping current audio...");
        // Find any playing audio and stop it
        const audioElements = document.querySelectorAll('audio');
        console.log(`Found ${audioElements.length} audio elements to stop`);
        audioElements.forEach((audio, index) => {
            try {
                console.log(`Stopping audio element ${index}, current time: ${audio.currentTime}`);
                audio.pause();
                audio.currentTime = 0;
                console.log(`Audio element ${index} stopped`);
            } catch (err) {
                console.log(`Error stopping audio ${index}:`, err);
            }
        });
    }


    /**
     * Set up hint buttons based on user preferences
     */
    setupHintButtons() {
        if (!this.elements.titleHintBtn || !this.elements.artistHintBtn) return;

        // Set up hint buttons visibility based on hints setting
        if (this.options.hintsEnabled) {
            this.elements.titleHintBtn.style.display = 'inline-block';
            this.elements.artistHintBtn.style.display = 'inline-block';

            // Add event listeners
            this.elements.titleHintBtn.addEventListener('click', () => this.revealHint('title'));
            this.elements.artistHintBtn.addEventListener('click', () => this.revealHint('artist'));
        } else {
            this.elements.titleHintBtn.style.display = 'none';
            this.elements.artistHintBtn.style.display = 'none';
        }
    }

    /**
     * Reset UI elements for a new song
     */
    resetUI() {
        // Hide feedback
        if (this.elements.guessFeedback) {
            this.elements.guessFeedback.style.display = 'none';
        }

        // Hide next button
        if (this.elements.nextBtn) {
            this.elements.nextBtn.style.display = 'none';
            this.elements.nextBtn.classList.remove('visible');
        }

        // Reset song info fields
        const titleDisplay = this.elements.titleDisplay;
        const artistDisplay = this.elements.artistDisplay;
        const yearDisplay = this.elements.yearDisplay;

        if (titleDisplay) {
            titleDisplay.textContent = '?';
            titleDisplay.className = 'unknown';
        }

        if (artistDisplay) {
            artistDisplay.textContent = '?';
            artistDisplay.className = 'unknown';
        }

        if (yearDisplay) {
            yearDisplay.textContent = '?';
            yearDisplay.className = 'unknown';
        }

        // Reset hint buttons if hints are enabled
        if (this.options.hintsEnabled) {
            if (this.elements.titleHintBtn) {
                this.elements.titleHintBtn.style.display = 'inline-block';
                this.elements.titleHintBtn.disabled = false;
            }

            if (this.elements.artistHintBtn) {
                this.elements.artistHintBtn.style.display = 'inline-block';
                this.elements.artistHintBtn.disabled = false;
            }
        }

        // Reset state for new song
        this.state.hasGuessed = false;
    }

    /**
     * Load a new song from the API
     */
    loadNewSong() {
        console.log("Loading new song...");

        // Stop any playing audio before loading a new song
        this.stopCurrentAudio();

        // Reset UI for new song
        this.resetUI();

        // Fetch a new song
        fetch('/get-song')
            .then(response => response.json())
            .then(song => {
                console.log("Song loaded:", song);

                // Check if the game is over (daily challenge)
                if (song.gameOver) {
                    this.stopCurrentAudio(); // Stop audio before showing game over
                    this.showGameOver(song.finalScore);
                    return;
                }

                // Update game state
                this.state.currentRound = song.round;

                // Update UI with round info
                if (this.elements.currentRoundSpan) {
                    this.elements.currentRoundSpan.textContent = song.round;
                }

                // Update score (in normal mode)
                if (!this.options.unlimitedMode && this.elements.scoreSpan) {
                    this.elements.scoreSpan.textContent = song.score;
                }

                // Update progress dots (in daily mode)
                if (this.options.mode === 'daily') {
                    this.updateProgressDots(song.round);
                }

                // Configure audio player
                setupAudioPlayerNew(this.elements.playerContainer, song.previewUrl);

                // Set up event listeners on the new elements
                this.setupPlayerListeners();
            })
            .catch(error => {
                console.error('Error loading song:', error);
                if (this.elements.playerContainer) {
                    this.elements.playerContainer.innerHTML = '<p>Error loading song. Please try again.</p>';
                }
            });
    }


    /**
     * Set up event listeners for the player controls
     */
    setupPlayerListeners() {
        const yearGuessInput = document.getElementById('year-guess');
        const guessBtn = document.getElementById('guess-btn');
        const skipBtn = document.getElementById('skip-btn');

        if (!yearGuessInput || !guessBtn || !skipBtn) {
            console.error('Required form elements not found');
            return;
        }

        // Clear the input value (it might be preserved from previous round)
        yearGuessInput.value = '';

        // Set up event listeners
        guessBtn.addEventListener('click', this.checkGuess);
        skipBtn.addEventListener('click', this.skipSong);

        // Set up enter key handler
        setupEnterKeyForGuess(yearGuessInput, guessBtn);
    }

    /**
     * Check the user's guess against the actual song year
     */
    checkGuess() {
        const yearGuessInput = document.getElementById('year-guess');
        const guessBtn = document.getElementById('guess-btn');
        const skipBtn = document.getElementById('skip-btn');

        if (!yearGuessInput) {
            console.error('Year input not found');
            return;
        }

        const guess = parseInt(yearGuessInput.value);

        // Validate the input
        const validation = validateYearInput(guess);
        if (!validation.valid) {
            alert(validation.message);
            return;
        }

        console.log("Submitting guess:", guess);

        fetch('/check-guess', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                guess: guess,
                unlimited_guesses: this.options.unlimitedGuesses,
                is_skip: false
            })
        })
        .then(response => response.json())
        .then(data => {
            console.log("Guess response:", data);

            // Store result for this song (for daily challenge)
            if (this.options.mode === 'daily' && data.title && data.artist) {
                this.state.songResults.push({
                    title: data.title,
                    artist: data.artist,
                    actualYear: data.actual_year,
                    guessedYear: guess,
                    yearDifference: data.year_difference
                });

                // Save daily progress
                if (typeof this.saveDailyProgress === 'function') {
                    this.saveDailyProgress();
                }
            }

            // Update score if provided (for normal mode)
            if (!this.options.unlimitedMode && data.new_score !== undefined) {
                updateScoreWithAnimation('score', data.new_score);
            }

            // Update average years off (for unlimited mode)
            if (this.options.unlimitedMode && data.year_difference !== undefined) {
                // Only update for correct guesses or if moving to next song
                if (data.result === 'correct' || data.result === 'incorrect') {
                    this.state.totalYearsDifference += data.year_difference;
                    this.state.totalRounds++;
                    const avgYearsOff = (this.state.totalYearsDifference / this.state.totalRounds).toFixed(1);

                    if (this.elements.avgYearsOffSpan) {
                        this.elements.avgYearsOffSpan.textContent = avgYearsOff;
                    }
                }
            }

            // Check for game over (score < 0 and not in unlimited mode)
            if (data.game_over) {
                this.showGameOver(data.new_score, data.total_rounds || 0);
                return;
            }

            // Get feedback element
            const guessFeedback = this.elements.guessFeedback;

            if (data.result === 'correct') {
                // Correct guess
                if (guessFeedback) {
                    guessFeedback.style.display = 'block';
                    guessFeedback.className = 'guess-feedback correct';
                    guessFeedback.textContent = formatYearDifferenceFeedback(0, data.actual_year, true);
                }

                // Reveal all song info
                this.revealAllSongInfo(data.artist, data.title, data.actual_year, true);

                // Replace input with static text showing the guess
                this.replaceInputWithStaticText(guess);

                // Disable buttons
                if (guessBtn) guessBtn.disabled = true;
                if (skipBtn) skipBtn.disabled = true;
                if (this.elements.titleHintBtn) this.elements.titleHintBtn.disabled = true;
                if (this.elements.artistHintBtn) this.elements.artistHintBtn.disabled = true;

                // Show next button
                if (this.elements.nextBtn) {
                    this.elements.nextBtn.style.display = 'flex';
                    this.elements.nextBtn.classList.add('visible');
                }

                this.state.hasGuessed = true;
            } else if (data.result === 'incorrect') {
                // Incorrect guess but no more guesses allowed
                if (guessFeedback) {
                    guessFeedback.style.display = 'block';
                    guessFeedback.className = 'guess-feedback incorrect';
                    guessFeedback.textContent = formatYearDifferenceFeedback(data.year_difference, data.actual_year, false);
                }

                // Reveal all song info
                this.revealAllSongInfo(data.artist, data.title, data.actual_year, false);

                // Replace input with static text showing the guess
                this.replaceInputWithStaticText(guess);

                // Disable buttons
                if (guessBtn) guessBtn.disabled = true;
                if (skipBtn) skipBtn.disabled = true;
                if (this.elements.titleHintBtn) this.elements.titleHintBtn.disabled = true;
                if (this.elements.artistHintBtn) this.elements.artistHintBtn.disabled = true;

                // Show next button
                if (this.elements.nextBtn) {
                    this.elements.nextBtn.style.display = 'flex';
                    this.elements.nextBtn.classList.add('visible');
                }

                this.state.hasGuessed = true;
            } else if (data.result === 'try_again') {
                // Unlimited guesses mode - just show hint without revealing year
                if (guessFeedback) {
                    guessFeedback.style.display = 'block';
                    guessFeedback.className = 'guess-feedback hint';
                    guessFeedback.textContent = `Hint: Your guess is ${data.hint}.`;
                }

                // Update year display with hint and add animation
                if (this.elements.yearDisplay) {
                    const yearDisplay = this.elements.yearDisplay;
                    const isHigh = data.hint === 'too high';

                    yearDisplay.textContent = isHigh ? 'Too high' : 'Too low';
                    yearDisplay.className = isHigh ? 'hint-high' : 'hint-low';

                    // Apply animation to the hint
                    yearDisplay.classList.add('year-reveal-animation');

                    // Remove animation class after it completes
                    setTimeout(() => {
                        yearDisplay.classList.remove('year-reveal-animation');
                    }, 800);
                }
            }
        })
        .catch(error => {
            console.error('Error checking guess:', error);
            alert('Something went wrong. Please try again.');
        });
    }

    /**
     * Skip the current song
     */
    skipSong() {
        console.log("Skipping song");

        const guessBtn = document.getElementById('guess-btn');
        const skipBtn = document.getElementById('skip-btn');

        // Confirm skip in normal mode (not unlimited mode)
        if (!this.options.unlimitedMode) {
            const currentScore = parseInt(this.elements.scoreSpan?.textContent || '0');
            const confirmSkip = confirm("Skipping will deduct 100 points from your score! Are you sure you want to skip?");
            if (!confirmSkip) {
                return; // User canceled the skip
            }
        }

        fetch('/check-guess', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                guess: 0,  // Dummy value
                unlimited_guesses: false,
                is_skip: true
            })
        })
        .then(response => response.json())
        .then(data => {
            // Store result for this song (for daily challenge) - mark as skipped
            if (this.options.mode === 'daily' && data.title && data.artist) {
                this.state.songResults.push({
                    title: data.title,
                    artist: data.artist,
                    actualYear: data.actual_year,
                    guessedYear: 0, // 0 indicates skipped
                    yearDifference: data.actual_year, // Maximum difference
                    isSkip: true
                });

                // Save daily progress
                if (typeof this.saveDailyProgress === 'function') {
                    this.saveDailyProgress();
                }
            }

            // Check for game over (score < 0 and not in unlimited mode)
            if (data.game_over) {
                this.showGameOver(data.new_score, data.total_rounds || 0);
                return;
            }

            // Display feedback
            if (this.elements.guessFeedback) {
                this.elements.guessFeedback.style.display = 'block';
                this.elements.guessFeedback.className = 'guess-feedback incorrect';
                this.elements.guessFeedback.textContent = `Skipped. This song was released in ${data.actual_year}. You lost 100 points.`;
            }

            this.replaceInputWithSkippedText();

            // Update score (for normal mode)
            if (!this.options.unlimitedMode && data.new_score !== undefined) {
                updateScoreWithAnimation('score', data.new_score);
            }

            // Update average years off (for unlimited mode)
            if (this.options.unlimitedMode) {
                // For skips, add a penalty (e.g., 30 years)
                const skipPenalty = 30;
                this.state.totalYearsDifference += skipPenalty;
                this.state.totalRounds++;
                const avgYearsOff = (this.state.totalYearsDifference / this.state.totalRounds).toFixed(1);

                if (this.elements.avgYearsOffSpan) {
                    updateScoreWithAnimation('avg-years-off', avgYearsOff, true);
                }
            }

            // Reveal all song info
            this.revealAllSongInfo(data.artist, data.title, data.actual_year, false);

            if (this.elements.yearDisplay) {
                this.elements.yearDisplay.className = 'revealed skipped-year';
                this.elements.yearDisplay.classList.add('year-reveal-animation');

                // Remove animation class after it completes
                setTimeout(() => {
                    this.elements.yearDisplay.classList.remove('year-reveal-animation');
                }, 800);
            }

            // Disable buttons
            if (guessBtn) guessBtn.disabled = true;
            if (skipBtn) skipBtn.disabled = true;
            if (this.elements.titleHintBtn) this.elements.titleHintBtn.disabled = true;
            if (this.elements.artistHintBtn) this.elements.artistHintBtn.disabled = true;

            // Show next button
            if (this.elements.nextBtn) {
                this.elements.nextBtn.style.display = 'flex';
                this.elements.nextBtn.classList.add('visible');
            }

            this.state.hasGuessed = true;
        })
        .catch(error => {
            console.error('Error skipping song:', error);
            alert('Something went wrong. Please try again.');
        });
    }

    /**
     * Reveal a specific hint (title or artist)
     * @param {string} type - Type of hint ('title' or 'artist')
     */
    revealHint(type) {
        // Only proceed if not already revealed
        const titleDisplay = this.elements.titleDisplay;
        const artistDisplay = this.elements.artistDisplay;
        const titleHintBtn = this.elements.titleHintBtn;
        const artistHintBtn = this.elements.artistHintBtn;

        if (!titleDisplay || !artistDisplay || !titleHintBtn || !artistHintBtn) {
            return;
        }

        if ((type === 'title' && !titleDisplay.classList.contains('revealed')) ||
            (type === 'artist' && !artistDisplay.classList.contains('revealed'))) {

            // Get the current song data
            fetch('/get_song_info', {
                method: 'GET'
            })
            .then(response => response.json())
            .then(data => {
                // Reveal only the requested info
                if (type === 'title' && data.title) {
                    titleDisplay.textContent = data.title;
                    titleDisplay.className = 'revealed';
                    titleHintBtn.style.display = 'none';
                } else if (type === 'artist' && data.artist) {
                    artistDisplay.textContent = data.artist;
                    artistDisplay.className = 'revealed';
                    artistHintBtn.style.display = 'none';
                }
            })
            .catch(error => {
                console.error('Error fetching song info:', error);
                // Fallback if fetch fails
                if (type === 'title') {
                    titleDisplay.textContent = 'Title revealed';
                    titleDisplay.className = 'revealed';
                    titleHintBtn.style.display = 'none';
                } else if (type === 'artist') {
                    artistDisplay.textContent = 'Artist revealed';
                    artistDisplay.className = 'revealed';
                    artistHintBtn.style.display = 'none';
                }
            });
        }
    }

    /**
     * Reveal all song info after guess
     * @param {string} artist - Artist name
     * @param {string} title - Song title
     * @param {number} year - Release year
     * @param {boolean} isCorrect - Whether the guess was correct
     */
    revealAllSongInfo(artist, title, year, isCorrect) {
        const titleDisplay = this.elements.titleDisplay;
        const artistDisplay = this.elements.artistDisplay;
        const yearDisplay = this.elements.yearDisplay;
        const titleHintBtn = this.elements.titleHintBtn;
        const artistHintBtn = this.elements.artistHintBtn;

        if (!titleDisplay || !artistDisplay || !yearDisplay) {
            return;
        }

        titleDisplay.textContent = title || 'Unknown';
        titleDisplay.className = 'revealed';

        artistDisplay.textContent = artist || 'Unknown';
        artistDisplay.className = 'revealed';

        yearDisplay.textContent = year;
        yearDisplay.className = 'revealed';

        // Apply the animation class to the year display
        yearDisplay.classList.add('year-reveal-animation');

        // Remove animation class after animation completes to allow it to be triggered again
        setTimeout(() => {
            yearDisplay.classList.remove('year-reveal-animation');
        }, 800); // Match duration with the CSS animation

        if (isCorrect) {
            yearDisplay.classList.add('correct-year');
        } else {
            yearDisplay.classList.add('incorrect-year');
        }

        // Hide hint buttons
        if (titleHintBtn) titleHintBtn.style.display = 'none';
        if (artistHintBtn) artistHintBtn.style.display = 'none';
    }

    /**
     * Replace the year input with static text showing the guess
     * @param {number} guess - The user's guess
     */
    replaceInputWithStaticText(guess) {
        const yearGuessInput = document.getElementById('year-guess');
        const guessForm = yearGuessInput?.closest('.guess-form');

        if (!yearGuessInput || !guessForm) return;

        // Get the parent container
        const container = yearGuessInput.parentElement;

        // Create the static text element
        const staticText = document.createElement('div');
        staticText.className = 'static-guess';
        staticText.innerHTML = `<span>Your guess: <b>${guess}</b></span>`;

        // Replace the input with static text
        container.replaceChild(staticText, yearGuessInput);

        // Disable all buttons in the guess form
        const buttons = guessForm.querySelectorAll('button');
        buttons.forEach(button => {
            button.disabled = true;
            button.classList.add('disabled');
        });
    }

    /**
     * Replace the year input with static "Skipped" text
     */
    replaceInputWithSkippedText() {
        const yearGuessInput = document.getElementById('year-guess');
        const guessForm = yearGuessInput?.closest('.guess-form');

        if (!yearGuessInput || !guessForm) return;

        // Get the parent container
        const container = yearGuessInput.parentElement;

        // Create the static text element
        const staticText = document.createElement('div');
        staticText.className = 'static-guess skipped';
        staticText.innerHTML = `<span>Skipped</span>`;

        // Replace the input with static text
        container.replaceChild(staticText, yearGuessInput);

        // Disable all buttons in the guess form
        const buttons = guessForm.querySelectorAll('button');
        buttons.forEach(button => {
            button.disabled = true;
            button.classList.add('disabled');
        });
    }

    /**
     * Update progress dots for daily challenge
     * @param {number} currentRound - Current round number
     */
    updateProgressDots(currentRound) {
        if (this.options.mode !== 'daily') return;

        // Get all dots
        const dots = document.querySelectorAll('.dot');
        if (!dots || dots.length === 0) return;

        // Reset all dots
        dots.forEach(dot => {
            dot.classList.remove('active');
        });

        // Activate dots up to current round
        for (let i = 0; i < currentRound; i++) {
            if (dots[i]) {
                dots[i].classList.add('active');
            }
        }
    }

    /**
     * Show game over screen
     * @param {number} finalScore - Final score
     * @param {number} totalRounds - Total rounds played (for free mode)
     */
    showGameOver(finalScore, totalRounds = null) {
        // Stop any playing audio
        this.stopCurrentAudio();

        // Different handling based on game mode
        if (this.options.mode === 'daily') {
            this.showDailyGameOver(finalScore);
        } else {
            this.showFreeGameOver(finalScore, totalRounds);
        }
    }

    /**
     * Show game over for free play with song history
     * @param {number} finalScore - Final score
     * @param {number} totalRounds - Total rounds played
     */
    showFreeGameOver(finalScore, totalRounds) {
        // Update round and score displays
        if (this.elements.finalRoundsSpan) {
            this.elements.finalRoundsSpan.textContent = totalRounds || this.state.songResults.length || 0;
        }

        if (this.elements.finalScoreSpan) {
            this.elements.finalScoreSpan.textContent = finalScore;
        }

        // Generate and display song history
        if (this.elements.songHistoryList) {
            this.elements.songHistoryList.innerHTML = this.generateSongHistory();
        }

        // Show the game over overlay
        if (this.elements.gameOverOverlay) {
            this.elements.gameOverOverlay.style.display = 'flex';
        }
    }

    /**
     * Generate HTML for song history in free mode
     * @returns {string} - HTML for song history
     */
    generateSongHistory() {
        if (!this.state.songResults || this.state.songResults.length === 0) {
            return '<p>No songs played.</p>';
        }

        let historyHTML = '';

        // Loop through each song result and create a history item
        this.state.songResults.forEach((result, index) => {
            const isCorrect = result.yearDifference === 0;
            const isSkipped = result.isSkip || result.guessedYear === 0;

            let resultClass, resultText;

            if (isCorrect) {
                resultClass = 'correct';
                resultText = 'EXACT!';
            } else if (isSkipped) {
                resultClass = 'skipped';
                resultText = 'SKIP';
            } else {
                // Determine the difference category
                const yearDiff = Math.abs(result.yearDifference);
                const isHigh = result.guessedYear > result.actualYear;

                if (yearDiff <= 5) {
                    resultClass = isHigh ? 'slightly-high' : 'slightly-low';
                    resultText = isHigh ? `+${yearDiff}` : `-${yearDiff}`;
                } else if (yearDiff <= 15) {
                    resultClass = isHigh ? 'too-high' : 'too-low';
                    resultText = isHigh ? `+${yearDiff}` : `-${yearDiff}`;
                } else {
                    resultClass = isHigh ? 'very-high' : 'very-low';
                    resultText = isHigh ? `+${yearDiff}` : `-${yearDiff}`;
                }
            }

            historyHTML += `
                <div class="song-history-item">
                    <div class="song-history-num">${index + 1}</div>
                    <div class="song-history-details">
                        <div class="song-history-song">
                            <div class="song-history-title">${result.title}</div>
                            <div class="song-history-artist">${result.artist}</div>
                        </div>
                        <div class="song-history-year">
                            ${isSkipped ? '—' : result.guessedYear} → ${result.actualYear}
                        </div>
                    </div>
                    <div class="song-history-result ${resultClass}">${resultText}</div>
                </div>
            `;
        });

        return historyHTML;
    }


    /**
     * Show game over for daily challenge
     * @param {number} finalScore - Final score
     */
    showDailyGameOver(finalScore) {
        // Generate the results grid
        if (this.elements.resultsGrid) {
            this.elements.resultsGrid.innerHTML = this.generateResultsGrid(finalScore);
        }

        // Set game over message
        if (this.elements.gameOverMessage) {
            this.elements.gameOverMessage.textContent = generateGameOverMessage(finalScore);
        }

        // Update score display with the final score
        if (this.elements.scoreSpan) {
            this.elements.scoreSpan.textContent = finalScore;
            updateScoreCircleClass('score', finalScore);
        }

        // Make sure progress dots show 5/5 completed
        if (this.elements.currentRoundSpan) {
            this.elements.currentRoundSpan.textContent = "5";
        }
        this.updateProgressDots(5);

        // Show the modal
        if (this.elements.gameOverOverlay) {
            this.elements.gameOverOverlay.style.display = 'flex';
        }

        // Save to localStorage to prevent replay
        this.saveDailyCompletion(finalScore);

        console.log("Game over shown with final score:", finalScore);
    }

    /**
     * Show game over for free play
     * @param {number} finalScore - Final score
     * @param {number} totalRounds - Total rounds played
     */
    showFreeGameOver(finalScore, totalRounds) {
        // Update round and score displays
        if (this.elements.finalRoundsSpan) {
            this.elements.finalRoundsSpan.textContent = totalRounds || 0;
        }

        if (this.elements.finalScoreSpan) {
            this.elements.finalScoreSpan.textContent = finalScore;
        }

        // Show the game over overlay
        if (this.elements.gameOverOverlay) {
            this.elements.gameOverOverlay.style.display = 'flex';
        }
    }

    /**
     * Generate results grid HTML for daily challenge
     * @param {number} finalScore - Final score
     * @returns {string} - HTML for results grid
     */
    generateResultsGrid(finalScore) {
        let gridHTML = '<div class="results-grid-container">';

        // Add final score as the first cell
        gridHTML += `
            <div class="result-item score-cell">
                <div class="result-label">Final Score</div>
                <div class="final-score-value">${finalScore}</div>
            </div>
        `;

        // Helper function to interpolate between three colors
        function interpolateColor(start, mid, end, intensity) {
            if (intensity <= 0.5) {
                // Interpolate between start and mid
                return Math.round(start + (mid - start) * (intensity * 2));
            } else {
                // Interpolate between mid and end
                return Math.round(mid + (end - mid) * ((intensity - 0.5) * 2));
            }
        }

        // Add song results with dynamic color calculation
        this.state.songResults.forEach((result, index) => {
            const isCorrect = result.yearDifference === 0;
            const isSkipped = result.guessedYear === 0 || result.isSkip;

            let yearDiffClass, colorStyle = '';

            if (isCorrect) {
                yearDiffClass = 'year-correct';
            } else if (isSkipped) {
                yearDiffClass = 'year-skipped';
            } else {
                // Determine if guess was higher or lower than actual
                const guessHigher = result.guessedYear > result.actualYear;

                // Calculate intensity (0.0 to 1.0)
                const absYearDiff = Math.abs(result.yearDifference);
                const intensity = Math.min(absYearDiff / 30, 1);

                if (guessHigher) {
                    // Blue spectrum (too high)
                    // RGB values for slightly-high, too-high, very-high
                    const r = interpolateColor(139, 69, 49, intensity);
                    const g = interpolateColor(185, 117, 54, intensity);
                    const b = interpolateColor(224, 180, 149, intensity);
                    colorStyle = `background-color: rgb(${r}, ${g}, ${b}); color: ${intensity > 0.5 ? 'white' : '#333'};`;
                } else {
                    // Red spectrum (too low)
                    // RGB values for slightly-low, too-low, very-low
                    const r = interpolateColor(254, 252, 215, intensity);
                    const g = interpolateColor(224, 141, 48, intensity);
                    const b = interpolateColor(144, 89, 39, intensity);
                    colorStyle = `background-color: rgb(${r}, ${g}, ${b}); color: ${intensity > 0.4 ? 'white' : '#333'};`;
                }

                yearDiffClass = 'result-year-diff'; // Use base class only
            }

            // Format year difference text
            let yearDiffText = isSkipped ? 'SKIP' : (
                result.yearDifference === 0 ? 'EXACT!' :
                (result.guessedYear > result.actualYear ? '+' : '-') + Math.abs(result.yearDifference)
            );

            gridHTML += `
                <div class="result-item">
                    <div class="result-artist">${result.artist}</div>
                    <div class="result-title">${result.title}</div>
                    <div class="${yearDiffClass}"
                         style="${colorStyle}">
                        ${yearDiffText}
                    </div>
                    <div class="result-years">${isSkipped ? '—' : result.guessedYear} → ${result.actualYear}</div>
                </div>
            `;
        });

        gridHTML += '</div>';
        return gridHTML;
    }


    generateResultsGridLegacy(finalScore) {
        let gridHTML = '<div class="results-grid-container">';

        // Add final score as the first cell
        gridHTML += `
            <div class="result-item score-cell">
                <div class="result-label">Final Score</div>
                <div class="final-score-value">${finalScore}</div>
            </div>
        `;

        // Add song results
        this.state.songResults.forEach((result, index) => {
            const isCorrect = result.yearDifference === 0;
            const isSkipped = result.guessedYear === 0 || result.isSkip;

            let yearDiffClass, yearDiffStyle = '';

            if (isCorrect) {
                yearDiffClass = 'year-correct';
            } else if (isSkipped) {
                yearDiffClass = 'year-skipped';
            } else {
                // Determine if guess was higher or lower than actual
                const guessHigher = result.guessedYear > result.actualYear;

                // Calculate intensity for gradient (0.0 to 1.0)
                // Max difference is 30 years for full intensity
                const absYearDiff = Math.abs(result.yearDifference);
                const intensity = Math.min(absYearDiff / 30, 1).toFixed(2);

                // Apply base class and intensity for gradient positioning
                yearDiffClass = guessHigher ? 'year-high' : 'year-low';
                yearDiffStyle = `--intensity: ${intensity};`;

                // For compatibility with browsers that might not support the gradient approach,
                // also add the discrete class based on intensity ranges
                if (guessHigher) {
                    if (absYearDiff <= 10) yearDiffClass += ' slightly-high';
                    else if (absYearDiff <= 20) yearDiffClass += ' too-high';
                    else yearDiffClass += ' very-high';
                } else {
                    if (absYearDiff <= 10) yearDiffClass += ' slightly-low';
                    else if (absYearDiff <= 20) yearDiffClass += ' too-low';
                    else yearDiffClass += ' very-low';
                }
            }

            // Format year difference text
            let yearDiffText = isSkipped ? 'SKIP' : (
                result.yearDifference === 0 ? 'EXACT!' :
                (result.guessedYear > result.actualYear ? '+' : '-') + Math.abs(result.yearDifference)
            );

            gridHTML += `
                <div class="result-item">
                    <div class="result-artist">${result.artist}</div>
                    <div class="result-title">${result.title}</div>
                    <div class="result-year-diff ${yearDiffClass}"
                         style="${yearDiffStyle}">
                        ${yearDiffText}
                    </div>
                    <div class="result-years">${isSkipped ? '—' : result.guessedYear} → ${result.actualYear}</div>
                </div>
            `;
        });

        gridHTML += '</div>';
        return gridHTML;
    }


    /**
     * Save daily challenge completion record
     * @param {number} finalScore - Final score
     */
    saveDailyCompletion(finalScore) {
        try {
            // Ensure we're using the numeric value of the score
            const scoreValue = parseInt(finalScore);

            console.log("Saving daily completion with score:", scoreValue);

            const currentDate = new Date().toISOString().split('T')[0];

            // Create a comprehensive record with all game data
            const record = {
                date: currentDate,
                score: scoreValue,
                results: this.state.songResults,
                completedAt: new Date().toISOString()
            };

            // Save to localStorage
            localStorage.setItem('dailyChallenge', JSON.stringify(record));

            // Clear the in-progress data when fully completed
            localStorage.removeItem('dailyProgress');

            console.log("Daily challenge saved and progress cleared");
        } catch (e) {
            console.error('Error saving daily completion:', e);
        }
    }

    /**
     * Save daily progress after each round
     */
    saveDailyProgress() {
        if (this.options.mode !== 'daily') return;

        try {
            const currentDate = new Date().toISOString().split('T')[0];
            const progress = {
                date: currentDate,
                currentRound: this.state.currentRound,
                score: parseInt(this.elements.scoreSpan?.textContent || '100'),
                results: this.state.songResults
            };

            localStorage.setItem('dailyProgress', JSON.stringify(progress));
            console.log("Progress saved:", progress);
        } catch (e) {
            console.error('Error saving daily progress:', e);
        }
    }

    /**
     * Check for and load daily progress
     * @returns {boolean} - Whether progress was loaded
     */
    checkDailyProgress() {
        if (this.options.mode !== 'daily') return false;

        try {
            const currentDate = new Date().toISOString().split('T')[0];
            const dailyProgress = localStorage.getItem('dailyProgress');

            if (dailyProgress) {
                const progress = JSON.parse(dailyProgress);

                // Check if the progress is for today
                if (progress.date === currentDate) {
                    console.log("Found in-progress daily challenge");

                    // If user has completed some rounds but not all
                    if (progress.currentRound > 0 && progress.currentRound < 5) {
                        // Update the round counter
                        this.state.currentRound = progress.currentRound;

                        // Update the score
                        if (progress.score !== undefined && this.elements.scoreSpan) {
                            console.log("Restoring score to:", progress.score);
                            this.elements.scoreSpan.textContent = progress.score;
                            // Properly update the score circle appearance
                            updateScoreCircleClass('score', progress.score);
                        }

                        // Update the song results array
                        if (progress.results && Array.isArray(progress.results)) {
                            this.state.songResults = progress.results;
                        }

                        // Update round counter and progress dots
                        if (this.elements.currentRoundSpan) {
                            this.elements.currentRoundSpan.textContent = progress.currentRound;
                        }
                        this.updateProgressDots(progress.currentRound);

                        // Log the restored state
                        console.log("Restored game state - Round:", progress.currentRound, "Score:", progress.score);

                        return true;
                    }
                }
            }
            return false;
        } catch (e) {
            console.error('Error checking daily progress:', e);
            return false;
        }
    }

    /**
     * Check if user already completed today's challenge
     * @returns {boolean} - Whether today's challenge is completed
     */
    checkDailyCompletion() {
        if (this.options.mode !== 'daily') return false;

        try {
            const currentDate = new Date().toISOString().split('T')[0];
            const dailyRecord = localStorage.getItem('dailyChallenge');

            if (dailyRecord) {
                const record = JSON.parse(dailyRecord);

                // Check if the record is for today
                if (record.date === currentDate) {
                    console.log("Found completed daily challenge");

                    // Stop any potentially playing audio
                    this.stopCurrentAudio();

                    // User already completed today's challenge
                    if (this.elements.dailyCompletedDiv) {
                        this.elements.dailyCompletedDiv.style.display = 'block';
                    }

                    if (this.elements.gameContent) {
                        this.elements.gameContent.style.display = 'none';
                    }

                    // Update score display with the final score
                    const finalScore = record.score;
                    console.log("Showing completed daily with score:", finalScore);

                    // Update the text content
                    if (this.elements.previousScoreSpan) {
                        this.elements.previousScoreSpan.textContent = finalScore;
                    }

                    if (this.elements.scoreSpan) {
                        this.elements.scoreSpan.textContent = finalScore;
                    }

                    // Then update the score circle appearance
                    updateScoreCircleClass('score', finalScore);

                    // Make sure progress dots show 5/5 completed
                    if (this.elements.currentRoundSpan) {
                        this.elements.currentRoundSpan.textContent = "5";
                    }
                    this.updateProgressDots(5);

                    return true;
                }
            }
            return false;
        } catch (e) {
            console.error('Error checking daily completion:', e);
            return false;
        }
    }

    /**
     * Show results popup for completed challenge
     */
    showCompletedResults() {
        try {
            const dailyRecord = localStorage.getItem('dailyChallenge');
            if (!dailyRecord) return;

            const record = JSON.parse(dailyRecord);

            // Update the state with saved results
            this.state.songResults = record.results || [];

            // Generate results grid
            if (this.elements.resultsGrid) {
                this.elements.resultsGrid.innerHTML = this.generateResultsGrid(record.score);
            }

            // Set game over message
            if (this.elements.gameOverMessage) {
                this.elements.gameOverMessage.textContent = generateGameOverMessage(record.score);
            }

            // Show the modal
            if (this.elements.gameOverOverlay) {
                this.elements.gameOverOverlay.style.display = 'flex';
            }
        } catch (e) {
            console.error('Error showing completed results:', e);
        }
    }

    /**
     * Copy results to clipboard for daily challenge
     */
    copyResults() {
        if (this.options.mode !== 'daily') return;

        const today = new Date().toISOString().split('T')[0];
        const formattedDate = today.replace(/-/g, '/');

        // Format year differences - FIX: Ensure proper sign display
        const yearDiffs = this.state.songResults.map(result => {
            if (result.guessedYear === 0 || result.isSkip) return "SKIP";
            if (result.yearDifference === 0) return "✓";

            // Use + sign for "too high" guesses, - sign for "too low" guesses
            return (result.guessedYear > result.actualYear ? "+" : "-") + result.yearDifference;
        }).join(" | ");

        const scoreText = this.elements.scoreSpan?.textContent || '0';

        // IMPROVED: Better copyable results format
        const copyText = `Yearworm ${formattedDate}\n\n${yearDiffs}\n\nFinal Score: ${scoreText}`;

        // Copy to clipboard
        navigator.clipboard.writeText(copyText).then(() => {
            if (this.elements.copySuccess) {
                this.elements.copySuccess.style.display = 'inline';
                setTimeout(() => {
                    this.elements.copySuccess.style.display = 'none';
                }, 2000);
            }
        }).catch(err => {
            console.error('Could not copy text: ', err);
            alert('Failed to copy results');
        });
    }
}

/**
 * Helper function to inject the navbar
 */
function injectNavbar() {
    // Get the body element
    const body = document.body;

    // Insert the navbar at the beginning of the body
    body.insertAdjacentHTML('afterbegin', navbarHTML);

    // Highlight current page in navbar
    const currentPath = window.location.pathname;
    const navItems = document.querySelectorAll('.navbar-item');

    navItems.forEach(item => {
        const href = item.getAttribute('href');
        if (currentPath === href ||
            (href !== '/' && currentPath.startsWith(href))) {
            item.classList.add('active');
        }
    });
}

/**
 * Helper function to format a song's year response
 * @param {number} yearDifference - Difference between guess and actual year
 * @param {number} actualYear - Actual year of the song
 * @param {boolean} isCorrect - Whether the guess was correct
 * @returns {string} - Formatted feedback message
 */
function formatYearDifferenceFeedback(yearDifference, actualYear, isCorrect) {
    if (isCorrect) {
        return 'Perfect! You guessed the exact year! 🎯';
    } else {
        return `Off by ${yearDifference} years. The actual year was ${actualYear}. ${yearDifference <= 5 ? 'So close!' : ''}`;
    }
}

/**
 * Helper function to generate game over message based on score
 * @param {number} score - Final score
 * @returns {string} - Game over message
 */
function generateGameOverMessage(score) {
    // Arrays of music references for each score range
    const expertMessages = [
        "Sweet Child O' Mine! You're a bona fide rock historian! 🎸",
        "You've got the Knowledge, just like Lauryn Hill! 🏆",
        "You'll never be 'Rick Rolled' with knowledge like that! 🎤",
        "Don't Stop Believin' in your music expertise! 🌟",
        "You must have Spotify on 24/7! That was Dynamite! 💯",
        "You've got all the Uptown Funk you need! 🎵",
        "Another One Bites The Dust! You crushed this quiz! 👑"
    ];

    const goodMessages = [
        "You can't always get what you want, but you got most of these right! 🎵",
        "You've got rhythm, you've got music, you've got most answers correct! 🎧",
        "Hit me baby one more time... with another quiz please! 🎤",
        "We Will, We Will, Rock You... with a slightly harder quiz next time! 👏",
        "You're walking on sunshine with that performance! ☀️",
        "Not quite a Smooth Criminal of music knowledge, but close! 🕴️",
        "You know more than most! It must be all that Rhythm Nation training. 🔥",
        "That's The Way (Uh-Huh, Uh-Huh) we like your answers! 👍",
        "Your music knowledge is a Thriller, a Thriller night! 🌙"
    ];

    const averageMessages = [
        "Don't cry for me, Argentina—your score is actually decent! 🎭",
        "Every Rose Has Its Thorn, and every quiz taker misses some questions! 🌹",
        "With A Little Help From My Friends, you might score higher next time! 👫",
        "You're not bad, but maybe a little Comfortably Numb on some questions. 💊",
        "Don't Stop 'Til You Get Enough... correct answers, that is! 🕺",
        "Like Britney says, 'Oops!... I Did It' okay on this quiz! 😅",
        "We Can Work It Out with a little more studying! 📚",
        "You took the midnight train going... somewhere in the middle! 🚆",
        "More than a feeling, you've got some music knowledge brewing! 🎸"
    ];

    const needsWorkMessages = [
        "Yesterday, all your troubles seemed so far away, but today it seems they're here to stay. 🎹",
        "Bye Bye Bye to your bragging rights. 👋",
        "Livin' On A Prayer with some of those guesses, weren't you? 🙏",
        "You might need some R-E-S-P-E-C-T for the artists you're listening to! 🎵",
        "Here, <a href='https://www.youtube.com/watch?v=dQw4w9WgXcQ'>this</a> might help you improve for next time. 🎧",
        "Sweet Dreams are made of... better scores than this! Keep trying! 💤"
    ];

    // Select a random message based on score
    let messagePool;
    if (score >= 90) {
        messagePool = expertMessages;
    } else if (score >= 70) {
        messagePool = goodMessages;
    } else if (score >= 50) {
        messagePool = averageMessages;
    } else {
        messagePool = needsWorkMessages;
    }

    // Pick a random message from the appropriate pool
    const randomIndex = Math.floor(Math.random() * messagePool.length);
    return messagePool[randomIndex];
}

/**
 * Helper function to validate year input
 * @param {number} year - Year to validate
 * @returns {Object} - Validation result
 */
function validateYearInput(year) {
    const currentYear = new Date().getFullYear();
    if (isNaN(year) || year < 1900 || year > currentYear) {
        return {
            valid: false,
            message: `Please enter a valid year between 1900 and ${currentYear}`
        };
    }
    return { valid: true };
}

/**
 * Global audio tracker to ensure we can stop any playing audio
 * This prevents multiple audio tracks from playing simultaneously
 */
let currentAudioPlayer = null;

/**
 * Helper function to set up audio player with guessing form
 * @param {HTMLElement} container - Container element
 * @param {string} previewUrl - URL to audio preview
 * @returns {boolean} - Whether setup was successful
 */
function setupAudioPlayerNew(container, previewUrl) {
    if (!container) return false;

    // First, stop any currently playing audio to prevent overlapping
    if (currentAudioPlayer) {
        try {
            currentAudioPlayer.pause();
            currentAudioPlayer.currentTime = 0;
        } catch (err) {
            console.log("Error stopping previous audio:", err);
        }
    }

    if (previewUrl) {
        // More streamlined player without "Now Playing" text
        container.innerHTML = `
            <div class="audio-player">
                <audio id="song-audio" preload="auto" controlsList="nodownload nospeed" controls>
                    <source src="${previewUrl}" type="audio/mp4">
                    Your browser does not support the audio element.
                </audio>
                <div class="guess-form">
                    <input type="number" id="year-guess" placeholder="Enter year" min="1900" max="2024">
                    <div class="button-group">
                        <button id="guess-btn" type="button">Guess</button>
                        <button id="skip-btn" type="button">Skip</button>
                    </div>
                </div>
            </div>
        `;

        // Get the audio element
        const audio = document.getElementById('song-audio');
           console.log("Created new audio element with src:", audio.src);

        // Store reference to current audio player
        currentAudioPlayer = audio;

        // Set initial volume from localStorage or use default 0.5 (50%)
        const savedVolume = localStorage.getItem('yearworm_volume');
        audio.volume = savedVolume !== null ? parseFloat(savedVolume) : 0.5;

        // Save volume preference when user adjusts it
        audio.addEventListener('volumechange', function() {
            localStorage.setItem('yearworm_volume', audio.volume);
        });

        // Conditional autoplay - only if game is in active state (not completed)
        const dailyCompletedDiv = document.getElementById('daily-completed');
        const isGameActive = !dailyCompletedDiv || dailyCompletedDiv.style.display === 'none';

        if (isGameActive) {
            setTimeout(() => {
                try {
                    // Add a user interaction check (modern browsers require user interaction for autoplay)
                    if (document.hasFocus()) {
                        const playPromise = audio.play();

                        // Handle the promise to avoid uncaught promise rejection
                        if (playPromise !== undefined) {
                            playPromise.catch(e => {
                                console.log("Autoplay prevented by browser:", e);
                                // Don't try to force autoplay - modern browsers block this for good reasons
                            });
                        }
                    } else {
                        console.log("Page not in focus, skipping autoplay");
                    }
                } catch (err) {
                    console.log("Error during autoplay attempt:", err);
                }
            }, 500);
        } else {
            console.log("Daily challenge already completed, skipping autoplay");
        }

        return true;
    } else {
        // Fallback message if no preview
        container.innerHTML = `
            <div class="audio-player">
                <p>Audio preview not available for this song</p>
                <div class="guess-form">
                    <input type="number" id="year-guess" placeholder="Enter year (e.g., 1985)" min="1900" max="2024">
                    <div class="button-group">
                        <button id="guess-btn" type="button">Guess</button>
                        <button id="skip-btn" type="button">Skip</button>
                    </div>
                </div>
            </div>
        `;

        // Reset current audio reference
        currentAudioPlayer = null;
        return false;
    }
}

// Keep the old function for backward compatibility
function setupAudioPlayer(container, previewUrl, title = null) {
    return setupAudioPlayerNew(container, previewUrl);
}

/**
 * Add event listener for enter key on year input
 * @param {HTMLElement} inputElement - Input element
 * @param {HTMLElement} buttonElement - Button element
 */
function setupEnterKeyForGuess(inputElement, buttonElement) {
    if (!inputElement || !buttonElement) return;

    inputElement.addEventListener('keyup', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            buttonElement.click();
        }
    });
}

/**
 * Initialize the score circle by replacing the current score display
 * @param {string} containerId - ID of the container element
 * @param {string} scoreId - ID of the score span element
 * @param {string} label - Label to show (e.g., "Score" or "Avg")
 * @param {boolean} isAverage - Whether this is an average score (changes styling)
 */
function initScoreCircle(containerId, scoreId, label = "Score", isAverage = false) {
    const container = document.getElementById(containerId);
    const scoreSpan = document.getElementById(scoreId);

    if (!container || !scoreSpan) return;

    // Get the current score value
    const currentValue = scoreSpan.textContent;

    // Ensure container is using flex display
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '12px';

    // Create the new structure - with label to the left of the circle
    const circleHtml = `
        <span class="score-label">${label}:</span>
        <div class="score-circle ${isAverage ? 'avg-score' : ''}">
            <span class="score-value score-transition" id="${scoreId}">${currentValue}</span>
        </div>
    `;

    // Replace the container contents
    container.innerHTML = circleHtml;

    // Update circle class based on score
    updateScoreCircleClass(scoreId, parseFloat(currentValue), isAverage);
}

/**
 * Update the score and trigger animation
 * @param {string} scoreId - ID of the score span element
 * @param {number} newValue - New score value
 * @param {boolean} isAverage - Whether this is an average score
 */
function updateScoreWithAnimation(scoreId, newValue, isAverage = false) {
    const scoreSpan = document.getElementById(scoreId);
    if (!scoreSpan) return;

    const oldValue = parseFloat(scoreSpan.textContent);

    // Update the value
    scoreSpan.textContent = newValue;

    // Get parent circle
    const scoreCircle = scoreSpan.closest('.score-circle');
    if (!scoreCircle) return;

    // Add animation class
    scoreCircle.classList.add('score-change');

    // Update the circle class based on new value
    updateScoreCircleClass(scoreId, newValue, isAverage);

    // Remove animation class after animation completes
    setTimeout(() => {
        scoreCircle.classList.remove('score-change');
    }, 600);
}

/**
 * Helper function to interpolate between three colors
 * @param {number} start - Start value (0% intensity)
 * @param {number} mid - Middle value (50% intensity)
 * @param {number} end - End value (100% intensity)
 * @param {number} intensity - Value between 0.0 and 1.0
 * @returns {number} - Interpolated value
 */
function interpolateColor(start, mid, end, intensity) {
    if (intensity <= 0.5) {
        // Interpolate between start and mid
        return Math.round(start + (mid - start) * (intensity * 2));
    } else {
        // Interpolate between mid and end
        return Math.round(mid + (end - mid) * ((intensity - 0.5) * 2));
    }
}


/**
 * Update the score circle class based on value
 * @param {string} scoreId - ID of the score span element
 * @param {number} value - Score value
 * @param {boolean} isAverage - Whether this is an average score
 */
function updateScoreCircleClass(scoreId, value, isAverage = false) {
    const scoreSpan = document.getElementById(scoreId);
    if (!scoreSpan) return;

    const scoreCircle = scoreSpan.closest('.score-circle');
    if (!scoreCircle) return;

    // Remove existing classes
    scoreCircle.classList.remove('low-score', 'high-score');

    // Don't add color classes for average mode
    if (isAverage) return;

    // Add appropriate class based on score
    if (value < 50) {
        scoreCircle.classList.add('low-score');
    } else if (value >= 80) {
        scoreCircle.classList.add('high-score');
    }
}

// Export the YearwormGame class and helper functions
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        YearwormGame,
        injectNavbar,
        formatYearDifferenceFeedback,
        generateGameOverMessage,
        validateYearInput,
        setupAudioPlayerNew,
        setupAudioPlayer,
        setupEnterKeyForGuess,
        initScoreCircle,
        updateScoreWithAnimation,
        updateScoreCircleClass,
        navbarHTML,
        footerHTML
    };
}