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
           numplays, image, tags, previous_players, expansions
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
  console.log(`Loaded ${allGames.length} games`);
}

function initializeUI() {
  setupSearchBox();
  setupFilters();
  setupSorting();
  updateResults();
  updateStats();
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
    <select id="sort-select">
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
  const categories = new Set();
  allGames.forEach(game => {
    game.categories.forEach(cat => categories.add(cat));
  });

  createRefinementFilter('facet-categories', 'Categories', Array.from(categories).sort(), 'categories');
}

function setupMechanicsFilter() {
  const mechanics = new Set();
  allGames.forEach(game => {
    game.mechanics.forEach(mech => mechanics.add(mech));
  });

  createRefinementFilter('facet-mechanics', 'Mechanics', Array.from(mechanics).sort(), 'mechanics');
}

function setupPlayersFilter() {
  const playerCounts = new Set();
  allGames.forEach(game => {
    game.players.forEach(([count, type]) => {
      playerCounts.add(count);
    });
  });

  const sortedCounts = Array.from(playerCounts).sort((a, b) => {
    const numA = parseInt(a.replace('+', ''));
    const numB = parseInt(b.replace('+', ''));
    return numA - numB;
  });

  createRefinementFilter('facet-players', 'Number of players', sortedCounts, 'players');
}

function setupWeightFilter() {
  const weights = ['Light', 'Light Medium', 'Medium', 'Medium Heavy', 'Heavy'];
  createRefinementFilter('facet-weight', 'Complexity', weights, 'weight');
}

function setupPlayingTimeFilter() {
  const times = ['< 30min', '30min - 1h', '1-2h', '2-3h', '3-4h', '> 4h'];
  createRefinementFilter('facet-playing-time', 'Playing time', times, 'playing_time');
}

function setupMinAgeFilter() {
  const ageRanges = [
    { label: 'Any age', min: 0, max: 100, default: true },
    { label: '< 5 years', min: 0, max: 4 },
    { label: '< 7 years', min: 0, max: 6 },
    { label: '< 9 years', min: 0, max: 8 },
    { label: '< 11 years', min: 0, max: 10 },
    { label: '< 13 years', min: 0, max: 12 },
    { label: '< 15 years', min: 0, max: 14 },
    { label: '15+', min: 15, max: 100 }
  ];
  createRefinementFilter('facet-min-age', 'Min age', ageRanges, 'min_age', true);
}

function setupPreviousPlayersFilter() {
  const players = new Set();
  allGames.forEach(game => {
    game.previous_players.forEach(player => players.add(player));
  });

  createRefinementFilter('facet-previous-players', 'Previous players', Array.from(players).sort(), 'previous_players');
}

function setupNumPlaysFilter() {
  const playRanges = [
    { label: 'Any', min: 0, max: 9999, default: true },
    { label: 'Unplayed (0)', min: 0, max: 0 },
    { label: '1-5 plays', min: 1, max: 5 },
    { label: '6-10 plays', min: 6, max: 10 },
    { label: '11+ plays', min: 11, max: 9999 }
  ];
  createRefinementFilter('facet-numplays', 'Number of plays', playRanges, 'numplays', true);
}

