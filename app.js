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

function close_all(event){
  var details = document.querySelectorAll("details");
  details.forEach(function(details_elem){
    if (details_elem.hasAttribute("open")) {
      details_elem.removeAttribute("open");
    }
  });
}

function on_render() {
  var hits = document.querySelectorAll(".ais-Hits-item");
  hits.forEach(function(hit) {
    color = hit.querySelector("img").getAttribute("data-maincolor");
    hit.setAttribute("style", "background: rgba(" + color + ", 0.5)");
  })

  if ("ontouchstart" in window) {
    function close_all_panels(facets) {
      facets.querySelectorAll(".facet .ais-Panel-body").forEach(function(panel_body) {
        panel_body.style.display = "none";
      });
    }
    function toggle_panel(facet) {
      var panel_body = facet.querySelector(".ais-Panel-body");
      var style = window.getComputedStyle(panel_body);
      if (style.display == "none") {
        close_all_panels(facet.parentElement);
        panel_body.style.display = "inline-block";
      }
      else {
        panel_body.style.display = "none";
      }
    }

    var facets = document.querySelectorAll(".facet");
    facets.forEach(function(facet) {
      var is_loaded = facet.getAttribute("loaded");
      if (!is_loaded) {
        facet.addEventListener("click", function(event) {
          toggle_panel(facet);
          event.stopPropagation();
        });
        facet.setAttribute("loaded", true);
      }
    });
  }

  var summaries = document.querySelectorAll("summary");
  summaries.forEach(function(elem){
    function conditional_close(){
      close_all();
      if (!elem.parentElement.hasAttribute("open")) {
        var game_details = elem.parentElement.querySelector(".game-details");
        game_details.focus();
      }
    }
    elem.addEventListener("click", conditional_close);
    elem.addEventListener("keypress", conditional_close);
  });
  document.addEventListener("click", close_all);

  var game_details = document.querySelectorAll(".game-details");
  game_details.forEach(function(elem){
    var close = document.createElement("div");
    close.setAttribute("class", "close");
    close.setAttribute("tabindex", "0");
    close.innerHTML = "×";
    function close_details(event) {
      elem.parentElement.removeAttribute("open");
    }
    close.addEventListener("click", close_details);
    close.addEventListener("keypress", close_details);
    elem.appendChild(close);

    elem.addEventListener("click", function(event){
      event.stopPropagation();
    });
  });
}

function get_widgets(SETTINGS) {
  const WEIGHT_LABELS = [
    "Light",
    "Light Medium",
    "Medium",
    "Medium Heavy",
    "Heavy"
  ];
  const PLAYING_TIME_ORDER = [
    '< 30min',
    '30min - 1h',
    '1-2h',
    '2-3h',
    '3-4h',
    '> 4h'
  ];

  function panel(header) {
    return instantsearch.widgets.panel(
      {
        templates: {
          header: "<h3>" + header + "</h3>"
        }
      }
    )
  }

  return {
    "search": instantsearch.widgets.searchBox({
      container: '#search-box',
      placeholder: 'Search for games'
    }),
    "sort": instantsearch.widgets.sortBy({
      container: '#sort-by',
      items: [
        {label: 'Name', value: SETTINGS.algolia.index_name},
        {label: 'BGG Rank', value: SETTINGS.algolia.index_name + '_rank_ascending'},
        {label: 'Number of ratings', value: SETTINGS.algolia.index_name + '_numrated_descending'},
        {label: 'Number of owners', value: SETTINGS.algolia.index_name + '_numowned_descending'}
      ]
    }),
    "clear": instantsearch.widgets.clearRefinements({
      container: '#clear-all',
      templates: {
        resetLabel: 'Clear all'
      }
    }),
    "refine_categories": panel('Categories')(instantsearch.widgets.refinementList)(
      {
        container: '#facet-categories',
        collapsible: true,
        attribute: 'categories',
        operator: 'and',
        showMore: true,
      }
    ),
    "refine_mechanics": panel('Mechanics')(instantsearch.widgets.refinementList)(
      {
        container: '#facet-mechanics',
        collapsible: true,
        attribute: 'mechanics',
        operator: 'and',
        showMore: true,
      }
    ),
    "refine_players": panel('Number of players')(instantsearch.widgets.hierarchicalMenu)(
      {
        container: '#facet-players',
        collapsible: true,
        attributes: ['players.level1', 'players.level2'],
        operator: 'or',
        sortBy: function(a, b){ return parseInt(a.name) - parseInt(b.name); },
      }
    ),
    "refine_weight": panel('Complexity')(instantsearch.widgets.refinementList)(
      {
        container: '#facet-weight',
        attribute: 'weight',
        operator: 'or',
        sortBy: function(a, b){ return WEIGHT_LABELS.indexOf(a.name) - WEIGHT_LABELS.indexOf(b.name); },
      }
    ),
    "refine_playingtime": panel('Playing time')(instantsearch.widgets.refinementList)(
      {
        container: '#facet-playing-time',
        attribute: 'playing_time',
        operator: 'or',
        sortBy: function(a, b){ return PLAYING_TIME_ORDER.indexOf(a.name) - PLAYING_TIME_ORDER.indexOf(b.name); },
      }
    ),
    "refine_min_age": panel('Min age')(instantsearch.widgets.numericMenu)(
      {
        container: '#facet-min-age',
        attribute: 'min_age',
        items: [
          { label: 'Any age' },
          { label: '< 5 years', end: 4 },
          { label: '< 7 years', end: 6 },
          { label: '< 9 years', end: 8 },
          { label: '< 11 years', end: 10 },
          { label: '< 13 years', end: 12 },
          { label: '< 15 years', end: 14 },
          { label: '15+', start: 15 },
        ]
      }
    ),
    "refine_previousplayers": panel('Previous players')(instantsearch.widgets.refinementList)(
      {
        container: '#facet-previous-players',
        attribute: 'previous_players',
        operator: 'and',
        searchable: true,
        showMore: true,
      }
    ),
    "refine_numplays": panel('Total plays')(instantsearch.widgets.numericMenu)(
      {
        container: '#facet-numplays',
        attribute: 'numplays',
        items: [
          { label: 'Any number of plays' },
          { label: 'No plays', end: 0 },
          { label: '1 play', start: 1, end: 1 },
          { label: '2-9 plays', start: 2, end: 9 },
          { label: '10-19 plays', start: 10, end: 19 },
          { label: '20-29 plays', start: 20, end: 29 },
          { label: '30+ plays', start: 30 },
        ]
      }
    ),
    "hits": instantsearch.widgets.hits({
      container: '#hits',
      transformItems: function(items) {
        hide_facet_when_no_data('#facet-previous-players', items, 'previous_players');
        hide_facet_when_no_data('#facet-numplays', items, 'numplays');

        return items.map(function(game){
          players = [];
          game.players.forEach(function(num_players){
            match = num_players.level2.match(/^\d+\ >\ ([\w\ ]+)\ (?:with|allows)\ (\d+\+?)$/);
            type = match[1].toLowerCase();
            num = match[2];

            type_callback = {
              'best': function(num) { return '<strong>' + num + '</strong><span title="Best with">★</span>'; },
              'recommended': function(num) { return num; },
              'expansion': function(num) { return num + '<span title="With expansion">⊕</span>'; },
            };
            players.push(type_callback[type](num));

            if (num.indexOf("+") > -1) {
              return;
            }
          });
          game.players_str = players.join(", ");
          game.categories_str = game.categories.join(", ");
          game.mechanics_str = game.mechanics.join(", ");
          game.tags_str = game.tags.join(", ");
          game.description = game.description.trim();
          game.has_expansions = (game.expansions.length > 0);
          game.has_more_expansions = (game.has_more_expansions);

          if (game.has_more_expansions) {
            game_prefix = game.name.indexOf(":")? game.name.substring(0, game.name.indexOf(":")) : game.name;
            expansions_url_data = {
              searchstr: game_prefix,
              searchfield: "title",
              objecttype: "thing",
              subtype: "boardgameexpansion",
            };
            has_more_expansions_url = (
              "https://boardgamegeek.com/collection/user/" +
              encodeURIComponent(SETTINGS.boardgamegeek.user_name) +
              "?" +
              (Object.keys(expansions_url_data).map(function(key){
                return key + "=" + expansions_url_data[key];
              })).join("&")  // Don't encode game_prefix, because bgg redirects indefinately then...
            );
            game.has_more_expansions_url = has_more_expansions_url;
          }

          return game;
        });
      },
      templates: {
        empty: 'No results',
        item: document.getElementById('hits-template').innerHTML
      }
    }),
    "stats": instantsearch.widgets.stats({
      container: '#stats'
    }),
    "pagination": instantsearch.widgets.pagination({
      container: '#pagination',
      maxPages: 20,
      showFirst: false,
      showLast: false
    })
  }
}

