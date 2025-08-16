// Configuration loaded from HTML data attributes
const CONFIG = (() => {
  return {
    GAMES_PER_PAGE: 48,
    MAX_DESCRIPTION_LENGTH: 400,
    GAUGE_RADIUS: 10,
    COMPLEXITY_THRESHOLDS: [1.5, 2.5, 3.5, 4.5],
    COMPLEXITY_NAMES: ['Light', 'Light Medium', 'Medium', 'Medium Heavy', 'Heavy'],
    PLAYING_TIMES: ['< 30min', '30min - 1h', '1-2h', '2-3h', '3-4h', '> 4h'],
    SORT_OPTIONS: [
      { value: 'name', text: 'Name (A-Z)' },
      { value: 'rank', text: 'BGG Rank' },
      { value: 'rating', text: 'Rating' },
      { value: 'numowned', text: 'Most Owned' },
      { value: 'numrated', text: 'Most Rated' }
    ]
  };
})();

// Legacy constants for compatibility
const GAMES_PER_PAGE = CONFIG.GAMES_PER_PAGE;
const MAX_DESCRIPTION_LENGTH = CONFIG.MAX_DESCRIPTION_LENGTH;
const GAUGE_RADIUS = CONFIG.GAUGE_RADIUS;

// Global state
let db = null;
let allGames = [];
let filteredGames = [];
let currentPage = 1;

// Utility functions
function showError(message) {
  const container = document.getElementById('hits');
  const template = document.getElementById('error-template');
  const clone = template.content.cloneNode(true);
  clone.querySelector('.error-message').textContent = message;
  container.innerHTML = '';
  container.appendChild(clone);
}

function createElement(tag, attributes = {}, textContent = '') {
  const element = document.createElement(tag);
  Object.entries(attributes).forEach(([key, value]) => {
    if (key === 'className') {
      element.className = value;
    } else {
      element.setAttribute(key, value);
    }
  });
  if (textContent) element.textContent = textContent;
  return element;
}

function createTagChipsContainer(chips) {
  if (!chips || chips.length === 0) return '';
  const template = document.getElementById('tag-chips-container-template');
  const clone = template.content.cloneNode(true);
  const container = clone.querySelector('.tag-chips');
  container.innerHTML = chips;
  return container.outerHTML;
}

// Core application functions
function loadINI(path, callback) {
  fetch(path)
    .then(response => response.text())
    .then(text => {
      const config = {};
      const lines = text.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Parse key = value pairs
        const equalIndex = trimmed.indexOf('=');
        if (equalIndex > 0) {
          const key = trimmed.substring(0, equalIndex).trim();
          let value = trimmed.substring(equalIndex + 1).trim();

          // Remove quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }

          config[key] = value;
        }
      }

      // Transform flat config into nested structure expected by the app
      const settings = {
        title: config.title || "GameCache",
        bgg: {
          username: config.bgg_username
        },
        github: {
          repo: config.github_repo,
        }
      };

      callback(settings);
    })
    .catch(error => console.error('Error loading config:', error));
}

async function initializeDatabase(settings) {
  try {
    const SQL = await initSqlJs({
      locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/${file}`
    });

    const isDev = /^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname);
    // Use existing CORS proxy host
    const dbUrl = isDev ? './gamecache.sqlite.gz' :
      `https://cors-proxy.mybgg.workers.dev/${settings.github.repo}`;

    console.log(`Loading database from: ${dbUrl}`);

    let response = await fetch(dbUrl);
    if (!response.ok && isDev) {
      // In development, fall back to the legacy local artifact name
      const legacyDbUrl = './mybgg.sqlite.gz';
      console.warn(`Primary database URL failed (${dbUrl}), trying legacy local file: ${legacyDbUrl}`);
      response = await fetch(legacyDbUrl);
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch database: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const dbData = fflate.gunzipSync(bytes);

    db = new SQL.Database(dbData);
    console.log('Database loaded successfully');

    loadAllGames();
    initializeUI();

  } catch (error) {
    console.error('Error initializing database:', error);

    let userMessage = 'Failed to load your board game database. ';

    if (error.message.includes('404') || error.message.includes('Failed to fetch')) {
      userMessage += 'This usually means:\n\n' +
        '• You haven\'t run the setup script yet (python scripts/download_and_index.py --cache_bgg)\n' +
        '• The database upload failed\n' +
        '• GitHub Pages isn\'t enabled or is still setting up (can take 10-15 minutes)\n\n' +
        'Try running the script again, and make sure GitHub Pages is enabled in your repository settings.';
    } else if (error.message.includes('gzip')) {
      userMessage += 'The database file appears to be corrupted. Try running the setup script again.';
    } else {
      userMessage += `Technical error: ${error.message}`;
    }

    showError(userMessage);
  }
}

function parsePlayerCount(countStr) {
  if (!countStr) return { min: 0, max: 0, open: false };
  let s = String(countStr).trim();

  if (s.endsWith('+')) {
    const numPart = s.slice(0, -1);
    const min = parseInt(numPart, 10);
    if (String(min) === numPart) {
      return { min: min, max: Infinity, open: true };
    }
  }

  const rangeMatch = s.match(/^(\d+)[–-](\d+)$/);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1], 10);
    const max = parseInt(rangeMatch[2], 10);
    return { min: min, max: max, open: false };
  }

  const num = parseInt(s, 10);
  if (!isNaN(num)) {
    if (String(num) === s) {
      return { min: num, max: num, open: false };
    }
  }

  return { min: 0, max: 0, open: false };
}

function loadAllGames() {
  const stmt = db.prepare(`
    SELECT id, name, description, categories, mechanics, players, weight,
           playing_time, min_age, rank, usersrated, numowned, rating,
           numplays, image, tags, previous_players, expansions, color
    FROM games
    ORDER BY name
  `);

  allGames = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();

    row.weight = parseFloat(row.weight);

    try {
      row.categories = JSON.parse(row.categories || '[]');
      row.mechanics = JSON.parse(row.mechanics || '[]');
      row.players = JSON.parse(row.players || '[]');
      row.tags = JSON.parse(row.tags || '[]');
      row.previous_players = JSON.parse(row.previous_players || '[]');
      row.expansions = JSON.parse(row.expansions || '[]');
    } catch (e) {
      console.warn('Error parsing JSON for game:', row.id, e);
    }

    allGames.push(row);
  }
  stmt.free();

  filteredGames = [...allGames];
  console.log(`Loaded ${allGames.length} games.`);
}

function initializeUI() {
  setupSearchBox();
  setupFilters();
  setupSorting();

  const initialState = getFiltersFromURL();
  updateUIFromState(initialState);
  applyFiltersAndSort(initialState);
  updateResults();
  updateStats();

  window.addEventListener('popstate', (event) => {
    const state = event.state || getFiltersFromURL();
    updateUIFromState(state);
    applyFiltersAndSort(state);
    updateResults();
    updateStats();
  });

  window.addEventListener('resize', function () {
    const openDetails = document.querySelector('details[open] .game-details');
    if (openDetails) {
      const trigger = openDetails.closest('details').querySelector('summary');
      if (trigger) {
        positionPopupInViewport(openDetails, trigger);
      }
    }
  });
}

function handleMoreButtonClick(button) {
  const teaserText = button.closest('.teaser-text');
  if (!teaserText) return;

  const fullText = teaserText.getAttribute('data-full-text');

  if (button.textContent === 'more') {
    const template = document.getElementById('less-button-template');
    const clone = template.content.cloneNode(true);
    teaserText.innerHTML = escapeHtml(fullText) + ' ' + clone.querySelector('button').outerHTML;
  } else {
    teaserText.innerHTML = getTeaserText(fullText, true);
  }
}