function createRefinementFilter(facetId, title, items, attributeName, isRadio = false) {
  const container = document.getElementById(facetId);
  if (!container) return;

  // Use <details> and <summary> for collapse/expand
  container.outerHTML = `
    <details class="facet-group" id="${facetId}">
      <summary>${title}</summary>
      <div class="panel-container"> <!-- ADDED WRAPPER -->
        <div class="panel-body">
          ${items.map(item => {
            const value = typeof item === 'object' ? `${item.min}-${item.max}` : item;
            const label = typeof item === 'object' ? item.label : item;
            const checked = (isRadio && (typeof item === 'object' ? item.default : false)) ? 'checked' : '';
            const inputType = isRadio ? 'radio' : 'checkbox';
            return `
              <label class="filter-item">
                <input type="${inputType}" name="${attributeName}" value="${value}" ${checked}>
                <span>${label}</span>
              </label>
            `;
          }).join('')}
        </div>
      </div>
    </details>
  `;

  // Add event listener to the new details element
  const newContainer = document.getElementById(facetId);
  if (newContainer) {
    if (newContainer.tagName === 'DETAILS') {
      newContainer.open = false; // Ensure all filters start collapsed
    }
    newContainer.addEventListener('change', (event) => {
      // If it's a details element, the change event is on the input inside
      if (event.target.tagName === 'INPUT') {
        handleFilterChange(attributeName, event.target.value, event.target.checked, isRadio);
      }
    });

    // JavaScript to handle overlay positioning for this specific filter when opened
    newContainer.addEventListener('toggle', function(event) {
      const panelBody = this.querySelector('.panel-body');
      const summaryElement = this.querySelector('summary');
      if (!panelBody || !summaryElement) return;

      if (this.open) {
        // Position the dropdown as fixed below the summary
        const rect = summaryElement.getBoundingClientRect();
        panelBody.style.position = 'fixed';
        panelBody.style.top = `${rect.bottom}px`;
        panelBody.style.left = `${rect.left}px`;
        panelBody.style.zIndex = '1050';
        panelBody.style.minWidth = `${rect.width}px`;
        panelBody.style.display = 'flex';
      } else {
        // Restore default styles
        panelBody.style.position = '';
        panelBody.style.top = '';
        panelBody.style.left = '';
        panelBody.style.zIndex = '';
        panelBody.style.minWidth = '';
        panelBody.style.display = '';
      }
    });

    // Ensure clicking the summary when open closes the dropdown
    const summary = newContainer.querySelector('summary');
    if (summary) {
      summary.addEventListener('click', function(e) {
        const details = this.parentElement;
        if (details.open) {
          // Prevent default so it doesn't immediately re-open
          e.preventDefault();
          details.open = false;
        }
      });
    }
  }
}

function setupClearAllButton() {
  const clearContainer = document.getElementById('clear-all');
  clearContainer.innerHTML = `
    <button id="clear-filters" class="clear-button">Clear all filters</button>
  `;

  document.getElementById('clear-filters').addEventListener('click', clearAllFilters);
}

function handleFilterChange(attributeName, value, isChecked, isRadio) {
  // This function is called when a filter input changes.
  // It triggers a re-application of all filters.
  // The parameters (attributeName, value, isChecked, isRadio) are passed from the event listener
  // but applyFilters() currently re-reads all filter states from the DOM, so they are not directly used here.
  applyFilters();
}

function handleSearch(event) {
  const query = event.target.value.toLowerCase().trim();
  applyFilters(query);
}

