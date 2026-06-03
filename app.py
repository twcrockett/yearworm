# app.py

import logging
import os
import json
import random
import requests
from datetime import datetime, timezone
from flask import Flask, render_template, request, jsonify, session

# Load .env file in development (no-op if python-dotenv is absent or .env missing)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder='static', static_url_path='/static')
app.secret_key = os.environ.get('SECRET_KEY') or os.urandom(24)


# ---------------------------------------------------------------------------
# Security headers
# ---------------------------------------------------------------------------

@app.after_request
def add_security_headers(response):
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response


# ---------------------------------------------------------------------------
# Data loading — singletons loaded once at startup
# ---------------------------------------------------------------------------

def _load_json_file(path):
    """Load a JSON file, trying UTF-8 then Latin-1."""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except UnicodeDecodeError:
        with open(path, 'r', encoding='latin-1') as f:
            return json.load(f)


_SONGS = None
_CURATED_SONGS = None


def _init_songs():
    global _SONGS
    if os.path.exists('songs.json'):
        _SONGS = _load_json_file('songs.json')
    else:
        _SONGS = [
            {"title": "Bohemian Rhapsody", "artist": "Queen", "year": 1975},
            {"title": "Billie Jean", "artist": "Michael Jackson", "year": 1983},
            {"title": "Smells Like Teen Spirit", "artist": "Nirvana", "year": 1991},
            {"title": "Rolling in the Deep", "artist": "Adele", "year": 2011},
            {"title": "Hey Jude", "artist": "The Beatles", "year": 1968},
            {"title": "Sweet Child O' Mine", "artist": "Guns N' Roses", "year": 1987},
            {"title": "Don't Stop Believin'", "artist": "Journey", "year": 1981},
            {"title": "Hotel California", "artist": "Eagles", "year": 1976},
            {"title": "Imagine", "artist": "John Lennon", "year": 1971},
            {"title": "Thriller", "artist": "Michael Jackson", "year": 1982},
        ]
        with open('songs.json', 'w', encoding='utf-8') as f:
            json.dump(_SONGS, f, ensure_ascii=False)
    logger.info("Loaded %d songs", len(_SONGS))


def _init_curated_songs():
    global _CURATED_SONGS
    if os.path.exists('curated_songs.json'):
        _CURATED_SONGS = _load_json_file('curated_songs.json')
    else:
        _CURATED_SONGS = {}
    logger.info("Loaded curated songs for %d date(s)", len(_CURATED_SONGS))


def get_songs():
    if _SONGS is None:
        _init_songs()
    return _SONGS


def get_curated_songs():
    if _CURATED_SONGS is None:
        _init_curated_songs()
    return _CURATED_SONGS


# Load at startup
_init_songs()
_init_curated_songs()


# ---------------------------------------------------------------------------
# iTunes API
# ---------------------------------------------------------------------------

