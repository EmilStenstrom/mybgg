# MyBGG - Search and filter your boardgame collection

_This project is meant to be forked. The original project is available here: https://github.com/EmilStenstrom/mybgg_

Using this project, you can set up your own site for searching and filtering your boardgame collection. As an example, have a look at this: https://games.emilstenstrom.se

## Requirements

* [GitHub](https://github.com) account (free). We will serve the site using GitHub Pages.
* [Boardgamegeek](https://boardgamegeek.com) account (free). We will fetch all your games and game metadata from here.
* [Algolia](https://algolia.com) account (free). Used for creating and searching with lightning speed.
* Computer (not free) with Python 3.6+ installed.

## Getting your own site

1. **Fork this project** (EmilStenstrom/mybgg) to your own GitHub account.

2. **Update the config.json-file** with your account details for Boardgamegeek and Algolia. Commit this file to your forked repository.

3. **Install the python libraries needed** by running:
   ```pip install -r requirements.txt```

4. **Download your games from boardgamegeek and send them to algolia**:
   ```python download_and_index.py --apikey YOUR_ALGOLIA_ADMIN_API_KEY```

   (_Note that this API KEY is NOT the same as the one you put in config.json. Never share your admin api key publicly_)

5. **Enable GitHub Pages** on your forked repository by going into _Settings ->
GitHub Pages_. Select your master branch as Source, and click Save.

6. Your site is now available on (https://YOUR_GITHUB_USERNAME.github.io/mybgg)