function setupSearchBox() {
  const searchBox = document.getElementById('search-box');
  const input = createElement('input', {
    type: 'text',
    id: 'search-input',
    placeholder: 'Search games...'
  });
  searchBox.appendChild(input);
  input.addEventListener('input', debounce(onFilterChange, 300));
}

function setupSorting() {
  const sortContainer = document.getElementById('sort-by');
  const select = createElement('select', {
    id: 'sort-select',
    name: 'sort-by'
  });

  const options = [
    { value: 'name', text: 'Name (A-Z)' },
    { value: 'rank', text: 'BGG Rank' },
    { value: 'rating', text: 'Rating' },
    { value: 'numowned', text: 'Most Owned' },
    { value: 'numrated', text: 'Most Rated' }
  ];

  options.forEach(({ value, text }) => {
    const option = createElement('option', { value }, text);
    select.appendChild(option);
  });

  sortContainer.appendChild(select);
  select.addEventListener('change', onFilterChange);
}

function setupFilters() {
  setupCategoriesFilter();
  setupMechanicsFilter();
  setupPlayersFilter();
  setupWeightFilter();
  setupPlayingTimeFilter();
  setupMinAgeFilter();
  setupPreviousPlayersFilter();
  setupNumPlaysFilter();
  setupClearAllButton();

  // Ensure player sub-options are hidden initially
  hideAllPlayerSubOptions();

  // Ensure "Any" is checked by default for players filter
  ensurePlayerAnyIsSelected();
}

function hideAllPlayerSubOptions() {
  const allPlayerLabels = document.querySelectorAll('#facet-players label.filter-item[data-level]');
  allPlayerLabels.forEach(label => {
    const level = parseInt(label.dataset.level, 10);
    if (level > 0) {
      label.style.display = 'none';
    }
  });
}

function ensurePlayerAnyIsSelected() {
  const playersContainer = document.getElementById('facet-players');
  if (!playersContainer) return;

  const anyInput = playersContainer.querySelector('input[value="any"]');
  if (anyInput && !anyInput.checked) {
    anyInput.checked = true;
  }

  // Make sure all sub-options are hidden when "Any" is selected
  hideAllPlayerSubOptions();
}

function setupCategoriesFilter() {
  const categoryCounts = {};
  allGames.forEach(game => {
    game.categories.forEach(cat => {
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });
  });

  const sortedCategories = Object.keys(categoryCounts).sort();
  const items = sortedCategories.map(cat => ({
    label: cat,
    value: cat,
    count: categoryCounts[cat]
  }));

  // Only create the filter if there are categories
  if (items.length > 0) {
    createRefinementFilter('facet-categories', 'Categories', items, 'categories');
  } else {
    // Hide the filter container if no items
    const container = document.getElementById('facet-categories');
    if (container) {
      container.style.display = 'none';
    }
  }
}

function setupMechanicsFilter() {
  const mechanicCounts = {};
  allGames.forEach(game => {
    game.mechanics.forEach(mech => {
      mechanicCounts[mech] = (mechanicCounts[mech] || 0) + 1;
    });
  });

  const sortedMechanics = Object.keys(mechanicCounts).sort();
  const items = sortedMechanics.map(mech => ({
    label: mech,
    value: mech,
    count: mechanicCounts[mech]
  }));

  // Only create the filter if there are mechanics
  if (items.length > 0) {
    createRefinementFilter('facet-mechanics', 'Mechanics', items, 'mechanics');
  } else {
    // Hide the filter container if no items
    const container = document.getElementById('facet-mechanics');
    if (container) {
      container.style.display = 'none';
    }
  }
}

function setupPlayersFilter() {
  const playerCounts = new Set();
  allGames.forEach(game => {
    game.players.forEach(([count, type]) => {
      if (type === 'not recommended') return;

      const { min, max } = parsePlayerCount(count);
      if (min > 0) {
        const upper = isFinite(max) ? max : min;
        for (let i = min; i <= upper; i++) {
          playerCounts.add(i);
        }
      }
    });
  });

  const sortedPlayers = Array.from(playerCounts).sort((a, b) => a - b);

  const playerItems = [{
    label: 'Any',
    value: 'any',
    default: true,
    count: allGames.length,
    level: 0
  }];

  // Add main player count options and their sub-options
  sortedPlayers.forEach(p => {
    const mainCount = allGames.filter(game => {
      return game.players.some(([playerCount, type]) => {
        if (type === 'not recommended') return false;
        const { min, max } = parsePlayerCount(playerCount);
        return p >= min && p <= max;
      });
    }).length;

    // Main player count option
    playerItems.push({
      label: `${p} player${p === 1 ? '' : 's'}`,
      value: p.toString(),
      count: mainCount,
      level: 0
    });

    // Sub-options for different recommendation types
    const recommendationTypes = ['best', 'recommended', 'expansion'];
    recommendationTypes.forEach(recType => {
      const typeCount = allGames.filter(game => {
        return game.players.some(([playerCount, type]) => {
          if (type !== recType) return false;
          const { min, max } = parsePlayerCount(playerCount);
          return p >= min && p <= max;
        });
      }).length;

      if (typeCount > 0) {
        const typeLabel = recType === 'best' ? 'Best with' :
                         recType === 'recommended' ? 'Recommended with' :
                         'Expansions allow';

        playerItems.push({
          label: `${typeLabel} ${p} player${p === 1 ? '' : 's'}`,
          value: `${p}-${recType}`,
          count: typeCount,
          level: 1,
          parentValue: p.toString()
        });
      }
    });
  });

  createRefinementFilter('facet-players', 'Number of players', playerItems, 'players', true);
}

function setupWeightFilter() {
  const weightCounts = {};
  allGames.forEach(game => {
    if (game.weight) {
      const name = getComplexityName(game.weight);
      if (name) {
        weightCounts[name] = (weightCounts[name] || 0) + 1;
      }
    }
  });

  const items = CONFIG.COMPLEXITY_NAMES.map(name => ({
    label: name,
    value: name,
    count: weightCounts[name] || 0
  }));

  // Check if all items have zero count (effectively empty filter)
  const hasAnyItems = items.some(item => item.count > 0);
  if (hasAnyItems) {
    createRefinementFilter('facet-weight', 'Complexity', items, 'weight');
  } else {
    // Hide the filter container if no items have counts
    const container = document.getElementById('facet-weight');
    if (container) {
      container.style.display = 'none';
    }
  }
}

function setupPlayingTimeFilter() {
  const timeCounts = {};
  allGames.forEach(game => {
    if (game.playing_time) {
      timeCounts[game.playing_time] = (timeCounts[game.playing_time] || 0) + 1;
    }
  });

  const items = CONFIG.PLAYING_TIMES.map(time => ({
    label: time,
    value: time,
    count: timeCounts[time] || 0
  }));

  // Check if all items have zero count (effectively empty filter)
  const hasAnyItems = items.some(item => item.count > 0);
  if (hasAnyItems) {
    createRefinementFilter('facet-playing-time', 'Playing time', items, 'playing_time');
  } else {
    // Hide the filter container if no items have counts
    const container = document.getElementById('facet-playing-time');
    if (container) {
      container.style.display = 'none';
    }
  }
}

