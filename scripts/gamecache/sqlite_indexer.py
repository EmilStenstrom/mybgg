import sqlite3
import json
import logging
from typing import List, Dict, Any
from .models import BoardGame
import io
import time  # Added for fetch_image retry
from .vendor import colorgram
from PIL import Image, ImageFile
from .http_client import make_http_request

# Allow colorgram to read truncated files
ImageFile.LOAD_TRUNCATED_IMAGES = True

logger = logging.getLogger(__name__)


class SqliteIndexer:
    """SQLite-based indexer to replace Algolia indexer."""

    def __init__(self, db_path: str = "gamecache.sqlite"):
        self.db_path = db_path
        self.db_path_gz = f"{db_path}.gz"
        self._init_database()

    def _init_database(self):
        """Initialize the SQLite database with required tables."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # Drop existing table if it exists
        cursor.execute('DROP TABLE IF EXISTS games')

        # Create games table with all necessary fields
        cursor.execute('''
            CREATE TABLE games (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                categories TEXT,  -- JSON array
                mechanics TEXT,   -- JSON array
                players TEXT,     -- JSON array of [number, type] pairs
                weight REAL,
                playing_time TEXT,
                min_age INTEGER,
                rank INTEGER,
                usersrated INTEGER,
                numowned INTEGER,
                rating REAL,
                numplays INTEGER,
                image TEXT,
                tags TEXT,        -- JSON array
                previous_players TEXT,  -- JSON array
                expansions TEXT,  -- JSON array
                color TEXT       -- Changed from colors to color (singular)
            )
        ''')

        # Create indexes for better search performance
        cursor.execute('CREATE INDEX idx_name ON games(name)')
        cursor.execute('CREATE INDEX idx_categories ON games(categories)')
        cursor.execute('CREATE INDEX idx_mechanics ON games(mechanics)')
        cursor.execute('CREATE INDEX idx_weight ON games(weight)')
        cursor.execute('CREATE INDEX idx_playing_time ON games(playing_time)')
        cursor.execute('CREATE INDEX idx_min_age ON games(min_age)')
        cursor.execute('CREATE INDEX idx_rank ON games(rank)')
        cursor.execute('CREATE INDEX idx_rating ON games(rating)')
        cursor.execute('CREATE INDEX idx_numplays ON games(numplays)')

        conn.commit()
        conn.close()
        logger.info(f"Initialized SQLite database: {self.db_path}")

    def fetch_image(self, url, tries=0):  # Copied from indexer.py
        try:
            response = make_http_request(url)
        except Exception as e:
            logger.warning(f"Failed to fetch image {url} (try {tries + 1}): {e}")
            if tries < 2:  # Max 3 tries (0, 1, 2)
                time.sleep(2)
                return self.fetch_image(url, tries=tries + 1)
            return None  # Return None after max retries

        return response

    def add_objects(self, collection: List[BoardGame]):
        """Add BoardGame objects to the SQLite database."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # Clear existing data
        cursor.execute('DELETE FROM games')

        for game_obj in collection:  # Renamed game to game_obj to avoid conflict with game dict
            game = game_obj.todict()  # Convert BoardGame object to dictionary

            # Convert complex fields to JSON strings
            categories_json = json.dumps(game.get('categories', []))
            mechanics_json = json.dumps(game.get('mechanics', []))
            players_json = json.dumps(game.get('players', []))
            tags_json = json.dumps(game.get('tags', []))
            previous_players_json = json.dumps(game.get('previous_players', []))
            expansions_list = game.get('expansions', [])
            expansions_json = json.dumps([self._expansion_to_dict(exp) for exp in expansions_list if exp])

            color_str = None
            if game.get("image"):
                image_data = self.fetch_image(game["image"])
                if image_data:
                    try:
                        pil_image = Image.open(io.BytesIO(image_data)).convert('RGBA')
                        num_colors_to_try = 10
                        extracted_colors = colorgram.extract(pil_image, num_colors_to_try)

                        if extracted_colors:
                            selected_color_rgb = None
                            for i in range(min(num_colors_to_try, len(extracted_colors))):
                                c = extracted_colors[i].rgb
                                luma = (
                                    0.2126 * c.r / 255.0 +
                                    0.7152 * c.g / 255.0 +
                                    0.0722 * c.b / 255.0
                                )
                                if 0.2 < luma < 0.8:  # Not too dark, not too light
                                    selected_color_rgb = c
                                    break

                            if not selected_color_rgb:  # Fallback to the first color
                                selected_color_rgb = extracted_colors[0].rgb

                            color_str = f"{selected_color_rgb.r}, {selected_color_rgb.g}, {selected_color_rgb.b}"
                        else:
                            logger.warning(f"Colorgram could not extract colors for image: {game['image']}")
                    except Exception as e:
                        logger.error(f"Error processing image for color extraction {game['image']}: {e}")

            if not color_str:  # Default color if extraction fails or no image
                color_str = "255, 255, 255"  # White

            cursor.execute('''
                INSERT INTO games (
                    id, name, description, categories, mechanics, players,
                    weight, playing_time, min_age, rank, usersrated, numowned,
                    rating, numplays, image, tags, previous_players, expansions, color
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                game.get('id'), game.get('name'), game.get('description'), categories_json, mechanics_json,
                players_json,
                float(game.get('weight')) if game.get('weight') is not None else None,
                game.get('playing_time'),
                game.get('min_age'),
                int(game.get('rank')) if game.get('rank') is not None else None,
                int(game.get('usersrated')) if game.get('usersrated') is not None else None,
                int(game.get('numowned')) if game.get('numowned') is not None else None,
                float(game.get('rating')) if game.get('rating') is not None else None,
                game.get('numplays'), game.get('image'), tags_json, previous_players_json,
                expansions_json, color_str
            ))
        conn.commit()
        conn.close()
        logger.info(f"Added {len(collection)} games to SQLite database")

    def _expansion_to_dict(self, expansion) -> Dict[str, Any]:
        """Convert expansion object to dictionary for JSON serialization."""
        # Ensure expansion is a dict or can be converted
        if isinstance(expansion, dict):
            return {
                'id': expansion.get('id'),
                'name': expansion.get('name', ''),
                'players': expansion.get('players', []),
            }
        if hasattr(expansion, 'todict'):  # If it's an object with todict method
            exp_dict = expansion.todict()
            return {
                'id': exp_dict.get('id'),
                'name': exp_dict.get('name', ''),
                'players': exp_dict.get('players', []),
            }
        if hasattr(expansion, '__dict__'):  # Fallback for simple objects
            exp_vars = vars(expansion)
            return {
                'id': exp_vars.get('id'),
                'name': exp_vars.get('name', ''),
                'players': exp_vars.get('players', []),
            }
        logger.warning(f"Cannot convert expansion to dict: {expansion}")
        return {}
