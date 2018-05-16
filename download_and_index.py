import json
import math
from collections import namedtuple, defaultdict
from textwrap import dedent

from algoliasearch import algoliasearch
from boardgamegeek import BGGClient
from boardgamegeek.cache import CacheBackendSqlite

class BoardGame:
    def __init__(self, game_data, tags=[], expansions=[]):
        self.id = game_data.id
        self.name = game_data.name
        self.description = game_data.description
        self.image = game_data.thumbnail
        self.categories = game_data.categories
        self.mechanics = game_data.mechanics
        self.players = self.calc_num_players(game_data, expansions)
        self.weight = self.calc_weight(game_data)
        self.playing_time = self.calc_playing_time(game_data)
        self.tags = tags
        self.expansions = expansions

    def _num_players_is_recommended(self, num, votes):
        return int(votes['best_rating']) + int(votes['recommended_rating']) > int(votes['not_recommended_rating'])

    def _num_players_is_best(self, num, votes):
        return int(votes['best_rating']) > 10 and int(votes['best_rating']) > int(votes['recommended_rating'])

    def calc_num_players(self, game_data, expansions):
        num_players = []
        for num, votes in game_data.suggested_players['results'].items():
            if not self._num_players_is_recommended(num, votes):
                continue

            if "+" not in num:
                is_best = self._num_players_is_best(num, votes)
                num_players.append((num, "best" if is_best else "recommended"))
            else:
                for i in range(int(num.replace("+", "")) + 1, 11):
                    is_best = self._num_players_is_best(num, votes)
                    num_players.append((num, "best" if is_best else "recommended"))

        for expansion in expansions:
            for expansion_num, _ in expansion.players:
                if expansion_num not in [num for num, _ in num_players]:
                    num_players.append((expansion_num, "expansion"))

        num_players = sorted(num_players, key=lambda x: int(x[0].replace("+", "")))

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
    def __init__(self, project_name, cache_bgg):
        if cache_bgg:
            self.client = BGGClient(
                cache=CacheBackendSqlite(
                    path=f"{project_name}-cache.sqlite",
                    ttl=60 * 60 * 24,
                )
            )
        else:
            self.client = BGGClient()

    def collection(self, user_name, extra_params):
        collection = []

        if isinstance(extra_params, list):
            for params in extra_params:
                collection += self.client.collection(
                    user_name=user_name,
                    **params,
                )
        else:
            collection = list(self.client.collection(
                user_name=user_name,
                **extra_params,
            ))

        games_data = self.client.game_list(
            [game_in_collection.id for game_in_collection in collection]
        )

        games = list(filter(lambda x: not x.expansion, games_data))
        expansions = list(filter(lambda x: x.expansion, games_data))

        game_id_to_expansion = {game.id: [] for game in games}
        for expansion_data in expansions:
            for expands_game in expansion_data.expands:
                if expands_game.id in game_id_to_expansion:
                    game_id_to_expansion[expands_game.id].append(expansion_data)

        game_id_to_tags = {game.id: [] for game in games}
        for stats_data in collection:
            if stats_data.id in game_id_to_tags:
                for tag in ['preordered', 'prevowned', 'want', 'wanttobuy', 'wanttoplay', 'fortrade', 'wishlist']:
                    if int(getattr(stats_data, tag)):
                        game_id_to_tags[stats_data.id].append(tag)

        return [
            BoardGame(
                game_data,
                tags=game_id_to_tags[game_data.id],
                expansions=[
                    BoardGame(expansion_data)
                    for expansion_data in game_id_to_expansion[game_data.id]
                ]
            )
            for game_data in games
        ]

class Indexer:
    def __init__(self, app_id, apikey, index_name):
        client = algoliasearch.Client(
            app_id=app_id,
            api_key=apikey,
        )
        index = client.init_index(index_name)

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

    @staticmethod
    def todict(obj):
        if isinstance(obj, str):
            return obj

        elif isinstance(obj, dict):
            return dict((key, Indexer.todict(val)) for key, val in obj.items())

        elif hasattr(obj, '__iter__'):
            return [Indexer.todict(val) for val in obj]

        elif hasattr(obj, '__dict__'):
            return Indexer.todict(vars(obj))

        return obj

    def _facet_for_num_player(self, num, type_):
        num_no_plus = num.replace("+", "")
        facet_types = {
            "best": {
                "level1": num_no_plus,
                "level2": f"{num_no_plus} > Best with {num}",
            },
            "recommended": {
                "level1": num_no_plus,
                "level2": f"{num_no_plus} > Recommended with {num}",
            },
            "expansion": {
                "level1": num_no_plus,
                "level2": f"{num_no_plus} > Expansion allows {num}",
            },
        }

        return facet_types[type_]

    def add_objects(self, collection):
        games = [Indexer.todict(game) for game in collection]
        for game in games:
            game["objectID"] = f"bgg{game['id']}"

            # Turn players tuple into a hierarchical facet
            game["players"] = [
                self._facet_for_num_player(num, type_)
                for num, type_ in game["players"]
            ]

            # Don't index descriptions of expansions, they make objects too big
            for expansion in game["expansions"]:
                del(expansion["description"])

        self.index.add_objects(games)

    def delete_objects_not_in(self, collection):
        delete_filter = " AND ".join([f"id != {game.id}" for game in collection])
        self.index.delete_by({
            'filters': delete_filter,
        })

def main(args):
    SETTINGS = json.load(open("config.json", "rb"))

    downloader = Downloader(
        project_name=SETTINGS["project"]["name"],
        cache_bgg=args.cache_bgg,
    )
    collection = downloader.collection(
        user_name=SETTINGS["boardgamegeek"]["user_name"],
        extra_params=SETTINGS["boardgamegeek"]["extra_params"],
    )
    print(f"Imported {len(collection)} games from boardgamegeek.")

    if not len(collection):
        assert False, "No games imported, is the boardgamegeek part of config.json correctly set?"

    if not args.no_indexing:
        indexer = Indexer(
            app_id=SETTINGS["algolia"]["app_id"],
            apikey=args.apikey,
            index_name=SETTINGS["algolia"]["index_name"],
        )
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
    parser.add_argument(
        '--cache_bgg',
        action='store_true',
        help="Enable a cache for all BGG calls. This makes script run very fast the second time it's run. Bug doesn't fetch new data från BGG."
    )

    args = parser.parse_args()

    main(args)