function setupMinAgeFilter() {
  const ageRanges = [{
    label: 'Any age',
    min: 0,
    max: 100,
    default: true
  }, {
    label: '< 5 years',
    min: 0,
    max: 4
  }, {
    label: '< 7 years',
    min: 0,
    max: 6
  }, {
    label: '< 9 years',
    min: 0,
    max: 8
  }, {
    label: '< 11 years',
    min: 0,
    max: 10
  }, {
    label: '< 13 years',
    min: 0,
    max: 12
  }, {
    label: '< 15 years',
    min: 0,
    max: 14
  }, {
    label: '15+',
    min: 15,
    max: 100
  }];

  const items = ageRanges.map(range => {
    const count = allGames.filter(game => {
      if (range.default) return true;
      return game.min_age >= range.min && game.min_age <= range.max;
    }).length;
    return {
      ...range,
      count: range.default ? allGames.length : count
    };
  });

  createRefinementFilter('facet-min-age', 'Min age', items, 'min_age', true);
}

function setupPreviousPlayersFilter() {
  const playerCounts = {};
  allGames.forEach(game => {
    game.previous_players.forEach(player => {
      playerCounts[player] = (playerCounts[player] || 0) + 1;
    });
  });

  const sortedPlayers = Object.keys(playerCounts).sort();
  const items = sortedPlayers.map(player => ({
    label: player,
    value: player,
    count: playerCounts[player]
  }));

  // Only create the filter if there are previous players
  if (items.length > 0) {
    createRefinementFilter('facet-previous-players', 'Previous players', items, 'previous_players');
  } else {
    // Hide the filter container if no items
    const container = document.getElementById('facet-previous-players');
    if (container) {
      container.style.display = 'none';
    }
  }
}

function setupNumPlaysFilter() {
  const playRanges = [{
    label: 'Any',
    min: 0,
    max: 9999,
    default: true
  }, {
    label: 'Unplayed (0)',
    min: 0,
    max: 0
  }, {
    label: '1-5 plays',
    min: 1,
    max: 5
  }, {
    label: '6-10 plays',
    min: 6,
    max: 10
  }, {
    label: '11+ plays',
    min: 11,
    max: 9999
  }];

  const items = playRanges.map(range => {
    const count = allGames.filter(game => {
      if (range.default) return true;
      return game.numplays >= range.min && game.numplays <= range.max;
    }).length;
    return {
      ...range,
      count: range.default ? allGames.length : count
    };
  });

  createRefinementFilter('facet-numplays', 'Number of plays', items, 'numplays', true);
}

function createRefinementFilter(facetId, title, items, attributeName, isRadio = false) {
  const container = document.getElementById(facetId);
  if (!container) return;

  // Create filter dropdown structure manually
  const template = document.getElementById('filter-item-template');
  const filterItemsHtml = items.map(item => {
    const value = (typeof item === 'object' && item.value !== undefined) ? item.value : (typeof item === 'object' && item.min !== undefined ? `${item.min}-${item.max}` : item);
    const label = (typeof item === 'object' && item.label !== undefined) ? item.label : item;
    const count = (typeof item === 'object' && item.count !== undefined) ? item.count : null;
    const checked = (isRadio && typeof item === 'object' && item.default) ? 'checked' : '';
    const inputType = isRadio ? 'radio' : 'checkbox';
    const level = (typeof item === 'object' && item.level !== undefined) ? item.level : 0;
    const parentValue = (typeof item === 'object' && item.parentValue !== undefined) ? item.parentValue : '';

    const clone = template.content.cloneNode(true);
    const labelEl = clone.querySelector('.filter-item');
    const input = clone.querySelector('input');
    const span = clone.querySelector('.filter-label');
    const countEl = clone.querySelector('.facet-count');

    input.type = inputType;
    input.name = attributeName;
    input.value = value;
    if (checked) input.checked = true;
    span.textContent = label;

    // Add level and parent attributes for hierarchical structure
    if (level > 0) {
      labelEl.setAttribute('data-level', level);
      labelEl.setAttribute('data-parent-value', parentValue);
      labelEl.style.display = 'none'; // Initially hide sub-options
      labelEl.style.paddingLeft = '20px'; // Indent sub-options
    }

    if (count !== null) {
      countEl.textContent = count;
      countEl.style.display = 'inline';
    } else {
      countEl.style.display = 'none';
    }

    return labelEl.outerHTML;
  }).join('');

  const dropdownTemplate = document.getElementById('filter-dropdown-template');
  const clone = dropdownTemplate.content.cloneNode(true);
  const details = clone.querySelector('details');
  details.id = facetId;
  clone.querySelector('.filter-title').textContent = title;
  clone.querySelector('.filter-dropdown-content').innerHTML = filterItemsHtml;
  container.replaceWith(clone);

  const newContainer = document.getElementById(facetId);
  if (newContainer) {
    if (newContainer.tagName === 'DETAILS') {
      newContainer.open = false;
    }
    newContainer.addEventListener('change', (event) => {
      if (event.target.tagName === 'INPUT') {
        if (attributeName === 'players') {
          const selectedValue = event.target.value;
          const allPlayerLabels = newContainer.querySelectorAll('label.filter-item[data-level]');

          // First, hide all sub-options
          allPlayerLabels.forEach(label => {
            const level = parseInt(label.dataset.level, 10);
            if (level > 0) {
              label.style.display = 'none';
            }
          });

          // Show sub-options based on selection
          if (selectedValue !== 'any') {
            let parentValue;
            if (selectedValue.includes('-')) {
              // A sub-option is selected - get its parent value
              parentValue = selectedValue.split('-')[0];
            } else {
              // A main player count is selected
              parentValue = selectedValue;
            }

            // Show all sub-options for this parent value
            allPlayerLabels.forEach(label => {
              const level = parseInt(label.dataset.level, 10);
              if (level > 0 && label.dataset.parentValue === parentValue) {
                label.style.display = 'flex';
              }
            });
          }
        }
        onFilterChange();
      }
    });

    const scrollHandler = () => {
      if (!newContainer.open) {
        window.removeEventListener('scroll', scrollHandler);
        window.removeEventListener('resize', scrollHandler);
        return;
      }
      const dropdownContent = newContainer.querySelector('.filter-dropdown-content');
      const summaryElement = newContainer.querySelector('summary');
      if (!dropdownContent || !summaryElement) return;

      const rect = summaryElement.getBoundingClientRect();
      const availableHeight = window.innerHeight - rect.bottom - 10;
      dropdownContent.style.maxHeight = `${Math.min(availableHeight, 400)}px`;
    };

    newContainer.addEventListener('toggle', function (event) {
      const dropdownContent = this.querySelector('.filter-dropdown-content');
      const summaryElement = this.querySelector('summary');
      if (!dropdownContent || !summaryElement) return;

      if (this.open) {
        this.style.position = 'relative';
        dropdownContent.style.position = 'absolute';
        dropdownContent.style.top = `${summaryElement.offsetHeight}px`;
        dropdownContent.style.left = '0';
        dropdownContent.style.zIndex = '1050';
        dropdownContent.style.minWidth = `${summaryElement.offsetWidth}px`;
        dropdownContent.style.display = 'flex';
        dropdownContent.style.overflowY = 'auto';

        scrollHandler();
        window.addEventListener('scroll', scrollHandler, {
          passive: true
        });
        window.addEventListener('resize', scrollHandler, {
          passive: true
        });

      } else {
        this.style.position = '';
        dropdownContent.style.position = '';
        dropdownContent.style.top = '';
        dropdownContent.style.left = '';
        dropdownContent.style.zIndex = '';
        dropdownContent.style.minWidth = '';
        dropdownContent.style.display = '';
        dropdownContent.style.maxHeight = '';
        dropdownContent.style.overflowY = '';

        window.removeEventListener('scroll', scrollHandler);
        window.removeEventListener('resize', scrollHandler);
      }
    });

    const summary = newContainer.querySelector('summary');
    if (summary) {
      summary.addEventListener('click', function (e) {
        const details = this.parentElement;
        if (details.open) {
          e.preventDefault();
          details.open = false;
        }
      });
    }
  }
}

