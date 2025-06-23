# MyBGG - View and filter your boardgame collection

_This project i   ⚠️ **Important**: Make sure your TOML is valid! Common mistakes:
   - Forgetting quotes around strings with spaces or special characters
   - Using the wrong quote type (use double quotes for strings)
   - Forgetting to escape backslashes in Windows pathsant to be forked. The original project is available here: https://github.com/EmilStenstrom/mybgg_

Create a beautiful, searchable website for your BoardGameGeek collection! This project downloads your games from BoardGameGeek, creates a database, and automatically hosts it as a website using GitHub Pages.

![Site preview](mybgg-preview.png)

**What you'll get:**
- A searchable website of your board game collection
- Automatic filtering by players, time, weight, categories, and more
- Rich game details from BoardGameGeek (ratings, descriptions, mechanics)
- Mobile-friendly design that works offline
- Automatic updates when you run the script again

## Quick Start Checklist

- [ ] **Fork this repository** to your GitHub account
- [ ] **Edit config.toml** with your BGG and GitHub usernames  
- [ ] **Enable GitHub Pages** in your repository settings
- [ ] **Install Python dependencies**: `pip install -r scripts/requirements.txt`
- [ ] **Validate setup**: `python scripts/validate_setup.py`
- [ ] **Generate database**: `python scripts/download_and_index.py --cache_bgg`
- [ ] **Visit your site**: `https://YOUR_USERNAME.github.io/mybgg`
- [ ] **Optional: Check website**: `python scripts/check_website.py`

💡 **New to this?** Follow the detailed instructions below.

## Requirements