function handleSort(event) {
  const sortBy = event.target.value;

  filteredGames.sort((a, b) => {
    switch (sortBy) {
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

  currentPage = 1;
  updateResults();
}

function applyFilters(searchQuery = null) {
  const query = searchQuery !== null ? searchQuery :
    (document.getElementById('search-input')?.value.toLowerCase().trim() || '');

  // Get selected filters
  const selectedCategories = getSelectedValues('categories');
  const selectedMechanics = getSelectedValues('mechanics');
  const selectedPlayers = getSelectedValues('players');
  const selectedWeight = getSelectedValues('weight');
  const selectedPlayingTime = getSelectedValues('playing_time');
  const selectedPreviousPlayers = getSelectedValues('previous_players');
  const selectedMinAge = getSelectedRange('min_age');
  const selectedNumPlays = getSelectedRange('numplays');

  filteredGames = allGames.filter(game => {
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
    if (selectedPlayers.length > 0 &&
        !selectedPlayers.some(player =>
          game.players.some(([count]) => count === player))) {
      return false;
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

  currentPage = 1;
  updateResults();
  updateStats();
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

function handleMinAgeFilter() {
  applyFilters();
}

function handleNumPlaysFilter() {
  applyFilters();
}

function clearAllFilters() {
  // Clear text search
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';

  // Clear all checkboxes
  document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);

  // Reset radio buttons to "Any" options
  document.querySelectorAll('input[name="min_age"][value="0-100"]').forEach(radio => radio.checked = true);
  document.querySelectorAll('input[name="numplays"][value="0-9999"]').forEach(radio => radio.checked = true);

  // Reset sort to name
  const sortSelect = document.getElementById('sort-select');
  if (sortSelect) sortSelect.value = 'name';

  filteredGames = [...allGames];
  currentPage = 1;
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
    <details class="game-wrapper">
      <summary>
        <div class="game">
          <img src="${game.image}" alt="${game.name}" data-maincolor="128,128,128">
        </div>
      </summary>
      <div class="game-details">
        <h2 class="heading">
          <a href="https://boardgamegeek.com/boardgame/${game.id}">
            ${highlightText(game.name, getCurrentSearchQuery())}
          </a>
        </h2>

        <section class="description">
          ${game.description ? truncateText(game.description, 300) : 'No description available.'}
        </section>

        <section class="metadata">
          ${game.categories.length > 0 ? `<div><strong>Categories:</strong> ${game.categories.join(', ')}</div>` : ''}
          ${game.mechanics.length > 0 ? `<div><strong>Mechanics:</strong> ${game.mechanics.join(', ')}</div>` : ''}
          ${game.players.length > 0 ? `<div><strong>Players:</strong> ${formatPlayerCount(game.players)}</div>` : ''}
          ${game.weight ? `<div><strong>Complexity:</strong> ${game.weight}</div>` : ''}
          ${game.playing_time ? `<div><strong>Playing time:</strong> ${game.playing_time}</div>` : ''}
          ${game.min_age ? `<div><strong>Min age:</strong> ${game.min_age}+</div>` : ''}
          ${game.rank ? `<div><strong>BGG Rank:</strong> ${game.rank}</div>` : ''}
          ${game.rating ? `<div><strong>Rating:</strong> ${game.rating.toFixed(1)}/10</div>` : ''}
          ${game.numplays !== undefined ? `<div><strong>Times played:</strong> ${game.numplays}</div>` : ''}
          ${game.previous_players.length > 0 ? `<div><strong>Played with:</strong> ${game.previous_players.join(', ')}</div>` : ''}
        </section>
      </div>
    </details>
  `;
}

function formatPlayerCount(players) {
  return players.map(([count, type]) => {
    const suffix = type === 'best' ? ' (best)' : type === 'recommended' ? ' (rec.)' : '';
    return count + suffix;
  }).join(', ');
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

  let statsText = `${totalGames.toLocaleString()} games`;
  if (totalGames !== totalAllGames) {
    statsText += ` of ${totalAllGames.toLocaleString()}`;
  }

  statsContainer.textContent = statsText;
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
  updateResults();
  window.scrollTo({ top: 0, behavior: 'smooth' });
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

// Event handlers for collapsible panels
function on_render() {
  // Apply background colors based on image (simplified version)
  const hits = document.querySelectorAll(".game img");
  hits.forEach(function(img) {
    const gameWrapper = img.closest('.game-wrapper');
    if (gameWrapper) {
      const color = img.getAttribute("data-maincolor") || "128,128,128";
      gameWrapper.style.background = `rgba(${color}, 0.1)`;
    }
  });

  // Setup collapsible details
  setupGameDetails();
  setupPanelToggles();
}

function setupGameDetails() {
  const summaries = document.querySelectorAll("summary");
  summaries.forEach(function(elem) {
    function conditionalClose() {
      closeAllDetails();
      if (!elem.parentElement.hasAttribute("open")) {
        const gameDetails = elem.parentElement.querySelector(".game-details");
        if (gameDetails) gameDetails.focus();
      }
    }
    elem.addEventListener("click", conditionalClose);
    elem.addEventListener("keypress", conditionalClose);
  });

  const gameDetails = document.querySelectorAll(".game-details");
  gameDetails.forEach(function(elem) {
    let closeButton = elem.querySelector('.close');
    if (!closeButton) {
      closeButton = document.createElement("div");
      closeButton.className = "close";
      closeButton.setAttribute("tabindex", "0");
      closeButton.innerHTML = "×";
      elem.appendChild(closeButton);
    }

    function closeDetails(event) {
      elem.parentElement.removeAttribute("open");
      event.stopPropagation();
    }

    closeButton.addEventListener("click", closeDetails);
    closeButton.addEventListener("keypress", closeDetails);

    elem.addEventListener("click", function(event) {
      event.stopPropagation();
    });
  });
}

function setupPanelToggles() {
  const toggles = document.querySelectorAll('.panel-toggle');
  toggles.forEach(toggle => {
    toggle.addEventListener('click', function() {
      const panel = this.closest('.panel');
      const body = panel.querySelector('.panel-body');
      const isCollapsed = body.style.display === 'none';

      body.style.display = isCollapsed ? 'block' : 'none';
      this.textContent = isCollapsed ? '−' : '+';
    });
  });
}

function closeAllDetails() {
  const details = document.querySelectorAll("details");
  details.forEach(function(detailsElem) {
    if (detailsElem.hasAttribute("open")) {
      detailsElem.removeAttribute("open");
    }
  });
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