function updateClearButtonVisibility(filters) {
  const clearContainer = document.getElementById('clear-all');
  if (!clearContainer) return;

  const {
    query,
    selectedCategories,
    selectedMechanics,
    selectedPlayerFilter,
    selectedWeight,
    selectedPlayingTime,
    selectedPreviousPlayers,
    selectedMinAge,
    selectedNumPlays
  } = filters;

  const isAnyFilterActive =
    (query && query !== '') ||
    (selectedCategories && selectedCategories.length > 0) ||
    (selectedMechanics && selectedMechanics.length > 0) ||
    (selectedPlayerFilter && selectedPlayerFilter !== 'any') ||
    (selectedWeight && selectedWeight.length > 0) ||
    (selectedPlayingTime && selectedPlayingTime.length > 0) ||
    (selectedPreviousPlayers && selectedPreviousPlayers.length > 0) ||
    selectedMinAge !== null ||
    selectedNumPlays !== null;

  clearContainer.style.display = isAnyFilterActive ? 'flex' : 'none';
}

function updateFilterActiveStates(filters) {
  // Update categories filter
  const categoriesFilter = document.getElementById('facet-categories');
  if (categoriesFilter) {
    if (filters.selectedCategories && filters.selectedCategories.length > 0) {
      categoriesFilter.classList.add('filter-active');
    } else {
      categoriesFilter.classList.remove('filter-active');
    }
  }

  // Update mechanics filter
  const mechanicsFilter = document.getElementById('facet-mechanics');
  if (mechanicsFilter) {
    if (filters.selectedMechanics && filters.selectedMechanics.length > 0) {
      mechanicsFilter.classList.add('filter-active');
    } else {
      mechanicsFilter.classList.remove('filter-active');
    }
  }

  // Update players filter
  const playersFilter = document.getElementById('facet-players');
  if (playersFilter) {
    if (filters.selectedPlayerFilter && filters.selectedPlayerFilter !== 'any') {
      playersFilter.classList.add('filter-active');
    } else {
      playersFilter.classList.remove('filter-active');
    }
  }

  // Update weight filter
  const weightFilter = document.getElementById('facet-weight');
  if (weightFilter) {
    if (filters.selectedWeight && filters.selectedWeight.length > 0) {
      weightFilter.classList.add('filter-active');
    } else {
      weightFilter.classList.remove('filter-active');
    }
  }

  // Update playing time filter
  const playingTimeFilter = document.getElementById('facet-playing-time');
  if (playingTimeFilter) {
    if (filters.selectedPlayingTime && filters.selectedPlayingTime.length > 0) {
      playingTimeFilter.classList.add('filter-active');
    } else {
      playingTimeFilter.classList.remove('filter-active');
    }
  }

  // Update min age filter
  const minAgeFilter = document.getElementById('facet-min-age');
  if (minAgeFilter) {
    if (filters.selectedMinAge !== null) {
      minAgeFilter.classList.add('filter-active');
    } else {
      minAgeFilter.classList.remove('filter-active');
    }
  }

  // Update previous players filter
  const prevPlayersFilter = document.getElementById('facet-previous-players');
  if (prevPlayersFilter) {
    if (filters.selectedPreviousPlayers && filters.selectedPreviousPlayers.length > 0) {
      prevPlayersFilter.classList.add('filter-active');
    } else {
      prevPlayersFilter.classList.remove('filter-active');
    }
  }

  // Update number of plays filter
  const numPlaysFilter = document.getElementById('facet-numplays');
  if (numPlaysFilter) {
    if (filters.selectedNumPlays !== null) {
      numPlaysFilter.classList.add('filter-active');
    } else {
      numPlaysFilter.classList.remove('filter-active');
    }
  }
}

function getFiltersFromURL() {
  const params = new URLSearchParams(window.location.search);
  const minAgeParam = params.get('min_age');
  const numPlaysParam = params.get('numplays');

  return {
    query: params.get('q') || '',
    selectedCategories: params.get('categories')?.split(',').filter(Boolean) || [],
    selectedMechanics: params.get('mechanics')?.split(',').filter(Boolean) || [],
    selectedPlayerFilter: params.get('players') || 'any',
    selectedWeight: params.get('weight')?.split(',').filter(Boolean) || [],
    selectedPlayingTime: params.get('playing_time')?.split(',').filter(Boolean) || [],
    selectedPreviousPlayers: params.get('previous_players')?.split(',').filter(Boolean) || [],
    selectedMinAge: minAgeParam ? { min: Number(minAgeParam.split('-')[0]), max: Number(minAgeParam.split('-')[1]) } : null,
    selectedNumPlays: numPlaysParam ? { min: Number(numPlaysParam.split('-')[0]), max: Number(numPlaysParam.split('-')[1]) } : null,
    sortBy: params.get('sort') || 'name',
    page: Number(params.get('page')) || 1
  };
}

function getFiltersFromUI() {
  const query = document.getElementById('search-input')?.value.toLowerCase().trim() || '';
  const selectedCategories = getSelectedValues('categories');
  const selectedMechanics = getSelectedValues('mechanics');
  const selectedPlayerFilter = document.querySelector('input[name="players"]:checked')?.value || 'any';
  const selectedWeight = getSelectedValues('weight');
  const selectedPlayingTime = getSelectedValues('playing_time');
  const selectedPreviousPlayers = getSelectedValues('previous_players');
  const selectedMinAge = getSelectedRange('min_age');
  const selectedNumPlays = getSelectedRange('numplays');
  const sortBy = document.getElementById('sort-select')?.value || 'name';

  return {
    query,
    selectedCategories,
    selectedMechanics,
    selectedPlayerFilter,
    selectedWeight,
    selectedPlayingTime,
    selectedPreviousPlayers,
    selectedMinAge,
    selectedNumPlays,
    sortBy,
    page: currentPage
  };
}

function updateURLWithFilters(filters) {
  const params = new URLSearchParams();

  if (filters.query) params.set('q', filters.query);
  if (filters.selectedCategories?.length) params.set('categories', filters.selectedCategories.join(','));
  if (filters.selectedMechanics?.length) params.set('mechanics', filters.selectedMechanics.join(','));
  if (filters.selectedPlayerFilter && filters.selectedPlayerFilter !== 'any') params.set('players', filters.selectedPlayerFilter);
  if (filters.selectedWeight?.length) params.set('weight', filters.selectedWeight.join(','));
  if (filters.selectedPlayingTime?.length) params.set('playing_time', filters.selectedPlayingTime.join(','));
  if (filters.selectedPreviousPlayers?.length) params.set('previous_players', filters.selectedPreviousPlayers.join(','));
  if (filters.selectedMinAge) params.set('min_age', `${filters.selectedMinAge.min}-${filters.selectedMinAge.max}`);
  if (filters.selectedNumPlays) params.set('numplays', `${filters.selectedNumPlays.min}-${filters.selectedNumPlays.max}`);
  if (filters.sortBy && filters.sortBy !== 'name') params.set('sort', filters.sortBy);
  if (filters.page && filters.page > 1) params.set('page', filters.page);

  const newUrl = `${window.location.pathname}?${params.toString()}`;
  history.replaceState(filters, '', newUrl);
}

