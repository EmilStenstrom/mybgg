function loadJSON(path, callback) {
  var req = new XMLHttpRequest();
  req.overrideMimeType("application/json");
  req.open('GET', path, true);
  req.onreadystatechange = function () {
    if (req.readyState == 4 && req.status == "200") {
      callback(JSON.parse(req.responseText));
    }
  };
  req.send(null);
}

function init(SETTINGS) {
  const search = instantsearch({
    appId: SETTINGS.algolia.app_id,
    apiKey: SETTINGS.algolia.api_key_search_only,
    indexName: SETTINGS.algolia.index_name,
    routing: true
  });

  search.addWidget(
    instantsearch.widgets.searchBox({
      container: '#search-box',
      placeholder: 'Search for games'
    })
  );

  search.addWidget(
    instantsearch.widgets.clearAll({
      container: '#clear-all',
      templates: {
        link: 'Clear all'
      },
      clearsQuery: true,
    })
  );

  search.addWidget(
    instantsearch.widgets.refinementList({
      container: '#facet-categories',
      collapsible: true,
      attributeName: 'categories',
      operator: 'and',
      showMore: true,
      templates: {
        header: 'Categories'
      }
    })
  );

  search.addWidget(
    instantsearch.widgets.refinementList({
      container: '#facet-mechanics',
      collapsible: true,
      attributeName: 'mechanics',
      operator: 'and',
      showMore: true,
      templates: {
        header: 'Mechanics'
      }
    })
  );

  search.addWidget(
    instantsearch.widgets.hierarchicalMenu({
      container: '#facet-players',
      collapsible: true,
      attributes: ['players.level1', 'players.level2'],
      operator: 'or',
      showMore: true,
      sortBy: function(a, b){ return parseInt(a.name) > parseInt(b.name) },
      templates: {
        header: 'Number of players'
      }
    })
  );

  WEIGHT_LABELS = [
    "Light",
    "Light Medium",
    "Medium",
    "Medium Heavy",
    "Heavy"
  ]
  search.addWidget(
    instantsearch.widgets.refinementList({
      container: '#facet-weight',
      collapsible: true,
      attributeName: 'weight',
      operator: 'or',
      sortBy: function(a, b){ return WEIGHT_LABELS.indexOf(a.name) > WEIGHT_LABELS.indexOf(b.name) },
      templates: {
        header: 'Complexity'
      }
    })
  );

  PLAYING_TIME_ORDER = [
    '< 30min',
    '30min - 1h',
    '1-2h',
    '2-3h',
    '3-4h',
    '> 4h'
  ]
  search.addWidget(
    instantsearch.widgets.refinementList({
      container: '#facet-playing-time',
      collapsible: true,
      attributeName: 'playing_time',
      operator: 'or',
      sortBy: function(a, b){ return PLAYING_TIME_ORDER.indexOf(a.name) > PLAYING_TIME_ORDER.indexOf(b.name) },
      templates: {
        header: 'Playing time'
      }
    })
  );

  search.addWidget(
    instantsearch.widgets.hits({
      container: '#hits',
      collapsible: true,
      transformData: {
        item: function(game){
          num_players_list = [];
          for (let num_players of game.players) {
            num_players = num_players.level2.replace(/^\d+ > [\w ]+ (\d+\+?)$/, '$1')
            num_players_list.push(num_players);

            if (num_players.indexOf("+") > -1) {
              break;
            }
          }
          game.players = num_players_list.join(", ");

          game.categories = game.categories.join(", ");
          game.mechanics = game.mechanics.join(", ");
          game.description = game.description.trim();
          return game;
        },
      },
      templates: {
        empty: 'No results',
        item: document.getElementById('hits-template').innerHTML
      },
    })
  );

  search.addWidget(
    instantsearch.widgets.stats({
      container: '#stats'
    })
  );

  search.addWidget(
    instantsearch.widgets.pagination({
      container: '#pagination',
      maxPages: 20,
      showFirstLast: false
    })
  );

  search.start();

  function set_bgg_name() {
    name = SETTINGS.boardgamegeek.user_name + "'s";
    title = document.getElementsByTagName("title")[0];
    title.innerHTML = title.innerHTML.replace("my", name);
    h1 = document.getElementsByTagName("h1")[0];
    h1.innerHTML = h1.innerHTML.replace("my", name);
  }
  set_bgg_name();
}

loadJSON("config.json", init);
