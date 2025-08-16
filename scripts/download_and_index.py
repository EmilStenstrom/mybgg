import sys
import gzip
import os
from pathlib import Path

# Add the scripts directory to the path for imports
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

# Now import after path is set
from gamecache.downloader import Downloader  # noqa: E402
from gamecache.sqlite_indexer import SqliteIndexer  # noqa: E402
from gamecache.github_integration import setup_github_integration  # noqa: E402
from gamecache.config import parse_config_file, create_nested_config  # noqa: E402
from setup_logging import setup_logging  # noqa: E402

def main(args):
    config = parse_config_file(args.config)
    # Convert flat config to nested structure for backward compatibility
    SETTINGS = create_nested_config(config)

    downloader = Downloader(
        cache_bgg=args.cache_bgg,
        debug=args.debug,
    )
    extra_params = SETTINGS["boardgamegeek"].get("extra_params", {"own": 1})
    collection = downloader.collection(
        user_name=SETTINGS["boardgamegeek"]["user_name"],
        extra_params=extra_params,
    )

    # Deduplicate collection based on game ID
    seen_ids = set()
    unique_collection = []
    for game in collection:
        if game.id not in seen_ids:
            unique_collection.append(game)
            seen_ids.add(game.id)
    collection = unique_collection

    num_games = len(collection)
    num_expansions = sum([len(game.expansions) for game in collection])
    print(f"Imported {num_games} games and {num_expansions} expansions from boardgamegeek.")

    if not len(collection):
        assert False, "No games imported, is the boardgamegeek part of config.ini correctly set?"

    # Create SQLite database
    sqlite_path = "gamecache.sqlite"
    indexer = SqliteIndexer(sqlite_path)
    indexer.add_objects(collection)
    print(f"Created SQLite database with {num_games} games and {num_expansions} expansions.")

    # Gzip the database and remove the original
    gzip_path = f"{sqlite_path}.gz"
    with open(sqlite_path, 'rb') as f_in, gzip.open(gzip_path, 'wb') as f_out:
        f_out.write(f_in.read())
    os.remove(sqlite_path)
    print(f"Created gzipped database: {gzip_path}")

    # Upload to GitHub if not disabled
    if not args.no_upload:
        try:
            github_manager = setup_github_integration(SETTINGS)

            # Upload the gzipped SQLite file
            snapshot_tag = SETTINGS["github"].get("snapshot_tag", "database")
            asset_name = SETTINGS["github"].get("snapshot_asset", "gamecache.sqlite.gz")

            download_url = github_manager.upload_snapshot(gzip_path, snapshot_tag, asset_name)
            print(f"Successfully uploaded to GitHub: {download_url}")

        except Exception as e:
            print(f"Error uploading to GitHub: {e}")
            sys.exit(1)
    else:
        print("Skipped GitHub upload.")


if __name__ == '__main__':
    import argparse

    setup_logging()

    parser = argparse.ArgumentParser(description='Download and create SQLite database of boardgames')
    parser.add_argument(
        '--no_upload',
        action='store_true',
        help=(
            "Skip uploading to GitHub. This is useful during development"
            ", when you want to test the SQLite creation without uploading."
        )
    )
    parser.add_argument(
        '--cache_bgg',
        action='store_true',
        help=(
            "Enable a cache for all BGG calls. This makes script run very "
            "fast the second time it's run."
        )
    )
    parser.add_argument(
        '--debug',
        action='store_true',
        help="Print debug information, such as requests made and responses received."
    )
    parser.add_argument(
        '--config',
        type=str,
        required=False,
        default="config.ini",
        help="Path to the config file (default: config.ini from the working directory)."
    )

    args = parser.parse_args()

    main(args)
