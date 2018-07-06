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

  function closeAll(event){
    var details = document.querySelectorAll("details");
    details.forEach(function(details_elem){
      if (details_elem.hasAttribute("open")) {
        details_elem.removeAttribute("open");
      }
    });
  }

  search.on('render', function() {
    var summaries = document.querySelectorAll("summary");
    summaries.forEach(function(elem){
      elem.addEventListener("click", function(){
        closeAll();
        if (!elem.parentElement.hasAttribute("open")) {
          var game_details = elem.parentElement.querySelector(".game-details");
          game_details.focus();
        }
      });
    });
    document.addEventListener("click", closeAll);

    var game_details = document.querySelectorAll(".game-details");
    game_details.forEach(function(elem){
      var close = document.createElement("div");
      close.setAttribute("class", "close");
      close.setAttribute("tabindex", "-1");
      close.innerHTML = "×";
      close.addEventListener("click", function(){
        elem.parentElement.removeAttribute("open");
      });
      elem.appendChild(close);

      elem.addEventListener("click", function(event){
        event.stopPropagation();
      });
    });
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
      clearsQuery: true
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
      sortBy: function(a, b){ return parseInt(a.name) - parseInt(b.name); },
      templates: {
        header: 'Number of players'
      }
    })
  );

  var WEIGHT_LABELS = [
    "Light",
    "Light Medium",
    "Medium",
    "Medium Heavy",
    "Heavy"
  ];
  search.addWidget(
    instantsearch.widgets.refinementList({
      container: '#facet-weight',
      collapsible: true,
      attributeName: 'weight',
      operator: 'or',
      sortBy: function(a, b){ return WEIGHT_LABELS.indexOf(a.name) - WEIGHT_LABELS.indexOf(b.name); },
      templates: {
        header: 'Complexity'
      }
    })
  );

  var PLAYING_TIME_ORDER = [
    '< 30min',
    '30min - 1h',
    '1-2h',
    '2-3h',
    '3-4h',
    '> 4h'
  ];
  search.addWidget(
    instantsearch.widgets.refinementList({
      container: '#facet-playing-time',
      collapsible: true,
      attributeName: 'playing_time',
      operator: 'or',
      sortBy: function(a, b){ return PLAYING_TIME_ORDER.indexOf(a.name) - PLAYING_TIME_ORDER.indexOf(b.name); },
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
          players = [];
          game.players.forEach(function(num_players){
            match = num_players.level2.match(/^\d+\ >\ ([\w\ ]+)\ (?:with|allows)\ (\d+\+?)$/);
            type = match[1].toLowerCase();
            num = match[2];

            type_to_string = {
              'best': ' <span class="soft">(best)</span>',
              'recommended': '',
              'expansion': ' <span class="soft">(with exp)</span>'
            };
            players.push(num + type_to_string[type]);

            if (num.indexOf("+") > -1) {
              return;
            }
          });
          game.players = players.join(", ");

          game.categories = game.categories.join(", ");
          game.mechanics = game.mechanics.join(", ");
          game.tags = game.tags.join(", ");
          game.description = game.description.trim();

          game.has_expansions = (game.expansions.length > 0);
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
    var title = SETTINGS.project.title;
    if (!title) {
      title = "All " + SETTINGS.boardgamegeek.user_name + "'s boardgames";
    }

    var title_tag = document.getElementsByTagName("title")[0];
    var h1_tag = document.getElementsByTagName("h1")[0];
    title_tag.innerHTML = h1_tag.innerHTML = title;
  }
  set_bgg_name();
}

loadJSON("config.json", init);