function updateUIFromState(state) {
  document.getElementById('search-input').value = state.query;

  document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);

  const checkboxFilters = {
    'categories': state.selectedCategories,
    'mechanics': state.selectedMechanics,
    'weight': state.selectedWeight,
    'playing_time': state.selectedPlayingTime,
    'previous_players': state.selectedPreviousPlayers,
  };

  for (const name in checkboxFilters) {
    const values = checkboxFilters[name];
    if (values?.length) {
      values.forEach(value => {
        const cb = document.querySelector(`input[type="checkbox"][name="${name}"][value="${CSS.escape(value)}"]`);
        if (cb) cb.checked = true;
      });
    }
  }

  const playerRadio = document.querySelector(`input[name="players"][value="${state.selectedPlayerFilter}"]`);
  if (playerRadio) playerRadio.checked = true;

  // Always handle player filter sub-options visibility
  const allPlayerLabels = document.querySelectorAll('#facet-players label.filter-item[data-level]');

  if (state.selectedPlayerFilter && state.selectedPlayerFilter !== 'any') {
    if (state.selectedPlayerFilter.includes('-')) {
      // A sub-option is selected - show all sub-options for the same parent
      const parentValue = state.selectedPlayerFilter.split('-')[0];
      allPlayerLabels.forEach(label => {
        const level = parseInt(label.dataset.level, 10);
        if (level > 0) {
          label.style.display = label.dataset.parentValue === parentValue ? 'flex' : 'none';
        }
      });
    } else {
      // A main player count is selected - show its sub-options
      const mainValue = state.selectedPlayerFilter;
      allPlayerLabels.forEach(label => {
        const level = parseInt(label.dataset.level, 10);
        if (level > 0) {
          label.style.display = label.dataset.parentValue === mainValue ? 'flex' : 'none';
        }
      });
    }
  } else {
    // Hide all sub-options when "any" is selected
    allPlayerLabels.forEach(label => {
      const level = parseInt(label.dataset.level, 10);
      if (level > 0) {
        label.style.display = 'none';
      }
    });
  }

  const minAgeValue = state.selectedMinAge ? `${state.selectedMinAge.min}-${state.selectedMinAge.max}` : '0-100';
  const minAgeRadio = document.querySelector(`input[name="min_age"][value="${minAgeValue}"]`);
  if (minAgeRadio) minAgeRadio.checked = true;

  const numPlaysValue = state.selectedNumPlays ? `${state.selectedNumPlays.min}-${state.selectedNumPlays.max}` : '0-9999';
  const numPlaysRadio = document.querySelector(`input[name="numplays"][value="${numPlaysValue}"]`);
  if (numPlaysRadio) numPlaysRadio.checked = true;

  document.getElementById('sort-select').value = state.sortBy;
  currentPage = state.page;
}

function onFilterChange(resetPage = true) {
  const state = getFiltersFromUI();
  if (resetPage) {
    state.page = 1;
    currentPage = 1;
  }
  updateURLWithFilters(state);
  applyFiltersAndSort(state);
  updateResults();
  updateStats();
}

function setupClearAllButton() {
  const clearContainer = document.getElementById('clear-all');
  const button = createElement('button', {
    id: 'clear-filters',
    className: 'clear-button'
  }, 'Clear filters');
  button.addEventListener('click', clearAllFilters);

  clearContainer.appendChild(button);
  clearContainer.style.display = 'none';
}

function filterGames(gamesToFilter, filters) {
  const {
    query,
    selectedCategories,
    selectedMechanics,
    selectedPlayerFilter,
    selectedWeight,
    selectedPlayingTime,
    selectedPreviousPlayers,
    selectedMinAge,
    selectedNumPlays
  } = filters;

  return gamesToFilter.filter(game => {
    if (query && !game.name.toLowerCase().includes(query) &&
      !game.description.toLowerCase().includes(query)) {
      return false;
    }

    if (selectedCategories.length > 0 &&
      !selectedCategories.some(cat => game.categories.includes(cat))) {
      return false;
    }

    if (selectedMechanics.length > 0 &&
      !selectedMechanics.some(mech => game.mechanics.includes(mech))) {
      return false;
    }

    if (selectedPlayerFilter && selectedPlayerFilter !== 'any') {
      // Handle both simple player count (e.g., "2") and detailed format (e.g., "2-best")
      const filterParts = selectedPlayerFilter.split('-');
      const targetPlayers = Number(filterParts[0]);
      const requiredType = filterParts.length > 1 ? filterParts[1] : null;

      if (!isNaN(targetPlayers)) {
        const match = game.players.some(([count, type]) => {
          if (!count || type === 'not recommended') return false;

          // If a specific recommendation type is required, check for it
          if (requiredType && type !== requiredType) return false;

          const parsed = parsePlayerCount(count);
          if (parsed.open) {
            return targetPlayers === parsed.min;
          }
          return targetPlayers >= parsed.min && targetPlayers <= parsed.max;
        });

        if (!match) {
          return false;
        }
      }
    }

    if (selectedWeight.length > 0) {
      const gameWeightName = getComplexityName(game.weight);
      if (!gameWeightName || !selectedWeight.includes(gameWeightName)) {
        return false;
      }
    }

    if (selectedPlayingTime.length > 0 && !selectedPlayingTime.includes(game.playing_time)) {
      return false;
    }

    if (selectedPreviousPlayers.length > 0 &&
      !selectedPreviousPlayers.some(player => game.previous_players.includes(player))) {
      return false;
    }

    if (selectedMinAge && (game.min_age < selectedMinAge.min || game.min_age > selectedMinAge.max)) {
      return false;
    }

    if (selectedNumPlays && (game.numplays < selectedNumPlays.min || game.numplays > selectedNumPlays.max)) {
      return false;
    }

    return true;
  });
}

function updateCountsInDOM(facetId, counts, showZero = false) {
  const facetContainer = document.getElementById(facetId);
  if (!facetContainer) return;

  const filterItems = facetContainer.querySelectorAll('.filter-item');
  filterItems.forEach(item => {
    const input = item.querySelector('input');
    if (!input) return;

    const value = input.value;
    const countSpan = item.querySelector('.facet-count');

    if (countSpan) {
      const newCount = counts[value] || 0;
      countSpan.textContent = newCount;

      // Special handling for player filter hierarchical structure
      if (facetId === 'facet-players') {
        const level = parseInt(item.dataset.level, 10) || 0;

        if (level > 0) {
          // This is a sub-option - show if:
          // 1. Its parent is selected, OR
          // 2. Any sub-option with the same parent is selected, OR
          // 3. This specific sub-option is selected
          const parentValue = item.dataset.parentValue;
          const parentInput = facetContainer.querySelector(`input[value="${parentValue}"]`);
          const anyInput = facetContainer.querySelector(`input[value="any"]`);

          // Check if any sub-option with the same parent is selected
          const anySubOptionSelected = Array.from(facetContainer.querySelectorAll(`input[type="radio"]`))
            .some(radio => radio.checked && radio.value.includes('-') && radio.value.startsWith(parentValue + '-'));

          // Sub-options should be visible if:
          // 1. Their specific parent is selected, OR
          // 2. Any sub-option for this parent is selected
          // AND "Any" is NOT selected
          const shouldShow = ((parentInput && parentInput.checked) || anySubOptionSelected) && !(anyInput && anyInput.checked);

          item.style.display = shouldShow ? 'flex' : 'none';
        } else {
          // This is a main option - show/hide based on count
          if (newCount === 0 && !input.checked && !showZero) {
            item.style.display = 'none';
          } else {
            item.style.display = 'flex';
          }
        }
      } else {
        // Normal handling for other filters
        if (newCount === 0 && !input.checked && !showZero) {
          item.style.display = 'none';
        } else {
          item.style.display = 'flex';
        }
      }
    }
  });
}

