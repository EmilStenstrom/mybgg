// SQLite-based search application to replace Algolia
let db = null;
let allGames = [];
let filteredGames = [];
let currentPage = 1;
const GAMES_PER_PAGE = 48;

// Load configuration and initialize the app
function loadJSON(path, callback) {
  fetch(path)
    .then(response => response.json())
    .then(callback)
    .catch(error => console.error('Error loading config:', error));
}

// Initialize SQL.js and load the database
async function initializeDatabase(settings) {
  try {
    // Initialize SQL.js (already loaded in HTML)
    const SQL = await initSqlJs({
      // Still need to tell sql.js where to find the .wasm file
      locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/${file}`
    });

    // Determine database URL based on environment
    const isDev = /^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname);
    // MODIFIED: Always use .gz for consistency, or make dev load .gz
    const dbUrl = isDev ? './mybgg.sqlite.gz' :
      `https://github.com/${settings.github.repo}/releases/latest/download/${settings.github.snapshot_asset}`;

    console.log(`Loading database from: ${dbUrl}`);

    // Fetch and decompress database
    const response = await fetch(dbUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch database: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Corrected: Use fflate.gunzipSync for decompressing Gzip data
    const dbData = fflate.gunzipSync(bytes);

    db = new SQL.Database(dbData);
    console.log('Database loaded successfully');

    // Load all games into memory for faster filtering
    loadAllGames();
    initializeUI();

  } catch (error) {
    console.error('Error initializing database:', error);
    document.getElementById('hits').innerHTML = `
      <div class="error">
        <h2>Error loading database</h2>
        <p>${error.message}</p>
        <p>Please check that the database file exists and is accessible.</p>
      </div>
    `;
  }
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

    // Parse JSON fields
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

// Global flag to prevent multiple event listeners
let moreButtonListenerAdded = false;

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

  // Handle window resize to reposition open popups
  window.addEventListener('resize', function() {
    const openDetails = document.querySelector('details[open] .game-details');
    if (openDetails) {
      const trigger = openDetails.closest('details').querySelector('summary');
      if (trigger) {
        // On resize, use space-based positioning (no click event)
        positionPopupInViewport(openDetails, trigger);
      }
    }
  });
}

// Direct onclick handler for more buttons
function handleMoreButtonClick(button) {
  const teaserText = button.closest('.teaser-text');
  if (!teaserText) return;

  const fullText = teaserText.getAttribute('data-full-text');

  if (button.textContent === 'more') {
    teaserText.innerHTML = escapeHtml(fullText) + ' <button class="more-button" onclick="handleMoreButtonClick(this)">less</button>';
  } else {
    teaserText.innerHTML = getTeaserText(fullText, true);
  }
}

function setupSearchBox() {
  const searchBox = document.getElementById('search-box');
  searchBox.innerHTML = `
    <input type="text" id="search-input" placeholder="Search games..." />
  `;

  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', debounce(handleSearch, 300));
}

function setupSorting() {
  const sortContainer = document.getElementById('sort-by');
  sortContainer.innerHTML = `
    <select id="sort-select" name="sort-by">
      <option value="name">Name (A-Z)</option>
      <option value="rank">BGG Rank</option>
      <option value="rating">Rating</option>
      <option value="numowned">Most Owned</option>
      <option value="numrated">Most Rated</option>
    </select>
  `;

  document.getElementById('sort-select').addEventListener('change', handleSort);
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

  createRefinementFilter('facet-categories', 'Categories', items, 'categories');
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

  createRefinementFilter('facet-mechanics', 'Mechanics', items, 'mechanics');
}

function setupPlayersFilter() {
  const playerCounts = new Set();
  allGames.forEach(game => {
    game.players.forEach(([count, type]) => {
      const {
        min,
        max
      } = parsePlayerCount(count);
      if (min > 0) { // Only add valid player counts
        const upper = isFinite(max) ? max : 10; // Cap at 10 for UI
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
      count: allGames.length
    },
    ...sortedPlayers.map(p => {
      const count = allGames.filter(game => {
        return game.players.some(([playerCount, type]) => {
          const {
            min,
            max
          } = parsePlayerCount(playerCount);
          return p >= min && p <= max;
        });
      }).length;
      return {
        label: `${p} player${p === 1 ? '' : 's'}`,
        value: p.toString(),
        count: count
      };
    })
  ];

  createRefinementFilter('facet-players', 'Number of players', playerItems, 'players', true);
}

function setupWeightFilter() {
  const weights = ['Light', 'Light Medium', 'Medium', 'Medium Heavy', 'Heavy'];
  const weightCounts = {};
  allGames.forEach(game => {
    if (game.weight) {
      weightCounts[game.weight] = (weightCounts[game.weight] || 0) + 1;
    }
  });

  const items = weights.map(w => ({
    label: w,
    value: w,
    count: weightCounts[w] || 0
  }));

  createRefinementFilter('facet-weight', 'Complexity', items, 'weight');
}

function setupPlayingTimeFilter() {
  const times = ['< 30min', '30min - 1h', '1-2h', '2-3h', '3-4h', '> 4h'];
  const timeCounts = {};
  allGames.forEach(game => {
    if (game.playing_time) {
      timeCounts[game.playing_time] = (timeCounts[game.playing_time] || 0) + 1;
    }
  });

  const items = times.map(t => ({
    label: t,
    value: t,
    count: timeCounts[t] || 0
  }));

  createRefinementFilter('facet-playing-time', 'Playing time', items, 'playing_time');
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
    return { ...range,
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

  createRefinementFilter('facet-previous-players', 'Previous players', items, 'previous_players');
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
    return { ...range,
      count: range.default ? allGames.length : count
    };
  });

  createRefinementFilter('facet-numplays', 'Number of plays', items, 'numplays', true);
}

function createRefinementFilter(facetId, title, items, attributeName, isRadio = false) {
  const container = document.getElementById(facetId);
  if (!container) return;

  container.outerHTML = `
    <details class="filter-dropdown" id="${facetId}">
      <summary><span class="material-symbols-rounded">filter_list</span> ${title}</summary>
      <div class="filter-dropdown-content">
        ${items.map(item => {
          const value = (typeof item === 'object' && item.value !== undefined) ? item.value : (typeof item === 'object' && item.min !== undefined ? `${item.min}-${item.max}` : item);
          const label = (typeof item === 'object' && item.label !== undefined) ? item.label : item;
          const count = (typeof item === 'object' && item.count !== undefined) ? item.count : null;
          const checked = (isRadio && typeof item === 'object' && item.default) ? 'checked' : '';
          const inputType = isRadio ? 'radio' : 'checkbox';
          const countHtml = count !== null ? `<span class="facet-count">${count}</span>` : '';

          return `
            <label class="filter-item">
              <div class="filter-item-main">
                <input type="${inputType}" name="${attributeName}" value="${value}" ${checked}>
                <span>${label}</span>
              </div>
              ${countHtml}
            </label>
          `;
        }).join('')}
      </div>
    </details>
  `;

  const newContainer = document.getElementById(facetId);
  if (newContainer) {
    if (newContainer.tagName === 'DETAILS') {
      newContainer.open = false;
    }
    newContainer.addEventListener('change', (event) => {
      if (event.target.tagName === 'INPUT') {
        if (attributeName === 'players') {
          const selectedValue = event.target.value;
          const mainValue = selectedValue.split('-')[0];

          const allPlayerLabels = newContainer.querySelectorAll('label.filter-item[data-level]');
          allPlayerLabels.forEach(label => {
            const level = parseInt(label.dataset.level, 10);
            if (level > 0) {
              if (label.dataset.parentValue === mainValue) {
                label.style.display = 'flex';
              } else {
                label.style.display = 'none';
              }
            }
          });
        }
        handleFilterChange(attributeName, event.target.value, event.target.checked, isRadio);
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
      dropdownContent.style.maxHeight = `${Math.min(availableHeight, 385)}px`;
    };

    newContainer.addEventListener('toggle', function(event) {
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
      summary.addEventListener('click', function(e) {
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

// =============================================================================
// URL State Management
// =============================================================================

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

    if (state.selectedPlayerFilter && state.selectedPlayerFilter !== 'any') {
        const mainValue = state.selectedPlayerFilter.split('-')[0];
        const allPlayerLabels = document.querySelectorAll('#facet-players label.filter-item[data-level]');
        allPlayerLabels.forEach(label => {
            const level = parseInt(label.dataset.level, 10);
            if (level > 0) {
                label.style.display = label.dataset.parentValue === mainValue ? 'flex' : 'none';
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
  clearContainer.innerHTML = `
    <button id="clear-filters" class="clear-button">Clear filters</button>
  `;
  clearContainer.style.display = 'none';

  document.getElementById('clear-filters').addEventListener('click', clearAllFilters);
}

function handleFilterChange(attributeName, value, isChecked, isRadio) {
  // This function is called when a filter input changes.
  // It triggers a re-application of all filters.
  // The parameters (attributeName, value, isChecked, isRadio) are passed from the event listener
  // but applyFilters() currently re-reads all filter states from the DOM, so they are not directly used here.
  onFilterChange();
}

function handleSearch() {
  onFilterChange();
}

function handleSort() {
  onFilterChange();
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
    // Text search
    if (query && !game.name.toLowerCase().includes(query) &&
      !game.description.toLowerCase().includes(query)) {
      return false;
    }

    // Category filter
    if (selectedCategories.length > 0 &&
      !selectedCategories.some(cat => game.categories.includes(cat))) {
      return false;
    }

    // Mechanics filter
    if (selectedMechanics.length > 0 &&
      !selectedMechanics.some(mech => game.mechanics.includes(mech))) {
      return false;
    }

    // Players filter
    if (selectedPlayerFilter && selectedPlayerFilter !== 'any') {
      const targetPlayers = Number(selectedPlayerFilter);

      if (!isNaN(targetPlayers)) {
        const match = game.players.some(([count, type]) => {
          if (!count) return false;
          const {
            min,
            max
          } = parsePlayerCount(count);
          return targetPlayers >= min && targetPlayers <= max;
        });

        if (!match) {
          return false;
        }
      }
    }

    // Weight filter
    if (selectedWeight.length > 0 && !selectedWeight.includes(game.weight)) {
      return false;
    }

    // Playing time filter
    if (selectedPlayingTime.length > 0 && !selectedPlayingTime.includes(game.playing_time)) {
      return false;
    }

    // Previous players filter
    if (selectedPreviousPlayers.length > 0 &&
      !selectedPreviousPlayers.some(player => game.previous_players.includes(player))) {
      return false;
    }

    // Min age filter
    if (selectedMinAge && (game.min_age < selectedMinAge.min || game.min_age > selectedMinAge.max)) {
      return false;
    }

    // Number of plays filter
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

      if (newCount === 0 && !input.checked && !showZero) {
        item.style.display = 'none';
      } else {
        item.style.display = 'flex';
      }
    }
  });
}

function updateAllFilterCounts(filters) {
  // --- Categories ---
  const catFilters = { ...filters,
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

  // --- Mechanics ---
  const mechFilters = { ...filters,
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

  // --- Players ---
  const playerFilters = { ...filters,
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
  updateCountsInDOM('facet-players', playerCounts, true); // Show zero for players

  // --- Weight ---
  const weightFilters = { ...filters,
    selectedWeight: []
  };
  const gamesForWeightCount = filterGames(allGames, weightFilters);
  const weightCounts = {};
  gamesForWeightCount.forEach(game => {
    if (game.weight) {
      weightCounts[game.weight] = (weightCounts[game.weight] || 0) + 1;
    }
  });
  updateCountsInDOM('facet-weight', weightCounts);

  // --- Playing Time ---
  const playingTimeFilters = { ...filters,
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

  // --- Min Age ---
  const minAgeFilters = { ...filters,
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

  // --- Previous Players ---
  const prevPlayersFilters = { ...filters,
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

  // --- Num Plays ---
  const numPlaysFilters = { ...filters,
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
  updateAllFilterCounts(filters);

  filteredGames = filterGames(allGames, filters);

  // Sort the results
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
    container.innerHTML = '<div class="no-results">No games found matching your criteria.</div>';
    updatePagination();
    return;
  }

  // Render games in a grid
  container.innerHTML = `
    <div class="game-grid">
      ${pageGames.map(game => renderGameCard(game)).join('')}
    </div>
  `;

  on_render();
  updatePagination();
}

function renderGameCard(game) {
  return `
    <details class="game-card" data-color="${game.color || '255,255,255'}">
      <summary>
        <img src="${game.image}" alt="${game.name}">
      </summary>
      <div class="game-details">
        <!-- Header Section with Cover Image and Title -->
        <div class="card-header">
          <div class="cover-image">
            <img src="${game.image}" alt="${game.name}">
          </div>
          <div class="title-section">
            <h1 class="game-title">${highlightText(game.name, getCurrentSearchQuery())}</h1>
            <div class="subtitle">${formatPlayerCountShort(game.players)} players · ${game.playing_time || 'Unknown time'}</div>
          </div>
          <button class="close-button"><span class="material-symbols-rounded">close</span></button>
        </div>

        <!-- Stats Bar -->
        <div class="stats-bar">
          ${game.rank ? `<div class="stat-item"><span class="material-symbols-rounded">leaderboard</span> ${game.rank}</div>` : ''}
          ${game.rating ? `<div class="stat-item"><span class="material-symbols-rounded">star</span> ${game.rating.toFixed(1)}</div>` : ''}
          ${game.playing_time ? `<div class="stat-item"><span class="material-symbols-rounded">schedule</span> ${game.playing_time}</div>` : ''}
          ${game.players.length > 0 ? `<div class="stat-item"><span class="material-symbols-rounded">groups</span> ${formatPlayerCountShort(game.players)}</div>` : ''}
          ${game.min_age ? `<div class="stat-item"><span class="material-symbols-rounded">child_care</span> ${game.min_age}+</div>` : ''}
        </div>

        <!-- Description Section -->
        <div class="description-section">
          <div class="teaser-text" data-full-text="${escapeHtml(game.description || '')}">
            ${game.description ? getTeaserText(game.description, true) : 'No description available.'}
          </div>
        </div>

        <!-- Tags Section -->
        <div class="tags-section">
          ${formatGameTags(game)}
        </div>

        <!-- Bottom Info Section -->
        <div class="bottom-info">
          <div class="info-group">
            <div class="rating-section">
              ${renderStarRating(game.rating)} Rate
            </div>
            <div class="plays-section">
              <span class="material-symbols-rounded">play_arrow</span> ${game.numplays || 0} plays
            </div>
          </div>
        </div>

        <!-- BGG Link Footer -->
        <div class="bgg-footer">
          <a href="https://boardgamegeek.com/boardgame/${game.id}" target="_blank" class="bgg-link">
            View full page on BoardGameGeek →
          </a>
        </div>
      </div>
    </details>
  `;
}

// Helper function to format game tags with count limit
function formatGameTags(game) {
  const mechanics = game.mechanics.slice(0, 3);
  const categories = game.categories.slice(0, 3);
  const allTags = [...mechanics, ...categories];
  const remainingCount = (game.mechanics.length + game.categories.length) - allTags.length;

  let tagsHtml = allTags.join(' · ');
  if (remainingCount > 0) {
    tagsHtml += ` +${remainingCount}`;
  }

  return tagsHtml;
}

function formatPlayerCount(players) {
  return players.map(([count, type]) => {
    const suffix = type === 'best' ? ' (best)' : type === 'recommended' ? ' (rec.)' : '';
    return count + suffix;
  }).join(', ');
}

function formatPlayerCountShort(players) {
  // Return just the range for quick stats, e.g., "2-4"
  if (players.length === 0) return '';
  if (players.length === 1) return players[0][0];

  const minPlayers = Math.min(...players.map(p => parseInt(p[0])));
  const maxPlayers = Math.max(...players.map(p => parseInt(p[0])));

  return `${minPlayers}${minPlayers !== maxPlayers ? `-${maxPlayers}` : ''}`;
}

function getTeaserText(description, hasMore = false) {
  if (!description) return '';
  const sentences = description.split(/[.!?]+/);
  const teaser = sentences.slice(0, 2).join('. ');
  const needsMore = description.length > 200 || sentences.length > 2;
  const truncated = teaser.length > 200 ? teaser.substring(0, 200) + '...' : teaser + (sentences.length > 2 ? '...' : '');

  if (hasMore && needsMore) {
    return truncated + ' <button class="more-button" onclick="handleMoreButtonClick(this)">more</button>';
  }
  return truncated;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderComplexityGaugeSmall(complexityScore) {
  const filled = Math.round(complexityScore / 2);
  const empty = 5 - filled;
  return `
    <div class="complexity-gauge-small">
      ${'★'.repeat(filled).split('').map((s, i) => `<span class="star material-symbols-rounded filled" style="color: #f39c12;" aria-hidden="true">${s}</span>`).join('')}
      ${'☆'.repeat(empty).split('').map((s, i) => `<span class="star material-symbols-rounded" style="color: #ccc;" aria-hidden="true">${s}</span>`).join('')}
    </div>
  `;
}

function getComplexityScore(weight) {
  const weightMap = {
    'Light': 1.5,
    'Light Medium': 2.2,
    'Medium': 3.0,
    'Medium Heavy': 3.8,
    'Heavy': 4.5
  };
  return weightMap[weight] || null;
}

function renderStarRating(rating) {
  if (!rating) return '';

  const stars = Math.round(rating / 2); // Convert 10-point to 5-star scale
  return `
    <div class="star-display">
      ${Array.from({length: 5}, (_, i) =>
        `<span class="star material-symbols-rounded ${i < stars ? 'filled' : ''}">${i < stars ? 'star' : 'star_border'}</span>`
      ).join('')}
    </div>
  `;
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

function updatePagination() {
  const container = document.getElementById('pagination');
  const totalPages = Math.ceil(filteredGames.length / GAMES_PER_PAGE);

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let paginationHTML = '<div class="pagination">';

  // Previous button
  if (currentPage > 1) {
    paginationHTML += `<button onclick="goToPage(${currentPage - 1})">‹ Previous</button>`;
  }

  // Page numbers (show max 5 pages around current)
  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, currentPage + 2);

  if (startPage > 1) {
    paginationHTML += `<button onclick="goToPage(1)">1</button>`;
    if (startPage > 2) paginationHTML += '<span>...</span>';
  }

  for (let i = startPage; i <= endPage; i++) {
    const isCurrentPage = i === currentPage;
    paginationHTML += `<button onclick="goToPage(${i})" ${isCurrentPage ? 'class="current"' : ''}>${i}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) paginationHTML += '<span>...</span>';
    paginationHTML += `<button onclick="goToPage(${totalPages})">${totalPages}</button>`;
  }

  // Next button
  if (currentPage < totalPages) {
    paginationHTML += `<button onclick="goToPage(${currentPage + 1})">Next ›</button>`;
  }

  paginationHTML += '</div>';
  container.innerHTML = paginationHTML;
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

function parsePlayerCount(countStr) {
  if (!countStr) return {
    min: 0,
    max: 0
  };

  if (countStr.includes('-')) {
    const parts = countStr.split('-').map(Number);
    // Basic validation
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return {
        min: parts[0],
        max: parts[1]
      };
    }
  }
  if (countStr.includes('+')) {
    const min = Number(countStr.replace('+', ''));
    if (!isNaN(min)) {
      return {
        min: min,
        max: Infinity
      };
    }
  }
  const num = Number(countStr);
  if (!isNaN(num)) {
    return {
      min: num,
      max: num
    };
  }
  // Return a non-matching range if parsing fails
  return {
    min: 0,
    max: 0
  };
}


// Utility functions
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
  // Formula for luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  // Return black for light colors, white for dark colors
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
}

// Function to position popup based on click position within tile
function positionPopupInViewport(popup, trigger, clickEvent = null) {
  const triggerRect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const margin = 8; // Margin from viewport edges

  // Reset temporary styles that might affect dimensions, to get natural popup size
  popup.style.height = '';
  popup.style.overflowY = '';
  // Note: We get popupRect once, assuming its content defines its natural size.
  const popupRect = popup.getBoundingClientRect();

  console.log('Positioning popup (using natural dimensions):', {
    triggerRect,
    popupRect,
    clickEvent: clickEvent ? { x: clickEvent.clientX, y: clickEvent.clientY } : 'none' // clickEvent currently unused
  });

  // 1. Calculate Desired Absolute Positions for Centering
  let desiredAbsoluteLeft = triggerRect.left + (triggerRect.width - popupRect.width) / 2;
  let desiredAbsoluteTop = triggerRect.top + (triggerRect.height - popupRect.height) / 2;

  // Initialize current absolute positions with desired centered positions
  let currentAbsoluteLeft = desiredAbsoluteLeft;
  let currentAbsoluteTop = desiredAbsoluteTop;

  // 2. Adjust Horizontal Position to Stay Within Viewport
  if (currentAbsoluteLeft < margin) {
    currentAbsoluteLeft = margin;
  } else if (currentAbsoluteLeft + popupRect.width > viewportWidth - margin) {
    currentAbsoluteLeft = viewportWidth - margin - popupRect.width;
    // If popup is wider than viewport, ensure it's still pinned to the left margin
    if (currentAbsoluteLeft < margin) {
        currentAbsoluteLeft = margin;
    }
  }

  // 3. Adjust Vertical Position to Stay Within Viewport
  if (currentAbsoluteTop < margin) {
    currentAbsoluteTop = margin;
  } else if (currentAbsoluteTop + popupRect.height > viewportHeight - margin) {
    currentAbsoluteTop = viewportHeight - margin - popupRect.height;
    // If popup is taller than viewport, ensure it's still pinned to the top margin
    if (currentAbsoluteTop < margin) {
        currentAbsoluteTop = margin;
    }
  }

  // 4. Handle Height Constraints and Scrolling if Popup is Taller than Viewport
  const availableViewportHeight = viewportHeight - 2 * margin;
  if (popupRect.height > availableViewportHeight) {
    popup.style.height = availableViewportHeight + 'px';
    popup.style.overflowY = 'auto';
    // If made scrollable due to viewport height constraint, always align its top with the viewport's top margin.
    currentAbsoluteTop = margin;
  } else {
    // Ensure styles are reset if not scrollable (already done at the start, but good for clarity)
    // popup.style.height = ''; // Already reset
    // popup.style.overflowY = ''; // Already reset
  }

  // Convert final absolute positions to style values (relative to the trigger's containing block)
  // Assuming popup.style.left and popup.style.top are relative to triggerRect's origin.
  const finalLeftStyle = currentAbsoluteLeft - triggerRect.left;
  const finalTopStyle = currentAbsoluteTop - triggerRect.top;

  console.log('Final style positions (relative to trigger):', { left: finalLeftStyle, top: finalTopStyle });

  // Apply the calculated position and styles
  popup.style.left = finalLeftStyle + 'px';
  popup.style.top = finalTopStyle + 'px';
}

// Event handlers for collapsible panels
function on_render() {
  // Apply background colors to both game cards and popup details
  const gameCards = document.querySelectorAll(".game-card");
  gameCards.forEach(function(card) {
    const color = card.getAttribute("data-color") || "255,255,255"; // Default to white if no color
    const textColor = getTextColorForBg(color);

    // Apply semi-transparent color to the game card tile
    card.style.backgroundColor = `rgba(${color}, 0.5)`;

    const gameDetails = card.querySelector(".game-details");
    if (gameDetails) {
      // Reset background for the main details container to default (white)
      gameDetails.style.backgroundColor = '#FFFFFF';

      // Apply solid color to the popup header and set text color for contrast
      const cardHeader = card.querySelector(".card-header");
      if (cardHeader) {
        cardHeader.style.backgroundColor = `rgb(${color})`;
        cardHeader.style.color = textColor;

        // Also apply to close button if it's inside the header
        const closeBtn = cardHeader.querySelector('.close-button');
        if (closeBtn) {
            closeBtn.style.color = textColor;
        }
      }

      // Apply a light version of the game color to the stats bar and its icons
      const statsBar = card.querySelector(".stats-bar");
      if (statsBar) {
        statsBar.style.backgroundColor = `rgba(${color}, 0.1)`;
        const statIcons = statsBar.querySelectorAll(".material-symbols-rounded");
        statIcons.forEach(icon => {
            icon.style.color = `rgb(${color})`;
        });
      }

      // Apply game color to the play icon and filled stars
      const bottomInfo = card.querySelector(".bottom-info");
      if(bottomInfo) {
        const playIcon = bottomInfo.querySelector(".plays-section .material-symbols-rounded");
        if(playIcon) playIcon.style.color = `rgb(${color})`;

        const stars = bottomInfo.querySelectorAll(".rating-section .star.filled");
        stars.forEach(star => {
            star.style.color = `rgb(${color})`;
        });
      }

      // Apply a light version of the game color to the footer and its link
      const bggFooter = card.querySelector(".bgg-footer");
      if (bggFooter) {
        bggFooter.style.backgroundColor = `rgb(${color})`;
        const bggLink = bggFooter.querySelector(".bgg-link");
        if(bggLink) {
            bggLink.style.color = textColor;
        }
      }
    }
  });

  // Setup collapsible details
  setupGameDetails();
}

function setupGameDetails() {
  const summaries = document.querySelectorAll("summary");
  summaries.forEach(function(elem) {
    function conditionalClose(event) {
      closeAllDetails();
      if (!elem.parentElement.hasAttribute("open")) {
        const gameDetails = elem.parentElement.querySelector(".game-details");
        if (gameDetails) {
          gameDetails.focus();
          // Position the popup based on click position within tile
          requestAnimationFrame(() => {
            positionPopupInViewport(gameDetails, elem, event);
          });
        }
      }
    }
    elem.addEventListener("click", conditionalClose);
      });

  const gameDetails = document.querySelectorAll(".game-details");
  gameDetails.forEach(function(elem) {
    let closeButton = elem.querySelector('.close-button');

    function closeDetails(event) {
      elem.parentElement.removeAttribute("open");
      event.stopPropagation();
    }

    if (closeButton) {
      closeButton.addEventListener("click", closeDetails);
      closeButton.addEventListener("keypress", closeDetails);
    }

    elem.addEventListener("click", function(event) {
      event.stopPropagation();
    });
  });

}

function closeAllDetails() {
  const openDetails = document.querySelectorAll("details[open]");
  openDetails.forEach(function(elem) {
    elem.removeAttribute("open");
  });
}

// Debounce function to limit how often a function can execute
function debounce(func, delay) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), delay);
  };
}

function closeAll(event) {
  closeAllDetails();
}

// Global click handler to close details
document.addEventListener("click", closeAll);

// Initialize the application
function init(settings) {
  console.log('Initializing mybgg SQLite app...');
  initializeDatabase(settings);
}

// Load configuration and start the app
loadJSON('./config.json', function(settings) {
  console.log('Settings loaded:', settings);
  init(settings);
});
