import re

from algoliasearch import algoliasearch


class Indexer:
    def __init__(self, app_id, apikey, index_name, hits_per_page, sort_by):
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
            'customRanking': [sort_by],
            'highlightPreTag': '<strong class="highlight">',
            'highlightPostTag': '</strong>',
            'hitsPerPage': hits_per_page,
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

    def _smart_truncate(self, content, length=700, suffix='...'):
        if len(content) <= length:
            return content
        else:
            return ' '.join(content[:length+1].split(' ')[0:-1]) + suffix

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

    def add_objects(self, collection):
        games = [Indexer.todict(game) for game in collection]
        for game in games:
            game["objectID"] = f"bgg{game['id']}"

            # Turn players tuple into a hierarchical facet
            game["players"] = [
                self._facet_for_num_player(num, type_)
                for num, type_ in game["players"]
            ]

            # Algolia has a limit of 10kb per item, so remove unnessesary data from expansions
            game["expansions"] = [
                {
                    attribute: expansion[attribute]
                    for attribute in ["id", "name", "players"]
                }
                for expansion in game["expansions"]
            ]

            # Make sure description is not too long
            game["description"] = self._prepare_description(game["description"])

        self.index.add_objects(games)

    def delete_objects_not_in(self, collection):
        delete_filter = " AND ".join([f"id != {game.id}" for game in collection])
        self.index.delete_by({
            'filters': delete_filter,
        })
