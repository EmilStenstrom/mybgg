from decimal import Decimal
from datetime import datetime
import html
import re


articles = ['A', 'An', 'The']

class BoardGame:
    def __init__(self, game_data, collection_data, expansions=[], accessories=[]):
        self.id = game_data["id"]

        name = collection_data["name"]
        if len(name) == 0:
            name = game_data["name"]

        alt_names = self.gen_name_list(game_data, collection_data)
        self.alternate_names = list(dict.fromkeys(alt_names)) # De-dupe the list, keeping order

        title = name.split()
        if title[0] in articles:
            name = ' '.join(title[1:]) + ", " + title[0]

        self.name = name

        self.description = html.unescape(game_data["description"])
        self.categories = game_data["categories"]
        self.mechanics = game_data["mechanics"]
        self.contained = game_data["contained"]
        self.families = game_data["families"]
        self.artists = game_data["artists"]
        self.designers = game_data["designers"]
        self.publishers = game_data["publishers"]
        self.reimplements = list(filter(lambda g: g["inbound"], game_data["reimplements"]))
        self.reimplementedby = list(filter(lambda g: not g["inbound"], game_data["reimplements"]))
        self.integrates = game_data["integrates"]
        self.players = self.calc_num_players(game_data, expansions)
        self.weight = self.calc_weight(game_data)
        self.weightRating = float(game_data["weight"]) if game_data["weight"].strip() else -1
        self.year = game_data["year"]
        self.playing_time = self.calc_playing_time(game_data)
        self.min_age = self.calc_min_age(game_data)
        self.rank = self.calc_rank(game_data)
        self.other_ranks = self.filter_other_ranks(game_data)
        self.usersrated = self.calc_usersrated(game_data)
        self.numowned = self.calc_numowned(game_data)
        self.average = self.calc_average(game_data)
        self.rating = self.calc_rating(game_data)
        self.suggested_age = self.calc_suggested_age(game_data)
        self.numplays = collection_data["numplays"]
        self.image = collection_data["image_version"] or collection_data["image"] or game_data["image"]
        self.tags = collection_data["tags"]
        self.comment = collection_data["comment"]
        self.wishlist_comment = collection_data["wishlist_comment"]
        if "players" in collection_data:
            self.previous_players = list(set(collection_data["players"]))
        self.expansions = expansions
        self.accessories = accessories

        self.lastmodified = datetime.strptime(collection_data["last_modified"], '%Y-%m-%d %H:%M:%S')
        self.version_name = collection_data["version_name"]
        self.version_year = collection_data["version_year"]
        self.collection_id = collection_data["collection_id"]


    def __hash__(self):
        return hash(self.id)

    def __eq__(self, other):
        return (self.__class__ == other.__class__ and self.id == other.id)

    def calc_num_players(self, game_data, expansions):
        num_players = game_data["suggested_numplayers"].copy()

        for supported_num in range(game_data["min_players"], game_data["max_players"] + 1):
            if supported_num > 0 and str(supported_num) not in [num for num, _ in num_players]:
                num_players.append((str(supported_num), "supported"))

        # Add number of players from expansions
        for expansion in expansions:
            # First add all the recommended player counts from expansions, then look for additional counts that are just supported.
            for expansion_num, support in expansion.players:
                if expansion_num not in [num for num, _ in num_players]:
                    if support != "supported":
                        num_players.append((expansion_num, "expansion"))
            for expansion_num, support in expansion.players:
                if expansion_num not in [num for num, _ in num_players]:
                    if support == "supported":
                        num_players.append((expansion_num, "exp_supported"))

        num_players = sorted(num_players, key=lambda x: int(x[0].replace("+", "")))

        # Remove "+ player counts if they are not the last in the list
        # Also remove player counts >=14, except for the max player count (e.g. 1-100 suggested player counts will only list 1-13,100)
        num_players[:-1] = [ player for player in num_players[:-1] if player[0][-1] != "+" and int(player[0]) < 14 ]

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
            if not game_data["playing_time"]:
                return 'Unknown'
            if playing_time_max > int(game_data["playing_time"]):
                return playing_time

        return '> 4h'

    def calc_min_age(self, game_data):
        if "min_age" not in game_data or not game_data["min_age"]:
            return None

        min_age = int(game_data["min_age"])
        if min_age == 0:
            return None

        return min_age

    def calc_rank(self, game_data):
        if not game_data["rank"] or game_data["rank"] == "Not Ranked":
            return None

        return Decimal(game_data["rank"])

    def calc_usersrated(self, game_data):
        if not game_data["usersrated"]:
            return 0

        return Decimal(game_data["usersrated"])

    def calc_numowned(self, game_data):
        if not game_data["numowned"]:
            return 0

        return Decimal(game_data["numowned"])

    def calc_rating(self, game_data):
        if not game_data["rating"]:
            return None

        return Decimal(game_data["rating"])

    def calc_average(self, game_data):
        if not game_data["average"]:
            return None

        return Decimal(game_data["average"])

    def calc_weight(self, game_data):
        weight_mapping = {
            -1: "Unknown",
            0: "Light",
            1: "Light",
            2: "Light Medium",
            3: "Medium",
            4: "Medium Heavy",
            5: "Heavy",
        }

        return weight_mapping[round(Decimal(game_data["weight"] or -1))]

    def calc_suggested_age(self, game_data):

        sum = 0
        total_votes = 0
        suggested_age = 0

        for player_age in game_data["suggested_playerages"]:
            count = player_age["numvotes"]
            sum += int(player_age["age"]) * count
            total_votes += count

        if total_votes > 0:
            suggested_age = round(sum / total_votes, 2)

        return suggested_age

    def filter_other_ranks(self, game_data):

        # Remove the BGG Rank, since it's already handled elsewhere
        other_ranks = list(filter(lambda g: g["id"] != "1" and g["value"] != "Not Ranked", game_data["other_ranks"]))

        for i, rank in enumerate(other_ranks):
            other_ranks[i]["friendlyname"] = re.sub(" Rank", "", rank["friendlyname"])

        return other_ranks

    def gen_name_list(self, game_data, collection_data):
        """rules for cleaning up linked items to remove duplicate data, such as the title being repeated on every expansion"""

        game = game_data["name"]

        game_titles = []
        game_titles.append(collection_data["name"])
        game_titles.append(game)
        game_titles.append(game.split("–")[0].strip()) # Medium Title
        game_titles.append(game.split(":")[0].strip()) # Short Title
        game_titles.append(game.split("(")[0].strip()) # No Edition

        # Carcassonne Big Box 5, Alien Frontiers Big Box, El Grande Big Box
        if any("Big Box" in title for title in game_titles):
            game_tmp = re.sub(r"\s*\(?Big Box.*", "", game, flags=re.IGNORECASE)
            game_titles.append(game_tmp)

        # TODO maybe add a rule to put title without number on the title list
        if "Burgle Bros." in game_titles:
            game_titles.append("Burgle Bros 2")
        elif "Burgle Bros 2" in game_titles:
            game_titles.append("Burgle Bros.")
        # elif "Cartographers" in game_titles:
        #     game_titles.insert(0, "Cartographers: A Roll Player Tale")  # This needs to be first in the list
        elif "Cartographers Heroes" in game_titles:
            game_titles.append("Cartographers: A Roll Player Tale")
            game_titles.append("Cartographers")
        elif "Chronicles of Crime" in game_titles:
            game_titles.insert(0, "The Millennium Series")
            game_titles.insert(0, "Chronicles of Crime: The Millennium Series")
        elif "DC Comics Deck-Building Game" in game_titles:
            game_titles.append("DC Deck-Building Game")
            game_titles.append("DC Deck Building Game")
        elif "DC Deck-Building Game" in game_titles:
            game_titles.append("DC Comics Deck-Building Game")
            game_titles.append("DC Deck Building Game")
        elif "Hive Pocket" in game_titles:
            game_titles.append("Hive")
        elif any(title in ("King of Tokyo", "King of New York") for title in game_titles):
            game_titles.insert(0, "King of Tokyo/New York")
            game_titles.insert(0, "King of Tokyo/King of New York")
        elif "Legends of Andor" in game_titles:
            game_titles.append("Die Legenden von Andor")
        elif "No Thanks!" in game_titles:
            game_titles.append("Schöne Sch#!?e")
        elif "Power Grid Deluxe" in game_titles:
            game_titles.append("Power Grid")
        elif "Queendomino" in game_titles:
            game_titles.append("Kingdomino")
        elif "Rivals for Catan" in game_titles:
            game_titles.append("The Rivals for Catan")
            game_titles.append("Die Fürsten von Catan")
            game_titles.append("Catan: Das Duell")
        elif "Rococo" in game_titles:
            game_titles.append("Rokoko")
        elif "Small World Underground" in game_titles:
            game_titles.append("Small World")
        elif any(title in ("Tournament at Avalon", "Tournament at Camelot") for title in game_titles):
            game_titles.insert(0, "Tournament at Camelot/Avalon")
        # elif "Unforgiven" in game_titles:
        #     game_titles.insert(0, "Unforgiven: The Lincoln Assassination Trial")
        elif "Viticulture Essential Edition" in game_titles:
            game_titles.append("Viticulture")

        game_titles.extend(game_data["alternate_names"])
        #game_titles.extend([ game["name"] for game in game_data["reimplements"]])
        #game_titles.extend([ game["name"] for game in game_data["reimplementedby"]])
        #game_titles.extend([ game["name"] for game in game_data["integrates"]])

        return game_titles
