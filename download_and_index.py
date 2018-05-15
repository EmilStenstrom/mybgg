import json
import math
from collections import namedtuple
from textwrap import dedent

from algoliasearch import algoliasearch
from boardgamegeek import BGGClient

SETTINGS = json.load(open("config.json", "rb"))

class BoardGame:
    def __init__(self, game_data):
        self.id = game_data.id
        self.name = game_data.name
        self.description = game_data.description
        self.image = game_data.thumbnail
        self.categories = game_data.categories
        self.mechanics = game_data.mechanics
        self.players = self.calc_num_players(game_data)
        self.weight = self.calc_weight(game_data)
        self.playing_time = self.calc_playing_time(game_data)

    def _num_players_is_recommended(self, num, votes):
        return int(votes['best_rating']) + int(votes['recommended_rating']) > int(votes['not_recommended_rating'])

    def _facet_for_num_player(self, num, num_with_maybe_plus, votes):
        is_best = int(votes['best_rating']) > 10 and int(votes['best_rating']) > int(votes['recommended_rating'])
        best_or_recommended = "Best" if is_best else "Recommended"

        return {
            "level1": num,
            "level2": f"{num} > " + best_or_recommended +  f" with {num_with_maybe_plus}",
        }

    def calc_num_players(self, game_data):
        num_players = []
        for num, votes in game_data.suggested_players['results'].items():
            if not self._num_players_is_recommended(num, votes):
                continue

            if "+" not in num:
                num_players.append(self._facet_for_num_player(num, num, votes))
            else:
                for i in range(int(num.replace("+", "")) + 1, 11):
                    num_players.append(self._facet_for_num_player(i, num, votes))

        return num_players

    def calc_playing_time(self, game_data):
        playing_time_mapping = {
            30: '< 30min',
            60: '30min - 1h',
            120: '1-2h',
            180: '2-3h',
            240: '3-4h',
        }
        for playing_time_max, playing_time in playing_time_mapping.items():
            if playing_time_max > int(game_data.playing_time):
                return playing_time

        return '> 4h'

    def calc_weight(self, game_data):
        weight_mapping = {
            0: "Light",
            1: "Light",
            2: "Light Medium",
            3: "Medium",
            4: "Medium Heavy",
            5: "Heavy",
        }
        return weight_mapping[math.ceil(game_data.rating_average_weight)]

class Downloader():
    def __init__(self):
        project_name = SETTINGS["project"]["name"]
        self.client = BGGClient()

    def collection(self, user_name):
        collection = self.client.collection(
            user_name=user_name,
            **SETTINGS["boardgamegeek"]["extra_params"]
        )

        games_data = self.client.game_list(
            [game_in_collection.id for game_in_collection in collection.items]
        )

        return [BoardGame(game_data) for game_data in games_data]

class Indexer:
    def __init__(self, api_key_admin):
        client = algoliasearch.Client(
            app_id=SETTINGS["algolia"]["app_id"],
            api_key=api_key_admin,
        )
        index = client.init_index(SETTINGS["algolia"]["index_name"])

        index.set_settings({
            'searchableAttributes': [
                'name',
                'description',
            ],
            'attributesForFaceting': [
                'categories',
                'mechanics',
                'players',
                'weight',
                'playing_time',
            ],
            'customRanking': ['asc(name)'],
            'highlightPreTag': '<strong class="highlight">',
            'highlightPostTag': '</strong>'
        })

        self.index = index

    def add_objects(self, collection):
        games = [game.__dict__ for game in collection]
        for game in games:
            game["objectID"] = f"bgg{game['id']}"

        self.index.add_objects(games)

    def delete_objects_not_in(self, collection):
        delete_filter = " AND ".join([f"id != {game.id}" for game in collection])
        self.index.delete_by({
            'filters': delete_filter,
        })

def main(args):
    downloader = Downloader()
    collection = downloader.collection(
        user_name=SETTINGS["boardgamegeek"]["user_name"]
    )
    print(f"Imported {len(collection)} games from boardgamegeek.")

    if not args.no_indexing:
        indexer = Indexer(api_key_admin=args.api_key_admin)
        indexer.add_objects(collection)
        indexer.delete_objects_not_in(collection)
        print(f"Indexed {len(collection)} games in algolia, and removed everything else.")
    else:
        print("Skipped indexing.")

if __name__ == '__main__':
    import argparse

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
        help="Skip indexing in algolia. This is useful during development, when you want to fetch data från BGG over and over again, and don't want to use up your indexing quota with Algolia."
    )

    args = parser.parse_args()

    main(args)