def get_preview_url(title, artist):
    """
    Fetch song preview and Apple Music link from iTunes API.
    Returns {'previewUrl': str|None, 'trackViewUrl': str|None} or None on failure.
    Uses multiple strategies to find the correct original version.
    """
    primary_artist = artist.split('ft.')[0].split('feat.')[0].strip()
    logger.info("Searching iTunes for: '%s' by '%s'", title, primary_artist)

    # Strategy 1: Direct search with artist and title combined
    combined_term = f"{title} {primary_artist}".replace(' ', '+')
    url = f"https://itunes.apple.com/search?term={combined_term}&media=music&limit=25&entity=song"

    try:
        response = requests.get(url, timeout=10)
        if response.status_code != 200:
            logger.warning("iTunes API error: %s", response.status_code)
            return None

        data = response.json()
        results = data.get('results', [])

        if results:
            logger.info("Found %d results in combined search", len(results))

            scored_results = []
            for result in results:
                # Skip non-track results (e.g. music videos, podcasts)
                if result.get('wrapperType') != 'track':
                    continue

                score = 0

                if primary_artist.lower() == result['artistName'].lower():
                    score += 100
                elif primary_artist.lower() in result['artistName'].lower():
                    score += 50
                else:
                    continue

                if title.lower() == result['trackName'].lower():
                    score += 100
                elif title.lower() in result['trackName'].lower():
                    score += 50
                else:
                    title_words = set(title.lower().split())
                    track_words = set(result['trackName'].lower().split())
                    common_words = title_words.intersection(track_words)
                    if len(common_words) >= len(title_words) * 0.5:
                        score += 25

                track_lower = result['trackName'].lower()
                if 'cover' in track_lower:
                    score -= 50
                if 'tribute' in track_lower:
                    score -= 50
                if 'karaoke' in track_lower:
                    score -= 100
                if 'kidz bop' in track_lower or 'kidzbop' in track_lower:
                    score -= 200
                if 'live' in track_lower:
                    score -= 30
                if 'acoustic' in track_lower:
                    score -= 20
                if 'instrumental' in track_lower:
                    score -= 40
                if 'remix' in track_lower:
                    score -= 30

                if result.get('isStreamable'):
                    score += 10

                if 'trackPopularity' in result:
                    score += min(result['trackPopularity'] / 5, 20)

                if result.get('collectionName'):
                    if title.lower() in result['collectionName'].lower():
                        score += 30
                    else:
                        score += 10

                logger.debug(
                    "  Candidate: %s by %s — Score: %d",
                    result['trackName'], result['artistName'], score
                )
                scored_results.append((score, result))

            scored_results.sort(reverse=True, key=lambda x: x[0])

            if scored_results and scored_results[0][0] > 0:
                best = scored_results[0][1]
                logger.info(
                    "Best match: %s by %s (score %d)",
                    best['trackName'], best['artistName'], scored_results[0][0]
                )
                return {'previewUrl': best.get('previewUrl'), 'trackViewUrl': best.get('trackViewUrl')}

        # Strategy 2: exact artist search
        logger.info("Trying artist-specific search...")
        artist_query = primary_artist.replace(' ', '+')
        url2 = (
            f"https://itunes.apple.com/search?term={title.replace(' ', '+')}"
            f"&attribute=songTerm&media=music&entity=song&limit=10&artistTerm={artist_query}"
        )
        response2 = requests.get(url2, timeout=10)
        if response2.status_code == 200:
            results2 = response2.json().get('results', [])
            if results2:
                exact = [r for r in results2 if title.lower() == r['trackName'].lower()]
                hit = exact[0] if exact else results2[0]
                return {'previewUrl': hit.get('previewUrl'), 'trackViewUrl': hit.get('trackViewUrl')}

        # Strategy 3: look up by album
        logger.info("Trying album lookup...")
        url3 = f"https://itunes.apple.com/search?term={primary_artist.replace(' ', '+')}&entity=album&limit=10&media=music"
        response3 = requests.get(url3, timeout=10)
        if response3.status_code == 200:
            albums = [
                a for a in response3.json().get('results', [])
                if a.get('collectionType') == 'Album'
                and 'live' not in a.get('collectionName', '').lower()
            ]
            for album in albums[:3]:
                url4 = f"https://itunes.apple.com/lookup?id={album['collectionId']}&entity=song"
                response4 = requests.get(url4, timeout=10)
                if response4.status_code == 200:
                    for song in response4.json().get('results', []):
                        if song.get('wrapperType') == 'track' and title.lower() in song['trackName'].lower():
                            logger.info("Found in album '%s': %s", album['collectionName'], song['trackName'])
                            return {'previewUrl': song.get('previewUrl'), 'trackViewUrl': song.get('trackViewUrl')}

        logger.warning("All iTunes strategies failed for '%s' by '%s'", title, artist)
        return None

    except Exception:
        logger.exception("Error fetching iTunes preview for '%s' by '%s'", title, artist)
        return None


# ---------------------------------------------------------------------------
# Daily song helpers
# ---------------------------------------------------------------------------

def _today_utc():
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')


def get_daily_seed():
    today = _today_utc()
    return hash(today) % 1000000