function hide_facet_when_no_data(facet_id, games, attr) {
  var has_data_in_attr = false;
  for (game of games) {
    if (game[attr] != [] && game[attr] != "" && game[attr] != 0 && game[attr] != undefined) {
      has_data_in_attr = true;
      break;
    }
  }
  var widget = document.querySelector(facet_id);
  var widget_is_selected = document.querySelector(facet_id + " *[class$='-item--selected']");
  if (!has_data_in_attr && !widget_is_selected) {
    widget.style.display = 'none';
  }
  else {
    widget.style.display = 'block';
  }
}

function init(SETTINGS) {

  var configIndexName = ''
  switch (SETTINGS.algolia.sort_by) {
    case undefined:
    case 'asc(name)':
      configIndexName = SETTINGS.algolia.index_name
      break
    case 'asc(rank)':
    case 'desc(rating)':
      configIndexName = SETTINGS.algolia.index_name + '_rank_ascending'
      break
    case 'desc(numrated)':
      configIndexName = SETTINGS.algolia.index_name + '_numrated_descending'
      break
    case 'desc(numowned)':
      configIndexName = SETTINGS.algolia.index_name + '_numowned_descending'
      break
    default:
      console.error("The provided config value for algolia.sort_by was invalid: " + SETTINGS.algolia.sort_by)
      break;
  }

  const search = instantsearch({
    indexName: configIndexName,
    searchClient: algoliasearch(
      SETTINGS.algolia.app_id,
      SETTINGS.algolia.api_key_search_only
    ),
    routing: true
  });

  search.on('render', on_render);

  var widgets = get_widgets(SETTINGS);
  search.addWidgets([
    widgets["search"],
    widgets["sort"],
    widgets["clear"],
    widgets["refine_categories"],
    widgets["refine_mechanics"],
    widgets["refine_players"],
    widgets["refine_weight"],
    widgets["refine_playingtime"],
    widgets["refine_min_age"],
    widgets["hits"],
    widgets["stats"],
    widgets["pagination"],
    widgets["refine_previousplayers"],
    widgets["refine_numplays"]
  ]);

  search.start();

  function set_bgg_name() {
    var title = SETTINGS.project.title;
    if (!title) {
      title = "All " + SETTINGS.boardgamegeek.user_name + "'s boardgames";
    }

    var title_tag = document.getElementsByTagName("title")[0];
    title_tag.innerHTML = title;
  }
  set_bgg_name();
}

loadJSON("config.json", init);
