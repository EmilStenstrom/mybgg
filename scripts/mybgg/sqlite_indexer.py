import sqlite3
import json
import gzip
import logging
import os
from typing import List, Dict, Any
from .models import BoardGame


logger = logging.getLogger(__name__)


class SqliteIndexer:
    """SQLite-based indexer to replace Algolia indexer."""

    def __init__(self, db_path: str = "mybgg.sqlite"):
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
                weight TEXT,
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
                colors TEXT       -- JSON array for image colors
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

    def add_objects(self, collection: List[BoardGame]):
        """Add BoardGame objects to the SQLite database."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # Clear existing data
        cursor.execute('DELETE FROM games')

        for game in collection:
            # Convert complex fields to JSON strings
            categories_json = json.dumps(game.categories)
            mechanics_json = json.dumps(game.mechanics)
            players_json = json.dumps(game.players)
            tags_json = json.dumps(game.tags)
            previous_players_json = json.dumps(game.previous_players)
            expansions_json = json.dumps([self._expansion_to_dict(exp) for exp in game.expansions])

            # Extract colors from image (simplified - you may want to implement color extraction)
            colors_json = json.dumps([])  # Placeholder for now

            cursor.execute('''
                INSERT INTO games (
                    id, name, description, categories, mechanics, players,
                    weight, playing_time, min_age, rank, usersrated, numowned,
                    rating, numplays, image, tags, previous_players, expansions, colors
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                game.id, game.name, game.description, categories_json, mechanics_json,
                players_json, str(game.weight) if game.weight is not None else None, game.playing_time, game.min_age,
                str(game.rank) if game.rank is not None else None,
                str(game.usersrated) if game.usersrated is not None else None,
                str(game.numowned) if game.numowned is not None else None,
                str(game.rating) if game.rating is not None else None,
                game.numplays, game.image, tags_json, previous_players_json,
                expansions_json, colors_json
            ))
        conn.commit()
        conn.close()
        logger.info(f"Added {len(collection)} games to SQLite database")

        # Create gzipped version
        self._create_gzipped_version()

    def _expansion_to_dict(self, expansion) -> Dict[str, Any]:
        """Convert expansion object to dictionary for JSON serialization."""
        if hasattr(expansion, '__dict__'):
            return {
                'id': getattr(expansion, 'id', None),
                'name': getattr(expansion, 'name', ''),
                'players': getattr(expansion, 'players', []),
                # Add other expansion fields as needed
            }
        return {}

    def _create_gzipped_version(self):
        """Create a gzipped version of the SQLite database."""
        with open(self.db_path, 'rb') as f_in:
            with gzip.open(self.db_path_gz, 'wb') as f_out:
                f_out.writelines(f_in)

        # Get file sizes for logging
        original_size = os.path.getsize(self.db_path)
        compressed_size = os.path.getsize(self.db_path_gz)
        compression_ratio = (1 - compressed_size / original_size) * 100

        logger.info(f"Created gzipped database: {self.db_path_gz}")
        logger.info(f"Original size: {original_size:,} bytes")
        logger.info(f"Compressed size: {compressed_size:,} bytes")
        logger.info(f"Compression ratio: {compression_ratio:.1f}%")

    def delete_objects_not_in(self, collection: List[BoardGame]):
        """This method is not needed for SQLite since we replace all data each time."""
        pass