* [GitHub](https://github.com) account (free). We will store and share your database using GitHub Releases.
* [BoardGameGeek](https://boardgamegeek.com) account (free). We will fetch all your games and game metadata from here.
* Computer with Python 3.8+ installed.

## Getting started

1. **Fork this project** (EmilStenstrom/mybgg) to your own GitHub account.
   <details>
      <summary>Details</summary>
      Forking a project copies it to your own GitHub account. On the top of this page, click the "Fork" button and accept all the defaults. You now have a copy of this project you can make changes to.
   </details>

2. **Update the config.toml file** with your details:
   
   **Easy way (recommended)**: Edit directly on GitHub:
   * Go to your forked repository on GitHub
   * Click on `config.toml`
   * Click the pencil icon (✏️) to edit
   * Replace `YOUR_NAME` with your name (for the website title)
   * Replace `YOUR_BGG_USERNAME` with your BoardGameGeek username  
   * Replace `YOUR_GITHUB_USERNAME` with your GitHub username
   * Scroll down and click **"Commit changes"**
   
   **Example**: If your name is John, BGG username is `johnsmith`, and GitHub username is `johnsmith123`:
   ```toml
   # MyBGG Configuration
   # Only edit the values below

   title = "John's boardgames"
   bgg_username = "johnsmith"
   github_repo = "johnsmith123/mybgg"
   ```

   ⚠️ **Important**: Make sure your TOML is valid! Common mistakes:
   - Missing commas between lines
   - Extra commas after the last item  
   - Using single quotes instead of double quotes

   **How to find your BGG username**: It's in your BoardGameGeek profile URL. For example, if your profile is `https://boardgamegeek.com/user/johnsmith`, your username is `johnsmith`.

   <details>
      <summary>Alternative: Edit on your computer</summary>

      * Clone your forked project: `git clone https://github.com/YOUR_USERNAME/mybgg.git`
      * Edit the `config.toml` file
      * Commit and push your changes:
      ```bash
      git add config.toml
      git commit -m "Update config.toml with my details"
      git push
      ```
   </details>

3. **Enable GitHub Pages** to host your website:
   <details>
      <summary>Step-by-step instructions</summary>

      * Go to your forked repository on GitHub
      * Click the **Settings** tab (at the top of your repository page)
      * Scroll down to **Pages** in the left sidebar and click it
      * Under "Source", select **Deploy from a branch**
      * Under "Branch", choose **main** (or **master** if you don't see main)
      * Leave the folder as **/ (root)**
      * Click **Save**
      
      **Verification**: You should see a green checkmark and a message like "Your site is published at https://YOUR_USERNAME.github.io/mybgg". This might take a few minutes to appear.

      ⏰ **Note**: GitHub Pages can take 5-10 minutes to activate. Your website will be available at: `https://YOUR_USERNAME.github.io/mybgg` (after you generate your database in step 5)
   </details>

4. **Install the required Python libraries**:
   ```bash
   pip install -r scripts/requirements.txt
   ```

   <details>
      <summary>Python installation help</summary>

      **If you don't have Python installed:**
      * Download Python 3.8+ from https://python.org
      * During installation, make sure to check "Add Python to PATH"
      * Restart your terminal/command prompt after installing

      **If the command above doesn't work, try:**
      * `pip3 install -r scripts/requirements.txt`
      * `python -m pip install -r scripts/requirements.txt`
      * `python3 -m pip install -r scripts/requirements.txt`

      **Verification**: You should see messages about packages being installed successfully. If you see "Successfully installed..." at the end, you're good to go!
   </details>

5. **Validate your setup** (optional but recommended):
   ```bash
   python scripts/validate_setup.py
   ```

   This checks that your config.json is valid, your BGG username exists, and all Python dependencies are installed. If everything looks good, proceed to step 6!

6. **Generate your database**:
   ```bash
   python scripts/download_and_index.py --cache_bgg
   ```

   <details>
      <summary>What to expect</summary>

      **⏰ Time**: First run takes 5-15 minutes depending on your collection size  
      **🔍 Process**: The script will:
      1. Download all your games from BoardGameGeek (this is the slow part)
      2. Create a SQLite database with your games and their metadata
      3. Compress it to save space
      4. Ask you to authenticate with GitHub (opens browser)
      5. Upload it as a GitHub release

      **GitHub Authentication** (happens during step 4):
      * The script will print a URL and a device code
      * Your browser will open to GitHub
      * Enter the device code when prompted
      * Sign in to your GitHub account
      * Click "Authorize" to give permission
      * Return to your terminal - the upload will continue automatically

      **Success indicators**:
      * You'll see "Imported X games and Y expansions from boardgamegeek"
      * You'll see "Created SQLite database with X games and Y expansions"
      * You'll see "Successfully uploaded to GitHub: [URL]"
      * Your website will be available at: `https://YOUR_USERNAME.github.io/mybgg`

      **The `--cache_bgg` flag**: Makes subsequent runs much faster by caching BGG responses. Always use this unless you're debugging.
   </details>

## What to Expect

**First-time setup**: 15-30 minutes total
- Steps 1-4: 5-10 minutes (mostly waiting for downloads)
- Step 5 (validation): 30 seconds
- Step 6 (database generation): 5-15 minutes (depends on collection size)
- GitHub Pages activation: 5-15 minutes (happens automatically in background)

**Subsequent updates**: 2-5 minutes
- The `--cache_bgg` flag makes repeat runs much faster
- Only new/changed games are re-downloaded from BGG

**Collection sizes and timing**:
- Small collection (< 50 games): 2-5 minutes
- Medium collection (50-200 games): 5-10 minutes  
- Large collection (200+ games): 10-20 minutes

**What the script downloads**:
- Basic game information (name, year, players, etc.)
- Detailed metadata (categories, mechanics, descriptions)
- Ratings and rankings from BGG
- Game images (thumbnails)
- Your personal data (ratings, plays, comments)

## Troubleshooting

### Common Setup Issues

**"No games imported" error**:
- Check that your BGG username in `config.toml` is correct (no spaces, special characters)
- Make sure your BoardGameGeek collection is set to public ([BGG Collection Settings](https://boardgamegeek.com/collection/settings))
- Verify you have games marked as "owned" in your BGG collection
- Try the validation script: `python scripts/validate_setup.py`

**"pip not found" or "python not found"**:
- Make sure Python 3.8+ is installed from https://python.org
- On Windows: Make sure "Add Python to PATH" was checked during installation
- Try alternatives: `python3` instead of `python`, `pip3` instead of `pip`
- On Windows: Try `py -m pip install -r scripts/requirements.txt`

**GitHub authentication fails**:
- Make sure you're logged into GitHub in your browser
- Check your internet connection
- Clear your browser cache and try again
- Make sure popup blockers aren't preventing the GitHub page from opening

**Website shows "Loading database..." forever**:
- **Most common**: GitHub Pages isn't enabled yet → Go to Settings → Pages and enable it
- **Second most common**: Script hasn't been run yet → Run `python scripts/download_and_index.py --cache_bgg`
- Wait 10-15 minutes after enabling GitHub Pages (it takes time to activate)
- Check that the script said "Successfully uploaded to GitHub" when you ran it
- Try accessing your site in an incognito/private browser window (clears cache)

**TOML syntax error when editing config.toml**:
- Check that strings with spaces are properly quoted: `title = "John's boardgames"`
- Make sure section names are in square brackets: `[project]`
- Use [TOML Lint](https://www.toml-lint.com/) to validate your syntax
- TOML is more forgiving than JSON - no trailing commas to worry about!

### Less Common Issues

**Script runs but no games appear on website**:
- Check your BGG collection privacy settings (must be public)
- Make sure games are marked as "owned" in your BGG collection
- Try running without `--cache_bgg` to get fresh data: `python scripts/download_and_index.py`

**"Failed to fetch database" error on website**:
- The script upload might have failed - check for "Successfully uploaded" message
- GitHub releases might not be working - check your repository's Releases tab
- Try running the script again

**Website loads but search/filtering doesn't work**:
- Check browser console for JavaScript errors (F12 → Console tab)
- Try refreshing the page or clearing browser cache
- Make sure JavaScript is enabled in your browser

## Using your website

Once you've generated your database, you'll have a working website for browsing and searching your board game collection. The website:

* **Loads your data**: Fetches the SQLite database from your GitHub releases
* **Provides search**: Real-time search and filtering of your games
* **Shows game details**: Rich information from BoardGameGeek including ratings, descriptions, mechanics, etc.

To view your website:
- Go to: `https://YOUR_USERNAME.github.io/mybgg`
- Or view it locally by running `python -m http.server` and opening `http://localhost:8000`

## Working with the site locally

You can also run the website locally on your computer:

1. Start a local web server:
   ```bash
   python -m http.server
   ```

2. Open your browser to `http://localhost:8000`

This is useful for testing changes to the website before pushing them to GitHub.

## Updating your database

To update your database with new games or changed ratings:

1. Run the script again:
   ```bash
   python scripts/download_and_index.py --cache_bgg
   ```

2. A new release will be created automatically with the updated database

3. Your website will automatically use the new database (may take a few minutes)

**Optional**: Check that your website updated successfully:
```bash
python scripts/check_website.py
```

## Advanced usage

* **Skip GitHub upload** (for testing): Add `--no_upload` flag
* **Enable debug logging**: Add `--debug` flag  
* **Use custom config file**: Add `--config path/to/config.json`

## Updating this project

To get the latest features and bug fixes:

1. **Add the upstream remote** (first time only):
   ```bash
   git remote add upstream https://github.com/EmilStenstrom/mybgg.git
   ```

2. **Fetch and merge updates**:
   ```bash
   git fetch upstream
   git merge upstream/main
   ```

3. **Update dependencies**:
   ```bash
   pip install -r scripts/requirements.txt
   ```

4. **Push to your fork**:
   ```bash
   git push
   ```

## Credits

* Meeple icon (CC4 Attribution): https://icon-icons.com/icon/meeple/38522#256
* BoardGameGeek API for game data
* Mobile testing with: <a href="https://www.browserstack.com"><img src="https://raw.githubusercontent.com/EmilStenstrom/mybgg/master/Browserstack-logo@2x.png" height="25" alt="Browserstack" style="vertical-align: top"></a>