function updateAllFilterCounts(filters) {
  const catFilters = {
    ...filters,
    selectedCategories: []
  };
  const gamesForCatCount = filterGames(allGames, catFilters);
  const categoryCounts = {};
  gamesForCatCount.forEach(game => {
    game.categories.forEach(cat => {
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });
  });
  updateCountsInDOM('facet-categories', categoryCounts);

  const mechFilters = {
    ...filters,
    selectedMechanics: []
  };
  const gamesForMechCount = filterGames(allGames, mechFilters);
  const mechanicCounts = {};
  gamesForMechCount.forEach(game => {
    game.mechanics.forEach(mech => {
      mechanicCounts[mech] = (mechanicCounts[mech] || 0) + 1;
    });
  });
  updateCountsInDOM('facet-mechanics', mechanicCounts);

  const playerFilters = {
    ...filters,
    selectedPlayerFilter: 'any'
  };
  const gamesForPlayerCount = filterGames(allGames, playerFilters);
  const playerCounts = {};
  document.querySelectorAll('#facet-players input[type="radio"]').forEach(radio => {
    const value = radio.value;
    if (value === 'any') {
      playerCounts[value] = gamesForPlayerCount.length;
    } else {
      const targetPlayers = Number(value);
      const count = gamesForPlayerCount.filter(game =>
        game.players.some(([playerCount, type]) => {
          if (type === 'not recommended') return false;
          const {
            min,
            max
          } = parsePlayerCount(playerCount);
          return targetPlayers >= min && targetPlayers <= max;
        })
      ).length;
      playerCounts[value] = count;
    }
  });
  updateCountsInDOM('facet-players', playerCounts, true);

  const weightFilters = {
    ...filters,
    selectedWeight: []
  };
  const gamesForWeightCount = filterGames(allGames, weightFilters);
  const weightCounts = {};
  gamesForWeightCount.forEach(game => {
    if (game.weight) {
      const name = getComplexityName(game.weight);
      if (name) {
        weightCounts[name] = (weightCounts[name] || 0) + 1;
      }
    }
  });
  updateCountsInDOM('facet-weight', weightCounts);

  const playingTimeFilters = {
    ...filters,
    selectedPlayingTime: []
  };
  const gamesForPlayingTimeCount = filterGames(allGames, playingTimeFilters);
  const playingTimeCounts = {};
  gamesForPlayingTimeCount.forEach(game => {
    if (game.playing_time) {
      playingTimeCounts[game.playing_time] = (playingTimeCounts[game.playing_time] || 0) + 1;
    }
  });
  updateCountsInDOM('facet-playing-time', playingTimeCounts);

  const minAgeFilters = {
    ...filters,
    selectedMinAge: null
  };
  const gamesForMinAgeCount = filterGames(allGames, minAgeFilters);
  const minAgeCounts = {};
  document.querySelectorAll('#facet-min-age input[type="radio"]').forEach(radio => {
    const value = radio.value;
    const [min, max] = value.split('-').map(Number);
    if (value === '0-100') {
      minAgeCounts[value] = gamesForMinAgeCount.length;
    } else {
      const count = gamesForMinAgeCount.filter(game => game.min_age >= min && game.min_age <= max).length;
      minAgeCounts[value] = count;
    }
  });
  updateCountsInDOM('facet-min-age', minAgeCounts, true);

  const prevPlayersFilters = {
    ...filters,
    selectedPreviousPlayers: []
  };
  const gamesForPrevPlayersCount = filterGames(allGames, prevPlayersFilters);
  const prevPlayerCounts = {};
  gamesForPrevPlayersCount.forEach(game => {
    game.previous_players.forEach(player => {
      prevPlayerCounts[player] = (prevPlayerCounts[player] || 0) + 1;
    });
  });
  updateCountsInDOM('facet-previous-players', prevPlayerCounts);

  const numPlaysFilters = {
    ...filters,
    selectedNumPlays: null
  };
  const gamesForNumPlaysCount = filterGames(allGames, numPlaysFilters);
  const numPlaysCounts = {};
  document.querySelectorAll('#facet-numplays input[type="radio"]').forEach(radio => {
    const value = radio.value;
    const [min, max] = value.split('-').map(Number);
    if (value === '0-9999') {
      numPlaysCounts[value] = gamesForNumPlaysCount.length;
    } else {
      const count = gamesForNumPlaysCount.filter(game => game.numplays >= min && game.numplays <= max).length;
      numPlaysCounts[value] = count;
    }
  });
  updateCountsInDOM('facet-numplays', numPlaysCounts, true);
}

function applyFiltersAndSort(filters) {
  updateClearButtonVisibility(filters);
  updateFilterActiveStates(filters);
  updateAllFilterCounts(filters);

  filteredGames = filterGames(allGames, filters);

  filteredGames.sort((a, b) => {
    switch (filters.sortBy) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'rank':
        return (a.rank || 999999) - (b.rank || 999999);
      case 'rating':
        return (b.rating || 0) - (a.rating || 0);
      case 'numowned':
        return (b.numowned || 0) - (a.numowned || 0);
      case 'numrated':
        return (b.usersrated || 0) - (a.usersrated || 0);
      default:
        return 0;
    }
  });
}

function getSelectedValues(name) {
  const checkboxes = document.querySelectorAll(`input[name="${name}"]:checked`);
  return Array.from(checkboxes).map(cb => cb.value);
}

function getSelectedRange(name) {
  const radio = document.querySelector(`input[name="${name}"]:checked`);
  if (!radio || radio.value === '0-100' || radio.value === '0-9999') return null;

  const [min, max] = radio.value.split('-').map(Number);
  return { min, max };
}

function clearAllFilters() {
  history.pushState({}, '', window.location.pathname);
  const state = getFiltersFromURL();
  updateUIFromState(state);
  applyFiltersAndSort(state);
  updateResults();
  updateStats();
}

function updateResults() {
  const container = document.getElementById('hits');
  const startIdx = (currentPage - 1) * GAMES_PER_PAGE;
  const endIdx = startIdx + GAMES_PER_PAGE;
  const pageGames = filteredGames.slice(startIdx, endIdx);

  if (pageGames.length === 0) {
    const template = document.getElementById('no-results-template');
    const clone = template.content.cloneNode(true);
    container.innerHTML = '';
    container.appendChild(clone);
    updatePagination();
    return;
  }

  const gridTemplate = document.getElementById('game-grid-template');
  const gridClone = gridTemplate.content.cloneNode(true);
  const gameGrid = gridClone.querySelector('.game-grid');

  pageGames.forEach(game => {
    gameGrid.appendChild(renderGameCard(game));
  });

  container.innerHTML = '';
  container.appendChild(gridClone);

  on_render();
  updatePagination();
}

