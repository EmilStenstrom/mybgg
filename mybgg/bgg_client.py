import logging
import time
from xml.etree.ElementTree import fromstring

import declxml as xml
import requests
from requests_cache import CachedSession

logger = logging.getLogger(__name__)

class BGGClient:
    BASE_URL = "https://www.boardgamegeek.com/xmlapi2"

    def __init__(self, cache=None, debug=False):
        if not cache:
            self.requester = requests.Session()
        else:
            self.requester = cache.cache

        if debug:
            logging.basicConfig(level=logging.DEBUG)

    def collection(self, user_name, **kwargs):
        params = kwargs.copy()
        params["username"] = user_name
        data = self._make_request("/collection", params)
        collection = self._collection_to_games(data)
        return collection

    def game_list(self, game_ids):
        if not game_ids:
            return []

        url = "/thing/?stats=1&id=" + ",".join([str(id_) for id_ in game_ids])
        data = self._make_request(url)
        games = self._games_list_to_games(data)
        return games

    def _make_request(self, url, params={}, tries=0):
        response = self.requester.get(BGGClient.BASE_URL + url, params=params)
        logger.debug("REQUEST: " + response.url)
        logger.debug("RESPONSE: \n" + prettify_if_xml(response.text))

        if response.status_code != 200:

            # Handle: 202 Accepted, and 504 Gateway Timeout
            if response.status_code in [202, 540]:
                if tries < 5:
                    time.sleep(2)
                    return self._make_request(url, params=params, tries=tries + 1)

            raise BGGException(
                f"BGG returned status code {response.status_code} when "
                f"requesting {response.url}"
            )

        tree = fromstring(response.text)
        if tree.tag == "errors":
            raise BGGException(
                f"BGG returned errors while requesting {response.url} - " +
                str([subnode.text for node in tree for subnode in node])
            )

        return response.text

    def _collection_to_games(self, data):
        game_in_collection_processor = xml.dictionary("items", [
            xml.array(
                xml.dictionary('item', [
                    xml.integer(".", attribute="objectid", alias="id"),
                    xml.string("name"),
                    xml.string("status", attribute="fortrade"),
                    xml.string("status", attribute="own"),
                    xml.string("status", attribute="preordered"),
                    xml.string("status", attribute="prevowned"),
                    xml.string("status", attribute="want"),
                    xml.string("status", attribute="wanttobuy"),
                    xml.string("status", attribute="wanttoplay"),
                    xml.string("status", attribute="wishlist"),
                    xml.integer("numplays"),
                ], required=False, alias="items"),
            )
        ])
        collection = xml.parse_from_string(game_in_collection_processor, data)
        collection = collection["items"]

        # Collect all status attributes in one field called "tags"
        attributes = ["fortrade", "preordered", "prevowned", "want", "wanttobuy", "wanttoplay", "wishlist"]
        for game in collection:
            tags = []
            for attribute in attributes:
                if game[attribute] == "1":
                    tags.append(attribute)

                del game[attribute]

            game["tags"] = tags

        return collection

    def _games_list_to_games(self, data):
        game_processor = xml.dictionary("items", [
            xml.array(
                xml.dictionary("item", [
                    xml.integer(".", attribute="id"),
                    xml.string(".", attribute="type"),
                    xml.string("name[@type='primary']", attribute="value", alias="name"),
                    xml.string("description"),
                    xml.string("image", required=False, alias="thumbnail"),
                    xml.array(
                        xml.string(
                            "link[@type='boardgamecategory']",
                            attribute="value",
                            required=False
                        ),
                        alias="categories",
                    ),
                    xml.array(
                        xml.string(
                            "link[@type='boardgamemechanic']",
                            attribute="value",
                            required=False
                        ),
                        alias="mechanics",
                    ),
                    xml.array(
                        xml.dictionary(
                            "link[@type='boardgameexpansion']", [
                                xml.integer(".", attribute="id"),
                                xml.boolean(".", attribute="inbound", required=False),
                            ],
                            required=False
                        ),
                        alias="expansions",
                    ),
                    xml.array(
                        xml.dictionary("poll[@name='suggested_numplayers']/results", [
                            xml.string(".", attribute="numplayers"),
                            xml.array(
                                xml.dictionary("result", [
                                    xml.string(".", attribute="value"),
                                    xml.integer(".", attribute="numvotes"),
                                ]),
                            )
                        ]),
                        alias="suggested_numplayers"
                    ),
                    xml.string(
                        "statistics/ratings/averageweight",
                        attribute="value",
                        alias="weight"
                    ),
                    xml.string(
                        "statistics/ratings/ranks/rank[@friendlyname='Board Game Rank']",
                        attribute="value",
                        alias="rank"
                    ),
                    xml.string(
                        "statistics/ratings/bayesaverage",
                        attribute="value",
                        alias="rating"
                    ),
                    xml.string("playingtime", attribute="value", alias="playing_time"),
                ], required=False, alias="items")
            )
        ])
        games = xml.parse_from_string(game_processor, data)
        games = games["items"]
        return games

class CacheBackendSqlite:
    def __init__(self, path, ttl):
        self.cache = CachedSession(
            cache_name=path,
            backend="sqlite",
            expire_after=ttl,
            extension="",
            fast_save=True,
            allowable_codes=(200,)
        )

class BGGException(Exception):
    pass

def prettify_if_xml(xml_string):
    import xml.dom.minidom
    import re
    xml_string = re.sub(r"\s+<", "<", re.sub(r">\s+", ">", re.sub(r"\s+", " ", xml_string)))
    if not xml_string.startswith("<?xml"):
        return xml_string

    parsed = xml.dom.minidom.parseString(xml_string)
    return parsed.toprettyxml()
