import json

from mybgg.downloader import Downloader
from mybgg.indexer import Indexer
from setup_logging import setup_logging

def main(args):
    SETTINGS = json.load(open("config.json", "rb"))

    downloader = Downloader(
        project_name=SETTINGS["project"]["name"],
        cache_bgg=args.cache_bgg,
        debug=args.debug,
    )
    collection = downloader.collection(
        user_name=SETTINGS["boardgamegeek"]["user_name"],
        extra_params=SETTINGS["boardgamegeek"]["extra_params"],
    )
    num_games = len(collection)
    num_expansions = sum([len(game.expansions) for game in collection])
    print(f"Imported {num_games} games and {num_expansions} expansions from boardgamegeek.")

    if not len(collection):
        assert False, "No games imported, is the boardgamegeek part of config.json correctly set?"

    if not args.no_indexing:
        hits_per_page = SETTINGS["algolia"].get("hits_per_page", 48)
        indexer = Indexer(
            app_id=SETTINGS["algolia"]["app_id"],
            apikey=args.apikey,
            index_name=SETTINGS["algolia"]["index_name"],
            hits_per_page=hits_per_page,
        )
        indexer.add_objects(collection)
        indexer.delete_objects_not_in(collection)

        print(f"Indexed {num_games} games and {num_expansions} expansions in algolia, and removed everything else.")
    else:
        print("Skipped indexing.")


if __name__ == '__main__':
    import argparse

    setup_logging()

    parser = argparse.ArgumentParser(description='Download and index some boardgames')
    parser.add_argument(
        '--apikey',
        type=str,
        required=True,
        help='The admin api key for your algolia site'
    )
    parser.add_argument(
        '--no_indexing',
        action='store_true',
        help=(
            "Skip indexing in algolia. This is useful during development"
            ", when you want to fetch data från BGG over and over again, "
            "and don't want to use up your indexing quota with Algolia."
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

    args = parser.parse_args()

    main(args)