function renderGameCard(game) {
  const template = document.getElementById('game-card-template');
  const clone = template.content.cloneNode(true);
  const card = clone.querySelector('.game-card');

  // Set basic card data
  card.setAttribute('data-color', game.color || '255,255,255');

  // Set images
  const summaryImg = clone.querySelector('.game-image');
  const coverImg = clone.querySelector('.cover-image-img');
  summaryImg.src = game.image;
  summaryImg.alt = game.name;
  coverImg.src = game.image;
  coverImg.alt = game.name;

  // Set title
  const title = clone.querySelector('.game-title');
  title.innerHTML = highlightText(game.name, getCurrentSearchQuery());

  // Set category chips
  const categoryContainer = clone.querySelector('.category-chips-container');
  const categoryChips = formatCategoryChips(game);
  if (categoryChips) {
    categoryContainer.innerHTML = categoryChips;
  }

  // Set stats bar items
  const playingTimeStat = clone.querySelector('.playing-time-stat');
  if (game.playing_time) {
    playingTimeStat.style.display = 'flex';
    clone.querySelector('.playing-time-value').textContent = game.playing_time;
  }

  const playersStat = clone.querySelector('.players-stat');
  if (game.players.length > 0) {
    playersStat.style.display = 'flex';
    clone.querySelector('.players-value').textContent = formatPlayerCountShort(game.players);
  }

  const complexityStat = clone.querySelector('.complexity-stat');
  if (typeof game.weight === 'number' && !isNaN(game.weight)) {
    complexityStat.style.display = 'flex';
    clone.querySelector('.complexity-gauge-container').innerHTML = renderComplexityGauge(game.weight);
    clone.querySelector('.complexity-name').textContent = getComplexityName(game.weight);
  }

  const minAgeStat = clone.querySelector('.min-age-stat');
  if (game.min_age) {
    minAgeStat.style.display = 'flex';
    clone.querySelector('.min-age-value').textContent = game.min_age + "+";
  }

  // Set description
  const teaserText = clone.querySelector('.teaser-text');
  teaserText.setAttribute('data-full-text', escapeHtml(game.description || ''));
  teaserText.innerHTML = game.description ? getTeaserText(game.description, true) : 'No description available.';

  // Set mechanic chips
  const mechanicContainer = clone.querySelector('.mechanic-chips-container');
  const mechanicChips = formatMechanicChips(game);
  if (mechanicChips) {
    mechanicContainer.innerHTML = mechanicChips;
  }

  // Set expansions
  const expansionsSection = clone.querySelector('.expansions-section');
  if (game.expansions && game.expansions.length > 0) {
    expansionsSection.style.display = 'block';
    const expansionTemplate = document.getElementById('expansion-chip-template');
    const expansionLinks = game.expansions.map(exp => {
      const expClone = expansionTemplate.content.cloneNode(true);
      const link = expClone.querySelector('.expansion-chip');
      link.href = `https://boardgamegeek.com/boardgame/${exp.id}`;
      link.textContent = exp.name;
      return link.outerHTML;
    }).join('');
    clone.querySelector('.expansion-chips').innerHTML = expansionLinks;
  }

  // Set rating
  const ratingSection = clone.querySelector('.rating-section');
  if (game.rating) {
    ratingSection.style.display = 'flex';
    clone.querySelector('.rating-gauge-container').innerHTML = renderRatingGauge(game.rating);
  }

  // Set rank
  const rankSection = clone.querySelector('.rank-section');
  if (game.rank) {
    rankSection.style.display = 'flex';
    clone.querySelector('.rank-value').textContent = game.rank;
  }

  // Set number of plays
  clone.querySelector('.numplays-value').textContent = game.numplays || "No";

  // Set BGG link
  const bggLink = clone.querySelector('.bgg-link');
  if (bggLink && game.id) {
    bggLink.href = `https://boardgamegeek.com/boardgame/${game.id}`;
  }

  return clone;
}

function formatCategoryChips(game) {
  if (!game.categories || game.categories.length === 0) {
    return '';
  }
  const template = document.getElementById('category-chip-template');
  const categoriesHtml = game.categories.map(cat => {
    const clone = template.content.cloneNode(true);
    const chip = clone.querySelector('.tag-chip');
    chip.textContent = cat;
    return chip.outerHTML;
  }).join('');
  return createTagChipsContainer(categoriesHtml);
}

function formatMechanicChips(game) {
  if (!game.mechanics || game.mechanics.length === 0) {
    return '';
  }
  const template = document.getElementById('mechanic-chip-template');
  const mechanicsHtml = game.mechanics.map(mech => {
    const clone = template.content.cloneNode(true);
    const chip = clone.querySelector('.tag-chip');
    chip.textContent = mech;
    return chip.outerHTML;
  }).join('');
  return createTagChipsContainer(mechanicsHtml);
}

function formatPlayerCount(players) {
  return players.map(([count, type]) => {
    const suffix = type === 'best' ? ' (best)' : type === 'recommended' ? ' (rec.)' : '';
    return count + suffix;
  }).join(', ');
}

function formatPlayerCountShort(players) {
  if (players.length === 0) return '';
  if (players.length === 1) return players[0][0];

  const minPlayers = Math.min(...players.map(p => parseInt(p[0])));
  const maxPlayers = Math.max(...players.map(p => parseInt(p[0])));

  return `${minPlayers}${minPlayers !== maxPlayers ? `-${maxPlayers}` : ''}`;
}

function getTeaserText(description, hasMore = false) {
  if (!description) return '';

  if (description.length <= MAX_DESCRIPTION_LENGTH) {
    return description;
  }

  let truncated = description.substring(0, MAX_DESCRIPTION_LENGTH);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > 0) {
    truncated = truncated.substring(0, lastSpace);
  }
  truncated += '...';

  if (hasMore) {
    const template = document.getElementById('more-button-template');
    const clone = template.content.cloneNode(true);
    return truncated + ' ' + clone.querySelector('button').outerHTML;
  }

  return truncated;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderComplexityGauge(score) {
  if (isNaN(score)) return '';

  const template = document.getElementById('complexity-gauge-template');
  const clone = template.content.cloneNode(true);
  const svg = clone.querySelector('.complexity-gauge');
  const fgCircle = clone.querySelector('.gauge-fg');
  const text = clone.querySelector('.gauge-text');

  const circumference = 2 * Math.PI * GAUGE_RADIUS;
  const offset = circumference - (score / 5) * circumference;

  fgCircle.setAttribute('stroke-dasharray', circumference);
  fgCircle.setAttribute('stroke-dashoffset', offset);
  text.textContent = score.toFixed(1);

  return svg.outerHTML;
}

function getComplexityName(score) {
  if (isNaN(score) || score <= 0) return '';
  if (score < CONFIG.COMPLEXITY_THRESHOLDS[0]) return CONFIG.COMPLEXITY_NAMES[0];
  if (score < CONFIG.COMPLEXITY_THRESHOLDS[1]) return CONFIG.COMPLEXITY_NAMES[1];
  if (score < CONFIG.COMPLEXITY_THRESHOLDS[2]) return CONFIG.COMPLEXITY_NAMES[2];
  if (score < CONFIG.COMPLEXITY_THRESHOLDS[3]) return CONFIG.COMPLEXITY_NAMES[3];
  return CONFIG.COMPLEXITY_NAMES[4];
}

function renderRatingGauge(score) {
  if (isNaN(score) || score === 0) return '';

  const template = document.getElementById('rating-gauge-template');
  const clone = template.content.cloneNode(true);
  const svg = clone.querySelector('.rating-gauge');
  const fgCircle = clone.querySelector('.gauge-fg');
  const text = clone.querySelector('.gauge-text');

  const circumference = 2 * Math.PI * GAUGE_RADIUS;
  const offset = circumference - (score / 10) * circumference;

  fgCircle.setAttribute('stroke-dasharray', circumference);
  fgCircle.setAttribute('stroke-dashoffset', offset);
  text.textContent = score.toFixed(1);

  return svg.outerHTML;
}

