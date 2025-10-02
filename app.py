# app.py

from flask import Flask, render_template, request, jsonify, session, redirect, url_for
import random
import json
import os
import requests
from datetime import datetime, timedelta

app = Flask(__name__, static_folder='static', static_url_path='/static')
app.secret_key = os.urandom(24)  # For session management


# Load song database
def load_songs():
    if os.path.exists('songs.json'):
        try:
            with open('songs.json', 'r', encoding='utf-8') as f:
                return json.load(f)
        except UnicodeDecodeError:
            # Fallback to Latin-1 which can handle all byte values
            with open('songs.json', 'r', encoding='latin-1') as f:
                return json.load(f)
    else:
        # Sample data if no file exists
        sample_songs = [
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

        # Create the songs.json file with sample data
        with open('songs.json', 'w', encoding='utf-8') as f:
            json.dump(sample_songs, f, ensure_ascii=False)

        return sample_songs


# Load curated daily songs
def load_curated_songs():
    if os.path.exists('curated_songs.json'):
        try:
            with open('curated_songs.json', 'r', encoding='utf-8') as f:
                return json.load(f)
        except UnicodeDecodeError:
            # Fallback to Latin-1 which can handle all byte values
            with open('curated_songs.json', 'r', encoding='latin-1') as f:
                return json.load(f)
    else:
        # Return empty dict if no curated songs exist
        return {}


# Fetch
def get_preview_url(title, artist):
    """
    Fetch a song preview URL from iTunes API with improved matching algorithm.
    Uses multiple strategies to find the correct original version.
    """
    # Normalize artist name to handle featuring artists
    primary_artist = artist.split('ft.')[0].split('feat.')[0].strip()
    print(f"Searching iTunes for: '{title}' by '{primary_artist}'")

    # Strategy 1: Direct search with artist and title combined
    combined_term = f"{title} {primary_artist}".replace(' ', '+')
    url = f"https://itunes.apple.com/search?term={combined_term}&media=music&limit=25&entity=song"

    try:
        response = requests.get(url, timeout=10)
        if response.status_code != 200:
            print(f"iTunes API error: {response.status_code}")
            return None

        data = response.json()
        results = data.get('results', [])

        if not results:
            print(f"No results found for combined search")
        else:
            print(f"Found {len(results)} results in combined search")

            # Score and rank results
            scored_results = []
            for result in results:
                score = 0

                # Exact artist name match gets high score
                if primary_artist.lower() == result['artistName'].lower():
                    score += 100
                # Partial artist match
                elif primary_artist.lower() in result['artistName'].lower():
                    score += 50
                # No artist match
                else:
                    continue  # Skip completely different artists

                # Exact title match
                if title.lower() == result['trackName'].lower():
                    score += 100
                # Partial title match
                elif title.lower() in result['trackName'].lower():
                    score += 50
                # Fuzzy title match (contains most words)
                else:
                    title_words = set(title.lower().split())
                    track_words = set(result['trackName'].lower().split())
                    common_words = title_words.intersection(track_words)
                    if len(common_words) >= len(title_words) * 0.5:
                        score += 25

                # Boost original recordings and avoid covers/live versions
                if 'cover' in result['trackName'].lower():
                    score -= 50
                if 'tribute' in result['trackName'].lower():
                    score -= 50
                if 'karaoke' in result['trackName'].lower():
                    score -= 100
                if 'live' in result['trackName'].lower():
                    score -= 30
                if 'acoustic' in result['trackName'].lower():
                    score -= 20

                # Favor higher popularity
                if 'trackPopularity' in result:
                    score += min(result['trackPopularity'] / 5, 20)

                # Favor tracks from albums/EPs over singles
                if result.get('collectionName'):
                    if title.lower() in result['collectionName'].lower():
                        score += 30
                    else:
                        score += 10

                # Penalize instrumental, remix
                if 'instrumental' in result['trackName'].lower():
                    score -= 40
                if 'remix' in result['trackName'].lower():
                    score -= 30

                # Log the candidate with its score
                print(f"  Candidate: {result['trackName']} by {result['artistName']} - Score: {score}")

                scored_results.append((score, result))

            # Sort by score descending
            scored_results.sort(reverse=True, key=lambda x: x[0])

            # Return the preview URL of the highest scored result
            if scored_results and scored_results[0][0] > 0:
                best_match = scored_results[0][1]
                print(
                    f"Best match: {best_match['trackName']} by {best_match['artistName']} (Score: {scored_results[0][0]})")
                return best_match['previewUrl']

        # If we still haven't found a good match, try a more specific query
        # Strategy 2: Try with exact artist search
        print("Trying more specific artist search...")
        artist_query = primary_artist.replace(' ', '+')
        url = f"https://itunes.apple.com/search?term={title.replace(' ', '+')}&attribute=songTerm&media=music&entity=song&limit=10&artistTerm={artist_query}"

        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            results = data.get('results', [])

            if results:
                print(f"Found {len(results)} results in artist-specific search")

                # Filter for exact title matches first
                exact_matches = [r for r in results if title.lower() == r['trackName'].lower()]
                if exact_matches:
                    print(
                        f"Found exact title match: {exact_matches[0]['trackName']} by {exact_matches[0]['artistName']}")
                    return exact_matches[0]['previewUrl']

                # Otherwise, return the first result
                print(f"Using first result: {results[0]['trackName']} by {results[0]['artistName']}")
                return results[0]['previewUrl']

        # Still nothing? Try a third approach
        # Strategy 3: Use collectionName to find the original album
        print("Trying to find original album...")
        url = f"https://itunes.apple.com/search?term={primary_artist.replace(' ', '+')}&entity=album&limit=10&media=music"

        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            albums = data.get('results', [])

            # Filter for studio albums
            albums = [a for a in albums if
                      a.get('collectionType') == 'Album' and 'live' not in a.get('collectionName', '').lower()]

            if albums:
                # Try to find songs from these albums
                for album in albums[:3]:  # Try up to 3 top albums
                    album_id = album['collectionId']
                    url = f"https://itunes.apple.com/lookup?id={album_id}&entity=song"

                    response = requests.get(url, timeout=10)
                    if response.status_code == 200:
                        data = response.json()
                        songs = [r for r in data.get('results', []) if r.get('wrapperType') == 'track']

                        # Look for our title in the tracks
                        for song in songs:
                            if title.lower() in song['trackName'].lower():
                                print(f"Found in album '{album['collectionName']}': {song['trackName']}")
                                return song['previewUrl']

        print("All strategies failed to find a suitable match")
        return None

    except Exception as e:
        print(f"Error fetching preview: {e}")
        return None


# Generate a unique daily seed based on date
def get_daily_seed():
    today = datetime.now().strftime('%Y-%m-%d')
    return hash(today) % 1000000


# Get the daily songs (either from curated list or randomly selected)
def get_daily_songs():
    curated_songs = load_curated_songs()

    # Check if we have curated songs for today
    today = datetime.now().strftime('%Y-%m-%d')
    if today in curated_songs:
        return curated_songs[today]

    # No curated songs for today, generate 5 random ones
    all_songs = load_songs()

    # Make sure we have at least 5 songs, or repeat some if needed
    if len(all_songs) < 5:
        # If we have fewer than 5 songs, duplicate them to reach at least 5
        all_songs = all_songs * (5 // len(all_songs) + 1)

    # Use a consistent seed for the day so all players get the same songs
    random.seed(get_daily_seed())
    daily_selection = random.sample(all_songs, 5)  # Now we're guaranteed to have at least 5
    random.seed()  # Reset the seed for other random operations

    return daily_selection


# Main routes
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/daily')
def daily_challenge():
    # Check if there's already a session for daily challenge
    if 'game_mode' in session and session['game_mode'] == 'daily':
        # Keep existing session data (don't reset current_round or score)
        current_round = session.get('current_round', 0)
        current_score = session.get('score', 100)
        print(f"Resuming daily challenge at round {current_round} with score {current_score}")
    else:
        # Initialize a new daily challenge
        session.clear()
        session['game_mode'] = 'daily'
        session['score'] = 100
        session['current_round'] = 0
        print("Starting new daily challenge")

    # Get daily songs
    daily_songs = get_daily_songs()
    session['daily_songs'] = daily_songs

    return render_template('daily.html')


@app.route('/get_song_info', methods=['GET'])
def get_song_info():
    # Get the current song from the session
    current_song = session.get('current_song', {})

    if not current_song:
        return jsonify({"error": "No song information available"}), 404

    # Return title and artist for hints
    return jsonify({
        "title": current_song.get('title', ''),
        "artist": current_song.get('artist', ''),
        "year": current_song.get('year', 0)
    })


@app.route('/free')
def free_play():
    # Initialize a new free play game
    session.clear()  # Clear any existing session
    session['game_mode'] = 'free'
    session['score'] = 100
    session['current_round'] = 0

    # Get options from query parameters with new hints parameter
    hints_enabled = request.args.get('hints', 'false').lower() == 'true'
    unlimited_guesses = request.args.get('unlimited', 'false').lower() == 'true'
    unlimited_mode = request.args.get('unlimited_mode', 'false').lower() == 'true'

    # Store settings in session
    session['hints_enabled'] = hints_enabled
    session['unlimited_guesses'] = unlimited_guesses
    session['unlimited_mode'] = unlimited_mode

    return render_template('free.html',
                          hints_enabled=hints_enabled,
                          unlimited_guesses=unlimited_guesses,
                          unlimited_mode=unlimited_mode)


@app.route('/free_options')
def free_options():
    return render_template('free_options.html')  # Note the underscore instead of hyphen


# API endpoints
@app.route('/get-song', methods=['GET'])
def get_song():
    try:
        # Get session data with defaults if missing
        game_mode = session.get('game_mode', 'free')
        current_round = session.get('current_round', 0)

        print(f"GET /get-song - Mode: {game_mode}, Round: {current_round + 1}")

        if game_mode == 'daily':
            # Get song from pre-selected daily songs
            daily_songs = session.get('daily_songs', [])

            if not daily_songs:
                print("Warning: No daily songs found in session. Generating new ones.")
                # Fall back to random songs for daily mode
                all_songs = load_songs()
                if len(all_songs) < 5:
                    all_songs = all_songs * (5 // len(all_songs) + 1)
                daily_songs = random.sample(all_songs, 5)
                session['daily_songs'] = daily_songs
                print(f"Generated {len(daily_songs)} daily songs")

            if current_round >= len(daily_songs) or current_round >= 5:
                print(f"Game over. Final score: {session.get('score', 0)}")
                return jsonify({"gameOver": True, "finalScore": session.get('score', 0)})

            song = daily_songs[current_round]
            print(f"Selected daily song: {song['title']} by {song['artist']}")
        else:
            # Free mode - get random song
            songs = load_songs()
            if not songs:
                print("Error: No songs available for free mode")
                return jsonify({"error": "No songs available"}), 400

            song = random.choice(songs)
            print(f"Selected random song: {song['title']} by {song['artist']}")

        # Get preview URL from iTunes
        preview_url = get_preview_url(song["title"], song["artist"])
        if preview_url:
            print(f"Found preview URL for song")
        else:
            print(f"No preview URL found for song")

        # Update session for this round
        session['current_song'] = {
            "title": song["title"],
            "artist": song["artist"],
            "year": song["year"]
        }

        # Return song info with preview URL
        response_data = {
            "title": None,  # Don't reveal title by default
            "artist": None,  # Don't reveal artist by default
            "year": song["year"],  # This will be hidden on the frontend
            "previewUrl": preview_url,
            "round": current_round + 1,
            "totalRounds": 5 if game_mode == 'daily' else "unlimited",
            "score": session.get('score', 100)
        }
        print(f"Returning song data: {song['title']} (preview: {'available' if preview_url else 'not available'})")
        return jsonify(response_data)

    except Exception as e:
        print(f"Error in get_song: {str(e)}")
        import traceback
        traceback.print_exc()
        # Try to recover by returning a safe response
        songs = load_songs()
        if songs:
            fallback_song = random.choice(songs)
            print(f"Using fallback song: {fallback_song['title']}")
            return jsonify({
                "title": None,
                "artist": None,
                "year": fallback_song["year"],
                "previewUrl": get_preview_url(fallback_song["title"], fallback_song["artist"]),
                "round": 1,
                "totalRounds": 5 if game_mode == 'daily' else "unlimited",
                "score": 100,
                "recovered": True
            })
        else:
            return jsonify({
                "error": "Failed to get song",
                "message": str(e)
            }), 500


@app.route('/check-guess', methods=['POST'])
def check_guess():
    try:
        data = request.get_json()
        if not data:
            data = {}

        try:
            guess = int(data.get('guess', 0))
        except (ValueError, TypeError):
            guess = 0

        # Check if this is a skip
        is_skip = data.get('is_skip', False)

        # Get the actual year from the session
        current_song = session.get('current_song', {})
        if not current_song:
            # Return a safe default response
            return jsonify({
                "error": "No active song. Please start a new game.",
                "restart_needed": True
            }), 400

        actual_year = current_song.get('year', 0)

        # Calculate the difference and update score
        year_difference = abs(guess - actual_year)

        game_mode = session.get('game_mode', 'free')
        score = session.get('score', 100)

        # Log the current state before changes
        print(f"Before guess - Mode: {game_mode}, Round: {session.get('current_round', 0)}, Score: {score}")

        # Apply the skip penalty (100 points) if this is a skip
        if is_skip:
            points_lost = 100
        else:
            points_lost = year_difference

        if game_mode == 'daily':
            # In daily mode, subtract points based on how far off the guess is
            # Now allowing negative scores
            new_score = score - points_lost
            session['score'] = new_score  # Update the session score

            # Move to next round
            current_round = session.get('current_round', 0) + 1
            session['current_round'] = current_round

            # Check if game is over
            game_over = current_round >= 5

            print(f"After guess - Round: {current_round}, Score: {new_score}, Game Over: {game_over}")

            # Save guess history to session for the results copy feature
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
                "result": "correct" if year_difference == 0 else "incorrect",
                "year_difference": year_difference,
                "actual_year": actual_year,
                "points_lost": points_lost,
                "new_score": new_score,
                "game_over": game_over,
                "round": current_round,
                "artist": current_song.get('artist', ''),
                "title": current_song.get('title', '')
            })
        else:
            # Free mode
            unlimited_mode = session.get('unlimited_guesses', False)

            # Update score (allowing negative scores)
            new_score = score - points_lost
            session['score'] = new_score

            # Check if game is over in normal mode (score <= 0)
            game_over = not unlimited_mode and new_score < 0

            if year_difference == 0 or is_skip or game_over or not unlimited_mode:
                # Move to next round if:
                # - correct guess, or
                # - skipped, or
                # - game over, or
                # - not in unlimited guess mode
                session['current_round'] = session.get('current_round', 0) + 1

                return jsonify({
                    "result": "correct" if year_difference == 0 else "incorrect",
                    "year_difference": year_difference,
                    "actual_year": actual_year,
                    "points_lost": points_lost,
                    "new_score": new_score,
                    "next_round": True,
                    "game_over": game_over,
                    "artist": current_song.get('artist', ''),
                    "title": current_song.get('title', ''),
                    "total_rounds": session.get('current_round', 0)
                })
            else:
                # Unlimited guesses mode - just return feedback
                hint = "Too " + ("high" if guess > actual_year else "low")

                return jsonify({
                    "result": "try_again",
                    "year_difference": year_difference,
                    "hint": hint,
                    "next_round": False
                })
    except Exception as e:
        print(f"Error in check_guess: {e}")
        # Safe fallback response
        return jsonify({
            "error": "Failed to process guess",
            "message": str(e),
            "result": "incorrect",
            "year_difference": 0,
            "actual_year": 2000,  # Safe default
            "points_lost": 0,
            "new_score": session.get('score', 100),
            "next_round": True
        })


# Admin endpoints
@app.route('/add-curated-song', methods=['POST'])
def add_curated_song():
    # This endpoint would be password protected in production
    data = request.get_json()

    date = data.get('date')
    songs = data.get('songs', [])

    if not date or not songs:
        return jsonify({"error": "Missing required data"}), 400

    curated_songs = load_curated_songs()
    curated_songs[date] = songs

    with open('curated_songs.json', 'w', encoding='utf-8') as f:
        json.dump(curated_songs, f, ensure_ascii=False, indent=2)

    return jsonify({"message": f"Added {len(songs)} songs for {date}"})


@app.route('/add-song', methods=['POST'])
def add_song():
    # This endpoint would be password protected in production
    data = request.get_json()

    title = data.get('title')
    artist = data.get('artist')
    year = data.get('year')

    if not title or not artist or not year:
        return jsonify({"error": "Missing required song data"}), 400

    songs = load_songs()

    # Check for duplicates
    for song in songs:
        if song['title'].lower() == title.lower() and song['artist'].lower() == artist.lower():
            return jsonify({"error": "Song already exists"}), 400

    # Add the new song
    songs.append({
        "title": title,
        "artist": artist,
        "year": int(year)
    })

    with open('songs.json', 'w', encoding='utf-8') as f:
        json.dump(songs, f, ensure_ascii=False, indent=2)

    return jsonify({"message": "Song added successfully"})

@app.route('/get-song-count', methods=['GET'])
def get_song_count():
    """Return the count of songs in the database."""
    songs = load_songs()
    count = int(len(songs))
    return jsonify({"count": count})

if __name__ == '__main__':
    # For local development
    app.run(debug=True)
else:
    # For production on Render
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 10000)))