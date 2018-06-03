from boardgamegeek import BGGClient
from boardgamegeek.cache import CacheBackendSqlite
from mybgg.models import BoardGame


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
