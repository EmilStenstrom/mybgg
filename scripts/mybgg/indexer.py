import io
import re
import time

import colorgram
import requests
from algoliasearch.search_client import SearchClient
from PIL import Image, ImageFile

# Allow colorgram to read truncated files
ImageFile.LOAD_TRUNCATED_IMAGES = True

class Indexer:

    def __init__(self, app_id, apikey, index_name, hits_per_page):
        client = SearchClient.create(
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
                'min_age',
                'searchable(previous_players)',
                'numplays',
            ],
            'customRanking': ['asc(name)'],
            'highlightPreTag': '<strong class="highlight">',
            'highlightPostTag': '</strong>',
            'hitsPerPage': hits_per_page,
        })

        self._init_replicas(client, index)

        self.index = index

    def _init_replicas(self, client, mainIndex):

        mainIndex.set_settings({
            'replicas': [
                mainIndex.name + '_rank_ascending',
                mainIndex.name + '_numrated_descending',
                mainIndex.name + '_numowned_descending',
            ]
        })

        replica_index = client.init_index(mainIndex.name + '_rank_ascending')
        replica_index.set_settings({'ranking': ['asc(rank)']})

        replica_index = client.init_index(mainIndex.name + '_numrated_descending')
        replica_index.set_settings({'ranking': ['desc(usersrated)']})

        replica_index = client.init_index(mainIndex.name + '_numowned_descending')
        replica_index.set_settings({'ranking': ['desc(numowned)']})

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

    def _smart_truncate(self, content, length=700, suffix='...'):
        if len(content) <= length:
            return content
        else:
            return ' '.join(content[:length + 1].split(' ')[0:-1]) + suffix

    def _pick_long_paragraph(self, content):
        content = content.strip()
        if "\n\n" not in content:
            return content

        paragraphs = content.split("\n\n")
        for paragraph in paragraphs[:3]:
            paragraph = paragraph.strip()
            if len(paragraph) > 80:
                return paragraph

        return content

    def _prepare_description(self, description):
        # Try to find a long paragraph from the beginning of the description
        description = self._pick_long_paragraph(description)

        # Remove unnessesary spacing
        description = re.sub(r"\s+", " ", description)

        # Cut at 700 characters, but not in the middle of a sentence
        description = self._smart_truncate(description)

        return description

    @staticmethod
    def _remove_game_name_prefix(expansion_name, game_name):
        def remove_prefix(text, prefix):
            if text.startswith(prefix):
                return text[len(prefix):]

        # Expansion name: Catan: Cities & Knights
        # Game name: Catan
        # --> Cities & Knights
        if game_name + ": " in expansion_name:
            return remove_prefix(expansion_name, game_name + ": ")

        # Expansion name: Shadows of Brimstone: Outlaw Promo Cards
        # Game name: Shadows of Brimstone: City of the Ancients
        # --> Outlaw Promo Cards
        elif ":" in game_name:
            game_name_prefix = game_name[0:game_name.index(":")]
            if game_name_prefix + ": " in expansion_name:
                return expansion_name.replace(game_name_prefix + ": ", "")

        return expansion_name

    def fetch_image(self, url, tries=0):
        try:
            response = requests.get(url)
        except (requests.exceptions.ConnectionError, requests.exceptions.ChunkedEncodingError):
            if tries < 3:
                time.sleep(2)
                return self.fetch_image(url, tries=tries + 1)

        if response.status_code == 200:
            return response.content

        return None

    def add_objects(self, collection):
        games = [Indexer.todict(game) for game in collection]
        for i, game in enumerate(games):
            if i != 0 and i % 25 == 0:
                print(f"Indexed {i} of {len(games)} games...")

            if game["image"]:
                image_data = self.fetch_image(game["image"])
                if image_data:
                    image = Image.open(io.BytesIO(image_data)).convert('RGBA')

                    try_colors = 10
                    colors = colorgram.extract(image, try_colors)
                    for i in range(min(try_colors, len(colors))):
                        color_r, color_g, color_b = colors[i].rgb.r, colors[i].rgb.g, colors[i].rgb.b

                        # Don't return very light or dark colors
                        luma = (
                            0.2126 * color_r / 255.0 +
                            0.7152 * color_g / 255.0 +
                            0.0722 * color_b / 255.0
                        )
                        if (
                            luma > 0.2 and  # Not too dark
                            luma < 0.8     # Not too light
                        ):
                            break

                    else:
                        # As a fallback, use the first color
                        color_r, color_g, color_b = colors[0].rgb.r, colors[0].rgb.g, colors[0].rgb.b

                    game["color"] = f"{color_r}, {color_g}, {color_b}"

            game["objectID"] = f"bgg{game['id']}"

            # Turn players tuple into a hierarchical facet
            game["players"] = [
                self._facet_for_num_player(num, type_)
                for num, type_ in game["players"]
            ]

            # Algolia has a limit of 10kb per item, so remove unnessesary data from expansions
            attribute_map = {
                "id": lambda x: x,
                "name": lambda x: self._remove_game_name_prefix(x, game["name"]),
            }
            game["expansions"] = [
                {
                    attribute: func(expansion[attribute])
                    for attribute, func in attribute_map.items()
                    if func(expansion[attribute])
                }
                for expansion in game["expansions"]
            ]
            # Limit the number of expansions to 10 to keep the size down
            game["has_more_expansions"] = len(game["expansions"]) > 10
            game["expansions"] = game["expansions"][:10]

            # Make sure description is not too long
            game["description"] = self._prepare_description(game["description"])

        self.index.save_objects(games)

    def delete_objects_not_in(self, collection):
        delete_filter = " AND ".join([f"id != {game.id}" for game in collection])
        self.index.delete_by({
            'filters': delete_filter,
        })
