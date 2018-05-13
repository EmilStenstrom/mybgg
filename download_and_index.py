import json
import math
from collections import namedtuple
from textwrap import dedent

from algoliasearch import algoliasearch
from boardgamegeek import BGGClient

SETTINGS = json.load(open("config.json", "rb"))

class BoardGame:
    def __init__(self, *args, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)

class Downloader():
    def __init__(self):
        project_name = SETTINGS["project"]["name"]
        self.client = BGGClient()

    def collection(self, user_name):
        collection = self.client.collection(
            user_name=user_name,
            exclude_subtype=u'boardgameexpansion',
            **SETTINGS["boardgamegeek"]["extra_params"]
        )

        game_data = self.client.game_list(
            [game_in_collection.id for game_in_collection in collection.items]
        )

        return [self.game_data_to_boardgame(game) for game in game_data]

    def _num_players_is_recommended(self, num, votes):
        return int(votes['best_rating']) + int(votes['recommended_rating']) > int(votes['not_recommended_rating'])

    def _facet_for_num_player(self, num, num_with_maybe_plus, votes):
        is_best = int(votes['best_rating']) > 10 and int(votes['best_rating']) > int(votes['recommended_rating'])
        best_or_recommended = "Best" if is_best else "Recommended"

        return {
            "level1": num,
            "level2": f"{num} > " + best_or_recommended +  f" with {num_with_maybe_plus}",
        }

    def game_data_to_boardgame(self, game):
        num_players = []
        for num, votes in game.suggested_players['results'].items():
            if not self._num_players_is_recommended(num, votes):
                continue

            if "+" not in num:
                num_players.append(self._facet_for_num_player(num, num, votes))
            else:
                for i in range(int(num.replace("+", "")) + 1, 11):
                    num_players.append(self._facet_for_num_player(i, num, votes))

        playing_time_mapping = {
            30: '< 30min',
            60: '30min - 1h',
            120: '1-2h',
            180: '2-3h',
            240: '3-4h',
        }
        for playing_time_max, playing_time in playing_time_mapping.items():
            if playing_time_max > int(game.playing_time):
                break
        else:
            playing_time = '> 4h'

        weight_mapping = {
          0: "Light",
          1: "Light",
          2: "Light Medium",
          3: "Medium",
          4: "Medium Heavy",
          5: "Heavy",
        }
        weight = weight_mapping[math.ceil(game.rating_average_weight)]

        return BoardGame(
            id=game.id,
            name=game.name,
            description=game.description,
            image=game.thumbnail,
            categories=[cat for cat in game.categories],
            mechanics=[mec for mec in game.mechanics],
            players=num_players,
            weight=weight,
            playing_time=playing_time,
        )

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

def main(api_key_admin):
    downloader = Downloader()
    collection = downloader.collection(
        user_name=SETTINGS["boardgamegeek"]["user_name"]
    )
    print(f"Imported {len(collection)} games from boardgamegeek.")

    indexer = Indexer(api_key_admin=api_key_admin)
    indexer.add_objects(collection)
    indexer.delete_objects_not_in(collection)
    print(f"Indexed {len(collection)} games in algolia, and removed everything else.")

if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Download and index some boardgames')
    parser.add_argument(
        '--apikey',
        type=str,
        required=True,
        help='The admin api key for your algolia site'
    )

    args = parser.parse_args()

    main(api_key_admin=args.apikey)