function highlightText(text, query) {
  if (!query || query.length < 2) return text;

  const regex = new RegExp(`(${query})`, 'gi');
  return text.replace(regex, '<strong class="highlight">$1</strong>');
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;

  const truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated) + '...';
}

function getCurrentSearchQuery() {
  const searchInput = document.getElementById('search-input');
  return searchInput ? searchInput.value.toLowerCase().trim() : '';
}

function updateStats() {
  const statsContainer = document.getElementById('stats');
  const totalGames = filteredGames.length;
  const totalAllGames = allGames.length;

  let statsText = `${totalGames.toLocaleString()}`;
  if (totalGames !== totalAllGames) {
    statsText += ` of ${totalAllGames.toLocaleString()}`;
  }
  statsContainer.textContent = `${statsText} games`;
}

function createPaginationButton(page, text, isCurrent = false) {
  const template = document.getElementById('pagination-button-template');
  const clone = template.content.cloneNode(true);
  const button = clone.querySelector('.pagination-btn');

  button.textContent = text || page;
  button.onclick = () => goToPage(page);

  if (isCurrent) {
    button.className += ' current';
  }

  return button;
}

function createPaginationEllipsis() {
  const template = document.getElementById('pagination-ellipsis-template');
  const clone = template.content.cloneNode(true);
  return clone.querySelector('span');
}

function updatePagination() {
  const container = document.getElementById('pagination');
  const totalPages = Math.ceil(filteredGames.length / GAMES_PER_PAGE);

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const template = document.getElementById('pagination-template');
  const clone = template.content.cloneNode(true);
  const paginationDiv = clone.querySelector('.pagination');

  // Clear existing content
  paginationDiv.innerHTML = '';

  if (currentPage > 1) {
    paginationDiv.appendChild(createPaginationButton(currentPage - 1, '‹ Previous'));
  }

  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, currentPage + 2);

  if (startPage > 1) {
    paginationDiv.appendChild(createPaginationButton(1));
    if (startPage > 2) paginationDiv.appendChild(createPaginationEllipsis());
  }

  for (let i = startPage; i <= endPage; i++) {
    const isCurrentPage = i === currentPage;
    paginationDiv.appendChild(createPaginationButton(i, i, isCurrentPage));
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) paginationDiv.appendChild(createPaginationEllipsis());
    paginationDiv.appendChild(createPaginationButton(totalPages));
  }

  if (currentPage < totalPages) {
    paginationDiv.appendChild(createPaginationButton(currentPage + 1, 'Next ›'));
  }

  container.innerHTML = '';
  container.appendChild(clone);
}

function goToPage(page) {
  currentPage = page;
  const state = getFiltersFromUI();
  updateURLWithFilters(state);
  updateResults();
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function getTextColorForBg(rgbColor) {
  const [r, g, b] = rgbColor.split(',').map(Number);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
}

function positionPopupInViewport(popup, trigger, clickEvent = null) {
  const triggerRect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const margin = 8;

  popup.style.height = '';
  popup.style.overflowY = '';
  const popupRect = popup.getBoundingClientRect();

  let desiredAbsoluteLeft = triggerRect.left + (triggerRect.width - popupRect.width) / 2;
  let desiredAbsoluteTop = triggerRect.top + (triggerRect.height - popupRect.height) / 2;

  let currentAbsoluteLeft = desiredAbsoluteLeft;
  let currentAbsoluteTop = desiredAbsoluteTop;

  if (currentAbsoluteLeft < margin) {
    currentAbsoluteLeft = margin;
  } else if (currentAbsoluteLeft + popupRect.width > viewportWidth - margin) {
    currentAbsoluteLeft = viewportWidth - margin - popupRect.width;
    if (currentAbsoluteLeft < margin) {
      currentAbsoluteLeft = margin;
    }
  }

  if (currentAbsoluteTop < margin) {
    currentAbsoluteTop = margin;
  } else if (currentAbsoluteTop + popupRect.height > viewportHeight - margin) {
    currentAbsoluteTop = viewportHeight - margin - popupRect.height;
    if (currentAbsoluteTop < margin) {
      currentAbsoluteTop = margin;
    }
  }

  const availableViewportHeight = viewportHeight - 2 * margin;
  if (popupRect.height > availableViewportHeight) {
    popup.style.height = availableViewportHeight + 'px';
    popup.style.overflowY = 'auto';
    currentAbsoluteTop = margin;
  }

  const finalLeftStyle = currentAbsoluteLeft - triggerRect.left;
  const finalTopStyle = currentAbsoluteTop - triggerRect.top;

  popup.style.left = finalLeftStyle + 'px';
  popup.style.top = finalTopStyle + 'px';
}

function on_render() {
  const gameCards = document.querySelectorAll(".game-card");
  gameCards.forEach(function (card) {
    const color = card.getAttribute("data-color") || "255,255,255";
    const textColor = getTextColorForBg(color);

    const gameDetails = card.querySelector(".game-details");
    if (gameDetails) {
      gameDetails.style.backgroundColor = '#FFFFFF';

      const cardHeader = card.querySelector(".card-header");
      if (cardHeader) {
        cardHeader.style.backgroundColor = `rgb(${color})`;
        cardHeader.style.color = textColor;
      }

      const statsBar = card.querySelector(".stats-bar");
      if (statsBar) {
        statsBar.style.backgroundColor = `rgba(${color}, 0.1)`;

        const gaugeFg = statsBar.querySelector(".gauge-fg");
        if (gaugeFg) {
          gaugeFg.style.stroke = `rgb(${color})`;
        }
      }

      const bottomInfo = card.querySelector(".bottom-info");
      if (bottomInfo) {
        const ratingGaugeFg = bottomInfo.querySelector(".rating-gauge .gauge-fg");
        if (ratingGaugeFg) {
          ratingGaugeFg.style.stroke = `rgb(${color})`;
        }
      }

      const gameDetailsIcons = gameDetails.querySelectorAll(".icon-themed");
      gameDetailsIcons.forEach(function (icon) {
        icon.style.color = `rgb(${color})`;
      });
    }
  });

  setupGameDetails();
}

function setupGameDetails() {
  const summaries = document.querySelectorAll("summary");
  summaries.forEach(function (elem) {
    function conditionalClose(event) {
      closeAllDetails();
      if (!elem.parentElement.hasAttribute("open")) {
        const gameDetails = elem.parentElement.querySelector(".game-details");
        if (gameDetails) {
          gameDetails.focus();
          requestAnimationFrame(() => {
            positionPopupInViewport(gameDetails, elem, event);
          });
        }
      }
    }
    elem.addEventListener("click", conditionalClose);
  });

  const gameDetails = document.querySelectorAll(".game-details");
  gameDetails.forEach(function (elem) {
    let closeButton = elem.querySelector('.close-button');

    function closeDetails(event) {
      elem.parentElement.removeAttribute("open");
      event.stopPropagation();
    }

    if (closeButton) {
      closeButton.addEventListener("click", closeDetails);
      closeButton.addEventListener("keypress", closeDetails);
    }

    elem.addEventListener("click", function (event) {
      event.stopPropagation();
    });
  });

}

function closeAllDetails() {
  const openDetails = document.querySelectorAll("details[open]");
  openDetails.forEach(function (elem) {
    elem.removeAttribute("open");
  });
}

function closeAll(event) {
  closeAllDetails();
}

document.addEventListener("click", closeAll);

function init(settings) {
  console.log('Initializing GameCache SQLite app...');
  initializeDatabase(settings);
}

loadINI('./config.ini', function (settings) {
  console.log('Settings loaded:', settings);
  init(settings);
});