def get_daily_songs():
    curated = get_curated_songs()
    today = _today_utc()
    if today in curated:
        return curated[today]

    all_songs = get_songs()
    if len(all_songs) < 5:
        all_songs = all_songs * (5 // len(all_songs) + 1)

    random.seed(get_daily_seed())
    selection = random.sample(all_songs, 5)
    random.seed()
    return selection


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/daily')
def daily_challenge():
    if 'game_mode' in session and session['game_mode'] == 'daily':
        logger.info(
            "Resuming daily challenge at round %d with score %d",
            session.get('current_round', 0), session.get('score', 100)
        )
    else:
        session.clear()
        session['game_mode'] = 'daily'
        session['score'] = 100
        session['current_round'] = 0
        logger.info("Starting new daily challenge")

    session['daily_songs'] = get_daily_songs()
    return render_template('daily.html')


@app.route('/free')
def free_play():
    session.clear()
    session['game_mode'] = 'free'
    session['score'] = 100
    session['current_round'] = 0

    hints_enabled = request.args.get('hints', 'false').lower() == 'true'
    unlimited_guesses = request.args.get('unlimited', 'false').lower() == 'true'
    unlimited_mode = request.args.get('unlimited_mode', 'false').lower() == 'true'

    session['hints_enabled'] = hints_enabled
    session['unlimited_guesses'] = unlimited_guesses
    session['unlimited_mode'] = unlimited_mode

    return render_template(
        'free.html',
        hints_enabled=hints_enabled,
        unlimited_guesses=unlimited_guesses,
        unlimited_mode=unlimited_mode
    )


@app.route('/free_options')
def free_options():
    return render_template('free_options.html')


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

@app.route('/api/refresh', methods=['POST'])
def api_refresh():
    """Reload song data from disk without restarting. Useful after admin edits."""
    _init_songs()
    _init_curated_songs()
    return jsonify({"songs": len(get_songs()), "curated_dates": len(get_curated_songs())})


@app.route('/get-hint', methods=['GET'])
def get_hint():
    """Return title or artist hint for the current song (costs points in Phase 3)."""
    current_song = session.get('current_song', {})
    if not current_song:
        return jsonify({'error': 'No active song'}), 400
    hint_type = request.args.get('type', '')
    if hint_type == 'title':
        return jsonify({'title': current_song.get('title', '')})
    if hint_type == 'artist':
        return jsonify({'artist': current_song.get('artist', '')})
    return jsonify({'error': 'Unknown hint type'}), 400


@app.route('/get-song-count', methods=['GET'])
def get_song_count():
    return jsonify({"count": len(get_songs())})


@app.route('/get-song', methods=['GET'])
def get_song():
    try:
        game_mode = session.get('game_mode', 'free')
        current_round = session.get('current_round', 0)

        logger.info("GET /get-song — mode: %s, round: %d", game_mode, current_round + 1)

        if game_mode == 'daily':
            daily_songs = session.get('daily_songs', [])
            if not daily_songs:
                logger.warning("No daily songs in session — regenerating")
                all_songs = get_songs()
                if len(all_songs) < 5:
                    all_songs = all_songs * (5 // len(all_songs) + 1)
                daily_songs = random.sample(all_songs, 5)
                session['daily_songs'] = daily_songs

            if current_round >= len(daily_songs) or current_round >= 5:
                logger.info("Game over — final score: %d", session.get('score', 0))
                return jsonify({"gameOver": True, "finalScore": session.get('score', 0)})

            song = daily_songs[current_round]
        else:
            songs = get_songs()
            if not songs:
                return jsonify({"error": "No songs available"}), 400
            song = random.choice(songs)

        logger.info("Selected song: %s by %s", song['title'], song['artist'])

        itunes = get_preview_url(song['title'], song['artist'])
        preview_url = itunes['previewUrl'] if itunes else None
        track_view_url = itunes['trackViewUrl'] if itunes else None

        session['current_song'] = {
            'title': song['title'],
            'artist': song['artist'],
            'year': song['year'],
            'trackViewUrl': track_view_url
        }

        return jsonify({
            'title': None,
            'artist': None,
            'year': song['year'],
            'previewUrl': preview_url,
            'trackViewUrl': track_view_url,
            'round': current_round + 1,
            'totalRounds': 5 if game_mode == 'daily' else 'unlimited',
            'score': session.get('score', 100)
        })

    except Exception:
        logger.exception("Error in /get-song")
        songs = get_songs()
        if songs:
            fallback = random.choice(songs)
            fallback_itunes = get_preview_url(fallback['title'], fallback['artist'])
            return jsonify({
                'title': None,
                'artist': None,
                'year': fallback['year'],
                'previewUrl': fallback_itunes['previewUrl'] if fallback_itunes else None,
                'trackViewUrl': fallback_itunes['trackViewUrl'] if fallback_itunes else None,
                'round': 1,
                'totalRounds': 5 if session.get('game_mode') == 'daily' else 'unlimited',
                'score': 100,
                'recovered': True
            })
        return jsonify({'error': 'Failed to get song'}), 500


@app.route('/check-guess', methods=['POST'])
def check_guess():
    try:
        data = request.get_json() or {}

        try:
            guess = int(data.get('guess', 0))
        except (ValueError, TypeError):
            guess = 0

        is_skip = data.get('is_skip', False)

        current_song = session.get('current_song', {})
        if not current_song:
            return jsonify({
                'error': 'No active song. Please start a new game.',
                'restart_needed': True
            }), 400

        actual_year = current_song.get('year', 0)
        year_difference = abs(guess - actual_year)
        game_mode = session.get('game_mode', 'free')
        score = session.get('score', 100)

        logger.info(
            "check_guess — mode: %s, round: %d, score: %d",
            game_mode, session.get('current_round', 0), score
        )

        points_lost = 100 if is_skip else year_difference

        if game_mode == 'daily':
            new_score = score - points_lost
            session['score'] = new_score
            current_round = session.get('current_round', 0) + 1
            session['current_round'] = current_round
            game_over = current_round >= 5

            if 'guess_history' not in session:
                session['guess_history'] = []
            session['guess_history'].append({
                'artist': current_song.get('artist', ''),
                'title': current_song.get('title', ''),
                'actual_year': actual_year,
                'guessed_year': guess,
                'year_difference': year_difference,
                'is_skip': is_skip
            })

            return jsonify({
                'result': 'correct' if year_difference == 0 else 'incorrect',
                'year_difference': year_difference,
                'actual_year': actual_year,
                'points_lost': points_lost,
                'new_score': new_score,
                'game_over': game_over,
                'round': current_round,
                'artist': current_song.get('artist', ''),
                'title': current_song.get('title', '')
            })
        else:
            unlimited_mode = session.get('unlimited_guesses', False)
            new_score = score - points_lost
            session['score'] = new_score
            game_over = not unlimited_mode and new_score < 0

            if year_difference == 0 or is_skip or game_over or not unlimited_mode:
                session['current_round'] = session.get('current_round', 0) + 1
                return jsonify({
                    'result': 'correct' if year_difference == 0 else 'incorrect',
                    'year_difference': year_difference,
                    'actual_year': actual_year,
                    'points_lost': points_lost,
                    'new_score': new_score,
                    'next_round': True,
                    'game_over': game_over,
                    'artist': current_song.get('artist', ''),
                    'title': current_song.get('title', ''),
                    'total_rounds': session.get('current_round', 0)
                })
            else:
                hint = 'Too ' + ('high' if guess > actual_year else 'low')
                return jsonify({
                    'result': 'try_again',
                    'year_difference': year_difference,
                    'hint': hint,
                    'next_round': False
                })

    except Exception:
        logger.exception("Error in /check-guess")
        return jsonify({
            'error': 'Failed to process guess',
            'result': 'incorrect',
            'year_difference': 0,
            'actual_year': 2000,
            'points_lost': 0,
            'new_score': session.get('score', 100),
            'next_round': True
        })
